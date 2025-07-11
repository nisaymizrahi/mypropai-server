const express = require('express');
const router = express.Router();
const uploadParser = require('../config/cloudinary');

// Define the file upload route
// The 'requireAuth' middleware is already applied in index.js, so we don't need it here.
// The 'uploadParser.single('receipt')' middleware handles the file upload to Cloudinary.
router.post('/receipt', uploadParser.single('receipt'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded.' });
  }

  // If upload is successful, Cloudinary provides the file URL in req.file.path
  res.status(200).json({
    message: 'File uploaded successfully!',
    receiptUrl: req.file.path 
  });
});

module.exports = router;
