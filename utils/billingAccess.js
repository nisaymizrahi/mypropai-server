const FeatureUsage = require('../models/FeatureUsage');
const Purchase = require('../models/Purchase');
const { FEATURE_RULES, ONE_TIME_PRODUCTS, SUBSCRIPTION_PLANS } = require('../config/billingCatalog');
const { getCompsCreditBalance } = require('./compsCredits');

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);

const getPlatformOverrideState = (user, now = new Date()) => {
  const storedPlan = user?.platformSubscriptionOverride || 'none';
  const expiresAt = user?.platformSubscriptionOverrideExpiresAt
    ? new Date(user.platformSubscriptionOverrideExpiresAt)
    : null;
  const hasExpiry = expiresAt && Number.isFinite(expiresAt.valueOf());
  const isExpired = Boolean(hasExpiry && expiresAt <= now);
  const planKey = isExpired ? 'none' : storedPlan;

  return {
    planKey,
    storedPlan,
    expiresAt: hasExpiry ? expiresAt : null,
    isExpired,
    reason: user?.platformSubscriptionOverrideReason || null,
    appliedAt: user?.platformSubscriptionOverrideAt || null,
    appliedBy: user?.platformSubscriptionOverrideBy || null,
  };
};

const getEffectiveSubscriptionState = (user) => {
  const overrideState = getPlatformOverrideState(user);
  const override = overrideState.planKey;

  if (override === 'pro') {
    return {
      planKey: 'pro',
      status: 'active',
      isActive: true,
      renewsAt: overrideState.expiresAt || null,
      source: 'platform_override',
      isOverride: true,
      overridePlan: 'pro',
    };
  }

  if (override === 'free') {
    return {
      planKey: 'free',
      status: 'inactive',
      isActive: false,
      renewsAt: overrideState.expiresAt || null,
      source: 'platform_override',
      isOverride: true,
      overridePlan: 'free',
    };
  }

  if (!user) {
    return {
      planKey: 'free',
      status: 'inactive',
      isActive: false,
      renewsAt: null,
      source: 'none',
      isOverride: false,
      overridePlan: 'none',
    };
  }

  let isActive = ACTIVE_SUBSCRIPTION_STATUSES.has(user.subscriptionStatus);

  if (isActive && user.subscriptionCurrentPeriodEnd) {
    const end = new Date(user.subscriptionCurrentPeriodEnd);
    if (Number.isFinite(end.valueOf()) && end < new Date()) {
      isActive = false;
    }
  }

  isActive = isActive && user.subscriptionPlan === 'pro';

  return {
    planKey: isActive ? 'pro' : 'free',
    status: user.subscriptionStatus || 'inactive',
    isActive,
    renewsAt: user.subscriptionCurrentPeriodEnd || null,
    source: user.subscriptionSource || 'none',
    isOverride: false,
    overridePlan: 'none',
  };
};

const isSubscriptionActive = (user) => {
  return getEffectiveSubscriptionState(user).isActive;
};

const getCurrentPlan = (user) => {
  const subscriptionState = getEffectiveSubscriptionState(user);

  if (subscriptionState.planKey === 'pro') {
    return SUBSCRIPTION_PLANS.pro;
  }

  return SUBSCRIPTION_PLANS.free;
};

const getOneTimeProductForUser = (kind, user) => {
  const product = ONE_TIME_PRODUCTS[kind];
  if (!product) {
    return null;
  }

  const isActiveSubscriber = isSubscriptionActive(user);
  const discountedPrice = isActiveSubscriber && product.subscriberPriceCents;

  return {
    ...product,
    activePriceCents: discountedPrice ? product.subscriberPriceCents : product.priceCents,
    activeStripePriceId:
      discountedPrice && product.subscriberStripePriceEnvVar
        ? process.env[product.subscriberStripePriceEnvVar]
        : process.env[product.stripePriceEnvVar],
  };
};

const getCurrentMonthWindow = (now = new Date()) => {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextPeriodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  return {
    periodStart,
    nextPeriodStart,
  };
};

const getIncludedUsageCountForCurrentMonth = async ({ userId, featureKey }) => {
  const { periodStart, nextPeriodStart } = getCurrentMonthWindow();

  const count = await FeatureUsage.countDocuments({
    user: userId,
    featureKey,
    source: 'subscription_included',
    occurredAt: {
      $gte: periodStart,
      $lt: nextPeriodStart,
    },
  });

  return {
    count,
    periodStart,
    nextPeriodStart,
  };
};

