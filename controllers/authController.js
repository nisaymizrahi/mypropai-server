const User = require('../models/User');
const bcrypt = require('bcryptjs');
const { getEffectiveSubscriptionState } = require('../utils/billingAccess');
const { isPlatformManager } = require('../utils/platformAccess');
const { createAuthSessionToken, revokeAuthSession } = require('../utils/authSessionService');
const sendEmail = require('../utils/sendEmail');
const { generateHashedToken, hashToken } = require('../utils/tokenSecurity');
const {
  AUTH_ABSOLUTE_TIMEOUT_HOURS,
  AUTH_IDLE_TIMEOUT_MINUTES,
} = require('../utils/authSessionPolicy');
const { getPlatformOverrideState } = require('../utils/billingAccess');
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

const buildAuthUser = (user, options = {}) => {
  const impersonation = options.impersonation || { active: false };
  const subscriptionState = getEffectiveSubscriptionState(user);
  const overrideState = getPlatformOverrideState(user);

  return {
    id: user._id,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
    accountStatus: user.accountStatus || 'active',
    stripeAccountId: user.stripeAccountId || null,
    stripeOnboardingComplete: Boolean(user.stripeOnboardingComplete),
    applicationFeeCents: Number.isFinite(user.applicationFeeCents) ? user.applicationFeeCents : 5000,
    stripeCustomerId: user.stripeCustomerId || null,
    stripeSubscriptionId: user.stripeSubscriptionId || null,
    subscriptionPlan: subscriptionState.planKey,
    subscriptionStatus: subscriptionState.status,
    subscriptionCurrentPeriodEnd: subscriptionState.renewsAt,
    subscriptionSource: subscriptionState.source,
    subscriptionOverride: overrideState.planKey,
    subscriptionOverrideExpiresAt: overrideState.expiresAt,
    subscriptionOverrideReason: overrideState.reason,
    isPlatformManager: isPlatformManager(user) && !impersonation.active,
    impersonation,
  };
};

const buildAuthResponse = (user, token, session, options = {}) => ({
  token,
  user: buildAuthUser(user, options),
  session: {
    id: session?._id ? String(session._id) : null,
    expiresAt: session?.expiresAt || null,
    idleTimeoutMinutes: AUTH_IDLE_TIMEOUT_MINUTES,
    absoluteTimeoutHours: AUTH_ABSOLUTE_TIMEOUT_HOURS,
  },
});

const buildPasswordResetUrl = (token) =>
  `${FRONTEND_URL}/reset-password?token=${encodeURIComponent(token)}`;

const issuePasswordResetForUser = async (user) => {
  const { token, tokenHash } = generateHashedToken();
  user.passwordResetTokenHash = tokenHash;
  user.passwordResetExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await user.save();
  return {
    token,
    url: buildPasswordResetUrl(token),
    expiresAt: user.passwordResetExpiresAt,
  };
};

// @desc    Register a new user
exports.signup = async (req, res) => {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
        return res.status(400).json({ message: "All fields are required" });
    }
    if (password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
    }

    try {
        const existing = await User.findOne({ email });
        if (existing) return res.status(409).json({ message: "Email already in use" });
        
        const user = await User.create({ email, password, name });
        user.lastLoginAt = new Date();
        await user.save();

        const { token, session } = await createAuthSessionToken({
          user,
          req,
          authMethod: 'password',
        });
        res.status(201).json(buildAuthResponse(user, token, session));
    } catch (err) {
        console.error("Signup error:", err);
        res.status(500).json({ message: "Internal server error" });
    }
};

// @desc    Log in a user
exports.login = async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: "Email and password required" });
    }

    try {
        const user = await User.findOne({ email }).select('+password');
        if (!user || !user.password) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        if (user.accountStatus === 'suspended') {
            return res.status(403).json({ message: "This account has been suspended." });
        }

        const match = await user.comparePassword(password);
        if (!match) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        user.lastLoginAt = new Date();
        await user.save();

        const { token, session } = await createAuthSessionToken({
          user,
          req,
          authMethod: 'password',
        });
        res.json(buildAuthResponse(user, token, session));
    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ message: "Internal server error" });
    }
};

// @desc    Log out a user and blocklist the token
exports.logout = async (req, res) => {
    try {
        await revokeAuthSession(req.auth?.session?.id);
        res.status(200).json({ message: "Logged out successfully" });
    } catch (err) {
        console.error("Logout error:", err);
        res.status(500).json({ message: "Internal server error" });
    }
};

