import mongoose from 'mongoose';
import crypto from 'crypto';

const pendingCommandSchema = new mongoose.Schema({
  action: {
    type: String,
    enum: ['NONE', 'ENROLL', 'DELETE', 'CLEAR_ALL'],
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
  status: {
    type: String,
    enum: ['IDLE', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED'],
    default: 'IDLE'
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
  auto_mark_attendance: {
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
    default: () => ({ action: 'NONE', status: 'IDLE' })
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
  }
}, {
  timestamps: true
});

export default mongoose.model('BiometricDevice', biometricDeviceSchema);
