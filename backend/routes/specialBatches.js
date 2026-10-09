import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import SpecialBatch from '../models/SpecialBatch.js';
import Student from '../models/Student.js';
import { protect, authorize } from '../middleware/auth.js';
import { uploadToCloud, deleteFromCloud } from '../services/cloudStorage.js';
import { getIO } from '../config/socket.js';
import { sendEmail } from '../services/mailService.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'batch-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedExtensions = ['.pdf', '.doc', '.docx', '.txt', '.png', '.jpg', '.jpeg', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only document files (.pdf, .doc, .docx, .txt) and images are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 15 * 1024 * 1024 }
});

// @route   GET /api/special-batches
// @desc    Get list of special batches (filtered by user role and membership)
// @route   GET /api/special-batches
// @desc    Get list of special batches (filtered by user role and membership)
// @access  Private
router.get('/', protect, async (req, res, next) => {
  try {
    let filter = {};

    if (req.user.role === 'Student') {
      let studentProfile = await Student.findOne({ user: req.user._id });
      if (!studentProfile && req.user.studentProfile) {
        studentProfile = await Student.findById(req.user.studentProfile);
      }
      if (!studentProfile && req.user.email) {
        studentProfile = await Student.findOne({
          $or: [
            { primary_contact: req.user.email },
            { name: new RegExp('^' + req.user.email.split('@')[0], 'i') }
          ]
        });
      }

      if (studentProfile) {
        filter.students = studentProfile._id;
      } else {
        filter.status = 'Active';
      }
    } else if (req.user.role === 'Teacher') {
      if (req.query.my_batches === 'true') {
        filter.instructor = req.user._id;
      }
    }

    if (req.query.status) {
      filter.status = req.query.status;
    }

    const batches = await SpecialBatch.find(filter)
      .populate({
        path: 'instructor',
        select: 'email role profile_pic'
      })
      .populate({
        path: 'students',
        select: 'name roll_number class_level gender'
      })
      .populate('attendance_records.records.student', 'name roll_number class_level')
      .populate('test_scores.scores.student', 'name roll_number class_level')
      .sort({ created_at: -1 });

    const computedBatches = batches.map(batch => {
      const batchObj = batch.toObject();
      const validStudents = (batchObj.students || []).filter(std => std != null && std._id != null);

      const studentStats = validStudents.map(std => {
        let totalSessions = 0;
        let attendedSessions = 0;
        batchObj.attendance_records?.forEach(att => {
          const rec = att.records?.find(r => r.student && ((r.student._id || r.student).toString() === std._id.toString()));
          if (rec) {
            totalSessions++;
            if (rec.status === 'Present' || rec.status === 'Late') attendedSessions++;
          }
        });
        const attendancePct = totalSessions > 0 ? (attendedSessions / totalSessions) * 100 : 100;

        let totalMarksGot = 0;
        let totalMarksPossible = 0;
        let testCount = 0;
        batchObj.test_scores?.forEach(ts => {
          const scoreRec = ts.scores?.find(s => s.student && ((s.student._id || s.student).toString() === std._id.toString()));
          if (scoreRec) {
            totalMarksGot += scoreRec.marks_obtained;
            totalMarksPossible += ts.total_marks;
            testCount++;
          }
        });
        const testAvgPct = totalMarksPossible > 0 ? (totalMarksGot / totalMarksPossible) * 100 : 0;
        const meritScore = (testAvgPct * 0.8) + (attendancePct * 0.2);

        return {
          ...std,
          batch_attendance_pct: Number(attendancePct.toFixed(1)),
          batch_attended_sessions: attendedSessions,
          batch_total_sessions: totalSessions,
          batch_test_avg_pct: Number(testAvgPct.toFixed(1)),
          batch_tests_count: testCount,
          merit_score: Number(meritScore.toFixed(1))
        };
      });

      studentStats.sort((a, b) => b.merit_score - a.merit_score);
      studentStats.forEach((s, idx) => {
        s.batch_merit_rank = idx + 1;
      });

      batchObj.students = studentStats;
      return batchObj;
    });

    res.json({
      success: true,
      count: computedBatches.length,
      data: computedBatches
    });
  } catch (error) {
    next(error);
  }
});