const getFeatureAccessState = async ({ user, featureKey, resourceId }) => {
  const rule = FEATURE_RULES[featureKey];
  if (!rule) {
    throw new Error(`Unknown feature key: ${featureKey}`);
  }

  const subscriptionState = getEffectiveSubscriptionState(user);
  const hasActiveSubscription = Boolean(
    rule.subscriptionPlan &&
      subscriptionState.isActive &&
      subscriptionState.planKey === rule.subscriptionPlan
  );

  if (featureKey === 'comps_report') {
    const balance = await getCompsCreditBalance(user._id);

    let matchingPurchase = null;
    if (resourceId) {
      matchingPurchase = await Purchase.findOne({
        user: user._id,
        kind: 'comps_report',
        resourceId,
        status: 'paid',
      }).sort({ createdAt: -1 });
    }

    let accessSource = null;
    if (balance.trialRemaining > 0) {
      accessSource = 'trial_credits';
    } else if (balance.monthlyIncludedRemaining > 0) {
      accessSource = 'subscription_included';
    } else if (balance.purchasedRemaining > 0) {
      accessSource = 'purchased_credits';
    } else if (matchingPurchase) {
      accessSource = 'one_time_purchase';
    }

    return {
      featureKey,
      hasActiveSubscription,
      hasUnusedPurchase: Boolean(matchingPurchase),
      accessGranted: balance.totalRemaining > 0 || Boolean(matchingPurchase),
      accessSource,
      planKey: getCurrentPlan(user).key,
      purchase: matchingPurchase,
      monthlyIncludedLimit: subscriptionState.status === 'trialing'
        ? rule.subscriptionTrialIncludedQuantity || 0
        : hasActiveSubscription
          ? rule.subscriptionMonthlyIncludedQuantity || 0
          : 0,
      monthlyIncludedUsedCount: Math.max(
        (
          subscriptionState.status === 'trialing'
            ? rule.subscriptionTrialIncludedQuantity || 0
            : hasActiveSubscription
              ? rule.subscriptionMonthlyIncludedQuantity || 0
              : 0
        ) - (subscriptionState.status === 'trialing' ? balance.trialRemaining : balance.monthlyIncludedRemaining),
        0
      ),
      monthlyIncludedRemainingCount:
        subscriptionState.status === 'trialing' ? balance.trialRemaining : balance.monthlyIncludedRemaining,
      monthlyIncludedResetsAt:
        subscriptionState.status === 'trialing' ? balance.trialExpiresAt : balance.monthlyExpiresAt,
      hasIncludedUsageRemaining: balance.trialRemaining > 0 || balance.monthlyIncludedRemaining > 0,
      totalCreditsRemaining: balance.totalRemaining,
      trialCreditsRemaining: balance.trialRemaining,
      trialCreditsExpiresAt: balance.trialExpiresAt,
      purchasedCreditsRemaining: balance.purchasedRemaining,
      purchasedCreditsNeverExpire: true,
      nextCreditExpirationAt: balance.nextExpiringAt,
    };
  }

  const monthlyIncludedLimit = hasActiveSubscription
    ? rule.subscriptionMonthlyIncludedQuantity || 0
    : 0;

  let monthlyIncludedUsedCount = 0;
  let monthlyIncludedRemainingCount = 0;
  let monthlyIncludedResetsAt = null;
  let hasIncludedUsageRemaining = false;

  if (monthlyIncludedLimit > 0) {
    const usage = await getIncludedUsageCountForCurrentMonth({
      userId: user._id,
      featureKey,
    });

    monthlyIncludedUsedCount = usage.count;
    monthlyIncludedRemainingCount = Math.max(monthlyIncludedLimit - usage.count, 0);
    monthlyIncludedResetsAt = usage.nextPeriodStart;
    hasIncludedUsageRemaining = monthlyIncludedRemainingCount > 0;
  }

  let matchingPurchase = null;
  if (rule.oneTimeProductKey && resourceId) {
    matchingPurchase = await Purchase.findOne({
      user: user._id,
      kind: rule.oneTimeProductKey,
      resourceId,
      status: 'paid',
    }).sort({ createdAt: -1 });
  }

  const subscriptionUnlimitedAccessGranted = rule.subscriptionGrantsAccess
    ? hasActiveSubscription
    : false;

  const subscriptionIncludedAccessGranted = hasIncludedUsageRemaining;

  let accessSource = null;
  if (subscriptionUnlimitedAccessGranted) {
    accessSource = 'subscription_unlimited';
  } else if (subscriptionIncludedAccessGranted) {
    accessSource = 'subscription_included';
  } else if (matchingPurchase) {
    accessSource = 'one_time_purchase';
  }

  return {
    featureKey,
    hasActiveSubscription,
    hasUnusedPurchase: Boolean(matchingPurchase),
    accessGranted:
      subscriptionUnlimitedAccessGranted || subscriptionIncludedAccessGranted || Boolean(matchingPurchase),
    accessSource,
    planKey: getCurrentPlan(user).key,
    purchase: matchingPurchase,
    monthlyIncludedLimit,
    monthlyIncludedUsedCount,
    monthlyIncludedRemainingCount,
    monthlyIncludedResetsAt,
    hasIncludedUsageRemaining,
  };
};

const consumeMatchingPurchase = async ({ userId, kind, resourceId }) => {
  const purchase = await Purchase.findOne({
    user: userId,
    kind,
    resourceId,
    status: 'paid',
  }).sort({ createdAt: 1 });

  if (!purchase) {
    return null;
  }

  purchase.status = 'consumed';
  purchase.consumedAt = new Date();
  await purchase.save();

  return purchase;
};

const recordFeatureUsage = async ({ userId, featureKey, resourceType = null, resourceId = null, source, metadata = {} }) => {
  return FeatureUsage.create({
    user: userId,
    featureKey,
    resourceType,
    resourceId,
    source,
    metadata,
  });
};

module.exports = {
  consumeMatchingPurchase,
  getCurrentMonthWindow,
  getEffectiveSubscriptionState,
  getPlatformOverrideState,
  getIncludedUsageCountForCurrentMonth,
  getCurrentPlan,
  getFeatureAccessState,
  getOneTimeProductForUser,
  isSubscriptionActive,
  recordFeatureUsage,
};
