const SUBSCRIPTION_PLANS = {
  free: {
    key: 'free',
    name: 'Starter',
    monthlyPriceCents: 0,
    description: 'Core workspace with limited premium access.',
    features: [
      'Manage leads, applications, and property workflows',
      'View saved reports that were previously purchased or generated',
      'Buy 10-credit comps packs and tenant screenings when needed',
    ],
  },
  pro: {
    key: 'pro',
    name: 'Pro',
    monthlyPriceCents: 2900,
    stripePriceEnvVar: 'STRIPE_PRICE_PRO_MONTHLY',
    trialPeriodDays: 30,
    trialIncludedCredits: 2,
    monthlyIncludedCredits: 50,
    topUpPriceCents: 900,
    topUpQuantity: 10,
    description: 'Unlock premium AI workflows with a 30-day trial, 50 comps credits each billing cycle, and discounted top-ups.',
    features: [
      '30-day free trial with 2 starter comps credits',
      '50 comps credits included every paid billing cycle',
      'Buy unlimited 10-credit top-ups for $9',
      'AI investment report generation',
      'Discounted tenant screening pricing',
      'Billing portal access and subscription management',
    ],
  },
};

const ONE_TIME_PRODUCTS = {
  comps_pack_10: {
    key: 'comps_pack_10',
    name: 'Comps Pack (10 Credits)',
    description: 'Add 10 permanent comps credits to this account.',
    currency: 'usd',
    priceCents: 1800,
    stripePriceEnvVar: 'STRIPE_PRICE_COMPS_PACK_10',
    resourceType: 'account',
    credits: 10,
    creditSourceType: 'purchase_pack',
  },
  pro_comps_topup_10: {
    key: 'pro_comps_topup_10',
    name: 'Pro Top-Up (10 Credits)',
    description: 'Add 10 permanent Pro top-up credits to this account.',
    currency: 'usd',
    priceCents: 900,
    stripePriceEnvVar: 'STRIPE_PRICE_PRO_COMPS_TOPUP_10',
    resourceType: 'account',
    credits: 10,
    creditSourceType: 'purchase_topup',
    requiresActiveSubscription: true,
  },
  tenant_screening: {
    key: 'tenant_screening',
    name: 'Tenant Screening',
    description: 'Unlock one tenant screening run for a specific application.',
    currency: 'usd',
    priceCents: 4500,
    subscriberPriceCents: 3500,
    stripePriceEnvVar: 'STRIPE_PRICE_TENANT_SCREENING',
    subscriberStripePriceEnvVar: 'STRIPE_PRICE_TENANT_SCREENING_PRO',
    resourceType: 'application',
  },
};

const FEATURE_RULES = {
  comps_report: {
    key: 'comps_report',
    label: 'AI comps analysis',
    subscriptionPlan: 'pro',
    subscriptionGrantsAccess: false,
    subscriptionMonthlyIncludedQuantity: 50,
    subscriptionTrialIncludedQuantity: 2,
    oneTimeProductKey: null,
    starterPackProductKey: 'comps_pack_10',
    proTopUpProductKey: 'pro_comps_topup_10',
  },
  tenant_screening: {
    key: 'tenant_screening',
    label: 'Tenant screening',
    subscriptionPlan: null,
    subscriptionGrantsAccess: false,
    oneTimeProductKey: 'tenant_screening',
  },
  ai_investment_report: {
    key: 'ai_investment_report',
    label: 'AI investment reports',
    subscriptionPlan: 'pro',
    subscriptionGrantsAccess: true,
    oneTimeProductKey: null,
  },
};

module.exports = {
  FEATURE_RULES,
  ONE_TIME_PRODUCTS,
  SUBSCRIPTION_PLANS,
};
