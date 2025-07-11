const express = require("express");
const router = express.Router();
const Investment = require("../models/Investment");
const requireAuth = require("../middleware/requireAuth");

// GET all investments for the logged-in user
router.get("/", requireAuth, async (req, res) => {
  try {
    const investments = await Investment.find({ user: req.user.id }).sort({ createdAt: -1 });
    res.json(investments);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// GET single investment by ID
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const investment = await Investment.findOne({ _id: req.params.id, user: req.user.id });
    if (!investment) return res.status(404).json({ message: "Not found" });
    res.json(investment);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// CREATE new investment
router.post("/", requireAuth, async (req, res) => {
  try {
    const data = req.body;
    const investment = await Investment.create({ ...data, user: req.user.id });
    res.status(201).json(investment);
  } catch (err) {
    console.error("Create error:", err);
    res.status(500).json({ error: "Failed to create investment" });
  }
});

// PATCH (Update) a full investment
router.patch("/:id", requireAuth, async (req, res) => {
  try {
    const investment = await Investment.findOneAndUpdate(
      { _id: req.params.id, user: req.user.id },
      { $set: req.body },
      { new: true }
    );
    if (!investment) return res.status(404).json({ message: "Investment not found" });
    res.json(investment);
  } catch (err) {
    console.error("Update error:", err);
    res.status(500).json({ error: "Failed to update investment" });
  }
});

// POST a new budget line
router.post("/:id/budget", requireAuth, async (req, res) => {
    try {
        const investment = await Investment.findOne({ _id: req.params.id, user: req.user.id });
        if (!investment) return res.status(404).json({ message: "Investment not found" });
        investment.budget.push(req.body);
        await investment.save();
        res.status(201).json(investment);
    } catch (err) {
        res.status(500).json({ error: "Failed to add budget line" });
    }
});

// PATCH a specific budget line by index
router.patch("/:id/budget/:index", requireAuth, async (req, res) => {
  try {
    const investment = await Investment.findOne({ _id: req.params.id, user: req.user.id });
    if (!investment) return res.status(404).json({ message: "Investment not found" });
    const index = parseInt(req.params.index);
    if (!investment.budget || index < 0 || index >= investment.budget.length) {
      return res.status(400).json({ message: "Invalid budget line index" });
    }
    Object.keys(req.body).forEach(key => {
        investment.budget[index][key] = req.body[key];
    });
    await investment.save();
    res.json(investment);
  } catch (err) {
    res.status(500).json({ error: "Failed to update budget line" });
  }
});

// DELETE a specific budget line by index
router.delete("/:id/budget/:index", requireAuth, async (req, res) => {
  try {
    const investment = await Investment.findOne({ _id: req.params.id, user: req.user.id });
    if (!investment) return res.status(404).json({ message: "Investment not found" });
    const index = parseInt(req.params.index);
    if (!investment.budget || index < 0 || index >= investment.budget.length) {
      return res.status(400).json({ message: "Invalid budget line index" });
    }
    investment.budget.splice(index, 1);
    await investment.save();
    res.json(investment);
  } catch (err) {
    res.status(500).json({ error: "Failed to delete budget line" });
  }
});

// POST a new expense
router.post("/:id/expenses", requireAuth, async (req, res) => {
    try {
        const investment = await Investment.findOne({ _id: req.params.id, user: req.user.id });
        if (!investment) return res.status(404).json({ message: "Investment not found" });
        investment.expenses.push(req.body);
        await investment.save();
        res.status(201).json(investment);
    } catch (err) {
        res.status(500).json({ error: "Failed to add expense" });
    }
});

// PATCH a specific expense by index
router.patch("/:id/expenses/:index", requireAuth, async (req, res) => {
  try {
    const investment = await Investment.findOne({ _id: req.params.id, user: req.user.id });
    if (!investment) return res.status(404).json({ message: "Investment not found" });
    const index = parseInt(req.params.index);
    if (!investment.expenses || index < 0 || index >= investment.expenses.length) {
      return res.status(400).json({ message: "Invalid expense index" });
    }
    Object.keys(req.body).forEach(key => {
        investment.expenses[index][key] = req.body[key];
    });
    await investment.save();
    res.json(investment);
  } catch (err) {
    res.status(500).json({ error: "Failed to update expense" });
  }
});

// DELETE a specific expense by index
router.delete("/:id/expenses/:index", requireAuth, async (req, res) => {
  try {
    const investment = await Investment.findOne({ _id: req.params.id, user: req.user.id });
    if (!investment) return res.status(404).json({ message: "Investment not found" });
    const index = parseInt(req.params.index);
    if (!investment.expenses || index < 0 || index >= investment.expenses.length) {
      return res.status(400).json({ message: "Invalid expense index" });
    }
    investment.expenses.splice(index, 1);
    await investment.save();
    res.json(investment);
  } catch (err) {
    res.status(500).json({ error: "Failed to delete expense" });
  }
});

// DELETE an entire investment
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
