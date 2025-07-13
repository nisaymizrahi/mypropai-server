const express = require('express');
const router = express.Router();
const documentController = require('../controllers/documentController');
const requireAuth = require('../middleware/requireAuth');
const upload = require('../middleware/upload');

// All routes in this file are protected
router.use(requireAuth);

// @route   POST /api/documents
// @desc    Upload a new document for an investment
router.post('/', upload.single('document'), documentController.uploadDocument);

// @route   GET /api/documents/investment/:investmentId
// @desc    Get all documents for a specific investment
router.get('/investment/:investmentId', documentController.getDocumentsForInvestment);

// @route   DELETE /api/documents/:id
// @desc    Delete a document
router.delete('/:id', documentController.deleteDocument);

module.exports = router;