const mongoose = require('mongoose');

// This sub-schema represents a single line item within a bid
const BidItemSchema = new mongoose.Schema({
  description: {
    type: String,
    required: true,
    trim: true,
  },
  category: {
    type: String,
    default: 'Uncategorized',
  },
  cost: {
    type: Number,
    required: true,
  },
});

const BidRenovationAssignmentSchema = new mongoose.Schema({
  renovationItemId: {
    type: String,
    required: true,
    trim: true,
  },
  renovationItemName: {
    type: String,
    trim: true,
  },
  budgetItemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BudgetItem',
    default: null,
  },
  budgetItemLabel: {
    type: String,
    trim: true,
    default: '',
  },
  amount: {
    type: Number,
  },
  scopeSummary: {
    type: String,
    trim: true,
  },
  confidence: {
    type: Number,
  },
  matchedLineItems: [{
    type: String,
    trim: true,
  }],
}, { _id: false });

const BidVendorSnapshotSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true,
  },
  contactName: {
    type: String,
    trim: true,
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
  },
  phone: {
    type: String,
    trim: true,
  },
  address: {
    type: String,
    trim: true,
  },
}, { _id: false });

const BidAwardLinkSchema = new mongoose.Schema({
  budgetItem: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BudgetItem',
    default: null,
  },
  awardId: {
    type: String,
    trim: true,
    default: '',
  },
  amount: {
    type: Number,
    default: 0,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
}, { _id: false });

// This is the main schema for a single, complete bid from a contractor
const BidSchema = new mongoose.Schema({
  // Link to the user who owns this bid
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  // Link to the lead this bid is for
  lead: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
    required: true,
  },
  investment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Investment',
    default: null,
    index: true,
  },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    default: null,
  },
  // The contractor's details, extracted by the AI
  contractorName: {
    type: String,
    trim: true,
  },
  // The total amount of the bid
  totalAmount: {
    type: Number,
    required: true,
  },
  bidDate: {
    type: Date,
    default: Date.now,
  },
  sourceType: {
    type: String,
    enum: ['imported', 'manual'],
    default: 'imported',
  },
  sourceFileName: {
    type: String,
    trim: true,
  },
  sourceDocumentUrl: {
    type: String,
    trim: true,
  },
  decisionStatus: {
    type: String,
    enum: ['open', 'awarded', 'archived'],
    default: 'open',
  },
  awardedAt: {
    type: Date,
    default: null,
  },
  notes: {
    type: String,
    trim: true,
    default: '',
  },
  vendorSnapshot: BidVendorSnapshotSchema,
  // The array of all line items parsed from the estimate
  items: [BidItemSchema],
  renovationAssignments: [BidRenovationAssignmentSchema],
  awards: [BidAwardLinkSchema],
}, { timestamps: true });

module.exports = mongoose.model('Bid', BidSchema);
