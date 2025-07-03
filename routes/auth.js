const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const passport = require("passport");
const User = require("../models/User");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";

// Create JWT and set as http-only cookie
function issueToken(res, user) {
  const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: "7d" });
  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  return token;
}

// --------- Signup ---------
router.post("/signup", async (req, res) => {
  const { email, password, name } = req.body;

  try {
    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ error: "Email already in use" });

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ email, password: hashed, name });

    issueToken(res, user);
    res.status(201).json({ user: { id: user._id, email: user.email, name: user.name } });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --------- Login ---------
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user || !user.password) return res.status(401).json({ error: "Invalid credentials" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: "Invalid credentials" });

    issueToken(res, user);
    res.json({ user: { id: user._id, email: user.email, name: user.name } });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --------- Logout ---------
router.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ message: "Logged out" });
});

// --------- Google OAuth ---------
router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));

router.get(
  "/google/callback",
  passport.authenticate("google", { session: false, failureRedirect: "/login" }),
  (req, res) => {
    issueToken(res, req.user);
    res.redirect("https://mypropai.onrender.com/dashboard"); // ✅ UPDATED for live
  }
);

// --------- Get current user from cookie (for ProtectedRoute) ---------
router.get("/me", async (req, res) => {
  try {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: "No token" });

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).select("-password");

    if (!user) return res.status(401).json({ error: "User not found" });

    res.json(user);
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
});

module.exports = router;
