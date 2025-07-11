const mongoose = require("mongoose");

// A sub-schema for more detailed expense tracking.
const expenseSchema = new mongoose.Schema({
  description: { type: String, required: true },
  category: { type: String, required: true },
  amount: { type: Number, required: true },
  vendor: { type: String },
  notes: { type: String },
  receiptUrl: { type: String },
  date: { type: Date, default: Date.now }, // This is for renovation expenses
});

// A sub-schema for budget line items.
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

// The main investment schema, now with a comprehensive analysis structure.
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

    // Deal Analysis section for "soft costs" common to both deal types
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

    // Expanded financing details for both purchase and refinance
    financingDetails: {
      purchaseLoan: {
        loanAmount: { type: Number, default: 0 },
        interestRate: { type: Number, default: 0 },
        loanTerm: { type: Number, default: 30 },
      },
      refinanceLoan: {
        loanAmount: { type: Number, default: 0 },
        interestRate: { type: Number, default: 0 },
        loanTerm: { type: Number, default: 30 },
      }
    },

    // Rental-Specific Operating Expenses for long-term analysis
    rentalAnalysis: {
        vacancyRate: { type: Number, default: 5 },
        repairsMaintenanceRate: { type: Number, default: 5 },
        capitalExpendituresRate: { type: Number, default: 5 },
        managementFeeRate: { type: Number, default: 8 },
        propertyTaxes: { type: Number, default: 0 },
        insurance: { type: Number, default: 0 },
        otherMonthlyCosts: { type: Number, default: 0 }
    },
    
    // NEW: Link to the property management system
    managedPropertyId: { type: mongoose.Schema.Types.ObjectId, ref: 'ManagedProperty' }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Investment", investmentSchema);
