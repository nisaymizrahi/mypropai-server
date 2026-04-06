const mongoose = require('mongoose');

const IndexedDocumentSchema = new mongoose.Schema(
  {
    assetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DocumentAsset',
      default: null,
    },
    sourceKind: {
      type: String,
      enum: ['project_document', 'managed_document'],
      required: true,
    },
    sourceDocumentId: {
      type: String,
      required: true,
      trim: true,
    },
    openaiFileId: {
      type: String,
      default: '',
      trim: true,
    },
    vectorStoreFileId: {
      type: String,
      default: '',
      trim: true,
    },
    filename: {
      type: String,
      default: '',
      trim: true,
    },
    mimeType: {
      type: String,
      default: '',
      trim: true,
    },
    category: {
      type: String,
      default: '',
      trim: true,
    },
    sourceUpdatedAt: {
      type: Date,
      default: null,
    },
    indexedAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ['indexed', 'failed'],
      default: 'indexed',
    },
    lastError: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { _id: false }
);

const PropertyCopilotIndexSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    propertyKey: {
      type: String,
      required: true,
      trim: true,
    },
    propertyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      default: null,
      index: true,
    },
    vectorStoreId: {
      type: String,
      default: '',
      trim: true,
    },
    vectorStoreStatus: {
      type: String,
      default: '',
      trim: true,
    },
    lastSyncedAt: {
      type: Date,
      default: null,
    },
    lastSyncError: {
      type: String,
      default: '',
      trim: true,
    },
    indexedDocuments: {
      type: [IndexedDocumentSchema],
      default: [],
    },
  },
  { timestamps: true }
);

PropertyCopilotIndexSchema.index({ user: 1, propertyKey: 1 }, { unique: true });

module.exports = mongoose.model('PropertyCopilotIndex', PropertyCopilotIndexSchema);
