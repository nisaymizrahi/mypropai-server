const mongoose = require('mongoose');

const ProjectDocumentSchema = new mongoose.Schema({
  // Links this document back to the main investment project.
  investment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Investment',
    required: true,
  },
  // The user who uploaded the document.
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  // The user-friendly name for the file.
  displayName: {
    type: String,
    required: [true, 'Please provide a display name for the document.'],
    trim: true,
  },
  // A category for organization (e.g., "Contracts", "Permits", "Photos").
  category: {
    type: String,
    default: 'General',
    trim: true,
  },
  fundingSourceId: {
    type: String,
    default: '',
    trim: true,
  },
  drawRequestId: {
    type: String,
    default: '',
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
  // The secure URL from Cloudinary.
  fileUrl: {
    type: String,
    required: true,
  },
  // The public_id from Cloudinary, needed for deletion.
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
}, { timestamps: true });

module.exports = mongoose.model('ProjectDocument', ProjectDocumentSchema);
