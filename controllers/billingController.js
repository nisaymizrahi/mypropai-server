const mongoose = require('mongoose');
const Application = require('../models/Application');
const Lead = require('../models/Lead');
const Purchase = require('../models/Purchase');
const User = require('../models/User');
const { FEATURE_RULES, ONE_TIME_PRODUCTS, SUBSCRIPTION_PLANS } = require('../config/billingCatalog');
const { getStripeClient } = require('../lib/stripe');
const { grantCompsCredits } = require('../utils/compsCredits');
const { buildStorageOverview } = require('../utils/documentStorageService');
const { applySubscriptionConsent } = require('../utils/userProfile');
const {
  getEffectiveSubscriptionState,
  getCurrentPlan,
  getFeatureAccessState,
  getOneTimeProductForUser,
  isSubscriptionActive,
} = require('../utils/billingAccess');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const DEFAULT_CURRENCY = 'usd';

const SUBSCRIPTION_SYNC_STATUSES = new Set(['active', 'trialing', 'past_due', 'incomplete']);
const SUBSCRIPTION_DEACTIVATED_STATUSES = new Set(['canceled', 'incomplete_expired', 'unpaid']);
const SUBSCRIPTION_CHECKOUT_SOURCE_FALLBACK = 'subscription_checkout';

const formatCatalogPlan = (plan) => ({
  key: plan.key,
  name: plan.name,
  description: plan.description,
  monthlyPriceCents: plan.monthlyPriceCents,
  trialPeriodDays: plan.trialPeriodDays || 0,
  trialIncludedCredits: plan.trialIncludedCredits || 0,
  monthlyIncludedCredits: plan.monthlyIncludedCredits || 0,
  features: plan.features,
});

const formatPurchase = (purchase) => ({
  id: purchase._id,
  kind: purchase.kind,
  resourceType: purchase.resourceType,
  resourceId: purchase.resourceId,
  status: purchase.status,
  amountCents: purchase.amountCents,
  currency: purchase.currency,
  purchasedAt: purchase.purchasedAt,
  consumedAt: purchase.consumedAt,
  createdAt: purchase.createdAt,
});

const formatSubscriptionOffer = (plan) => ({
  key: plan.key,
  name: plan.name,
  monthlyPriceCents: plan.monthlyPriceCents,
  trialPeriodDays: plan.trialPeriodDays || 0,
  renewalInterval: 'month',
});

const sanitizeReturnPath = (value, fallback = '/account') => {
  const candidate = String(value || '').trim();
  if (!candidate.startsWith('/')) return fallback;
  if (candidate.startsWith('//')) return fallback;
  return candidate;
};

const validateSubscriptionConsent = (input = {}, { plan, isTrialEligible }) => {
  if (input?.accepted !== true) {
    throw Object.assign(new Error('You must accept the subscription terms before continuing.'), {
      status: 400,
    });
  }

  if (input?.autoRenewDisclosureAccepted !== true || input?.nonRefundableDisclosureAccepted !== true) {
    throw Object.assign(
      new Error('You must acknowledge the renewal and refund terms before continuing.'),
      { status: 400 }
    );
  }

  const acceptedAt = input?.acceptedAt ? new Date(input.acceptedAt) : new Date();
  if (!Number.isFinite(acceptedAt.valueOf())) {
    throw Object.assign(new Error('A valid subscription consent timestamp is required.'), {
      status: 400,
    });
  }

  return {
    acceptedAt,
    planKey: plan.key,
    monthlyPriceCents: plan.monthlyPriceCents,
    trialPeriodDays: isTrialEligible ? plan.trialPeriodDays || 0 : 0,
    trialEligibleAtAcceptance: Boolean(isTrialEligible),
    source: input?.source || SUBSCRIPTION_CHECKOUT_SOURCE_FALLBACK,
  };
};

const isCompsCreditProduct = (product) => Boolean(product?.credits && product?.creditSourceType);

