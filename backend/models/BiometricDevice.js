import mongoose from 'mongoose';
import crypto from 'crypto';

const pendingCommandSchema = new mongoose.Schema({
  command_id: {
    type: String,
    default: ''
  },
  action: {
    type: String,
    enum: [
      'NONE',
      'ENROLL',
      'DELETE',
      'CLEAR_ALL',
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
    ],
    default: 'NONE'
  },
  slot_id: {
    type: Number,
    default: null
  },
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    default: null
  },
  student_name: {
    type: String,
    default: ''
  },
  finger_index: {
    type: Number,
    default: 1
  },
  finger_label: {
    type: String,
    default: 'Primary Finger'
  },
  enrolled_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  status: {
    type: String,
    enum: ['IDLE', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED'],
    default: 'IDLE'
  },
  step: {
    type: String,
    default: ''
  },
  progress: {
    type: Number,
    default: 0
  },
  message: {
    type: String,
    default: ''
  },
  requested_at: {
    type: Date,
    default: null
  },
  updated_at: {
    type: Date,
    default: null
  }
}, { _id: false });

const biometricDeviceSchema = new mongoose.Schema({
  device_id: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true
  },
  name: {
    type: String,
    default: 'Main Gate Scanner',
    trim: true
  },
  api_key: {
    type: String,
    required: true,
    default: () => crypto.randomBytes(24).toString('hex')
  },
  sensing_enabled: {
    type: Boolean,
    default: true
  },
  device_power_on: {
    type: Boolean,
    default: true
  },
  auto_mark_attendance: {
    type: Boolean,
    default: true
  },
  parent_alerts_enabled: {
    type: Boolean,
    default: true
  },
  cooldown_seconds: {
    type: Number,
    default: 120,
    min: 5,
    max: 3600
  },
  pinned_session_name: {
    type: String,
    default: ''
  },
  pending_command: {
    type: pendingCommandSchema,
    default: () => ({ command_id: '', action: 'NONE', status: 'IDLE' })
  },
  command_queue: {
    type: [pendingCommandSchema],
    default: []
  },
  last_heartbeat: {
    type: Date,
    default: null
  },
  ip_address: {
    type: String,
    default: ''
  },
  firmware_version: {
    type: String,
    default: ''
  },
  total_templates: {
    type: Number,
    default: 0
  },
  tray_config: {
    enabled: { type: Boolean, default: true },
    mode: {
      type: String,
      enum: ['LIMIT_360', 'TIMED_360', 'ANGLE_180'],
      default: 'LIMIT_360'
    },
    invert_direction: { type: Boolean, default: false },
    speed_pct: { type: Number, default: 80, min: 20, max: 100 },
    stop_us: { type: Number, default: 1500, min: 1350, max: 1650 },
    open_ms: { type: Number, default: 1060, min: 100, max: 8000 },
    close_ms: { type: Number, default: 1060, min: 100, max: 8000 },
    closed_angle: { type: Number, default: 10, min: 0, max: 180 },
    open_angle: { type: Number, default: 110, min: 0, max: 180 },
    sweep_speed_dps: { type: Number, default: 120, min: 30, max: 360 },
    max_run_ms: { type: Number, default: 4500, min: 500, max: 15000 },
    auto_home_on_boot: { type: Boolean, default: false }
  },
  tray_state: {
    type: String,
    enum: ['UNKNOWN', 'CLOSED', 'OPEN', 'EXTENDING', 'RETRACTING', 'HOMING', 'STOPPED', 'FAULT', 'EXTENDED', 'RETRACTED'],
    default: 'UNKNOWN'
  },
  tray_fault: {
    type: String,
    default: ''
  },
  tray_switches: {
    closed: { type: Boolean, default: false },
    open: { type: Boolean, default: false }
  }
}, {
  timestamps: true
});

export default mongoose.model('BiometricDevice', biometricDeviceSchema);
