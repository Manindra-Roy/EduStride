import BiometricDevice from '../models/BiometricDevice.js';
import GateEntryLog from '../models/GateEntryLog.js';
import FingerprintTemplate from '../models/FingerprintTemplate.js';
import { getIO } from '../config/socket.js';

const ONLINE_THRESHOLD_MS = 30000;
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

const formatDeviceForBroadcast = (doc, enrolledCount = null) => {
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  delete obj.api_key;
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
  return obj;
};

let deviceStream = null;
let logStream = null;
let stopped = false;
const reconnectTimers = new Set();

const lastDeviceSig = new Map();
const lastCmdSig = new Map();
const recentLogBroadcasts = new Map();

const roomHasListeners = (io, roomName) => {
  if (!io || !roomName) return false;
  return (io.sockets?.adapter?.rooms?.get(roomName)?.size || 0) > 0;
};

const rememberLogBroadcast = (key) => {
  const now = Date.now();
  if (recentLogBroadcasts.size > 500) {
    for (const [k, ts] of recentLogBroadcasts.entries()) {
      if (now - ts > 60000) recentLogBroadcasts.delete(k);
    }
  }
  recentLogBroadcasts.set(key, now);
};

const startDeviceWatcher = (backoffMs = 3000) => {
  if (stopped) return;
  try {
    deviceStream = BiometricDevice.watch(
      [{ $match: { operationType: { $in: ['update', 'replace'] } } }],
      { fullDocument: 'updateLookup' }
    );

    deviceStream.on('change', async (change) => {
      try {
        const io = getIO();
        if (!roomHasListeners(io, 'GATE_MONITOR')) return;

        const doc = change.fullDocument;
        if (!doc || !doc.device_id) return;

        const updatedKeys = Object.keys(change.updateDescription?.updatedFields || {});
        const pendingCmdTouched =
          change.operationType === 'replace' ||
          updatedKeys.some((k) => k === 'pending_command' || k.startsWith('pending_command.') || k === 'command_queue');

        const safeDevice = formatDeviceForBroadcast(doc);
        const deviceSig = JSON.stringify({
          online: safeDevice.is_online,
          power: safeDevice.device_power_on,
          sensing: safeDevice.sensing_enabled,
          tray: safeDevice.tray_state,
          sw: safeDevice.tray_switches,
          fault: safeDevice.tray_fault,
          fw: safeDevice.firmware_version,
          ip: safeDevice.ip_address,
          tpl: safeDevice.total_templates,
          q: safeDevice.queue_length,
          cfg: safeDevice.tray_config,
          autoAtt: safeDevice.auto_mark_attendance,
          alerts: safeDevice.parent_alerts_enabled,
          cd: safeDevice.cooldown_seconds,
          pin: safeDevice.pinned_session_name
        });

        const prevDeviceSig = lastDeviceSig.get(doc.device_id);
        if (prevDeviceSig !== deviceSig) {
          lastDeviceSig.set(doc.device_id, deviceSig);
          io.to('GATE_MONITOR').emit('gate_device_updated', safeDevice);
        }

        if (pendingCmdTouched && doc.pending_command) {
          const cmd = doc.pending_command;
          const cmdSig = `${doc.device_id}|${cmd.command_id || ''}|${cmd.action || ''}|${cmd.status || ''}|${cmd.step || ''}|${cmd.progress ?? ''}|${cmd.message || ''}|${safeDevice.queue_length}`;
          if (lastCmdSig.get(doc.device_id) !== cmdSig) {
            lastCmdSig.set(doc.device_id, cmdSig);
            const enrolledCount = await FingerprintTemplate.countDocuments({ device_id: doc.device_id }).catch(() => null);
            io.to('GATE_MONITOR').emit('gate_command_update', {
              device_id: doc.device_id,
              command_id: cmd.command_id || '',
              action: cmd.action || 'NONE',
              slot_id: cmd.slot_id ?? null,
              status: cmd.status || 'IDLE',
              step: cmd.step || '',
              progress: cmd.progress || 0,
              message: cmd.message || '',
              student_id: cmd.student ? String(cmd.student) : null,
              student_name: cmd.student_name || '',
              finger_index: cmd.finger_index || 1,
              finger_label: cmd.finger_label || 'Primary Finger',
              ...(enrolledCount !== null ? { enrolled_count: enrolledCount } : {}),
              queue_length: safeDevice.queue_length
            });
          }
        }
      } catch (err) {
        console.error('[BiometricSync] Device change handler error:', err.message);
      }
    });

    deviceStream.on('error', (err) => {
      deviceStream = null;
      if (stopped) return;
      if (err?.code === 40573 || /replica set/i.test(err?.message || '')) {
        console.warn('[BiometricSync] MongoDB Change Streams unavailable (non-replica-set); skipping cross-instance device sync.');
        return;
      }
      console.warn(`[BiometricSync] Device change stream error (${err.message}); retrying in ${backoffMs}ms`);
      const timer = setTimeout(() => {
        reconnectTimers.delete(timer);
        startDeviceWatcher(Math.min(backoffMs * 2, 30000));
      }, backoffMs);
      if (typeof timer.unref === 'function') timer.unref();
      reconnectTimers.add(timer);
    });
  } catch (err) {
    console.warn('[BiometricSync] Unable to start device change stream:', err.message);
  }
};

