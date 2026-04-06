const CompsCreditGrant = require('../models/CompsCreditGrant');

const PURCHASE_SOURCE_TYPES = new Set([
  'purchase_pack',
  'purchase_topup',
  'migration',
  'platform_manager_grant',
]);
const CREDIT_SOURCE_PRIORITY = {
  trial: 1,
  subscription_monthly: 2,
  purchase_pack: 3,
  purchase_topup: 3,
  migration: 3,
  platform_manager_grant: 3,
};

const isGrantActive = (grant, now = new Date()) => {
  if (!grant || grant.remainingCredits <= 0) return false;
  if (!grant.expiresAt) return true;
  const expiresAt = new Date(grant.expiresAt);
  return Number.isFinite(expiresAt.valueOf()) && expiresAt > now;
};

const sortEligibleGrants = (grants = []) => {
  return [...grants].sort((left, right) => {
    const leftPriority = CREDIT_SOURCE_PRIORITY[left.sourceType] || 99;
    const rightPriority = CREDIT_SOURCE_PRIORITY[right.sourceType] || 99;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    if (left.expiresAt && right.expiresAt) {
      return new Date(left.expiresAt) - new Date(right.expiresAt);
    }

    if (left.expiresAt && !right.expiresAt) return -1;
    if (!left.expiresAt && right.expiresAt) return 1;

    return new Date(left.createdAt) - new Date(right.createdAt);
  });
};

const buildBalanceFromGrants = (grants = [], now = new Date()) => {
  const activeGrants = grants.filter((grant) => isGrantActive(grant, now));
  const trialGrant = sortEligibleGrants(activeGrants.filter((grant) => grant.sourceType === 'trial'))[0] || null;
  const monthlyGrant =
    sortEligibleGrants(activeGrants.filter((grant) => grant.sourceType === 'subscription_monthly'))[0] || null;

  const trialRemaining = activeGrants
    .filter((grant) => grant.sourceType === 'trial')
    .reduce((sum, grant) => sum + grant.remainingCredits, 0);
  const monthlyIncludedRemaining = activeGrants
    .filter((grant) => grant.sourceType === 'subscription_monthly')
    .reduce((sum, grant) => sum + grant.remainingCredits, 0);
  const purchasedRemaining = activeGrants
    .filter((grant) => PURCHASE_SOURCE_TYPES.has(grant.sourceType))
    .reduce((sum, grant) => sum + grant.remainingCredits, 0);
  const totalRemaining = trialRemaining + monthlyIncludedRemaining + purchasedRemaining;
  const nextExpiringGrant = sortEligibleGrants(activeGrants.filter((grant) => grant.expiresAt))[0] || null;

  return {
    totalRemaining,
    trialRemaining,
    trialExpiresAt: trialGrant?.expiresAt || null,
    monthlyIncludedRemaining,
    monthlyExpiresAt: monthlyGrant?.expiresAt || null,
    purchasedRemaining,
    nextExpiringAt: nextExpiringGrant?.expiresAt || null,
    grants: activeGrants,
  };
};

const getActiveCompsCreditGrants = async (userId, now = new Date()) => {
  const grants = await CompsCreditGrant.find({
    user: userId,
    remainingCredits: { $gt: 0 },
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
  }).sort({ createdAt: 1 });

  return sortEligibleGrants(grants);
};

const getCompsCreditBalance = async (userId, now = new Date()) => {
  const grants = await getActiveCompsCreditGrants(userId, now);
  return buildBalanceFromGrants(grants, now);
};

const grantCompsCredits = async ({
  userId,
  sourceType,
  credits,
  expiresAt = null,
  cycleStart = null,
  cycleEnd = null,
  stripeCheckoutSessionId = null,
  stripeSubscriptionId = null,
  stripeInvoiceId = null,
  grantKey = null,
  metadata = null,
}) => {
  try {
    return await CompsCreditGrant.create({
      user: userId,
      sourceType,
      totalCredits: credits,
      remainingCredits: credits,
      expiresAt,
      cycleStart,
      cycleEnd,
      stripeCheckoutSessionId,
      stripeSubscriptionId,
      stripeInvoiceId,
      grantKey,
      metadata,
    });
  } catch (error) {
    if (error?.code === 11000 && grantKey) {
      return CompsCreditGrant.findOne({ grantKey });
    }
    throw error;
  }
};

const consumeOneCompsCredit = async ({ userId, metadata = null }) => {
  const now = new Date();
  const grants = await getActiveCompsCreditGrants(userId, now);

  for (const grant of grants) {
    const updatedGrant = await CompsCreditGrant.findOneAndUpdate(
      {
        _id: grant._id,
        user: userId,
        remainingCredits: { $gt: 0 },
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
      },
      {
        $inc: { remainingCredits: -1 },
        ...(metadata
          ? {
              $set: {
                metadata: {
                  ...(grant.metadata || {}),
                  lastConsumption: {
                    occurredAt: now,
                    ...metadata,
                  },
                },
              },
            }
          : {}),
      },
      { new: true }
    );

    if (updatedGrant) {
      return updatedGrant;
    }
  }

  return null;
};

module.exports = {
  buildBalanceFromGrants,
  consumeOneCompsCredit,
  getActiveCompsCreditGrants,
  getCompsCreditBalance,
  grantCompsCredits,
};
