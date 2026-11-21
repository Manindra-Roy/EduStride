import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { protect, authorize } from '../middleware/auth.js';
import SystemSetting from '../models/SystemSetting.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// @desc    Download updated EduStride Android App (APK)
// @route   GET /api/system/download-apk
// @access  Public
router.get('/download-apk', (req, res) => {
  // Prefer the newest versioned EduStride-v*.apk in frontend/public or android/releases, then fall back to EduStride.apk
  const searchDirs = [
    path.resolve(__dirname, '../../frontend/public'),
    path.resolve(__dirname, '../../android/releases'),
    path.resolve(__dirname, '../../android')
  ];

  let apkPath = null;
  let apkFilename = 'EduStride.apk';

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    const versioned = fs.readdirSync(dir)
      .filter(f => /^EduStride-v\d+\.\d+\.\d+\.apk$/i.test(f))
      .sort((a, b) => {
        const va = a.match(/v(\d+)\.(\d+)\.(\d+)/i).slice(1).map(Number);
        const vb = b.match(/v(\d+)\.(\d+)\.(\d+)/i).slice(1).map(Number);
        for (let i = 0; i < 3; i++) {
          if (vb[i] !== va[i]) return vb[i] - va[i];
        }
        return 0;
      });
    if (versioned.length > 0) {
      apkFilename = versioned[0];
      apkPath = path.join(dir, apkFilename);
      break;
    }
  }

  if (!apkPath) {
    const fallbacks = [
      path.resolve(__dirname, '../../android/EduStride.apk'),
      path.resolve(__dirname, '../../frontend/public/EduStride.apk')
    ];
    apkPath = fallbacks.find(p => fs.existsSync(p)) || null;
  }

  if (apkPath) {
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', `attachment; filename="${apkFilename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(apkPath);
  } else {
    res.status(404).json({ success: false, message: 'APK file not found' });
  }
});

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
