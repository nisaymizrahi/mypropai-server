const express = require('express');
const router = express.Router();
const leadController = require('../controllers/leadController');
const requireAuth = require('../middleware/requireAuth');

// All routes in this file are protected
router.use(requireAuth);

// ✅ NEW: Route to get summary data for the leads dashboard
router.get('/summary', leadController.getLeadSummary);

// @route   POST /api/leads
// @desc    Create a new lead
router.post('/', leadController.createLead);

// @route   GET /api/leads
// @desc    Get all of a user's leads
router.get('/', leadController.getLeads);

// @route   GET /api/leads/:id
// @desc    Get a single lead by its ID
router.get('/:id', leadController.getLeadById);

// @route   PATCH /api/leads/:id
// @desc    Update a lead (e.g., change status or notes)
router.patch('/:id', leadController.updateLead);

// @route   DELETE /api/leads/:id
// @desc    Delete a lead
router.delete('/:id', leadController.deleteLead);

// @route   POST /api/leads/:id/analyze-comps
// @desc    Run the AI comps analysis for a specific lead
router.post('/:id/analyze-comps', leadController.analyzeComps);


module.exports = router;