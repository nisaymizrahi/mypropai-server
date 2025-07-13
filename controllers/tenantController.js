const Lease = require('../models/Lease');

// @desc    Get the active lease details for the currently logged-in tenant
// @route   GET /api/tenant/lease-details
// @access  Private (Tenant)
exports.getLeaseDetails = async (req, res) => {
    try {
        // req.tenantUser is attached by our requireTenantAuth middleware.
        // We use the tenantInfo ID to find the active lease.
        const lease = await Lease.findOne({ 
            tenant: req.tenantUser.tenantInfo,
            isActive: true 
        })
        .populate({
            path: 'unit',
            select: 'name property',
            populate: {
                path: 'property',
                select: 'address'
            }
        })
        .populate('tenant', 'fullName email phone');

        if (!lease) {
            return res.status(404).json({ msg: 'No active lease found for this tenant.' });
        }

        res.status(200).json(lease);

    } catch (err) {
        console.error("Error fetching tenant's lease details:", err);
        res.status(500).json({ msg: 'Server Error' });
    }
};


// @desc    Allow a tenant to submit a communication/request
// @route   POST /api/tenant/communications
// @access  Private (Tenant)
exports.submitCommunication = async (req, res) => {
    const { subject, notes, category } = req.body;

    if (!subject || !category) {
        return res.status(400).json({ msg: 'Subject and category are required.' });
    }

    try {
        const lease = await Lease.findOne({ 
            tenant: req.tenantUser.tenantInfo,
            isActive: true 
        });

        if (!lease) {
            return res.status(404).json({ msg: 'No active lease found to submit communication to.' });
        }

        const newEntry = {
            subject,
            notes,
            category,
            author: 'Tenant', // Set the author automatically
        };

        if (req.file) {
            newEntry.attachmentUrl = req.file.path;
            newEntry.attachmentCloudinaryId = req.file.filename;
        }

        lease.communications.push(newEntry);
        await lease.save();

        res.status(201).json(lease.communications[lease.communications.length - 1]);

    } catch (err) {
        console.error("Error submitting tenant communication:", err);
        res.status(500).json({ msg: 'Server Error' });
    }
};