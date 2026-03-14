const express = require('express');
const router = express.Router();
const vendorController = require('../controllers/vendorController');
const requireAuth = require('../middleware/requireAuth');
const { uploadToCloudinary } = require('../middleware/upload');

// All routes in this file are protected
router.use(requireAuth);

// @route   POST /api/vendors
// @desc    Create a new vendor
router.post('/', vendorController.createVendor);

// @route   GET /api/vendors
// @desc    Get all of a user's vendors
router.get('/', vendorController.getVendors);

// @route   GET /api/vendors/:id
// @desc    Get one vendor
router.get('/:id', vendorController.getVendorById);

// @route   PATCH /api/vendors/:id
// @desc    Update a vendor
router.patch('/:id', vendorController.updateVendor);

// @route   POST /api/vendors/:id/documents
// @desc    Upload a vendor document
router.post('/:id/documents', uploadToCloudinary.single('document'), vendorController.uploadVendorDocument);

// @route   DELETE /api/vendors/:id/documents/:documentId
// @desc    Delete a vendor document
router.delete('/:id/documents/:documentId', vendorController.deleteVendorDocument);

// @route   DELETE /api/vendors/:id
// @desc    Delete a vendor
router.delete('/:id', vendorController.deleteVendor);

module.exports = router;
