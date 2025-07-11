const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// Configure Cloudinary with the credentials from your .env file (or Render environment)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure multer storage engine to use Cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: (req, file) => {
    // NEW: This is now a function to dynamically set parameters
    let folder = 'mypropai_receipts';
    let resource_type = 'auto'; // Let Cloudinary auto-detect

    // Be more specific for PDFs to ensure they are treated as raw files
    if (file.mimetype === 'application/pdf') {
      resource_type = 'raw';
    }

    return {
      folder: folder,
      resource_type: resource_type,
      allowed_formats: ['jpg', 'png', 'pdf'],
      public_id: `receipt-${file.originalname.split('.').slice(0, -1).join('.')}-${Date.now()}`
    };
  },
});

// Create the multer instance that will be used as middleware in our route
const uploadParser = multer({ storage: storage });

module.exports = uploadParser;
