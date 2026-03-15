const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: { type: String },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String },
    googleId: { type: String },
    avatar: { type: String },
    
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
    subscriptionLastSyncedAt: {
      type: Date,
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
    accountStatus: {
      type: String,
      enum: ['active', 'suspended'],
      default: 'active',
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
    return next();
  }

  // Hash the password with a cost of 12
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);

  next();
});

// This adds a helper method to our user model to compare passwords
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("User", userSchema);
