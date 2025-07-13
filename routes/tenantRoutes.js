const express = require('express');
const router = express.Router();

const tenantController = require('../controllers/tenantController');
const requireTenantAuth = require('../middleware/requireTenantAuth');
const upload = require('../middleware/upload');

// All routes in this file will first be protected by the requireTenantAuth middleware.
router.use(requireTenantAuth);

// @route   GET /api/tenant/lease-details
// @desc    Get the lease details for the logged-in tenant
// @access  Private (Tenant)
router.get('/lease-details', tenantController.getLeaseDetails);

// @route   POST /api/tenant/communications
// @desc    Allow a tenant to submit a new communication or request
// @access  Private (Tenant)
router.post(
    '/communications', 
    upload.single('attachment'), 
    tenantController.submitCommunication
);

module.exports = router;