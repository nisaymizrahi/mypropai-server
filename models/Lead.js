const mongoose = require('mongoose');

const LeadSchema = new mongoose.Schema({
  // The user this lead belongs to.
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  property: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property',
    default: null,
    index: true,
  },
  // The full address of the potential property.
  address: {
    type: String,
    required: [true, 'Please provide the property address.'],
    trim: true,
  },
  addressLine1: { type: String, trim: true },
  addressLine2: { type: String, trim: true },
  city: { type: String, trim: true },
  state: { type: String, trim: true },
  zipCode: { type: String, trim: true },
  county: { type: String, trim: true },
  latitude: { type: Number },
  longitude: { type: Number },
  propertyType: { type: String, trim: true },
  bedrooms: { type: Number },
  bathrooms: { type: Number },
  squareFootage: { type: Number },
  lotSize: { type: Number },
  yearBuilt: { type: Number },
  sellerAskingPrice: { type: Number },
  sellerName: { type: String, trim: true },
  sellerPhone: { type: String, trim: true },
  sellerEmail: { type: String, trim: true },
  leadSource: { type: String, trim: true },
  occupancyStatus: { type: String, trim: true },
  motivation: { type: String, trim: true },
  targetOffer: { type: Number },
  arv: { type: Number },
  rehabEstimate: { type: Number },
  nextAction: { type: String, trim: true },
  followUpDate: { type: Date },
  listingStatus: { type: String, trim: true },
  listedDate: { type: Date },
  daysOnMarket: { type: Number },
  lastSalePrice: { type: Number },
  lastSaleDate: { type: Date },
  // The stage of the deal in your pipeline.
  status: {
    type: String,
    enum: [
        'Potential', 
        'Analyzing', 
        'Offer Made', 
        'Under Contract', 
        'Closed - Won', 
        'Closed - Lost'
    ],
    default: 'Potential',
  },
  // Simple field for any user notes on the lead.
  notes: {
    type: String,
    trim: true,
  },
  compsAnalysis: {
    generatedAt: { type: Date },
    estimatedValue: { type: Number },
    estimatedValueLow: { type: Number },
    estimatedValueHigh: { type: Number },
    averageSoldPrice: { type: Number },
    medianSoldPrice: { type: Number },
    averagePricePerSqft: { type: Number },
    medianPricePerSqft: { type: Number },
    saleCompCount: { type: Number },
    askingPriceDelta: { type: Number },
    recommendedOfferLow: { type: Number },
    recommendedOfferHigh: { type: Number },
    report: {
      headline: { type: String, trim: true },
      executiveSummary: { type: String, trim: true },
      pricingRecommendation: { type: String, trim: true },
      offerStrategy: { type: String, trim: true },
      confidence: { type: String, trim: true },
      riskFlags: [{ type: String, trim: true }],
      nextSteps: [{ type: String, trim: true }],
    },
    recentComps: [{
      address: { type: String, trim: true },
      propertyType: { type: String, trim: true },
      salePrice: { type: Number },
      saleDate: { type: Date },
      pricePerSqft: { type: Number },
      distance: { type: Number },
      bedrooms: { type: Number },
      bathrooms: { type: Number },
      squareFootage: { type: Number },
      yearBuilt: { type: Number },
    }],
  },

}, { timestamps: true });

module.exports = mongoose.model('Lead', LeadSchema);
