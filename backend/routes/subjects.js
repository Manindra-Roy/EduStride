import express from 'express';
import Subject from '../models/Subject.js';
import ClassLevel from '../models/ClassLevel.js';
import StudyMaterial from '../models/StudyMaterial.js';
import Student from '../models/Student.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

// @desc    Get subjects (optionally filtered by class_level)
// @route   GET /api/subjects
// @access  Public (so filters can read them)
router.get('/', async (req, res, next) => {
  try {
    const { class_level } = req.query;
    
    const query = {};
    if (class_level) {
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
    const { name, class_level, total_chapters } = req.body;
    
    if (!name || !class_level) {
      res.status(400);
      throw new Error('Please provide both subject name and class level');
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
    const exists = await Subject.findOne({ name: { $regex: new RegExp(`^${cleanName}$`, 'i') }, class_level: cleanClass });
    if (exists) {
      res.status(450);
      throw new Error(`Subject '${cleanName}' already exists for Class ${cleanClass}`);
    }
    
    const newSubject = await Subject.create({
      name: cleanName,
      class_level: cleanClass,
      total_chapters: Number(total_chapters) || 4
    });
    
    res.status(201).json({ success: true, data: newSubject });
  } catch (error) {
    next(error);
  }
});

// @desc    Update a subject
// @route   PUT /api/subjects/:id
// @access  Private (Admin & Teacher only)
router.put('/:id', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const { name, total_chapters } = req.body;
    const subject = await Subject.findById(req.params.id);
    if (!subject) {
      res.status(404);
      throw new Error('Subject not found');
    }

    if (name) {
      subject.name = name.trim();
    }
    if (total_chapters !== undefined) {
      subject.total_chapters = Number(total_chapters) || 4;
    }

    await subject.save();
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
      'test_scores.subject': subject.name
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
