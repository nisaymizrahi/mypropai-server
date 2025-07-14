const express = require('express');
const router = express.Router();
const inspectionController = require('../controllers/inspectionController');
const requireAuth = require('../middleware/requireAuth');
const upload = require('../middleware/upload');

// All routes in this file are protected
router.use(requireAuth);

// @route   POST /api/inspections
// @desc    Create a new inspection report
router.post('/', inspectionController.createInspection);

// @route   GET /api/inspections/property/:propertyId
// @desc    Get all inspection reports for a specific property
router.get('/property/:propertyId', inspectionController.getInspectionsForProperty);

// @route   GET /api/inspections/:id
// @desc    Get a single inspection report by ID
router.get('/:id', inspectionController.getInspectionById);

// @route   PATCH /api/inspections/:id
// @desc    Update an inspection report (e.g., add checklist items)
router.patch('/:id', inspectionController.updateInspection);

// Note: A dedicated route for uploading photos to an existing inspection item might be added later.

module.exports = router;