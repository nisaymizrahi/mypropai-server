const mongoose = require('mongoose');

const ProjectTaskSchema = new mongoose.Schema({
  // Links this task to its investment project
  investment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Investment',
    required: true,
  },

  // Whether this is a vendor-facing task or an owner/internal reminder
  type: {
    type: String,
    enum: ['vendor', 'owner'],
    default: 'vendor',
  },

  // Task core info
  title: {
    type: String,
    required: [true, 'Please provide a title for the task.'],
    trim: true,
  },
  description: {
    type: String,
    default: '',
  },

  // Scheduling
  startDate: {
    type: Date,
    required: true,
  },
  endDate: {
    type: Date,
    required: true,
  },

  status: {
    type: String,
    enum: ['Not Started', 'In Progress', 'Complete', 'Blocked', 'On Hold'],
    default: 'Not Started',
  },

  // The contractor or vendor responsible
  assignee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
  },

  // Used to group tasks by project phase
  phase: {
    type: String,
    default: '',
  },

  // Dependencies between tasks
  dependencies: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProjectTask',
  }],

  // Optional: reminder date (email/push or notification system)
  reminderOn: {
    type: Date,
  },

  // Subtasks
  subtasks: [{
    title: { type: String },
    done: { type: Boolean, default: false },
  }],

  // Attachments per task (e.g., receipts, photos, invoices)
  attachments: [{
    url: String,
    label: String,
  }],
}, { timestamps: true });

module.exports = mongoose.model('ProjectTask', ProjectTaskSchema);
