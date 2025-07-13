const express = require('express');
const router = express.Router();
const vendorController = require('../controllers/vendorController');
const requireAuth = require('../middleware/requireAuth');

// All routes in this file are protected
router.use(requireAuth);

// @route   POST /api/vendors
// @desc    Create a new vendor
router.post('/', vendorController.createVendor);

// @route   GET /api/vendors
// @desc    Get all of a user's vendors
router.get('/', vendorController.getVendors);

// @route   PATCH /api/vendors/:id
// @desc    Update a vendor
router.patch('/:id', vendorController.updateVendor);

// @route   DELETE /api/vendors/:id
// @desc    Delete a vendor
router.delete('/:id', vendorController.deleteVendor);

module.exports = router;