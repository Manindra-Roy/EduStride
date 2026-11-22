import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import connectDB from './config/db.js';
import { initSocket } from './config/socket.js';
import { initCronJobs } from './services/cron.js';

import authRoutes from './routes/auth.js';
import studentRoutes from './routes/students.js';
import studyMaterialRoutes from './routes/studyMaterials.js';
import feeRoutes from './routes/fees.js';
import classRoutes from './routes/classes.js';
import subjectRoutes from './routes/subjects.js';
import automationRoutes from './routes/automations.js';
import timetableRoutes from './routes/timetable.js';
import systemRoutes from './routes/system.js';
import specialBatchRoutes from './routes/specialBatches.js';
import biometricRoutes from './routes/biometric.js';
import errorHandler from './middleware/error.js';
import { protect } from './middleware/auth.js';
import ChatMessage from './models/ChatMessage.js';
import ClassLevel from './models/ClassLevel.js';
import SpecialBatch from './models/SpecialBatch.js';
import Student from './models/Student.js';

// Fail fast if JWT_SECRET is missing or weak
if (!process.env.JWT_SECRET || typeof process.env.JWT_SECRET !== 'string' || process.env.JWT_SECRET.trim().length < 16) {
  console.error('[Startup Fatal] JWT_SECRET environment variable must be set and at least 16 characters long.');
  process.exit(1);
}

// Connect to Database
connectDB();

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

// ES Modules __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CORS allowlist matching Socket.IO
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  : '*';

// Lightweight Map-based sliding-window rate limiter with periodic cleanup
const createRateLimiter = ({ windowMs, maxRequests, message }) => {
  const hits = new Map(); // ip -> number[] (timestamps)
  const cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, timestamps] of hits.entries()) {
      const valid = timestamps.filter(ts => ts > cutoff);
      if (valid.length === 0) {
        hits.delete(ip);
      } else {
        hits.set(ip, valid);
      }
    }
  }, Math.max(windowMs, 60000));
  if (typeof cleanupTimer.unref === 'function') {
    cleanupTimer.unref();
  }

  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const cutoff = now - windowMs;
    const recent = (hits.get(ip) || []).filter(ts => ts > cutoff);

    if (recent.length >= maxRequests) {
      return res.status(429).json({
        success: false,
        message: message || 'Too many requests, please try again later.'
      });
    }

    recent.push(now);
    hits.set(ip, recent);
    next();
  };
};

const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 20,
  message: 'Too many login attempts from this IP. Please try again after 15 minutes.'
});

const biometricDeviceRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 120,
  message: 'Device request rate limit exceeded. Please slow down polling.'
});

// Middleware
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({
  verify: (req, res, buf) => {
    if (req.originalUrl && req.originalUrl.startsWith('/api/fees/webhook')) {
      req.rawBody = buf;
    }
  }
}));
app.use(express.urlencoded({ extended: true }));

// Serve Uploaded Files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Apply rate limiters on sensitive endpoints
app.use('/api/auth/login', loginRateLimiter);
app.use('/api/biometric/device', biometricDeviceRateLimiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/study-materials', studyMaterialRoutes);
app.use('/api/fees', feeRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/automations', automationRoutes);
app.use('/api/timetable', timetableRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/special-batches', specialBatchRoutes);
app.use('/api/biometric', biometricRoutes);

// Chat History Router (authenticated + RBAC-enforced)
app.get('/api/chats/:class_level', protect, async (req, res, next) => {
  try {
    const rawParam = String(req.params.class_level || '').trim();
    if (!rawParam) {
      return res.status(400).json({ success: false, message: 'Invalid class level or special batch room' });
    }

    const upperParam = rawParam.toUpperCase();
    let isValidRoom = false;
    let roomQuery = null;

    // Check standard class level first
    const classExists = await ClassLevel.findOne({ name: upperParam });
    if (classExists) {
      isValidRoom = true;
      // Enforce class isolation for Students
      if (req.user.role === 'Student') {
        const studentProfile = req.user.studentProfile
          ? await Student.findById(req.user.studentProfile).select('class_level').lean()
          : null;
        const ownClass = studentProfile?.class_level?.trim().toUpperCase();
        if (!ownClass || ownClass !== upperParam) {
          return res.status(403).json({ success: false, message: 'Not authorized to access this class chat' });
        }
      }
      roomQuery = { class_level: { $in: [rawParam, upperParam] } };
    } else {
      // Check if it matches a Special Batch by ID or formatted room name
      let cleanBatchId = rawParam;
      if (/^batch_/i.test(rawParam)) {
        cleanBatchId = rawParam.slice(6);
      }
      if (/^[0-9a-fA-F]{24}$/.test(cleanBatchId)) {
        const batchExists = await SpecialBatch.findById(cleanBatchId).select('_id students').lean();
        if (batchExists) {
          isValidRoom = true;
          if (req.user.role === 'Student') {
            const ownStudentId = req.user.studentProfile?.toString() || '';
            const isMember = ownStudentId && Array.isArray(batchExists.students)
              && batchExists.students.some(s => String(s) === ownStudentId);
            if (!isMember) {
              return res.status(403).json({ success: false, message: 'Not authorized to access this special batch chat' });
            }
          }
          const normalizedBatchRoom = `BATCH_${cleanBatchId}`;
          roomQuery = { class_level: { $in: [normalizedBatchRoom, rawParam, cleanBatchId] } };
        }
      }
    }

    if (!isValidRoom || !roomQuery) {
      return res.status(400).json({ success: false, message: 'Invalid class level or special batch room' });
    }

    const latestMessages = await ChatMessage.find(roomQuery)
      .populate('reply_to')
      .sort({ created_at: -1 })
      .limit(100);

    const messages = latestMessages.reverse();

    res.json({ success: true, data: messages });
  } catch (error) {
    next(error);
  }
});

// Base Route
app.get('/', (req, res) => {
  res.send('Institutional ERP & LMS Server is running...');
});

// Centralized error handler
app.use(errorHandler);

// Initialize Socket.io Server
initSocket(server);

// Start Background Jobs
initCronJobs();

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
});
