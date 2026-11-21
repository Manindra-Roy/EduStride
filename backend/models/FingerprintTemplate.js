import mongoose from 'mongoose';

const fingerprintTemplateSchema = new mongoose.Schema({
  device_id: {
    type: String,
    required: true,
    trim: true,
    uppercase: true
  },
  slot_id: {
    type: Number,
    required: true,
    min: 1,
    max: 1000
  },
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  finger_index: {
    type: Number,
    default: 1,
    min: 1,
    max: 3
  },
  finger_label: {
    type: String,
    default: 'Primary Finger',
    trim: true
  },
  enrolled_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  enrolled_at: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

fingerprintTemplateSchema.index({ device_id: 1, slot_id: 1 }, { unique: true });
fingerprintTemplateSchema.index({ device_id: 1, student: 1, finger_index: 1 }, { unique: true });

const FingerprintTemplate = mongoose.model('FingerprintTemplate', fingerprintTemplateSchema);

// Automatically migrate legacy { device_id: 1, student: 1 } unique index to multi-finger index
FingerprintTemplate.syncIndexes().catch(err => {
  console.log('[FingerprintTemplate Index Sync]:', err.message);
});

export default FingerprintTemplate;
