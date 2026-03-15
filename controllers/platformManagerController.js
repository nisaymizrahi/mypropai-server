const mongoose = require('mongoose');
const Application = require('../models/Application');
const AuthSession = require('../models/AuthSession');
const Bid = require('../models/Bid');
const FeatureUsage = require('../models/FeatureUsage');
const Inspection = require('../models/Inspection');
const Investment = require('../models/Investment');
const Lead = require('../models/Lead');
const MaintenanceTicket = require('../models/MaintenanceTicket');
const ManagedProperty = require('../models/ManagedProperty');
const Notification = require('../models/Notification');
const PlatformAuditLog = require('../models/PlatformAuditLog');
const PlatformSupportNote = require('../models/PlatformSupportNote');
const ProjectDocument = require('../models/ProjectDocument');
const Purchase = require('../models/Purchase');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const Vendor = require('../models/Vendor');
const { FEATURE_RULES } = require('../config/billingCatalog');
const {
  getCurrentMonthWindow,
  getEffectiveSubscriptionState,
  getPlatformOverrideState,
} = require('../utils/billingAccess');
const { createAuthSessionToken } = require('../utils/authSessionService');
const { getStripeClient } = require('../lib/stripe');
const { normalizeEmail } = require('../utils/platformAccess');

const IMPERSONATION_TOKEN_TTL = '2h';
const IMPERSONATION_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const BILLING_ISSUE_STATUSES = new Set(['past_due', 'unpaid', 'incomplete']);
const SUBSCRIPTION_DEACTIVATED_STATUSES = new Set(['canceled', 'incomplete_expired', 'unpaid']);

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

const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));

const isRecentDate = (value, durationMs = THIRTY_DAYS_MS) => {
  if (!value) return false;
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return false;
  return Date.now() - date.getTime() <= durationMs;
};

const parseOptionalDate = (value) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) ? parsed : null;
};

