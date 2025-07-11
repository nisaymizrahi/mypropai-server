// ... (All other functions like promoteInvestment, addLeaseToUnit, etc. remain the same) ...

const Investment = require('../models/Investment');
const ManagedProperty = require('../models/ManagedProperty');
const Unit = require('../models/Unit');
const Tenant = require('../models/Tenant');
const Lease = require('../models/Lease');

// --- Keep all your other controller functions above this line ---
// promoteInvestment, getManagedProperties, getUnmanagedProperties, etc.


// @desc    Get a single lease by its ID (DEBUGGING VERSION)
exports.getLeaseById = async (req, res) => {
    try {
        console.log(`--- DEBUG: Fetching Lease ID: ${req.params.leaseId} ---`);

        const lease = await Lease.findById(req.params.leaseId).populate('tenant');

        if (!lease) {
            console.log('--- DEBUG: Lease not found in database. ---');
            return res.status(404).json({ msg: 'Lease not found' });
        }
        
        // Let's log everything to see what the server sees
        console.log('--- DEBUG: Found Lease Object ---');
        console.log(JSON.stringify(lease, null, 2));

        if (!lease.tenant) {
            console.log('--- DEBUG: ERROR - Tenant not populated on the lease. ---');
            return res.status(500).json({ msg: 'Server error: Tenant data missing.' });
        }

        console.log(`--- DEBUG: Comparing IDs ---`);
        console.log(`Logged-in user (req.user.id):     '${req.user.id}'`);
        console.log(`Lease tenant's owner (lease.tenant.user): '${lease.tenant.user}'`);

        // This is the authorization check
        if (lease.tenant.user.toString() !== req.user.id) {
            console.log('--- DEBUG: Authorization FAILED. IDs do not match. ---');
            return res.status(401).json({ msg: 'User not authorized' });
        }

        console.log('--- DEBUG: Authorization SUCCEEDED. ---');
        
        // If authorization passes, we still need to populate the rest for the frontend
        const finalLease = await Lease.findById(req.params.leaseId)
            .populate('tenant')
            .populate({
                path: 'unit',
                populate: {
                    path: 'property',
                    select: 'address'
                }
            });

        res.json(finalLease);

    } catch (err) {
        console.error('--- DEBUG: CRASH in getLeaseById ---', err);
        res.status(500).send('Server Error');
    }
};

// --- Keep all your other controller functions below this line ---

// All other exports like addTransactionToLease should be here...