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
  },
  
  // ✅ NEW: Section for marketing and listing details for this specific unit
  listingDetails: {
    headline: { type: String, trim: true },
    description: { type: String, trim: true },
    rent: { type: Number }, // To store the asking rent for the listing
    amenities: [String],
    photos: [{
      url: { type: String, required: true },
      cloudinaryId: { type: String, required: true },
    }]
  }

}, { timestamps: true });

module.exports = mongoose.model('Unit', UnitSchema);