const buildLineItem = ({ name, description, currency, unitAmount, recurring, stripePriceId }) => {
  if (stripePriceId) {
    return {
      price: stripePriceId,
      quantity: 1,
    };
  }

  return {
    price_data: {
      currency,
      product_data: {
        name,
        description,
      },
      unit_amount: unitAmount,
      ...(recurring ? { recurring } : {}),
    },
    quantity: 1,
  };
};

const buildResourceReturnPath = (resourceType, resourceId) => {
  if (resourceType === 'account') {
    return '/account';
  }

  if (resourceType === 'lead') {
    return `/leads/${resourceId}`;
  }

  if (resourceType === 'application') {
    return `/applications/${resourceId}`;
  }

  return '/account';
};

const ensureStripeCustomer = async (user) => {
  const stripe = getStripeClient();
  if (!stripe) {
    throw new Error('Stripe is not configured on the server.');
  }

  if (user.stripeCustomerId) {
    return user.stripeCustomerId;
  }

  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name,
    metadata: {
      userId: user._id.toString(),
    },
  });

  user.stripeCustomerId = customer.id;
  await user.save();

  return customer.id;
};

const resolvePurchaseTarget = async (userId, kind, resourceId, returnPath = null) => {
  const product = ONE_TIME_PRODUCTS[kind];
  if (!product) {
    return { status: 400, message: 'Unsupported purchase type.' };
  }

  if (product.resourceType === 'account') {
    return {
      entity: null,
      resourceType: 'account',
      returnPath: sanitizeReturnPath(returnPath, '/account'),
    };
  }

  if (!mongoose.Types.ObjectId.isValid(resourceId)) {
    return { status: 400, message: 'A valid resource ID is required.' };
  }

  if (product.resourceType === 'lead') {
    const lead = await Lead.findOne({ _id: resourceId, user: userId });
    if (!lead) {
      return { status: 404, message: 'Lead not found.' };
    }

    return {
      entity: lead,
      resourceType: 'lead',
      returnPath: buildResourceReturnPath('lead', resourceId),
    };
  }

  if (product.resourceType === 'application') {
    const application = await Application.findOne({ _id: resourceId, user: userId });
    if (!application) {
      return { status: 404, message: 'Application not found.' };
    }

    if (!application.feePaid) {
      return {
        status: 400,
        message: 'The application fee must be paid before purchasing this application-specific service.',
      };
    }

    return {
      entity: application,
      resourceType: 'application',
      returnPath: buildResourceReturnPath('application', resourceId),
    };
  }

  return { status: 400, message: 'Unsupported purchase target.' };
};

const syncUserSubscription = async (user, subscription, fallbackPlanKey = 'pro') => {
  if (!user || !subscription) return null;

  const planKey = subscription.metadata?.planKey || fallbackPlanKey || 'pro';
  const status = subscription.status || 'inactive';

  user.stripeCustomerId = subscription.customer || user.stripeCustomerId;
  user.stripeSubscriptionId = subscription.id;
  user.subscriptionSource = 'stripe';
  user.subscriptionStatus = status;
  user.subscriptionCurrentPeriodStart = subscription.current_period_start
    ? new Date(subscription.current_period_start * 1000)
    : null;
  user.subscriptionCurrentPeriodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000)
    : null;
  user.subscriptionLastSyncedAt = new Date();

  if (!user.proTrialUsedAt && subscription.status === 'trialing') {
    user.proTrialUsedAt = new Date();
    user.proTrialSubscriptionId = subscription.id;
  }

  if (SUBSCRIPTION_DEACTIVATED_STATUSES.has(status)) {
    user.subscriptionPlan = 'free';
    user.subscriptionSource = 'none';
  } else {
    user.subscriptionPlan = planKey;
  }

  await user.save();
  return user;
};

