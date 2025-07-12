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

// ✅ NEW: Client communication schema
const CommunicationSchema = new mongoose.Schema({
  date: { type: Date, default: Date.now },
  subject: { type: String, required: true },
  notes: { type: String },
  category: {
    type: String,
    enum: ['Maintenance', 'General Inquiry', 'Payment Issue', 'Other'],
    default: 'Other'
  },
  attachmentUrl: { type: String } // optional link to uploaded file
});

const LeaseSchema = new mongoose.Schema({
  unit: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', required: true },
  tenant: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },

  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  rentAmount: { type: Number, required: true },
  securityDeposit: { type: Number, default: 0 },

  isActive: { type: Boolean, default: true },
  leaseDocumentUrl: String,
  notes: String,

  transactions: [TransactionSchema],
  recurringCharges: [RecurringChargeSchema],

  // ✅ NEW: Client communications
  communications: [CommunicationSchema]

}, { timestamps: true });

module.exports = mongoose.model('Lease', LeaseSchema);
