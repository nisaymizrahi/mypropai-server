const mongoose = require("mongoose");

const compsFiltersSchema = new mongoose.Schema(
  {
    radius: { type: Number },
    saleDateMonths: { type: Number },
    maxComps: { type: Number },
    propertyType: { type: String, trim: true },
    minSquareFootage: { type: Number },
    maxSquareFootage: { type: Number },
    minLotSize: { type: Number },
    maxLotSize: { type: Number },
  },
  { _id: false }
);

const valuationContextSchema = new mongoose.Schema(
  {
    price: { type: Number },
    priceRangeLow: { type: Number },
    priceRangeHigh: { type: Number },
  },
  { _id: false }
);

const aiReportSchema = new mongoose.Schema(
  {
    headline: { type: String, trim: true },
    executiveSummary: { type: String, trim: true },
    pricingRecommendation: { type: String, trim: true },
    offerStrategy: { type: String, trim: true },
    confidence: { type: String, trim: true },
    riskFlags: [{ type: String, trim: true }],
    nextSteps: [{ type: String, trim: true }],
  },
  { _id: false }
);

const compsSummarySchema = new mongoose.Schema(
  {
    estimatedValue: { type: Number },
    estimatedValueLow: { type: Number },
    estimatedValueHigh: { type: Number },
    averageSoldPrice: { type: Number },
    medianSoldPrice: { type: Number },
    lowSoldPrice: { type: Number },
    highSoldPrice: { type: Number },
    averagePricePerSqft: { type: Number },
    medianPricePerSqft: { type: Number },
    lowPricePerSqft: { type: Number },
    highPricePerSqft: { type: Number },
    averageDaysOnMarket: { type: Number },
    medianDaysOnMarket: { type: Number },
    lowDaysOnMarket: { type: Number },
    highDaysOnMarket: { type: Number },
    saleCompCount: { type: Number },
    askingPriceDelta: { type: Number },
    recommendedOfferLow: { type: Number },
    recommendedOfferHigh: { type: Number },
  },
  { _id: false }
);

const comparableSchema = new mongoose.Schema(
  {
    id: { type: String, trim: true },
    address: { type: String, trim: true },
    propertyType: { type: String, trim: true },
    salePrice: { type: Number },
    saleDate: { type: Date },
    pricePerSqft: { type: Number },
    distance: { type: Number },
    bedrooms: { type: Number },
    bathrooms: { type: Number },
    squareFootage: { type: Number },
    lotSize: { type: Number },
    unitCount: { type: Number },
    yearBuilt: { type: Number },
    latitude: { type: Number },
    longitude: { type: Number },
    status: { type: String, trim: true },
    listingType: { type: String, trim: true },
    removedDate: { type: Date },
    daysOnMarket: { type: Number },
  },
  { _id: false }
);

const propertyReportSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    kind: {
      type: String,
      enum: ["comps", "full_property"],
      required: true,
      default: "comps",
      index: true,
    },
    contextType: {
      type: String,
      enum: ["lead", "standalone", "project"],
      required: true,
      index: true,
    },
    lead: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", default: null, index: true },
    investment: { type: mongoose.Schema.Types.ObjectId, ref: "Investment", default: null, index: true },
    title: { type: String, trim: true },
    address: { type: String, trim: true, required: true, index: true },
    generatedAt: { type: Date, default: Date.now, index: true },
    subjectSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    filters: { type: compsFiltersSchema, default: null },
    valuationContext: { type: valuationContextSchema, default: null },
    summary: { type: compsSummarySchema, default: null },
    ai: { type: aiReportSchema, default: null },
    comps: { type: [comparableSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PropertyReport", propertyReportSchema);
