const mongoose = require("mongoose");

// NEW: A sub-schema for more detailed expense tracking.
const expenseSchema = new mongoose.Schema({
  description: { type: String, required: true },
  category: { type: String, required: true },
  amount: { type: Number, required: true },
  vendor: { type: String },
  notes: { type: String },
  receiptUrl: { type: String }, // To store the link to the uploaded document
  date: { type: Date, default: Date.now },
});

// NEW: A sub-schema for budget line items.
const budgetSchema = new mongoose.Schema({
  category: { type: String, required: true },
  description: { type: String },
  amount: { type: Number, required: true },
  status: {
    type: String,
    enum: ["Not Started", "In Progress", "Completed"],
    default: "Not Started",
  },
});

// The main investment schema, now with much more detail.
const investmentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Core Property Details
    address: { type: String, required: true },
    type: { type: String, enum: ["flip", "rent"], required: true },
    purchasePrice: { type: Number, default: 0 },
    arv: { type: Number, default: 0 },
    rentEstimate: { type: Number, default: 0 },
    
    // Physical Characteristics
    propertyType: { type: String },
    lotSize: { type: Number },
    sqft: { type: Number },
    bedrooms: { type: Number },
    bathrooms: { type: Number },
    yearBuilt: { type: Number },
    unitCount: { type: Number },

    // Renovation Tracking
    budget: [budgetSchema],
    expenses: [expenseSchema],

    // NEW: Deal Analysis section for "soft costs"
    dealAnalysis: {
      buyingCosts: { type: Number, default: 0 },
      sellingCosts: {
          value: { type: Number, default: 6 },
          isPercentage: { type: Boolean, default: true }
      },
      holdingCosts: {
          monthlyAmount: { type: Number, default: 0 },
          durationMonths: { type: Number, default: 6 }
      },
      financingCosts: { type: Number, default: 0 }
    },

    // NEW: Financing Details section
    financingDetails: {
      useFinancing: { type: Boolean, default: false },
      loanAmount: { type: Number, default: 0 },
      interestRate: { type: Number, default: 0 },
      loanTerm: { type: Number, default: 30 }, // In years
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Investment", investmentSchema);
