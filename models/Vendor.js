const mongoose = require('mongoose');

const VendorSchema = new mongoose.Schema({
  // The user this vendor belongs to.
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  name: {
    type: String,
    required: [true, 'Please provide a vendor or company name.'],
    trim: true,
    unique: true, // Ensures you don't have duplicate vendors for the same user.
  },
  trade: {
    type: String,
    required: [true, 'Please specify the vendor\'s trade (e.g., Plumbing, Electrical).'],
    trim: true,
  },
  contactInfo: {
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    address: {
      type: String,
      trim: true,
    },
  },
  notes: {
    type: String,
    trim: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, { timestamps: true });

module.exports = mongoose.model('Vendor', VendorSchema);