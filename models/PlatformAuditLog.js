const mongoose = require("mongoose");

const platformAuditLogSchema = new mongoose.Schema(
  {
    actorUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    actorEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },
    targetUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    targetEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },
    action: {
      type: String,
      required: true,
      index: true,
    },
    reason: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

platformAuditLogSchema.index({ targetUser: 1, createdAt: -1 });

module.exports = mongoose.model("PlatformAuditLog", platformAuditLogSchema);
