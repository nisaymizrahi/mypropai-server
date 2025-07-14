const MaintenanceTicket = require('../models/MaintenanceTicket');
const ManagedProperty = require('../models/ManagedProperty');
const cloudinary = require('cloudinary').v2;

// @desc    Create a new maintenance ticket
exports.createTicket = async (req, res) => {
    try {
        const { propertyId, unitId, tenantId, title, description, priority } = req.body;

        if (!propertyId || !tenantId || !title) {
            return res.status(400).json({ msg: 'Property, tenant, and title are required.' });
        }

        // Verify ownership of the property
        const property = await ManagedProperty.findById(propertyId);
        if (!property || property.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'User not authorized for this property.' });
        }

        const newTicket = new MaintenanceTicket({
            user: req.user.id,
            property: propertyId,
            unit: unitId,
            tenant: tenantId,
            title,
            description,
            priority
        });

        // Handle multiple photo uploads
        if (req.files && req.files.length > 0) {
            newTicket.photos = req.files.map(file => ({
                url: file.path,
                cloudinaryId: file.filename
            }));
        }

        await newTicket.save();
        res.status(201).json(newTicket);

    } catch (error) {
        console.error('Error creating maintenance ticket:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Get all tickets for a specific property
exports.getTicketsForProperty = async (req, res) => {
    try {
        const { propertyId } = req.params;

        // Verify ownership
        const property = await ManagedProperty.findById(propertyId);
        if (!property || property.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'User not authorized for this property.' });
        }

        const tickets = await MaintenanceTicket.find({ property: propertyId })
            .populate('tenant', 'fullName')
            .populate('unit', 'name')
            .sort({ createdAt: -1 });
        
        res.json(tickets);

    } catch (error) {
        console.error('Error fetching tickets:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Get a single maintenance ticket by its ID
exports.getTicketById = async (req, res) => {
    try {
        const ticket = await MaintenanceTicket.findById(req.params.id)
            .populate('tenant', 'fullName email phone')
            .populate('unit', 'name')
            .populate('property', 'address')
            .populate('assignedVendor', 'name trade');

        if (!ticket) {
            return res.status(404).json({ msg: 'Ticket not found.' });
        }
        
        // Check ownership
        if (ticket.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'User not authorized.' });
        }

        res.json(ticket);

    } catch (error) {
        console.error('Error fetching single ticket:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Update a maintenance ticket
exports.updateTicket = async (req, res) => {
    try {
        const { status, priority, assignedVendor } = req.body;
        const ticket = await MaintenanceTicket.findById(req.params.id);

        if (!ticket) {
            return res.status(404).json({ msg: 'Ticket not found.' });
        }
        
        if (ticket.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'User not authorized.' });
        }

        if (status) ticket.status = status;
        if (priority) ticket.priority = priority;
        if (assignedVendor) ticket.assignedVendor = assignedVendor;

        await ticket.save();
        res.json(ticket);
        
    } catch (error) {
        console.error('Error updating ticket:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Delete a maintenance ticket
exports.deleteTicket = async (req, res) => {
    try {
        const ticket = await MaintenanceTicket.findById(req.params.id);

        if (!ticket) {
            return res.status(404).json({ msg: 'Ticket not found.' });
        }

        if (ticket.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'User not authorized.' });
        }
        
        // Delete all associated photos from Cloudinary before deleting the ticket
        if (ticket.photos && ticket.photos.length > 0) {
            const photoIds = ticket.photos.map(p => p.cloudinaryId);
            for (const photoId of photoIds) {
                await cloudinary.uploader.destroy(photoId);
            }
        }
        
        await ticket.deleteOne();

        res.json({ msg: 'Maintenance ticket removed.' });

    } catch (error) {
        console.error('Error deleting ticket:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};