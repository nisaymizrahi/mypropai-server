const User = require("../models/User");
const { parseEmailPreferencesToken } = require("../utils/emailPreferences");
const { normalizeEmail } = require("../utils/platformAccess");
const { applyMarketingConsent, buildConsentSummary } = require("../utils/userProfile");

const parseBoolean = (value) =>
  value === true || value === "true" || value === 1 || value === "1" || value === "on";

const getTokenFromRequest = (req) =>
  String(req.query?.token || req.body?.token || "").trim();

const serializePreferences = (user) => {
  const consent = buildConsentSummary(user);

  return {
    email: user.email,
    marketingOptIn: Boolean(consent.marketingOptIn),
    marketingConsentAcceptedAt: consent.marketingConsentAcceptedAt || null,
    marketingConsentRevokedAt: consent.marketingConsentRevokedAt || null,
    marketingConsentVersion: consent.marketingConsentVersion || null,
  };
};

const loadUserFromToken = async (token) => {
  const parsedToken = parseEmailPreferencesToken(token, "marketing");

  let user = parsedToken.userId ? await User.findById(parsedToken.userId) : null;

  if (!user) {
    user = await User.findOne({ email: normalizeEmail(parsedToken.email) });
  }

  if (!user) {
    const error = new Error("No Fliprop user matches this email preferences link.");
    error.statusCode = 404;
    throw error;
  }

  if (normalizeEmail(user.email) !== normalizeEmail(parsedToken.email)) {
    const error = new Error("This email preferences link is no longer valid.");
    error.statusCode = 400;
    throw error;
  }

  return user;
};

exports.getPreferences = async (req, res) => {
  try {
    const token = getTokenFromRequest(req);
    const user = await loadUserFromToken(token);

    return res.json({
      preferences: serializePreferences(user),
    });
  } catch (error) {
    const statusCode = error.statusCode || 400;
    return res.status(statusCode).json({
      message: error.message || "This email preferences link is invalid or expired.",
    });
  }
};

exports.updatePreferences = async (req, res) => {
  try {
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, "marketingConsent")) {
      return res.status(400).json({
        message: "Choose whether you want to receive promotional Fliprop emails.",
      });
    }

    const token = getTokenFromRequest(req);
    const user = await loadUserFromToken(token);
    const marketingConsent = parseBoolean(req.body?.marketingConsent);

    applyMarketingConsent(user, marketingConsent, new Date());
    await user.save();

    return res.json({
      message: marketingConsent
        ? "You're subscribed to Fliprop marketing emails."
        : "You've been unsubscribed from Fliprop marketing emails.",
      preferences: serializePreferences(user),
    });
  } catch (error) {
    const statusCode = error.statusCode || 400;
    return res.status(statusCode).json({
      message: error.message || "We couldn't update your email preferences.",
    });
  }
};

exports.unsubscribeMarketing = async (req, res) => {
  try {
    const token = getTokenFromRequest(req);
    const user = await loadUserFromToken(token);

    if (user.marketingConsent) {
      applyMarketingConsent(user, false, new Date());
      await user.save();
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(200).send("You have been unsubscribed from Fliprop marketing emails.");
  } catch (error) {
    const statusCode = error.statusCode || 400;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res
      .status(statusCode)
      .send(error.message || "This unsubscribe link is invalid or expired.");
  }
};
