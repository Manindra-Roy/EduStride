import express from 'express';
import Student from '../models/Student.js';
import FeeLedger from '../models/FeeLedger.js';
import User from '../models/User.js';
import Attendance from '../models/Attendance.js';
import Timetable from '../models/Timetable.js';
import ClassLevel from '../models/ClassLevel.js';
import SpecialBatch from '../models/SpecialBatch.js';
import { protect, authorize } from '../middleware/auth.js';
import { deleteFromCloud } from '../services/cloudStorage.js';
import {
  getISTParts,
  recalculateRollNumbers,
  recalculateMonthlyAttendance,
  emitAttendanceUpdated
} from '../services/attendanceSync.js';
import { enqueueHardwareDeletesForStudent } from './biometric.js';

const router = express.Router();
const DAYS_OF_WEEK_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const ALLOWED_ATTENDANCE_STATUSES = ['Present', 'Absent', 'Late', 'Excused'];
const ALLOWED_PROMOTION_STATUSES = ['Promoted', 'Retained', 'Graduated'];

const parseValidDateString = (rawDate) => {
  if (typeof rawDate !== 'string') return null;
  const cleanDateStr = rawDate.trim().split('T')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDateStr)) return null;
  const normalizedDate = new Date(`${cleanDateStr}T00:00:00.000Z`);
  if (isNaN(normalizedDate.getTime())) return null;
  if (normalizedDate.toISOString().slice(0, 10) !== cleanDateStr) return null;
  return { cleanDateStr, normalizedDate };
};

// Helper to initialize 12-month ledger for a student (queries unique student_id)
const initializeFeeLedger = async (studentId, year = new Date().getFullYear()) => {
  const months = MONTH_NAMES.map(m => ({
    month_name: m,
    status: 'Unpaid',
    amount_paid: 0,
    payment_date: null,
    receipt_id: null,
    transaction_method: null
  }));

  const exists = await FeeLedger.findOne({ student_id: studentId });
  if (!exists) {
    await FeeLedger.create({
      student_id: studentId,
      year,
      months
    });
  }
};

// Helper to reset an existing fee ledger or create it if missing (avoids unique student_id violations)
const resetOrCreateFeeLedger = async (studentId, year) => {
  const months = MONTH_NAMES.map(m => ({
    month_name: m,
    status: 'Unpaid',
    amount_paid: 0,
    payment_date: null,
    receipt_id: null,
    transaction_method: null
  }));

  const ledger = await FeeLedger.findOne({ student_id: studentId });
  if (ledger) {
    ledger.year = Number(year);
    ledger.months = months;
    await ledger.save();
  } else {
    await FeeLedger.create({
      student_id: studentId,
      year: Number(year),
      months
    });
  }
};

