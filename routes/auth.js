const express = require("express");
const passport = require("passport");
const router = express.Router();
const authController = require('../controllers/authController');
const requireAuth = require('../middleware/requireAuth');
const { createAuthSessionToken } = require('../utils/authSessionService');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// --- Email & Password ---
router.post("/signup", authController.signup);
router.post("/login", authController.login);
router.post("/logout", requireAuth, authController.logout);
router.post("/forgot-password", authController.requestPasswordReset);
router.get("/reset-password/validate", authController.validatePasswordResetToken);
router.post("/reset-password", authController.resetPasswordWithToken);

// --- Google OAuth ---
router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
    state: true,
    prompt: "select_account",
  })
);

router.get(
  "/google/callback",
  passport.authenticate("google", {
    session: false,
    failureRedirect: `${FRONTEND_URL}/login?error=oauth`,
  }),
  async (req, res) => {
    try {
      if (!req.user) {
        return res.redirect(`${FRONTEND_URL}/login?error=nouser`);
      }

      if (req.user.accountStatus === 'suspended') {
        return res.redirect(`${FRONTEND_URL}/login?error=suspended`);
      }

      req.user.lastLoginAt = new Date();
      await req.user.save();

      const { token } = await createAuthSessionToken({
        user: req.user,
        req,
        authMethod: "google",
      });
      const encodedToken = encodeURIComponent(token);
      const redirectUrl = `${FRONTEND_URL}/login-continue#token=${encodedToken}`;
      res.redirect(redirectUrl);
    } catch (err) {
      console.error("Google login callback error:", err);
      res.redirect(`${FRONTEND_URL}/login?error=token`);
    }
  }
);

// --- Check Session & Profile Updates ---
router.get("/me", requireAuth, authController.getMe);
router.patch("/me/update", requireAuth, authController.updateMe);

// ✅ NEW: Route to change the user's password
router.post("/change-password", requireAuth, authController.changePassword);


module.exports = router;
