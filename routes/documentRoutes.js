const express = require('express');
const router = express.Router();
const documentController = require('../controllers/documentController');
const requireAuth = require('../middleware/requireAuth');
const { uploadToCloudinary } = require('../middleware/upload'); // ✅ Corrected import

// All routes in this file are protected
router.use(requireAuth);

// @route   POST /api/documents
// @desc    Upload a new document for an investment
router.post('/', uploadToCloudinary.single('document'), documentController.uploadDocument); // ✅ Use correct uploader

// @route   GET /api/documents/investment/:investmentId
// @desc    Get all documents for a specific investment
router.get('/investment/:investmentId', documentController.getDocumentsForInvestment);

// @route   DELETE /api/documents/:id
// @desc    Delete a document
router.delete('/:id', documentController.deleteDocument);

module.exports = router;