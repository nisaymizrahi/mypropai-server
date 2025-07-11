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
  params: {
    folder: 'mypropai_receipts', // A folder name in your Cloudinary account to keep things organized
    allowed_formats: ['jpg', 'png', 'pdf'], // Allow images and PDFs
    // A function to generate a unique public ID for each file
    public_id: (req, file) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        // Remove file extension from original name before adding unique suffix
        const fileName = file.originalname.split('.').slice(0, -1).join('.');
        return `${req.user.id}-${fileName}-${uniqueSuffix}`;
    },
  },
});

// Create the multer instance that will be used as middleware in our route
const uploadParser = multer({ storage: storage });

module.exports = uploadParser;
