import express from 'express';
import ClassLevel from '../models/ClassLevel.js';
import Student from '../models/Student.js';
import Attendance from '../models/Attendance.js';
import Subject from '../models/Subject.js';
import StudyMaterial from '../models/StudyMaterial.js';
import Timetable from '../models/Timetable.js';
import ChatMessage from '../models/ChatMessage.js';
import { protect, authorize } from '../middleware/auth.js';
import { invalidateTimetableCache } from '../services/attendanceSync.js';

const router = express.Router();

// Safe idempotent seeding if collection is empty (race-free via upsert)
const seedDefaultClasses = async () => {
  const count = await ClassLevel.countDocuments();
  if (count === 0) {
    const defaults = ['VII', 'VIII', 'IX', 'X'].map((name, index) => ({
      updateOne: {
        filter: { name },
        update: { $setOnInsert: { name, order: index } },
        upsert: true
      }
    }));
    await ClassLevel.bulkWrite(defaults, { ordered: false }).catch(err => {
      if (err?.code !== 11000) throw err;
    });
    console.log('[Seeder] Dynamic ClassLevels seeded: VII, VIII, IX, X');
  }
};

// @desc    Get all class levels
// @route   GET /api/classes
// @access  Public (so signup page can query them)
router.get('/', async (req, res, next) => {
  try {
    await seedDefaultClasses();
    const classes = await ClassLevel.find();

    // Sort class levels. If order is set, sort by order. Otherwise fallback to alphabetical/roman sorting.
    const sortedClasses = classes.sort((a, b) => {
      const orderA = a.order !== undefined ? a.order : 0;
      const orderB = b.order !== undefined ? b.order : 0;

      if (orderA !== orderB) {
        return orderA - orderB;
      }

      const romanToVal = {
        'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5,
        'VI': 6, 'VII': 7, 'VIII': 8, 'IX': 9, 'X': 10,
        'XI': 11, 'XII': 12, 'XIII': 13, 'XIV': 14, 'XV': 15,
        'XVI': 16, 'XVII': 17, 'XVIII': 18, 'XIX': 19, 'XX': 20
      };

      const cleanA = a.name.toUpperCase().trim();
      const cleanB = b.name.toUpperCase().trim();

      const valA = romanToVal[cleanA] !== undefined ? romanToVal[cleanA] : (parseInt(cleanA.replace(/\D/g, ''), 10) || cleanA);
      const valB = romanToVal[cleanB] !== undefined ? romanToVal[cleanB] : (parseInt(cleanB.replace(/\D/g, ''), 10) || cleanB);

      if (typeof valA === 'number' && typeof valB === 'number') {
        return valA - valB;
      }
      return String(valA).localeCompare(String(valB));
    });

    const sortedClassNames = sortedClasses.map(c => c.name);
    res.json({ success: true, data: sortedClassNames });
  } catch (error) {
    next(error);
  }
});

// @desc    Create a new class level
// @route   POST /api/classes
// @access  Private (SuperAdmin only)
router.post('/', protect, authorize('SuperAdmin'), async (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400);
      throw new Error('Please provide class name');
    }

    const cleanName = name.toUpperCase().trim();
    const exists = await ClassLevel.findOne({ name: cleanName });
    if (exists) {
      res.status(400);
      throw new Error('Class level already exists');
    }

    const highest = await ClassLevel.findOne().sort({ order: -1 }).select('order').lean();
    const nextOrder = highest && typeof highest.order === 'number' ? highest.order + 1 : 0;

    const newClass = await ClassLevel.create({ name: cleanName, order: nextOrder });
    res.status(201).json({ success: true, data: newClass.name });
  } catch (error) {
    next(error);
  }
});

// @desc    Update order of class levels
// @route   PUT /api/classes/order
// @access  Private (SuperAdmin only)
router.put('/order', protect, authorize('SuperAdmin'), async (req, res, next) => {
  try {
    const { order } = req.body || {};
    if (!order || !Array.isArray(order) || !order.every(item => typeof item === 'string' && item.trim())) {
      res.status(400);
      throw new Error('Please provide an order array of non-empty class names');
    }

    const bulkOps = order.map((name, index) => ({
      updateOne: {
        filter: { name: name.toUpperCase().trim() },
        update: { $set: { order: index } }
      }
    }));

    if (bulkOps.length > 0) {
      await ClassLevel.bulkWrite(bulkOps);
    }

    res.json({ success: true, message: 'Class order updated successfully' });
  } catch (error) {
    next(error);
  }
});

