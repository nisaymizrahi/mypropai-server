const express = require('express');
const router = express.Router();
const applicationController = require('../controllers/applicationController');
const requireAuth = require('../middleware/requireAuth');

// --- Public Routes for Applicants ---

// @route   GET /api/applications/public
// @desc    Get public details for an invite-based application form
router.get('/public', applicationController.getPublicApplicationDetails);

// @route   GET /api/applications/public/:unitId
// @desc    Get public details for a legacy unit-based application form
router.get('/public/:unitId', applicationController.getPublicApplicationDetails);

// @route   POST /api/applications/submit
// @desc    Submit a new rental application
router.post('/submit', applicationController.submitApplication);

// @route   GET /api/applications/payment-session/:sessionId
// @desc    Confirm a completed Stripe Checkout session for an application
router.get('/payment-session/:sessionId', applicationController.confirmPaymentSession);


// --- Protected Routes for Managers ---

// @route   GET /api/applications
// @desc    Get all applications for the authenticated manager, optionally filtered by property
router.get('/', requireAuth, applicationController.getApplications);

// @route   POST /api/applications/invitations
// @desc    Generate a public application link or email it to a prospect
router.post('/invitations', requireAuth, applicationController.createApplicationInvite);

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
router.post('/:id/create-payment-intent', requireAuth, applicationController.createPaymentIntent);


module.exports = router;
