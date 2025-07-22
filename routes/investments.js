const express = require("express");
const router = express.Router();
const Investment = require("../models/Investment");
const ProjectTask = require("../models/ProjectTask");
const requireAuth = require("../middleware/requireAuth");

// Helper to calculate task completion percentage
const calculateProgress = async (investmentId) => {
  const tasks = await ProjectTask.find({ investment: investmentId });
  if (tasks.length === 0) return 0;
  const completed = tasks.filter(t => t.status === 'Complete').length;
  return Math.round((completed / tasks.length) * 100);
};

// GET all investments with analytics
router.get("/", requireAuth, async (req, res) => {
  try {
    const investments = await Investment.find({ user: req.user.id }).sort({ createdAt: -1 });

    const enriched = await Promise.all(investments.map(async (inv) => {
      const progress = await calculateProgress(inv._id);
      return {
        ...inv.toObject(),
        progress
      };
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
    investment.progress = progress;
    await investment.save();

    res.json(investment);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// CREATE investment
router.post("/", requireAuth, async (req, res) => {
  try {
    const data = req.body;
    const investment = await Investment.create({ ...data, user: req.user.id });
    res.status(201).json(investment);
  } catch (err) {
    res.status(500).json({ error: "Failed to create investment" });
  }
});

// UPDATE investment
router.patch("/:id", requireAuth, async (req, res) => {
  try {
    const investment = await Investment.findOneAndUpdate(
      { _id: req.params.id, user: req.user.id },
      { $set: req.body },
      { new: true }
    );
    if (!investment) return res.status(404).json({ message: "Not found" });
    res.json(investment);
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

module.exports = router;
