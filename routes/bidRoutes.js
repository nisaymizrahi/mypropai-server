const express = require('express');
const router = express.Router();
const bidController = require('../controllers/bidController');
const requireAuth = require('../middleware/requireAuth');
const { uploadToMemory } = require('../middleware/upload');

// All routes in this file are protected
router.use(requireAuth);

// @route   POST /api/bids/import
// @desc    Upload a contractor estimate, parse it with AI, and create a new bid
router.post('/import', uploadToMemory.single('estimate'), bidController.importBid);

// @route   GET /api/bids/lead/:leadId
// @desc    Get all bids for a specific lead
router.get('/lead/:leadId', bidController.getBidsForLead);

// ✅ NEW: Route to update a bid's details (e.g., after user edits)
router.patch('/:id', bidController.updateBid);

// @route   DELETE /api/bids/:id
// @desc    Delete a bid
router.delete('/:id', bidController.deleteBid);


module.exports = router;