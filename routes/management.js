const express = require('express');
const router = express.Router();
const auth = require('../middleware/requireAuth'); 
const managementController = require('../controllers/managementController');

// @route   POST /api/management/promote/:investmentId
// @desc    Promote an existing Investment to a ManagedProperty
// @access  Private
router.post(
  '/promote/:investmentId',
  auth,
  managementController.promoteInvestment
);

// @route   GET /api/management
// @desc    Get all managed properties for the logged-in user
// @access  Private
router.get(
    '/', 
    auth, 
    managementController.getManagedProperties
);

// @route   GET /api/management/unmanaged-properties
// @desc    Get all "rent" type investments that are not yet managed
// @access  Private
router.get(
    '/unmanaged-properties',
    auth,
    managementController.getUnmanagedProperties
);

// @route   GET /api/management/:propertyId
// @desc    Get a single managed property by ID
// @access  Private
router.get(
    '/:propertyId',
    auth,
    managementController.getManagedPropertyById
);

// @route   POST /api/management/:propertyId/units
// @desc    Add a new unit to a managed property
// @access  Private
router.post(
    '/:propertyId/units',
    auth,
    managementController.addUnitToProperty
);

// NEW: @route   POST /api/management/units/:unitId/lease
// @desc    Add a new tenant and lease to a specific unit
// @access  Private
router.post(
    '/units/:unitId/lease',
    auth,
    managementController.addLeaseToUnit
);

module.exports = router;