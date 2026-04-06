const mongoose = require('mongoose');

const DocumentAssetSchema = new mongoose.Schema(
  {
    ownerAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    provider: {
      type: String,
      enum: ['cloudinary'],
      default: 'cloudinary',
      required: true,
    },
    source: {
      type: String,
      enum: ['project_document', 'managed_document', 'vendor_document'],
      required: true,
      index: true,
    },
    sourceRecordId: {
      type: String,
      default: '',
      trim: true,
    },
    publicId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    secureUrl: {
      type: String,
      required: true,
      trim: true,
    },
    assetId: {
      type: String,
      default: '',
      trim: true,
    },
    resourceType: {
      type: String,
      required: true,
      trim: true,
    },
    deliveryType: {
      type: String,
      default: 'authenticated',
      trim: true,
    },
    bytes: {
      type: Number,
      required: true,
      min: 0,
    },
    version: {
      type: Number,
      default: null,
    },
    format: {
      type: String,
      default: '',
      trim: true,
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
    displayName: {
      type: String,
      default: '',
      trim: true,
    },
    folder: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    documentCategory: {
      type: String,
      default: '',
      trim: true,
    },
    planKeyAtUpload: {
      type: String,
      default: 'free',
      trim: true,
    },
    relatedEntityType: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    relatedEntityId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    investment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Investment',
      default: null,
      index: true,
    },
    managedProperty: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ManagedProperty',
      default: null,
      index: true,
    },
    unit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Unit',
      default: null,
      index: true,
    },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

DocumentAssetSchema.index({ ownerAccount: 1, createdAt: -1 });
DocumentAssetSchema.index({ ownerAccount: 1, bytes: -1 });

module.exports = mongoose.model('DocumentAsset', DocumentAssetSchema);
