const SCOPE_OPTIONS = [
  { key: 'kitchen', label: 'Kitchen', group: 'interior', aliases: ['cabinets', 'countertops', 'appliances'] },
  { key: 'bathroom', label: 'Bathroom', group: 'interior', aliases: ['bath', 'vanity', 'tile shower'] },
  { key: 'electrical', label: 'Electrical', group: 'systems', aliases: ['panel', 'wiring', 'fixtures'] },
  { key: 'plumbing', label: 'Plumbing', group: 'systems', aliases: ['pipes', 'water heater', 'fixtures plumbing'] },
  { key: 'flooring', label: 'Flooring', group: 'interior', aliases: ['tile', 'lvp', 'carpet', 'hardwood'] },
  { key: 'paint', label: 'Paint', group: 'interior', aliases: ['painting', 'primer'] },
  { key: 'roof', label: 'Roof', group: 'exterior', aliases: ['roofing', 'shingles'] },
  { key: 'hvac', label: 'HVAC', group: 'systems', aliases: ['air conditioning', 'heating', 'furnace'] },
  { key: 'exterior', label: 'Exterior', group: 'exterior', aliases: ['siding', 'landscaping', 'driveway'] },
  { key: 'demolition', label: 'Demolition', group: 'site', aliases: ['demo', 'tear out', 'removal'] },
  { key: 'framing', label: 'Framing', group: 'structure', aliases: ['studs', 'structural framing'] },
  { key: 'windows-doors', label: 'Windows / Doors', group: 'exterior', aliases: ['windows', 'doors'] },
  { key: 'insulation-drywall', label: 'Insulation / Drywall', group: 'interior', aliases: ['insulation', 'drywall', 'sheetrock'] },
  { key: 'permits-soft-costs', label: 'Permit / Soft Costs', group: 'soft-costs', aliases: ['permits', 'soft costs', 'design', 'engineering'] },
  { key: 'cleanout', label: 'Cleanout', group: 'site', aliases: ['trash out', 'junk removal'] },
  { key: 'foundation-structure', label: 'Foundation / Structure', group: 'structure', aliases: ['foundation', 'structure', 'structural'] },
  { key: 'sitework', label: 'Sitework', group: 'site', aliases: ['grading', 'drainage', 'excavation'] },
  { key: 'other', label: 'Other', group: 'custom', aliases: ['misc', 'miscellaneous', 'custom'] },
];

const toSlug = (value = '') =>
  String(value)
    .toLowerCase()
    .trim()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const titleCaseFromSlug = (value = '') =>
  String(value)
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');

const scopeOptionIndex = new Map();

SCOPE_OPTIONS.forEach((option) => {
  scopeOptionIndex.set(option.key, option);
  scopeOptionIndex.set(toSlug(option.label), option);
  (option.aliases || []).forEach((alias) => scopeOptionIndex.set(toSlug(alias), option));
});

const resolveScopeOption = (value = '') => {
  const normalized = toSlug(value);
  if (!normalized) {
    return null;
  }

  return scopeOptionIndex.get(normalized) || null;
};

const buildBudgetScopeMeta = ({ scopeKey = '', category = '', description = '' } = {}) => {
  const matchedOption =
    resolveScopeOption(scopeKey) ||
    resolveScopeOption(category) ||
    resolveScopeOption(description);

  if (matchedOption) {
    return {
      scopeKey: matchedOption.key,
      scopeGroup: matchedOption.group,
      defaultCategory: matchedOption.label,
    };
  }

  const fallbackKey = toSlug(scopeKey || category || description) || 'other';

  return {
    scopeKey: fallbackKey,
    scopeGroup: fallbackKey === 'other' ? 'custom' : 'custom',
    defaultCategory: category || titleCaseFromSlug(fallbackKey) || 'Other',
  };
};

const applyBudgetScopeMeta = (input = null) => {
  if (!input || typeof input !== 'object') {
    return input;
  }

  const scopeMeta = buildBudgetScopeMeta({
    scopeKey: input.scopeKey,
    category: input.category,
    description: input.description,
  });

  input.scopeKey = scopeMeta.scopeKey;
  input.scopeGroup = scopeMeta.scopeGroup;
  input.category = String(input.category || scopeMeta.defaultCategory || '').trim();

  return input;
};

module.exports = {
  SCOPE_OPTIONS,
  applyBudgetScopeMeta,
  buildBudgetScopeMeta,
  resolveScopeOption,
  titleCaseFromSlug,
  toSlug,
};
