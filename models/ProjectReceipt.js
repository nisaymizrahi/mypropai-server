const mongoose = require('mongoose');

const ProjectReceiptSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    investment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Investment',
      required: true,
      index: true,
    },
    budgetItem: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BudgetItem',
      default: null,
      index: true,
    },
    expense: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Expense',
      default: null,
      index: true,
    },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
      default: null,
    },
    status: {
      type: String,
      enum: ['reviewed', 'linked'],
      default: 'reviewed',
    },
    title: {
      type: String,
      trim: true,
      default: '',
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    payeeName: {
      type: String,
      trim: true,
      default: '',
    },
    amount: {
      type: Number,
      default: null,
    },
    receiptDate: {
      type: Date,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    sourceFileName: {
      type: String,
      trim: true,
      default: '',
    },
    contentType: {
      type: String,
      trim: true,
      default: '',
    },
    receiptUrl: {
      type: String,
      required: true,
      trim: true,
    },
    receiptCloudinaryId: {
      type: String,
      required: true,
      trim: true,
    },
    extracted: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    suggestedVendorSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    suggestedBudgetItemSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    linkedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ProjectReceipt', ProjectReceiptSchema);