// @desc    Update a class level
// @route   PUT /api/classes/:name
// @access  Private (SuperAdmin only)
router.put('/:name', protect, authorize('SuperAdmin'), async (req, res, next) => {
  try {
    const oldName = req.params.name.toUpperCase().trim();
    const { newName } = req.body || {};
    if (typeof newName !== 'string' || !newName.trim()) {
      res.status(400);
      throw new Error('Please provide the new class name');
    }

    const cleanNewName = newName.toUpperCase().trim();
    if (oldName === cleanNewName) {
      return res.json({ success: true, message: 'Class name is already the same.' });
    }

    // Check if class exists
    const classExists = await ClassLevel.findOne({ name: oldName });
    if (!classExists) {
      res.status(404);
      throw new Error('Class level not found');
    }

    // Check if new name already exists
    const exists = await ClassLevel.findOne({ name: cleanNewName });
    if (exists) {
      res.status(400);
      throw new Error('New class name already exists');
    }

    // Rename the class in ClassLevel
    classExists.name = cleanNewName;
    await classExists.save();

    // Cascade update to Students, Attendance, Subject, StudyMaterial, ChatMessage
    await Promise.all([
      Student.updateMany({ class_level: oldName }, { class_level: cleanNewName }),
      Attendance.updateMany({ class_level: oldName }, { class_level: cleanNewName }),
      Subject.updateMany({ class_level: oldName }, { class_level: cleanNewName }),
      StudyMaterial.updateMany({ class_level: oldName }, { class_level: cleanNewName }),
      ChatMessage.updateMany({ class_level: oldName }, { class_level: cleanNewName })
    ]);

    // Cascade update to Timetable slots
    const timetable = await Timetable.findOne();
    if (timetable && Array.isArray(timetable.data)) {
      let updated = false;
      const updatedData = timetable.data.map(dayObj => {
        const slots = Array.isArray(dayObj.slots)
          ? dayObj.slots.map(slot => {
              if (slot.grade?.toUpperCase().trim() === oldName) {
                updated = true;
                return { ...slot, grade: cleanNewName };
              }
              return slot;
            })
          : [];
        return { ...dayObj, slots };
      });
      if (updated) {
        timetable.data = updatedData;
        timetable.markModified('data');
        await timetable.save();
        invalidateTimetableCache();
      }
    }

    res.json({ success: true, message: `Class ${oldName} renamed to ${cleanNewName} successfully` });
  } catch (error) {
    next(error);
  }
});

// @desc    Delete a class level
// @route   DELETE /api/classes/:name
// @access  Private (SuperAdmin only)
router.delete('/:name', protect, authorize('SuperAdmin'), async (req, res, next) => {
  try {
    const name = req.params.name.toUpperCase().trim();

    // Check if class exists
    const classExists = await ClassLevel.findOne({ name });
    if (!classExists) {
      res.status(404);
      throw new Error('Class level not found');
    }

    // Prevent deletion if students are assigned to this class
    const studentCount = await Student.countDocuments({ class_level: name });
    if (studentCount > 0) {
      res.status(400);
      throw new Error(`Cannot delete Class ${name} because there are active student profiles bound to it.`);
    }

    // Prevent deletion if study materials are still uploaded under this class
    const materialsCount = await StudyMaterial.countDocuments({ class_level: name });
    if (materialsCount > 0) {
      res.status(400);
      throw new Error(`Cannot delete Class ${name} because there are study materials bound to it.`);
    }

    await ClassLevel.deleteOne({ name });

    // Clean up orphaned subjects and timetable slots for the deleted class
    await Subject.deleteMany({ class_level: name });

    const timetable = await Timetable.findOne();
    if (timetable && Array.isArray(timetable.data)) {
      let changed = false;
      const updatedData = timetable.data.map(dayObj => {
        const origSlots = Array.isArray(dayObj.slots) ? dayObj.slots : [];
        const filtered = origSlots.filter(slot => slot.grade?.toUpperCase().trim() !== name);
        if (filtered.length !== origSlots.length) changed = true;
        return { ...dayObj, slots: filtered };
      });
      if (changed) {
        timetable.data = updatedData;
        timetable.markModified('data');
        await timetable.save();
        invalidateTimetableCache();
      }
    }

    res.json({ success: true, message: `Class ${name} deleted successfully` });
  } catch (error) {
    next(error);
  }
});

export default router;
