import express from 'express';
import Student from '../models/Student.js';
import FeeLedger from '../models/FeeLedger.js';
import User from '../models/User.js';
import Attendance from '../models/Attendance.js';
import Timetable from '../models/Timetable.js';
import FingerprintTemplate from '../models/FingerprintTemplate.js';
import { protect, authorize } from '../middleware/auth.js';
import { deleteFromCloud } from '../services/cloudStorage.js';
import { recalculateRollNumbers, recalculateMonthlyAttendance, emitAttendanceUpdated } from '../services/attendanceSync.js';

const router = express.Router();
const DAYS_OF_WEEK_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Helper to initialize 12-month ledger for a student
const initializeFeeLedger = async (studentId, year = new Date().getFullYear()) => {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ].map(m => ({
    month_name: m,
    status: 'Unpaid',
    amount_paid: 0,
    payment_date: null,
    receipt_id: null,
    transaction_method: null
  }));

  const exists = await FeeLedger.findOne({ student_id: studentId, year });
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
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ].map(m => ({
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

    const query = {};

    // Enforce class isolation for Student role
    if (req.user.role === 'Student') {
      if (req.user.studentProfile) {
        // Find the student profile to retrieve class_level
        const selfStudent = await Student.findById(req.user.studentProfile);
        if (!selfStudent) {
          return res.json({ success: true, count: 0, pages: 1, data: [] });
        }
        // Force the class_level query to match the student's class
        query.class_level = selfStudent.class_level;
        
        // Allow search on classmates
        if (search) {
          const escapedSearch = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
      if (class_level) {
        query.class_level = class_level;
      }
      if (search) {
        const escapedSearch = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        query.$or = [
          { name: { $regex: escapedSearch, $options: 'i' } },
          { roll_number: { $regex: escapedSearch, $options: 'i' } }
        ];
      }
    }

    // Handle fee status filter (Only for Admin/Teacher)
    if (fee_status && req.user.role !== 'Student') {
      const currentMonthName = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ][new Date().getMonth()];

      const ledgers = await FeeLedger.find({
        'months': {
          $elemMatch: {
            month_name: currentMonthName,
            status: fee_status
          }
        }
      });
      const studentIds = ledgers.map(l => l.student_id);
      query._id = { $in: studentIds };
      if (fee_status === 'Unpaid') {
        query.is_free_tier = { $ne: true };
      }
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 10);
    const count = await Student.countDocuments(query);
    const pages = Math.max(1, Math.ceil(count / limitNum));
    const skip = (pageNum - 1) * limitNum;

    const students = await Student.find(query)
      .sort({ class_level: 1, roll_number: 1 })
      .skip(skip)
      .limit(limitNum);

    // Attach fee status to results for tables, with role-based redactions
    const studentDataWithFees = await Promise.all(students.map(async (student) => {
      const isStudent = req.user.role === 'Student';
      const isSelf = isStudent && req.user.studentProfile?.toString() === student._id.toString();

      let ledger = null;
      let currentFeeStatus = 'Hidden';

      if (student.is_free_tier) {
        currentFeeStatus = 'Exempt';
      } else if (!isStudent || isSelf) {
        ledger = await FeeLedger.findOne({ student_id: student._id });
        const currentMonthIndex = new Date().getMonth();
        currentFeeStatus = ledger?.months[currentMonthIndex]?.status || 'Unpaid';
      }

      const studentObj = student.toObject();

      if (isStudent && !isSelf) {
        // Redact classmate sensitive data
        studentObj.primary_contact = 'Private';
        studentObj.secondary_contact = 'Private';
        studentObj.parent_name = 'Private';
        studentObj.monthly_fee = 0;
        studentObj.test_scores = [];
        studentObj.tuition_test_scores = [];
        studentObj.attendance_history = [];
        studentObj.academic_history = [];
      }

      return {
        ...studentObj,
        fee_status: currentFeeStatus,
        ledger: ledger
      };
    }));

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
    const { name, class_level, parent_name, primary_contact, secondary_contact, status, joining_date, monthly_fee, is_free_tier } = req.body;

    // Generate a temporary unique roll number since it will be auto-recalculated
    const uniqueTempRoll = `NEW_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const freeTier = Boolean(is_free_tier);
    const feeVal = freeTier ? 0 : (monthly_fee !== undefined ? Number(monthly_fee) : 0);

    const student = await Student.create({
      name,
      roll_number: uniqueTempRoll,
      class_level,
      parent_name,
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
    await recalculateRollNumbers(class_level);

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

// @desc    Update a student
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
    const { class_level, status } = req.body;

    // Remove roll_number from update payload since it's auto-calculated
    if ('roll_number' in req.body) {
      delete req.body.roll_number;
    }

    // If class level is changing, temporarily set roll number to a unique string to avoid unique key index clashes
    if (class_level && class_level !== oldClassLevel) {
      req.body.roll_number = `TEMP_${Date.now()}_${student._id}_MOVE`;
    }

    // Handle free tier status and monthly fee logic
    if (req.body.is_free_tier !== undefined) {
      req.body.is_free_tier = Boolean(req.body.is_free_tier);
      if (req.body.is_free_tier) {
        req.body.monthly_fee = 0;
      }
    }

    const updatedStudent = await Student.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });

    // Deduplicate classes needing roll number recalculation
    const classesToRecalc = new Set([oldClassLevel]);
    if (class_level && class_level !== oldClassLevel) {
      classesToRecalc.add(class_level);
    }
    if (status && status !== oldStatus && updatedStudent?.class_level) {
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

// @desc    Delete a student
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

    await Student.findByIdAndDelete(req.params.id);
    // Delete their Fee Ledger & any linked biometric fingerprint templates
    await FeeLedger.deleteOne({ student_id: req.params.id });
    await FingerprintTemplate.deleteMany({ student: req.params.id });

    // Delete associated User accounts if any
    const associatedUsers = await User.find({ studentProfile: req.params.id });
    for (const user of associatedUsers) {
      if (user.profile_pic) {
        await deleteFromCloud(user.profile_pic);
      }
    }
    await User.deleteMany({ studentProfile: req.params.id });

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
    if (!class_level || !date) {
      res.status(400);
      throw new Error('Please provide class_level and date');
    }

    const cleanDateStr = date ? String(date).split('T')[0] : new Date().toISOString().split('T')[0];
    const normalizedDate = new Date(`${cleanDateStr}T00:00:00.000Z`);
    const dayOfWeekName = DAYS_OF_WEEK_NAMES[normalizedDate.getUTCDay()];

    // Fetch timetable schedule to discover scheduled periods for this class & day
    let scheduledSessions = [];
    try {
      const timetableDoc = await Timetable.findOne();
      if (timetableDoc && Array.isArray(timetableDoc.data)) {
        const dayData = timetableDoc.data.find(d => d.day.toLowerCase() === dayOfWeekName.toLowerCase());
        if (dayData && Array.isArray(dayData.slots)) {
          const classSlots = dayData.slots.filter(s => s.grade?.trim().toUpperCase() === class_level.trim().toUpperCase());
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
      class_level,
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

    const targetSession = session_name || sessionsList[0].session_name;
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
    const { class_level, date, session_name, attendance_list } = req.body;
    if (!class_level || !attendance_list || !Array.isArray(attendance_list) || !date) {
      res.status(400);
      throw new Error('Invalid attendance data or date missing');
    }

    const cleanDateStr = date ? String(date).split('T')[0] : new Date().toISOString().split('T')[0];
    const normalizedDate = new Date(`${cleanDateStr}T00:00:00.000Z`);
    const trackingMonth = cleanDateStr.substring(0, 7); // format: YYYY-MM
    const cleanSession = session_name?.trim() || 'Session 1';

    // Prepare records for the Attendance model
    const records = attendance_list.map(record => ({
      student: record.student_id,
      status: record.attended ? 'Present' : 'Absent',
      remarks: ''
    }));

    // Upsert attendance sheet for this specific session
    await Attendance.findOneAndUpdate(
      { class_level, date: normalizedDate, session_name: cleanSession },
      { class_level, date: normalizedDate, session_name: cleanSession, records },
      { upsert: true, new: true }
    );

    // Recalculate monthly attendance & dynamic roll numbers for all active students in the class
    await recalculateMonthlyAttendance(class_level, trackingMonth);

    emitAttendanceUpdated({
      class_level,
      date: cleanDateStr,
      session_name: cleanSession,
      source: 'manual'
    });

    res.json({
      success: true,
      message: `Attendance logged for ${cleanSession} (${class_level})`
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
        status: record ? record.status : 'Absent'
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
    const { subject, test_name, marks_obtained, total_marks, date } = req.body;

    if (!subject || !test_name || marks_obtained === undefined || total_marks === undefined) {
      res.status(400);
      throw new Error('Please fill in all test score fields');
    }

    const marksNum = Number(marks_obtained);
    const totalNum = Number(total_marks);

    if (isNaN(marksNum) || isNaN(totalNum)) {
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

    // Recalculate roll numbers for this class since test scores changed
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
    const { subject, test_name, marks_obtained, total_marks, date } = req.body;

    if (!subject || !test_name || marks_obtained === undefined || total_marks === undefined) {
      res.status(400);
      throw new Error('Please fill in all test score fields');
    }

    const marksNum = Number(marks_obtained);
    const totalNum = Number(total_marks);

    if (isNaN(marksNum) || isNaN(totalNum)) {
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

    // Recalculate roll numbers for this class since test scores changed
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

// @desc    Promote students to next class level (batch or single)
// @route   POST /api/students/promote
// @access  Private (SuperAdmin only)
router.post('/promote', protect, authorize('SuperAdmin'), async (req, res, next) => {
  try {
    const { studentIds, sourceClass, targetClass, promotionStatus = 'Promoted', newAcademicYear } = req.body;

    if (!targetClass) {
      res.status(400);
      throw new Error('Please specify target class level');
    }

    const parsedYear = Number(newAcademicYear);
    if (!newAcademicYear || !Number.isInteger(parsedYear) || parsedYear < 2000 || parsedYear > 2100) {
      res.status(400);
      throw new Error('Please specify a valid new academic year');
    }

    let query = {};
    if (studentIds && studentIds.length > 0) {
      query = { _id: { $in: studentIds } };
    } else if (sourceClass) {
      query = { class_level: sourceClass, status: 'Active' };
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
    if (sourceClass) affectedClasses.add(sourceClass);
    const archivedYear = parsedYear - 1;

    for (const student of students) {
      // Fetch the student's current fee ledger to archive
      const currentLedger = await FeeLedger.findOne({ student_id: student._id });
      const ledgerMonths = currentLedger ? currentLedger.months : [];

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

      // Push to academic_history
      student.academic_history = student.academic_history || [];
      student.academic_history.push(archiveRecord);

      // 2. Clear current session data
      student.test_scores = [];
      student.attendance_history = [];
      student.tuition_test_scores = []; // clear tuition scores after archiving

      // 3. Move to target class
      const oldClass = student.class_level;
      affectedClasses.add(oldClass);
      student.class_level = targetClass.toUpperCase().trim();

      if (promotionStatus === 'Graduated' || targetClass.toUpperCase().trim() === 'GRADUATED') {
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

    // 6. Recalculate roll numbers for all affected source and target classes
    affectedClasses.add(targetClass.toUpperCase().trim());
    for (const cls of affectedClasses) {
      await recalculateRollNumbers(cls);
    }

    res.json({
      success: true,
      message: `Successfully processed promotion for ${processedStudents.length} student(s) to Class ${targetClass}`,
      data: processedStudents
    });
  } catch (error) {
    next(error);
  }
});

export default router;