// @route   GET /api/special-batches/:id
// @desc    Get single special batch details
// @access  Private
router.get('/:id', protect, async (req, res, next) => {
  try {
    const batch = await SpecialBatch.findById(req.params.id)
      .populate('instructor', 'email role profile_pic')
      .populate('students', 'name roll_number class_level total_attendance attended_days primary_contact')
      .populate('attendance_records.records.student', 'name roll_number class_level')
      .populate('test_scores.scores.student', 'name roll_number class_level');

    if (!batch) {
      return res.status(404).json({ success: false, message: 'Special batch not found' });
    }

    if (req.user.role === 'Student') {
      const studentProfile = await Student.findOne({ user: req.user._id });
      if (!studentProfile || !batch.students.some(s => s && s._id && s._id.toString() === studentProfile._id.toString())) {
        return res.status(403).json({ success: false, message: 'You are not enrolled in this special batch' });
      }
    }

    // Compute student stats & merit rankings inside the batch
    const batchObj = batch.toObject();
    const validStudents = (batchObj.students || []).filter(std => std != null && std._id != null);

    const studentStats = validStudents.map(std => {
      // Calculate Attendance Pct in this batch
      let totalSessions = 0;
      let attendedSessions = 0;
      batchObj.attendance_records?.forEach(att => {
        const rec = att.records?.find(r => r.student && ((r.student._id || r.student).toString() === std._id.toString()));
        if (rec) {
          totalSessions++;
          if (rec.status === 'Present' || rec.status === 'Late') attendedSessions++;
        }
      });
      const attendancePct = totalSessions > 0 ? (attendedSessions / totalSessions) * 100 : 100;

      // Calculate Test Average in this batch
      let totalMarksGot = 0;
      let totalMarksPossible = 0;
      let testCount = 0;
      batchObj.test_scores?.forEach(ts => {
        const scoreRec = ts.scores?.find(s => s.student && ((s.student._id || s.student).toString() === std._id.toString()));
        if (scoreRec) {
          totalMarksGot += scoreRec.marks_obtained;
          totalMarksPossible += ts.total_marks;
          testCount++;
        }
      });
      const testAvgPct = totalMarksPossible > 0 ? (totalMarksGot / totalMarksPossible) * 100 : 0;

      // Composite Merit Score (80% Academic Test + 20% Attendance)
      const meritScore = (testAvgPct * 0.8) + (attendancePct * 0.2);

      return {
        ...std,
        batch_attendance_pct: Number(attendancePct.toFixed(1)),
        batch_attended_sessions: attendedSessions,
        batch_total_sessions: totalSessions,
        batch_test_avg_pct: Number(testAvgPct.toFixed(1)),
        batch_tests_count: testCount,
        merit_score: Number(meritScore.toFixed(1))
      };
    });

    // Rank students by merit_score descending
    studentStats.sort((a, b) => b.merit_score - a.merit_score);
    studentStats.forEach((s, idx) => {
      s.batch_merit_rank = idx + 1;
    });

    batchObj.students = studentStats;

    res.json({ success: true, data: batchObj });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/special-batches
// @desc    Create a new special batch
// @access  Private (SuperAdmin, Teacher)
router.post('/', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const { name, subject, description, students, schedule, status, batch_fee } = req.body;

    if (!name || !subject) {
      return res.status(400).json({ success: false, message: 'Batch name and subject are required' });
    }

    const newBatch = await SpecialBatch.create({
      name,
      subject,
      description: description || '',
      instructor: req.user._id,
      students: students || [],
      schedule: schedule || [],
      batch_fee: Number(batch_fee || 0),
      status: status || 'Active'
    });

    const populatedBatch = await SpecialBatch.findById(newBatch._id)
      .populate('instructor', 'email role profile_pic')
      .populate('students', 'name roll_number class_level');

    res.status(201).json({
      success: true,
      message: 'Special batch created successfully',
      data: populatedBatch
    });
  } catch (error) {
    next(error);
  }
});

// @route   PUT /api/special-batches/:id
// @desc    Update special batch details
// @access  Private (SuperAdmin, Teacher)
router.put('/:id', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const { name, subject, description, students, schedule, status, instructor, batch_fee } = req.body;

    let batch = await SpecialBatch.findById(req.params.id);
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Special batch not found' });
    }

    if (req.user.role === 'Teacher' && batch.instructor.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized to edit this batch' });
    }

    const fieldsToUpdate = {};
    if (name) fieldsToUpdate.name = name;
    if (subject) fieldsToUpdate.subject = subject;
    if (description !== undefined) fieldsToUpdate.description = description;
    if (students) fieldsToUpdate.students = students;
    if (schedule) fieldsToUpdate.schedule = schedule;
    if (status) fieldsToUpdate.status = status;
    if (batch_fee !== undefined) fieldsToUpdate.batch_fee = Number(batch_fee);
    if (instructor && req.user.role === 'SuperAdmin') fieldsToUpdate.instructor = instructor;

    batch = await SpecialBatch.findByIdAndUpdate(req.params.id, fieldsToUpdate, {
      new: true,
      runValidators: true
    })
      .populate('instructor', 'email role profile_pic')
      .populate('students', 'name roll_number class_level');

    res.json({
      success: true,
      message: 'Special batch updated successfully',
      data: batch
    });
  } catch (error) {
    next(error);
  }
});

