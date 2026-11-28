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
    default: () => new Date(Date.now() + 5.5 * 60 * 60 * 1000).getUTCFullYear()
  },
  months: [monthlyFeeSchema]
}, {
  timestamps: true
});

feeLedgerSchema.index({ 'months.month_name': 1, 'months.status': 1 });
feeLedgerSchema.index({ year: 1, 'months.month_name': 1, 'months.status': 1 });

export default mongoose.model('FeeLedger', feeLedgerSchema);