const csvEscape = (value) => {
  if (value === null || value === undefined) {
    return '';
  }

  const normalized = String(value).replace(/"/g, '""');
  return /[",\n]/.test(normalized) ? `"${normalized}"` : normalized;
};

const summarizeUserAgent = (userAgent = '') => {
  const normalized = String(userAgent || '').trim();
  if (!normalized) {
    return 'Unknown browser';
  }

  if (normalized.includes('Chrome')) return 'Chrome';
  if (normalized.includes('Safari') && !normalized.includes('Chrome')) return 'Safari';
  if (normalized.includes('Firefox')) return 'Firefox';
  if (normalized.includes('Edg')) return 'Edge';
  return normalized.slice(0, 80);
};

const buildUserCounts = async (userId) => {
  const entries = await Promise.all(
    USER_RELATED_MODELS.map(async ({ key, model }) => [key, await model.countDocuments({ user: userId })])
  );

  const counts = Object.fromEntries(entries);
  counts.totalOwnedRecords = Object.values(counts).reduce((total, value) => total + value, 0);
  return counts;
};

const buildLatestSessionLookup = async (userIds) => {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return new Map();
  }

  const objectIds = userIds.map((id) => toObjectId(id));
  const now = new Date();

  const [latestSessions, activeSessions] = await Promise.all([
    AuthSession.aggregate([
      { $match: { user: { $in: objectIds } } },
      { $sort: { lastActivityAt: -1, createdAt: -1 } },
      {
        $group: {
          _id: '$user',
          lastSeenAt: { $first: '$lastActivityAt' },
          lastSessionCreatedAt: { $first: '$createdAt' },
        },
      },
    ]),
    AuthSession.aggregate([
      {
        $match: {
          user: { $in: objectIds },
          revokedAt: null,
          expiresAt: { $gt: now },
        },
      },
      {
        $group: {
          _id: '$user',
          activeSessionCount: { $sum: 1 },
          lastActiveSessionAt: { $max: '$lastActivityAt' },
        },
      },
    ]),
  ]);

  const map = new Map();

  latestSessions.forEach((entry) => {
    map.set(String(entry._id), {
      lastSeenAt: entry.lastSeenAt || null,
      lastSessionCreatedAt: entry.lastSessionCreatedAt || null,
      activeSessionCount: 0,
      lastActiveSessionAt: null,
    });
  });

  activeSessions.forEach((entry) => {
    const key = String(entry._id);
    const current = map.get(key) || {
      lastSeenAt: null,
      lastSessionCreatedAt: null,
      activeSessionCount: 0,
      lastActiveSessionAt: null,
    };

    current.activeSessionCount = entry.activeSessionCount || 0;
    current.lastActiveSessionAt = entry.lastActiveSessionAt || null;
    current.lastSeenAt = current.lastSeenAt || entry.lastActiveSessionAt || null;
    map.set(key, current);
  });

  return map;
};

const buildUserSummary = async (user, currentPlatformManagerId, context = {}) => {
  const counts = context.counts || (await buildUserCounts(user._id));
  const sessionMeta = context.sessionMeta || {};
  const overrideState = getPlatformOverrideState(user);
  const subscriptionState = getEffectiveSubscriptionState(user);
  const lastLoginAt = user.lastLoginAt || sessionMeta.lastSessionCreatedAt || null;
  const lastSeenAt = sessionMeta.lastSeenAt || null;
  const hasBillingIssue = Boolean(
    user.subscriptionSource === 'stripe' && BILLING_ISSUE_STATUSES.has(user.subscriptionStatus || '')
  );

  return {
    id: user._id,
    name: user.name || 'Unnamed user',
    email: user.email,
    avatar: user.avatar || null,
    accountStatus: user.accountStatus || 'active',
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt,
    lastSeenAt,
    lastBillingSyncAt: user.subscriptionLastSyncedAt || null,
    activeSessionCount: sessionMeta.activeSessionCount || 0,
    isCurrentPlatformManager: String(user._id) === String(currentPlatformManagerId),
    canDelete: counts.totalOwnedRecords === 0,
    isRecentSignup: isRecentDate(user.createdAt, 7 * 24 * 60 * 60 * 1000),
    isRecentlyActive: isRecentDate(lastLoginAt),
    hasBillingIssue,
    counts,
    subscription: {
      plan: subscriptionState.planKey,
      status: subscriptionState.status,
      source: subscriptionState.source,
      isActive: subscriptionState.isActive,
      override: overrideState.planKey,
      storedOverride: overrideState.storedPlan,
      overrideExpiresAt: overrideState.expiresAt,
      overrideExpired: overrideState.isExpired,
      overrideReason: overrideState.reason,
      renewsAt: subscriptionState.renewsAt,
      underlyingPlan: user.subscriptionPlan || 'free',
      underlyingStatus: user.subscriptionStatus || 'inactive',
      stripeSubscriptionId: user.stripeSubscriptionId || null,
      stripeCustomerId: user.stripeCustomerId || null,
    },
  };
};

const serializeAuditLog = (log) => ({
  id: log._id,
  action: log.action,
  actorEmail: log.actorEmail || null,
  targetEmail: log.targetEmail || null,
  reason: log.reason || null,
  metadata: log.metadata || {},
  createdAt: log.createdAt,
});

const serializeSupportNote = (note) => ({
  id: note._id,
  body: note.body,
  authorEmail: note.authorEmail,
  createdAt: note.createdAt,
  updatedAt: note.updatedAt,
});

const serializeSession = (session, currentSessionId) => {
  const now = Date.now();
  const expiresAt = session.expiresAt ? new Date(session.expiresAt) : null;
  const revokedAt = session.revokedAt ? new Date(session.revokedAt) : null;
  const isExpired = Boolean(expiresAt && expiresAt.getTime() <= now);
  const isRevoked = Boolean(revokedAt);

  return {
    id: String(session._id),
    authMethod: session.authMethod,
    sessionType: session.sessionType,
    createdAt: session.createdAt,
    lastActivityAt: session.lastActivityAt,
    expiresAt: session.expiresAt,
    revokedAt: session.revokedAt,
    ipAddress: session.ipAddress || null,
    userAgent: summarizeUserAgent(session.userAgent),
    isCurrent: currentSessionId ? String(session._id) === String(currentSessionId) : false,
    status: isRevoked ? 'revoked' : isExpired ? 'expired' : 'active',
  };
};

const buildUsageSummary = async (userId) => {
  const { periodStart, nextPeriodStart } = getCurrentMonthWindow();
  const userObjectId = toObjectId(userId);

  const [lifetimeEntries, monthlyEntries] = await Promise.all([
    FeatureUsage.aggregate([
      { $match: { user: userObjectId } },
      {
        $group: {
          _id: '$featureKey',
          totalCount: { $sum: 1 },
          lastUsedAt: { $max: '$occurredAt' },
        },
      },
      { $sort: { totalCount: -1, _id: 1 } },
    ]),
    FeatureUsage.aggregate([
      {
        $match: {
          user: userObjectId,
          occurredAt: {
            $gte: periodStart,
            $lt: nextPeriodStart,
          },
        },
      },
      {
        $group: {
          _id: '$featureKey',
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const monthlyMap = new Map(monthlyEntries.map((entry) => [entry._id, entry.count]));
  const lifetime = lifetimeEntries.map((entry) => ({
    featureKey: entry._id,
    label: FEATURE_RULES[entry._id]?.label || entry._id,
    totalCount: entry.totalCount,
    currentMonthCount: monthlyMap.get(entry._id) || 0,
    lastUsedAt: entry.lastUsedAt || null,
  }));

  return {
    periodStart,
    nextPeriodStart,
    lifetime,
  };
};

const recordAuditLog = async ({ actorUser, targetUser, action, reason = null, metadata = {} }) => {
  try {
    return await PlatformAuditLog.create({
      actorUser: actorUser?._id || actorUser?.id || null,
      actorEmail: normalizeEmail(actorUser?.email || ''),
      targetUser: targetUser?._id || targetUser?.id || null,
      targetEmail: normalizeEmail(targetUser?.email || ''),
      action,
      reason: reason || null,
      metadata,
    });
  } catch (error) {
    console.error('Platform audit log write failed:', error);
    return null;
  }
};

const getUserOr404 = async (userId) => {
  const user = await User.findById(userId);
  return user || null;
};

const requireActionableUser = async (req, res) => {
  const targetUser = await getUserOr404(req.params.userId);
  if (!targetUser) {
    res.status(404).json({ msg: 'User not found.' });
    return null;
  }

  return targetUser;
};

const syncStripeStateForUser = async (user) => {
  const stripe = getStripeClient();
  if (!stripe) {
    const error = new Error('Stripe is not configured on the server.');
    error.status = 503;
    throw error;
  }

  let subscription = null;

  if (user.stripeSubscriptionId) {
    subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
  } else if (user.stripeCustomerId) {
    const result = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      status: 'all',
      limit: 1,
    });
    subscription = result.data[0] || null;
  }

  user.subscriptionLastSyncedAt = new Date();

  if (!subscription) {
    user.subscriptionPlan = 'free';
    user.subscriptionStatus = 'inactive';
    user.subscriptionCurrentPeriodEnd = null;
    user.subscriptionSource = 'none';
    user.stripeSubscriptionId = null;
    await user.save();
    return user;
  }

  const planKey = subscription.metadata?.planKey || 'pro';
  const status = subscription.status || 'inactive';

  user.stripeCustomerId = subscription.customer || user.stripeCustomerId;
  user.stripeSubscriptionId = subscription.id;
  user.subscriptionStatus = status;
  user.subscriptionCurrentPeriodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000)
    : null;

  if (SUBSCRIPTION_DEACTIVATED_STATUSES.has(status)) {
    user.subscriptionPlan = 'free';
    user.subscriptionSource = 'none';
  } else {
    user.subscriptionPlan = planKey;
    user.subscriptionSource = 'stripe';
  }

  await user.save();
  return user;
};

const buildUserDetailPayload = async (targetUser, currentPlatformManagerId, currentSessionId = null) => {
  const [counts, sessions, supportNotes, auditLogs, usage] = await Promise.all([
    buildUserCounts(targetUser._id),
    AuthSession.find({ user: targetUser._id })
      .sort({ lastActivityAt: -1, createdAt: -1 })
      .limit(12),
    PlatformSupportNote.find({ targetUser: targetUser._id }).sort({ createdAt: -1 }).limit(20),
    PlatformAuditLog.find({ targetUser: targetUser._id }).sort({ createdAt: -1 }).limit(30),
    buildUsageSummary(targetUser._id),
  ]);

  const activeSessions = sessions.filter(
    (session) => !session.revokedAt && (!session.expiresAt || new Date(session.expiresAt) > new Date())
  );
  const lastSeenAt = sessions[0]?.lastActivityAt || null;
  const summary = await buildUserSummary(targetUser, currentPlatformManagerId, {
    counts,
    sessionMeta: {
      lastSeenAt,
      lastSessionCreatedAt: sessions[0]?.createdAt || null,
      activeSessionCount: activeSessions.length,
    },
  });

  return {
    user: summary,
    billing: {
      stripeCustomerId: targetUser.stripeCustomerId || null,
      stripeSubscriptionId: targetUser.stripeSubscriptionId || null,
      stripeAccountId: targetUser.stripeAccountId || null,
      stripeOnboardingComplete: Boolean(targetUser.stripeOnboardingComplete),
      subscriptionPlan: targetUser.subscriptionPlan || 'free',
      subscriptionStatus: targetUser.subscriptionStatus || 'inactive',
      subscriptionSource: targetUser.subscriptionSource || 'none',
      subscriptionCurrentPeriodEnd: targetUser.subscriptionCurrentPeriodEnd || null,
      subscriptionLastSyncedAt: targetUser.subscriptionLastSyncedAt || null,
      hasBillingIssue:
        targetUser.subscriptionSource === 'stripe' &&
        BILLING_ISSUE_STATUSES.has(targetUser.subscriptionStatus || ''),
      canSync: Boolean(targetUser.stripeCustomerId || targetUser.stripeSubscriptionId),
    },
    usage,
    sessions: sessions.map((session) => serializeSession(session, currentSessionId)),
    supportNotes: supportNotes.map(serializeSupportNote),
    auditLogs: auditLogs.map(serializeAuditLog),
  };
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

    const sessionLookup = await buildLatestSessionLookup(users.map((user) => user._id));

    const summaries = await Promise.all(
      users.map((user) =>
        buildUserSummary(user, req.user.id, {
          sessionMeta: sessionLookup.get(String(user._id)),
        })
      )
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

        if (user.hasBillingIssue) {
          accumulator.billingIssueUsers += 1;
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
        billingIssueUsers: 0,
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

exports.exportUsers = async (req, res) => {
  try {
    const query = String(req.query.q || '').trim();
    const filter = {};

    if (query) {
      const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(safeQuery, 'i');
      filter.$or = [{ name: regex }, { email: regex }];
    }

    const users = await User.find(filter).sort({ createdAt: -1 }).limit(1000);
    const sessionLookup = await buildLatestSessionLookup(users.map((user) => user._id));
    const summaries = await Promise.all(
      users.map((user) =>
        buildUserSummary(user, req.user.id, {
          sessionMeta: sessionLookup.get(String(user._id)),
        })
      )
    );

    const header = [
      'Name',
      'Email',
      'Status',
      'Effective Plan',
      'Override',
      'Override Expiry',
      'Billing Status',
      'Billing Source',
      'Has Billing Issue',
      'Joined',
      'Last Login',
      'Last Seen',
      'Leads',
      'Investments',
      'Managed Properties',
      'Applications',
      'Purchases',
      'Vendors',
      'Bids',
      'Documents',
      'Total Owned Records',
    ];

    const rows = summaries.map((user) => [
      user.name,
      user.email,
      user.accountStatus,
      user.subscription.plan,
      user.subscription.override,
      user.subscription.overrideExpiresAt || '',
      user.subscription.status,
      user.subscription.source,
      user.hasBillingIssue ? 'yes' : 'no',
      user.createdAt || '',
      user.lastLoginAt || '',
      user.lastSeenAt || '',
      user.counts.leads,
      user.counts.investments,
      user.counts.managedProperties,
      user.counts.applications,
      user.counts.purchases,
      user.counts.vendors,
      user.counts.bids,
      user.counts.documents,
      user.counts.totalOwnedRecords,
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map(csvEscape).join(','))
      .join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="platform-users.csv"');
    return res.send(csv);
  } catch (error) {
    console.error('Platform manager export users error:', error);
    return res.status(500).json({ msg: 'Failed to export users.' });
  }
};

exports.getUserDetail = async (req, res) => {
  try {
    const targetUser = await requireActionableUser(req, res);
    if (!targetUser) {
      return;
    }

    const detail = await buildUserDetailPayload(targetUser, req.user.id, req.auth?.session?.id || null);
    return res.json(detail);
  } catch (error) {
    console.error('Platform manager user detail error:', error);
    return res.status(500).json({ msg: 'Failed to load the user detail.' });
  }
};

exports.setSubscriptionOverride = async (req, res) => {
  try {
    const targetUser = await requireActionableUser(req, res);
    if (!targetUser) {
      return;
    }

    if (String(targetUser._id) === String(req.user.id)) {
      return res.status(400).json({ msg: 'Use normal billing controls for your own account.' });
    }

    const overridePlan = String(req.body.overridePlan || '').trim().toLowerCase();
    if (!['none', 'pro', 'free'].includes(overridePlan)) {
      return res.status(400).json({ msg: 'Unsupported subscription override.' });
    }

    const expiresAt = parseOptionalDate(req.body.expiresAt);
    if (req.body.expiresAt && !expiresAt) {
      return res.status(400).json({ msg: 'Invalid override expiry date.' });
    }

    if (overridePlan !== 'none' && expiresAt && expiresAt <= new Date()) {
      return res.status(400).json({ msg: 'Override expiry must be in the future.' });
    }

    const reason = String(req.body.reason || '').trim();

    targetUser.platformSubscriptionOverride = overridePlan;
    targetUser.platformSubscriptionOverrideAt = overridePlan === 'none' ? null : new Date();
    targetUser.platformSubscriptionOverrideBy = overridePlan === 'none' ? null : req.user._id;
    targetUser.platformSubscriptionOverrideExpiresAt = overridePlan === 'none' ? null : expiresAt;
    targetUser.platformSubscriptionOverrideReason = overridePlan === 'none' ? null : reason || null;
    await targetUser.save();

    await recordAuditLog({
      actorUser: req.user,
      targetUser,
      action:
        overridePlan === 'none'
          ? 'subscription_override_cleared'
          : overridePlan === 'pro'
            ? 'subscription_override_pro'
            : 'subscription_override_free',
      reason: reason || null,
      metadata: {
        overridePlan,
        expiresAt,
      },
    });

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
    const targetUser = await requireActionableUser(req, res);
    if (!targetUser) {
      return;
    }

    if (String(targetUser._id) === String(req.user.id)) {
      return res.status(400).json({ msg: 'You cannot suspend your own platform manager account.' });
    }

    const status = String(req.body.status || '').trim().toLowerCase();
    if (!['active', 'suspended'].includes(status)) {
      return res.status(400).json({ msg: 'Unsupported account status.' });
    }

    const reason = String(req.body.reason || '').trim();
    targetUser.accountStatus = status;
    await targetUser.save();

    if (status === 'suspended') {
      await AuthSession.updateMany(
        { user: targetUser._id, revokedAt: null },
        { $set: { revokedAt: new Date() } }
      );
    }

    await recordAuditLog({
      actorUser: req.user,
      targetUser,
      action: status === 'suspended' ? 'account_suspended' : 'account_reactivated',
      reason: reason || null,
      metadata: {
        status,
      },
    });

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
    const targetUser = await requireActionableUser(req, res);
    if (!targetUser) {
      return;
    }

    if (String(targetUser._id) === String(req.user.id)) {
      return res.status(400).json({ msg: 'You are already signed in as this platform manager account.' });
    }

    if (targetUser.accountStatus === 'suspended') {
      return res.status(403).json({ msg: 'Reactivate this user before impersonating their workspace.' });
    }

    const reason = String(req.body.reason || '').trim();
    if (reason.length < 3) {
      return res.status(400).json({ msg: 'Please include a short reason before impersonating a user.' });
    }

    const { token } = await createAuthSessionToken({
      user: targetUser,
      req,
      actorUser: req.user,
      authMethod: 'impersonation',
      sessionType: 'impersonation',
      expiresIn: IMPERSONATION_TOKEN_TTL,
      absoluteTimeoutMs: IMPERSONATION_TIMEOUT_MS,
      extraPayload: {
        actorUserId: req.user._id,
        actorEmail: normalizeEmail(req.user.email),
        impersonation: true,
      },
    });

    await recordAuditLog({
      actorUser: req.user,
      targetUser,
      action: 'impersonation_started',
      reason,
      metadata: {
        sessionType: 'impersonation',
      },
    });

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

exports.revokeUserSessions = async (req, res) => {
  try {
    const targetUser = await requireActionableUser(req, res);
    if (!targetUser) {
      return;
    }

    if (String(targetUser._id) === String(req.user.id)) {
      return res.status(400).json({ msg: 'Use the normal sign-out flow for your own platform manager session.' });
    }

    const reason = String(req.body.reason || '').trim();
    const result = await AuthSession.updateMany(
      {
        user: targetUser._id,
        revokedAt: null,
      },
      {
        $set: { revokedAt: new Date() },
      }
    );

    await recordAuditLog({
      actorUser: req.user,
      targetUser,
      action: 'sessions_revoked',
      reason: reason || null,
      metadata: {
        revokedSessionCount: result.modifiedCount || 0,
      },
    });

    return res.json({
      message: 'All active sessions were revoked.',
      revokedSessionCount: result.modifiedCount || 0,
    });
  } catch (error) {
    console.error('Platform manager revoke sessions error:', error);
    return res.status(500).json({ msg: 'Failed to revoke active sessions.' });
  }
};

exports.syncUserBilling = async (req, res) => {
  try {
    const targetUser = await requireActionableUser(req, res);
    if (!targetUser) {
      return;
    }

    const syncedUser = await syncStripeStateForUser(targetUser);
    const reason = String(req.body.reason || '').trim();

    await recordAuditLog({
      actorUser: req.user,
      targetUser: syncedUser,
      action: 'billing_synced',
      reason: reason || null,
      metadata: {
        stripeCustomerId: syncedUser.stripeCustomerId || null,
        stripeSubscriptionId: syncedUser.stripeSubscriptionId || null,
        subscriptionStatus: syncedUser.subscriptionStatus || 'inactive',
      },
    });

    return res.json({
      message: 'Billing data synced from Stripe.',
      user: await buildUserSummary(syncedUser, req.user.id),
    });
  } catch (error) {
    console.error('Platform manager sync billing error:', error);
    return res.status(error.status || 500).json({ msg: error.message || 'Failed to sync billing.' });
  }
};

exports.addSupportNote = async (req, res) => {
  try {
    const targetUser = await requireActionableUser(req, res);
    if (!targetUser) {
      return;
    }

    const body = String(req.body.body || '').trim();
    if (body.length < 3) {
      return res.status(400).json({ msg: 'Support notes should include a few words of context.' });
    }

    const note = await PlatformSupportNote.create({
      targetUser: targetUser._id,
      authorUser: req.user._id,
      authorEmail: normalizeEmail(req.user.email),
      body,
    });

    await recordAuditLog({
      actorUser: req.user,
      targetUser,
      action: 'support_note_added',
      metadata: {
        noteId: note._id,
      },
    });

    return res.status(201).json({
      message: 'Support note saved.',
      note: serializeSupportNote(note),
    });
  } catch (error) {
    console.error('Platform manager add support note error:', error);
    return res.status(500).json({ msg: 'Failed to save support note.' });
  }
};

exports.deleteSupportNote = async (req, res) => {
  try {
    const note = await PlatformSupportNote.findById(req.params.noteId);
    if (!note) {
      return res.status(404).json({ msg: 'Support note not found.' });
    }

    const targetUser = await User.findById(note.targetUser);

    await PlatformSupportNote.findByIdAndDelete(note._id);
    await recordAuditLog({
      actorUser: req.user,
      targetUser,
      action: 'support_note_deleted',
      metadata: {
        noteId: note._id,
      },
    });

    return res.json({ message: 'Support note deleted.' });
  } catch (error) {
    console.error('Platform manager delete support note error:', error);
    return res.status(500).json({ msg: 'Failed to delete support note.' });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const targetUser = await requireActionableUser(req, res);
    if (!targetUser) {
      return;
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

    await recordAuditLog({
      actorUser: req.user,
      targetUser,
      action: 'user_deleted',
      metadata: {
        email: targetUser.email,
      },
    });

    await Promise.all([
      AuthSession.updateMany({ user: targetUser._id, revokedAt: null }, { $set: { revokedAt: new Date() } }),
      PlatformSupportNote.deleteMany({ targetUser: targetUser._id }),
      User.findByIdAndDelete(targetUser._id),
    ]);

    return res.json({ message: 'User deleted successfully.' });
  } catch (error) {
    console.error('Platform manager delete user error:', error);
    return res.status(500).json({ msg: 'Failed to delete user.' });
  }
};