// @route   DELETE /api/special-batches/:id
// @desc    Delete a special batch
// @access  Private (SuperAdmin, Teacher)
router.delete('/:id', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const batch = await SpecialBatch.findById(req.params.id);
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Special batch not found' });
    }

    if (req.user.role === 'Teacher' && batch.instructor.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this batch' });
    }

    await SpecialBatch.findByIdAndDelete(req.params.id);

    res.json({ success: true, message: 'Special batch removed successfully' });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/special-batches/:id/students
// @desc    Add students to special batch
// @access  Private (SuperAdmin, Teacher)
router.post('/:id/students', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const { studentIds } = req.body;
    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Please provide array of student IDs' });
    }

    const batch = await SpecialBatch.findById(req.params.id);
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Special batch not found' });
    }

    const currentStudentSet = new Set(batch.students.map(s => s.toString()));
    studentIds.forEach(id => currentStudentSet.add(id.toString()));

    batch.students = Array.from(currentStudentSet);
    await batch.save();

    const updatedBatch = await SpecialBatch.findById(req.params.id)
      .populate('instructor', 'email role profile_pic')
      .populate('students', 'name roll_number class_level');

    res.json({
      success: true,
      message: 'Students added to special batch',
      data: updatedBatch
    });
  } catch (error) {
    next(error);
  }
});

// @route   DELETE /api/special-batches/:id/students/:studentId
// @desc    Remove a student from special batch
// @access  Private (SuperAdmin, Teacher)
router.delete('/:id/students/:studentId', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const batch = await SpecialBatch.findById(req.params.id);
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Special batch not found' });
    }

    batch.students = batch.students.filter(s => s.toString() !== req.params.studentId);
    await batch.save();

    const updatedBatch = await SpecialBatch.findById(req.params.id)
      .populate('instructor', 'email role profile_pic')
      .populate('students', 'name roll_number class_level');

    res.json({
      success: true,
      message: 'Student removed from special batch',
      data: updatedBatch
    });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/special-batches/:id/extra-lessons
// @desc    Add extra lesson / LMS study material (with optional file upload)
// @access  Private (SuperAdmin, Teacher)
router.post('/:id/extra-lessons', protect, authorize('SuperAdmin', 'Teacher'), upload.single('file'), async (req, res, next) => {
  try {
    const { title, content, file_url: providedUrl, workflow_stage } = req.body;
    if (!title) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'Lesson title is required' });
    }

    const batch = await SpecialBatch.findById(req.params.id);
    if (!batch) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(404).json({ success: false, message: 'Special batch not found' });
    }

    let finalFileUrl = providedUrl || '';
    let filename = '';
    let filesize = '';

    if (req.file) {
      finalFileUrl = await uploadToCloud(req.file.path, 'handouts');
      filename = req.file.originalname;
      filesize = (req.file.size / 1024).toFixed(1) + ' KB';
    }

    batch.extra_lessons.unshift({
      title,
      content: content || '',
      file_url: finalFileUrl,
      filename,
      filesize,
      workflow_stage: workflow_stage || 'Notes Distributed',
      date: new Date()
    });

    await batch.save();

    // Broadcast new study material event via Socket.IO
    const io = getIO();
    if (io) {
      io.to(`BATCH_${batch._id}`).emit('new_study_material', {
        batchId: batch._id,
        title,
        material: batch.extra_lessons[0]
      });
    }

    res.status(201).json({
      success: true,
      message: 'Study material added to batch',
      data: batch
    });
  } catch (error) {
    next(error);
  }
});

// @route   PUT /api/special-batches/:id/extra-lessons/:lessonId
// @desc    Update study material stage or details
// @access  Private (SuperAdmin, Teacher)
router.put('/:id/extra-lessons/:lessonId', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const { title, content, workflow_stage } = req.body;
    const batch = await SpecialBatch.findById(req.params.id);
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Special batch not found' });
    }

    const lesson = batch.extra_lessons.id(req.params.lessonId);
    if (!lesson) {
      return res.status(404).json({ success: false, message: 'Study material not found' });
    }

    if (title) lesson.title = title;
    if (content !== undefined) lesson.content = content;
    if (workflow_stage) lesson.workflow_stage = workflow_stage;

    await batch.save();

    res.json({
      success: true,
      message: 'Study material updated',
      data: batch
    });
  } catch (error) {
    next(error);
  }
});

