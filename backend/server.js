import express from 'express';
import http from 'http';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

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
import errorHandler from './middleware/error.js';
import ChatMessage from './models/ChatMessage.js';
import ClassLevel from './models/ClassLevel.js';

dotenv.config();

// Connect to Database
connectDB();

const app = express();
const server = http.createServer(app);

// ES Modules __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve Uploaded Files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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

// Chat History Router
app.get('/api/chats/:class_level', async (req, res, next) => {
  try {
    const { class_level } = req.params;
    const classExists = await ClassLevel.findOne({ name: class_level.toUpperCase() });
    if (!classExists) {
      return res.status(400).json({ success: false, message: 'Invalid class level' });
    }
    const messages = await ChatMessage.find({ class_level })
      .populate('reply_to')
      .sort({ created_at: 1 })
      .limit(100);
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
