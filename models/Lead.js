const mongoose = require('mongoose');

const LeadSchema = new mongoose.Schema({
  // The user this lead belongs to.
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  // The full address of the potential property.
  address: {
    type: String,
    required: [true, 'Please provide the property address.'],
    trim: true,
  },
  // The stage of the deal in your pipeline.
  status: {
    type: String,
    enum: [
        'Potential', 
        'Analyzing', 
        'Offer Made', 
        'Under Contract', 
        'Closed - Won', 
        'Closed - Lost'
    ],
    default: 'Potential',
  },
  // Simple field for any user notes on the lead.
  notes: {
    type: String,
    trim: true,
  },
  // We can add fields here later to cache the results of AI analysis.

}, { timestamps: true });

module.exports = mongoose.model('Lead', LeadSchema);