import express from 'express';
import Student from '../models/Student.js';
import FeeLedger from '../models/FeeLedger.js';
import User from '../models/User.js';
import Attendance from '../models/Attendance.js';
import { protect, authorize } from '../middleware/auth.js';
import { deleteFromCloud } from '../services/cloudStorage.js';

const router = express.Router();

// Helper to recalculate roll numbers based on student progress
const recalculateRollNumbers = async (class_level) => {
  try {
    const students = await Student.find({ class_level });
    if (students.length === 0) return;

    const studentsWithProgress = students.map(student => {
      let totalMarksObtained = 0;
      let totalMarksPossible = 0;

      if (student.test_scores && student.test_scores.length > 0) {
        student.test_scores.forEach(score => {
          totalMarksObtained += score.marks_obtained;
          totalMarksPossible += score.total_marks;
        });
      }

      const testScorePercentage = totalMarksPossible > 0 
        ? (totalMarksObtained / totalMarksPossible) * 100 
        : 0;

      // Calculate attendance percentage
      let totalClasses = 0;
      let totalAttended = 0;
      if (student.attendance_history && student.attendance_history.length > 0) {
        student.attendance_history.forEach(att => {
          totalClasses += att.total_classes;
          totalAttended += att.attended;
        });
      }
      const attendancePercentage = totalClasses > 0
        ? (totalAttended / totalClasses) * 100
        : 0;

      // Combined progress score: 80% test scores, 20% attendance
      let progressScore = 0;
      if (totalMarksPossible > 0) {
        progressScore = (testScorePercentage * 0.8) + (attendancePercentage * 0.2);
      } else if (totalClasses > 0) {
        progressScore = attendancePercentage;
      }

      return {
        _id: student._id,
        status: student.status || 'Active',
        progressScore,
        testScorePercentage,
        attendancePercentage,
        joining_date: student.joining_date || new Date(),
        name: student.name
      };
    });

    // Sort students:
    // 1. status ('Active' first)
    // 2. progressScore (descending)
    // 3. testScorePercentage (descending)
    // 4. attendancePercentage (descending)
    // 5. joining_date (ascending)
    // 6. name (ascending)
    studentsWithProgress.sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === 'Active' ? -1 : 1;
      }
      if (b.progressScore !== a.progressScore) {
        return b.progressScore - a.progressScore;
      }
      if (b.testScorePercentage !== a.testScorePercentage) {
        return b.testScorePercentage - a.testScorePercentage;
      }
      if (b.attendancePercentage !== a.attendancePercentage) {
        return b.attendancePercentage - a.attendancePercentage;
      }
      const timeA = new Date(a.joining_date).getTime();
      const timeB = new Date(b.joining_date).getTime();
      if (timeA !== timeB) {
        return timeA - timeB;
      }
      return a.name.localeCompare(b.name);
    });

    // Assign temporary roll numbers first to avoid unique index violation
    for (let i = 0; i < studentsWithProgress.length; i++) {
      const tempRoll = `TEMP_${Date.now()}_${i + 1}`;
      await Student.findByIdAndUpdate(studentsWithProgress[i]._id, { roll_number: tempRoll });
    }

    // Assign final roll numbers sequentially (01, 02, 03...)
    for (let i = 0; i < studentsWithProgress.length; i++) {
      const finalRoll = (i + 1).toString().padStart(2, '0');
      await Student.findByIdAndUpdate(studentsWithProgress[i]._id, { roll_number: finalRoll });
    }
  } catch (error) {
    console.error(`Error recalculating roll numbers for class ${class_level}:`, error);
  }
};

