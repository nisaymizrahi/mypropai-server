const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const Investment = require("../models/Investment");

// ✅ Updated middleware: Checks cookie first, then Authorization header
const requireAuth = (req, res, next) => {
  let token = null;

  // 1. Try cookie
  if (req.cookies?.token) {
    token = req.cookies.token;
  }

  // 2. Fallback: Try Authorization header
  if (!token && req.headers.authorization?.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return res.status(401).json({ error: "Unauthorized: No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
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

module.exports = router;
