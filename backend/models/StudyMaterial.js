import mongoose from 'mongoose';

const studyMaterialSchema = new mongoose.Schema({
  class_level: {
    type: String,
    required: true
  },
  subject: {
    type: String,
    required: true
  },
  chapter_name: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['Drafting', 'Notes Distributed', 'Assignment Assigned', 'Revised'],
    default: 'Drafting'
  },
  file_url: {
    type: String,
    required: true
  },
  file_name: {
    type: String,
    required: true
  },
  uploaded_at: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

studyMaterialSchema.index({ class_level: 1, subject: 1, uploaded_at: -1 });

export default mongoose.model('StudyMaterial', studyMaterialSchema);
