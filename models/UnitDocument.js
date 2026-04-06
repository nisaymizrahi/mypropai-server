const mongoose = require('mongoose');

const UnitDocumentSchema = new mongoose.Schema({
  unit: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', default: null },
  property: { type: mongoose.Schema.Types.ObjectId, ref: 'ManagedProperty', default: null },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  ownerAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  displayName: { type: String, required: true },
  documentAsset: { type: mongoose.Schema.Types.ObjectId, ref: 'DocumentAsset', default: null },
  fileUrl: { type: String, required: true },
  cloudinaryId: { type: String },
  secureUrl: { type: String, default: '', trim: true },
  cloudinaryAssetId: { type: String, default: '', trim: true },
  resourceType: { type: String, default: '', trim: true },
  deliveryType: { type: String, default: '', trim: true },
  fileBytes: { type: Number, default: 0, min: 0 },
  originalFilename: { type: String, default: '', trim: true },
  mimeType: { type: String, default: '', trim: true },
  cloudinaryVersion: { type: Number, default: null },
  cloudinaryFormat: { type: String, default: '', trim: true },
}, { timestamps: true });

module.exports = mongoose.model('UnitDocument', UnitDocumentSchema);
