const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// This is the main storage for most of your app's uploads
const cloudinaryStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'mypropai-uploads',
    allowed_formats: ['jpeg', 'jpg', 'png', 'pdf', 'mp4', 'mov'],
    resource_type: 'auto',
  },
});

// ✅ NEW: This is a special storage engine that holds the file in memory
// We will use this specifically for the OCR process
const memoryStorage = multer.memoryStorage();

// We now export two different upload configurations
module.exports = {
  uploadToCloudinary: multer({ storage: cloudinaryStorage }),
  uploadToMemory: multer({ storage: memoryStorage })
};