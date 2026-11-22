import express from 'express';
import Subject from '../models/Subject.js';
import ClassLevel from '../models/ClassLevel.js';
import StudyMaterial from '../models/StudyMaterial.js';
import Student from '../models/Student.js';
import Timetable from '../models/Timetable.js';
import { protect, authorize } from '../middleware/auth.js';
import { invalidateTimetableCache } from '../services/attendanceSync.js';

const router = express.Router();

// @desc    Get subjects (optionally filtered by class_level)
// @route   GET /api/subjects
// @access  Public (so filters can read them)
router.get('/', async (req, res, next) => {
  try {
    const { class_level } = req.query;

    const query = {};
    if (typeof class_level === 'string' && class_level.trim()) {
      query.class_level = class_level.toUpperCase().trim();
    }

    const subjects = await Subject.find(query).sort({ name: 1 });
    res.json({ success: true, data: subjects });
  } catch (error) {
    next(error);
  }
});

// @desc    Create a new subject for a class level
// @route   POST /api/subjects
// @access  Private (Admin & Teacher only)
router.post('/', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const { name, class_level, total_chapters } = req.body || {};

    if (typeof name !== 'string' || !name.trim() || typeof class_level !== 'string' || !class_level.trim()) {
      res.status(400);
      throw new Error('Please provide both subject name and class level');
    }

    let chaptersVal = 4;
    if (total_chapters !== undefined && total_chapters !== null && total_chapters !== '') {
      const parsed = Number(total_chapters);
      if (!Number.isFinite(parsed) || parsed < 1) {
        res.status(400);
        throw new Error('total_chapters must be a valid number >= 1');
      }
      chaptersVal = Math.floor(parsed);
    }

    const cleanName = name.trim();
    const cleanClass = class_level.toUpperCase().trim();

    // Verify class level exists
    const classExists = await ClassLevel.findOne({ name: cleanClass });
    if (!classExists) {
      res.status(400);
      throw new Error(`Class level ${cleanClass} does not exist. Create the class level first.`);
    }

    // Check if subject already exists for this class
    const escapedName = cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exists = await Subject.findOne({ name: { $regex: new RegExp(`^${escapedName}$`, 'i') }, class_level: cleanClass });
    if (exists) {
      res.status(400);
      throw new Error(`Subject '${cleanName}' already exists for Class ${cleanClass}`);
    }

    const newSubject = await Subject.create({
      name: cleanName,
      class_level: cleanClass,
      total_chapters: chaptersVal
    });

    res.status(201).json({ success: true, data: newSubject });
  } catch (error) {
    next(error);
  }
});

// @desc    Update a subject (with case-insensitive duplicate guard & rename cascade)
// @route   PUT /api/subjects/:id
// @access  Private (Admin & Teacher only)
router.put('/:id', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const { name, total_chapters } = req.body || {};
    const subject = await Subject.findById(req.params.id);
    if (!subject) {
      res.status(404);
      throw new Error('Subject not found');
    }

    const oldName = subject.name;
    let newName = oldName;

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        res.status(400);
        throw new Error('Subject name must be a non-empty string');
      }
      newName = name.trim();
      const escapedNewName = newName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const duplicate = await Subject.findOne({
        _id: { $ne: subject._id },
        class_level: subject.class_level,
        name: { $regex: new RegExp(`^${escapedNewName}$`, 'i') }
      });
      if (duplicate) {
        res.status(400);
        throw new Error(`Subject '${newName}' already exists for Class ${subject.class_level}`);
      }
      subject.name = newName;
    }

    if (total_chapters !== undefined) {
      const parsed = Number(total_chapters);
      if (!Number.isFinite(parsed) || parsed < 1) {
        res.status(400);
        throw new Error('total_chapters must be a valid number >= 1');
      }
      subject.total_chapters = Math.floor(parsed);
    }

    await subject.save();

    // Cascade subject rename across StudyMaterial, Student scores, and Timetable
    if (newName !== oldName) {
      await Promise.all([
        StudyMaterial.updateMany(
          { class_level: subject.class_level, subject: oldName },
          { $set: { subject: newName } }
        ),
        Student.updateMany(
          { class_level: subject.class_level, 'test_scores.subject': oldName },
          { $set: { 'test_scores.$[elem].subject': newName } },
          { arrayFilters: [{ 'elem.subject': oldName }] }
        ),
        Student.updateMany(
          { class_level: subject.class_level, 'tuition_test_scores.subject': oldName },
          { $set: { 'tuition_test_scores.$[elem].subject': newName } },
          { arrayFilters: [{ 'elem.subject': oldName }] }
        )
      ]);

      const timetable = await Timetable.findOne();
      if (timetable && Array.isArray(timetable.data)) {
        let timetableChanged = false;
        const updatedData = timetable.data.map(dayObj => {
          const slots = Array.isArray(dayObj.slots)
            ? dayObj.slots.map(slot => {
                if (
                  slot.grade?.trim().toUpperCase() === subject.class_level &&
                  slot.subject === oldName
                ) {
                  timetableChanged = true;
                  return { ...slot, subject: newName };
                }
                return slot;
              })
            : [];
          return { ...dayObj, slots };
        });
        if (timetableChanged) {
          timetable.data = updatedData;
          timetable.markModified('data');
          await timetable.save();
          invalidateTimetableCache();
        }
      }
    }

    res.json({ success: true, data: subject });
  } catch (error) {
    next(error);
  }
});

// @desc    Delete a subject
// @route   DELETE /api/subjects/:id
// @access  Private (Admin & Teacher only)
router.delete('/:id', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const subject = await Subject.findById(req.params.id);
    if (!subject) {
      res.status(404);
      throw new Error('Subject not found');
    }

    // Safety check: Prevent deletion if any study materials are bound to this subject
    const materialsCount = await StudyMaterial.countDocuments({
      class_level: subject.class_level,
      subject: subject.name
    });
    if (materialsCount > 0) {
      res.status(400);
      throw new Error(`Cannot delete subject '${subject.name}' because there are active study materials uploaded under it.`);
    }

    // Safety check: Prevent deletion if any student has test scores for this subject
    const studentsWithScores = await Student.countDocuments({
      class_level: subject.class_level,
      $or: [
        { 'test_scores.subject': subject.name },
        { 'tuition_test_scores.subject': subject.name }
      ]
    });
    if (studentsWithScores > 0) {
      res.status(400);
      throw new Error(`Cannot delete subject '${subject.name}' because it has logged exam marks in student profiles.`);
    }

    await Subject.deleteOne({ _id: req.params.id });
    res.json({ success: true, message: `Subject '${subject.name}' deleted successfully.` });
  } catch (error) {
    next(error);
  }
});

export default router;