// Helper to initialize 12-month ledger for a student
const initializeFeeLedger = async (studentId) => {
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

  await FeeLedger.create({
    student_id: studentId,
    year: new Date().getFullYear(),
    months
  });
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
          query.$or = [
            { name: { $regex: search, $options: 'i' } },
            { roll_number: { $regex: search, $options: 'i' } }
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
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { roll_number: { $regex: search, $options: 'i' } }
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
    }

    const count = await Student.countDocuments(query);
    const pages = Math.ceil(count / limit);
    const skip = (page - 1) * limit;

    const students = await Student.find(query)
      .sort({ class_level: 1, roll_number: 1 })
      .skip(skip)
      .limit(Number(limit));

    // Attach fee status to results for tables, with role-based redactions
    const studentDataWithFees = await Promise.all(students.map(async (student) => {
      const isStudent = req.user.role === 'Student';
      const isSelf = isStudent && req.user.studentProfile?.toString() === student._id.toString();

      let ledger = null;
      let currentFeeStatus = 'Hidden';

      // Load ledger only for self or admins/teachers
      if (!isStudent || isSelf) {
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
        studentObj.attendance_history = [];
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
    const { name, class_level, parent_name, primary_contact, secondary_contact, status, joining_date, monthly_fee } = req.body;

    // Generate a temporary unique roll number since it will be auto-recalculated
    const uniqueTempRoll = `NEW_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const student = await Student.create({
      name,
      roll_number: uniqueTempRoll,
      class_level,
      parent_name,
      primary_contact,
      secondary_contact,
      status: status || 'Active',
      joining_date: joining_date || new Date(),
      monthly_fee: monthly_fee !== undefined ? Number(monthly_fee) : 1500
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
    if (req.body.roll_number) {
      delete req.body.roll_number;
    }

    const updatedStudent = await Student.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });

    // Recalculate roll numbers for the old class
    await recalculateRollNumbers(oldClassLevel);

    // Recalculate for the new class if it changed
    if (class_level && class_level !== oldClassLevel) {
      await recalculateRollNumbers(class_level);
    }

    // Recalculate if status changed (Active/Inactive)
    if (status && status !== oldStatus) {
      await recalculateRollNumbers(updatedStudent.class_level);
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
    // Delete their Fee Ledger
    await FeeLedger.deleteOne({ student_id: req.params.id });

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

// @desc    Get bulk attendance for a class on a specific date
// @route   GET /api/students/attendance/bulk
// @access  Private (Admin/Teacher)
router.get('/attendance/bulk', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const { class_level, date } = req.query;
    if (!class_level || !date) {
      res.status(400);
      throw new Error('Please provide class_level and date');
    }

    const normalizedDate = new Date(date + 'T00:00:00.000Z');
    const attendanceSheet = await Attendance.findOne({
      class_level,
      date: normalizedDate
    });

    if (!attendanceSheet) {
      return res.json({ success: true, exists: false, records: [] });
    }

    const records = attendanceSheet.records.map(r => ({
      student_id: r.student,
      status: r.status,
      attended: r.status === 'Present' || r.status === 'Late'
    }));

    res.json({
      success: true,
      exists: true,
      records
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Bulk log daily attendance for a class
// @route   POST /api/students/attendance/bulk
// @access  Private (Admin/Teacher)
router.post('/attendance/bulk', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const { class_level, date, attendance_list } = req.body; // attendance_list: [{ student_id, attended: boolean }]
    if (!class_level || !attendance_list || !Array.isArray(attendance_list) || !date) {
      res.status(400);
      throw new Error('Invalid attendance data or date missing');
    }

    const normalizedDate = new Date(date + 'T00:00:00.000Z');
    const trackingMonth = date.substring(0, 7); // format: YYYY-MM

    // Prepare records for the Attendance model
    const records = attendance_list.map(record => ({
      student: record.student_id,
      status: record.attended ? 'Present' : 'Absent',
      remarks: ''
    }));

    // Find and update or create the attendance sheet for the class and normalizedDate
    await Attendance.findOneAndUpdate(
      { class_level, date: normalizedDate },
      { class_level, date: normalizedDate, records },
      { upsert: true, new: true }
    );

    // Now, recalculate monthly attendance for all active students in the class
    const studentsInClass = await Student.find({ class_level, status: 'Active' });

    // Fetch all attendance sheets for this class and this month
    const startOfMonth = new Date(`${trackingMonth}-01T00:00:00.000Z`);
    // Determine the next month
    const year = parseInt(trackingMonth.split('-')[0]);
    const month = parseInt(trackingMonth.split('-')[1]);
    const nextMonthYear = month === 12 ? year + 1 : year;
    const nextMonthVal = month === 12 ? 1 : month + 1;
    const nextMonthStr = nextMonthVal < 10 ? `0${nextMonthVal}` : `${nextMonthVal}`;
    const endOfMonth = new Date(`${nextMonthYear}-${nextMonthStr}-01T00:00:00.000Z`);

    const monthlySheets = await Attendance.find({
      class_level,
      date: {
        $gte: startOfMonth,
        $lt: endOfMonth
      }
    });

    const updatePromises = studentsInClass.map(async (student) => {
      let total_classes = 0;
      let attended = 0;

      monthlySheets.forEach(sheet => {
        const studentRecord = sheet.records.find(r => r.student.toString() === student._id.toString());
        if (studentRecord) {
          total_classes++;
          if (studentRecord.status === 'Present' || studentRecord.status === 'Late') {
            attended++;
          }
        }
      });

      // Update student's attendance_history for this month
      return Student.findOneAndUpdate(
        {
          _id: student._id,
          'attendance_history.month': trackingMonth
        },
        {
          $set: {
            'attendance_history.$.total_classes': total_classes,
            'attendance_history.$.attended': attended
          }
        }
      ).then(async (result) => {
        if (!result) {
          // If the month entry doesn't exist in array, push it
          return Student.findByIdAndUpdate(
            student._id,
            {
              $push: {
                attendance_history: {
                  month: trackingMonth,
                  total_classes,
                  attended
                }
              }
            }
          );
        }
        return result;
      });
    });

    await Promise.all(updatePromises);

    // Recalculate roll numbers for the class since attendance updated
    await recalculateRollNumbers(class_level);

    res.json({
      success: true,
      message: `Attendance logged successfully for class ${class_level}`
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

    // Verify access: student role can only view their own
    if (req.user.role === 'Student' && req.user.studentProfile?.toString() !== studentId) {
      res.status(403);
      throw new Error('Not authorized to access other student attendance records');
    }

    const attendanceSheets = await Attendance.find({
      'records.student': studentId
    }).sort({ date: -1 }); // Latest dates first

    const history = attendanceSheets.map(sheet => {
      const record = sheet.records.find(r => r.student.toString() === studentId);
      return {
        date: sheet.date,
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

    const student = await Student.findById(req.params.id);
    if (!student) {
      res.status(404);
      throw new Error('Student not found');
    }

    student.test_scores.push({
      subject,
      test_name,
      marks_obtained: Number(marks_obtained),
      total_marks: Number(total_marks),
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

export default router;