const grantTrialCreditsForSubscription = async ({ user, subscription, sessionId = null }) => {
  if (!user || !subscription || subscription.status !== 'trialing') {
    return null;
  }

  const trialCredits = SUBSCRIPTION_PLANS.pro?.trialIncludedCredits || 0;
  if (!trialCredits) {
    return null;
  }

  const trialEndsAt = subscription.trial_end
    ? new Date(subscription.trial_end * 1000)
    : user.subscriptionCurrentPeriodEnd || null;

  return grantCompsCredits({
    userId: user._id,
    sourceType: 'trial',
    credits: trialCredits,
    expiresAt: trialEndsAt,
    cycleStart: subscription.trial_start ? new Date(subscription.trial_start * 1000) : null,
    cycleEnd: trialEndsAt,
    stripeCheckoutSessionId: sessionId,
    stripeSubscriptionId: subscription.id,
    grantKey: `trial:${subscription.id}`,
    metadata: {
      planKey: 'pro',
      reason: 'pro_trial',
    },
  });
};

const grantMonthlyCreditsForInvoice = async (invoice) => {
  const stripe = getStripeClient();
  if (!stripe || !invoice?.subscription || !invoice?.customer) {
    return null;
  }

  if (!Number.isFinite(invoice.amount_paid) || invoice.amount_paid <= 0) {
    return null;
  }

  const user = await User.findOne({ stripeCustomerId: invoice.customer });
  if (!user) {
    return null;
  }

  const subscription =
    typeof invoice.subscription === 'string'
      ? await stripe.subscriptions.retrieve(invoice.subscription)
      : invoice.subscription;

  await syncUserSubscription(user, subscription, subscription.metadata?.planKey);

  return grantCompsCredits({
    userId: user._id,
    sourceType: 'subscription_monthly',
    credits: SUBSCRIPTION_PLANS.pro?.monthlyIncludedCredits || 50,
    expiresAt: subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null,
    cycleStart: subscription.current_period_start
      ? new Date(subscription.current_period_start * 1000)
      : null,
    cycleEnd: subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null,
    stripeSubscriptionId: subscription.id,
    stripeInvoiceId: invoice.id,
    grantKey: `invoice:${invoice.id}:subscription_monthly`,
    metadata: {
      planKey: 'pro',
      reason: 'subscription_cycle',
      invoiceBillingReason: invoice.billing_reason || null,
    },
  });
};

const fulfillPaidPurchase = async (purchase) => {
  if (!purchase || purchase.status !== 'paid' || purchase.fulfilledAt) {
    return purchase;
  }

  const product = ONE_TIME_PRODUCTS[purchase.kind];
  if (!isCompsCreditProduct(product)) {
    purchase.fulfilledAt = new Date();
    await purchase.save();
    return purchase;
  }

  await grantCompsCredits({
    userId: purchase.user,
    sourceType: product.creditSourceType,
    credits: product.credits,
    stripeCheckoutSessionId: purchase.stripeCheckoutSessionId || null,
    grantKey: `purchase:${purchase._id}:credits`,
    metadata: {
      purchaseId: purchase._id.toString(),
      kind: purchase.kind,
      reason: product.creditSourceType,
    },
  });

  purchase.fulfilledAt = new Date();
  await purchase.save();
  return purchase;
};

const markPurchasePaid = async (session) => {
  const purchaseId = session.metadata?.purchaseId;
  if (!purchaseId) return null;

  const purchase = await Purchase.findById(purchaseId);
  if (!purchase) {
    return null;
  }

  if (session.payment_status === 'paid') {
    purchase.status = 'paid';
    purchase.purchasedAt = purchase.purchasedAt || new Date();
    purchase.stripeCheckoutSessionId = session.id;
    purchase.stripePaymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;
    await purchase.save();
    await fulfillPaidPurchase(purchase);
  }

  return purchase;
};

