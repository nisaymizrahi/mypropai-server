const Application = require('../models/Application');
const Bid = require('../models/Bid');
const Inspection = require('../models/Inspection');
const Investment = require('../models/Investment');
const Lead = require('../models/Lead');
const MaintenanceTicket = require('../models/MaintenanceTicket');
const ManagedProperty = require('../models/ManagedProperty');
const Notification = require('../models/Notification');
const ProjectDocument = require('../models/ProjectDocument');
const Purchase = require('../models/Purchase');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const Vendor = require('../models/Vendor');
const { getEffectiveSubscriptionState } = require('../utils/billingAccess');
const { signJwt } = require('../utils/jwtConfig');
const { normalizeEmail } = require('../utils/platformAccess');
const IMPERSONATION_TOKEN_TTL = '2h';

const USER_RELATED_MODELS = [
  { key: 'leads', model: Lead },
  { key: 'investments', model: Investment },
  { key: 'managedProperties', model: ManagedProperty },
  { key: 'applications', model: Application },
  { key: 'purchases', model: Purchase },
  { key: 'vendors', model: Vendor },
  { key: 'inspections', model: Inspection },
  { key: 'maintenanceTickets', model: MaintenanceTicket },
  { key: 'bids', model: Bid },
  { key: 'documents', model: ProjectDocument },
  { key: 'notifications', model: Notification },
  { key: 'tenants', model: Tenant },
];

const buildUserCounts = async (userId) => {
  const entries = await Promise.all(
    USER_RELATED_MODELS.map(async ({ key, model }) => [key, await model.countDocuments({ user: userId })])
  );

  const counts = Object.fromEntries(entries);
  counts.totalOwnedRecords = Object.values(counts).reduce((total, value) => total + value, 0);
  return counts;
};

const buildUserSummary = async (user, currentPlatformManagerId) => {
  const counts = await buildUserCounts(user._id);
  const subscriptionState = getEffectiveSubscriptionState(user);

  return {
    id: user._id,
    name: user.name || 'Unnamed user',
    email: user.email,
    avatar: user.avatar || null,
    accountStatus: user.accountStatus || 'active',
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastBillingSyncAt: user.subscriptionCurrentPeriodEnd || null,
    isCurrentPlatformManager: String(user._id) === String(currentPlatformManagerId),
    canDelete: counts.totalOwnedRecords === 0,
    counts,
    subscription: {
      plan: subscriptionState.planKey,
      status: subscriptionState.status,
      source: subscriptionState.source,
      override: user.platformSubscriptionOverride || 'none',
      renewsAt: subscriptionState.renewsAt,
      underlyingPlan: user.subscriptionPlan || 'free',
      underlyingStatus: user.subscriptionStatus || 'inactive',
      stripeSubscriptionId: user.stripeSubscriptionId || null,
    },
  };
};

const getUserOr404 = async (userId) => {
  const user = await User.findById(userId);
  return user || null;
};

exports.getUsers = async (req, res) => {
  try {
    const query = String(req.query.q || '').trim();
    const filter = {};

    if (query) {
      const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(safeQuery, 'i');
      filter.$or = [{ name: regex }, { email: regex }];
    }

    const users = await User.find(filter)
      .sort({ createdAt: -1 })
      .limit(100);

    const summaries = await Promise.all(
      users.map((user) => buildUserSummary(user, req.user.id))
    );

    const stats = summaries.reduce(
      (accumulator, user) => {
        accumulator.totalUsers += 1;

        if (user.accountStatus === 'suspended') {
          accumulator.suspendedUsers += 1;
        } else {
          accumulator.activeUsers += 1;
        }

        if (user.subscription.plan === 'pro') {
          accumulator.proUsers += 1;
        } else {
          accumulator.freeUsers += 1;
        }

        if (user.subscription.override !== 'none') {
          accumulator.overriddenUsers += 1;
        }

        return accumulator;
      },
      {
        totalUsers: 0,
        activeUsers: 0,
        suspendedUsers: 0,
        proUsers: 0,
        freeUsers: 0,
        overriddenUsers: 0,
      }
    );

    return res.json({
      stats,
      users: summaries,
      platformManager: {
        id: req.user.id,
        email: req.user.email,
      },
    });
  } catch (error) {
    console.error('Platform manager list users error:', error);
    return res.status(500).json({ msg: 'Failed to load users.' });
  }
};

