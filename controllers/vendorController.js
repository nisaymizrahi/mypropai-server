const Vendor = require('../models/Vendor');
const Expense = require('../models/Expense');

// @desc    Create a new vendor
exports.createVendor = async (req, res) => {
    try {
        const { name, trade, contactInfo, notes } = req.body;

        if (!name || !trade) {
            return res.status(400).json({ msg: 'Please provide a name and trade for the vendor.' });
        }

        const newVendor = new Vendor({
            user: req.user.id,
            name,
            trade,
            contactInfo,
            notes
        });

        await newVendor.save();
        res.status(201).json(newVendor);

    } catch (error) {
        // Handle potential duplicate name error
        if (error.code === 11000) {
            return res.status(400).json({ msg: 'A vendor with this name already exists.' });
        }
        console.error('Error creating vendor:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Get all of a user's vendors
exports.getVendors = async (req, res) => {
    try {
        const vendors = await Vendor.find({ user: req.user.id }).sort({ name: 1 });
        res.json(vendors);
    } catch (error) {
        console.error('Error fetching vendors:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Update a vendor
exports.updateVendor = async (req, res) => {
    try {
        const vendor = await Vendor.findById(req.params.id);

        if (!vendor) {
            return res.status(404).json({ msg: 'Vendor not found.' });
        }

        // Check ownership
        if (vendor.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'User not authorized.' });
        }

        // Update fields
        const { name, trade, contactInfo, notes, isActive } = req.body;
        if (name) vendor.name = name;
        if (trade) vendor.trade = trade;
        if (contactInfo) vendor.contactInfo = contactInfo;
        if (notes) vendor.notes = notes;
        if (isActive !== undefined) vendor.isActive = isActive;

        await vendor.save();
        res.json(vendor);

    } catch (error) {
        console.error('Error updating vendor:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Delete a vendor
exports.deleteVendor = async (req, res) => {
    try {
        const vendor = await Vendor.findById(req.params.id);

        if (!vendor) {
            return res.status(404).json({ msg: 'Vendor not found.' });
        }

        // Check ownership
        if (vendor.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'User not authorized.' });
        }

        // Before deleting the vendor, unlink them from any expenses.
        // This prevents data issues and keeps historical expense records intact.
        await Expense.updateMany({ vendor: req.params.id }, { $set: { vendor: null } });

        await vendor.deleteOne();

        res.json({ msg: 'Vendor removed.' });

    } catch (error) {
        console.error('Error deleting vendor:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};