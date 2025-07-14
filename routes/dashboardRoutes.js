const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const requireAuth = require('../middleware/requireAuth');

// All routes in this file are protected
router.use(requireAuth);

// @route   GET /api/dashboard/summary
// @desc    Get aggregated summary data for the main dashboard
router.get('/summary', dashboardController.getSummary);

module.exports = router;