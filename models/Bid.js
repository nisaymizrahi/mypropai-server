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
  // The array of all line items parsed from the estimate
  items: [BidItemSchema],
  
}, { timestamps: true });

module.exports = mongoose.model('Bid', BidSchema);