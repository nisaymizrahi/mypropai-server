const mongoose = require('mongoose');

const UnitSchema = new mongoose.Schema({
  // Link to the parent property this unit belongs to
  property: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ManagedProperty',
    required: true
  },
  // A user-defined name for the unit, e.g., "Unit A", "Apt 2B", "#101"
  name: {
    type: String,
    required: true,
    trim: true
  },
  // Optional descriptive fields
  beds: Number,
  baths: Number,
  sqft: Number,
  // A reference to the currently active lease for this unit
  currentLease: { 
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lease',
    default: null
  },
  // The current occupancy status of the unit
  status: {
      type: String,
      enum: ['Occupied', 'Vacant'],
      default: 'Vacant'
  }
}, { timestamps: true });

module.exports = mongoose.model('Unit', UnitSchema);