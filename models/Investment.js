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
    arv: { type: Number },
    rentEstimate: { type: Number },
    renovationTargetDate: { type: Date },

    // ✅ New: structured renovation budget
    budget: [
      {
        category: { type: String, required: true },
        description: { type: String },
        amount: { type: Number, required: true },
      },
    ],

    // ✅ Existing: dynamic actual expenses
    expenses: [
      {
        label: { type: String },
        category: { type: String },
        amount: { type: Number },
        date: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Investment", investmentSchema);
