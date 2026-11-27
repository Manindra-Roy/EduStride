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

const ONLINE_THRESHOLD_MS = 30000; // 30 seconds (active polls ~5.5s, low-power standby polls ~12s)
const PENDING_TIMEOUT_MS = 120000; // 2 min waiting for device pickup (ENROLL / SYNC_SLOTS only)
const IN_PROGRESS_TIMEOUT_MS = 180000; // 3 min waiting for enrollment completion (ENROLL / SYNC_SLOTS only)
const AUTO_EXPIRABLE_ACTIONS = new Set([
  'ENROLL',
  'SYNC_SLOTS',
  'TRAY_OPEN',
  'TRAY_CLOSE',
  'TRAY_STOP',
  'TRAY_HOME',
  'TRAY_NUDGE_OPEN',
  'TRAY_NUDGE_CLOSE',
  'TRAY_SET_OPEN',
  'TRAY_SET_CLOSED',
  'REBOOT'
]);

const VALID_TRAY_MODES = new Set(['LIMIT_360', 'TIMED_360', 'ANGLE_180']);
const VALID_TRAY_STATES = new Set(['UNKNOWN', 'CLOSED', 'OPEN', 'EXTENDING', 'RETRACTING', 'HOMING', 'STOPPED', 'FAULT']);

const DEFAULT_TRAY_CONFIG = Object.freeze({
  enabled: true,
  mode: 'LIMIT_360',
  invert_direction: false,
  speed_pct: 80,
  stop_us: 1500,
  open_ms: 1060,
  close_ms: 1060,
  closed_angle: 10,
  open_angle: 110,
  sweep_speed_dps: 120,
  max_run_ms: 4500,
  auto_home_on_boot: false
});

const clampInt = (val, min, max, fallback) => {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
};

const normalizeTrayState = (raw) => {
  const s = String(raw || '').trim().toUpperCase();
  if (s === 'EXTENDED') return 'OPEN';
  if (s === 'RETRACTED') return 'CLOSED';
  return VALID_TRAY_STATES.has(s) ? s : 'UNKNOWN';
};

const normalizeTrayConfig = (raw = {}) => {
  const src = raw && typeof raw.toObject === 'function' ? raw.toObject() : (raw || {});
  const modeStr = String(src.mode || '').trim().toUpperCase();
  return {
    enabled: src.enabled !== undefined ? Boolean(src.enabled) : DEFAULT_TRAY_CONFIG.enabled,
    mode: VALID_TRAY_MODES.has(modeStr) ? modeStr : DEFAULT_TRAY_CONFIG.mode,
    invert_direction: src.invert_direction !== undefined ? Boolean(src.invert_direction) : DEFAULT_TRAY_CONFIG.invert_direction,
    speed_pct: clampInt(src.speed_pct, 20, 100, DEFAULT_TRAY_CONFIG.speed_pct),
    stop_us: clampInt(src.stop_us, 1350, 1650, DEFAULT_TRAY_CONFIG.stop_us),
    open_ms: clampInt(src.open_ms, 100, 8000, DEFAULT_TRAY_CONFIG.open_ms),
    close_ms: clampInt(src.close_ms, 100, 8000, DEFAULT_TRAY_CONFIG.close_ms),
    closed_angle: clampInt(src.closed_angle, 0, 180, DEFAULT_TRAY_CONFIG.closed_angle),
    open_angle: clampInt(src.open_angle, 0, 180, DEFAULT_TRAY_CONFIG.open_angle),
    sweep_speed_dps: clampInt(src.sweep_speed_dps, 30, 360, DEFAULT_TRAY_CONFIG.sweep_speed_dps),
    max_run_ms: clampInt(src.max_run_ms, 500, 15000, DEFAULT_TRAY_CONFIG.max_run_ms),
    auto_home_on_boot: src.auto_home_on_boot !== undefined ? Boolean(src.auto_home_on_boot) : DEFAULT_TRAY_CONFIG.auto_home_on_boot
  };
};

// Per-student lock to serialize concurrent scan requests across multiple fingers/scanners & prevent cooldown bypass
const activeScanLocks = new Map();

// Per-device async mutex to serialize BiometricDevice command/settings mutations
const deviceLocks = new Map();
const withDeviceLock = async (deviceId, fn) => {
  const key = String(deviceId || '').trim().toUpperCase();
  const prev = deviceLocks.get(key) || Promise.resolve();
  let release;
  const next = new Promise(resolve => { release = resolve; });
  const chained = prev.catch(() => {}).then(() => next);
  deviceLocks.set(key, chained);
  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (deviceLocks.get(key) === chained) {
      deviceLocks.delete(key);
    }
  }
};

const withStudentScanLock = async (studentId, fn) => {
  const key = String(studentId);
  const prev = activeScanLocks.get(key) || Promise.resolve();
  let release;
  const next = new Promise(resolve => { release = resolve; });
  const chained = prev.catch(() => {}).then(() => next);
  activeScanLocks.set(key, chained);
  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (activeScanLocks.get(key) === chained) {
      activeScanLocks.delete(key);
    }
  }
};

