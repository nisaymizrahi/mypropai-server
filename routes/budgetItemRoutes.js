const express = require('express');
const router = express.Router();
const budgetItemController = require('../controllers/budgetItemController.js');
const requireAuth = require('../middleware/requireAuth');

// All routes in this file are protected and require a user to be logged in.
router.use(requireAuth);

// @route   POST /api/budget-items
// @desc    Create a new budget item for an investment
router.post('/', budgetItemController.createBudgetItem);

// @route   GET /api/budget-items/investment/:investmentId
// @desc    Get all budget items for a specific investment
router.get('/investment/:investmentId', budgetItemController.getBudgetItemsForInvestment);

// @route   PATCH /api/budget-items/:id
// @desc    Update a specific budget item
router.patch('/:id', budgetItemController.updateBudgetItem);

// @route   POST /api/budget-items/:id/awards
// @desc    Add a vendor commitment to a specific budget item
router.post('/:id/awards', budgetItemController.addBudgetAward);

// @route   PATCH /api/budget-items/:id/awards/:awardId
// @desc    Update a vendor commitment on a specific budget item
router.patch('/:id/awards/:awardId', budgetItemController.updateBudgetAward);

// @route   DELETE /api/budget-items/:id/awards/:awardId
// @desc    Delete a vendor commitment from a specific budget item
router.delete('/:id/awards/:awardId', budgetItemController.deleteBudgetAward);

// @route   DELETE /api/budget-items/:id
// @desc    Delete a specific budget item
router.delete('/:id', budgetItemController.deleteBudgetItem);

module.exports = router;
