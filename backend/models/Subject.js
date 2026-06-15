import mongoose from 'mongoose';

const subjectSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  class_level: {
    type: String,
    required: true,
    trim: true
  }
}, {
  timestamps: true
});

// Compound index to ensure uniqueness of subject names per class
subjectSchema.index({ name: 1, class_level: 1 }, { unique: true });

export default mongoose.model('Subject', subjectSchema);
