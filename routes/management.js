const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth'); // Assuming you have auth middleware
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

// NEW: @route   GET /api/management/unmanaged-properties
// @desc    Get all "rent" type investments that are not yet managed
// @access  Private
router.get(
    '/unmanaged-properties',
    auth,
    managementController.getUnmanagedProperties
);

module.exports = router;