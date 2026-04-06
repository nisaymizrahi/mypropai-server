const mongoose = require('mongoose');

const CompsCreditGrantSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    sourceType: {
      type: String,
      enum: ['trial', 'subscription_monthly', 'purchase_pack', 'purchase_topup', 'migration'],
      required: true,
    },
    totalCredits: {
      type: Number,
      required: true,
      min: 1,
    },
    remainingCredits: {
      type: Number,
      required: true,
      min: 0,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    cycleStart: {
      type: Date,
      default: null,
    },
    cycleEnd: {
      type: Date,
      default: null,
    },
    stripeCheckoutSessionId: {
      type: String,
      default: null,
    },
    stripeSubscriptionId: {
      type: String,
      default: null,
    },
    stripeInvoiceId: {
      type: String,
      default: null,
    },
    grantKey: {
      type: String,
      default: null,
      unique: true,
      sparse: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true }
);

CompsCreditGrantSchema.index({ user: 1, sourceType: 1, expiresAt: 1, remainingCredits: 1 });

module.exports = mongoose.model('CompsCreditGrant', CompsCreditGrantSchema);
