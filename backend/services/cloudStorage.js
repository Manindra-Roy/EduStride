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
  if (!fileUrl) return;

  if (fileUrl.includes('cloudinary.com')) {
    if (!isConfigured) return;
    try {
      // Extract public ID from URL
      // e.g. https://res.cloudinary.com/cloudName/image/upload/v1234567/aether_portal/avatars/img.jpg
      // or https://res.cloudinary.com/cloudName/raw/upload/v1234567/aether_portal/handouts/file.pdf
      const parts = fileUrl.split('/');
      const filenameWithFolder = parts.slice(-3).join('/'); // dynamic folder + subfolder + filename
      
      const isRaw = fileUrl.includes('/raw/upload/');
      let publicId;
      const destroyOptions = {};

      if (isRaw) {
        publicId = filenameWithFolder;
        destroyOptions.resource_type = 'raw';
      } else {
        publicId = filenameWithFolder.substring(0, filenameWithFolder.lastIndexOf('.'));
      }
      
      await cloudinary.uploader.destroy(publicId, destroyOptions);
      console.log(`Deleted cloud asset: ${publicId}`);
    } catch (error) {
      console.error('Failed to delete cloud asset:', error);
    }
  } else {
    // Local delete
    const filePath = path.join(__dirname, '..', fileUrl);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error('Failed to delete local file:', err);
      }
    }
  }
};
