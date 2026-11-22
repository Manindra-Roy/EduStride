import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import SpecialBatch from '../models/SpecialBatch.js';
import Student from '../models/Student.js';
import User from '../models/User.js';
import ChatMessage from '../models/ChatMessage.js';
import { protect, authorize } from '../middleware/auth.js';
import { uploadToCloud, deleteFromCloud } from '../services/cloudStorage.js';
import { getIO } from '../config/socket.js';
import { sendEmail } from '../services/mailService.js';
import { getISTParts } from '../services/attendanceSync.js';
import { escapeHtml } from '../utils/html.js';

const router = express.Router();

const ALLOWED_BATCH_MIMES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp'
]);

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
  const mime = (file.mimetype || '').toLowerCase();
  if (allowedExtensions.includes(ext) && ALLOWED_BATCH_MIMES.has(mime)) {
    cb(null, true);
  } else {
    const err = new Error('Only document files (.pdf, .doc, .docx, .txt) and images are allowed');
    err.statusCode = 400;
    cb(err, false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 15 * 1024 * 1024 }
});

// Enforce batch ownership: SuperAdmin OR the batch's assigned instructor
const ensureBatchAccess = (req, batch) => {
  if (!req.user || !batch) return false;
  if (req.user.role === 'SuperAdmin') return true;
  const instructorId = batch.instructor?._id?.toString() || batch.instructor?.toString() || '';
  return Boolean(instructorId && instructorId === req.user._id.toString());
};

const isOwnedUploadAsset = (lesson) => {
  if (!lesson || !lesson.file_url) return false;
  if (lesson.is_uploaded_asset === true) return true;
  if (lesson.is_uploaded_asset === false) return false;
  // Legacy records before is_uploaded_asset existed: only delete clearly owned uploads
  return lesson.file_url.startsWith('/uploads/') || lesson.file_url.includes('res.cloudinary.com');
};

const validateExternalUrl = (rawUrl) => {
  if (!rawUrl) return '';
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  if (trimmed.includes('/uploads/') || trimmed.includes('..')) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
};

