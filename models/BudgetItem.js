const mongoose = require('mongoose');
const { nanoid } = require('nanoid');

const BudgetItemSchema = new mongoose.Schema({
  // A unique, human-readable ID for this item.
  itemId: {
    type: String,
    default: () => nanoid(8),
    unique: true,
  },
  // Links this budget item back to the main investment project.
  investment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Investment',
    required: true,
  },
  category: {
    type: String,
    required: [true, 'Please provide a budget category (e.g., Plumbing, Electrical).'],
    trim: true,
  },
  description: {
    type: String,
    required: [true, 'Please provide a description of the work.'],
    trim: true,
  },
  budgetedAmount: {
    type: Number,
    required: [true, 'Please provide a budget amount.'],
    default: 0,
  },
  status: {
    type: String,
    enum: ['Not Started', 'In Progress', 'Awaiting Materials', 'Complete', 'On Hold'],
    default: 'Not Started',
  },
  dueDate: {
    type: Date,
  },
}, { timestamps: true });

module.exports = mongoose.model('BudgetItem', BudgetItemSchema);