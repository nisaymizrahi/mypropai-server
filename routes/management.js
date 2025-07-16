const express = require('express');
const router = express.Router();
const auth = require('../middleware/requireAuth');
const { uploadToCloudinary } = require('../middleware/upload'); 
const managementController = require('../controllers/managementController');

// All routes are correct...
router.post('/promote/:investmentId', auth, managementController.promoteInvestment);
router.get('/', auth, managementController.getManagedProperties);
router.get('/unmanaged-properties', auth, managementController.getUnmanagedProperties);
router.get('/property/:propertyId', auth, managementController.getManagedPropertyById);
router.get('/property/:propertyId/archived-leases', auth, managementController.getArchivedLeases);
router.post('/:propertyId/units', auth, managementController.addUnitToProperty);
router.get('/units/:unitId', auth, managementController.getUnitById);
router.post('/units/:unitId/lease', auth, managementController.addLeaseToUnit);
router.get('/leases/:leaseId', auth, managementController.getLeaseById);
router.post('/leases/:leaseId/transactions', auth, managementController.addTransactionToLease);
router.patch('/leases/:leaseId', auth, managementController.updateLease);
router.post('/recurring/run', auth, managementController.runRecurringChargesForToday);
router.post('/leases/:leaseId/send-invite', auth, managementController.sendTenantInvite);
router.post('/leases/:leaseId/archive', auth, managementController.archiveLease);
router.get('/leases/:leaseId/communications', auth, managementController.getCommunicationsForLease);
router.post('/leases/:leaseId/communications', auth, uploadToCloudinary.single('attachment'), managementController.addCommunicationToLease);
router.patch('/leases/:leaseId/communications/:commId', auth, managementController.updateCommunicationStatus);
router.put('/leases/:leaseId/communications/:commId', auth, managementController.editCommunication);
router.delete('/leases/:leaseId/communications/:commId', auth, managementController.deleteCommunicationFromLease);
router.patch('/units/:unitId/listing', auth, managementController.updateListingDetails);
router.post('/units/:unitId/listing/photos', auth, uploadToCloudinary.array('photos', 10), managementController.addListingPhotos);
router.delete('/units/:unitId/listing/photos/:photoId', auth, managementController.deleteListingPhoto);
router.get('/units/vacant', managementController.getVacantUnits);

module.exports = router;