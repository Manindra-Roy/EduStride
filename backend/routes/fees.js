import express from 'express';
import crypto from 'crypto';
import FeeLedger from '../models/FeeLedger.js';
import Student from '../models/Student.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

const ALLOWED_FEE_STATUSES = ['Paid', 'Unpaid', 'Partial/Pending'];

const verifyWebhookSignature = (rawBody, providedSig, secret) => {
  if (!providedSig || typeof providedSig !== 'string' || !secret) return false;
  const cleanedSig = providedSig.trim().replace(/^sha256=/i, '');
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  const bufProvided = Buffer.from(cleanedSig, 'utf8');
  const bufExpected = Buffer.from(expected, 'utf8');
  if (bufProvided.length !== bufExpected.length || bufExpected.length === 0) {
    return false;
  }
  return crypto.timingSafeEqual(bufProvided, bufExpected);
};

router.get('/stats', protect, authorize('SuperAdmin'), async (req, res, next) => {
  try {
    const ledgers = await FeeLedger.find().populate('student_id');
    const activeStudents = await Student.find({ status: 'Active' });
    const totalExpectedRevenue = activeStudents.reduce((sum, s) => sum + ((s.is_free_tier ? 0 : (s.monthly_fee || 0)) * 12), 0);

    let actualCollectedRevenue = 0;
    let paidMonthsCount = 0;
    let unpaidMonthsCount = 0;
    let partialMonthsCount = 0;

    ledgers.forEach(ledger => {
      if (ledger.student_id && ledger.student_id.status === 'Active') {
        if (ledger.student_id.is_free_tier) return;
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

    if (typeof student_id !== 'string' || typeof month_name !== 'string' || typeof status !== 'string') {
      res.status(400);
      throw new Error('Please provide valid student_id, month_name, and status');
    }

    if (!ALLOWED_FEE_STATUSES.includes(status)) {
      res.status(400);
      throw new Error('Invalid fee status');
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
    if (status === 'Unpaid') {
      monthObj.payment_date = null;
      monthObj.amount_paid = 0;
      monthObj.receipt_id = null;
      monthObj.transaction_method = null;
    } else {
      const parsedAmount = amount_paid === undefined || amount_paid === null || amount_paid === ''
        ? 0
        : Number(amount_paid);
      if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
        res.status(400);
        throw new Error('amount_paid must be a non-negative finite number');
      }

      monthObj.amount_paid = parsedAmount;
      if (status === 'Paid') {
        monthObj.payment_date = new Date();
      } else if (status === 'Partial/Pending') {
        monthObj.payment_date = monthObj.amount_paid > 0 ? new Date() : null;
      }
      monthObj.receipt_id = receipt_id ? String(receipt_id) : (monthObj.receipt_id || `REC-${Date.now().toString().substring(6)}`);
      monthObj.transaction_method = transaction_method ? String(transaction_method) : (monthObj.transaction_method || 'Manual Cash/Bank');
    }

    await ledger.save();

    const populatedLedger = await FeeLedger.findById(ledger._id).populate('student_id');

    res.json({ success: true, data: populatedLedger });
  } catch (error) {
    next(error);
  }
});

// @desc    Webhook receiver for external payment gateways (HMAC-SHA256 verified)
// @route   POST /api/fees/webhook
// @access  Signed Webhook
router.post('/webhook', async (req, res, next) => {
  try {
    const webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET;
    if (!webhookSecret || !webhookSecret.trim()) {
      return res.status(503).json({
        success: false,
        message: 'Payment webhook endpoint is disabled because PAYMENT_WEBHOOK_SECRET is not configured'
      });
    }

    const providedSignature = req.headers['x-webhook-signature'] || req.headers['x-razorpay-signature'];
    const rawPayload = req.rawBody || Buffer.from(JSON.stringify(req.body || {}), 'utf8');
    if (!verifyWebhookSignature(rawPayload, providedSignature, webhookSecret.trim())) {
      return res.status(401).json({ success: false, message: 'Invalid webhook signature' });
    }

    const { student_id, month_name, amount, payment_method, receipt_id } = req.body || {};

    const parsedAmount = Number(amount);
    if (
      typeof student_id !== 'string' ||
      typeof month_name !== 'string' ||
      !Number.isFinite(parsedAmount) ||
      parsedAmount <= 0
    ) {
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

    // Idempotency check by receipt_id
    const cleanReceiptId = receipt_id ? String(receipt_id).trim() : '';
    if (cleanReceiptId) {
      const existingReceipt = ledger.months.find(m => m.receipt_id === cleanReceiptId);
      if (existingReceipt) {
        return res.status(200).json({
          success: true,
          duplicate: true,
          message: `Webhook receipt ${cleanReceiptId} was already processed`,
          data: existingReceipt
        });
      }
    }

    monthObj.status = 'Paid';
    monthObj.amount_paid = parsedAmount;
    monthObj.payment_date = new Date();
    monthObj.receipt_id = cleanReceiptId || `WEBHOOK-${Date.now().toString().substring(6)}`;
    monthObj.transaction_method = payment_method ? String(payment_method) : 'Online Gateway';

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
