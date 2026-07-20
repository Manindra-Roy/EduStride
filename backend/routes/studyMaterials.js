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

// File filter (accept PDF, Word, images, text)
const fileFilter = (req, file, cb) => {
  const allowedExtensions = ['.pdf', '.doc', '.docx', '.txt', '.png', '.jpg', '.jpeg'];
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
    } else if (class_level && class_level !== 'All') {
      query.class_level = class_level;
    }

    if (subject) {
      query.subject = subject;
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
  try {
    if (!req.file) {
      res.status(400);
      throw new Error('Please upload a file');
    }

    const { class_level, subject, chapter_name, status } = req.body;
    if (!class_level || !subject || !chapter_name) {
      // Clean up uploaded file
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(400);
      throw new Error('Please provide class_level, subject, and chapter_name');
    }

    const file_url = await uploadToCloud(req.file.path, 'handouts');

    const material = await StudyMaterial.create({
      class_level,
      subject,
      chapter_name,
      status: status || 'Drafting',
      file_url,
      file_name: req.file.originalname
    });

    // Notify class students via Socket.IO if published/distributed
    if (material.status !== 'Drafting') {
      const io = getIO();
      if (io) {
        io.to(class_level).emit('new_study_material', {
          class_level,
          subject,
          chapter_name,
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
    next(error);
  }
});

// @desc    Update study material (e.g., status/chapter)
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

    const updated = await StudyMaterial.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });

    // Notify class students if status is updated to something other than Drafting
    if (req.body.status && req.body.status !== 'Drafting' && oldStatus !== req.body.status) {
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
