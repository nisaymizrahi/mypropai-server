const express = require('express');
const router = express.Router();
const tenantAuthController = require('../controllers/tenantAuthController');

// @route   POST /api/tenant-auth/invite/:token
// @desc    Allow a tenant to set their password using an invitation token
// @access  Public
router.post('/invite/:token', tenantAuthController.setTenantPassword);

// @route   POST /api/tenant-auth/login
// @desc    Authenticate a tenant and get a token
// @access  Public
router.post('/login', tenantAuthController.loginTenant);

module.exports = router;