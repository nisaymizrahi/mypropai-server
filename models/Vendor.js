const mongoose = require('mongoose');

const VendorDocumentSchema = new mongoose.Schema(
  {
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      default: 'Other',
      trim: true,
    },
    fileUrl: {
      type: String,
      required: true,
    },
    cloudinaryId: {
      type: String,
      required: true,
    },
    issueDate: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    notes: {
      type: String,
      default: '',
      trim: true,
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

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
  specialties: [{
    type: String,
    trim: true,
  }],
  description: {
    type: String,
    trim: true,
    default: '',
  },
  contactInfo: {
    contactName: {
      type: String,
      trim: true,
    },
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
  serviceArea: {
    type: String,
    trim: true,
    default: '',
  },
  notes: {
    type: String,
    trim: true,
  },
  status: {
    type: String,
    enum: ['active', 'preferred', 'not_assignable', 'inactive'],
    default: 'active',
  },
  afterHoursAvailable: {
    type: Boolean,
    default: false,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  
  // ✅ NEW: Section for compliance tracking
  compliance: {
    w9_url: { type: String },
    insurance_url: { type: String },
    insurance_expiration_date: { type: Date },
  },
  documents: [VendorDocumentSchema],

}, { timestamps: true });

module.exports = mongoose.model('Vendor', VendorSchema);
