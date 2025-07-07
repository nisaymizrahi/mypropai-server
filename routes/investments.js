const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
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

// PATCH update investment
router.patch("/:id", requireAuth, async (req, res) => {
  try {
    const investment = await Investment.findOne({ _id: req.params.id, user: req.userId });

    if (!investment) return res.status(404).json({ message: "Investment not found" });

    // ✅ Allowed fields to update
    const fields = [
      "address", "type", "purchasePrice", "lotSize", "sqft",
      "bedrooms", "bathrooms", "yearBuilt", "arv", "rentEstimate",
      "initialBudget", "expenses"
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

module.exports = router;
