const PROPERTY_STRATEGIES = ['flip', 'fix_and_rent', 'rental'];
const MANAGEMENT_ELIGIBLE_STRATEGIES = ['fix_and_rent', 'rental'];

const normalizePropertyStrategy = (value) => {
  if (!value || typeof value !== 'string') {
    return 'flip';
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\s*&\s*/g, '_and_')
    .replace(/[\s-]+/g, '_');

  if (PROPERTY_STRATEGIES.includes(normalized)) {
    return normalized;
  }

  if (normalized === 'rent') {
    return 'rental';
  }

  return 'flip';
};

const isManagementEligibleStrategy = (value) =>
  MANAGEMENT_ELIGIBLE_STRATEGIES.includes(normalizePropertyStrategy(value));

const getPropertyStrategyLabel = (value) => {
  const strategy = normalizePropertyStrategy(value);

  if (strategy === 'fix_and_rent') {
    return 'Fix & Rent';
  }

  if (strategy === 'rental') {
    return 'Rental';
  }

  return 'Flip';
};

module.exports = {
  PROPERTY_STRATEGIES,
  MANAGEMENT_ELIGIBLE_STRATEGIES,
  normalizePropertyStrategy,
  isManagementEligibleStrategy,
  getPropertyStrategyLabel,
};
