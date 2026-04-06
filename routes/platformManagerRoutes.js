const express = require('express');

const requireAuth = require('../middleware/requireAuth');
const requirePlatformManager = require('../middleware/requirePlatformManager');
const platformManagerController = require('../controllers/platformManagerController');

const router = express.Router();

router.use(requireAuth, requirePlatformManager);

router.get('/support-requests', platformManagerController.getSupportRequests);
router.patch('/support-requests/:requestId', platformManagerController.updateSupportRequestStatus);
router.get('/users', platformManagerController.getUsers);
router.get('/users/export', platformManagerController.exportUsers);
router.get('/users/:userId', platformManagerController.getUserDetail);
router.post('/users/:userId/impersonate', platformManagerController.createImpersonationSession);
router.post('/users/:userId/revoke-sessions', platformManagerController.revokeUserSessions);
router.post('/users/:userId/sync-billing', platformManagerController.syncUserBilling);
router.post('/users/:userId/send-password-reset', platformManagerController.sendPasswordReset);
router.post('/users/:userId/comps-credits', platformManagerController.grantUserCompsCredits);
router.post('/users/:userId/support-notes', platformManagerController.addSupportNote);
router.patch('/users/:userId/subscription-override', platformManagerController.setSubscriptionOverride);
router.patch('/users/:userId/account-status', platformManagerController.setAccountStatus);
router.patch('/users/:userId/email', platformManagerController.updateUserEmail);
router.delete('/support-notes/:noteId', platformManagerController.deleteSupportNote);
router.delete('/users/:userId', platformManagerController.deleteUser);

module.exports = router;
