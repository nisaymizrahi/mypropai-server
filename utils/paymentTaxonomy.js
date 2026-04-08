const normalizeKey = (value = '') =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '_');

const PAYMENT_COST_CLASS_OPTIONS = [
  { value: 'construction', label: 'Construction' },
  { value: 'soft_cost', label: 'Soft Cost' },
  { value: 'financing', label: 'Financing' },
  { value: 'closing', label: 'Closing' },
  { value: 'holding', label: 'Holding' },
  { value: 'disposition', label: 'Disposition' },
  { value: 'general', label: 'General' },
];

const PAYMENT_COST_TYPE_OPTIONS_BY_CLASS = {
  construction: [
    { value: 'contractor_labor', label: 'Contractor Labor' },
    { value: 'materials', label: 'Materials' },
    { value: 'supplier', label: 'Supplier' },
    { value: 'equipment_rental', label: 'Equipment Rental' },
  ],
  soft_cost: [
    { value: 'plans', label: 'Plans' },
    { value: 'permit', label: 'Permit' },
    { value: 'architect', label: 'Architect' },
    { value: 'engineer', label: 'Engineer' },
    { value: 'survey', label: 'Survey' },
    { value: 'inspection', label: 'Inspection' },
  ],
  financing: [
    { value: 'lender_fee', label: 'Lender Fee' },
    { value: 'points', label: 'Points' },
    { value: 'interest', label: 'Interest' },
    { value: 'appraisal', label: 'Appraisal' },
    { value: 'draw_fee', label: 'Draw Fee' },
  ],
  closing: [
    { value: 'title', label: 'Title' },
    { value: 'escrow', label: 'Escrow' },
    { value: 'attorney', label: 'Attorney' },
    { value: 'recording', label: 'Recording' },
    { value: 'transfer_tax', label: 'Transfer Tax' },
  ],
  holding: [
    { value: 'taxes', label: 'Taxes' },
    { value: 'insurance', label: 'Insurance' },
    { value: 'utilities', label: 'Utilities' },
    { value: 'hoa', label: 'HOA' },
    { value: 'lawn_snow', label: 'Lawn / Snow' },
    { value: 'security', label: 'Security' },
  ],
  disposition: [
    { value: 'staging', label: 'Staging' },
    { value: 'marketing', label: 'Marketing' },
    { value: 'commission', label: 'Commission' },
    { value: 'seller_closing_cost', label: 'Seller Closing Cost' },
  ],
  general: [
    { value: 'travel', label: 'Travel' },
    { value: 'office', label: 'Office' },
    { value: 'misc', label: 'Misc' },
  ],
};

const PAYMENT_COST_CLASS_VALUES = PAYMENT_COST_CLASS_OPTIONS.map((option) => option.value);
const PAYMENT_COST_TYPE_VALUES = Object.values(PAYMENT_COST_TYPE_OPTIONS_BY_CLASS)
  .flat()
  .map((option) => option.value);

const containsAnyTerm = (value, terms = []) => {
  const normalizedValue = normalizeKey(value).replace(/_/g, ' ');
  return terms.some((term) => normalizedValue.includes(normalizeKey(term).replace(/_/g, ' ')));
};

const normalizePaymentCostClass = (value = '') => {
  const normalizedValue = normalizeKey(value);
  return PAYMENT_COST_CLASS_VALUES.includes(normalizedValue) ? normalizedValue : '';
};

const getPaymentCostTypeOptions = (costClass = '') =>
  PAYMENT_COST_TYPE_OPTIONS_BY_CLASS[normalizePaymentCostClass(costClass)] || [];

const normalizePaymentCostType = (costClass = '', value = '') => {
  const normalizedCostClass = normalizePaymentCostClass(costClass);
  const normalizedValue = normalizeKey(value);

  if (!normalizedCostClass || !normalizedValue) {
    return '';
  }

  return getPaymentCostTypeOptions(normalizedCostClass).some(
    (option) => option.value === normalizedValue
  )
    ? normalizedValue
    : '';
};

const inferPaymentCostClass = ({
  title = '',
  description = '',
  recurringCategory = '',
  budgetItem = null,
  awardId = '',
  payeeName = '',
} = {}) => {
  const haystack = [title, description, payeeName, budgetItem?.category, budgetItem?.description]
    .filter(Boolean)
    .join(' ');

  if (['taxes', 'insurance', 'utilities'].includes(normalizeKey(recurringCategory))) {
    return 'holding';
  }

  if (containsAnyTerm(haystack, ['loan', 'lender', 'interest', 'points', 'draw fee', 'appraisal'])) {
    return 'financing';
  }

  if (
    containsAnyTerm(haystack, [
      'title',
      'escrow',
      'attorney',
      'recording',
      'transfer tax',
      'closing cost',
    ])
  ) {
    return 'closing';
  }

  if (
    containsAnyTerm(haystack, [
      'permit',
      'plans',
      'architect',
      'engineer',
      'survey',
      'inspection',
    ])
  ) {
    return 'soft_cost';
  }

  if (
    containsAnyTerm(haystack, [
      'taxes',
      'insurance',
      'utilities',
      'hoa',
      'lawn',
      'snow',
      'security',
    ])
  ) {
    return 'holding';
  }

  if (containsAnyTerm(haystack, ['staging', 'marketing', 'commission', 'seller closing'])) {
    return 'disposition';
  }

  if (budgetItem || awardId) {
    return 'construction';
  }

  return 'general';
};

