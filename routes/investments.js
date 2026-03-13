const express = require("express");
const router = express.Router();
const Investment = require("../models/Investment");
const ProjectTask = require("../models/ProjectTask");
const requireAuth = require("../middleware/requireAuth");
const { generateAIReport } = require("../controllers/aiReportController");
const { generateBudgetLines } = require("../controllers/aiBudgetController");
const { normalizePropertyStrategy } = require("../utils/propertyStrategy");

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

const buildInvestmentPayload = (input = {}) => {
  const payload = { ...input };
  const strategy = normalizePropertyStrategy(input.strategy || input.type);

  payload.strategy = strategy;
  payload.type = strategy;

  return payload;
};

// GET all investments
router.get("/", requireAuth, async (req, res) => {
  try {
    const investments = await Investment.find({ user: req.user.id }).sort({ createdAt: -1 });

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
    const investment = await Investment.findOne({ _id: req.params.id, user: req.user.id });
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
    const data = buildInvestmentPayload(req.body);
    const investment = await Investment.create({ ...data, user: req.user.id });
    res.status(201).json(serializeInvestment(investment, 0));
  } catch (err) {
    res.status(500).json({ error: "Failed to create investment" });
  }
});

// PATCH investment
router.patch("/:id", requireAuth, async (req, res) => {
  try {
    const updates = buildInvestmentPayload(req.body);
    const investment = await Investment.findOneAndUpdate(
      { _id: req.params.id, user: req.user.id },
      { $set: updates },
      { new: true }
    );
    if (!investment) return res.status(404).json({ message: "Not found" });
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
    res.json({ message: "Investment deleted" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete investment" });
  }
});

// ✅ NEW: Generate AI Report
router.post("/generate-report/:id", requireAuth, generateAIReport);

router.post("/generate-budget-lines", requireAuth, generateBudgetLines);

module.exports = router;
