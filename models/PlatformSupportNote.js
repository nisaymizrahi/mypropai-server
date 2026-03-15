const mongoose = require("mongoose");

const platformSupportNoteSchema = new mongoose.Schema(
  {
    targetUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    authorUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    authorEmail: {
      type: String,
      trim: true,
      lowercase: true,
      required: true,
    },
    body: {
      type: String,
      trim: true,
      required: true,
      maxlength: 4000,
    },
  },
  { timestamps: true }
);

platformSupportNoteSchema.index({ targetUser: 1, createdAt: -1 });

module.exports = mongoose.model("PlatformSupportNote", platformSupportNoteSchema);
