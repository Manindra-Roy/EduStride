import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { protect, authorize } from '../middleware/auth.js';
import SystemSetting from '../models/SystemSetting.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fileExists = async (p) => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};

// @desc    Download updated EduStride Android App (APK)
// @route   GET /api/system/download-apk
// @access  Public
router.get('/download-apk', async (req, res, next) => {
  try {
    // Collect versioned EduStride-v*.apk across ALL searchDirs and pick highest semver
    const searchDirs = [
      path.resolve(__dirname, '../../frontend/public'),
      path.resolve(__dirname, '../../android/releases'),
      path.resolve(__dirname, '../../android')
    ];

    const candidates = [];

    for (const dir of searchDirs) {
      let entries;
      try {
        entries = await fs.readdir(dir);
      } catch {
        continue;
      }

      for (const file of entries) {
        const match = file.match(/^EduStride-v(\d+)\.(\d+)\.(\d+)\.apk$/i);
        if (match) {
          candidates.push({
            filename: file,
            fullPath: path.join(dir, file),
            version: [Number(match[1]), Number(match[2]), Number(match[3])]
          });
        }
      }
    }

    candidates.sort((a, b) => {
      for (let i = 0; i < 3; i++) {
        if (b.version[i] !== a.version[i]) return b.version[i] - a.version[i];
      }
      return 0;
    });

    let apkPath = candidates.length > 0 ? candidates[0].fullPath : null;
    let apkFilename = candidates.length > 0 ? candidates[0].filename : 'EduStride.apk';

    if (!apkPath) {
      const fallbacks = [
        path.resolve(__dirname, '../../android/EduStride.apk'),
        path.resolve(__dirname, '../../frontend/public/EduStride.apk')
      ];
      for (const p of fallbacks) {
        if (await fileExists(p)) {
          apkPath = p;
          break;
        }
      }
    }

    if (!apkPath) {
      return res.status(404).json({ success: false, message: 'APK file not found' });
    }

    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', `attachment; filename="${apkFilename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(apkPath, (err) => {
      if (err && !res.headersSent) {
        next(err);
      }
    });
  } catch (error) {
    next(error);
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
    const { theme_color } = req.body || {};
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
