const express = require('express');
const router = express.Router();
const expenseController = require('../controllers/expenseController');
const requireAuth = require('../middleware/requireAuth');
const { uploadToCloudinary } = require('../middleware/upload'); // Corrected import

router.use(requireAuth);

router.post('/', uploadToCloudinary.single('receipt'), expenseController.createExpense); // Use correct uploader
router.get('/investment/:investmentId', expenseController.getExpensesForInvestment);
router.patch('/:id', expenseController.updateExpense);
router.delete('/:id', expenseController.deleteExpense);

module.exports = router;