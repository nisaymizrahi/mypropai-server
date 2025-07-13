const mongoose = require('mongoose');

const ExpenseSchema = new mongoose.Schema({
  // Links this expense back to the main investment project.
  investment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Investment',
    required: true,
  },
  // Links this expense to a specific line item in the budget.
  budgetItem: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BudgetItem',
    required: true,
  },
  description: {
    type: String,
    required: [true, 'Please provide a description for the expense.'],
    trim: true,
  },
  amount: {
    type: Number,
    required: [true, 'Please provide the expense amount.'],
  },
  // This will link to our new Vendor model later.
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
  },
  date: {
    type: Date,
    default: Date.now,
  },
  notes: {
    type: String,
    trim: true,
  },
  receiptUrl: {
    type: String,
  },
  receiptCloudinaryId: {
    type: String,
  },
}, { timestamps: true });

module.exports = mongoose.model('Expense', ExpenseSchema);