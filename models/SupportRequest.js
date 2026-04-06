const mongoose = require("mongoose");

const supportRequestSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      required: true,
      maxlength: 120,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      required: true,
      maxlength: 320,
    },
    companyName: {
      type: String,
      trim: true,
      maxlength: 160,
      default: "",
    },
    requestType: {
      type: String,
      enum: [
        "general_question",
        "report_issue",
        "account_help",
        "billing_help",
        "feature_request",
      ],
      required: true,
    },
    subject: {
      type: String,
      trim: true,
      required: true,
      maxlength: 160,
    },
    message: {
      type: String,
      trim: true,
      required: true,
      maxlength: 5000,
    },
    pageUrl: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    source: {
      type: String,
      trim: true,
      maxlength: 80,
      default: "website_help_center",
    },
    status: {
      type: String,
      enum: ["new", "in_progress", "resolved"],
      default: "new",
    },
    userAgent: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    notificationRecipients: {
      type: [String],
      default: [],
    },
    notifiedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

supportRequestSchema.index({ createdAt: -1 });
supportRequestSchema.index({ requestType: 1, createdAt: -1 });
supportRequestSchema.index({ status: 1, createdAt: -1 });
supportRequestSchema.index({ email: 1, createdAt: -1 });

module.exports = mongoose.model("SupportRequest", supportRequestSchema);
