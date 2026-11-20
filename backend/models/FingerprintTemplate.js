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
fingerprintTemplateSchema.index({ device_id: 1, student: 1 }, { unique: true });

export default mongoose.model('FingerprintTemplate', fingerprintTemplateSchema);
