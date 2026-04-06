const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const GENERAL_ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'video/mp4',
  'video/quicktime',
]);

const ESTIMATE_ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
]);

const DOCUMENT_ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

const buildFileFilter = (allowedMimeTypes) => (req, file, cb) => {
  if (!allowedMimeTypes.has(file.mimetype)) {
    return cb(new Error('Unsupported file type.'));
  }

  cb(null, true);
};

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// This is the main storage for most of your app's uploads
const cloudinaryStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'fliprop-uploads',
    allowed_formats: ['jpeg', 'jpg', 'png', 'pdf', 'mp4', 'mov'],
    resource_type: 'auto',
  },
});

// ✅ NEW: This is a special storage engine that holds the file in memory
// We will use this specifically for the OCR process
const memoryStorage = multer.memoryStorage();

// We now export two different upload configurations
module.exports = {
  uploadToCloudinary: multer({
    storage: cloudinaryStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: buildFileFilter(GENERAL_ALLOWED_MIME_TYPES),
  }),
  uploadToMemory: multer({
    storage: memoryStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: buildFileFilter(ESTIMATE_ALLOWED_MIME_TYPES),
  }),
  uploadDocumentToMemory: multer({
    storage: memoryStorage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: buildFileFilter(DOCUMENT_ALLOWED_MIME_TYPES),
  }),
  uploadBidEstimate: multer({
    storage: cloudinaryStorage,
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: buildFileFilter(ESTIMATE_ALLOWED_MIME_TYPES),
  }),
};
