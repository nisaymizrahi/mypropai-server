const mongoose = require('mongoose');

// This sub-schema defines a single line item in the tenant's financial ledger.
const TransactionSchema = new mongoose.Schema({
  date: { 
    type: Date, 
    default: Date.now 
  },
  type: { 
    type: String, 
    enum: ['Rent Charge', 'Rent Payment', 'Late Fee', 'Other Credit', 'Other Charge'], 
    required: true 
  },
  description: String,
  // Amount is stored in cents to avoid floating point issues.
  // Negative for charges (rent, fees), Positive for payments/credits.
  amount: {
      type: Number,
      required: true
  }
});

// NEW: Sub-schema for recurring charges
const RecurringChargeSchema = new mongoose.Schema({
  dayOfMonth: { type: Number, min: 1, max: 28, required: true }, // safe for every month
  type: { 
    type: String, 
    enum: ['Rent Charge', 'Late Fee', 'Other Charge'], 
    required: true 
  },
  description: { type: String, required: true },
  amount: { type: Number, required: true } // stored in cents
});

const LeaseSchema = new mongoose.Schema({
  // The unit this lease is for
  unit: { 
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Unit',
    required: true
  },
  // The tenant associated with this lease
  tenant: { 
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true
  },
  // Core lease terms
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  rentAmount: { type: Number, required: true },
  securityDeposit: { type: Number, default: 0 },

  // Status and document tracking
  isActive: { type: Boolean, default: true },
  leaseDocumentUrl: String, // For uploading the signed lease PDF
  notes: String,

  // The financial ledger for this specific lease
  transactions: [TransactionSchema],

  // ✅ NEW: Recurring charges to auto-apply each month
  recurringCharges: [RecurringChargeSchema]

}, { timestamps: true });

module.exports = mongoose.model('Lease', LeaseSchema);
