const express = require('express');
const router = express.Router();
const applicationController = require('../controllers/applicationController');
const requireAuth = require('../middleware/requireAuth');

// --- Public Routes for Applicants ---

// @route   GET /api/applications/public/:unitId
// @desc    Get public details for an application form (e.g., property address)
router.get('/public/:unitId', applicationController.getPublicApplicationDetails);

// @route   POST /api/applications/submit
// @desc    Submit a new rental application
router.post('/submit', applicationController.submitApplication);


// --- Protected Routes for Managers ---

// @route   GET /api/applications/property/:propertyId
// @desc    Get all applications for a specific property
router.get('/property/:propertyId', requireAuth, applicationController.getApplicationsForProperty);

// @route   GET /api/applications/:id
// @desc    Get a single application's full details
router.get('/:id', requireAuth, applicationController.getApplicationById);

// @route   PATCH /api/applications/:id/status
// @desc    Update the status of an application (e.g., approve, deny)
router.patch('/:id/status', requireAuth, applicationController.updateApplicationStatus);

// @route   POST /api/applications/:id/create-payment-intent
// @desc    Create a Stripe payment intent for the application fee
router.post('/:id/create-payment-intent', applicationController.createPaymentIntent);

// @route   POST /api/applications/:id/initiate-screening
// @desc    Initiates the tenant screening process
router.post('/:id/initiate-screening', requireAuth, applicationController.initiateScreening);


module.exports = router;