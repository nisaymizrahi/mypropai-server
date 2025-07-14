const Inspection = require('../models/Inspection');
const ManagedProperty = require('../models/ManagedProperty');

// @desc    Create a new inspection report
exports.createInspection = async (req, res) => {
    try {
        const { propertyId, unitId, inspectionType, inspectorName, items } = req.body;

        if (!propertyId || !unitId || !inspectionType) {
            return res.status(400).json({ msg: 'Property, unit, and inspection type are required.' });
        }

        // Verify ownership of the property
        const property = await ManagedProperty.findById(propertyId);
        if (!property || property.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'User not authorized for this property.' });
        }

        const newInspection = new Inspection({
            user: req.user.id,
            property: propertyId,
            unit: unitId,
            inspectionType,
            inspectorName,
            items: items || [] // Start with provided items or an empty list
        });

        await newInspection.save();
        res.status(201).json(newInspection);

    } catch (error) {
        console.error('Error creating inspection:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Get all inspection reports for a specific property
exports.getInspectionsForProperty = async (req, res) => {
    try {
        const { propertyId } = req.params;

        // Verify ownership
        const property = await ManagedProperty.findById(propertyId);
        if (!property || property.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'User not authorized for this property.' });
        }

        const inspections = await Inspection.find({ property: propertyId })
            .populate('unit', 'name')
            .sort({ inspectionDate: -1 });
        
        res.json(inspections);

    } catch (error) {
        console.error('Error fetching inspections:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Get a single inspection report by its ID
exports.getInspectionById = async (req, res) => {
    try {
        const inspection = await Inspection.findById(req.params.id)
            .populate('unit', 'name')
            .populate('property', 'address');

        if (!inspection) {
            return res.status(404).json({ msg: 'Inspection not found.' });
        }
        
        // Check ownership
        if (inspection.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'User not authorized.' });
        }

        res.json(inspection);

    } catch (error) {
        console.error('Error fetching single inspection:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Update an inspection report
exports.updateInspection = async (req, res) => {
    try {
        const { items, inspectorName, inspectionDate } = req.body;
        const inspection = await Inspection.findById(req.params.id);

        if (!inspection) {
            return res.status(404).json({ msg: 'Inspection not found.' });
        }
        
        if (inspection.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'User not authorized.' });
        }

        if (items) inspection.items = items;
        if (inspectorName) inspection.inspectorName = inspectorName;
        if (inspectionDate) inspection.inspectionDate = inspectionDate;

        await inspection.save();
        res.json(inspection);
        
    } catch (error) {
        console.error('Error updating inspection:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};