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
  }
}, { timestamps: true });

module.exports = mongoose.model('ManagedProperty', ManagedPropertySchema);