const timingSafeEquals = (a, b) => {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

const isActiveCommand = (cmd) => (
  Boolean(cmd && cmd.action && cmd.action !== 'NONE' && (cmd.status === 'PENDING' || cmd.status === 'IN_PROGRESS'))
);

const buildCommandPayload = ({
  action,
  slot_id = null,
  student = null,
  student_name = '',
  finger_index = 1,
  finger_label = 'Primary Finger',
  enrolled_by = null,
  message = '',
  step = '',
  progress = 0
}) => ({
  command_id: crypto.randomUUID(),
  action,
  slot_id,
  student,
  student_name,
  finger_index,
  finger_label,
  enrolled_by,
  status: 'PENDING',
  step,
  progress,
  message,
  requested_at: new Date(),
  updated_at: new Date()
});

const promoteNextCommand = (device) => {
  if (!Array.isArray(device.command_queue) || device.command_queue.length === 0) {
    return false;
  }
  const next = device.command_queue.shift();
  const nextObj = typeof next.toObject === 'function' ? next.toObject() : { ...next };
  device.pending_command = {
    command_id: nextObj.command_id || crypto.randomUUID(),
    action: nextObj.action || 'NONE',
    slot_id: nextObj.slot_id ?? null,
    student: nextObj.student ?? null,
    student_name: nextObj.student_name || '',
    finger_index: nextObj.finger_index || 1,
    finger_label: nextObj.finger_label || 'Primary Finger',
    enrolled_by: nextObj.enrolled_by ?? null,
    status: 'PENDING',
    step: nextObj.step || '',
    progress: nextObj.progress || 0,
    message: nextObj.message || '',
    requested_at: new Date(),
    updated_at: new Date()
  };
  return true;
};

const enqueueDeviceCommand = (device, cmdData) => {
  const cmd = buildCommandPayload(cmdData);
  if (!Array.isArray(device.command_queue)) {
    device.command_queue = [];
  }
  if (!isActiveCommand(device.pending_command)) {
    device.pending_command = cmd;
    return { queued: false, command: device.pending_command };
  }
  device.command_queue.push(cmd);
  return { queued: true, command: cmd };
};

/**
 * Removes all FingerprintTemplate DB entries for a deleted student and queues hardware
 * DELETE commands on each corresponding ESP32 device so R307S flash never leaks orphan slots.
 */
export const enqueueHardwareDeletesForStudent = async (studentId, studentName = 'Deleted Student') => {
  const templates = await FingerprintTemplate.find({ student: studentId });
  if (templates.length === 0) return;

  await FingerprintTemplate.deleteMany({ student: studentId });

  const byDevice = new Map();
  for (const t of templates) {
    if (!byDevice.has(t.device_id)) byDevice.set(t.device_id, []);
    byDevice.get(t.device_id).push(t.slot_id);
  }

  const io = getIO();
  for (const [deviceId, slots] of byDevice.entries()) {
    await withDeviceLock(deviceId, async () => {
      const device = await BiometricDevice.findOne({ device_id: deviceId });
      if (!device) return;

      for (const slotId of slots) {
        enqueueDeviceCommand(device, {
          action: 'DELETE',
          slot_id: slotId,
          student: null,
          student_name: studentName,
          message: `Erasing Slot #${slotId} (${studentName} deleted) from R307S sensor...`
        });
      }
      await device.save();

      if (io) {
        io.to('GATE_MONITOR').emit('gate_command_update', {
          device_id: device.device_id,
          command_id: device.pending_command?.command_id || '',
          action: device.pending_command?.action || 'DELETE',
          slot_id: device.pending_command?.slot_id || slots[0],
          status: device.pending_command?.status || 'PENDING',
          student_name: studentName,
          message: device.pending_command?.message || `Queued hardware erase for ${studentName}`,
          queue_length: device.command_queue.length
        });
      }
    });
  }
};

const formatDevice = (device, enrolledCount = null, { includeApiKey = false } = {}) => {
  const obj = typeof device.toObject === 'function' ? device.toObject() : { ...device };
  obj.is_online = Boolean(obj.last_heartbeat && (Date.now() - new Date(obj.last_heartbeat).getTime()) < ONLINE_THRESHOLD_MS);
  obj.queue_length = Array.isArray(obj.command_queue) ? obj.command_queue.length : 0;
  obj.device_power_on = obj.device_power_on !== false;
  obj.tray_config = normalizeTrayConfig(obj.tray_config);
  obj.tray_state = normalizeTrayState(obj.tray_state);
  obj.tray_fault = typeof obj.tray_fault === 'string' ? obj.tray_fault : '';
  obj.tray_switches = {
    closed: Boolean(obj.tray_switches?.closed),
    open: Boolean(obj.tray_switches?.open)
  };
  if (enrolledCount !== null) {
    obj.enrolled_count = enrolledCount;
  }
  if (!includeApiKey) {
    delete obj.api_key;
  }
  return obj;
};

/**
 * Middleware: Authenticate ESP32 hardware requests via x-device-key & x-device-id headers
 * (Query-string api_key is intentionally disallowed to prevent key leakage in access logs)
 */
const authenticateDevice = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-device-key'];
    const deviceIdRaw = req.headers['x-device-id'] || req.body?.device_id || req.query.device_id;

    if (!apiKey || !deviceIdRaw) {
      return res.status(401).json({ success: false, message: 'Missing device credentials (x-device-id, x-device-key)' });
    }

    const deviceId = String(deviceIdRaw).trim().toUpperCase();
    const device = await BiometricDevice.findOne({ device_id: deviceId });

    if (!device || !timingSafeEquals(device.api_key, String(apiKey).trim())) {
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
// @desc    ESP32 heartbeat & command polling endpoint (uses lightweight updateOne on routine ticks)
// @access  Device (x-device-key)
router.get('/device/status', authenticateDevice, async (req, res, next) => {
  try {
    let device = req.device;
    const { firmware, templates, ip, tray, sw, tfault } = req.query;

    const now = new Date();
    const updatePatch = { last_heartbeat: now };
    if (firmware) {
      const cleanFw = String(firmware).slice(0, 40);
      if (cleanFw !== device.firmware_version) updatePatch.firmware_version = cleanFw;
    }
    if (templates !== undefined && !isNaN(Number(templates))) {
      const cleanTpl = Number(templates);
      if (cleanTpl !== device.total_templates) updatePatch.total_templates = cleanTpl;
    }
    if (tray) {
      const cleanTray = normalizeTrayState(tray);
      if (cleanTray !== normalizeTrayState(device.tray_state)) {
        updatePatch.tray_state = cleanTray;
      }
      if (cleanTray !== 'FAULT' && device.tray_fault) {
        updatePatch.tray_fault = '';
      }
    }
    if (typeof sw === 'string' && sw.length === 2 && /^[01]{2}$/.test(sw)) {
      const swClosed = sw[0] === '1';
      const swOpen = sw[1] === '1';
      if (Boolean(device.tray_switches?.closed) !== swClosed || Boolean(device.tray_switches?.open) !== swOpen) {
        updatePatch.tray_switches = { closed: swClosed, open: swOpen };
      }
    }
    if (tfault !== undefined) {
      const cleanFault = String(tfault || '').slice(0, 140);
      if (cleanFault !== (device.tray_fault || '')) {
        updatePatch.tray_fault = cleanFault;
      }
    }
    // Only fall back to req.ip when device.ip_address is empty so omitted &ip= never clobbers LAN IP
    const resolvedIp = ip ? String(ip).slice(0, 64) : (!device.ip_address ? (req.ip || '') : '');
    if (resolvedIp && resolvedIp !== device.ip_address) {
      updatePatch.ip_address = resolvedIp;
    }

    const needsTimeoutCheck = Boolean(
      device.pending_command &&
      AUTO_EXPIRABLE_ACTIONS.has(device.pending_command.action) &&
      (device.pending_command.status === 'PENDING' || device.pending_command.status === 'IN_PROGRESS')
    );
    const needsQueuePromote = Boolean(
      !isActiveCommand(device.pending_command) &&
      Array.isArray(device.command_queue) &&
      device.command_queue.length > 0
    );

    if (needsTimeoutCheck || needsQueuePromote) {
      device = await withDeviceLock(device.device_id, async () => {
        const fresh = await BiometricDevice.findById(device._id);
        if (!fresh) return device;

        let commandMutated = false;

        // Only auto-expire ENROLL and SYNC_SLOTS; never drop maintenance commands (DELETE / CLEAR_ALL)
        if (fresh.pending_command && AUTO_EXPIRABLE_ACTIONS.has(fresh.pending_command.action)) {
          const cmdStatus = fresh.pending_command.status;
          const refTime = fresh.pending_command.updated_at || fresh.pending_command.requested_at;
          const elapsed = refTime ? now.getTime() - new Date(refTime).getTime() : 0;

          if (
            (cmdStatus === 'PENDING' && elapsed > PENDING_TIMEOUT_MS) ||
            (cmdStatus === 'IN_PROGRESS' && elapsed > IN_PROGRESS_TIMEOUT_MS)
          ) {
            fresh.pending_command.status = 'FAILED';
            fresh.pending_command.message = 'Command timed out waiting for device.';
            fresh.pending_command.action = 'NONE';
            fresh.pending_command.updated_at = now;
            promoteNextCommand(fresh);
            commandMutated = true;
          }
        } else if (!isActiveCommand(fresh.pending_command) && Array.isArray(fresh.command_queue) && fresh.command_queue.length > 0) {
          promoteNextCommand(fresh);
          commandMutated = true;
        }

        if (commandMutated) {
          Object.assign(fresh, updatePatch);
          await fresh.save();
        } else {
          await BiometricDevice.updateOne({ _id: fresh._id }, { $set: updatePatch });
        }
        return fresh;
      });
    } else {
      await BiometricDevice.updateOne({ _id: device._id }, { $set: updatePatch });
    }

    // Broadcast live tray_state / switches / fault / firmware changes to Gate Scanner monitors immediately
    if (updatePatch.tray_state || updatePatch.tray_switches || updatePatch.tray_fault !== undefined || updatePatch.firmware_version) {
      const io = getIO();
      if (io) {
        const merged = { ...(typeof device.toObject === 'function' ? device.toObject() : device), ...updatePatch };
        io.to('GATE_MONITOR').emit('gate_device_updated', formatDevice(merged, null, { includeApiKey: false }));
      }
    }

    const ist = getISTParts(now);

    res.json({
      success: true,
      device_id: device.device_id,
      device_power_on: device.device_power_on !== false,
      sensing_enabled: device.sensing_enabled,
      cooldown_seconds: device.cooldown_seconds,
      tray_config: normalizeTrayConfig(device.tray_config),
      server_time_ist: ist.time12Str,
      server_date_ist: ist.dateStr,
      queue_length: Array.isArray(device.command_queue) ? device.command_queue.length : 0,
      pending_command: device.pending_command || { command_id: '', action: 'NONE', status: 'IDLE' }
    });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/biometric/device/scan
// @desc    ESP32 posts matched R307S fingerprint slot_id on scan (supports optional offline scanned_at, scan_id, confidence)
// @access  Device (x-device-key)
router.post('/device/scan', authenticateDevice, async (req, res, next) => {
  try {
    const device = req.device;
    const slotId = Number(req.body?.slot_id);
    const cleanScanId = typeof req.body?.scan_id === 'string' && req.body.scan_id.trim()
      ? req.body.scan_id.trim().slice(0, 128)
      : null;
    const confidenceVal = req.body?.confidence !== undefined && req.body?.confidence !== null && Number.isFinite(Number(req.body.confidence))
      ? Number(req.body.confidence)
      : null;

    // Non-blocking heartbeat timestamp update
    BiometricDevice.updateOne({ _id: device._id }, { $set: { last_heartbeat: new Date() } }).catch(() => {});

    // 1. Check scan_id idempotency FIRST if provided (offline retry deduplication)
    if (cleanScanId) {
      const existingByScanId = await GateEntryLog.findOne({ scan_id: cleanScanId })
        .populate('student', 'name class_level roll_number')
        .lean();
      if (existingByScanId) {
        const existingIst = getISTParts(new Date(existingByScanId.timestamp));
        return res.status(200).json({
          success: true,
          duplicate: true,
          status: 'OK',
          event_type: existingByScanId.event_type,
          student_name: existingByScanId.student?.name || '',
          class_level: existingByScanId.student?.class_level || '',
          roll_number: existingByScanId.student?.roll_number || '',
          time_str: existingIst.time12Str,
          date_str: existingByScanId.date,
          duration_minutes: existingByScanId.duration_minutes,
          attendance_marked: existingByScanId.attendance_marked,
          attendance_session: existingByScanId.attendance_session
        });
      }
    }

    if (device.device_power_on === false) {
      return res.status(403).json({
        success: false,
        status: 'PAUSED',
        message: 'Device is powered OFF (Standby) in app'
      });
    }

    if (!device.sensing_enabled) {
      return res.status(403).json({
        success: false,
        status: 'PAUSED',
        message: 'Fingerprint sensing is turned OFF in mobile app'
      });
    }

    if (!Number.isInteger(slotId) || slotId < 1 || slotId > 1000) {
      return res.status(400).json({
        success: false,
        status: 'INVALID_SLOT',
        message: 'Invalid fingerprint slot_id'
      });
    }

    // 2. Resolve FingerprintTemplate BEFORE acquiring lock so we serialize per-student
    const template = await FingerprintTemplate.findOne({
      device_id: device.device_id,
      slot_id: slotId
    })
      .populate('student', 'name roll_number class_level status parent_name parent_email primary_contact')
      .lean();

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

    // 3. Serialize per student._id to prevent multi-finger / multi-scanner cooldown bypass
    const responseData = await withStudentScanLock(student._id, async () => {
      if (cleanScanId) {
        const racedExisting = await GateEntryLog.findOne({ scan_id: cleanScanId }).lean();
        if (racedExisting) {
          const existingIst = getISTParts(new Date(racedExisting.timestamp));
          return {
            httpStatus: 200,
            body: {
              success: true,
              duplicate: true,
              status: 'OK',
              event_type: racedExisting.event_type,
              student_name: student.name,
              class_level: student.class_level,
              roll_number: student.roll_number,
              time_str: existingIst.time12Str,
              date_str: racedExisting.date,
              duration_minutes: racedExisting.duration_minutes,
              attendance_marked: racedExisting.attendance_marked,
              attendance_session: racedExisting.attendance_session
            }
          };
        }
      }

      // Support optional offline-buffered scanned_at timestamp (within last 24h, not >2m in future)
      let scanTime = new Date();
      if (req.body?.scanned_at !== undefined && req.body?.scanned_at !== null) {
        const rawVal = req.body.scanned_at;
        const parsedMs = typeof rawVal === 'number'
          ? (rawVal < 1e12 ? rawVal * 1000 : rawVal)
          : Date.parse(String(rawVal));
        const nowMs = Date.now();
        if (Number.isFinite(parsedMs) && parsedMs <= nowMs + 120000 && parsedMs >= nowMs - 86400000) {
          scanTime = new Date(parsedMs);
        }
      }

      const ist = getISTParts(scanTime);

      // Query nearest log at or before scanTime AND nearest log after scanTime (handles out-of-order offline scans)
      const [lastPriorLog, nextAfterLog] = await Promise.all([
        GateEntryLog.findOne({
          student: student._id,
          date: ist.dateStr,
          timestamp: { $lte: scanTime }
        })
          .select('event_type timestamp attendance_session')
          .sort({ timestamp: -1 })
          .lean(),
        GateEntryLog.findOne({
          student: student._id,
          date: ist.dateStr,
          timestamp: { $gt: scanTime }
        })
          .select('event_type timestamp attendance_session')
          .sort({ timestamp: 1 })
          .lean()
      ]);

      // Anti-double-scan cooldown protection against the nearest log in either direction
      let nearestLog = null;
      let nearestAbsDiffSec = Infinity;
      for (const candidate of [lastPriorLog, nextAfterLog]) {
        if (!candidate) continue;
        const diffSec = Math.abs(Math.floor((scanTime.getTime() - new Date(candidate.timestamp).getTime()) / 1000));
        if (diffSec < nearestAbsDiffSec) {
          nearestAbsDiffSec = diffSec;
          nearestLog = candidate;
        }
      }

      if (nearestLog && nearestAbsDiffSec < device.cooldown_seconds) {
        const waitSeconds = device.cooldown_seconds - nearestAbsDiffSec;
        return {
          httpStatus: 200,
          body: {
            success: true,
            status: 'COOLDOWN',
            student_name: student.name,
            class_level: student.class_level,
            last_event: nearestLog.event_type,
            wait_seconds: waitSeconds,
            message: `Already scanned (${nearestLog.event_type}). Wait ${waitSeconds}s.`
          }
        };
      }

      // Determine ENTRY vs EXIT chronologically based on lastPriorLog
      const eventType = (!lastPriorLog || lastPriorLog.event_type === 'EXIT') ? 'ENTRY' : 'EXIT';
      let pairedEntryTime = null;
      let durationMinutes = null;

      if (eventType === 'EXIT' && lastPriorLog) {
        pairedEntryTime = lastPriorLog.timestamp;
        durationMinutes = Math.max(0, Math.round((scanTime.getTime() - new Date(lastPriorLog.timestamp).getTime()) / 60000));
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
        attendanceSession = lastPriorLog?.attendance_session || '';
        appendBiometricExitRemark(student, ist.dateStr, ist.time12Str, attendanceSession).catch(() => {});
      }

      const logPayload = {
        student: student._id,
        device_id: device.device_id,
        slot_id: slotId,
        confidence: confidenceVal,
        date: ist.dateStr,
        event_type: eventType,
        timestamp: scanTime,
        paired_entry_time: pairedEntryTime,
        duration_minutes: durationMinutes,
        attendance_marked: attendanceMarked,
        attendance_session: attendanceSession
      };
      if (cleanScanId) {
        logPayload.scan_id = cleanScanId;
      }

      let logDoc;
      try {
        logDoc = await GateEntryLog.create(logPayload);
      } catch (createErr) {
        if (createErr?.code === 11000 && cleanScanId) {
          const dup = await GateEntryLog.findOne({ scan_id: cleanScanId }).lean();
          if (dup) {
            const dupIst = getISTParts(new Date(dup.timestamp));
            return {
              httpStatus: 200,
              body: {
                success: true,
                duplicate: true,
                status: 'OK',
                event_type: dup.event_type,
                student_name: student.name,
                class_level: student.class_level,
                roll_number: student.roll_number,
                time_str: dupIst.time12Str,
                date_str: dup.date,
                duration_minutes: dup.duration_minutes,
                attendance_marked: dup.attendance_marked,
                attendance_session: dup.attendance_session
              }
            };
          }
        }
        throw createErr;
      }

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

      return {
        httpStatus: 201,
        body: {
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
        }
      };
    });

    return res.status(responseData.httpStatus).json(responseData.body);
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/biometric/device/command-ack
// @desc    ESP32 reports progress/completion of ENROLL / DELETE / CLEAR_ALL commands
// @access  Device (x-device-key)
router.post('/device/command-ack', authenticateDevice, async (req, res, next) => {
  try {
    const { action, status, slot_id, message, command_id, step, progress, duplicate_slot_id } = req.body || {};

    if (!status) {
      return res.status(400).json({ success: false, message: 'Status is required' });
    }

    const result = await withDeviceLock(req.device.device_id, async () => {
      const device = await BiometricDevice.findById(req.device._id);
      if (!device) {
        return { httpStatus: 404, body: { success: false, message: 'Biometric device not found' } };
      }

      const currentCmd = device.pending_command || {};
      const effectiveAction = action || currentCmd.action || 'NONE';
      const effectiveSlot = slot_id !== undefined ? Number(slot_id) : currentCmd.slot_id;

      // Require non-empty active command_id & matching command_id and action
      const hasActiveCmd = Boolean(currentCmd.command_id && currentCmd.action && currentCmd.action !== 'NONE');
      const cmdIdMatches = hasActiveCmd && Boolean(command_id) && String(command_id) === String(currentCmd.command_id);
      const actionMatches = !action || String(action) === String(currentCmd.action);

      device.last_heartbeat = new Date();

      // If an ENROLL completed on the ESP32 AFTER staff canceled/replaced it in the app,
      // check if the slot is currently claimed by a newer ENROLL or template before queueing cleanup DELETE
      if (status === 'COMPLETED' && effectiveAction === 'ENROLL' && (!cmdIdMatches || !actionMatches || !currentCmd.student || currentCmd.action !== 'ENROLL')) {
        if (Number.isInteger(effectiveSlot) && effectiveSlot >= 1 && effectiveSlot <= 1000) {
          const slotTargetedByPendingEnroll =
            isActiveCommand(device.pending_command) &&
            device.pending_command.action === 'ENROLL' &&
            device.pending_command.slot_id === effectiveSlot;
          const slotTargetedByQueuedEnroll =
            Array.isArray(device.command_queue) &&
            device.command_queue.some(c => c.action === 'ENROLL' && c.slot_id === effectiveSlot);
          const slotOwnedByTemplate = await FingerprintTemplate.exists({
            device_id: device.device_id,
            slot_id: effectiveSlot
          });

          if (!slotTargetedByPendingEnroll && !slotTargetedByQueuedEnroll && !slotOwnedByTemplate) {
            enqueueDeviceCommand(device, {
              action: 'DELETE',
              slot_id: effectiveSlot,
              student: null,
              student_name: 'Canceled Enrollment',
              message: `Cleaning up canceled enrollment from Slot #${effectiveSlot} on R307S...`
            });
          }
          await device.save();
        }
        return {
          httpStatus: 200,
          body: { success: true, message: 'Stale enrollment completion detected; evaluated hardware slot cleanup' }
        };
      }

      // Reject stale acks when command_id or action does not match (or currentCmd.action === 'NONE')
      if (!cmdIdMatches || !actionMatches) {
        await BiometricDevice.updateOne({ _id: device._id }, { $set: { last_heartbeat: device.last_heartbeat } });
        return {
          httpStatus: 200,
          body: { success: true, message: 'Ignored acknowledgement for superseded or inactive command' }
        };
      }

      const ackStudentName = currentCmd.student_name || '';
      const ackStudentId = currentCmd.student ? String(currentCmd.student) : null;

      // Enrich duplicate-finger rejection with the actual enrolled student's name & class
      let enrichedMessage = message || '';
      let duplicateStudentName = '';
      if (duplicate_slot_id !== undefined && Number.isInteger(Number(duplicate_slot_id))) {
        const dupSlot = Number(duplicate_slot_id);
        const dupTemplate = await FingerprintTemplate.findOne({
          device_id: device.device_id,
          slot_id: dupSlot
        }).populate('student', 'name class_level roll_number').lean();
        if (dupTemplate?.student) {
          duplicateStudentName = dupTemplate.student.name;
          enrichedMessage = `Duplicate fingerprint detected! This finger is already enrolled to ${dupTemplate.student.name} (Class ${dupTemplate.student.class_level}, Roll ${dupTemplate.student.roll_number}, Slot #${dupSlot}).`;
        } else if (!enrichedMessage) {
          enrichedMessage = `Duplicate fingerprint detected! This finger already matches Slot #${dupSlot} on the sensor.`;
        }
      }

      const effectiveStep = step !== undefined ? String(step) : (status === 'COMPLETED' ? 'DONE' : (currentCmd.step || ''));
      const effectiveProgress = progress !== undefined && Number.isFinite(Number(progress))
        ? Math.max(0, Math.min(100, Math.round(Number(progress))))
        : (status === 'COMPLETED' ? 100 : (currentCmd.progress || 0));

      device.pending_command.status = status;
      device.pending_command.step = effectiveStep;
      device.pending_command.progress = effectiveProgress;
      device.pending_command.message = enrichedMessage;
      device.pending_command.updated_at = new Date();

      let promotedNext = false;

      if (status === 'COMPLETED') {
        if (effectiveAction === 'ENROLL' && currentCmd.student && effectiveSlot) {
          const fingerIdx = Number(currentCmd.finger_index) || 1;
          const fingerLabel = currentCmd.finger_label || (fingerIdx === 2 ? 'Backup Finger' : 'Primary Finger');
          // Clear any stale/orphan mapping occupying the same hardware slot before upsert
          await FingerprintTemplate.deleteMany({
            device_id: device.device_id,
            slot_id: effectiveSlot,
            $or: [
              { student: { $ne: currentCmd.student } },
              { finger_index: { $ne: fingerIdx } }
            ]
          });
          // Save/update FingerprintTemplate mapping for this (device, student, finger_index)
          await FingerprintTemplate.findOneAndUpdate(
            { device_id: device.device_id, student: currentCmd.student, finger_index: fingerIdx },
            {
              device_id: device.device_id,
              slot_id: effectiveSlot,
              student: currentCmd.student,
              finger_index: fingerIdx,
              finger_label: fingerLabel,
              enrolled_by: currentCmd.enrolled_by || null,
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
        } else if (effectiveAction === 'TRAY_OPEN' || effectiveAction === 'TRAY_SET_OPEN') {
          device.tray_state = 'OPEN';
          device.tray_fault = '';
        } else if (effectiveAction === 'TRAY_CLOSE' || effectiveAction === 'TRAY_SET_CLOSED' || effectiveAction === 'TRAY_HOME') {
          device.tray_state = 'CLOSED';
          device.tray_fault = '';
        } else if (effectiveAction === 'TRAY_STOP') {
          device.tray_state = 'STOPPED';
        }

        device.pending_command.action = 'NONE';
        promotedNext = promoteNextCommand(device);
      } else if (status === 'FAILED') {
        if (['TRAY_OPEN', 'TRAY_CLOSE', 'TRAY_HOME'].includes(effectiveAction)) {
          device.tray_state = 'FAULT';
          device.tray_fault = enrichedMessage || 'Tray limit switch timeout / jam detected';
        }
        device.pending_command.action = 'NONE';
        promotedNext = promoteNextCommand(device);
      }

      await device.save();

      const io = getIO();
      if (io) {
        const enrolledCount = await FingerprintTemplate.countDocuments({ device_id: device.device_id });
        if (String(effectiveAction).startsWith('TRAY_')) {
          io.to('GATE_MONITOR').emit('gate_device_updated', formatDevice(device, enrolledCount, { includeApiKey: false }));
        }
        io.to('GATE_MONITOR').emit('gate_command_update', {
          device_id: device.device_id,
          command_id: command_id || currentCmd.command_id || '',
          action: effectiveAction,
          slot_id: effectiveSlot,
          status,
          step: effectiveStep,
          progress: effectiveProgress,
          message: enrichedMessage,
          student_id: ackStudentId,
          student_name: ackStudentName,
          finger_index: currentCmd.finger_index || 1,
          finger_label: currentCmd.finger_label || 'Primary Finger',
          duplicate_student_name: duplicateStudentName,
          enrolled_count: enrolledCount,
          queue_length: Array.isArray(device.command_queue) ? device.command_queue.length : 0
        });

        if (promotedNext) {
          io.to('GATE_MONITOR').emit('gate_command_update', {
            device_id: device.device_id,
            command_id: device.pending_command.command_id,
            action: device.pending_command.action,
            slot_id: device.pending_command.slot_id,
            status: device.pending_command.status,
            step: device.pending_command.step || '',
            progress: device.pending_command.progress || 0,
            message: device.pending_command.message,
            student_id: device.pending_command.student ? String(device.pending_command.student) : null,
            student_name: device.pending_command.student_name,
            finger_index: device.pending_command.finger_index || 1,
            finger_label: device.pending_command.finger_label || 'Primary Finger',
            enrolled_count: enrolledCount,
            queue_length: device.command_queue.length
          });
        }
      }

      return { httpStatus: 200, body: { success: true, message: 'Command acknowledgement processed' } };
    });

    return res.status(result.httpStatus).json(result.body);
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/biometric/device/sync-slots
// @desc    ESP32 reports occupied hardware slots; backend prunes ghost DB rows & returns orphan R307S slots to erase
// @access  Device (x-device-key)
router.post('/device/sync-slots', authenticateDevice, async (req, res, next) => {
  try {
    const result = await withDeviceLock(req.device.device_id, async () => {
      const device = req.device;
      const rawSlots = Array.isArray(req.body?.hardware_slots) ? req.body.hardware_slots : [];
      const hwSlotSet = new Set(
        rawSlots
          .map(s => Number(s))
          .filter(s => Number.isInteger(s) && s >= 1 && s <= 1000)
      );

      const dbTemplates = await FingerprintTemplate.find({ device_id: device.device_id })
        .populate('student', '_id status')
        .lean();

      const ghostIds = [];
      const validDbSlots = new Set();

      for (const tpl of dbTemplates) {
        if (!tpl.student || !hwSlotSet.has(tpl.slot_id)) {
          ghostIds.push(tpl._id);
        } else {
          validDbSlots.add(tpl.slot_id);
        }
      }

      if (ghostIds.length > 0) {
        await FingerprintTemplate.deleteMany({ _id: { $in: ghostIds } });
      }

      const orphanSlots = [];
      for (const hwSlot of hwSlotSet) {
        if (!validDbSlots.has(hwSlot)) {
          orphanSlots.push(hwSlot);
        }
      }
      orphanSlots.sort((a, b) => a - b);

      await BiometricDevice.updateOne(
        { _id: device._id },
        { $set: { last_heartbeat: new Date(), total_templates: validDbSlots.size } }
      );

      return {
        success: true,
        orphan_slots: orphanSlots,
        ghosts_removed: ghostIds.length,
        valid_count: validDbSlots.size
      };
    });

    res.json(result);
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
    let devices = await BiometricDevice.find().sort({ createdAt: 1 }).lean();

    if (devices.length === 0) {
      const defaultDevice = await BiometricDevice.create({
        device_id: 'GATE-ESP32-01',
        name: 'Main Gate Scanner',
        sensing_enabled: true,
        auto_mark_attendance: true,
        cooldown_seconds: 120
      });
      devices = [defaultDevice.toObject()];
    }

    const includeApiKey = req.user.role === 'SuperAdmin';
    const countsAgg = await FingerprintTemplate.aggregate([
      { $group: { _id: '$device_id', count: { $sum: 1 } } }
    ]);
    const countByDevice = new Map(countsAgg.map(c => [c._id, c.count]));
    const enriched = devices.map(dev =>
      formatDevice(dev, countByDevice.get(dev.device_id) || 0, { includeApiKey })
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
    const { device_id, name } = req.body || {};
    if (!device_id || !String(device_id).trim()) {
      return res.status(400).json({ success: false, message: 'Device ID is required' });
    }

    const cleanId = String(device_id).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (!cleanId) {
      return res.status(400).json({ success: false, message: 'Device ID must contain letters or numbers' });
    }
    const exists = await BiometricDevice.findOne({ device_id: cleanId });
    if (exists) {
      return res.status(400).json({ success: false, message: `Device ${cleanId} already exists` });
    }

    const created = await BiometricDevice.create({
      device_id: cleanId,
      name: (name !== undefined && name !== null && String(name).trim()) || `Gate Scanner ${cleanId}`
    });

    res.status(201).json({ success: true, data: formatDevice(created, 0, { includeApiKey: true }) });
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

    const result = await withDeviceLock(deviceId, async () => {
      const device = await BiometricDevice.findOne({ device_id: deviceId });
      if (!device) {
        return { httpStatus: 404, body: { success: false, message: 'Biometric device not found' } };
      }

      const {
        device_power_on,
        sensing_enabled,
        auto_mark_attendance,
        parent_alerts_enabled,
        cooldown_seconds,
        name,
        pinned_session_name,
        tray_config,
        regenerate_key
      } = req.body || {};

      if (device_power_on !== undefined) device.device_power_on = Boolean(device_power_on);
      if (sensing_enabled !== undefined) device.sensing_enabled = Boolean(sensing_enabled);
      if (auto_mark_attendance !== undefined) device.auto_mark_attendance = Boolean(auto_mark_attendance);
      if (parent_alerts_enabled !== undefined) device.parent_alerts_enabled = Boolean(parent_alerts_enabled);
      if (cooldown_seconds !== undefined) {
        const cd = Number(cooldown_seconds);
        if (Number.isFinite(cd) && cd >= 5 && cd <= 3600) {
          device.cooldown_seconds = Math.round(cd);
        }
      }
      if (name !== undefined && name !== null && String(name).trim()) {
        device.name = String(name).trim();
      }
      if (pinned_session_name !== undefined) {
        device.pinned_session_name = pinned_session_name === null ? '' : String(pinned_session_name).trim();
      }
      if (tray_config && typeof tray_config === 'object') {
        const currentTray = normalizeTrayConfig(device.tray_config);
        device.tray_config = normalizeTrayConfig({ ...currentTray, ...tray_config });
      }
      if (regenerate_key === true && req.user.role === 'SuperAdmin') {
        device.api_key = crypto.randomBytes(24).toString('hex');
      }

      await device.save();

      const enrolledCount = await FingerprintTemplate.countDocuments({ device_id: device.device_id });
      const safeBroadcast = formatDevice(device, enrolledCount, { includeApiKey: false });
      const responsePayload = formatDevice(device, enrolledCount, { includeApiKey: req.user.role === 'SuperAdmin' });

      const io = getIO();
      if (io) {
        io.to('GATE_MONITOR').emit('gate_device_updated', safeBroadcast);
      }

      return {
        httpStatus: 200,
        body: {
          success: true,
          message: `Scanner "${device.name}" updated (Sensing ${device.sensing_enabled ? 'ON' : 'OFF'})`,
          data: responsePayload
        }
      };
    });

    return res.status(result.httpStatus).json(result.body);
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/biometric/devices/:deviceId/enroll
// @desc    Queue remote fingerprint enrollment on ESP32 for a student (supports Primary=1 & Backup=2 fingers)
// @access  Private (SuperAdmin, Teacher)
router.post('/devices/:deviceId/enroll', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const deviceId = String(req.params.deviceId).trim().toUpperCase();
    const { student_id, finger_index = 1, finger_label } = req.body || {};

    if (!student_id) {
      return res.status(400).json({ success: false, message: 'student_id is required' });
    }

    const parsedFinger = Math.floor(Number(finger_index));
    const cleanFingerIdx = Math.min(3, Math.max(1, Number.isFinite(parsedFinger) ? parsedFinger : 1));
    const cleanFingerLabel = (finger_label !== undefined && finger_label !== null && String(finger_label).trim())
      || (cleanFingerIdx === 2 ? 'Backup Finger' : cleanFingerIdx === 3 ? 'Finger #3' : 'Primary Finger');

    const result = await withDeviceLock(deviceId, async () => {
      const [device, student] = await Promise.all([
        BiometricDevice.findOne({ device_id: deviceId }),
        Student.findById(student_id)
      ]);

      if (!device) {
        return { httpStatus: 404, body: { success: false, message: 'Biometric device not found' } };
      }
      if (!student) {
        return { httpStatus: 404, body: { success: false, message: 'Student not found' } };
      }

      if (device.device_power_on === false) {
        return {
          httpStatus: 409,
          body: {
            success: false,
            message: 'Device is currently in Power OFF (Standby) mode. Turn Power ON first before enrolling.'
          }
        };
      }

      if (isActiveCommand(device.pending_command) && ['ENROLL', 'SYNC_SLOTS'].includes(device.pending_command.action)) {
        return {
          httpStatus: 409,
          body: {
            success: false,
            message: `${device.pending_command.action === 'SYNC_SLOTS' ? 'Sensor sync' : `Enrollment for ${device.pending_command.student_name || 'another student'}`} is already in progress. Complete or cancel it first.`
          }
        };
      }

      const existingTemplate = await FingerprintTemplate.findOne({
        device_id: deviceId,
        student: student._id,
        finger_index: cleanFingerIdx
      });
      let targetSlot = existingTemplate?.slot_id || null;

      if (!targetSlot) {
        const usedTemplates = await FingerprintTemplate.find({ device_id: deviceId }).select('slot_id').lean();
        const usedSet = new Set(usedTemplates.map(t => t.slot_id));
        if (isActiveCommand(device.pending_command) && device.pending_command.slot_id) {
          usedSet.add(device.pending_command.slot_id);
        }
        if (Array.isArray(device.command_queue)) {
          device.command_queue.forEach(c => {
            if (c.slot_id) usedSet.add(c.slot_id);
          });
        }
        for (let i = 1; i <= 1000; i++) {
          if (!usedSet.has(i)) {
            targetSlot = i;
            break;
          }
        }
      }

      if (!targetSlot) {
        return { httpStatus: 400, body: { success: false, message: 'R307S sensor memory full (1000/1000 slots used)' } };
      }

      const { queued, command } = enqueueDeviceCommand(device, {
        action: 'ENROLL',
        slot_id: targetSlot,
        student: student._id,
        student_name: student.name,
        finger_index: cleanFingerIdx,
        finger_label: cleanFingerLabel,
        enrolled_by: req.user._id,
        step: 'WAITING_DEVICE',
        progress: 10,
        message: `Waiting for ESP32 to begin enrolling ${student.name} (${cleanFingerLabel}, Slot #${targetSlot})...`
      });

      await device.save();

      const io = getIO();
      if (io) {
        io.to('GATE_MONITOR').emit('gate_command_update', {
          device_id: device.device_id,
          command_id: device.pending_command.command_id,
          action: device.pending_command.action,
          slot_id: device.pending_command.slot_id,
          status: device.pending_command.status,
          step: device.pending_command.step || 'WAITING_DEVICE',
          progress: device.pending_command.progress || 10,
          student_id: device.pending_command.student ? String(device.pending_command.student) : null,
          student_name: device.pending_command.student_name,
          finger_index: device.pending_command.finger_index || cleanFingerIdx,
          finger_label: device.pending_command.finger_label || cleanFingerLabel,
          message: device.pending_command.message,
          queue_length: device.command_queue.length
        });
      }

      return {
        httpStatus: 200,
        body: {
          success: true,
          message: queued
            ? `Enrollment queued behind ${device.command_queue.length} pending command(s) for ${student.name} (${cleanFingerLabel}, Slot #${targetSlot}).`
            : `Enrollment queued for ${student.name} (${cleanFingerLabel}, Slot #${targetSlot}). Follow instructions on the ESP32 OLED screen.`,
          data: {
            slot_id: targetSlot,
            student_name: student.name,
            finger_index: cleanFingerIdx,
            finger_label: cleanFingerLabel,
            queued,
            queue_length: device.command_queue.length,
            pending_command: command
          }
        }
      };
    });

    return res.status(result.httpStatus).json(result.body);
  } catch (error) {
    next(error);
  }
});

// @route   DELETE /api/biometric/devices/:deviceId/templates/:studentId
// @desc    Remove student's fingerprint mapping(s) (optional ?slot_id= or ?finger_index=) and queue DELETE on ESP32 R307S
// @access  Private (SuperAdmin, Teacher)
router.delete('/devices/:deviceId/templates/:studentId', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const deviceId = String(req.params.deviceId).trim().toUpperCase();
    const { studentId } = req.params;
    const { slot_id, finger_index } = req.query;

    const result = await withDeviceLock(deviceId, async () => {
      const device = await BiometricDevice.findOne({ device_id: deviceId });
      if (!device) {
        return { httpStatus: 404, body: { success: false, message: 'Biometric device not found' } };
      }

      const filter = { device_id: deviceId, student: studentId };
      if (slot_id !== undefined && Number.isInteger(Number(slot_id))) {
        filter.slot_id = Number(slot_id);
      } else if (finger_index !== undefined && Number.isInteger(Number(finger_index))) {
        filter.finger_index = Number(finger_index);
      }

      const templatesToRemove = await FingerprintTemplate.find(filter).populate('student', 'name');
      if (templatesToRemove.length === 0) {
        return { httpStatus: 404, body: { success: false, message: 'Student has no matching enrolled fingerprint on this device' } };
      }

      const studentName = templatesToRemove[0].student?.name || 'Student';
      await FingerprintTemplate.deleteMany({ _id: { $in: templatesToRemove.map(t => t._id) } });

      for (const tpl of templatesToRemove) {
        enqueueDeviceCommand(device, {
          action: 'DELETE',
          slot_id: tpl.slot_id,
          student: null,
          student_name: studentName,
          finger_index: tpl.finger_index || 1,
          finger_label: tpl.finger_label || 'Primary Finger',
          message: `Deleting Slot #${tpl.slot_id} (${studentName}) from R307S sensor...`
        });
      }
      await device.save();

      const io = getIO();
      if (io) {
        io.to('GATE_MONITOR').emit('gate_command_update', {
          device_id: device.device_id,
          command_id: device.pending_command.command_id,
          action: device.pending_command.action,
          slot_id: device.pending_command.slot_id,
          status: device.pending_command.status,
          student_name: device.pending_command.student_name,
          message: device.pending_command.message,
          queue_length: device.command_queue.length
        });
      }

      const slotList = templatesToRemove.map(t => `#${t.slot_id}`).join(', ');
      return {
        httpStatus: 200,
        body: {
          success: true,
          message: `Removed fingerprint ${slotList} for ${studentName}. Sensor erase queued.`
        }
      };
    });

    return res.status(result.httpStatus).json(result.body);
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/biometric/devices/:deviceId/sync-slots
// @desc    Queue SYNC_SLOTS audit/repair command on ESP32 to reconcile R307S flash with MongoDB
// @access  Private (SuperAdmin, Teacher)
router.post('/devices/:deviceId/sync-slots', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const deviceId = String(req.params.deviceId).trim().toUpperCase();

    const result = await withDeviceLock(deviceId, async () => {
      const device = await BiometricDevice.findOne({ device_id: deviceId });
      if (!device) {
        return { httpStatus: 404, body: { success: false, message: 'Biometric device not found' } };
      }

      if (isActiveCommand(device.pending_command) && device.pending_command.action === 'ENROLL') {
        return {
          httpStatus: 409,
          body: {
            success: false,
            message: `Finish or cancel the active enrollment for ${device.pending_command.student_name || 'student'} before running Sensor Sync.`
          }
        };
      }

      const { command } = enqueueDeviceCommand(device, {
        action: 'SYNC_SLOTS',
        slot_id: null,
        student: null,
        student_name: 'Sensor Memory Audit',
        step: 'WAITING_DEVICE',
        progress: 15,
        message: 'Waiting for ESP32 to scan R307S memory table & reconcile with database...'
      });
      await device.save();

      const io = getIO();
      if (io) {
        io.to('GATE_MONITOR').emit('gate_command_update', {
          device_id: device.device_id,
          command_id: device.pending_command.command_id,
          action: device.pending_command.action,
          slot_id: null,
          status: device.pending_command.status,
          step: device.pending_command.step || 'WAITING_DEVICE',
          progress: device.pending_command.progress || 15,
          student_name: device.pending_command.student_name,
          message: device.pending_command.message,
          queue_length: device.command_queue.length
        });
      }

      return {
        httpStatus: 200,
        body: {
          success: true,
          message: 'Sensor Sync & Repair queued. ESP32 will audit all 1,000 slots on its next heartbeat.',
          data: { pending_command: command }
        }
      };
    });

    return res.status(result.httpStatus).json(result.body);
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/biometric/devices/:deviceId/tray-command
// @desc    Queue a remote motorized tray action (open, close, home, stop, nudge, or sync NVS state without moving)
// @access  Private (SuperAdmin, Teacher)
router.post('/devices/:deviceId/tray-command', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const deviceId = String(req.params.deviceId).trim().toUpperCase();
    const allowedTrayActions = new Set([
      'TRAY_OPEN',
      'TRAY_CLOSE',
      'TRAY_STOP',
      'TRAY_HOME',
      'TRAY_NUDGE_OPEN',
      'TRAY_NUDGE_CLOSE',
      'TRAY_SET_OPEN',
      'TRAY_SET_CLOSED'
    ]);

    const rawAction = String(req.body?.action || '').trim().toUpperCase();
    if (!allowedTrayActions.has(rawAction)) {
      return res.status(400).json({ success: false, message: 'Invalid tray action requested' });
    }

    const isNudge = rawAction === 'TRAY_NUDGE_OPEN' || rawAction === 'TRAY_NUDGE_CLOSE';
    const nudgeMs = isNudge ? clampInt(req.body?.duration_ms, 50, 3000, 200) : null;

    const labelMap = {
      TRAY_OPEN: 'Extending scanner tray on ESP32...',
      TRAY_CLOSE: 'Retracting scanner tray on ESP32...',
      TRAY_STOP: 'Sending EMERGENCY STOP to scanner tray...',
      TRAY_HOME: 'Homing scanner tray to CLOSED limit switch...',
      TRAY_NUDGE_OPEN: `Nudging scanner tray OUT (${nudgeMs}ms)...`,
      TRAY_NUDGE_CLOSE: `Nudging scanner tray IN (${nudgeMs}ms)...`,
      TRAY_SET_OPEN: 'Syncing ESP32 saved tray state to OPEN (no motor motion)...',
      TRAY_SET_CLOSED: 'Syncing ESP32 saved tray state to CLOSED (no motor motion)...'
    };

    const result = await withDeviceLock(deviceId, async () => {
      const device = await BiometricDevice.findOne({ device_id: deviceId });
      if (!device) {
        return { httpStatus: 404, body: { success: false, message: 'Biometric device not found' } };
      }

      if (rawAction !== 'TRAY_STOP' && isActiveCommand(device.pending_command) && ['ENROLL', 'SYNC_SLOTS'].includes(device.pending_command.action)) {
        return {
          httpStatus: 409,
          body: {
            success: false,
            message: `Finish or cancel the active ${device.pending_command.action} before running a tray command.`
          }
        };
      }

      let command;
      if (rawAction === 'TRAY_STOP') {
        // Emergency stop preempts any pending tray commands immediately
        device.command_queue = (device.command_queue || []).filter(c => !String(c.action || '').startsWith('TRAY_'));
        device.pending_command = buildCommandPayload({
          action: 'TRAY_STOP',
          slot_id: null,
          student: null,
          student_name: 'Motorized Tray',
          step: 'STOPPING',
          progress: 50,
          message: labelMap.TRAY_STOP
        });
        command = device.pending_command;
      } else {
        const enqueued = enqueueDeviceCommand(device, {
          action: rawAction,
          slot_id: nudgeMs,
          student: null,
          student_name: 'Motorized Tray',
          step: 'WAITING_DEVICE',
          progress: 20,
          message: labelMap[rawAction]
        });
        command = enqueued.command;
      }
      await device.save();

      const io = getIO();
      if (io) {
        io.to('GATE_MONITOR').emit('gate_command_update', {
          device_id: device.device_id,
          command_id: device.pending_command.command_id,
          action: device.pending_command.action,
          slot_id: device.pending_command.slot_id,
          status: device.pending_command.status,
          step: device.pending_command.step || 'WAITING_DEVICE',
          progress: device.pending_command.progress || 20,
          student_name: device.pending_command.student_name,
          message: device.pending_command.message,
          queue_length: device.command_queue.length
        });
      }

      return {
        httpStatus: 200,
        body: {
          success: true,
          message: labelMap[rawAction],
          data: { pending_command: command }
        }
      };
    });

    return res.status(result.httpStatus).json(result.body);
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/biometric/devices/:deviceId/reboot
// @desc    Queue remote ESP32 software reboot command
// @access  Private (SuperAdmin, Teacher)
router.post('/devices/:deviceId/reboot', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const deviceId = String(req.params.deviceId).trim().toUpperCase();

    const result = await withDeviceLock(deviceId, async () => {
      const device = await BiometricDevice.findOne({ device_id: deviceId });
      if (!device) {
        return { httpStatus: 404, body: { success: false, message: 'Biometric device not found' } };
      }

      device.command_queue = [];
      device.pending_command = buildCommandPayload({
        action: 'REBOOT',
        slot_id: null,
        student: null,
        student_name: device.name || device.device_id,
        step: 'REBOOTING',
        progress: 50,
        message: 'Sending remote reboot command to ESP32...'
      });
      await device.save();

      const io = getIO();
      if (io) {
        io.to('GATE_MONITOR').emit('gate_command_update', {
          device_id: device.device_id,
          command_id: device.pending_command.command_id,
          action: 'REBOOT',
          slot_id: null,
          status: 'PENDING',
          step: 'REBOOTING',
          progress: 50,
          student_name: device.pending_command.student_name,
          message: device.pending_command.message,
          queue_length: 0
        });
      }

      return {
        httpStatus: 200,
        body: {
          success: true,
          message: 'Remote reboot queued — ESP32 will restart within a few seconds.',
          data: { pending_command: device.pending_command }
        }
      };
    });

    return res.status(result.httpStatus).json(result.body);
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/biometric/devices/:deviceId/clear-all
// @desc    Queue CLEAR_ALL command to erase all stored prints on R307S sensor & DB mappings
// @access  Private (SuperAdmin only)
router.post('/devices/:deviceId/clear-all', protect, authorize('SuperAdmin'), async (req, res, next) => {
  try {
    const deviceId = String(req.params.deviceId).trim().toUpperCase();

    const result = await withDeviceLock(deviceId, async () => {
      const device = await BiometricDevice.findOne({ device_id: deviceId });
      if (!device) {
        return { httpStatus: 404, body: { success: false, message: 'Biometric device not found' } };
      }

      await FingerprintTemplate.deleteMany({ device_id: deviceId });
      device.command_queue = [];
      device.pending_command = buildCommandPayload({
        action: 'CLEAR_ALL',
        slot_id: null,
        student: null,
        student_name: 'All Templates',
        message: 'Erasing all fingerprints from R307S sensor memory...'
      });
      await device.save();

      const io = getIO();
      if (io) {
        io.to('GATE_MONITOR').emit('gate_command_update', {
          device_id: device.device_id,
          command_id: device.pending_command.command_id,
          action: 'CLEAR_ALL',
          slot_id: null,
          status: 'PENDING',
          student_name: 'All Templates',
          message: device.pending_command.message,
          enrolled_count: 0,
          queue_length: 0
        });
      }

      return {
        httpStatus: 200,
        body: {
          success: true,
          message: 'CLEAR_ALL queued. ESP32 will erase all stored prints on its next heartbeat.',
          data: { pending_command: device.pending_command }
        }
      };
    });

    return res.status(result.httpStatus).json(result.body);
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/biometric/devices/:deviceId/cancel-command
// @desc    Cancel active pending/stuck enrollment or delete command (promotes next queued command unless clear_queue=true)
// @access  Private (SuperAdmin, Teacher)
router.post('/devices/:deviceId/cancel-command', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const deviceId = String(req.params.deviceId).trim().toUpperCase();

    const result = await withDeviceLock(deviceId, async () => {
      const device = await BiometricDevice.findOne({ device_id: deviceId });
      if (!device) {
        return { httpStatus: 404, body: { success: false, message: 'Biometric device not found' } };
      }

      if (req.body?.clear_queue === true) {
        device.command_queue = [];
      }

      device.pending_command = {
        command_id: '',
        action: 'NONE',
        slot_id: null,
        student: null,
        student_name: '',
        status: 'IDLE',
        message: 'Cancelled by user',
        requested_at: null,
        updated_at: new Date()
      };

      const promoted = promoteNextCommand(device);
      await device.save();

      const io = getIO();
      if (io) {
        io.to('GATE_MONITOR').emit('gate_command_update', promoted ? {
          device_id: device.device_id,
          command_id: device.pending_command.command_id,
          action: device.pending_command.action,
          slot_id: device.pending_command.slot_id,
          status: device.pending_command.status,
          student_name: device.pending_command.student_name,
          message: device.pending_command.message,
          queue_length: device.command_queue.length
        } : {
          device_id: device.device_id,
          command_id: '',
          action: 'NONE',
          slot_id: null,
          status: 'IDLE',
          message: 'Cancelled by user',
          queue_length: 0
        });
      }

      return {
        httpStatus: 200,
        body: {
          success: true,
          message: promoted ? 'Active command cancelled; next queued command started.' : 'Pending command cleared'
        }
      };
    });

    return res.status(result.httpStatus).json(result.body);
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
    const targetDate = typeof date === 'string' && date.trim() ? date.trim().split('T')[0] : ist.dateStr;

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
      if (typeof date === 'string' && date.trim()) {
        query.date = targetDate;
      }
    } else {
      query.date = targetDate;
      if (typeof event_type === 'string' && ['ENTRY', 'EXIT'].includes(event_type)) {
        query.event_type = event_type;
      }
    }

    const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 200));

    // Push class & search filters into MongoDB before .limit() for accurate pagination & speed
    if (req.user.role !== 'Student') {
      const studentFilter = {};
      if (typeof class_level === 'string' && class_level.trim() && class_level !== 'All') {
        studentFilter.class_level = class_level.trim().toUpperCase();
      }
      if (typeof search === 'string' && search.trim()) {
        const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        studentFilter.$or = [
          { name: { $regex: escaped, $options: 'i' } },
          { roll_number: { $regex: escaped, $options: 'i' } }
        ];
      }
      if (Object.keys(studentFilter).length > 0) {
        const matchingStudents = await Student.find(studentFilter).select('_id').lean();
        query.student = { $in: matchingStudents.map(s => s._id) };
      }
    }

    const statsQuery = req.user.role === 'Student'
      ? { student: req.user.studentProfile, date: targetDate }
      : { date: targetDate };

    // Execute log fetch and lean daily stats scan in parallel
    const [logs, dayLogs] = await Promise.all([
      GateEntryLog.find(query)
        .populate('student', 'name roll_number class_level parent_name primary_contact')
        .sort({ timestamp: -1 })
        .limit(limitNum)
        .lean(),
      GateEntryLog.find(statsQuery)
        .select('student event_type attendance_marked')
        .sort({ timestamp: 1 })
        .lean()
    ]);

    let entriesToday = 0;
    let exitsToday = 0;
    let attendanceSynced = 0;
    const latestStateByStudent = new Map();

    dayLogs.forEach(l => {
      if (l.event_type === 'ENTRY') entriesToday++;
      if (l.event_type === 'EXIT') exitsToday++;
      if (l.attendance_marked) attendanceSynced++;
      if (l.student) latestStateByStudent.set(l.student.toString(), l.event_type);
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
