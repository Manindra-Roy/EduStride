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
  session_name: {
    type: String,
    default: 'Session 1',
    required: true
  },
  records: [attendanceRecordSchema]
}, {
  timestamps: true
});

// Ensure a single class can log multiple sessions per day (e.g., Session 1, Session 2)
// but prevents duplicate logging for the exact same session name on the same day
attendanceSchema.index({ class_level: 1, date: 1, session_name: 1 }, { unique: true });

const Attendance = mongoose.model('Attendance', attendanceSchema);

// Sync indexes to automatically migrate old index { class_level: 1, date: 1 } to { class_level: 1, date: 1, session_name: 1 }
Attendance.syncIndexes().catch(err => {
  console.log('[Attendance Index Sync]:', err.message);
});

export default Attendance;
