import express from 'express';
import Timetable from '../models/Timetable.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

const defaultTimetable = [
  { day: 'Monday', slots: [
    { time: '09:00 AM', subject: 'Mathematics', teacher: 'Prof. Vance', grade: 'VIII' },
    { time: '11:00 AM', subject: 'Science', teacher: 'Dr. Carter', grade: 'X' },
    { time: '01:30 PM', subject: 'English', teacher: 'Mrs. Gable', grade: 'VII' }
  ]},
  { day: 'Tuesday', slots: [
    { time: '09:00 AM', subject: 'Science', teacher: 'Dr. Carter', grade: 'IX' },
    { time: '11:00 AM', subject: 'History', teacher: 'Mr. Ross', grade: 'VIII' },
    { time: '01:30 PM', subject: 'Mathematics', teacher: 'Prof. Vance', grade: 'X' }
  ]},
  { day: 'Wednesday', slots: [
    { time: '09:00 AM', subject: 'Geography', teacher: 'Mr. Ross', grade: 'VII' },
    { time: '11:00 AM', subject: 'English', teacher: 'Mrs. Gable', grade: 'IX' },
    { time: '01:30 PM', subject: 'Science', teacher: 'Dr. Carter', grade: 'VIII' }
  ]},
  { day: 'Thursday', slots: [
    { time: '09:00 AM', subject: 'Mathematics', teacher: 'Prof. Vance', grade: 'IX' },
    { time: '11:00 AM', subject: 'History', teacher: 'Mr. Ross', grade: 'X' },
    { time: '01:30 PM', subject: 'English', teacher: 'Mrs. Gable', grade: 'VIII' }
  ]},
  { day: 'Friday', slots: [
    { time: '09:00 AM', subject: 'Geography', teacher: 'Mr. Ross', grade: 'X' },
    { time: '11:00 AM', subject: 'Science', teacher: 'Dr. Carter', grade: 'VII' },
    { time: '01:30 PM', subject: 'Mathematics', teacher: 'Prof. Vance', grade: 'IX' }
  ]},
  { day: 'Saturday', slots: [] },
  { day: 'Sunday', slots: [] }
];

// @desc    Get timetable structure
// @route   GET /api/timetable
// @access  Public
router.get('/', async (req, res, next) => {
  try {
    let timetable = await Timetable.findOne();
    if (!timetable) {
      timetable = await Timetable.create({ data: defaultTimetable });
      console.log('[Seeder] Default Weekly Timetable seeded.');
    } else if (timetable.data.length < 7) {
      // Dynamic migration to add Saturday/Sunday if they are missing
      const existingDays = timetable.data.map(d => d.day);
      const migratedData = [...timetable.data];
      if (!existingDays.includes('Saturday')) {
        migratedData.push({ day: 'Saturday', slots: [] });
      }
      if (!existingDays.includes('Sunday')) {
        migratedData.push({ day: 'Sunday', slots: [] });
      }
      timetable.data = migratedData;
      await timetable.save();
      console.log('[Migration] Timetable successfully upgraded to 7-day schedule.');
    }
    res.json({ success: true, data: timetable.data });
  } catch (error) {
    next(error);
  }
});

// @desc    Update timetable structure
// @route   PUT /api/timetable
// @access  Private (Admin & Teacher only)
router.put('/', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const { data } = req.body;
    if (!data || !Array.isArray(data)) {
      res.status(400);
      throw new Error('Please provide a valid timetable data array');
    }

    let timetable = await Timetable.findOne();
    if (!timetable) {
      timetable = await Timetable.create({ data });
    } else {
      timetable.data = data;
      await timetable.save();
    }

    res.json({ success: true, data: timetable.data });
  } catch (error) {
    next(error);
  }
});

export default router;
