const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: { type: String },
    firstName: { type: String, trim: true, default: null },
    lastName: { type: String, trim: true, default: null },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String },
    hasPassword: { type: Boolean, default: false },
    googleId: { type: String },
    avatar: { type: String },
    companyName: { type: String, trim: true, default: null },
    phoneNumber: { type: String, trim: true, default: null },
    profileCompletionRequired: {
      type: Boolean,
      default: false,
    },
    profileCompletedAt: {
      type: Date,
      default: null,
    },
    termsAcceptedAt: {
      type: Date,
      default: null,
    },
    termsVersion: {
      type: String,
      default: null,
    },
    privacyAcceptedAt: {
      type: Date,
      default: null,
    },
    privacyVersion: {
      type: String,
      default: null,
    },
    marketingConsent: {
      type: Boolean,
      default: false,
    },
    marketingConsentAcceptedAt: {
      type: Date,
      default: null,
    },
    marketingConsentRevokedAt: {
      type: Date,
      default: null,
    },
    marketingConsentVersion: {
      type: String,
      default: null,
    },
    subscriptionConsent: {
      acceptedAt: {
        type: Date,
        default: null,
      },
      version: {
        type: String,
        default: null,
      },
      termsVersion: {
        type: String,
        default: null,
      },
      privacyVersion: {
        type: String,
        default: null,
      },
      planKey: {
        type: String,
        enum: ['pro', null],
        default: null,
      },
      monthlyPriceCents: {
        type: Number,
        default: null,
      },
      renewalInterval: {
        type: String,
        default: null,
      },
      trialPeriodDays: {
        type: Number,
        default: 0,
      },
      trialEligibleAtAcceptance: {
        type: Boolean,
        default: false,
      },
      autoRenewDisclosureAccepted: {
        type: Boolean,
        default: false,
      },
      nonRefundableDisclosureAccepted: {
        type: Boolean,
        default: false,
      },
      source: {
        type: String,
        default: null,
      },
    },
    
    // --- ✅ NEW: Fields for Stripe Connect ---
    stripeAccountId: { 
        type: String 
    },
    stripeOnboardingComplete: {
      type: Boolean,
      default: false
    },
    applicationFeeCents: {
      type: Number,
      default: 5000,
      min: 0,
    },

    // Platform billing fields
    stripeCustomerId: {
      type: String,
    },
    stripeSubscriptionId: {
      type: String,
    },
    subscriptionPlan: {
      type: String,
      enum: ['free', 'pro'],
      default: 'free',
    },
    subscriptionSource: {
      type: String,
      enum: ['none', 'stripe'],
      default: 'none',
    },
    subscriptionStatus: {
      type: String,
      default: 'inactive',
    },
    subscriptionCurrentPeriodEnd: {
      type: Date,
    },
    subscriptionCurrentPeriodStart: {
      type: Date,
    },
    subscriptionLastSyncedAt: {
      type: Date,
    },
    proTrialUsedAt: {
      type: Date,
      default: null,
    },
    proTrialSubscriptionId: {
      type: String,
      default: null,
    },
    platformSubscriptionOverride: {
      type: String,
      enum: ['none', 'pro', 'free'],
      default: 'none',
    },
    platformSubscriptionOverrideAt: {
      type: Date,
    },
    platformSubscriptionOverrideBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    platformSubscriptionOverrideExpiresAt: {
      type: Date,
      default: null,
    },
    platformSubscriptionOverrideReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
    passwordResetTokenHash: {
      type: String,
      default: null,
      select: false,
    },
    passwordResetExpiresAt: {
      type: Date,
      default: null,
      select: false,
    },
    accountStatus: {
      type: String,
      enum: ['active', 'suspended'],
      default: 'active',
    },
    documentStorage: {
      bytesUsed: {
        type: Number,
        default: 0,
        min: 0,
      },
      fileCount: {
        type: Number,
        default: 0,
        min: 0,
      },
      lastReconciledAt: {
        type: Date,
        default: null,
      },
    },
  },
  { timestamps: true }
);

// This function runs before a user is saved.
// It automatically hashes the password if it's new or has been changed.
userSchema.pre("save", async function (next) {
  // Only run this function if password was actually modified
  if (!this.isModified("password")) {
    return next();
  }

  // If there's no password (e.g. Google login), continue
  if (!this.password) {
    this.hasPassword = false;
    return next();
  }

  // Hash the password with a cost of 12
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  this.hasPassword = true;

  next();
});

// This adds a helper method to our user model to compare passwords
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("User", userSchema);
