const express = require("express");
const router = express.Router();
const Investment = require("../models/Investment");
const Lead = require("../models/Lead");
const BudgetItem = require("../models/BudgetItem");
const Expense = require("../models/Expense");
const ProjectTask = require("../models/ProjectTask");
const requireAuth = require("../middleware/requireAuth");
const { generateAIReport } = require("../controllers/aiReportController");
const { generateBudgetLines } = require("../controllers/aiBudgetController");
const { normalizePropertyStrategy } = require("../utils/propertyStrategy");
const { upsertCanonicalProperty } = require("../utils/propertyRecordService");

const sharedInvestmentFields = new Set([
  "address",
  "propertyType",
  "lotSize",
  "sqft",
  "bedrooms",
  "bathrooms",
  "yearBuilt",
  "unitCount",
]);

const investmentFields = [
  "address",
  "strategy",
  "type",
  "status",
  "coverImage",
  "images",
  "purchasePrice",
  "arv",
  "progress",
  "propertyType",
  "lotSize",
  "sqft",
  "bedrooms",
  "bathrooms",
  "yearBuilt",
  "unitCount",
  "inspectionNotes",
  "buyClosingCost",
  "buyClosingIsPercent",
  "loanAmount",
  "interestRate",
  "loanTerm",
  "loanPoints",
  "holdingMonths",
  "taxes",
  "insurance",
  "utilities",
  "otherMonthly",
  "sellClosingCost",
  "sellClosingIsPercent",
  "aiDealSummary",
];

// Helper to calculate task completion percentage
const calculateProgress = async (investmentId) => {
  const tasks = await ProjectTask.find({ investment: investmentId });
  if (tasks.length === 0) return 0;
  const completed = tasks.filter(t => t.status === 'Complete').length;
  return Math.round((completed / tasks.length) * 100);
};

const serializeInvestment = (investment, progress) => {
  const serialized = investment.toObject();
  const strategy = normalizePropertyStrategy(serialized.strategy || serialized.type);

  return {
    ...serialized,
    type: strategy,
    strategy,
    progress,
  };
};

const buildInvestmentPayload = (
  input = {},
  { includeSharedFields = true, defaultStrategy = false } = {}
) => {
  const payload = {};

  investmentFields.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(input, field)) {
      return;
    }

    if (!includeSharedFields && sharedInvestmentFields.has(field)) {
      return;
    }

    payload[field] = input[field];
  });

  const hasStrategyInput =
    Object.prototype.hasOwnProperty.call(input, "strategy") ||
    Object.prototype.hasOwnProperty.call(input, "type");

  if (hasStrategyInput || defaultStrategy) {
    const strategy = normalizePropertyStrategy(input.strategy || input.type);
    payload.strategy = strategy;
    payload.type = strategy;
  }

  return payload;
};

// GET all investments
router.get("/", requireAuth, async (req, res) => {
  try {
    const investments = await Investment.find({ user: req.user.id })
      .populate("property", "address")
      .populate("sourceLead", "address status projectManagement")
      .sort({ createdAt: -1 });

    const enriched = await Promise.all(investments.map(async (inv) => {
      const progress = await calculateProgress(inv._id);
      return serializeInvestment(inv, progress);
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// GET single investment
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const investment = await Investment.findOne({ _id: req.params.id, user: req.user.id })
      .populate("property")
      .populate("sourceLead", "address status projectManagement");
    if (!investment) return res.status(404).json({ message: "Not found" });

    const progress = await calculateProgress(investment._id);
    res.json(serializeInvestment(investment, progress));
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// CREATE investment
router.post("/", requireAuth, async (req, res) => {
  try {
    const data = buildInvestmentPayload(req.body, {
      includeSharedFields: true,
      defaultStrategy: true,
    });
    const property = await upsertCanonicalProperty({
      userId: req.user.id,
      source: data,
    });
    const investment = await Investment.create({
      ...data,
      user: req.user.id,
      property: property?._id || null,
    });
    res.status(201).json(serializeInvestment(investment, 0));
  } catch (err) {
    res.status(500).json({ error: "Failed to create investment" });
  }
});

// PATCH investment
router.patch("/:id", requireAuth, async (req, res) => {
  try {
    const updates = buildInvestmentPayload(req.body, { includeSharedFields: false });
    const investment = await Investment.findOne({ _id: req.params.id, user: req.user.id });
    if (!investment) return res.status(404).json({ message: "Not found" });

    Object.assign(investment, updates);
    const property = await upsertCanonicalProperty({
      userId: req.user.id,
      existingPropertyId: investment.property,
      source: investment,
    });
    if (property) {
      investment.property = property._id;
    }
    await investment.save();

    const progress = await calculateProgress(investment._id);
    res.json(serializeInvestment(investment, progress));
  } catch (err) {
    res.status(500).json({ error: "Failed to update investment" });
  }
});

// DELETE investment
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const deleted = await Investment.findOneAndDelete({ _id: req.params.id, user: req.user.id });
    if (!deleted) return res.status(404).json({ message: "Investment not found" });
    await Promise.all([
      deleted.sourceLead
        ? Lead.updateOne(
            { _id: deleted.sourceLead, projectManagement: deleted._id },
            { $set: { projectManagement: null } }
          )
        : Promise.resolve(),
      BudgetItem.deleteMany({ investment: deleted._id }),
      Expense.deleteMany({ investment: deleted._id }),
      ProjectTask.deleteMany({ investment: deleted._id }),
    ]);
    res.json({ message: "Investment deleted" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete investment" });
  }
});

// ✅ NEW: Generate AI Report
router.post("/generate-report/:id", requireAuth, generateAIReport);

router.post("/generate-budget-lines", requireAuth, generateBudgetLines);

module.exports = router;
