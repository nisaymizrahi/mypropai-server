const express = require('express');
const router = express.Router();
const tenantController = require('../controllers/tenantController');
const requireTenantAuth = require('../middleware/requireTenantAuth');
const { uploadToCloudinary } = require('../middleware/upload'); // Corrected import

router.use(requireTenantAuth);

router.get('/lease-details', tenantController.getLeaseDetails);

router.post(
    '/communications', 
    uploadToCloudinary.single('attachment'), // Use correct uploader
    tenantController.submitCommunication
);

module.exports = router;