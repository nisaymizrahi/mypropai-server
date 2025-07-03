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
    arv: { type: Number }, // After Repair Value (for flips)
    rentEstimate: { type: Number }, // for rentals
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