// @desc    Get all students (with search, filter, pagination)
// @route   GET /api/students
// @access  Private
router.get('/', protect, async (req, res, next) => {
  try {
    const { class_level, search, fee_status, page = 1, limit = 10 } = req.query;
    const cleanSearch = typeof search === 'string' && search.trim() ? search.trim() : '';
    const cleanClassLevel = typeof class_level === 'string' && class_level.trim() ? class_level.trim().toUpperCase() : '';
    const cleanFeeStatus = typeof fee_status === 'string' && ['Paid', 'Unpaid', 'Partial/Pending'].includes(fee_status)
      ? fee_status
      : '';

    const query = {};

    // Enforce class isolation for Student role
    if (req.user.role === 'Student') {
      if (req.user.studentProfile) {
        const selfStudent = await Student.findById(req.user.studentProfile);
        if (!selfStudent) {
          return res.json({ success: true, count: 0, pages: 1, data: [] });
        }
        query.class_level = selfStudent.class_level;

        if (cleanSearch) {
          const escapedSearch = cleanSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          query.$or = [
            { name: { $regex: escapedSearch, $options: 'i' } },
            { roll_number: { $regex: escapedSearch, $options: 'i' } }
          ];
        }
      } else {
        return res.json({ success: true, count: 0, pages: 1, data: [] });
      }
    } else {
      // Admin/Teacher filtering
      if (cleanClassLevel && cleanClassLevel !== 'ALL') {
        query.class_level = cleanClassLevel;
      }
      if (cleanSearch) {
        const escapedSearch = cleanSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        query.$or = [
          { name: { $regex: escapedSearch, $options: 'i' } },
          { roll_number: { $regex: escapedSearch, $options: 'i' } }
        ];
      }
    }

    const ist = getISTParts();
    const currentMonthName = MONTH_NAMES[Number(ist.dateStr.slice(5, 7)) - 1];

    // Handle fee status filter (Only for Admin/Teacher)
    if (cleanFeeStatus && req.user.role !== 'Student') {
      const ledgers = await FeeLedger.find({
        months: {
          $elemMatch: {
            month_name: currentMonthName,
            status: cleanFeeStatus
          }
        }
      }).select('student_id').lean();
      const studentIds = ledgers.map(l => l.student_id);
      query._id = { $in: studentIds };
      if (cleanFeeStatus === 'Unpaid') {
        query.is_free_tier = { $ne: true };
      }
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(1000, Math.max(1, parseInt(limit, 10) || 10));
    const count = await Student.countDocuments(query);
    const pages = Math.max(1, Math.ceil(count / limitNum));
    const skip = (pageNum - 1) * limitNum;

    const students = await Student.find(query)
      .sort({ class_level: 1, roll_number: 1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Batch-fetch all required FeeLedgers in ONE MongoDB query
    const isStudent = req.user.role === 'Student';
    const selfIdStr = req.user.studentProfile?.toString() || '';
    const ledgerTargetIds = students
      .filter(s => !s.is_free_tier && (!isStudent || s._id.toString() === selfIdStr))
      .map(s => s._id);

    const ledgerMap = new Map();
    if (ledgerTargetIds.length > 0) {
      const ledgers = await FeeLedger.find({ student_id: { $in: ledgerTargetIds } }).lean();
      ledgers.forEach(l => ledgerMap.set(l.student_id.toString(), l));
    }

    // Attach fee status to results for tables, with role-based redactions
    const studentDataWithFees = students.map((student) => {
      const isSelf = isStudent && selfIdStr === student._id.toString();

      let ledger = null;
      let currentFeeStatus = 'Hidden';

      if (student.is_free_tier) {
        currentFeeStatus = 'Exempt';
      } else if (!isStudent || isSelf) {
        ledger = ledgerMap.get(student._id.toString()) || null;
        const monthEntry = ledger?.months?.find(m => m.month_name === currentMonthName);
        currentFeeStatus = monthEntry?.status || 'Unpaid';
      }

      const studentObj = { ...student };

      if (isStudent && !isSelf) {
        // Redact classmate sensitive data
        studentObj.primary_contact = 'Private';
        studentObj.secondary_contact = 'Private';
        studentObj.parent_name = 'Private';
        studentObj.parent_email = 'Private';
        studentObj.monthly_fee = 0;
        studentObj.test_scores = [];
        studentObj.tuition_test_scores = [];
        studentObj.attendance_history = [];
        studentObj.academic_history = [];
      }

      return {
        ...studentObj,
        fee_status: currentFeeStatus,
        ledger
      };
    });

    res.json({
      success: true,
      count,
      pages,
      data: studentDataWithFees
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get single student details
// @route   GET /api/students/:id
// @access  Private
router.get('/:id', protect, async (req, res, next) => {
  try {
    // If Student role, restrict to their own ID
    if (req.user.role === 'Student' && req.user.studentProfile?.toString() !== req.params.id) {
      res.status(403);
      throw new Error('Not authorized to access other student profiles');
    }

    const student = await Student.findById(req.params.id);
    if (!student) {
      res.status(404);
      throw new Error('Student not found');
    }

    const ledger = await FeeLedger.findOne({ student_id: student._id });

    res.json({
      success: true,
      data: {
        ...student.toObject(),
        ledger
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Create a new student
// @route   POST /api/students
// @access  Private (Admin/Teacher)
router.post('/', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const {
      name,
      class_level,
      parent_name,
      parent_email,
      primary_contact,
      secondary_contact,
      status,
      joining_date,
      monthly_fee,
      is_free_tier
    } = req.body || {};

    if (typeof class_level !== 'string' || !class_level.trim()) {
      res.status(400);
      throw new Error('A valid class_level is required');
    }

    const cleanClassLevel = class_level.trim().toUpperCase();

    // Generate a temporary unique roll number since it will be auto-recalculated
    const uniqueTempRoll = `NEW_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const freeTier = Boolean(is_free_tier);
    const feeVal = freeTier ? 0 : (monthly_fee !== undefined ? Number(monthly_fee) : 0);

    const student = await Student.create({
      name,
      roll_number: uniqueTempRoll,
      class_level: cleanClassLevel,
      parent_name,
      parent_email: parent_email ? String(parent_email).trim().toLowerCase() : '',
      primary_contact,
      secondary_contact,
      status: status || 'Active',
      joining_date: joining_date || new Date(),
      monthly_fee: feeVal,
      is_free_tier: freeTier
    });

    // Auto-create FeeLedger
    await initializeFeeLedger(student._id);

    // Recalculate roll numbers for the class level
    await recalculateRollNumbers(cleanClassLevel);

    // Fetch the updated student profile with the correct roll number
    const updatedStudent = await Student.findById(student._id);

    res.status(201).json({
      success: true,
      data: updatedStudent
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Update a student (whitelisted fields only)
// @route   PUT /api/students/:id
// @access  Private (Admin/Teacher)
router.put('/:id', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const student = await Student.findById(req.params.id);
    if (!student) {
      res.status(404);
      throw new Error('Student not found');
    }

    const oldClassLevel = student.class_level;
    const oldStatus = student.status;
    const {
      name,
      class_level,
      parent_name,
      parent_email,
      primary_contact,
      secondary_contact,
      status,
      joining_date,
      monthly_fee,
      is_free_tier
    } = req.body || {};

    const updateFields = {};
    if (typeof name === 'string' && name.trim()) {
      updateFields.name = name.trim();
    }
    if (typeof parent_name === 'string' && parent_name.trim()) {
      updateFields.parent_name = parent_name.trim();
    }
    if (parent_email !== undefined) {
      updateFields.parent_email = typeof parent_email === 'string' ? parent_email.trim().toLowerCase() : '';
    }
    if (typeof primary_contact === 'string' && primary_contact.trim()) {
      updateFields.primary_contact = primary_contact.trim();
    }
    if (typeof secondary_contact === 'string' && secondary_contact.trim()) {
      updateFields.secondary_contact = secondary_contact.trim();
    }
    if (typeof status === 'string' && ['Active', 'Inactive'].includes(status)) {
      updateFields.status = status;
    }
    if (joining_date !== undefined) {
      const parsedJoin = new Date(joining_date);
      if (!isNaN(parsedJoin.getTime())) {
        updateFields.joining_date = parsedJoin;
      }
    }

    let cleanClassLevel = null;
    if (typeof class_level === 'string' && class_level.trim()) {
      cleanClassLevel = class_level.trim().toUpperCase();
      updateFields.class_level = cleanClassLevel;
      if (cleanClassLevel !== oldClassLevel) {
        updateFields.roll_number = `TEMP_${Date.now()}_${student._id}_MOVE`;
      }
    }

    if (is_free_tier !== undefined) {
      updateFields.is_free_tier = Boolean(is_free_tier);
      if (updateFields.is_free_tier) {
        updateFields.monthly_fee = 0;
      } else if (monthly_fee !== undefined) {
        const parsedFee = Number(monthly_fee);
        if (!Number.isFinite(parsedFee) || parsedFee < 0) {
          res.status(400);
          throw new Error('monthly_fee must be a non-negative number');
        }
        updateFields.monthly_fee = parsedFee;
      }
    } else if (monthly_fee !== undefined) {
      const parsedFee = Number(monthly_fee);
      if (!Number.isFinite(parsedFee) || parsedFee < 0) {
        res.status(400);
        throw new Error('monthly_fee must be a non-negative number');
      }
      updateFields.monthly_fee = student.is_free_tier ? 0 : parsedFee;
    }

    const updatedStudent = await Student.findByIdAndUpdate(
      req.params.id,
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    // Deduplicate classes needing roll number recalculation
    const classesToRecalc = new Set([oldClassLevel]);
    if (cleanClassLevel && cleanClassLevel !== oldClassLevel) {
      classesToRecalc.add(cleanClassLevel);
    }
    if (updateFields.status && updateFields.status !== oldStatus && updatedStudent?.class_level) {
      classesToRecalc.add(updatedStudent.class_level);
    }
    for (const cls of classesToRecalc) {
      await recalculateRollNumbers(cls);
    }

    const finalStudent = await Student.findById(req.params.id);

    res.json({
      success: true,
      data: finalStudent
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Delete a student (and clean up all references)
// @route   DELETE /api/students/:id
// @access  Private (Admin/Teacher)
router.delete('/:id', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const student = await Student.findById(req.params.id);
    if (!student) {
      res.status(404);
      throw new Error('Student not found');
    }

    const classLevel = student.class_level;
    const studentObjectId = student._id;

    await Student.findByIdAndDelete(req.params.id);
    // Delete Fee Ledger, remove biometric mappings + queue hardware R307S slot deletions,
    // and clean up SpecialBatch & Attendance references
    await Promise.all([
      FeeLedger.deleteOne({ student_id: studentObjectId }),
      enqueueHardwareDeletesForStudent(studentObjectId, student.name),
      SpecialBatch.updateMany(
        {},
        {
          $pull: {
            students: studentObjectId,
            'attendance_records.$[].records': { student: studentObjectId },
            'test_scores.$[].scores': { student: studentObjectId }
          }
        }
      ),
      Attendance.updateMany(
        { 'records.student': studentObjectId },
        { $pull: { records: { student: studentObjectId } } }
      )
    ]);

    // Delete associated User accounts if any
    const associatedUsers = await User.find({ studentProfile: studentObjectId });
    for (const user of associatedUsers) {
      if (user.profile_pic) {
        await deleteFromCloud(user.profile_pic);
      }
    }
    await User.deleteMany({ studentProfile: studentObjectId });

    // Recalculate rolls for the class level
    await recalculateRollNumbers(classLevel);

    res.json({
      success: true,
      message: 'Student and associated data removed successfully'
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get bulk attendance for a class on a specific date and session, integrated with schedule
// @route   GET /api/students/attendance/bulk
// @access  Private (Admin/Teacher)
router.get('/attendance/bulk', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const { class_level, date, session_name } = req.query;
    if (typeof class_level !== 'string' || !class_level.trim() || typeof date !== 'string' || !date.trim()) {
      res.status(400);
      throw new Error('Please provide valid class_level and date');
    }

    const parsedDate = parseValidDateString(date);
    if (!parsedDate) {
      res.status(400);
      throw new Error('Invalid date format. Expected YYYY-MM-DD');
    }

    const cleanClassLevel = class_level.trim().toUpperCase();
    const { normalizedDate } = parsedDate;
    const dayOfWeekName = DAYS_OF_WEEK_NAMES[normalizedDate.getUTCDay()];

    // Fetch timetable schedule to discover scheduled periods for this class & day
    let scheduledSessions = [];
    try {
      const timetableDoc = await Timetable.findOne();
      if (timetableDoc && Array.isArray(timetableDoc.data)) {
        const dayData = timetableDoc.data.find(d => d.day.toLowerCase() === dayOfWeekName.toLowerCase());
        if (dayData && Array.isArray(dayData.slots)) {
          const classSlots = dayData.slots.filter(s => s.grade?.trim().toUpperCase() === cleanClassLevel);
          scheduledSessions = classSlots.map(slot => ({
            session_name: `${slot.time} - ${slot.subject}`,
            time: slot.time,
            subject: slot.subject,
            teacher: slot.teacher
          }));
        }
      }
    } catch (e) {
      console.error('[Timetable Schedule Fetch Error]:', e);
    }

    // Find all attendance sheets logged for this class and date
    const allSheets = await Attendance.find({
      class_level: cleanClassLevel,
      date: normalizedDate
    }).sort({ createdAt: 1 });

    const loggedMap = {};
    allSheets.forEach(s => {
      loggedMap[(s.session_name || 'Session 1').toLowerCase()] = s;
    });

    const sessionsList = [];
    const addedSet = new Set();

    // 1. Add scheduled sessions
    scheduledSessions.forEach(sch => {
      const lower = sch.session_name.toLowerCase();
      addedSet.add(lower);
      sessionsList.push({
        session_name: sch.session_name,
        subject: sch.subject,
        time: sch.time,
        teacher: sch.teacher,
        is_scheduled: true,
        is_logged: !!loggedMap[lower]
      });
    });

    // 2. Add any additional logged sessions (or fallback default)
    allSheets.forEach(s => {
      const sName = s.session_name || 'Session 1';
      const lower = sName.toLowerCase();
      if (!addedSet.has(lower)) {
        addedSet.add(lower);
        sessionsList.push({
          session_name: sName,
          is_scheduled: false,
          is_logged: true
        });
      }
    });

    if (sessionsList.length === 0) {
      sessionsList.push({
        session_name: 'Session 1',
        is_scheduled: false,
        is_logged: false
      });
    }

    const targetSession = (typeof session_name === 'string' && session_name.trim())
      ? session_name.trim()
      : sessionsList[0].session_name;
    const attendanceSheet = allSheets.find(s => (s.session_name || 'Session 1').toLowerCase() === targetSession.toLowerCase());

    if (!attendanceSheet) {
      return res.json({
        success: true,
        exists: false,
        session_name: targetSession,
        available_sessions: sessionsList,
        records: []
      });
    }

    const records = attendanceSheet.records.map(r => ({
      student_id: r.student,
      status: r.status,
      remarks: r.remarks || '',
      attended: r.status === 'Present' || r.status === 'Late'
    }));

    res.json({
      success: true,
      exists: true,
      session_name: attendanceSheet.session_name || targetSession,
      available_sessions: sessionsList,
      records
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Bulk log daily attendance for a class & session
// @route   POST /api/students/attendance/bulk
// @access  Private (Admin/Teacher)
router.post('/attendance/bulk', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const { class_level, date, session_name, attendance_list } = req.body || {};
    if (typeof class_level !== 'string' || !class_level.trim() || !Array.isArray(attendance_list) || typeof date !== 'string' || !date.trim()) {
      res.status(400);
      throw new Error('Invalid attendance data or date missing');
    }

    const parsedDate = parseValidDateString(date);
    if (!parsedDate) {
      res.status(400);
      throw new Error('Invalid date format. Expected YYYY-MM-DD');
    }

    const cleanClassLevel = class_level.trim().toUpperCase();
    const { cleanDateStr, normalizedDate } = parsedDate;
    const trackingMonth = cleanDateStr.substring(0, 7); // format: YYYY-MM
    const cleanSession = (typeof session_name === 'string' && session_name.trim()) ? session_name.trim() : 'Session 1';

    // Preserve any existing biometric entry/exit remarks when teachers save manual attendance
    const existingSheet = await Attendance.findOne({
      class_level: cleanClassLevel,
      date: normalizedDate,
      session_name: cleanSession
    });
    const existingRemarksByStudent = new Map();
    if (existingSheet && Array.isArray(existingSheet.records)) {
      existingSheet.records.forEach(r => {
        if (r.student && r.remarks) {
          existingRemarksByStudent.set(r.student.toString(), r.remarks);
        }
      });
    }

    // Prepare records for the Attendance model (preserving explicit Late/Excused status when sent)
    const records = attendance_list.map(record => {
      const explicitStatus = typeof record.status === 'string' && ALLOWED_ATTENDANCE_STATUSES.includes(record.status)
        ? record.status
        : null;
      return {
        student: record.student_id,
        status: explicitStatus || (record.attended ? 'Present' : 'Absent'),
        remarks: record.remarks !== undefined
          ? String(record.remarks)
          : (existingRemarksByStudent.get(String(record.student_id)) || '')
      };
    });

    // Upsert attendance sheet for this specific session
    await Attendance.findOneAndUpdate(
      { class_level: cleanClassLevel, date: normalizedDate, session_name: cleanSession },
      { class_level: cleanClassLevel, date: normalizedDate, session_name: cleanSession, records },
      { upsert: true, new: true }
    );

    // Recalculate monthly attendance & dynamic roll numbers for all active students in the class
    await recalculateMonthlyAttendance(cleanClassLevel, trackingMonth);

    emitAttendanceUpdated({
      class_level: cleanClassLevel,
      date: cleanDateStr,
      session_name: cleanSession,
      source: 'manual'
    });

    res.json({
      success: true,
      message: `Attendance logged for ${cleanSession} (${cleanClassLevel})`
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get detailed daily attendance history for a student
// @route   GET /api/students/:id/attendance
// @access  Private
router.get('/:id/attendance', protect, async (req, res, next) => {
  try {
    const studentId = req.params.id;

    if (req.user.role === 'Student' && req.user.studentProfile?.toString() !== studentId) {
      res.status(403);
      throw new Error('Not authorized to access other student attendance records');
    }

    const attendanceSheets = await Attendance.find({
      'records.student': studentId
    }).sort({ date: -1, createdAt: -1 });

    const history = attendanceSheets.map(sheet => {
      const record = sheet.records.find(r => r.student.toString() === studentId);
      return {
        date: sheet.date,
        session_name: sheet.session_name || 'Session 1',
        status: record ? record.status : 'Absent',
        remarks: record ? (record.remarks || '') : ''
      };
    });

    res.json({
      success: true,
      data: history
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Add a test score for a student
// @route   POST /api/students/:id/test-scores
// @access  Private (Admin/Teacher)
router.post('/:id/test-scores', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const { subject, test_name, marks_obtained, total_marks, date } = req.body || {};

    if (!subject || !test_name || marks_obtained === undefined || total_marks === undefined) {
      res.status(400);
      throw new Error('Please fill in all test score fields');
    }

    const marksNum = Number(marks_obtained);
    const totalNum = Number(total_marks);

    if (!Number.isFinite(marksNum) || !Number.isFinite(totalNum)) {
      res.status(400);
      throw new Error('Marks obtained and total marks must be valid numbers');
    }

    if (marksNum < 0) {
      res.status(400);
      throw new Error('Marks obtained cannot be negative');
    }

    if (totalNum <= 0) {
      res.status(400);
      throw new Error('Total marks must be greater than zero');
    }

    if (marksNum > totalNum) {
      res.status(400);
      throw new Error('Marks obtained cannot be greater than total marks');
    }

    const student = await Student.findById(req.params.id);
    if (!student) {
      res.status(404);
      throw new Error('Student not found');
    }

    student.test_scores.push({
      subject,
      test_name,
      marks_obtained: marksNum,
      total_marks: totalNum,
      date: date || new Date()
    });

    await student.save();

    // Recalculate roll numbers for this class since school test scores changed
    await recalculateRollNumbers(student.class_level);

    const finalStudent = await Student.findById(req.params.id);

    res.status(201).json({
      success: true,
      data: finalStudent
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Add a tuition test score for a student
// @route   POST /api/students/:id/tuition-test-scores
// @access  Private (Admin/Teacher)
router.post('/:id/tuition-test-scores', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const { subject, test_name, marks_obtained, total_marks, date } = req.body || {};

    if (!subject || !test_name || marks_obtained === undefined || total_marks === undefined) {
      res.status(400);
      throw new Error('Please fill in all test score fields');
    }

    const marksNum = Number(marks_obtained);
    const totalNum = Number(total_marks);

    if (!Number.isFinite(marksNum) || !Number.isFinite(totalNum)) {
      res.status(400);
      throw new Error('Marks obtained and total marks must be valid numbers');
    }

    if (marksNum < 0) {
      res.status(400);
      throw new Error('Marks obtained cannot be negative');
    }

    if (totalNum <= 0) {
      res.status(400);
      throw new Error('Total marks must be greater than zero');
    }

    if (marksNum > totalNum) {
      res.status(400);
      throw new Error('Marks obtained cannot be greater than total marks');
    }

    const student = await Student.findById(req.params.id);
    if (!student) {
      res.status(404);
      throw new Error('Student not found');
    }

    student.tuition_test_scores.push({
      subject,
      test_name,
      marks_obtained: marksNum,
      total_marks: totalNum,
      date: date || new Date()
    });

    await student.save();

    res.status(201).json({
      success: true,
      data: student
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Promote students to next class level (batch or single)
// @route   POST /api/students/promote
// @access  Private (SuperAdmin only)
router.post('/promote', protect, authorize('SuperAdmin'), async (req, res, next) => {
  try {
    const { studentIds, sourceClass, targetClass, promotionStatus = 'Promoted', newAcademicYear } = req.body || {};

    if (typeof targetClass !== 'string' || !targetClass.trim()) {
      res.status(400);
      throw new Error('Please specify target class level');
    }

    if (typeof promotionStatus !== 'string' || !ALLOWED_PROMOTION_STATUSES.includes(promotionStatus)) {
      res.status(400);
      throw new Error(`Invalid promotionStatus. Must be one of: ${ALLOWED_PROMOTION_STATUSES.join(', ')}`);
    }

    const cleanTargetClass = targetClass.toUpperCase().trim();
    if (cleanTargetClass !== 'GRADUATED') {
      const targetExists = await ClassLevel.findOne({ name: cleanTargetClass });
      if (!targetExists) {
        res.status(400);
        throw new Error(`Target class level '${cleanTargetClass}' does not exist`);
      }
    }

    const parsedYear = Number(newAcademicYear);
    if (!newAcademicYear || !Number.isInteger(parsedYear) || parsedYear < 2000 || parsedYear > 2100) {
      res.status(400);
      throw new Error('Please specify a valid new academic year');
    }

    let query = {};
    let cleanSourceClass = '';
    if (Array.isArray(studentIds) && studentIds.length > 0) {
      if (!studentIds.every(id => typeof id === 'string' && id.trim())) {
        res.status(400);
        throw new Error('studentIds must be an array of valid student IDs');
      }
      query = { _id: { $in: studentIds } };
    } else if (typeof sourceClass === 'string' && sourceClass.trim()) {
      cleanSourceClass = sourceClass.toUpperCase().trim();
      query = { class_level: cleanSourceClass, status: 'Active' };
    } else {
      res.status(400);
      throw new Error('Please specify studentIds or sourceClass for promotion');
    }

    const students = await Student.find(query);
    if (students.length === 0) {
      res.status(404);
      throw new Error('No students found for promotion matching the criteria');
    }

    const processedStudents = [];
    const affectedClasses = new Set();
    if (cleanSourceClass) affectedClasses.add(cleanSourceClass);
    affectedClasses.add(cleanTargetClass);

    try {
      for (const student of students) {
        const currentLedger = await FeeLedger.findOne({ student_id: student._id });
        const ledgerMonths = currentLedger ? currentLedger.months : [];
        const archivedYear = currentLedger?.year ?? (parsedYear - 1);

        // 1. Archive current academic and fee data
        const archiveRecord = {
          class_level: student.class_level,
          academic_year: archivedYear,
          roll_number: student.roll_number,
          attendance_history: student.attendance_history || [],
          test_scores: student.test_scores || [],
          tuition_test_scores: student.tuition_test_scores || [],
          fee_ledger: ledgerMonths,
          promotion_status: promotionStatus,
          promoted_at: new Date()
        };

        student.academic_history = student.academic_history || [];
        student.academic_history.push(archiveRecord);

        // 2. Clear current session data
        student.test_scores = [];
        student.attendance_history = [];
        student.tuition_test_scores = [];

        // 3. Move to target class
        const oldClass = student.class_level;
        affectedClasses.add(oldClass);
        student.class_level = cleanTargetClass;

        if (promotionStatus === 'Graduated' || cleanTargetClass === 'GRADUATED') {
          student.status = 'Inactive';
        }

        // 4. Temporary roll number to avoid index collision during batch update
        student.roll_number = `TEMP_PROMOTE_${Date.now()}_${student._id}`;

        await student.save();

        // 5. Update/Reset Fee Ledger for the new academic year
        await resetOrCreateFeeLedger(student._id, parsedYear);

        processedStudents.push({
          _id: student._id,
          name: student.name,
          oldClass,
          newClass: student.class_level,
          status: student.status
        });
      }
    } finally {
      // 6. Always recalculate roll numbers for all affected classes so no student stays on TEMP_PROMOTE_*
      for (const cls of affectedClasses) {
        await recalculateRollNumbers(cls);
      }
    }

    res.json({
      success: true,
      message: `Successfully processed promotion for ${processedStudents.length} student(s) to Class ${cleanTargetClass}`,
      data: processedStudents
    });
  } catch (error) {
    next(error);
  }
});

export default router;
