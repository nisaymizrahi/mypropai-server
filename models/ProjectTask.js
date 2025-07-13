const mongoose = require('mongoose');

const ProjectTaskSchema = new mongoose.Schema({
  // Links this task back to the main investment project.
  investment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Investment',
    required: true,
  },
  title: {
    type: String,
    required: [true, 'Please provide a title for the task.'],
    trim: true,
  },
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
    enum: ['Not Started', 'In Progress', 'Complete', 'On Hold'],
    default: 'Not Started',
  },
  // The contractor or person responsible for this task.
  assignee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
  },
  // An array of other Task IDs that must be completed before this one can start.
  dependencies: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProjectTask',
  }],
}, { timestamps: true });

module.exports = mongoose.model('ProjectTask', ProjectTaskSchema);