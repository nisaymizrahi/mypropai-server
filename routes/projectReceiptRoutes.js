const express = require('express');
const router = express.Router();
const projectReceiptController = require('../controllers/projectReceiptController');
const requireAuth = require('../middleware/requireAuth');

router.use(requireAuth);

router.get('/investment/:investmentId', projectReceiptController.getReceiptsForInvestment);

module.exports = router;
