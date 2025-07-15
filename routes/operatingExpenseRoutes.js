const express = require('express');
const router = express.Router();
const operatingExpenseController = require('../controllers/operatingExpenseController');
const requireAuth = require('../middleware/requireAuth');
const { uploadToCloudinary } = require('../middleware/upload'); // Corrected import

router.use(requireAuth);

router.post('/', uploadToCloudinary.single('receipt'), operatingExpenseController.createOperatingExpense); // Use correct uploader
router.get('/property/:propertyId', operatingExpenseController.getOperatingExpensesForProperty);
router.patch('/:expenseId', operatingExpenseController.updateOperatingExpense);
router.delete('/:expenseId', operatingExpenseController.deleteOperatingExpense);

module.exports = router;