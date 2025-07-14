const express = require('express');
const router = express.Router();
const operatingExpenseController = require('../controllers/operatingExpenseController');
const requireAuth = require('../middleware/requireAuth');
const upload = require('../middleware/upload');

// All routes in this file are protected
router.use(requireAuth);

// @route   POST /api/operating-expenses
// @desc    Create a new operating expense for a managed property
router.post('/', upload.single('receipt'), operatingExpenseController.createOperatingExpense);

// @route   GET /api/operating-expenses/property/:propertyId
// @desc    Get all operating expenses for a specific property
router.get('/property/:propertyId', operatingExpenseController.getOperatingExpensesForProperty);

// @route   PATCH /api/operating-expenses/:expenseId
// @desc    Update an operating expense
router.patch('/:expenseId', operatingExpenseController.updateOperatingExpense);

// @route   DELETE /api/operating-expenses/:expenseId
// @desc    Delete an operating expense
router.delete('/:expenseId', operatingExpenseController.deleteOperatingExpense);

module.exports = router;