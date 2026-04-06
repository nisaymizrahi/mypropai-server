const mongoose = require('mongoose');

const PurchaseSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    kind: {
      type: String,
      required: true,
    },
    resourceType: {
      type: String,
      required: true,
    },
    resourceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'consumed', 'refunded', 'canceled'],
      default: 'pending',
    },
    amountCents: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: 'usd',
    },
    stripeCheckoutSessionId: {
      type: String,
    },
    stripePaymentIntentId: {
      type: String,
    },
    purchasedAt: {
      type: Date,
    },
    consumedAt: {
      type: Date,
    },
    fulfilledAt: {
      type: Date,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  { timestamps: true }
);

PurchaseSchema.index({ user: 1, kind: 1, resourceId: 1, status: 1 });

module.exports = mongoose.model('Purchase', PurchaseSchema);
