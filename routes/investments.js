const express = require("express");
const router = express.Router();
const Investment = require("../models/Investment");
const requireAuth = require("../middleware/requireAuth");

// GET all investments for the logged-in user
router.get("/", requireAuth, async (req, res) => {
  try {
    const investments = await Investment.find({ user: req.userId }).sort({ createdAt: -1 });
    res.json(investments);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// GET single investment by ID
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const investment = await Investment.findOne({ _id: req.params.id, user: req.userId });
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
    const investment = await Investment.create({ ...data, user: req.userId });
    res.status(201).json(investment);
  } catch (err) {
    console.error("Create error:", err);
    res.status(500).json({ error: "Failed to create investment" });
  }
});

// PATCH full investment update
router.patch("/:id", requireAuth, async (req, res) => {
  try {
    const investment = await Investment.findOne({ _id: req.params.id, user: req.userId });
    if (!investment) return res.status(404).json({ message: "Investment not found" });

    const fields = [
      "address", "type", "purchasePrice", "lotSize", "sqft",
      "bedrooms", "bathrooms", "yearBuilt", "arv", "rentEstimate",
      "initialBudget", "expenses", "budget", "renovationTargetDate"
    ];

    fields.forEach((field) => {
      if (req.body[field] !== undefined) {
        investment[field] = req.body[field];
      }
    });

    const updated = await investment.save();
    res.json(updated);
  } catch (err) {
    console.error("Update error:", err);
    res.status(500).json({ error: "Failed to update investment" });
  }
});

// PATCH specific budget line by index
router.patch("/:id/budget/:index", requireAuth, async (req, res) => {
  try {
    const investment = await Investment.findOne({ _id: req.params.id, user: req.userId });
    if (!investment) return res.status(404).json({ message: "Investment not found" });

    const index = parseInt(req.params.index);
    if (!investment.budget || index < 0 || index >= investment.budget.length) {
      return res.status(400).json({ message: "Invalid budget line index" });
    }

    const line = investment.budget[index];

    if (req.body.category !== undefined) line.category = req.body.category;
    if (req.body.description !== undefined) line.description = req.body.description;
    if (req.body.amount !== undefined) line.amount = req.body.amount;
    if (req.body.status !== undefined) line.status = req.body.status;

    await investment.save();
    res.json(investment);
  } catch (err) {
    console.error("Update budget line error:", err);
    res.status(500).json({ error: "Failed to update budget line" });
  }
});

// ✅ PATCH a specific expense by index
router.patch("/:id/expenses/:index", requireAuth, async (req, res) => {
  try {
    const investment = await Investment.findOne({ _id: req.params.id, user: req.userId });
    if (!investment) return res.status(404).json({ message: "Investment not found" });

    const index = parseInt(req.params.index);
    if (!investment.expenses || index < 0 || index >= investment.expenses.length) {
      return res.status(400).json({ message: "Invalid expense index" });
    }

    const expense = investment.expenses[index];
    if (req.body.category !== undefined) expense.category = req.body.category;
    if (req.body.type !== undefined) expense.type = req.body.type;
    if (req.body.amount !== undefined) expense.amount = req.body.amount;
    if (req.body.date !== undefined) expense.date = req.body.date;

    await investment.save();
    res.json(investment);
  } catch (err) {
    console.error("Update expense error:", err);
    res.status(500).json({ error: "Failed to update expense" });
  }
});

// ✅ DELETE a specific expense by index
router.delete("/:id/expenses/:index", requireAuth, async (req, res) => {
  try {
    const investment = await Investment.findOne({ _id: req.params.id, user: req.userId });
    if (!investment) return res.status(404).json({ message: "Investment not found" });

    const index = parseInt(req.params.index);
    if (!investment.expenses || index < 0 || index >= investment.expenses.length) {
      return res.status(400).json({ message: "Invalid expense index" });
    }

    investment.expenses.splice(index, 1);
    await investment.save();
    res.json(investment);
  } catch (err) {
    console.error("Delete expense error:", err);
    res.status(500).json({ error: "Failed to delete expense" });
  }
});

module.exports = router;