const markPurchaseCanceled = async (sessionId) => {
  if (!sessionId) return null;

  const purchase = await Purchase.findOne({ stripeCheckoutSessionId: sessionId, status: 'pending' });
  if (!purchase) return null;

  purchase.status = 'canceled';
  await purchase.save();
  return purchase;
};

const syncSubscriptionFromCheckoutSession = async (session) => {
  const stripe = getStripeClient();
  if (!stripe || !session.subscription) return null;

  const subscription =
    typeof session.subscription === 'string'
      ? await stripe.subscriptions.retrieve(session.subscription)
      : session.subscription;

  const user =
    (session.metadata?.userId && (await User.findById(session.metadata.userId))) ||
    (subscription.customer && (await User.findOne({ stripeCustomerId: subscription.customer })));

  if (!user) return null;

  if (session.metadata?.subscriptionConsentAcceptedAt) {
    applySubscriptionConsent(user, {
      acceptedAt: session.metadata.subscriptionConsentAcceptedAt,
      planKey: session.metadata?.planKey || subscription.metadata?.planKey || 'pro',
      monthlyPriceCents:
        session.metadata?.subscriptionMonthlyPriceCents || SUBSCRIPTION_PLANS.pro?.monthlyPriceCents,
      trialPeriodDays: session.metadata?.subscriptionTrialPeriodDays || 0,
      trialEligibleAtAcceptance: session.metadata?.subscriptionTrialEligible === 'true',
      source: session.metadata?.subscriptionConsentSource || SUBSCRIPTION_CHECKOUT_SOURCE_FALLBACK,
    });
    await user.save();
  }

  const syncedUser = await syncUserSubscription(user, subscription, session.metadata?.planKey);
  await grantTrialCreditsForSubscription({
    user: syncedUser,
    subscription,
    sessionId: session.id,
  });

  return syncedUser;
};

const syncCheckoutSessionById = async (sessionId, userId) => {
  const stripe = getStripeClient();
  if (!stripe) {
    throw new Error('Stripe is not configured on the server.');
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['subscription', 'payment_intent'],
  });

  const sessionUserId = session.metadata?.userId;
  if (sessionUserId && userId && sessionUserId !== userId.toString()) {
    throw new Error('This checkout session does not belong to the current user.');
  }

  if (session.mode === 'subscription') {
    await syncSubscriptionFromCheckoutSession(session);
  }

  if (session.mode === 'payment') {
    await markPurchasePaid(session);
  }

  return session;
};

const handleSubscriptionWebhook = async (subscription) => {
  const user =
    (subscription.metadata?.userId && (await User.findById(subscription.metadata.userId))) ||
    (subscription.customer && (await User.findOne({ stripeCustomerId: subscription.customer })));

  if (!user) {
    return null;
  }

  if (SUBSCRIPTION_SYNC_STATUSES.has(subscription.status) || SUBSCRIPTION_DEACTIVATED_STATUSES.has(subscription.status)) {
    const syncedUser = await syncUserSubscription(user, subscription, subscription.metadata?.planKey);
    await grantTrialCreditsForSubscription({
      user: syncedUser,
      subscription,
    });
    return syncedUser;
  }

  return null;
};

