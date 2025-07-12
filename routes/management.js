const express = require('express');
const router = express.Router();
const auth = require('../middleware/requireAuth');
const upload = require('../middleware/upload'); // <-- 1. IMPORT UPLOAD MIDDLEWARE
const managementController = require('../controllers/managementController');

// --- Property Level Routes ---

// Promote an Investment to a ManagedProperty
router.post('/promote/:investmentId', auth, managementController.promoteInvestment);

// Get all managed properties for the user
router.get('/', auth, managementController.getManagedProperties);

// Get all unmanaged "rent" properties for the user
router.get('/unmanaged-properties', auth, managementController.getUnmanagedProperties);

// Get a single managed property by ID
router.get('/:propertyId', auth, managementController.getManagedPropertyById);

// --- Unit Level Routes ---

// Add a new unit to a managed property
router.post('/:propertyId/units', auth, managementController.addUnitToProperty);

// Add a new tenant and lease to a specific unit
router.post('/units/:unitId/lease', auth, managementController.addLeaseToUnit);

// --- Lease Level Routes ---

// Get a single lease by ID
router.get('/leases/:leaseId', auth, managementController.getLeaseById);

// Add a transaction to a lease
router.post('/leases/:leaseId/transactions', auth, managementController.addTransactionToLease);

// Update lease fields (recurring charges, tenant info, etc.)
router.patch('/leases/:leaseId', auth, managementController.updateLease);

// Run recurring charges manually
router.post('/recurring/run', auth, managementController.runRecurringChargesForToday);

// --- ✅ Communication Routes ---

// Get all communications for a lease
router.get('/leases/:leaseId/communications', auth, managementController.getCommunicationsForLease);

// 2. MODIFY Add communication route to accept a single file named 'attachment'
router.post(
  '/leases/:leaseId/communications',
  auth,
  upload.single('attachment'),
  managementController.addCommunicationToLease
);

// 3. ADD a new route to update a communication's status
router.patch(
    '/leases/:leaseId/communications/:commId',
    auth,
    managementController.updateCommunicationStatus
);


// Delete a specific communication
router.delete('/leases/:leaseId/communications/:commId', auth, managementController.deleteCommunicationFromLease);

module.exports = router;
