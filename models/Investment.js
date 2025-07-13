const mongoose = require("mongoose");

// The main investment schema.
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

    // NOTE: The old budget and expenses arrays have been removed from this model.
    // They are now handled by the new dedicated BudgetItem and Expense models.

    // Deal Analysis section for "soft costs"
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

    // Expanded financing details
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

    // Rental-Specific Operating Expenses
    rentalAnalysis: {
        vacancyRate: { type: Number, default: 5 },
        repairsMaintenanceRate: { type: Number, default: 5 },
        capitalExpendituresRate: { type: Number, default: 5 },
        managementFeeRate: { type: Number, default: 8 },
        propertyTaxes: { type: Number, default: 0 },
        insurance: { type: Number, default: 0 },
        otherMonthlyCosts: { type: Number, default: 0 }
    },
    
    managedProperty: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'ManagedProperty',
      default: null 
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Investment", investmentSchema);
