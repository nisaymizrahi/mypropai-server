const express = require('express');
const router = express.Router();
const auth = require('../middleware/requireAuth');
const upload = require('../middleware/upload'); 
const managementController = require('../controllers/managementController');

// --- Property Level Routes ---
router.post('/promote/:investmentId', auth, managementController.promoteInvestment);
router.get('/', auth, managementController.getManagedProperties);
router.get('/unmanaged-properties', auth, managementController.getUnmanagedProperties);
router.get('/:propertyId', auth, managementController.getManagedPropertyById);

// --- Unit Level Routes ---
router.post('/:propertyId/units', auth, managementController.addUnitToProperty);
router.post('/units/:unitId/lease', auth, managementController.addLeaseToUnit);

// --- Lease Level Routes ---
router.get('/leases/:leaseId', auth, managementController.getLeaseById);
router.post('/leases/:leaseId/transactions', auth, managementController.addTransactionToLease);
router.patch('/leases/:leaseId', auth, managementController.updateLease);
router.post('/recurring/run', auth, managementController.runRecurringChargesForToday);

// --- ✅ Communication Routes ---
router.get('/leases/:leaseId/communications', auth, managementController.getCommunicationsForLease);
router.post(
  '/leases/:leaseId/communications',
  auth,
  upload.single('attachment'),
  managementController.addCommunicationToLease
);
router.patch(
    '/leases/:leaseId/communications/:commId',
    auth,
    managementController.updateCommunicationStatus
);

// ✅ NEW: Route to edit a communication's subject and notes
router.put(
    '/leases/:leaseId/communications/:commId',
    auth,
    managementController.editCommunication
);

router.delete('/leases/:leaseId/communications/:commId', auth, managementController.deleteCommunicationFromLease);

module.exports = router;
