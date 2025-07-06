const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const Investment = require("../models/Investment");

// ✅ Improved middleware: Authorization header first, fallback to cookie
const requireAuth = (req, res, next) => {
  let token = null;

  // 1. Prefer Authorization header
  if (req.headers.authorization?.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }

  // 2. Fallback to cookie if header missing
  if (!token && req.cookies?.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({ error: "Unauthorized: No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    console.error("Auth middleware failed:", err.message);
    return res.status(403).json({ error: "Invalid or expired token" });
  }
};

// ✅ GET all investments for the logged-in user
router.get("/", requireAuth, async (req, res) => {
  try {
    const investments = await Investment.find({ user: req.userId }).sort({ createdAt: -1 });
    res.json(investments);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ POST a new investment
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

// ✅ GET single investment by ID
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const investment = await Investment.findOne({
      _id: req.params.id,
      user: req.userId, // Make sure the user owns it
    });

    if (!investment) {
      return res.status(404).json({ error: "Investment not found" });
    }

    res.json(investment);
  } catch (err) {
    console.error("Fetch single investment error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
