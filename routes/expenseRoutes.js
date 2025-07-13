const express = require('express');
const router = express.Router();
const expenseController = require('../controllers/expenseController');
const requireAuth = require('../middleware/requireAuth');
const upload = require('../middleware/upload');

// All routes in this file are protected and require a user to be logged in.
router.use(requireAuth);

// @route   POST /api/expenses
// @desc    Create a new expense, possibly with a receipt upload
router.post('/', upload.single('receipt'), expenseController.createExpense);

// @route   GET /api/expenses/investment/:investmentId
// @desc    Get all expenses for a specific investment
router.get('/investment/:investmentId', expenseController.getExpensesForInvestment);

// @route   PATCH /api/expenses/:id
// @desc    Update a specific expense
router.patch('/:id', expenseController.updateExpense);

// @route   DELETE /api/expenses/:id
// @desc    Delete a specific expense
router.delete('/:id', expenseController.deleteExpense);

module.exports = router;