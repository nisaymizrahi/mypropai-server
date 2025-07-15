const express = require('express');
const router = express.Router();
const documentController = require('../controllers/documentController');
const requireAuth = require('../middleware/requireAuth');
const { uploadToCloudinary } = require('../middleware/upload'); // Corrected import

router.use(requireAuth);
router.post('/', uploadToCloudinary.single('document'), documentController.uploadDocument);
router.get('/investment/:investmentId', documentController.getDocumentsForInvestment);
router.delete('/:id', documentController.deleteDocument);

module.exports = router;