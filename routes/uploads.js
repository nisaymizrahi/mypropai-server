const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth');
const uploadParser = require('../config/cloudinary');

// Define the file upload route
// This will be accessed via POST /api/uploads/receipt
// The 'uploadParser.single('receipt')' part is the middleware that does all the work.
// It looks for a file in the request under the field name 'receipt'.
router.post('/receipt', requireAuth, uploadParser.single('receipt'), (req, res) => {
  // If the file upload is successful, multer-storage-cloudinary adds the file info to the request object.
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded.' });
  }

  // We send back a JSON response containing the secure URL of the uploaded file.
  // The 'path' property contains the public URL from Cloudinary.
  res.status(200).json({
    message: 'File uploaded successfully!',
    receiptUrl: req.file.path 
  });
});

module.exports = router;
