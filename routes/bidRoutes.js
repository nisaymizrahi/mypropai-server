const express = require('express');
const router = express.Router();
const bidController = require('../controllers/bidController');
const requireAuth = require('../middleware/requireAuth');
const { uploadToMemory } = require('../middleware/upload'); // Corrected import

router.use(requireAuth);
router.post('/import', uploadToMemory.single('estimate'), bidController.importBid);
router.get('/lead/:leadId', bidController.getBidsForLead);
router.delete('/:id', bidController.deleteBid);

module.exports = router;