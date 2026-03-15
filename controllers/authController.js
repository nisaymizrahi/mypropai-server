const User = require('../models/User');
const bcrypt = require('bcryptjs');
const { getEffectiveSubscriptionState } = require('../utils/billingAccess');
const { isPlatformManager } = require('../utils/platformAccess');
const { createAuthSessionToken, revokeAuthSession } = require('../utils/authSessionService');
const {
  AUTH_ABSOLUTE_TIMEOUT_HOURS,
  AUTH_IDLE_TIMEOUT_MINUTES,
} = require('../utils/authSessionPolicy');

const buildAuthUser = (user, options = {}) => {
  const impersonation = options.impersonation || { active: false };
  const subscriptionState = getEffectiveSubscriptionState(user);

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
    subscriptionOverride: user.platformSubscriptionOverride || 'none',
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
