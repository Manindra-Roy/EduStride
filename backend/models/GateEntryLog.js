import mongoose from 'mongoose';

const gateEntryLogSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  device_id: {
    type: String,
    required: true,
    trim: true,
    uppercase: true
  },
  slot_id: {
    type: Number,
    default: null
  },
  date: {
    type: String, // YYYY-MM-DD in IST
    required: true
  },
  event_type: {
    type: String,
    enum: ['ENTRY', 'EXIT'],
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  paired_entry_time: {
    type: Date,
    default: null
  },
  duration_minutes: {
    type: Number,
    default: null
  },
  attendance_marked: {
    type: Boolean,
    default: false
  },
  attendance_session: {
    type: String,
    default: ''
  },
  notification: {
    email_sent: { type: Boolean, default: false },
    email_to: { type: String, default: '' },
    email_error: { type: String, default: '' },
    push_sent: { type: Boolean, default: false },
    sms_sent: { type: Boolean, default: false },
    whatsapp_link: { type: String, default: '' }
  }
}, {
  timestamps: true
});

gateEntryLogSchema.index({ date: -1, timestamp: -1 });
gateEntryLogSchema.index({ student: 1, date: 1, timestamp: -1 });

export default mongoose.model('GateEntryLog', gateEntryLogSchema);
