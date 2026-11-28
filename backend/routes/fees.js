import express from 'express';
import crypto from 'crypto';
import FeeLedger from '../models/FeeLedger.js';
import Student from '../models/Student.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

const ALLOWED_FEE_STATUSES = ['Paid', 'Unpaid', 'Partial/Pending'];
const WEBHOOK_REPLAY_WINDOW_MS = 5 * 60 * 1000;

const generateReceiptId = (prefix = 'REC') =>
  `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

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
    const [ledgers, activeStudents] = await Promise.all([
      FeeLedger.find()
        .select('student_id months')
        .populate('student_id', 'status is_free_tier monthly_fee')
        .lean(),
      Student.find({ status: 'Active' })
        .select('is_free_tier monthly_fee')
        .lean()
    ]);
    const totalExpectedRevenue = activeStudents.reduce((sum, s) => sum + ((s.is_free_tier ? 0 : (s.monthly_fee || 0)) * 12), 0);

    let actualCollectedRevenue = 0;
    let paidMonthsCount = 0;
    let unpaidMonthsCount = 0;
    let partialMonthsCount = 0;

    ledgers.forEach(ledger => {
      if (ledger.student_id && ledger.student_id.status === 'Active') {
        if (ledger.student_id.is_free_tier) return;
        (ledger.months || []).forEach(m => {
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

// @desc    Manual payment override/update (atomic per-month update — zero cross-month overwrite race)
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

    const existingLedger = await FeeLedger.findOne(
      { student_id },
      { months: { $elemMatch: { month_name } } }
    ).lean();
    if (!existingLedger) {
      res.status(404);
      throw new Error('Ledger not found');
    }

    const existingMonth = Array.isArray(existingLedger.months) ? existingLedger.months[0] : null;
    if (!existingMonth) {
      res.status(400);
      throw new Error('Invalid month name');
    }

    let updateFields;
    if (status === 'Unpaid') {
      updateFields = {
        'months.$.status': 'Unpaid',
        'months.$.payment_date': null,
        'months.$.amount_paid': 0,
        'months.$.receipt_id': null,
        'months.$.transaction_method': null
      };
    } else {
      const parsedAmount = amount_paid === undefined || amount_paid === null || amount_paid === ''
        ? 0
        : Number(amount_paid);
      if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
        res.status(400);
        throw new Error('amount_paid must be a non-negative finite number');
      }

      const paymentDate = status === 'Paid'
        ? new Date()
        : (parsedAmount > 0 ? new Date() : null);

      updateFields = {
        'months.$.status': status,
        'months.$.amount_paid': parsedAmount,
        'months.$.payment_date': paymentDate,
        'months.$.receipt_id': receipt_id ? String(receipt_id).trim() : (existingMonth.receipt_id || generateReceiptId('REC')),
        'months.$.transaction_method': transaction_method ? String(transaction_method).trim() : (existingMonth.transaction_method || 'Manual Cash/Bank')
      };
    }

    const populatedLedger = await FeeLedger.findOneAndUpdate(
      { student_id, 'months.month_name': month_name },
      { $set: updateFields },
      { new: true }
    ).populate('student_id');

    res.json({ success: true, data: populatedLedger });
  } catch (error) {
    next(error);
  }
});

// @desc    Webhook receiver for external payment gateways (HMAC-SHA256 + atomic idempotency + amount validation)
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

    // Optional replay-window check if caller sends x-webhook-timestamp (seconds or ms epoch)
    const rawTs = req.headers['x-webhook-timestamp'] || req.body?.timestamp;
    if (rawTs !== undefined && rawTs !== null && String(rawTs).trim() !== '') {
      const numericTs = Number(rawTs);
      const tsMs = numericTs > 1e12 ? numericTs : numericTs * 1000;
      if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > WEBHOOK_REPLAY_WINDOW_MS) {
        return res.status(400).json({ success: false, message: 'Webhook timestamp expired or outside allowed window' });
      }
    }

    const { student_id, month_name, amount, payment_method, receipt_id } = req.body || {};

    const parsedAmount = Number(amount);
    const cleanReceiptId = typeof receipt_id === 'string' ? receipt_id.trim() : '';
    if (
      typeof student_id !== 'string' ||
      typeof month_name !== 'string' ||
      !cleanReceiptId ||
      !Number.isFinite(parsedAmount) ||
      parsedAmount <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment hook payload (student_id, month_name, receipt_id, and positive amount are required)'
      });
    }

    const [ledger, student] = await Promise.all([
      FeeLedger.findOne({ student_id }).lean(),
      Student.findById(student_id).select('monthly_fee is_free_tier').lean()
    ]);
    if (!ledger || !student) {
      return res.status(404).json({ success: false, message: 'Student ledger not found' });
    }

    const existingReceipt = (ledger.months || []).find(m => m.receipt_id === cleanReceiptId);
    if (existingReceipt) {
      return res.status(200).json({
        success: true,
        duplicate: true,
        message: `Webhook receipt ${cleanReceiptId} was already processed`,
        data: existingReceipt
      });
    }

    const monthObj = (ledger.months || []).find(m => m.month_name === month_name);
    if (!monthObj) {
      return res.status(400).json({ success: false, message: 'Invalid month in webhook payload' });
    }

    const expectedMonthlyFee = student.is_free_tier ? 0 : (Number(student.monthly_fee) || 0);
    const cumulativePaid = (Number(monthObj.amount_paid) || 0) + parsedAmount;
    const computedStatus = (expectedMonthlyFee <= 0 || cumulativePaid >= expectedMonthlyFee)
      ? 'Paid'
      : 'Partial/Pending';

    // Atomic conditional update prevents concurrent duplicate webhook retries from double-crediting
    const updatedLedger = await FeeLedger.findOneAndUpdate(
      {
        student_id,
        months: {
          $elemMatch: {
            month_name,
            receipt_id: { $ne: cleanReceiptId }
          }
        },
        'months.receipt_id': { $ne: cleanReceiptId }
      },
      {
        $set: {
          'months.$.status': computedStatus,
          'months.$.amount_paid': cumulativePaid,
          'months.$.payment_date': new Date(),
          'months.$.receipt_id': cleanReceiptId,
          'months.$.transaction_method': payment_method ? String(payment_method).trim() : 'Online Gateway'
        }
      },
      { new: true }
    ).lean();

    if (!updatedLedger) {
      const latest = await FeeLedger.findOne({ student_id }).lean();
      const dup = (latest?.months || []).find(m => m.receipt_id === cleanReceiptId);
      return res.status(200).json({
        success: true,
        duplicate: true,
        message: `Webhook receipt ${cleanReceiptId} was already processed`,
        data: dup || null
      });
    }

    const updatedMonth = (updatedLedger.months || []).find(m => m.month_name === month_name);
    res.status(200).json({
      success: true,
      message: `Webhook transaction processed successfully for student ID ${student_id}, Month: ${month_name}`,
      data: updatedMonth
    });
  } catch (error) {
    next(error);
  }
});

export default router;
