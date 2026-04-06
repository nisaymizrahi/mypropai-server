const mongoose = require('mongoose');

const FeatureUsageSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    featureKey: {
      type: String,
      required: true,
    },
    resourceType: {
      type: String,
      default: null,
    },
    resourceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    source: {
      type: String,
      enum: [
        'subscription_included',
        'one_time_purchase',
        'subscription_unlimited',
        'trial_credits',
        'purchased_credits',
      ],
      required: true,
    },
    occurredAt: {
      type: Date,
      default: Date.now,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  { timestamps: true }
);

FeatureUsageSchema.index({ user: 1, featureKey: 1, occurredAt: -1 });

module.exports = mongoose.model('FeatureUsage', FeatureUsageSchema);
