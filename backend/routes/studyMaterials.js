import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import StudyMaterial from '../models/StudyMaterial.js';
import Student from '../models/Student.js';
import { protect, authorize } from '../middleware/auth.js';
import { uploadToCloud, deleteFromCloud } from '../services/cloudStorage.js';
import { getIO } from '../config/socket.js';

const router = express.Router();

const ALLOWED_MATERIAL_MIMES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/jpg'
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// File filter (accept PDF, Word, images, text — validates both extension & MIME type)
const fileFilter = (req, file, cb) => {
  const allowedExtensions = ['.pdf', '.doc', '.docx', '.txt', '.png', '.jpg', '.jpeg'];
  const ext = path.extname(file.originalname).toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();
  if (allowedExtensions.includes(ext) && ALLOWED_MATERIAL_MIMES.has(mime)) {
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
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB limit
});

// @desc    Get study materials (with filters for student/class)
// @route   GET /api/study-materials
// @access  Private
router.get('/', protect, async (req, res, next) => {
  try {
    const { class_level, subject } = req.query;
    const query = {};

    if (req.user.role === 'Student') {
      query.status = { $ne: 'Drafting' };
      if (req.user.studentProfile) {
        const student = await Student.findById(req.user.studentProfile);
        if (student) {
          query.class_level = student.class_level;
        } else {
          return res.json({ success: true, data: [] });
        }
      } else {
        return res.json({ success: true, data: [] });
      }
    } else if (typeof class_level === 'string' && class_level.trim() && class_level !== 'All') {
      query.class_level = class_level.trim().toUpperCase();
    }

    if (typeof subject === 'string' && subject.trim()) {
      query.subject = subject.trim();
    }

    const materials = await StudyMaterial.find(query).sort({ uploaded_at: -1 });
    res.json({ success: true, data: materials });
  } catch (error) {
    next(error);
  }
});

// @desc    Upload new study material
// @route   POST /api/study-materials/upload
// @access  Private (Admin/Teacher)
router.post('/upload', protect, authorize('SuperAdmin', 'Teacher'), upload.single('file'), async (req, res, next) => {
  let uploadedFileUrl = null;
  try {
    if (!req.file) {
      res.status(400);
      throw new Error('Please upload a file');
    }

    const { class_level, subject, chapter_name, status } = req.body || {};
    if (
      typeof class_level !== 'string' || !class_level.trim() ||
      typeof subject !== 'string' || !subject.trim() ||
      typeof chapter_name !== 'string' || !chapter_name.trim()
    ) {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(400);
      throw new Error('Please provide class_level, subject, and chapter_name');
    }

    const cleanClass = class_level.trim().toUpperCase();
    const cleanSubject = subject.trim();
    const cleanChapter = chapter_name.trim();

    uploadedFileUrl = await uploadToCloud(req.file.path, 'handouts');

    const material = await StudyMaterial.create({
      class_level: cleanClass,
      subject: cleanSubject,
      chapter_name: cleanChapter,
      status: typeof status === 'string' && status.trim() ? status.trim() : 'Drafting',
      file_url: uploadedFileUrl,
      file_name: req.file.originalname
    });

    // Notify class students via Socket.IO if published/distributed
    if (material.status !== 'Drafting') {
      const io = getIO();
      if (io) {
        io.to(cleanClass).emit('new_study_material', {
          class_level: cleanClass,
          subject: cleanSubject,
          chapter_name: cleanChapter,
          file_name: req.file.originalname,
          material
        });
      }
    }

    res.status(201).json({
      success: true,
      data: material
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

// @desc    Update study material (e.g., status/chapter) — whitelisted fields only
// @route   PUT /api/study-materials/:id
// @access  Private (Admin/Teacher)
router.put('/:id', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const material = await StudyMaterial.findById(req.params.id);
    if (!material) {
      res.status(404);
      throw new Error('Study material not found');
    }

    const oldStatus = material.status;
    const { class_level, subject, chapter_name, status } = req.body || {};

    const updateFields = {};
    if (typeof class_level === 'string' && class_level.trim()) {
      updateFields.class_level = class_level.trim().toUpperCase();
    }
    if (typeof subject === 'string' && subject.trim()) {
      updateFields.subject = subject.trim();
    }
    if (typeof chapter_name === 'string' && chapter_name.trim()) {
      updateFields.chapter_name = chapter_name.trim();
    }
    if (typeof status === 'string' && status.trim()) {
      updateFields.status = status.trim();
    }

    const updated = await StudyMaterial.findByIdAndUpdate(
      req.params.id,
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    // Notify class students if status is updated to something other than Drafting
    if (updateFields.status && updateFields.status !== 'Drafting' && oldStatus !== updateFields.status) {
      const io = getIO();
      if (io) {
        io.to(updated.class_level).emit('new_study_material', {
          class_level: updated.class_level,
          subject: updated.subject,
          chapter_name: updated.chapter_name,
          file_name: updated.file_name,
          material: updated,
          isUpdate: true
        });
      }
    }

    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

// @desc    Delete study material
// @route   DELETE /api/study-materials/:id
// @access  Private (Admin/Teacher)
router.delete('/:id', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const material = await StudyMaterial.findById(req.params.id);
    if (!material) {
      res.status(404);
      throw new Error('Study material not found');
    }

    await deleteFromCloud(material.file_url);
    await StudyMaterial.findByIdAndDelete(req.params.id);

    res.json({ success: true, message: 'Study material deleted successfully' });
  } catch (error) {
    next(error);
  }
});

export default router;
