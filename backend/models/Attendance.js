import mongoose from 'mongoose';

const attendanceRecordSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  status: {
    type: String,
    enum: ['Present', 'Absent', 'Late', 'Excused'],
    default: 'Present',
    required: true
  },
  remarks: {
    type: String,
    default: ''
  }
}, { _id: false });

const attendanceSchema = new mongoose.Schema({
  class_level: {
    type: String,
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  records: [attendanceRecordSchema]
}, {
  timestamps: true
});

// Ensure a single class can only have one attendance sheet logged per day
attendanceSchema.index({ class_level: 1, date: 1 }, { unique: true });

export default mongoose.model('Attendance', attendanceSchema);