exports.setSubscriptionOverride = async (req, res) => {
  try {
    const targetUser = await getUserOr404(req.params.userId);
    if (!targetUser) {
      return res.status(404).json({ msg: 'User not found.' });
    }

    if (String(targetUser._id) === String(req.user.id)) {
      return res.status(400).json({ msg: 'Use normal billing controls for your own account.' });
    }

    const overridePlan = String(req.body.overridePlan || '').trim().toLowerCase();
    if (!['none', 'pro', 'free'].includes(overridePlan)) {
      return res.status(400).json({ msg: 'Unsupported subscription override.' });
    }

    targetUser.platformSubscriptionOverride = overridePlan;
    targetUser.platformSubscriptionOverrideAt = overridePlan === 'none' ? null : new Date();
    targetUser.platformSubscriptionOverrideBy = overridePlan === 'none' ? null : req.user._id;
    await targetUser.save();

    return res.json({
      message:
        overridePlan === 'pro'
          ? 'Complimentary Pro access granted.'
          : overridePlan === 'free'
            ? 'Pro access removed for this user.'
            : 'Billing override cleared.',
      user: await buildUserSummary(targetUser, req.user.id),
    });
  } catch (error) {
    console.error('Platform manager set subscription override error:', error);
    return res.status(500).json({ msg: 'Failed to update user access.' });
  }
};

exports.setAccountStatus = async (req, res) => {
  try {
    const targetUser = await getUserOr404(req.params.userId);
    if (!targetUser) {
      return res.status(404).json({ msg: 'User not found.' });
    }

    if (String(targetUser._id) === String(req.user.id)) {
      return res.status(400).json({ msg: 'You cannot suspend your own platform manager account.' });
    }

    const status = String(req.body.status || '').trim().toLowerCase();
    if (!['active', 'suspended'].includes(status)) {
      return res.status(400).json({ msg: 'Unsupported account status.' });
    }

    targetUser.accountStatus = status;
    await targetUser.save();

    return res.json({
      message: status === 'suspended' ? 'User account suspended.' : 'User account reactivated.',
      user: await buildUserSummary(targetUser, req.user.id),
    });
  } catch (error) {
    console.error('Platform manager set account status error:', error);
    return res.status(500).json({ msg: 'Failed to update account status.' });
  }
};

exports.createImpersonationSession = async (req, res) => {
  try {
    const targetUser = await getUserOr404(req.params.userId);
    if (!targetUser) {
      return res.status(404).json({ msg: 'User not found.' });
    }

    if (String(targetUser._id) === String(req.user.id)) {
      return res.status(400).json({ msg: 'You are already signed in as this platform manager account.' });
    }

    if (targetUser.accountStatus === 'suspended') {
      return res.status(403).json({ msg: 'Reactivate this user before impersonating their workspace.' });
    }

    const token = signJwt(
      {
        userId: targetUser._id,
        actorUserId: req.user._id,
        actorEmail: normalizeEmail(req.user.email),
        impersonation: true,
      },
      { expiresIn: IMPERSONATION_TOKEN_TTL }
    );

    return res.json({
      token,
      expiresIn: IMPERSONATION_TOKEN_TTL,
      user: await buildUserSummary(targetUser, req.user.id),
    });
  } catch (error) {
    console.error('Platform manager impersonation error:', error);
    return res.status(500).json({ msg: 'Failed to start impersonation session.' });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const targetUser = await getUserOr404(req.params.userId);
    if (!targetUser) {
      return res.status(404).json({ msg: 'User not found.' });
    }

    if (String(targetUser._id) === String(req.user.id)) {
      return res.status(400).json({ msg: 'You cannot delete your own platform manager account.' });
    }

    const counts = await buildUserCounts(targetUser._id);
    if (counts.totalOwnedRecords > 0) {
      return res.status(409).json({
        msg: 'This user still owns workspace data. Suspend the account instead of deleting it.',
        counts,
      });
    }

    await User.findByIdAndDelete(targetUser._id);
    return res.json({ message: 'User deleted successfully.' });
  } catch (error) {
    console.error('Platform manager delete user error:', error);
    return res.status(500).json({ msg: 'Failed to delete user.' });
  }
};
