import express from 'express';
import FeeLedger from '../models/FeeLedger.js';
import Student from '../models/Student.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

const MONTHLY_TUITION_FEE = 1500; // standard monthly tuition fee

// @desc    Get aggregate revenue analytics
// @route   GET /api/fees/stats
// @access  Private (SuperAdmin only)
router.get('/stats', protect, authorize('SuperAdmin'), async (req, res, next) => {
  try {
    const ledgers = await FeeLedger.find().populate('student_id');
    const activeStudents = await Student.find({ status: 'Active' });
    const totalExpectedRevenue = activeStudents.reduce((sum, s) => sum + ((s.monthly_fee || 1500) * 12), 0);

    let actualCollectedRevenue = 0;
    let paidMonthsCount = 0;
    let unpaidMonthsCount = 0;
    let partialMonthsCount = 0;

    ledgers.forEach(ledger => {
      if (ledger.student_id && ledger.student_id.status === 'Active') {
        ledger.months.forEach(m => {
          actualCollectedRevenue += m.amount_paid || 0;
          if (m.status === 'Paid') paidMonthsCount++;
          else if (m.status === 'Unpaid') unpaidMonthsCount++;
          else if (m.status === 'Partial/Pending') partialMonthsCount++;
        });
      }
    });

    const outstandingBalance = Math.max(0, totalExpectedRevenue - actualCollectedRevenue);

    res.json({
      success: true,
      data: {
        totalExpectedRevenue,
        actualCollectedRevenue,
        outstandingBalance,
        breakdown: {
          paid_months: paidMonthsCount,
          unpaid_months: unpaidMonthsCount,
          partial_months: partialMonthsCount
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get ledger by student ID
// @route   GET /api/fees/ledger/:student_id
// @access  Private
router.get('/ledger/:student_id', protect, async (req, res, next) => {
  try {
    if (req.user.role === 'Student' && req.user.studentProfile?.toString() !== req.params.student_id) {
      res.status(403);
      throw new Error('Not authorized to access other student fee records');
    }

    const ledger = await FeeLedger.findOne({ student_id: req.params.student_id }).populate('student_id');
    if (!ledger) {
      res.status(404);
      throw new Error('Fee ledger not found for this student');
    }

    res.json({ success: true, data: ledger });
  } catch (error) {
    next(error);
  }
});

// @desc    Manual payment override/update
// @route   PUT /api/fees/manual
// @access  Private (SuperAdmin/Teacher)
router.put('/manual', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const { student_id, month_name, status, amount_paid, transaction_method, receipt_id } = req.body;

    if (!student_id || !month_name || !status) {
      res.status(400);
      throw new Error('Please provide student_id, month_name, and status');
    }

    const ledger = await FeeLedger.findOne({ student_id });
    if (!ledger) {
      res.status(404);
      throw new Error('Ledger not found');
    }

    const monthObj = ledger.months.find(m => m.month_name === month_name);
    if (!monthObj) {
      res.status(400);
      throw new Error('Invalid month name');
    }

    monthObj.status = status;
    monthObj.amount_paid = Number(amount_paid) || 0;
    if (status === 'Paid') {
      monthObj.payment_date = new Date();
    }
    monthObj.receipt_id = receipt_id || monthObj.receipt_id || `REC-${Date.now().toString().substring(6)}`;
    monthObj.transaction_method = transaction_method || monthObj.transaction_method || 'Manual Cash/Bank';

    await ledger.save();

    res.json({ success: true, data: ledger });
  } catch (error) {
    next(error);
  }
});

// @desc    Webhook receiver for external payment gateways
// @route   POST /api/fees/webhook
// @access  Public
router.post('/webhook', async (req, res, next) => {
  try {
    const { student_id, month_name, amount, payment_method, receipt_id } = req.body;

    if (!student_id || !month_name || !amount) {
      return res.status(400).json({ success: false, message: 'Invalid payment hook payload' });
    }

    const ledger = await FeeLedger.findOne({ student_id });
    if (!ledger) {
      return res.status(404).json({ success: false, message: 'Student ledger not found' });
    }

    const monthObj = ledger.months.find(m => m.month_name === month_name);
    if (!monthObj) {
      return res.status(400).json({ success: false, message: 'Invalid month in webhook payload' });
    }

    monthObj.status = 'Paid';
    monthObj.amount_paid = Number(amount);
    monthObj.payment_date = new Date();
    monthObj.receipt_id = receipt_id || `WEBHOOK-${Date.now().toString().substring(6)}`;
    monthObj.transaction_method = payment_method || 'Online Gateway';

    await ledger.save();

    res.status(200).json({
      success: true,
      message: `Webhook transaction processed successfully for student ID ${student_id}, Month: ${month_name}`,
      data: monthObj
    });
  } catch (error) {
    next(error);
  }
});

export default router;
