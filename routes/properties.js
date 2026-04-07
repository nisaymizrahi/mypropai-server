const express = require('express');
const router = express.Router();
const propertyController = require('../controllers/propertyController');
const propertyCopilotController = require('../controllers/propertyCopilotController');
const { uploadToCloudinary } = require('../middleware/upload');

router.get('/', propertyController.getProperties);
router.post('/', propertyController.createProperty);
router.get('/:propertyKey', propertyController.getPropertyByKey);
router.patch('/:propertyKey', propertyController.updatePropertyProfile);
router.get('/:propertyKey/updates', propertyController.getProjectUpdates);
router.post(
  '/:propertyKey/updates',
  uploadToCloudinary.single('attachment'),
  propertyController.createProjectUpdate
);
router.patch(
  '/:propertyKey/updates/:updateId',
  uploadToCloudinary.single('attachment'),
  propertyController.updateProjectUpdate
);
router.delete('/:propertyKey/updates/:updateId', propertyController.deleteProjectUpdate);
router.post('/:propertyKey/copilot', propertyCopilotController.respond);
router.post('/:propertyKey/workspaces/pipeline', propertyController.createPipelineWorkspace);
router.post('/:propertyKey/workspaces/acquisitions', propertyController.createAcquisitionWorkspace);
router.post('/:propertyKey/workspaces/management', propertyController.createManagementWorkspace);

module.exports = router;
