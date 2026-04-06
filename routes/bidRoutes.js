const express = require('express');
const router = express.Router();
const bidController = require('../controllers/bidController');
const requireAuth = require('../middleware/requireAuth');
const { uploadBidEstimate } = require('../middleware/upload');

// All routes in this file are protected
router.use(requireAuth);

// @route   POST /api/bids/import
// @desc    Upload a contractor estimate, parse it with AI, and create a new bid
router.post('/import', uploadBidEstimate.single('estimate'), bidController.importBid);

// @route   POST /api/bids
// @desc    Create a custom/manual bid
router.post('/', bidController.createBid);

// @route   GET /api/bids/lead/:leadId
// @desc    Get all bids for a specific lead
router.get('/lead/:leadId', bidController.getBidsForLead);

// @route   GET /api/bids/project/:investmentId
// @desc    Get all bids visible in project execution
router.get('/project/:investmentId', bidController.getBidsForProject);

// ✅ NEW: Route to update a bid's details (e.g., after user edits)
router.patch('/:id', bidController.updateBid);

// @route   POST /api/bids/:id/award
// @desc    Convert a bid into a project commitment / budget award
router.post('/:id/award', bidController.awardBidToBudgetItem);

// @route   DELETE /api/bids/:id
// @desc    Delete a bid
router.delete('/:id', bidController.deleteBid);


module.exports = router;
