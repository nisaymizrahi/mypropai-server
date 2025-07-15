const express = require('express');
const router = express.Router();
const stripeController = require('../controllers/stripeController');
const requireAuth = require('../middleware/requireAuth');

// All routes in this file are protected and require a user to be logged in
router.use(requireAuth);

// @route   POST /api/stripe/create-connect-account
// @desc    Creates a new Stripe Express account for a user and returns an onboarding link
router.post('/create-connect-account', stripeController.createConnectAccount);

// @route   GET /api/stripe/connect/success
// @desc    Handles the successful redirect from Stripe after user onboarding
router.get('/connect/success', stripeController.handleStripeRedirect);


module.exports = router;