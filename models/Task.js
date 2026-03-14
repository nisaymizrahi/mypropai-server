const mongoose = require("mongoose");

const TaskSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: [true, "Please provide a task title."],
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    dueDate: {
      type: Date,
      required: true,
      index: true,
    },
    urgency: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
      index: true,
    },
    status: {
      type: String,
      enum: ["open", "in_progress", "blocked", "complete"],
      default: "open",
      index: true,
    },
    propertyKey: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    propertyAddress: {
      type: String,
      default: "",
      trim: true,
    },
    sourceType: {
      type: String,
      enum: ["general", "lead", "property", "investment", "management"],
      default: "general",
      index: true,
    },
    sourceId: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    sourceLabel: {
      type: String,
      default: "",
      trim: true,
    },
    completedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

TaskSchema.index({ user: 1, dueDate: 1, status: 1 });
TaskSchema.index({ user: 1, propertyKey: 1 });
TaskSchema.index({ user: 1, sourceType: 1, sourceId: 1 });

module.exports = mongoose.model("Task", TaskSchema);
