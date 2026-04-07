const mongoose = require('mongoose');

const LeadDocumentSchema = new mongoose.Schema(
  {
    lead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lead',
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    displayName: {
      type: String,
      required: [true, 'Please provide a display name for the document.'],
      trim: true,
    },
    category: {
      type: String,
      default: 'General',
      trim: true,
    },
    ownerAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    documentAsset: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DocumentAsset',
      default: null,
    },
    fileUrl: {
      type: String,
      required: true,
    },
    cloudinaryId: {
      type: String,
      required: true,
    },
    secureUrl: {
      type: String,
      default: '',
      trim: true,
    },
    cloudinaryAssetId: {
      type: String,
      default: '',
      trim: true,
    },
    resourceType: {
      type: String,
      default: '',
      trim: true,
    },
    deliveryType: {
      type: String,
      default: '',
      trim: true,
    },
    fileBytes: {
      type: Number,
      default: 0,
      min: 0,
    },
    originalFilename: {
      type: String,
      default: '',
      trim: true,
    },
    mimeType: {
      type: String,
      default: '',
      trim: true,
    },
    cloudinaryVersion: {
      type: Number,
      default: null,
    },
    cloudinaryFormat: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('LeadDocument', LeadDocumentSchema);
