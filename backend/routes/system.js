import express from 'express';
import { protect, authorize } from '../middleware/auth.js';
import SystemSetting from '../models/SystemSetting.js';

const router = express.Router();

// @desc    Get default system theme color
// @route   GET /api/system/theme
// @access  Public
router.get('/theme', async (req, res, next) => {
  try {
    const setting = await SystemSetting.findOne({ key: 'default_theme_color' });
    const defaultColor = setting ? setting.value : 'indigo';
    res.json({ success: true, theme_color: defaultColor });
  } catch (error) {
    next(error);
  }
});

// @desc    Set default system theme color
// @route   PUT /api/system/theme
// @access  Private (SuperAdmin or Teacher)
router.put('/theme', protect, authorize('SuperAdmin', 'Teacher'), async (req, res, next) => {
  try {
    const { theme_color } = req.body;
    if (!theme_color) {
      res.status(400);
      throw new Error('Theme color is required');
    }

    const allowedColors = ['indigo', 'emerald', 'amber', 'rose', 'violet', 'cyan'];
    if (!allowedColors.includes(theme_color)) {
      res.status(400);
      throw new Error('Invalid theme color');
    }

    let setting = await SystemSetting.findOne({ key: 'default_theme_color' });
    if (!setting) {
      setting = new SystemSetting({ key: 'default_theme_color', value: theme_color });
    } else {
      setting.value = theme_color;
    }
    await setting.save();

    res.json({
      success: true,
      message: 'Default system theme color updated successfully',
      theme_color: setting.value
    });
  } catch (error) {
    next(error);
  }
});

export default router;