const computeBatchWithStats = (batch, { isStudent = false, selfStudentId = '' } = {}) => {
  const batchObj = batch.toObject();
  const validStudents = (batchObj.students || []).filter(std => std != null && std._id != null);

  const studentStats = validStudents.map(std => {
    const stdIdStr = std._id.toString();
    let totalSessions = 0;
    let attendedSessions = 0;
    batchObj.attendance_records?.forEach(att => {
      const rec = att.records?.find(r => r.student && ((r.student._id || r.student).toString() === stdIdStr));
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
      const scoreRec = ts.scores?.find(s => s.student && ((s.student._id || s.student).toString() === stdIdStr));
      if (scoreRec && ts.total_marks > 0) {
        totalMarksGot += scoreRec.marks_obtained;
        totalMarksPossible += ts.total_marks;
        testCount++;
      }
    });
    const testAvgPct = totalMarksPossible > 0 ? (totalMarksGot / totalMarksPossible) * 100 : 0;
    const meritScore = (testAvgPct * 0.8) + (attendancePct * 0.2);

    const sanitizedStd = { ...std };
    if (isStudent && stdIdStr !== selfStudentId) {
      if ('primary_contact' in sanitizedStd) {
        sanitizedStd.primary_contact = 'Private';
      }
    }

    return {
      ...sanitizedStd,
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

  // For Student role, filter attendance_records and test_scores to ONLY their own entries
  if (isStudent && selfStudentId) {
    batchObj.attendance_records = (batchObj.attendance_records || []).map(att => ({
      ...att,
      records: (att.records || []).filter(
        r => r.student && (r.student._id || r.student).toString() === selfStudentId
      )
    }));
    batchObj.test_scores = (batchObj.test_scores || []).map(ts => ({
      ...ts,
      scores: (ts.scores || []).filter(
        s => s.student && (s.student._id || s.student).toString() === selfStudentId
      )
    }));
  }

  return batchObj;
};

// @route   GET /api/special-batches
// @desc    Get list of special batches (filtered by user role and membership)
// @access  Private
router.get('/', protect, async (req, res, next) => {
  try {
    const filter = {};
    let selfStudentId = '';

    if (req.user.role === 'Student') {
      if (!req.user.studentProfile) {
        return res.json({ success: true, count: 0, data: [] });
      }
      const studentProfile = await Student.findById(req.user.studentProfile).select('_id').lean();
      if (!studentProfile) {
        return res.json({ success: true, count: 0, data: [] });
      }
      selfStudentId = studentProfile._id.toString();
      filter.students = studentProfile._id;
    } else if (req.user.role === 'Teacher') {
      if (req.query.my_batches === 'true') {
        filter.instructor = req.user._id;
      }
    }

    if (typeof req.query.status === 'string' && ['Active', 'Completed', 'Archived'].includes(req.query.status)) {
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

    const isStudent = req.user.role === 'Student';
    const computedBatches = batches.map(batch =>
      computeBatchWithStats(batch, { isStudent, selfStudentId })
    );

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

    let selfStudentId = '';
    const isStudent = req.user.role === 'Student';

    if (isStudent) {
      if (!req.user.studentProfile) {
        return res.status(403).json({ success: false, message: 'You are not enrolled in this special batch' });
      }
      const studentProfile = await Student.findById(req.user.studentProfile).select('_id').lean();
      if (!studentProfile || !batch.students.some(s => s && s._id && s._id.toString() === studentProfile._id.toString())) {
        return res.status(403).json({ success: false, message: 'You are not enrolled in this special batch' });
      }
      selfStudentId = studentProfile._id.toString();
    }

    const batchObj = computeBatchWithStats(batch, { isStudent, selfStudentId });
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
    const { name, subject, description, students, schedule, status, batch_fee } = req.body || {};

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
// @access  Private (SuperAdmin, owning Teacher)
router.put('/:id', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const { name, subject, description, students, schedule, status, instructor, batch_fee } = req.body || {};

    let batch = await SpecialBatch.findById(req.params.id);
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Special batch not found' });
    }

    if (!ensureBatchAccess(req, batch)) {
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

    batch = await SpecialBatch.findByIdAndUpdate(req.params.id, { $set: fieldsToUpdate }, {
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
// @desc    Delete a special batch (and clean up uploaded assets & batch chat)
// @access  Private (SuperAdmin, owning Teacher)
router.delete('/:id', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const batch = await SpecialBatch.findById(req.params.id);
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Special batch not found' });
    }

    if (!ensureBatchAccess(req, batch)) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this batch' });
    }

    // Delete uploaded cloud/local assets attached to extra_lessons
    for (const lesson of batch.extra_lessons || []) {
      if (isOwnedUploadAsset(lesson)) {
        await deleteFromCloud(lesson.file_url);
      }
    }

    // Delete batch chat messages
    await ChatMessage.deleteMany({
      class_level: { $in: [`BATCH_${batch._id}`, String(batch._id)] }
    });

    await SpecialBatch.findByIdAndDelete(req.params.id);

    res.json({ success: true, message: 'Special batch removed successfully' });
  } catch (error) {
    next(error);
  }
});

// @route   POST /api/special-batches/:id/students
// @desc    Add students to special batch
// @access  Private (SuperAdmin, owning Teacher)
router.post('/:id/students', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const { studentIds } = req.body || {};
    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Please provide array of student IDs' });
    }

    const batch = await SpecialBatch.findById(req.params.id);
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Special batch not found' });
    }

    if (!ensureBatchAccess(req, batch)) {
      return res.status(403).json({ success: false, message: 'Not authorized to modify this batch' });
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
// @access  Private (SuperAdmin, owning Teacher)
router.delete('/:id/students/:studentId', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const batch = await SpecialBatch.findById(req.params.id);
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Special batch not found' });
    }

    if (!ensureBatchAccess(req, batch)) {
      return res.status(403).json({ success: false, message: 'Not authorized to modify this batch' });
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
// @access  Private (SuperAdmin, owning Teacher)
router.post('/:id/extra-lessons', protect, authorize('SuperAdmin', 'Teacher'), upload.single('file'), async (req, res, next) => {
  let uploadedFileUrl = null;
  try {
    const { title, subject, chapter_name, content, file_url: providedUrl, workflow_stage } = req.body || {};
    if (!title || typeof title !== 'string' || !title.trim()) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'Lesson title is required' });
    }

    const batch = await SpecialBatch.findById(req.params.id);
    if (!batch) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(404).json({ success: false, message: 'Special batch not found' });
    }

    if (!ensureBatchAccess(req, batch)) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(403).json({ success: false, message: 'Not authorized to modify this batch' });
    }

    let finalFileUrl = '';
    let filename = '';
    let filesize = '';
    let isUploadedAsset = false;

    if (req.file) {
      uploadedFileUrl = await uploadToCloud(req.file.path, 'handouts');
      finalFileUrl = uploadedFileUrl;
      filename = req.file.originalname;
      filesize = (req.file.size / 1024).toFixed(1) + ' KB';
      isUploadedAsset = true;
    } else if (providedUrl) {
      const validatedUrl = validateExternalUrl(providedUrl);
      if (validatedUrl === null) {
        return res.status(400).json({
          success: false,
          message: 'External file_url must be a valid http(s) URL and cannot point to internal /uploads/ paths'
        });
      }
      finalFileUrl = validatedUrl;
      isUploadedAsset = false;
    }

    const cleanTitle = title.trim();
    const cleanSubject = typeof subject === 'string' && subject.trim() ? subject.trim() : (batch.subject || '');
    const cleanChapter = typeof chapter_name === 'string' ? chapter_name.trim() : '';

    batch.extra_lessons.unshift({
      title: cleanTitle,
      subject: cleanSubject,
      chapter_name: cleanChapter,
      content: typeof content === 'string' ? content : '',
      file_url: finalFileUrl,
      filename,
      filesize,
      is_uploaded_asset: isUploadedAsset,
      workflow_stage: workflow_stage || 'Notes Distributed',
      date: new Date()
    });

    await batch.save();

    // Broadcast enriched new study material event via Socket.IO
    const io = getIO();
    if (io) {
      io.to(`BATCH_${batch._id}`).emit('new_study_material', {
        batchId: String(batch._id),
        batch_name: batch.name,
        class_level: `BATCH_${batch._id}`,
        subject: batch.subject || 'Special Batch',
        chapter_name: cleanChapter || cleanTitle,
        title: cleanTitle,
        isSpecialBatch: true,
        material: batch.extra_lessons[0]
      });
    }

    res.status(201).json({
      success: true,
      message: 'Study material added to batch',
      data: batch
    });
  } catch (error) {
    if (uploadedFileUrl) {
      await deleteFromCloud(uploadedFileUrl).catch(() => {});
    } else if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    }
    next(error);
  }
});

// @route   PUT /api/special-batches/:id/extra-lessons/:lessonId
// @desc    Update study material stage or details
// @access  Private (SuperAdmin, owning Teacher)
router.put('/:id/extra-lessons/:lessonId', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const { title, subject, chapter_name, content, workflow_stage } = req.body || {};
    const batch = await SpecialBatch.findById(req.params.id);
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Special batch not found' });
    }

    if (!ensureBatchAccess(req, batch)) {
      return res.status(403).json({ success: false, message: 'Not authorized to modify this batch' });
    }

    const lesson = batch.extra_lessons.id(req.params.lessonId);
    if (!lesson) {
      return res.status(404).json({ success: false, message: 'Study material not found' });
    }

    if (typeof title === 'string' && title.trim()) lesson.title = title.trim();
    if (typeof subject === 'string') lesson.subject = subject.trim();
    if (typeof chapter_name === 'string') lesson.chapter_name = chapter_name.trim();
    if (content !== undefined) lesson.content = String(content);
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
// @access  Private (SuperAdmin, owning Teacher)
router.delete('/:id/extra-lessons/:lessonId', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const batch = await SpecialBatch.findById(req.params.id);
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Special batch not found' });
    }

    if (!ensureBatchAccess(req, batch)) {
      return res.status(403).json({ success: false, message: 'Not authorized to modify this batch' });
    }

    const lesson = batch.extra_lessons.id(req.params.lessonId);
    if (!lesson) {
      return res.status(404).json({ success: false, message: 'Study material not found' });
    }

    if (isOwnedUploadAsset(lesson)) {
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
// @access  Private (SuperAdmin, owning Teacher)
router.post('/:id/attendance', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const { date, session_name, records } = req.body || {};
    if (!records || !Array.isArray(records)) {
      return res.status(400).json({ success: false, message: 'Attendance records array is required' });
    }

    const batch = await SpecialBatch.findById(req.params.id);
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Special batch not found' });
    }

    if (!ensureBatchAccess(req, batch)) {
      return res.status(403).json({ success: false, message: 'Not authorized to modify this batch' });
    }

    let targetDateStr;
    let parsedDate;
    if (date !== undefined && date !== null && String(date).trim() !== '') {
      const cleanStr = String(date).trim().split('T')[0];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanStr)) {
        return res.status(400).json({ success: false, message: 'Invalid date format. Expected YYYY-MM-DD' });
      }
      parsedDate = new Date(`${cleanStr}T00:00:00.000Z`);
      if (isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== cleanStr) {
        return res.status(400).json({ success: false, message: 'Invalid calendar date' });
      }
      targetDateStr = cleanStr;
    } else {
      targetDateStr = getISTParts().dateStr;
      parsedDate = new Date(`${targetDateStr}T00:00:00.000Z`);
    }

    const session = (typeof session_name === 'string' && session_name.trim()) ? session_name.trim() : 'Session 1';
    const existingIndex = batch.attendance_records.findIndex(r =>
      new Date(r.date).toISOString().substring(0, 10) === targetDateStr &&
      (r.session_name || 'Session 1') === session
    );

    if (existingIndex > -1) {
      batch.attendance_records[existingIndex].records = records;
      batch.attendance_records[existingIndex].session_name = session;
    } else {
      batch.attendance_records.unshift({
        date: parsedDate,
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
// @access  Private (SuperAdmin, owning Teacher)
router.post('/:id/test-scores', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const { test_name, subject, total_marks, passing_marks, date, scores } = req.body || {};
    const totalNum = Number(total_marks);
    if (!test_name || !Number.isFinite(totalNum) || totalNum <= 0 || !scores || !Array.isArray(scores)) {
      return res.status(400).json({ success: false, message: 'Test name, a positive total marks value, and student scores are required' });
    }

    let passingNum = 40;
    if (passing_marks !== undefined && passing_marks !== null && passing_marks !== '') {
      const parsedPassing = Number(passing_marks);
      if (!Number.isFinite(parsedPassing) || parsedPassing < 0 || parsedPassing > totalNum) {
        return res.status(400).json({ success: false, message: `Passing marks must be between 0 and ${totalNum}` });
      }
      passingNum = parsedPassing;
    } else {
      passingNum = Math.min(40, totalNum);
    }

    for (const s of scores) {
      const obtained = Number(s.marks_obtained || 0);
      if (!Number.isFinite(obtained) || obtained < 0 || obtained > totalNum) {
        return res.status(400).json({ success: false, message: `Marks obtained must be between 0 and ${totalNum}` });
      }
    }

    const batch = await SpecialBatch.findById(req.params.id);
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Special batch not found' });
    }

    if (!ensureBatchAccess(req, batch)) {
      return res.status(403).json({ success: false, message: 'Not authorized to modify this batch' });
    }

    batch.test_scores.unshift({
      test_name,
      subject: subject || batch.subject,
      total_marks: totalNum,
      passing_marks: passingNum,
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
// @access  Private (SuperAdmin, owning Teacher)
router.delete('/:id/test-scores/:testId', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const batch = await SpecialBatch.findById(req.params.id);
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Special batch not found' });
    }

    if (!ensureBatchAccess(req, batch)) {
      return res.status(403).json({ success: false, message: 'Not authorized to modify this batch' });
    }

    const testDoc = batch.test_scores.id(req.params.testId);
    if (!testDoc) {
      return res.status(404).json({ success: false, message: 'Test record not found' });
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
// @access  Private (SuperAdmin, owning Teacher)
router.delete('/:id/schedule/:slotId', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const batch = await SpecialBatch.findById(req.params.id);
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Special batch not found' });
    }

    if (!ensureBatchAccess(req, batch)) {
      return res.status(403).json({ success: false, message: 'Not authorized to edit this batch' });
    }

    const slotDoc = batch.schedule.id(req.params.slotId);
    if (!slotDoc) {
      return res.status(404).json({ success: false, message: 'Schedule slot not found' });
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
// @access  Private (SuperAdmin, owning Teacher)
router.post('/:id/trigger-report', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const batch = await SpecialBatch.findById(req.params.id)
      .populate('students', 'name parent_name parent_email primary_contact class_level')
      .populate('attendance_records.records.student', 'name')
      .populate('test_scores.scores.student', 'name');

    if (!batch) {
      return res.status(404).json({ success: false, message: 'Special batch not found' });
    }

    if (!ensureBatchAccess(req, batch)) {
      return res.status(403).json({ success: false, message: 'Not authorized to trigger reports for this batch' });
    }

    // Batch-fetch linked User accounts in one query (eliminates N+1)
    const validStudents = (batch.students || []).filter(s => s && s._id);
    const linkedUsers = await User.find({
      studentProfile: { $in: validStudents.map(s => s._id) }
    }).select('studentProfile email').lean();
    const userEmailByStudentId = new Map();
    for (const u of linkedUsers) {
      if (u.studentProfile && u.email) {
        userEmailByStudentId.set(String(u.studentProfile), u.email);
      }
    }

    let sentCount = 0;
    const errors = [];

    const safeBatchName = escapeHtml(batch.name);
    const safeBatchSubject = escapeHtml(batch.subject);

    for (const student of validStudents) {
      let totalSessions = 0;
      let attendedSessions = 0;
      batch.attendance_records.forEach(att => {
        const rec = att.records.find(r => r.student && (r.student._id || r.student).toString() === student._id.toString());
        if (rec) {
          totalSessions++;
          if (rec.status === 'Present' || rec.status === 'Late') attendedSessions++;
        }
      });
      const attendancePctNum = totalSessions > 0 ? (attendedSessions / totalSessions) * 100 : 100;
      const attendancePct = attendancePctNum.toFixed(1);

      let totalMarksGot = 0;
      let totalMarksPossible = 0;
      let testCount = 0;
      batch.test_scores.forEach(ts => {
        const scoreRec = ts.scores.find(s => s.student && (s.student._id || s.student).toString() === student._id.toString());
        if (scoreRec && ts.total_marks > 0) {
          totalMarksGot += scoreRec.marks_obtained;
          totalMarksPossible += ts.total_marks;
          testCount++;
        }
      });
      const testAvgPct = totalMarksPossible > 0 ? ((totalMarksGot / totalMarksPossible) * 100).toFixed(1) : 'N/A';

      // Prioritize dedicated parent_email, then linked User email, then email-like primary_contact
      const dedicatedParentEmail = student.parent_email && student.parent_email.includes('@')
        ? student.parent_email.trim()
        : '';
      const linkedUserEmail = userEmailByStudentId.get(String(student._id)) || '';
      const contactEmail = student.primary_contact && student.primary_contact.includes('@')
        ? student.primary_contact.trim()
        : '';
      const targetEmail = dedicatedParentEmail || linkedUserEmail || contactEmail || null;

      if (!targetEmail) {
        errors.push(`${student.name}: No registered email address found`);
        continue;
      }

      const safeStudentName = escapeHtml(student.name);

      const reportHtml = `
        <div style="font-family: Arial, sans-serif; background-color: #07080a; color: #f8fafc; padding: 24px; border-radius: 16px;">
          <h2 style="color: #6366f1;">EduStride Special Batch Progress Summary</h2>
          <p>Dear Parent / Guardian of <strong>${safeStudentName}</strong>,</p>
          <p>Here is the academic and attendance progress update for <strong>${safeStudentName}</strong> in special batch <strong>${safeBatchName} (${safeBatchSubject})</strong>:</p>
          
          <table style="width: 100%; border-collapse: collapse; margin-top: 16px; margin-bottom: 16px;">
            <tr style="background-color: #1a1c29; color: #cbd5e1;">
              <th style="padding: 10px; border: 1px solid #2c3154; text-align: left;">Metric</th>
              <th style="padding: 10px; border: 1px solid #2c3154; text-align: left;">Value</th>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #2c3154;">Batch Attendance Rate</td>
              <td style="padding: 10px; border: 1px solid #2c3154; font-weight: bold; color: ${attendancePctNum >= 75 ? '#34d399' : '#f43f5e'};">${attendancePct}% (${attendedSessions}/${totalSessions} sessions)</td>
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
