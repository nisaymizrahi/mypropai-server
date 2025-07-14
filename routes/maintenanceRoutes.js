const express = require('express');
const router = express.Router();
const maintenanceController = require('../controllers/maintenanceController');
const requireAuth = require('../middleware/requireAuth');
const upload = require('../middleware/upload');

// All routes in this file are protected
router.use(requireAuth);

// @route   POST /api/maintenance
// @desc    Create a new maintenance ticket
router.post('/', upload.array('photos', 5), maintenanceController.createTicket);

// @route   GET /api/maintenance/property/:propertyId
// @desc    Get all tickets for a specific property
router.get('/property/:propertyId', maintenanceController.getTicketsForProperty);

// @route   GET /api/maintenance/:id
// @desc    Get a single maintenance ticket by its ID
router.get('/:id', maintenanceController.getTicketById);

// @route   PATCH /api/maintenance/:id
// @desc    Update a maintenance ticket
router.patch('/:id', maintenanceController.updateTicket);

// @route   DELETE /api/maintenance/:id
// @desc    Delete a maintenance ticket
router.delete('/:id', maintenanceController.deleteTicket);

module.exports = router;