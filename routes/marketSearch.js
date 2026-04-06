const express = require('express');
const marketSearchController = require('../controllers/marketSearchController');

const router = express.Router();

router.post('/sale-listings/search', marketSearchController.searchSaleListings);
router.post('/sale-listings/import', marketSearchController.importSaleListing);

module.exports = router;
