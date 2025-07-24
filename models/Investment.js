const mongoose = require("mongoose");

const investmentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    // Core Info
    address: { type: String, required: true },
    type: { type: String, enum: ["flip"], default: "flip" }, // Fix & Flip only
    status: {
      type: String,
      enum: ["Not Started", "In Progress", "Completed", "Sold", "Archived"],
      default: "Not Started"
    },

    // Visuals
    coverImage: { type: String },
    images: [{ type: String }],

    // Financial Basics
    purchasePrice: { type: Number, default: 0 },
    arv: { type: Number, default: 0 },
    progress: { type: Number, default: 0 },

    // Property Specs
    propertyType: { type: String },
    lotSize: { type: Number },
    sqft: { type: Number },
    bedrooms: { type: Number },
    bathrooms: { type: Number },
    yearBuilt: { type: Number },
    unitCount: { type: Number },

    // Inspection
    inspectionNotes: {
      summary: { type: String },
      issues: [{ title: String, severity: String, resolved: Boolean }]
    },

    // 🔹 Deal Analysis Inputs
    buyClosingCost: { type: Number, default: 0 },
    buyClosingIsPercent: { type: Boolean, default: true },

    loanAmount: { type: Number, default: 0 },
    interestRate: { type: Number, default: 0 },
    loanTerm: { type: Number, default: 12 },
    loanPoints: { type: Number, default: 1 },

    holdingMonths: { type: Number, default: 6 },
    taxes: { type: Number, default: 0 },
    insurance: { type: Number, default: 0 },
    utilities: { type: Number, default: 0 },
    otherMonthly: { type: Number, default: 0 },

    sellClosingCost: { type: Number, default: 6 },
    sellClosingIsPercent: { type: Boolean, default: true },

    // Optional AI-generated analysis
    aiDealSummary: { type: String },

    managedProperty: { type: mongoose.Schema.Types.ObjectId, ref: 'ManagedProperty', default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Investment", investmentSchema);