// @route   DELETE /api/special-batches/:id/extra-lessons/:lessonId
// @desc    Delete study material
// @access  Private (SuperAdmin, Teacher)
router.delete('/:id/extra-lessons/:lessonId', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const batch = await SpecialBatch.findById(req.params.id);
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Special batch not found' });
    }

    const lesson = batch.extra_lessons.id(req.params.lessonId);
    if (lesson && lesson.file_url) {
      await deleteFromCloud(lesson.file_url);
    }

    batch.extra_lessons.pull(req.params.lessonId);
    await batch.save();

    res.json({
      success: true,
      message: 'Study material deleted',
      data: batch
    });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/special-batches/:id/attendance
// @desc    Record daily attendance sheet for special batch
// @access  Private (SuperAdmin, Teacher)
router.post('/:id/attendance', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const { date, session_name, records } = req.body; // records: [{ student: id, status: 'Present'|'Absent'|'Late'|'Excused', remarks: '' }]
    if (!records || !Array.isArray(records)) {
      return res.status(400).json({ success: false, message: 'Attendance records array is required' });
    }

    const batch = await SpecialBatch.findById(req.params.id);
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Special batch not found' });
    }

    const session = session_name || 'Session 1';
    const targetDateStr = new Date(date || Date.now()).toISOString().substring(0, 10);
    const existingIndex = batch.attendance_records.findIndex(r => 
      new Date(r.date).toISOString().substring(0, 10) === targetDateStr &&
      (r.session_name || 'Session 1') === session
    );

    if (existingIndex > -1) {
      batch.attendance_records[existingIndex].records = records;
      batch.attendance_records[existingIndex].session_name = session;
    } else {
      batch.attendance_records.unshift({
        date: new Date(date || Date.now()),
        session_name: session,
        records
      });
    }

    await batch.save();

    const updatedBatch = await SpecialBatch.findById(req.params.id)
      .populate('students', 'name roll_number class_level')
      .populate('attendance_records.records.student', 'name roll_number class_level');

    res.json({
      success: true,
      message: 'Batch attendance committed successfully',
      data: updatedBatch
    });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/special-batches/:id/test-scores
// @desc    Record exam test score entry for special batch
// @access  Private (SuperAdmin, Teacher)
router.post('/:id/test-scores', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const { test_name, subject, total_marks, date, scores } = req.body; // scores: [{ student: id, marks_obtained: num }]
    if (!test_name || !total_marks || !scores || !Array.isArray(scores)) {
      return res.status(400).json({ success: false, message: 'Test name, total marks, and student scores are required' });
    }

    const batch = await SpecialBatch.findById(req.params.id);
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Special batch not found' });
    }

    batch.test_scores.unshift({
      test_name,
      subject: subject || batch.subject,
      total_marks: Number(total_marks),
      date: date ? new Date(date) : new Date(),
      scores: scores.map(s => ({
        student: s.student,
        marks_obtained: Number(s.marks_obtained || 0)
      }))
    });

    await batch.save();

    const updatedBatch = await SpecialBatch.findById(req.params.id)
      .populate('students', 'name roll_number class_level')
      .populate('test_scores.scores.student', 'name roll_number class_level');

    res.status(201).json({
      success: true,
      message: 'Batch test marks committed successfully',
      data: updatedBatch
    });
  } catch (error) {
    next(error);
  }
});

// @route   DELETE /api/special-batches/:id/test-scores/:testId
// @desc    Remove exam test record from special batch
// @access  Private (SuperAdmin, Teacher)
router.delete('/:id/test-scores/:testId', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const batch = await SpecialBatch.findById(req.params.id);
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Special batch not found' });
    }

    batch.test_scores.pull(req.params.testId);
    await batch.save();

    res.json({
      success: true,
      message: 'Test record removed successfully',
      data: batch
    });
  } catch (error) {
    next(error);
  }
});

// @route   DELETE /api/special-batches/:id/schedule/:slotId
// @desc    Remove timetable schedule slot from special batch
// @access  Private (SuperAdmin, Teacher)
router.delete('/:id/schedule/:slotId', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const batch = await SpecialBatch.findById(req.params.id);
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Special batch not found' });
    }

    if (req.user.role === 'Teacher' && batch.instructor.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized to edit this batch' });
    }

    batch.schedule.pull(req.params.slotId);
    await batch.save();

    res.json({
      success: true,
      message: 'Schedule slot removed successfully',
      data: batch
    });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/special-batches/:id/trigger-report
