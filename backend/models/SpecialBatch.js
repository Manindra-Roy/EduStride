import mongoose from 'mongoose';

const extraLessonSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  subject: {
    type: String,
    default: ''
  },
  chapter_name: {
    type: String,
    default: ''
  },
  content: {
    type: String,
    trim: true
  },
  file_url: {
    type: String,
    default: ''
  },
  filename: {
    type: String,
    default: ''
  },
  filesize: {
    type: String,
    default: ''
  },
  workflow_stage: {
    type: String,
    enum: ['Drafting', 'Notes Distributed', 'Assignment Assigned', 'Revised'],
    default: 'Notes Distributed'
  },
  date: {
    type: Date,
    default: Date.now
  }
});

const attendanceRecordSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true
  },
  session_name: {
    type: String,
    default: 'Session 1'
  },
  records: [{
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: true
    },
    status: {
      type: String,
      enum: ['Present', 'Absent', 'Late', 'Excused'],
      default: 'Present'
    },
    remarks: {
      type: String,
      default: ''
    }
  }]
});

const batchTestScoreSchema = new mongoose.Schema({
  test_name: {
    type: String,
    required: true,
    trim: true
  },
  subject: {
    type: String,
    default: ''
  },
  date: {
    type: Date,
    default: Date.now
  },
  total_marks: {
    type: Number,
    required: true,
    default: 100
  },
  passing_marks: {
    type: Number,
    default: 40
  },
  scores: [{
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: true
    },
    marks_obtained: {
      type: Number,
      required: true,
      default: 0
    }
  }]
});

const scheduleSlotSchema = new mongoose.Schema({
  day: {
    type: String,
    required: true,
    enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  },
  period_name: {
    type: String,
    default: 'Period 1'
  },
  subject: {
    type: String,
    default: ''
  },
  instructor_name: {
    type: String,
    default: ''
  },
  start_time: {
    type: String,
    required: true
  },
  end_time: {
    type: String,
    required: true
  },
  room: {
    type: String,
    default: 'Extra Room'
  }
});

const specialBatchSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  subject: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true,
    default: ''
  },
  instructor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  students: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student'
  }],
  batch_fee: {
    type: Number,
    default: 0
  },
  schedule: [scheduleSlotSchema],
  extra_lessons: [extraLessonSchema],
  attendance_records: [attendanceRecordSchema],
  test_scores: [batchTestScoreSchema],
  status: {
    type: String,
    enum: ['Active', 'Completed', 'Archived'],
    default: 'Active'
  },
  created_at: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.model('SpecialBatch', specialBatchSchema);
