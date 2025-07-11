const Investment = require('../models/Investment');
const ManagedProperty = require('../models/ManagedProperty');
const Unit = require('../models/Unit');
const Tenant = require('../models/Tenant');
const Lease = require('../models/Lease');

// ... (keep all the other exports like promoteInvestment, getManagedProperties, etc. They are correct)

// @desc    Get a single lease by its ID
exports.getLeaseById = async (req, res) => {
    try {
        const lease = await Lease.findById(req.params.leaseId)
            .populate('tenant')
            .populate({
                path: 'unit',
                populate: {
                    path: 'property',
                    select: 'address' // Only select the address from the property
                }
            });

        if (!lease) {
            return res.status(404).json({ msg: 'Lease not found' });
        }
        
        // This is the robust authorization check
        if (lease.tenant.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'User not authorized' });
        }

        res.json(lease);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Add a transaction to a lease's ledger
exports.addTransactionToLease = async (req, res) => {
    const { leaseId } = req.params;
    const { date, type, description, amount } = req.body;

    if (!date || !type || !amount) {
        return res.status(400).json({ msg: 'Date, type, and amount are required.' });
    }

    try {
        const lease = await Lease.findById(leaseId).populate('tenant');

        if (!lease) {
            return res.status(404).json({ msg: 'Lease not found.' });
        }

        if (lease.tenant.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'User not authorized.' });
        }

        lease.transactions.push({ date, type, description, amount: Number(amount) });
        await lease.save();
        
        res.status(201).json(lease.transactions[lease.transactions.length - 1]);

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};