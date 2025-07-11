const mongoose = require('mongoose');

const OperatingExpenseSchema = new mongoose.Schema({
  // Link to the managed property this expense belongs to
  property: { 
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ManagedProperty',
    required: true
  },
  // The user-settable date the expense was incurred
  date: { 
    type: Date,
    required: true
  },
  // Core expense details
  description: { type: String, required: true },
  category: { // e.g., Repairs, Utilities, Taxes, Insurance, HOA Fees
    type: String,
    required: true
  },
  amount: { type: Number, required: true },
  vendor: String,
  receiptUrl: String,
  
  // --- NEW: Fields to handle recurring expenses ---
  isRecurring: {
    type: Boolean,
    default: false
  },
  // Defines how often the expense reoccurs
  recurringFrequency: { 
    type: String,
    enum: [null, 'monthly', 'quarterly', 'annually'],
    default: null
  }
}, { timestamps: true });

module.exports = mongoose.model('OperatingExpense', OperatingExpenseSchema);