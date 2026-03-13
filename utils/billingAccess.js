const Purchase = require('../models/Purchase');
const { FEATURE_RULES, ONE_TIME_PRODUCTS, SUBSCRIPTION_PLANS } = require('../config/billingCatalog');

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);

const isSubscriptionActive = (user) => {
  if (!user) return false;

  if (!ACTIVE_SUBSCRIPTION_STATUSES.has(user.subscriptionStatus)) {
    return false;
  }

  if (user.subscriptionCurrentPeriodEnd) {
    const end = new Date(user.subscriptionCurrentPeriodEnd);
    if (Number.isFinite(end.valueOf()) && end < new Date()) {
      return false;
    }
  }

  return user.subscriptionPlan === 'pro';
};

const getCurrentPlan = (user) => {
  if (isSubscriptionActive(user)) {
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

const getFeatureAccessState = async ({ user, featureKey, resourceId }) => {
  const rule = FEATURE_RULES[featureKey];
  if (!rule) {
    throw new Error(`Unknown feature key: ${featureKey}`);
  }

  const hasActiveSubscription = rule.subscriptionGrantsAccess
    ? isSubscriptionActive(user)
    : false;

  let matchingPurchase = null;
  if (rule.oneTimeProductKey && resourceId) {
    matchingPurchase = await Purchase.findOne({
      user: user._id,
      kind: rule.oneTimeProductKey,
      resourceId,
      status: 'paid',
    }).sort({ createdAt: -1 });
  }

  return {
    featureKey,
    hasActiveSubscription,
    hasUnusedPurchase: Boolean(matchingPurchase),
    accessGranted: hasActiveSubscription || Boolean(matchingPurchase),
    planKey: getCurrentPlan(user).key,
    purchase: matchingPurchase,
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

module.exports = {
  consumeMatchingPurchase,
  getCurrentPlan,
  getFeatureAccessState,
  getOneTimeProductForUser,
  isSubscriptionActive,
};
