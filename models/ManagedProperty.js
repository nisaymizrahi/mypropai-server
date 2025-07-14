const mongoose = require('mongoose');

const ManagedPropertySchema = new mongoose.Schema({
  // Link back to the original investment for historical data
  investment: { 
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Investment',
    required: true,
    unique: true // Ensures one management dashboard per investment
  },
  // Link to the user who owns it
  user: { 
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Address is copied from the investment for easy access and display
  address: { 
    type: String,
    required: true,
  },
  // A property can have many units
  units: [{ 
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Unit'
  }],
  // A flag to show if it's being actively managed vs. archived
  isActive: { 
    type: Boolean,
    default: true
  },

  // Section for storing detailed financial data for performance tracking
  financials: {
    // Mortgage Details
    mortgage: {
        loanAmount: { type: Number, default: 0 },
        interestRate: { type: Number, default: 0 },
        loanTerm: { type: Number, default: 30 }, // In years
        loanStartDate: { type: Date }
    },
    // Key Operating Expenses (Annual)
    operatingExpenses: {
        propertyTaxes: { type: Number, default: 0 },
        insurance: { type: Number, default: 0 },
    },
    // A field for the user to update the property's estimated current value
    currentValue: { type: Number }
  }

  // ✅ REMOVED: The listingDetails object was removed from here.

}, { timestamps: true });

module.exports = mongoose.model('ManagedProperty', ManagedPropertySchema);
