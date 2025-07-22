const mongoose = require("mongoose");

const investmentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Core Details
    address: { type: String, required: true },
    type: { type: String, enum: ["flip", "rent"], required: true },
    purchasePrice: { type: Number, default: 0 },
    arv: { type: Number, default: 0 },
    rentEstimate: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["Not Started", "In Progress", "Completed"],
      default: "Not Started",
    },
    progress: { type: Number, default: 0 },
    coverImage: { type: String }, // Optional property thumbnail
    isArchived: { type: Boolean, default: false },

    // Property Info
    propertyType: { type: String },
    lotSize: { type: Number },
    sqft: { type: Number },
    bedrooms: { type: Number },
    bathrooms: { type: Number },
    yearBuilt: { type: Number },
    unitCount: { type: Number },

    // Financial Breakdown
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
