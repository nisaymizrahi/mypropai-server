// routes/unitDocumentRoutes.js

const express = require('express');
const router = express.Router();
const auth = require('../middleware/requireAuth');
const upload = require('../middleware/upload');
const controller = require('../controllers/unitDocumentController');

// Upload to a specific unit
router.post('/unit/:unitId', auth, upload.single('document'), controller.uploadUnitDocument);

// Upload to property-level (not tied to a unit)
router.post('/property/:propertyId', auth, upload.single('document'), controller.uploadPropertyDocument);

// Get documents for a single unit
router.get('/unit/:unitId', auth, controller.getUnitDocuments);

// Get all grouped documents for a property
router.get('/property/:propertyId', auth, controller.getPropertyDocuments);

// Delete a document
router.delete('/:docId', auth, controller.deleteDocument);

module.exports = router;
