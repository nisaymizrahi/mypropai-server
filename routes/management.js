const express = require('express');
const router = express.Router();
// CORRECTED: Changed the path to point to the correct middleware file name
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

module.exports = router;