const startGateLogWatcher = (backoffMs = 3000) => {
  if (stopped) return;
  try {
    logStream = GateEntryLog.watch(
      [{ $match: { operationType: { $in: ['insert', 'update'] } } }],
      { fullDocument: 'updateLookup' }
    );

    logStream.on('change', async (change) => {
      try {
        const io = getIO();
        if (!io) return;

        const doc = change.fullDocument;
        if (!doc || !doc._id) return;

        const studentId = doc.student ? String(doc.student) : '';
        const hasStaff = roomHasListeners(io, 'GATE_MONITOR');
        const hasStudent = studentId ? roomHasListeners(io, `USER_${studentId}`) : false;
        if (!hasStaff && !hasStudent) return;

        const notifSig = doc.notification
          ? `${doc.notification.paused ? 1 : 0}:${doc.notification.email_sent ? 1 : 0}:${doc.notification.push_sent ? 1 : 0}:${doc.notification.sms_sent ? 1 : 0}`
          : 'init';
        const dedupeKey = `${String(doc._id)}|${notifSig}`;
        if (recentLogBroadcasts.has(dedupeKey)) return;
        rememberLogBroadcast(dedupeKey);

        const populatedLog = await GateEntryLog.findById(doc._id)
          .populate('student', 'name roll_number class_level parent_name primary_contact')
          .lean();
        if (!populatedLog) return;

        if (hasStaff && hasStudent) {
          io.to('GATE_MONITOR').to(`USER_${studentId}`).emit('gate_scan_event', populatedLog);
        } else if (hasStaff) {
          io.to('GATE_MONITOR').emit('gate_scan_event', populatedLog);
        } else if (hasStudent) {
          io.to(`USER_${studentId}`).emit('gate_scan_event', populatedLog);
        }
      } catch (err) {
        console.error('[BiometricSync] GateEntryLog change handler error:', err.message);
      }
    });

    logStream.on('error', (err) => {
      logStream = null;
      if (stopped) return;
      if (err?.code === 40573 || /replica set/i.test(err?.message || '')) {
        console.warn('[BiometricSync] MongoDB Change Streams unavailable (non-replica-set); skipping cross-instance scan sync.');
        return;
      }
      console.warn(`[BiometricSync] GateEntryLog change stream error (${err.message}); retrying in ${backoffMs}ms`);
      const timer = setTimeout(() => {
        reconnectTimers.delete(timer);
        startGateLogWatcher(Math.min(backoffMs * 2, 30000));
      }, backoffMs);
      if (typeof timer.unref === 'function') timer.unref();
      reconnectTimers.add(timer);
    });
  } catch (err) {
    console.warn('[BiometricSync] Unable to start GateEntryLog change stream:', err.message);
  }
};

/**
 * Keeps local and cloud EduStride backend instances synchronized in real time via MongoDB
 * Atlas Change Streams so both http://localhost:3000 and https://edustride.in receive live
 * ESP32 heartbeats, scans, tray states, and command updates regardless of which backend the
 * ESP32 is currently connected to.
 */
export const initBiometricRealtimeSync = () => {
  stopped = false;
  startDeviceWatcher(3000);
  startGateLogWatcher(3000);
  console.log('[BiometricSync] Cross-instance MongoDB Change Stream sync active.');
};

export const closeBiometricRealtimeSync = async () => {
  stopped = true;
  for (const timer of reconnectTimers) {
    clearTimeout(timer);
  }
  reconnectTimers.clear();
  const closers = [];
  if (deviceStream) {
    closers.push(deviceStream.close().catch(() => {}));
    deviceStream = null;
  }
  if (logStream) {
    closers.push(logStream.close().catch(() => {}));
    logStream = null;
  }
  await Promise.all(closers);
};
