import { cloudinary, isConfigured } from '../config/cloudinary.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Uploads a local file to Cloudinary.
 * If Cloudinary is not configured, it returns the local path as is.
 * @param {string} localFilePath - Path to the local file
 * @param {string} folderName - Cloudinary folder name (e.g., 'avatars', 'handouts')
 * @returns {Promise<string>} - The URL of the uploaded image/file
 */
export const uploadToCloud = async (localFilePath, folderName = 'general') => {
  const normalizedPath = localFilePath.replace(/\\/g, '/');
  const getFallbackUrl = () => {
    const uploadsIndex = normalizedPath.indexOf('/uploads/');
    if (uploadsIndex !== -1) {
      return normalizedPath.substring(uploadsIndex);
    }
    return '/' + normalizedPath.split('/').slice(-2).join('/');
  };

  if (!isConfigured) {
    return getFallbackUrl();
  }

  try {
    const ext = path.extname(normalizedPath).toLowerCase();
    const filename = path.basename(normalizedPath);
    const isDoc = ['.pdf', '.doc', '.docx', '.txt'].includes(ext);

    const uploadOptions = {
      folder: `aether_portal/${folderName}`
    };

    if (isDoc) {
      uploadOptions.resource_type = 'raw';
      uploadOptions.public_id = filename; // Include the extension in public_id for raw files
    } else {
      uploadOptions.resource_type = 'auto';
      if (folderName === 'avatars') {
        uploadOptions.transformation = [
          { width: 500, height: 500, crop: 'fill', gravity: 'face', quality: 'auto:best', fetch_format: 'auto' }
        ];
      }
    }

    const result = await cloudinary.uploader.upload(localFilePath, uploadOptions);

    // Clean up local file after cloud upload
    if (fs.existsSync(localFilePath)) {
      try {
        fs.unlinkSync(localFilePath);
      } catch (err) {
        console.error('Failed to delete local temp file after cloud upload:', err);
      }
    }

    return result.secure_url;
  } catch (error) {
    console.error('Cloudinary upload error, falling back to local file:', error.message);
    return getFallbackUrl();
  }
};

/**
 * Deletes a file from Cloudinary (or local filesystem if fallback).
 * @param {string} fileUrl - The URL of the file to delete
 */
export const deleteFromCloud = async (fileUrl) => {
  if (!fileUrl || typeof fileUrl !== 'string') return;

  let parsedUrl = null;
  if (/^https?:\/\//i.test(fileUrl)) {
    try {
      parsedUrl = new URL(fileUrl);
    } catch {
      return;
    }
  }

  if (parsedUrl && parsedUrl.hostname.toLowerCase().endsWith('cloudinary.com')) {
    if (!isConfigured) return;
    try {
      // Parse public_id from pathname after /<resource_type>/upload/(v<digits>/)?
      const match = parsedUrl.pathname.match(/\/(image|video|raw)\/upload\/(?:v\d+\/)?(.+)$/i);
      if (!match) {
        console.warn(`Unable to parse Cloudinary public_id from URL: ${fileUrl}`);
        return;
      }

      const resourceType = match[1].toLowerCase();
      const assetPath = decodeURIComponent(match[2]);
      const destroyOptions = {};
      let publicId = assetPath;

      if (resourceType === 'raw') {
        destroyOptions.resource_type = 'raw';
      } else {
        if (resourceType === 'video') {
          destroyOptions.resource_type = 'video';
        }
        const dotIndex = assetPath.lastIndexOf('.');
        publicId = dotIndex !== -1 ? assetPath.substring(0, dotIndex) : assetPath;
      }

      await cloudinary.uploader.destroy(publicId, destroyOptions);
      console.log(`Deleted cloud asset: ${publicId}`);
    } catch (error) {
      console.error('Failed to delete cloud asset:', error);
    }
  } else if (!parsedUrl) {
    // Local delete — restrict strictly inside backend/uploads
    const uploadsDir = path.resolve(__dirname, '..', 'uploads');
    const relativePath = fileUrl.replace(/^[/\\]+/, '');
    const filePath = path.resolve(__dirname, '..', relativePath);
    if (!filePath.startsWith(uploadsDir + path.sep)) {
      console.warn(`Blocked local file deletion outside uploads directory: ${fileUrl}`);
      return;
    }
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error('Failed to delete local file:', err);
      }
    }
  }
};
