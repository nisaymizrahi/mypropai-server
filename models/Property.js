const mongoose = require('mongoose');

const PropertySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    address: {
      type: String,
      required: true,
      trim: true,
    },
    addressLine1: { type: String, trim: true },
    addressLine2: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    zipCode: { type: String, trim: true },
    county: { type: String, trim: true },
    latitude: { type: Number },
    longitude: { type: Number },
    propertyType: { type: String, trim: true },
    bedrooms: { type: Number },
    bathrooms: { type: Number },
    squareFootage: { type: Number },
    lotSize: { type: Number },
    yearBuilt: { type: Number },
    unitCount: { type: Number },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Property', PropertySchema);
