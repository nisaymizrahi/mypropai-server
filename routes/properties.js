const express = require('express');
const router = express.Router();
const propertyController = require('../controllers/propertyController');

router.get('/', propertyController.getProperties);
router.post('/', propertyController.createProperty);
router.get('/:propertyKey', propertyController.getPropertyByKey);
router.patch('/:propertyKey', propertyController.updatePropertyProfile);
router.post('/:propertyKey/workspaces/pipeline', propertyController.createPipelineWorkspace);
router.post('/:propertyKey/workspaces/acquisitions', propertyController.createAcquisitionWorkspace);
router.post('/:propertyKey/workspaces/management', propertyController.createManagementWorkspace);

module.exports = router;