exports.getBillingOverview = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ msg: 'User not found.' });
    }

    const purchases = await Purchase.find({ user: user._id }).sort({ createdAt: -1 }).limit(10);
    const currentPlan = getCurrentPlan(user);
    const subscriptionState = getEffectiveSubscriptionState(user);
    const compsUsage = await getFeatureAccessState({
      user,
      featureKey: 'comps_report',
    });
    const documentStorage = buildStorageOverview(user);

    res.json({
      plan: {
        key: currentPlan.key,
        name: currentPlan.name,
        status: subscriptionState.status,
        isActive: subscriptionState.isActive,
        isTrialing: subscriptionState.status === 'trialing',
        renewsAt: subscriptionState.renewsAt,
        source: subscriptionState.source,
        override: user.platformSubscriptionOverride || 'none',
        features: currentPlan.features,
        trialEligible: !user.proTrialUsedAt && !subscriptionState.isActive,
        trialUsedAt: user.proTrialUsedAt || null,
      },
      stripe: {
        customerId: user.stripeCustomerId || null,
        connectAccountId: user.stripeAccountId || null,
        connectOnboardingComplete: Boolean(user.stripeOnboardingComplete),
      },
      catalog: {
        subscriptionPlans: Object.values(SUBSCRIPTION_PLANS).map(formatCatalogPlan),
        oneTimeProducts: Object.values(ONE_TIME_PRODUCTS).map((product) => {
          const activeProduct = getOneTimeProductForUser(product.key, user);
          return {
            key: product.key,
            name: product.name,
            description: product.description,
            currency: product.currency,
            priceCents: activeProduct.activePriceCents,
            basePriceCents: product.priceCents,
            subscriberPriceCents: product.subscriberPriceCents || null,
            monthlyIncludedQuantity: FEATURE_RULES[product.key]?.subscriptionMonthlyIncludedQuantity || 0,
            resourceType: product.resourceType,
            credits: product.credits || 0,
            requiresActiveSubscription: Boolean(product.requiresActiveSubscription),
          };
        }),
      },
      usage: {
        compsReport: {
          totalRemaining: compsUsage.totalCreditsRemaining || 0,
          trialRemaining: compsUsage.trialCreditsRemaining || 0,
          trialExpiresAt: compsUsage.trialCreditsExpiresAt || null,
          monthlyIncludedLimit: compsUsage.monthlyIncludedLimit,
          monthlyIncludedUsedCount: compsUsage.monthlyIncludedUsedCount,
          monthlyIncludedRemainingCount: compsUsage.monthlyIncludedRemainingCount,
          monthlyIncludedResetsAt: compsUsage.monthlyIncludedResetsAt,
          purchasedRemaining: compsUsage.purchasedCreditsRemaining || 0,
          nextCreditExpirationAt: compsUsage.nextCreditExpirationAt || null,
        },
        documentStorage,
      },
      purchases: purchases.map(formatPurchase),
    });
  } catch (error) {
    console.error('Billing overview error:', error);
    res.status(500).json({ msg: 'Failed to load billing overview.' });
  }
};

exports.getResourceAccess = async (req, res) => {
  try {
    const { kind, resourceId } = req.query;

    const rule = FEATURE_RULES[kind];
    if (!rule) {
      return res.status(400).json({ msg: 'Unsupported billing access check.' });
    }

    if (rule.oneTimeProductKey && resourceId) {
      const target = await resolvePurchaseTarget(req.user.id, rule.oneTimeProductKey, resourceId);
      if (target.status) {
        return res.status(target.status).json({ msg: target.message });
      }
    }

    const access = await getFeatureAccessState({
      user: req.user,
      featureKey: kind,
      resourceId,
    });

    res.json({
      featureKey: access.featureKey,
      accessGranted: access.accessGranted,
      hasActiveSubscription: access.hasActiveSubscription,
      trialEligible: !req.user.proTrialUsedAt && !isSubscriptionActive(req.user),
      hasUnusedPurchase: access.hasUnusedPurchase,
      planKey: access.planKey,
      accessSource: access.accessSource,
      monthlyIncludedLimit: access.monthlyIncludedLimit,
      monthlyIncludedUsedCount: access.monthlyIncludedUsedCount,
      monthlyIncludedRemainingCount: access.monthlyIncludedRemainingCount,
      monthlyIncludedResetsAt: access.monthlyIncludedResetsAt,
      totalCreditsRemaining: access.totalCreditsRemaining || 0,
      trialCreditsRemaining: access.trialCreditsRemaining || 0,
      trialCreditsExpiresAt: access.trialCreditsExpiresAt || null,
      purchasedCreditsRemaining: access.purchasedCreditsRemaining || 0,
      nextCreditExpirationAt: access.nextCreditExpirationAt || null,
      subscriptionOffer: formatSubscriptionOffer(SUBSCRIPTION_PLANS.pro),
    });
  } catch (error) {
    console.error('Billing access error:', error);
    res.status(500).json({ msg: 'Failed to determine billing access.' });
  }
};

