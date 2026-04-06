const mongoose = require('mongoose');

const ExpenseSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
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
    default: null,
  },
  receiptRecord: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProjectReceipt',
    default: null,
  },
  awardId: {
    type: String,
    default: '',
    trim: true,
  },
  fundingSourceId: {
    type: String,
    default: '',
    trim: true,
  },
  drawRequestId: {
    type: String,
    default: '',
    trim: true,
  },
  status: {
    type: String,
    enum: ['draft', 'approved', 'paid', 'reimbursed'],
    default: 'paid',
  },
  paymentMethod: {
    type: String,
    enum: ['other', 'ach', 'wire', 'check', 'cash', 'credit_card', 'debit_card'],
    default: 'other',
  },
  recurringCategory: {
    type: String,
    enum: ['', 'taxes', 'insurance', 'utilities', 'other_monthly'],
    default: '',
  },
  title: {
    type: String,
    required: [true, 'Please provide a title for the expense.'],
    trim: true,
  },
  description: {
    type: String,
    default: '',
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
  payeeName: {
    type: String,
    trim: true,
    default: '',
  },
  date: {
    type: Date,
    default: Date.now,
  },
  entryMethod: {
    type: String,
    enum: ['manual', 'receipt_ai'],
    default: 'manual',
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
  receiptExtraction: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
}, { timestamps: true });

module.exports = mongoose.model('Expense', ExpenseSchema);
