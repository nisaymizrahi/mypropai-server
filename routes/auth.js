const express = require("express");
const passport = require("passport");
const router = express.Router();
const authController = require('../controllers/authController');
const requireAuth = require('../middleware/requireAuth');

// --- Email & Password ---
router.post("/signup", authController.signup);
router.post("/login", authController.login);
// This route now has logic and is protected
router.post("/logout", requireAuth, authController.logout);

// --- Google OAuth ---
router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));

router.get(
  "/google/callback",
  passport.authenticate("google", { session: false, failureRedirect: "/login" }),
  (req, res) => {
    try {
      if (!req.user) {
        return res.redirect("https://mypropai.onrender.com/login?error=nouser");
      }
      const token = jwt.sign({ userId: req.user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
      const encodedToken = encodeURIComponent(token);
      const redirectUrl = `https://mypropai.onrender.com/login-continue?token=${encodedToken}`;
      res.redirect(redirectUrl);
    } catch (err) {
      console.error("Google login callback error:", err);
      res.redirect("https://mypropai.onrender.com/login?error=token");
    }
  }
);

// --- Check Session ---
// This route is now cleaner as the logic is in the controller
router.get("/me", requireAuth, authController.getMe);

module.exports = router;
