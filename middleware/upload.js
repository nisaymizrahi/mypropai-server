const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// Configure Cloudinary with your credentials from environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Set up the storage engine for Multer
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'mypropai-uploads', // A folder name in your Cloudinary account
    allowed_formats: ['jpeg', 'jpg', 'png', 'pdf', 'mp4', 'mov'], // Allowed file formats
    resource_type: 'auto', // Automatically detect if it's an image or video
  },
});

// Initialize multer with the Cloudinary storage engine
const upload = multer({ storage: storage });

module.exports = upload;