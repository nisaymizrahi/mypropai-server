const mongoose = require('mongoose');

const projectUpdateAttachmentSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      trim: true,
      default: '',
    },
    publicId: {
      type: String,
      trim: true,
      default: '',
    },
    originalName: {
      type: String,
      trim: true,
      default: '',
    },
    mimeType: {
      type: String,
      trim: true,
      default: '',
    },
    resourceType: {
      type: String,
      trim: true,
      default: '',
    },
    bytes: {
      type: Number,
      default: null,
    },
  },
  { _id: false }
);

const projectUpdateSchema = new mongoose.Schema(
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
      index: true,
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      default: null,
      index: true,
    },
    investment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Investment',
      default: null,
      index: true,
    },
    type: {
      type: String,
      enum: ['internal_note', 'site_visit', 'issue', 'vendor_update', 'lender_update'],
      default: 'internal_note',
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
    },
    body: {
      type: String,
      required: true,
      trim: true,
      maxlength: 6000,
    },
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    authorName: {
      type: String,
      trim: true,
      default: '',
      maxlength: 180,
    },
    attachment: {
      type: projectUpdateAttachmentSchema,
      default: null,
    },
    editedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

projectUpdateSchema.index({ user: 1, propertyKey: 1, createdAt: -1 });
projectUpdateSchema.index({ user: 1, property: 1, createdAt: -1 });

module.exports = mongoose.model('ProjectUpdate', projectUpdateSchema);
