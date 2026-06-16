import mongoose from 'mongoose';

const attendanceHistorySchema = new mongoose.Schema({
  month: {
    type: String, // format: 'YYYY-MM'
    required: true
  },
  total_classes: {
    type: Number,
    required: true,
    default: 0
  },
  attended: {
    type: Number,
    required: true,
    default: 0
  }
}, { _id: false });

const testScoreSchema = new mongoose.Schema({
  subject: {
    type: String,
    required: true
  },
  test_name: {
    type: String,
    required: true
  },
  marks_obtained: {
    type: Number,
    required: true
  },
  total_marks: {
    type: Number,
    required: true
  },
  date: {
    type: Date,
    default: Date.now
  }
}, { _id: true });

const studentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  roll_number: {
    type: String,
    required: true
  },
  class_level: {
    type: String,
    required: true
  },
  joining_date: {
    type: Date,
    default: Date.now
  },
  parent_name: {
    type: String,
    required: true
  },
  primary_contact: {
    type: String,
    required: true
  },
  secondary_contact: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['Active', 'Inactive'],
    default: 'Active'
  },
  monthly_fee: {
    type: Number,
    required: true,
    default: 1500
  },
  attendance_history: [attendanceHistorySchema],
  test_scores: [testScoreSchema],
  tuition_test_scores: [testScoreSchema],
  academic_history: [{
    class_level: {
      type: String,
      required: true
    },
    academic_year: {
      type: Number,
      required: true
    },
    roll_number: {
      type: String,
      required: true
    },
    attendance_history: [attendanceHistorySchema],
    test_scores: [testScoreSchema],
    fee_ledger: [mongoose.Schema.Types.Mixed],
    promoted_at: {
      type: Date,
      default: Date.now
    },
    promotion_status: {
      type: String,
      enum: ['Promoted', 'Retained', 'Graduated'],
      default: 'Promoted'
    }
  }]
}, {
  timestamps: true
});

// Ensure roll number is unique per class
studentSchema.index({ class_level: 1, roll_number: 1 }, { unique: true });

export default mongoose.model('Student', studentSchema);
