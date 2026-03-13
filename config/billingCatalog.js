const SUBSCRIPTION_PLANS = {
  free: {
    key: 'free',
    name: 'Starter',
    monthlyPriceCents: 0,
    description: 'Core workspace with limited premium access.',
    features: [
      'Manage leads, applications, and property workflows',
      'View saved reports that were previously purchased or generated',
      'Buy individual comps reports and tenant screenings when needed',
    ],
  },
  pro: {
    key: 'pro',
    name: 'Pro',
    monthlyPriceCents: 4900,
    stripePriceEnvVar: 'STRIPE_PRICE_PRO_MONTHLY',
    description: 'Unlock premium AI workflows and discounted per-report purchases.',
    features: [
      'Unlimited AI comps analysis across your leads',
      'AI investment report generation',
      'Discounted one-time purchase pricing for comps and screening services',
      'Billing portal access and subscription management',
    ],
  },
};

const ONE_TIME_PRODUCTS = {
  comps_report: {
    key: 'comps_report',
    name: 'AI Comps Report',
    description: 'Unlock one comps analysis run for a specific lead.',
    currency: 'usd',
    priceCents: 2900,
    subscriberPriceCents: 1900,
    stripePriceEnvVar: 'STRIPE_PRICE_COMPS_REPORT',
    subscriberStripePriceEnvVar: 'STRIPE_PRICE_COMPS_REPORT_PRO',
    resourceType: 'lead',
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
    subscriptionGrantsAccess: true,
    oneTimeProductKey: 'comps_report',
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
