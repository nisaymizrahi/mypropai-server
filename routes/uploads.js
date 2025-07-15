const express = require('express');
const router = express.Router();
const { uploadToCloudinary } = require('../middleware/upload'); // Corrected import

// The 'requireAuth' middleware is applied in index.js
router.post('/receipt', uploadToCloudinary.single('receipt'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded.' });
  }
  res.status(200).json({
    message: 'File uploaded successfully!',
    receiptUrl: req.file.path 
  });
});

module.exports = router;