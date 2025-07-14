const mongoose = require('mongoose');

// Financial ledger sub-schema
const TransactionSchema = new mongoose.Schema({
  date: { type: Date, default: Date.now },
  type: {
    type: String,
    enum: ['Rent Charge', 'Rent Payment', 'Late Fee', 'Other Credit', 'Other Charge'],
    required: true
  },
  description: String,
  amount: { type: Number, required: true } // cents
});

// Recurring charges sub-schema
const RecurringChargeSchema = new mongoose.Schema({
  dayOfMonth: { type: Number, min: 1, max: 28, required: true },
  type: {
    type: String,
    enum: ['Rent Charge', 'Late Fee', 'Other Charge'],
    required: true
  },
  description: { type: String, required: true },
  amount: { type: Number, required: true } // cents
});

// Client communication schema
const CommunicationSchema = new mongoose.Schema({
  date: { type: Date, default: Date.now },
  subject: { type: String, required: true },
  notes: { type: String },
  category: {
    type: String,
    enum: ['Maintenance', 'General Inquiry', 'Payment Issue', 'Personal Message', 'Other'],
    default: 'Other'
  },
  status: {
    type: String,
    enum: ['Not Started', 'In Progress', 'Finished', 'Closed'],
    default: 'Not Started'
  },
  author: {
    type: String,
    enum: ['Manager', 'Tenant'],
    default: 'Manager'
  },
  attachmentUrl: { type: String },
  attachmentCloudinaryId: { type: String }
});

const LeaseSchema = new mongoose.Schema({
  unit: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', required: true },
  tenant: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },

  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  rentAmount: { type: Number, required: true },
  securityDeposit: { type: Number, default: 0 },

  // ✅ NEW: Section for late fee rules
  lateFeePolicy: {
    applies: { type: Boolean, default: false },
    feeType: { 
        type: String, 
        enum: ['Fixed Amount', 'Percentage'],
        default: 'Fixed Amount'
    },
    amount: { type: Number, default: 50 }, // Represents either a dollar amount or a percentage
    daysLate: { type: Number, default: 5 } // Grace period in days
  },

  isActive: { type: Boolean, default: true },
  leaseDocumentUrl: String,
  notes: String,

  transactions: [TransactionSchema],
  recurringCharges: [RecurringChargeSchema],
  communications: [CommunicationSchema]

}, { timestamps: true });

module.exports = mongoose.model('Lease', LeaseSchema);
