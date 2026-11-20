import express from 'express';
import crypto from 'crypto';
import BiometricDevice from '../models/BiometricDevice.js';
import FingerprintTemplate from '../models/FingerprintTemplate.js';
import GateEntryLog from '../models/GateEntryLog.js';
import Student from '../models/Student.js';
import { protect, authorize } from '../middleware/auth.js';
import { getIO } from '../config/socket.js';
import {
  getISTParts,
  markBiometricAttendancePresent,
  appendBiometricExitRemark
} from '../services/attendanceSync.js';
import { dispatchGateNotification } from '../services/gateNotifier.js';

const router = express.Router();

const ONLINE_THRESHOLD_MS = 12000; // 12 seconds (device polls every 2s)

const formatDevice = (device, enrolledCount = null) => {
  const obj = typeof device.toObject === 'function' ? device.toObject() : { ...device };
  obj.is_online = Boolean(obj.last_heartbeat && (Date.now() - new Date(obj.last_heartbeat).getTime()) < ONLINE_THRESHOLD_MS);
  if (enrolledCount !== null) {
    obj.enrolled_count = enrolledCount;
  }
  return obj;
};

/**
 * Middleware: Authenticate ESP32 hardware requests via x-device-key + x-device-id (or body/query device_id)
 */
const authenticateDevice = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-device-key'] || req.query.api_key;
    const deviceIdRaw = req.headers['x-device-id'] || req.body?.device_id || req.query.device_id;

    if (!apiKey || !deviceIdRaw) {
      return res.status(401).json({ success: false, message: 'Missing device credentials (x-device-id, x-device-key)' });
    }

    const deviceId = String(deviceIdRaw).trim().toUpperCase();
    const device = await BiometricDevice.findOne({ device_id: deviceId });

    if (!device || device.api_key !== String(apiKey).trim()) {
      return res.status(401).json({ success: false, message: 'Invalid device credentials' });
    }

    req.device = device;
    next();
  } catch (error) {
    next(error);
  }
};

// ============================================================================
// PART A: ESP32 HARDWARE DEVICE ENDPOINTS (x-device-id & x-device-key)
// ============================================================================

