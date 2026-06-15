import mongoose from 'mongoose';

const monthlyFeeSchema = new mongoose.Schema({
  month_name: {
    type: String,
    enum: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    required: true
  },
  status: {
    type: String,
    enum: ['Paid', 'Unpaid', 'Partial/Pending'],
    default: 'Unpaid'
  },
  amount_paid: {
    type: Number,
    default: 0
  },
  payment_date: {
    type: Date,
    default: null
  },
  receipt_id: {
    type: String,
    default: null
  },
  transaction_method: {
    type: String,
    default: null
  }
}, { _id: false });

const feeLedgerSchema = new mongoose.Schema({
  student_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true,
    unique: true
  },
  year: {
    type: Number,
    required: true,
    default: () => new Date().getFullYear()
  },
  months: [monthlyFeeSchema]
}, {
  timestamps: true
});

export default mongoose.model('FeeLedger', feeLedgerSchema);
