const mongoose = require('mongoose');

// This defines a single item on the inspection checklist (e.g., "Living Room Walls")
const InspectionItemSchema = new mongoose.Schema({
    area: {
        type: String,
        required: true,
        trim: true,
        default: 'General'
    },
    itemName: {
        type: String,
        required: true,
        trim: true,
    },
    condition: {
        type: String,
        enum: ['Good', 'Fair', 'Poor', 'Damaged', 'N/A'],
        default: 'N/A'
    },
    notes: {
        type: String,
        trim: true,
    },
    photos: [{
        url: { type: String, required: true },
        cloudinaryId: { type: String, required: true },
    }],
});

// This is the main schema for a single inspection report
const InspectionSchema = new mongoose.Schema({
    // The user who owns this inspection report
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    // The property being inspected
    property: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ManagedProperty',
        required: true,
    },
    // The specific unit being inspected
    unit: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Unit',
        required: true,
    },
    inspectionType: {
        type: String,
        enum: ['Move-In', 'Move-Out', 'Periodic'],
        required: true,
    },
    inspectionDate: {
        type: Date,
        default: Date.now,
    },
    inspectorName: {
        type: String,
        trim: true,
    },
    // The full list of checklist items for this inspection
    items: [InspectionItemSchema]
}, { timestamps: true });

module.exports = mongoose.model('Inspection', InspectionSchema);