// @route   GET /api/biometric/device/status
// @desc    ESP32 2-second heartbeat & command polling endpoint
// @access  Device (x-device-key)
router.get('/device/status', authenticateDevice, async (req, res, next) => {
  try {
    const device = req.device;
    const { firmware, templates, ip } = req.query;

    device.last_heartbeat = new Date();
    if (firmware) device.firmware_version = String(firmware).slice(0, 40);
    if (templates !== undefined && !isNaN(Number(templates))) {
      device.total_templates = Number(templates);
    }
    if (ip) {
      device.ip_address = String(ip).slice(0, 64);
    } else if (req.ip) {
      device.ip_address = req.ip;
    }

    // Auto-expire stale enrollment/delete commands older than 2 minutes
    if (
      device.pending_command &&
      device.pending_command.action !== 'NONE' &&
      device.pending_command.status === 'PENDING' &&
      device.pending_command.requested_at &&
      Date.now() - new Date(device.pending_command.requested_at).getTime() > 120000
    ) {
      device.pending_command.status = 'FAILED';
      device.pending_command.message = 'Command timed out waiting for device.';
      device.pending_command.action = 'NONE';
      device.pending_command.updated_at = new Date();
    }

    await device.save();

    const ist = getISTParts();

    res.json({
      success: true,
      device_id: device.device_id,
      sensing_enabled: device.sensing_enabled,
      cooldown_seconds: device.cooldown_seconds,
      server_time_ist: ist.time12Str,
      server_date_ist: ist.dateStr,
      pending_command: device.pending_command || { action: 'NONE', status: 'IDLE' }
    });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/biometric/device/scan
// @desc    ESP32 posts matched R307S fingerprint slot_id on scan
// @access  Device (x-device-key)
router.post('/device/scan', authenticateDevice, async (req, res, next) => {
  try {
    const device = req.device;
    device.last_heartbeat = new Date();
    await device.save();

    if (!device.sensing_enabled) {
      return res.status(403).json({
        success: false,
        status: 'PAUSED',
        message: 'Fingerprint sensing is turned OFF in mobile app'
      });
    }

    const slotId = Number(req.body.slot_id);
    if (!Number.isInteger(slotId) || slotId < 1 || slotId > 1000) {
      return res.status(400).json({
        success: false,
        status: 'INVALID_SLOT',
        message: 'Invalid fingerprint slot_id'
      });
    }

    const template = await FingerprintTemplate.findOne({
      device_id: device.device_id,
      slot_id: slotId
    }).populate('student');

    if (!template || !template.student) {
      return res.status(404).json({
        success: false,
        status: 'UNASSIGNED',
        message: `Slot #${slotId} is not linked to any student`
      });
    }

    const student = template.student;
    if (student.status !== 'Active') {
      return res.status(403).json({
        success: false,
        status: 'INACTIVE_STUDENT',
        student_name: student.name,
        message: 'Student account is inactive'
      });
    }

    const now = new Date();
    const ist = getISTParts(now);

    // Check today's latest gate log for this student
    const lastTodayLog = await GateEntryLog.findOne({
      student: student._id,
      date: ist.dateStr
    }).sort({ timestamp: -1 });

    // Anti-double-scan cooldown protection
    if (lastTodayLog) {
      const elapsedSeconds = Math.floor((now.getTime() - new Date(lastTodayLog.timestamp).getTime()) / 1000);
      if (elapsedSeconds < device.cooldown_seconds) {
        const waitSeconds = device.cooldown_seconds - elapsedSeconds;
        return res.status(200).json({
          success: true,
          status: 'COOLDOWN',
          student_name: student.name,
          class_level: student.class_level,
          last_event: lastTodayLog.event_type,
          wait_seconds: waitSeconds,
          message: `Already scanned (${lastTodayLog.event_type}). Wait ${waitSeconds}s.`
        });
      }
    }

    // Determine ENTRY vs EXIT automatically
    const eventType = (!lastTodayLog || lastTodayLog.event_type === 'EXIT') ? 'ENTRY' : 'EXIT';
    let pairedEntryTime = null;
    let durationMinutes = null;

    if (eventType === 'EXIT' && lastTodayLog) {
      pairedEntryTime = lastTodayLog.timestamp;
      durationMinutes = Math.max(0, Math.round((now.getTime() - new Date(lastTodayLog.timestamp).getTime()) / 60000));
    }

    // Automatically sync with the existing Attendance system on ENTRY (if enabled on device)
    let attendanceMarked = false;
    let attendanceSession = '';

    if (eventType === 'ENTRY' && device.auto_mark_attendance) {
      try {
        const syncResult = await markBiometricAttendancePresent(
          student,
          ist.dateStr,
          ist.time12Str,
          ist.totalMinutes,
          device.pinned_session_name
        );
        attendanceMarked = syncResult.marked;
        attendanceSession = syncResult.session_name;
      } catch (attErr) {
        console.error('[Biometric Auto-Attendance Error]:', attErr.message);
      }
    } else if (eventType === 'EXIT' && device.auto_mark_attendance) {
      attendanceSession = lastTodayLog?.attendance_session || '';
      appendBiometricExitRemark(student, ist.dateStr, ist.time12Str, attendanceSession).catch(() => {});
    }

    const logDoc = await GateEntryLog.create({
      student: student._id,
      device_id: device.device_id,
      slot_id: slotId,
      date: ist.dateStr,
      event_type: eventType,
      timestamp: now,
      paired_entry_time: pairedEntryTime,
      duration_minutes: durationMinutes,
      attendance_marked: attendanceMarked,
      attendance_session: attendanceSession
    });

    // Dispatch parent notifications (Push + Email + optional SMS/WA) asynchronously unless paused
    dispatchGateNotification({
      logDoc,
      student,
      time12Str: ist.time12Str,
      dateStr: ist.dateStr,
      sendParentAlerts: device.parent_alerts_enabled !== false
    }).catch(err => {
      console.error('[Biometric Gate Notification Dispatch Error]:', err.message);
    });

    return res.status(201).json({
      success: true,
      status: 'OK',
      event_type: eventType,
      student_name: student.name,
      class_level: student.class_level,
      roll_number: student.roll_number,
      time_str: ist.time12Str,
      date_str: ist.dateStr,
      duration_minutes: durationMinutes,
      attendance_marked: attendanceMarked,
      attendance_session: attendanceSession
    });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/biometric/device/command-ack
// @desc    ESP32 reports progress/completion of ENROLL / DELETE / CLEAR_ALL commands
// @access  Device (x-device-key)
router.post('/device/command-ack', authenticateDevice, async (req, res, next) => {
  try {
    const device = req.device;
    const { action, status, slot_id, message } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, message: 'Status is required' });
    }

    const currentCmd = device.pending_command || {};
    const effectiveAction = action || currentCmd.action || 'NONE';
    const effectiveSlot = slot_id !== undefined ? Number(slot_id) : currentCmd.slot_id;

    device.last_heartbeat = new Date();
    device.pending_command.status = status;
    device.pending_command.message = message || '';
    device.pending_command.updated_at = new Date();

    if (status === 'COMPLETED') {
      if (effectiveAction === 'ENROLL' && currentCmd.student && effectiveSlot) {
        // Save/update FingerprintTemplate mapping
        await FingerprintTemplate.findOneAndUpdate(
          { device_id: device.device_id, student: currentCmd.student },
          {
            device_id: device.device_id,
            slot_id: effectiveSlot,
            student: currentCmd.student,
            enrolled_at: new Date()
          },
          { upsert: true, new: true }
        );
      } else if (effectiveAction === 'DELETE' && effectiveSlot) {
        await FingerprintTemplate.deleteOne({
          device_id: device.device_id,
          slot_id: effectiveSlot
        });
      } else if (effectiveAction === 'CLEAR_ALL') {
        await FingerprintTemplate.deleteMany({ device_id: device.device_id });
      }

      device.pending_command.action = 'NONE';
    } else if (status === 'FAILED') {
      device.pending_command.action = 'NONE';
    }

    await device.save();

    const io = getIO();
    if (io) {
      const enrolledCount = await FingerprintTemplate.countDocuments({ device_id: device.device_id });
      io.to('GATE_MONITOR').emit('gate_command_update', {
        device_id: device.device_id,
        action: effectiveAction,
        slot_id: effectiveSlot,
        status,
        message: message || '',
        student_name: currentCmd.student_name || '',
        enrolled_count: enrolledCount
      });
    }

    res.json({ success: true, message: 'Command acknowledgement processed' });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// PART B: MOBILE APP / WEB PORTAL CONTROL ENDPOINTS (JWT Protected)
// ============================================================================

// @route   GET /api/biometric/devices
// @desc    List registered ESP32 devices (auto-seeds default GATE-ESP32-01 if empty)
// @access  Private (SuperAdmin, Teacher)
router.get('/devices', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    let devices = await BiometricDevice.find().sort({ createdAt: 1 });

    if (devices.length === 0) {
      const defaultDevice = await BiometricDevice.create({
        device_id: 'GATE-ESP32-01',
        name: 'Main Gate Scanner',
        sensing_enabled: true,
        auto_mark_attendance: true,
        cooldown_seconds: 120
      });
      devices = [defaultDevice];
    }

    const enriched = await Promise.all(
      devices.map(async (dev) => {
        const count = await FingerprintTemplate.countDocuments({ device_id: dev.device_id });
        return formatDevice(dev, count);
      })
    );

    res.json({ success: true, data: enriched });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/biometric/devices
// @desc    Register a new ESP32 gate scanner device
// @access  Private (SuperAdmin)
router.post('/devices', protect, authorize('SuperAdmin'), async (req, res, next) => {
  try {
    const { device_id, name } = req.body;
    if (!device_id || !String(device_id).trim()) {
      return res.status(400).json({ success: false, message: 'Device ID is required' });
    }

    const cleanId = String(device_id).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    const exists = await BiometricDevice.findOne({ device_id: cleanId });
    if (exists) {
      return res.status(400).json({ success: false, message: `Device ${cleanId} already exists` });
    }

    const created = await BiometricDevice.create({
      device_id: cleanId,
      name: (name && String(name).trim()) || `Gate Scanner ${cleanId}`
    });

    res.status(201).json({ success: true, data: formatDevice(created, 0) });
  } catch (error) {
    next(error);
  }
});

// @route   PUT /api/biometric/devices/:deviceId/toggle
// @desc    Remotely toggle fingerprint sensing ON/OFF, auto-attendance, cooldown, or pinned session
// @access  Private (SuperAdmin, Teacher)
router.put('/devices/:deviceId/toggle', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const deviceId = String(req.params.deviceId).trim().toUpperCase();
    const device = await BiometricDevice.findOne({ device_id: deviceId });

    if (!device) {
      return res.status(404).json({ success: false, message: 'Biometric device not found' });
    }

    const { sensing_enabled, auto_mark_attendance, parent_alerts_enabled, cooldown_seconds, name, pinned_session_name, regenerate_key } = req.body;

    if (sensing_enabled !== undefined) device.sensing_enabled = Boolean(sensing_enabled);
    if (auto_mark_attendance !== undefined) device.auto_mark_attendance = Boolean(auto_mark_attendance);
    if (parent_alerts_enabled !== undefined) device.parent_alerts_enabled = Boolean(parent_alerts_enabled);
    if (cooldown_seconds !== undefined) {
      const cd = Number(cooldown_seconds);
      if (Number.isFinite(cd) && cd >= 5 && cd <= 3600) {
        device.cooldown_seconds = Math.round(cd);
      }
    }
    if (name !== undefined && String(name).trim()) {
      device.name = String(name).trim();
    }
    if (pinned_session_name !== undefined) {
      device.pinned_session_name = String(pinned_session_name).trim();
    }
    if (regenerate_key === true && req.user.role === 'SuperAdmin') {
      device.api_key = crypto.randomBytes(24).toString('hex');
    }

    await device.save();

    const enrolledCount = await FingerprintTemplate.countDocuments({ device_id: device.device_id });
    const formatted = formatDevice(device, enrolledCount);

    const io = getIO();
    if (io) {
      io.to('GATE_MONITOR').emit('gate_device_updated', formatted);
    }

    res.json({
      success: true,
      message: `Scanner "${device.name}" updated (Sensing ${device.sensing_enabled ? 'ON' : 'OFF'})`,
      data: formatted
    });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/biometric/devices/:deviceId/enroll
// @desc    Queue remote fingerprint enrollment on ESP32 for a student
// @access  Private (SuperAdmin, Teacher)
router.post('/devices/:deviceId/enroll', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const deviceId = String(req.params.deviceId).trim().toUpperCase();
    const { student_id } = req.body;

    if (!student_id) {
      return res.status(400).json({ success: false, message: 'student_id is required' });
    }

    const [device, student] = await Promise.all([
      BiometricDevice.findOne({ device_id: deviceId }),
      Student.findById(student_id)
    ]);

    if (!device) {
      return res.status(404).json({ success: false, message: 'Biometric device not found' });
    }
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    // Reuse existing slot if re-enrolling same student, else find lowest free slot 1..1000
    const existingTemplate = await FingerprintTemplate.findOne({ device_id: deviceId, student: student._id });
    let targetSlot = existingTemplate?.slot_id || null;

    if (!targetSlot) {
      const usedTemplates = await FingerprintTemplate.find({ device_id: deviceId }).select('slot_id');
      const usedSet = new Set(usedTemplates.map(t => t.slot_id));
      for (let i = 1; i <= 1000; i++) {
        if (!usedSet.has(i)) {
          targetSlot = i;
          break;
        }
      }
    }

    if (!targetSlot) {
      return res.status(400).json({ success: false, message: 'R307S sensor memory full (1000/1000 slots used)' });
    }

    device.pending_command = {
      action: 'ENROLL',
      slot_id: targetSlot,
      student: student._id,
      student_name: student.name,
      status: 'PENDING',
      message: `Waiting for ESP32 to begin enrolling ${student.name} in Slot #${targetSlot}...`,
      requested_at: new Date(),
      updated_at: new Date()
    };

    await device.save();

    const io = getIO();
    if (io) {
      io.to('GATE_MONITOR').emit('gate_command_update', {
        device_id: device.device_id,
        action: 'ENROLL',
        slot_id: targetSlot,
        status: 'PENDING',
        student_name: student.name,
        message: device.pending_command.message
      });
    }

    res.json({
      success: true,
      message: `Enrollment queued for ${student.name} (Slot #${targetSlot}). Follow instructions on the ESP32 OLED screen.`,
      data: {
        slot_id: targetSlot,
        student_name: student.name,
        pending_command: device.pending_command
      }
    });
  } catch (error) {
    next(error);
  }
});

// @route   DELETE /api/biometric/devices/:deviceId/templates/:studentId
// @desc    Remove student's fingerprint mapping and queue DELETE on ESP32 R307S
// @access  Private (SuperAdmin, Teacher)
router.delete('/devices/:deviceId/templates/:studentId', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const deviceId = String(req.params.deviceId).trim().toUpperCase();
    const { studentId } = req.params;

    const device = await BiometricDevice.findOne({ device_id: deviceId });
    if (!device) {
      return res.status(404).json({ success: false, message: 'Biometric device not found' });
    }

    const template = await FingerprintTemplate.findOne({ device_id: deviceId, student: studentId }).populate('student', 'name');
    if (!template) {
      return res.status(404).json({ success: false, message: 'Student has no enrolled fingerprint on this device' });
    }

    const slotId = template.slot_id;
    const studentName = template.student?.name || 'Student';

    // Remove mapping from DB immediately so stale scans can never match, and queue hardware slot erase
    await FingerprintTemplate.deleteOne({ _id: template._id });

    device.pending_command = {
      action: 'DELETE',
      slot_id: slotId,
      student: null,
      student_name: studentName,
      status: 'PENDING',
      message: `Deleting Slot #${slotId} (${studentName}) from R307S sensor...`,
      requested_at: new Date(),
      updated_at: new Date()
    };
    await device.save();

    res.json({
      success: true,
      message: `Removed fingerprint for ${studentName} (Slot #${slotId}). Sensor erase queued.`
    });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/biometric/devices/:deviceId/cancel-command
// @desc    Cancel any pending/stuck enrollment or delete command
// @access  Private (SuperAdmin, Teacher)
router.post('/devices/:deviceId/cancel-command', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const deviceId = String(req.params.deviceId).trim().toUpperCase();
    const device = await BiometricDevice.findOne({ device_id: deviceId });
    if (!device) {
      return res.status(404).json({ success: false, message: 'Biometric device not found' });
    }

    device.pending_command = {
      action: 'NONE',
      slot_id: null,
      student: null,
      student_name: '',
      status: 'IDLE',
      message: 'Cancelled by user',
      requested_at: null,
      updated_at: new Date()
    };
    await device.save();

    res.json({ success: true, message: 'Pending command cleared' });
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/biometric/templates/:deviceId
// @desc    Get all enrolled fingerprint templates for a device
// @access  Private (SuperAdmin, Teacher)
router.get('/templates/:deviceId', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const deviceId = String(req.params.deviceId).trim().toUpperCase();
    const templates = await FingerprintTemplate.find({ device_id: deviceId })
      .populate('student', 'name roll_number class_level status')
      .sort({ slot_id: 1 });

    res.json({ success: true, count: templates.length, data: templates });
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/biometric/logs
// @desc    Get gate entry/exit logs & daily summary (Student sees only own logs)
// @access  Private (All authenticated roles)
router.get('/logs', protect, async (req, res, next) => {
  try {
    const ist = getISTParts();
    const { date, class_level, event_type, search, limit = 200 } = req.query;
    const targetDate = date ? String(date).split('T')[0] : ist.dateStr;

    const query = {};
    if (req.user.role === 'Student') {
      if (!req.user.studentProfile) {
        return res.json({
          success: true,
          date: targetDate,
          stats: { entries_today: 0, exits_today: 0, inside_now: 0, attendance_synced: 0 },
          data: []
        });
      }
      query.student = req.user.studentProfile;
      if (date) {
        query.date = targetDate;
      }
    } else {
      query.date = targetDate;
      if (event_type && ['ENTRY', 'EXIT'].includes(event_type)) {
        query.event_type = event_type;
      }
    }

    const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 200));

    let logs = await GateEntryLog.find(query)
      .populate('student', 'name roll_number class_level parent_name primary_contact')
      .sort({ timestamp: -1 })
      .limit(limitNum);

    // Optional class & search filters for Admin/Teacher
    if (req.user.role !== 'Student') {
      if (class_level && class_level !== 'All') {
        const cleanCls = String(class_level).trim().toUpperCase();
        logs = logs.filter(l => l.student?.class_level?.toUpperCase() === cleanCls);
      }
      if (search && String(search).trim()) {
        const q = String(search).trim().toLowerCase();
        logs = logs.filter(l =>
          l.student?.name?.toLowerCase().includes(q) ||
          l.student?.roll_number?.toLowerCase().includes(q)
        );
      }
    }

    // Compute live daily stats for the selected date
    const statsQuery = req.user.role === 'Student'
      ? { student: req.user.studentProfile, date: targetDate }
      : { date: targetDate };

    const dayLogs = await GateEntryLog.find(statsQuery).sort({ timestamp: 1 });
    let entriesToday = 0;
    let exitsToday = 0;
    let attendanceSynced = 0;
    const latestStateByStudent = new Map();

    dayLogs.forEach(l => {
      if (l.event_type === 'ENTRY') entriesToday++;
      if (l.event_type === 'EXIT') exitsToday++;
      if (l.attendance_marked) attendanceSynced++;
      latestStateByStudent.set(l.student.toString(), l.event_type);
    });

    let insideNow = 0;
    latestStateByStudent.forEach(state => {
      if (state === 'ENTRY') insideNow++;
    });

    res.json({
      success: true,
      date: targetDate,
      stats: {
        entries_today: entriesToday,
        exits_today: exitsToday,
        inside_now: insideNow,
        attendance_synced: attendanceSynced
      },
      data: logs
    });
  } catch (error) {
    next(error);
  }
});

export default router;
