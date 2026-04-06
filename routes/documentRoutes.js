const express = require('express');
const router = express.Router();
const documentController = require('../controllers/documentController');
const documentStorageController = require('../controllers/documentStorageController');
const requireAuth = require('../middleware/requireAuth');
const { uploadDocumentToMemory } = require('../middleware/upload');

router.use(requireAuth);
router.get('/storage/overview', documentStorageController.getStorageOverview);
router.get('/storage/assets/:assetId/access', documentStorageController.getAssetAccessUrl);
router.post('/', uploadDocumentToMemory.single('document'), documentController.uploadDocument);
router.get('/investment/:investmentId', documentController.getDocumentsForInvestment);
router.delete('/:id', documentController.deleteDocument);

module.exports = router;