// @desc    Trigger email progress report for students in a special batch
// @access  Private (SuperAdmin, Teacher)
router.post('/:id/trigger-report', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const batch = await SpecialBatch.findById(req.params.id)
      .populate('students', 'name parent_name primary_contact class_level user')
      .populate('attendance_records.records.student', 'name')
      .populate('test_scores.scores.student', 'name');

    if (!batch) {
      return res.status(404).json({ success: false, message: 'Special batch not found' });
    }

    let sentCount = 0;
    const errors = [];

    // Process each student in the batch
    for (const student of batch.students) {
      if (!student || !student._id) continue;
      
      // Calculate student batch attendance
      let totalSessions = 0;
      let attendedSessions = 0;
      batch.attendance_records.forEach(att => {
        const rec = att.records.find(r => r.student && (r.student._id || r.student).toString() === student._id.toString());
        if (rec) {
          totalSessions++;
          if (rec.status === 'Present' || rec.status === 'Late') attendedSessions++;
        }
      });
      const attendancePct = totalSessions > 0 ? ((attendedSessions / totalSessions) * 100).toFixed(1) : '100.0';

      // Calculate student batch test marks
      let totalMarksGot = 0;
      let totalMarksPossible = 0;
      let testCount = 0;
      batch.test_scores.forEach(ts => {
        const scoreRec = ts.scores.find(s => s.student && (s.student._id || s.student).toString() === student._id.toString());
        if (scoreRec) {
          totalMarksGot += scoreRec.marks_obtained;
          totalMarksPossible += ts.total_marks;
          testCount++;
        }
      });
      const testAvgPct = totalMarksPossible > 0 ? ((totalMarksGot / totalMarksPossible) * 100).toFixed(1) : 'N/A';

      // Target email address
      let targetEmail = student.primary_contact;
      if (!targetEmail || !targetEmail.includes('@')) {
        targetEmail = `${student.name.toLowerCase().replace(/\s+/g, '')}@edustride.edu`;
      }

      const reportHtml = `
        <div style="font-family: Arial, sans-serif; background-color: #07080a; color: #f8fafc; padding: 24px; borderRadius: 16px;">
          <h2 style="color: #6366f1;">EduStride Special Batch Progress Summary</h2>
          <p>Dear Parent / Guardian of <strong>${student.name}</strong>,</p>
          <p>Here is the academic and attendance progress update for <strong>${student.name}</strong> in special batch <strong>${batch.name} (${batch.subject})</strong>:</p>
          
          <table style="width: 100%; border-collapse: collapse; margin-top: 16px; margin-bottom: 16px;">
            <tr style="background-color: #1a1c29; color: #cbd5e1;">
              <th style="padding: 10px; border: 1px solid #2c3154; text-align: left;">Metric</th>
              <th style="padding: 10px; border: 1px solid #2c3154; text-align: left;">Value</th>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #2c3154;">Batch Attendance Rate</td>
              <td style="padding: 10px; border: 1px solid #2c3154; font-weight: bold; color: ${attendancePct >= 75 ? '#34d399' : '#f43f5e'};">${attendancePct}% (${attendedSessions}/${totalSessions} sessions)</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #2c3154;">Batch Exam Average</td>
              <td style="padding: 10px; border: 1px solid #2c3154; font-weight: bold; color: #818cf8;">${testAvgPct === 'N/A' ? 'N/A' : testAvgPct + '%'} (${testCount} exams)</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #2c3154;">Curriculum Materials Available</td>
              <td style="padding: 10px; border: 1px solid #2c3154;">${batch.extra_lessons?.length || 0} handouts</td>
            </tr>
          </table>
          
          <p style="color: #94a3b8; font-size: 12px;">This is an automated notification from the EduStride Academic Management Platform.</p>
        </div>
      `;

      try {
        await sendEmail({
          from: '"EduStride Special Batches" <no-reply@edustride.edu>',
          to: targetEmail,
          subject: `Academic Progress Update: ${student.name} - ${batch.name}`,
          html: reportHtml
        });
        sentCount++;
      } catch (err) {
        console.error(`Failed to send email to ${targetEmail}:`, err.message);
        errors.push(`${student.name}: ${err.message}`);
      }
    }

    res.json({
      success: true,
      message: `Progress report dispatched to ${sentCount} parents for batch ${batch.name}`,
      sentCount,
      errors
    });
  } catch (error) {
    next(error);
  }
});

export default router;
