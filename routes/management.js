const express = require('express');
const router = express.Router();
const auth = require('../middleware/requireAuth'); 
const managementController = require('../controllers/managementController');

// --- Property Level Routes ---

// Promote an Investment to a ManagedProperty
router.post('/promote/:investmentId', auth, managementController.promoteInvestment);

// Get all managed properties for the user
router.get('/', auth, managementController.getManagedProperties);

// Get all unmanaged "rent" properties for the user
router.get('/unmanaged-properties', auth, managementController.getUnmanagedProperties);

// Get a single managed property by ID
router.get('/:propertyId', auth, managementController.getManagedPropertyById);

// --- Unit Level Routes ---

// Add a new unit to a managed property
router.post('/:propertyId/units', auth, managementController.addUnitToProperty);

// Add a new tenant and lease to a specific unit
router.post('/units/:unitId/lease', auth, managementController.addLeaseToUnit);

// --- Lease Level Routes ---

// NEW: @route   GET /api/management/leases/:leaseId
// @desc    Get a single lease by its ID
// @access  Private
router.get('/leases/:leaseId', auth, managementController.getLeaseById);


module.exports = router;