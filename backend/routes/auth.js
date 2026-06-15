import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import User from '../models/User.js';
import Student from '../models/Student.js';
import { protect, authorize } from '../middleware/auth.js';
import { uploadToCloud, deleteFromCloud } from '../services/cloudStorage.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, '../uploads/avatars');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'avatar-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only image files (.png, .jpg, .jpeg, .gif, .webp) are allowed'), false);
  }
};

const uploadAvatar = multer({
  storage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 } // 2 MB limit
});

// Generate Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'fallback_secret_key_123', {
    expiresIn: '30d'
  });
};

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, role, class_level, roll_number } = req.body;

    const totalUsers = await User.countDocuments();

    if (totalUsers === 0) {
      // System Initialization: Only the first SuperAdmin can register
      if (role !== 'SuperAdmin') {
        res.status(400);
        throw new Error('The first account registered in the system must be a SuperAdmin');
      }
    } else {
      // Enforce creation permissions
      // We must authenticate the request
      let token;
      if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
      }

      if (!token) {
        res.status(401);
        throw new Error('Authentication token is required to create new user accounts');
      }

      let creator;
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret_key_123');
        creator = await User.findById(decoded.id);
      } catch (err) {
        res.status(401);
        throw new Error('Not authorized, token failed');
      }

      if (!creator) {
        res.status(401);
        throw new Error('Authorized creator user not found');
      }

      // Enforce single SuperAdmin rule
      if (role === 'SuperAdmin') {
        res.status(400);
        throw new Error('A SuperAdmin account has already been registered. Only one SuperAdmin is allowed in this system.');
      }

      // SuperAdmin only can make Teacher accounts
      if (role === 'Teacher' && creator.role !== 'SuperAdmin') {
        res.status(403);
        throw new Error('Only a SuperAdmin can register Teacher accounts');
      }

      // SuperAdmin and Teacher can make Student accounts
      if (role === 'Student' && creator.role !== 'SuperAdmin' && creator.role !== 'Teacher') {
        res.status(403);
        throw new Error('Only a SuperAdmin or Teacher can register Student accounts');
      }
    }

    // Check if user exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      res.status(400);
      throw new Error('User already exists');
    }

    let studentProfile = null;

    // If student, link to existing profile or require it
    if (role === 'Student') {
      if (!class_level || !roll_number) {
        res.status(400);
        throw new Error('Student account registration requires class_level and roll_number');
      }

      // Check if student profile exists
      const student = await Student.findOne({ class_level, roll_number });
      if (!student) {
        res.status(400);
        throw new Error(`No student profile found for Class ${class_level} and Roll No ${roll_number}. Please consult your Admin/Teacher.`);
      }

      // Check if profile is already claimed
      const profileClaimed = await User.findOne({ studentProfile: student._id });
      if (profileClaimed) {
        res.status(400);
        throw new Error('This student profile is already registered to another user account');
      }
      studentProfile = student._id;
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const user = await User.create({
      email,
      password: hashedPassword,
      role,
      studentProfile
    });

    const populatedUser = await User.findById(user._id).populate('studentProfile');

    res.status(201).json({
      success: true,
      token: generateToken(user._id),
      user: {
        id: populatedUser._id,
        email: populatedUser.email,
        role: populatedUser.role,
        studentProfile: populatedUser.studentProfile,
        profile_pic: populatedUser.profile_pic
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Authenticate user & get token
// @route   POST /api/auth/login
// @access  Public
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).populate('studentProfile');
    if (!user) {
      res.status(401);
      throw new Error('Invalid email or password');
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      res.status(401);
      throw new Error('Invalid email or password');
    }

    res.json({
      success: true,
      token: generateToken(user._id),
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        studentProfile: user.studentProfile,
        profile_pic: user.profile_pic
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Private
router.get('/me', protect, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).populate('studentProfile');
    res.json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        studentProfile: user.studentProfile,
        profile_pic: user.profile_pic
      }
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Check if system has been initialized with a SuperAdmin
// @route   GET /api/auth/init-status
// @access  Public
router.get('/init-status', async (req, res, next) => {
  try {
    const superAdminExists = await User.findOne({ role: 'SuperAdmin' });
    res.json({
      success: true,
      initialized: !!superAdminExists
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Upload profile picture
// @route   PUT /api/auth/profile-pic
// @access  Private
router.put('/profile-pic', protect, uploadAvatar.single('avatar'), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400);
      throw new Error('Please upload an image file');
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      res.status(404);
      throw new Error('User not found');
    }

    // Delete old profile picture if exists
    if (user.profile_pic) {
      await deleteFromCloud(user.profile_pic);
    }

    // Save new profile picture path
    const cloudUrl = await uploadToCloud(req.file.path, 'avatars');
    user.profile_pic = cloudUrl;
    await user.save();

    res.json({
      success: true,
      message: 'Profile picture updated successfully',
      profile_pic: user.profile_pic
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Change user password
// @route   PUT /api/auth/change-password
// @access  Private
router.put('/change-password', protect, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      res.status(400);
      throw new Error('Please provide both current and new passwords');
    }

    if (newPassword.length < 6) {
      res.status(400);
      throw new Error('New password must be at least 6 characters long');
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      res.status(404);
      throw new Error('User not found');
    }

    // Check current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      res.status(401);
      throw new Error('Current password is incorrect');
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get all teachers
// @route   GET /api/auth/teachers
// @access  Private (SuperAdmin only)
router.get('/teachers', protect, authorize('SuperAdmin'), async (req, res, next) => {
  try {
    const teachers = await User.find({ role: 'Teacher' }).select('-password');
    res.json({
      success: true,
      data: teachers
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Delete a teacher
// @route   DELETE /api/auth/teachers/:id
// @access  Private (SuperAdmin only)
router.delete('/teachers/:id', protect, authorize('SuperAdmin'), async (req, res, next) => {
  try {
    const teacher = await User.findById(req.params.id);
    if (!teacher) {
      res.status(404);
      throw new Error('Teacher not found');
    }
    if (teacher.role !== 'Teacher') {
      res.status(400);
      throw new Error('User is not a teacher');
    }
    if (teacher.profile_pic) {
      await deleteFromCloud(teacher.profile_pic);
    }
    await User.findByIdAndDelete(req.params.id);
    res.json({
      success: true,
      message: 'Teacher deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Get all student user accounts
// @route   GET /api/auth/students
// @access  Private (SuperAdmin & Teacher)
router.get('/students', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const students = await User.find({ role: 'Student' })
      .populate('studentProfile')
      .select('-password');
    res.json({
      success: true,
      data: students
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Delete a student user account
// @route   DELETE /api/auth/students/:id
// @access  Private (SuperAdmin & Teacher)
router.delete('/students/:id', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const studentUser = await User.findById(req.params.id);
    if (!studentUser) {
      res.status(404);
      throw new Error('Student account not found');
    }
    if (studentUser.role !== 'Student') {
      res.status(400);
      throw new Error('User is not a student');
    }
    if (studentUser.profile_pic) {
      await deleteFromCloud(studentUser.profile_pic);
    }
    await User.findByIdAndDelete(req.params.id);
    res.json({
      success: true,
      message: 'Student account deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

export default router;
