const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const Investment = require("../models/Investment");
const User = require("../models/User");

// Middleware to verify JWT
const requireAuth = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1]; // Format: Bearer <token>
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(403).json({ error: "Invalid token" });
  }
};

// GET all investments for user
router.get("/", requireAuth, async (req, res) => {
  try {
    const investments = await Investment.find({ user: req.userId }).sort({ createdAt: -1 });
    res.json(investments);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// POST a new investment
router.post("/", requireAuth, async (req, res) => {
  try {
    const data = req.body;
    const investment = await Investment.create({ ...data, user: req.userId });
    res.status(201).json(investment);
  } catch (err) {
    console.error("Create investment error:", err);
    res.status(500).json({ error: "Failed to create investment" });
  }
});

module.exports = router;
