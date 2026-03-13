const express = require('express');
const billingController = require('../controllers/billingController');

const router = express.Router();

router.get('/overview', billingController.getBillingOverview);
router.get('/access', billingController.getResourceAccess);
router.post('/checkout/subscription', billingController.createSubscriptionCheckoutSession);
router.post('/checkout/one-time', billingController.createOneTimeCheckoutSession);
router.post('/portal', billingController.createCustomerPortalSession);
router.post('/sync-session', billingController.syncCheckoutSession);

module.exports = router;