exports.createSubscriptionCheckoutSession = async (req, res) => {
  try {
    const stripe = getStripeClient();
    if (!stripe) {
      return res.status(503).json({ msg: 'Stripe is not configured on the server.' });
    }

    const { planKey = 'pro', subscriptionConsent: rawSubscriptionConsent = null } = req.body || {};
    const plan = SUBSCRIPTION_PLANS[planKey];

    if (!plan || plan.key === 'free') {
      return res.status(400).json({ msg: 'Unsupported subscription plan.' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ msg: 'User not found.' });
    }

    if (isSubscriptionActive(user)) {
      return res.status(400).json({ msg: 'Pro is already active for this account. Use the billing portal to manage it.' });
    }

    const isTrialEligible = !user.proTrialUsedAt;
    const subscriptionConsent = validateSubscriptionConsent(rawSubscriptionConsent, {
      plan,
      isTrialEligible,
    });

    applySubscriptionConsent(user, subscriptionConsent);
    await user.save();

    const customerId = await ensureStripeCustomer(user);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      success_url: `${FRONTEND_URL}/account?billing_success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/account?billing_canceled=true`,
      allow_promotion_codes: true,
      payment_method_collection: 'always',
      line_items: [
        buildLineItem({
          name: `${plan.name} Subscription`,
          description: plan.description,
          currency: DEFAULT_CURRENCY,
          unitAmount: plan.monthlyPriceCents,
          recurring: { interval: 'month' },
          stripePriceId: process.env[plan.stripePriceEnvVar],
        }),
      ],
      metadata: {
        type: 'subscription',
        userId: user._id.toString(),
        planKey: plan.key,
        trialEligible: isTrialEligible ? 'true' : 'false',
        subscriptionConsentAcceptedAt: subscriptionConsent.acceptedAt.toISOString(),
        subscriptionConsentSource: subscriptionConsent.source,
        subscriptionMonthlyPriceCents: String(plan.monthlyPriceCents),
        subscriptionTrialEligible: isTrialEligible ? 'true' : 'false',
        subscriptionTrialPeriodDays: String(isTrialEligible ? plan.trialPeriodDays || 0 : 0),
      },
      subscription_data: {
        metadata: {
          userId: user._id.toString(),
          planKey: plan.key,
          subscriptionConsentAcceptedAt: subscriptionConsent.acceptedAt.toISOString(),
          subscriptionConsentSource: subscriptionConsent.source,
        },
        ...(isTrialEligible && plan.trialPeriodDays
          ? {
              trial_period_days: plan.trialPeriodDays,
            }
          : {}),
      },
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Subscription checkout error:', error);
    res.status(error.status || 500).json({ msg: error.message || 'Failed to start subscription checkout.' });
  }
};