// @desc    Get the current logged-in user
exports.getMe = async (req, res) => {
    res.json(buildAuthUser(req.user, { impersonation: req.auth?.impersonation }));
};

// @desc    Update the logged-in user's profile
exports.updateMe = async (req, res) => {
    try {
        const { name, email, applicationFeeCents } = req.body;
        const user = await User.findById(req.user.id);

        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }

        user.name = name || user.name;
        user.email = email || user.email;

        if (applicationFeeCents !== undefined) {
            const normalizedFee = Number(applicationFeeCents);

            if (!Number.isFinite(normalizedFee) || normalizedFee < 0 || normalizedFee > 100000) {
                return res.status(400).json({
                    message: "Application fee must be between $0 and $1,000.",
                });
            }

            user.applicationFeeCents = Math.round(normalizedFee);
        }

        const updatedUser = await user.save();

        res.json(buildAuthUser(updatedUser));

    } catch (error) {
        console.error("Update profile error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// ✅ NEW: Function to change the user's password
exports.changePassword = async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: 'Please provide both current and new passwords.' });
    }
    if (newPassword.length < 8) {
        return res.status(400).json({ message: 'New password must be at least 8 characters.' });
    }

    try {
        const user = await User.findById(req.user.id).select('+password');

        const isMatch = await user.comparePassword(currentPassword);
        if (!isMatch) {
            return res.status(401).json({ message: 'Incorrect current password.' });
        }

        user.password = newPassword;
        await user.save();

        res.status(200).json({ message: 'Password changed successfully.' });
        
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ message: 'Internal server error.' });
    }
};

exports.requestPasswordReset = async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();

    if (!email) {
        return res.status(400).json({ message: 'Email is required.' });
    }

    try {
        const user = await User.findOne({ email }).select('+passwordResetTokenHash +passwordResetExpiresAt');

        if (user) {
            const reset = await issuePasswordResetForUser(user);

            if (process.env.SENDGRID_API_KEY && process.env.EMAIL_FROM) {
                await sendEmail({
                    to: user.email,
                    subject: 'Reset your Fliprop password',
                    html: `
                      <p>Hello ${user.name || 'there'},</p>
                      <p>Use the link below to reset your Fliprop password. This link expires in 1 hour.</p>
                      <p><a href="${reset.url}">${reset.url}</a></p>
                      <p>If you did not request this, you can ignore this email.</p>
                    `,
                });
            }
        }

        return res.json({
            message: 'If that email exists in Fliprop, a reset link has been prepared.',
        });
    } catch (error) {
        console.error('Password reset request error:', error);
        return res.status(500).json({ message: 'Internal server error.' });
    }
};

exports.validatePasswordResetToken = async (req, res) => {
    const token = String(req.query?.token || '').trim();
    if (!token) {
        return res.status(400).json({ message: 'Reset token is required.' });
    }

    try {
        const user = await User.findOne({
            passwordResetTokenHash: hashToken(token),
            passwordResetExpiresAt: { $gt: new Date() },
        }).select('+passwordResetTokenHash +passwordResetExpiresAt');

        if (!user) {
            return res.status(400).json({ message: 'This password reset link is invalid or expired.' });
        }

        return res.json({ valid: true });
    } catch (error) {
        console.error('Password reset token validation error:', error);
        return res.status(500).json({ message: 'Internal server error.' });
    }
};

exports.resetPasswordWithToken = async (req, res) => {
    const token = String(req.body?.token || '').trim();
    const newPassword = String(req.body?.newPassword || '');

    if (!token || !newPassword) {
        return res.status(400).json({ message: 'Reset token and new password are required.' });
    }

    if (newPassword.length < 8) {
        return res.status(400).json({ message: 'New password must be at least 8 characters.' });
    }

    try {
        const user = await User.findOne({
            passwordResetTokenHash: hashToken(token),
            passwordResetExpiresAt: { $gt: new Date() },
        }).select('+password +passwordResetTokenHash +passwordResetExpiresAt');

        if (!user) {
            return res.status(400).json({ message: 'This password reset link is invalid or expired.' });
        }

        user.password = newPassword;
        user.passwordResetTokenHash = null;
        user.passwordResetExpiresAt = null;
        await user.save();

        return res.status(200).json({ message: 'Password reset successfully.' });
    } catch (error) {
        console.error('Password reset error:', error);
        return res.status(500).json({ message: 'Internal server error.' });
    }
};

module.exports.issuePasswordResetForUser = issuePasswordResetForUser;
module.exports.buildPasswordResetUrl = buildPasswordResetUrl;