const inferPaymentCostType = ({
  costClass = '',
  title = '',
  description = '',
  recurringCategory = '',
} = {}) => {
  const normalizedCostClass = normalizePaymentCostClass(costClass);
  const haystack = [title, description].filter(Boolean).join(' ');
  const recurringKey = normalizeKey(recurringCategory);

  if (!normalizedCostClass) {
    return '';
  }

  if (normalizedCostClass === 'construction') {
    if (containsAnyTerm(haystack, ['material', 'cabinet', 'tile', 'flooring', 'paint', 'appliance'])) {
      return 'materials';
    }
    if (containsAnyTerm(haystack, ['supplier', 'supply house'])) {
      return 'supplier';
    }
    if (containsAnyTerm(haystack, ['rental', 'lift', 'dumpster', 'equipment'])) {
      return 'equipment_rental';
    }
    return 'contractor_labor';
  }

  if (normalizedCostClass === 'soft_cost') {
    if (containsAnyTerm(haystack, ['permit'])) return 'permit';
    if (containsAnyTerm(haystack, ['architect'])) return 'architect';
    if (containsAnyTerm(haystack, ['engineer'])) return 'engineer';
    if (containsAnyTerm(haystack, ['survey'])) return 'survey';
    if (containsAnyTerm(haystack, ['inspection'])) return 'inspection';
    return 'plans';
  }

  if (normalizedCostClass === 'financing') {
    if (containsAnyTerm(haystack, ['points'])) return 'points';
    if (containsAnyTerm(haystack, ['interest'])) return 'interest';
    if (containsAnyTerm(haystack, ['appraisal'])) return 'appraisal';
    if (containsAnyTerm(haystack, ['draw'])) return 'draw_fee';
    return 'lender_fee';
  }

  if (normalizedCostClass === 'closing') {
    if (containsAnyTerm(haystack, ['escrow'])) return 'escrow';
    if (containsAnyTerm(haystack, ['attorney'])) return 'attorney';
    if (containsAnyTerm(haystack, ['recording'])) return 'recording';
    if (containsAnyTerm(haystack, ['transfer tax'])) return 'transfer_tax';
    return 'title';
  }

  if (normalizedCostClass === 'holding') {
    if (recurringKey === 'taxes' || containsAnyTerm(haystack, ['tax'])) return 'taxes';
    if (recurringKey === 'insurance' || containsAnyTerm(haystack, ['insurance'])) return 'insurance';
    if (
      recurringKey === 'utilities' ||
      containsAnyTerm(haystack, ['utility', 'electric', 'water', 'gas'])
    ) {
      return 'utilities';
    }
    if (containsAnyTerm(haystack, ['hoa'])) return 'hoa';
    if (containsAnyTerm(haystack, ['lawn', 'snow'])) return 'lawn_snow';
    if (containsAnyTerm(haystack, ['security'])) return 'security';
    return 'utilities';
  }

  if (normalizedCostClass === 'disposition') {
    if (containsAnyTerm(haystack, ['marketing'])) return 'marketing';
    if (containsAnyTerm(haystack, ['commission'])) return 'commission';
    if (containsAnyTerm(haystack, ['seller closing'])) return 'seller_closing_cost';
    return 'staging';
  }

  if (normalizedCostClass === 'general') {
    if (containsAnyTerm(haystack, ['travel', 'mileage'])) return 'travel';
    if (containsAnyTerm(haystack, ['office'])) return 'office';
    return 'misc';
  }

  return '';
};

const resolvePaymentClassification = (input = {}) => {
  const resolvedCostClass =
    normalizePaymentCostClass(input.costClass) || inferPaymentCostClass(input);
  const resolvedCostType =
    normalizePaymentCostType(resolvedCostClass, input.costType) ||
    inferPaymentCostType({
      ...input,
      costClass: resolvedCostClass,
    });

  return {
    costClass: resolvedCostClass,
    costType: resolvedCostType,
  };
};

module.exports = {
  PAYMENT_COST_CLASS_OPTIONS,
  PAYMENT_COST_CLASS_VALUES,
  PAYMENT_COST_TYPE_OPTIONS_BY_CLASS,
  PAYMENT_COST_TYPE_VALUES,
  getPaymentCostTypeOptions,
  inferPaymentCostClass,
  inferPaymentCostType,
  normalizePaymentCostClass,
  normalizePaymentCostType,
  resolvePaymentClassification,
};
