const express = require('express');

const requireAuth = require('../middleware/requireAuth');
const requirePlatformManager = require('../middleware/requirePlatformManager');
const platformManagerController = require('../controllers/platformManagerController');

const router = express.Router();

router.use(requireAuth, requirePlatformManager);

router.get('/users', platformManagerController.getUsers);
router.post('/users/:userId/impersonate', platformManagerController.createImpersonationSession);
router.patch('/users/:userId/subscription-override', platformManagerController.setSubscriptionOverride);
router.patch('/users/:userId/account-status', platformManagerController.setAccountStatus);
router.delete('/users/:userId', platformManagerController.deleteUser);

module.exports = router;
