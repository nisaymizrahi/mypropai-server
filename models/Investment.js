const mongoose = require("mongoose");
const {
  PROPERTY_STRATEGIES,
  normalizePropertyStrategy,
} = require("../utils/propertyStrategy");

const FundingSourceSchema = new mongoose.Schema(
  {
    sourceId: { type: String, trim: true },
    name: { type: String, trim: true, default: "" },
    type: { type: String, trim: true, default: "" },
    amount: { type: Number, default: 0 },
    currentBalance: { type: Number, default: 0 },
    interestRate: { type: Number, default: 0 },
    termMonths: { type: Number, default: 0 },
    points: { type: Number, default: 0 },
    paymentType: { type: String, trim: true, default: "interest_only" },
    paymentFrequency: { type: String, trim: true, default: "monthly" },
    paymentAmount: { type: Number, default: 0 },
    paymentDay: { type: Number, default: 1 },
    paymentStartDate: { type: Date, default: null },
    originationDate: { type: Date, default: null },
    maturityDate: { type: Date, default: null },
    drawLimit: { type: Number, default: 0 },
    drawnAmount: { type: Number, default: 0 },
    notes: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const DrawRequestSchema = new mongoose.Schema(
  {
    drawId: { type: String, trim: true },
    label: { type: String, trim: true, default: "" },
    sourceId: { type: String, trim: true, default: "" },
    status: { type: String, trim: true, default: "planned" },
    requestDate: { type: Date, default: null },
    expectedFundingDate: { type: Date, default: null },
    fundedDate: { type: Date, default: null },
    amountRequested: { type: Number, default: 0 },
    amountFunded: { type: Number, default: 0 },
    notes: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const PaymentRecordSchema = new mongoose.Schema(
  {
    paymentId: { type: String, trim: true },
    sourceId: { type: String, trim: true, default: "" },
    dueDate: { type: Date, default: null },
    scheduledAmount: { type: Number, default: 0 },
    paidAmount: { type: Number, default: 0 },
    status: {
      type: String,
      trim: true,
      default: "scheduled",
      enum: ["scheduled", "paid", "partial", "overdue", "deferred"],
    },
    paidDate: { type: Date, default: null },
    paymentMethod: { type: String, trim: true, default: "other" },
    notes: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const investmentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Property",
      default: null,
      index: true,
    },
    sourceLead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      default: null,
      index: true,
    },
    sourceLeadSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    // Core Info
    address: { type: String, required: true },
    // `type` is kept as a legacy alias while the product moves to `strategy`.
    type: { type: String, enum: PROPERTY_STRATEGIES, default: "flip" },
    strategy: { type: String, enum: PROPERTY_STRATEGIES, default: "flip" },
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
    loanType: { type: String, default: '', trim: true },
    lenderName: { type: String, default: '', trim: true },
    loanNotes: { type: String, default: '', trim: true },
    fundingSources: { type: [FundingSourceSchema], default: [] },
    drawRequests: { type: [DrawRequestSchema], default: [] },
    paymentRecords: { type: [PaymentRecordSchema], default: [] },

    holdingMonths: { type: Number, default: 6 },
    taxes: { type: Number, default: 0 },
    insurance: { type: Number, default: 0 },
    utilities: { type: Number, default: 0 },
    otherMonthly: { type: Number, default: 0 },
    operatingCashReserve: { type: Number, default: 0 },
    contingencyReserve: { type: Number, default: 0 },
    minimumCashBuffer: { type: Number, default: 0 },

    sellClosingCost: { type: Number, default: 6 },
    sellClosingIsPercent: { type: Boolean, default: true },

    // Optional AI-generated analysis
    aiDealSummary: { type: String },

    managedProperty: { type: mongoose.Schema.Types.ObjectId, ref: 'ManagedProperty', default: null }
  },
  { timestamps: true }
);

investmentSchema.pre("validate", function normalizeLegacyStrategy(next) {
  const normalizedStrategy = normalizePropertyStrategy(this.strategy || this.type);
  this.strategy = normalizedStrategy;
  this.type = normalizedStrategy;
  next();
});

module.exports = mongoose.model("Investment", investmentSchema);