exports.createOneTimeCheckoutSession = async (req, res) => {
  try {
    const stripe = getStripeClient();
    if (!stripe) {
      return res.status(503).json({ msg: 'Stripe is not configured on the server.' });
    }

    const { kind, resourceId = null, returnPath = null } = req.body || {};
    const product = getOneTimeProductForUser(kind, req.user);
    if (!product) {
      return res.status(400).json({ msg: 'Unsupported purchase type.' });
    }

    if (product.requiresActiveSubscription && !isSubscriptionActive(req.user)) {
      return res.status(400).json({ msg: 'This purchase is only available for active Pro accounts.' });
    }

    if (kind === 'comps_report') {
      const access = await getFeatureAccessState({
        user: req.user,
        featureKey: 'comps_report',
        resourceId,
      });

      if (access.accessSource === 'subscription_included') {
        return res.json({
          alreadyUnlocked: true,
          msg: `This report is already included in your Pro plan. ${access.monthlyIncludedRemainingCount} monthly report${access.monthlyIncludedRemainingCount === 1 ? '' : 's'} remaining.`,
        });
      }
    }

    const target = await resolvePurchaseTarget(req.user.id, kind, resourceId, returnPath);
    if (target.status) {
      return res.status(target.status).json({ msg: target.message });
    }

    if (product.resourceType !== 'account') {
      const existingPurchase = await Purchase.findOne({
        user: req.user.id,
        kind,
        resourceId,
        status: 'paid',
      }).sort({ createdAt: -1 });

      if (existingPurchase) {
        return res.json({
          alreadyUnlocked: true,
          msg: 'This item is already unlocked and ready to use.',
        });
      }
    }

    const user = await User.findById(req.user.id);
    const customerId = await ensureStripeCustomer(user);

    const purchase = await Purchase.create({
      user: user._id,
      kind,
      resourceType: product.resourceType,
      resourceId,
      status: 'pending',
      amountCents: product.activePriceCents,
      currency: product.currency,
      metadata: {
        returnPath: target.returnPath,
      },
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      success_url: `${FRONTEND_URL}${target.returnPath}?billing_success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}${target.returnPath}?billing_canceled=true`,
      allow_promotion_codes: true,
      line_items: [
        buildLineItem({
          name: product.name,
          description: product.description,
          currency: product.currency || DEFAULT_CURRENCY,
          unitAmount: product.activePriceCents,
          stripePriceId: product.activeStripePriceId,
        }),
      ],
      metadata: {
        type: 'one_time',
        userId: user._id.toString(),
        purchaseId: purchase._id.toString(),
        kind,
        ...(resourceId ? { resourceId: resourceId.toString() } : {}),
      },
      client_reference_id: purchase._id.toString(),
    });

    purchase.stripeCheckoutSessionId = session.id;
    await purchase.save();

    res.json({ url: session.url });
  } catch (error) {
    console.error('One-time checkout error:', error);
    res.status(500).json({ msg: 'Failed to start one-time checkout.' });
  }
};

exports.createCustomerPortalSession = async (req, res) => {
  try {
    const stripe = getStripeClient();
    if (!stripe) {
      return res.status(503).json({ msg: 'Stripe is not configured on the server.' });
    }

    const user = await User.findById(req.user.id);
    if (!user?.stripeCustomerId) {
      return res.status(400).json({ msg: 'No Stripe customer record was found for this account.' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${FRONTEND_URL}/account`,
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Billing portal session error:', error);
    res.status(500).json({ msg: 'Failed to open the billing portal.' });
  }
};

exports.syncCheckoutSession = async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ msg: 'A checkout session ID is required.' });
    }

    const session = await syncCheckoutSessionById(sessionId, req.user.id);
    res.json({
      id: session.id,
      mode: session.mode,
      paymentStatus: session.payment_status,
      status: session.status,
    });
  } catch (error) {
    console.error('Checkout session sync error:', error);
    res.status(400).json({ msg: error.message || 'Failed to sync checkout session.' });
  }
};

exports.handleStripeWebhook = async (req, res) => {
  const stripe = getStripeClient();
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ msg: 'Stripe webhook handling is not configured on the server.' });
  }

  let event;

  try {
    const signature = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    console.error('Stripe webhook signature verification failed:', error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await syncCheckoutSessionById(event.data.object.id);
        break;
      case 'checkout.session.expired':
        await markPurchaseCanceled(event.data.object.id);
        break;
      case 'invoice.paid':
        await grantMonthlyCreditsForInvoice(event.data.object);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await handleSubscriptionWebhook(event.data.object);
        break;
      default:
        break;
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook processing failed:', error);
    res.status(500).json({ msg: 'Webhook processing failed.' });
  }
};
