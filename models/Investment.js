const mongoose = require("mongoose");

const investmentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    address: { type: String, required: true },
    type: { type: String, enum: ["flip", "rental"], required: true },
    purchasePrice: { type: Number, required: true },
    lotSize: { type: Number },
    sqft: { type: Number },
    bedrooms: { type: Number },
    bathrooms: { type: Number },
    yearBuilt: { type: Number },
    unitCount: { type: Number }, // ✅ Added unit count for multifamily/mixed-use/commercial
    arv: { type: Number },
    rentEstimate: { type: Number },
    renovationTargetDate: { type: Date },

    // Renovation budget lines
    budget: [
      {
        category: { type: String, required: true },
        description: { type: String },
        amount: { type: Number, required: true },
        status: {
          type: String,
          enum: ["Not Started", "In Progress", "Completed"],
          default: "Not Started",
        },
      },
    ],

    // Expense entries
    expenses: [
      {
        label: { type: String }, // ✅ Added label field for custom notes
        category: { type: String },
        amount: { type: Number },
        date: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Investment", investmentSchema);
