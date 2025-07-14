const express = require('express');
const router = express.Router();
const aiToolsController = require('../controllers/aiToolsController');
const requireAuth = require('../middleware/requireAuth');

// All routes in this file are protected
router.use(requireAuth);

// @route   POST /api/ai-tools/generate-description
// @desc    Generate a property listing description using AI
router.post('/generate-description', aiToolsController.generateDescription);

module.exports = router;