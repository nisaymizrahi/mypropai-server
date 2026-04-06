const Lead = require('../models/Lead');
const Investment = require('../models/Investment');
const BudgetItem = require('../models/BudgetItem');
const OpenAI = require('openai');
const {
  fetchRentCastValueEstimate,
  getLeadPropertyPreview,
  numberOrNull,
} = require('../utils/leadPropertyService');
const {
  buildCompsAnalysis: buildSharedCompsAnalysis,
  buildLegacyCompsAnalysisSnapshot,
  generateAiReport: generateSharedAiReport,
} = require('../utils/compsAnalysisService');
const { buildMasterDealReport } = require('../utils/masterDealReportService');
const { consumeMatchingPurchase, getFeatureAccessState, recordFeatureUsage } = require('../utils/billingAccess');
const { consumeOneCompsCredit } = require('../utils/compsCredits');
const { upsertCanonicalProperty } = require('../utils/propertyRecordService');
const { createExecutionProjectFromLead } = require('../utils/projectLifecycleService');

const getOpenAIClient = () => {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
};

const sharedLeadFields = [
  'address',
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'zipCode',
  'county',
  'latitude',
  'longitude',
  'propertyType',
  'bedrooms',
  'bathrooms',
  'squareFootage',
  'lotSize',
  'yearBuilt',
  'unitCount',
];

const stageLeadFields = [
  'inPropertyWorkspace',
  'sellerAskingPrice',
  'sellerName',
  'sellerPhone',
  'sellerEmail',
  'leadSource',
  'occupancyStatus',
  'motivation',
  'targetOffer',
  'arv',
  'rehabEstimate',
  'nextAction',
  'followUpDate',
  'listingStatus',
  'listedDate',
  'daysOnMarket',
  'lastSalePrice',
  'lastSaleDate',
  'notes',
  'status',
  'renovationPlan',
];

const numericLeadFields = new Set([
  'latitude',
  'longitude',
  'bedrooms',
  'bathrooms',
  'squareFootage',
  'lotSize',
  'yearBuilt',
  'unitCount',
  'sellerAskingPrice',
  'targetOffer',
  'arv',
  'rehabEstimate',
  'daysOnMarket',
  'lastSalePrice',
]);

const dateLeadFields = new Set(['listedDate', 'lastSaleDate', 'followUpDate']);
const booleanLeadFields = new Set(['inPropertyWorkspace']);

const booleanFromInput = (value) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', '1'].includes(normalized)) return true;
    if (['false', 'no', '0'].includes(normalized)) return false;
  }
  return Boolean(value);
};

const buildRenovationItemId = (index = 0) =>
  `ren-${Date.now().toString(36)}-${index.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const titleCaseFromSlug = (value = '') =>
  String(value)
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');

const sanitizeRenovationItems = (input = []) => {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return null;
      }

      const category = typeof item.category === 'string' ? item.category.trim() : '';
      const name =
        typeof item.name === 'string' && item.name.trim()
          ? item.name.trim()
          : titleCaseFromSlug(category) || 'Custom item';
      const scopeDescription =
        typeof item.scopeDescription === 'string' ? item.scopeDescription.trim() : '';

      if (!name && !scopeDescription && numberOrNull(item.budget) === null) {
        return null;
      }

      return {
        itemId:
          typeof item.itemId === 'string' && item.itemId.trim()
            ? item.itemId.trim()
            : buildRenovationItemId(index),
        name,
        category: category || 'custom',
        budget: numberOrNull(item.budget),
        status:
          typeof item.status === 'string' && item.status.trim()
            ? item.status.trim()
            : 'planning',
        scopeDescription,
      };
    })
    .filter(Boolean);
};

const sanitizeRenovationPlan = (input = {}) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }

  const items = sanitizeRenovationItems(input.items);
  const selectedScopes = Array.isArray(input.selectedScopes)
    ? [...new Set(input.selectedScopes.map((scope) => String(scope).trim()).filter(Boolean))]
    : [];

  const legacyItems = items.length
    ? items
    : selectedScopes.map((scope, index) => ({
        itemId: buildRenovationItemId(index),
        name: titleCaseFromSlug(scope),
        category: String(scope).trim() || 'custom',
        budget: null,
        status: 'planning',
        scopeDescription: '',
      }));

  const legacyNotes = [
    typeof input.layoutChanges === 'string' ? input.layoutChanges.trim() : '',
    typeof input.contractorNotes === 'string' ? input.contractorNotes.trim() : '',
    typeof input.additionalNotes === 'string' ? input.additionalNotes.trim() : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  if (!legacyItems.length && legacyNotes) {
    legacyItems.push({
      itemId: buildRenovationItemId(legacyItems.length),
      name: 'General renovation notes',
      category: 'custom',
      budget: null,
      status: 'planning',
      scopeDescription: legacyNotes,
    });
  }

  return {
    verifiedSquareFootage: numberOrNull(input.verifiedSquareFootage),
    renovationLevel:
      typeof input.renovationLevel === 'string' ? input.renovationLevel.trim() : '',
    extensionPlanned: booleanFromInput(input.extensionPlanned) || false,
    extensionSquareFootage: numberOrNull(input.extensionSquareFootage),
    items: legacyItems,
  };
};

const average = (values) => {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

const roundCurrency = (value) => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed / 1000) * 1000;
};

const toValidDateOrNull = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) ? parsed : null;
};

const formatAiObjectKey = (value = '') => {
  const normalized = String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();

  if (!normalized) return 'Value';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const stringifyAiValue = (value) => {
  if (value === null || value === undefined) return '';

  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (Array.isArray(value)) {
    return value.map((item) => stringifyAiValue(item)).filter(Boolean).join('\n');
  }

  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, entryValue]) => {
        const rendered = stringifyAiValue(entryValue);
        if (!rendered) return '';
        return `${formatAiObjectKey(key)}: ${rendered}`;
      })
      .filter(Boolean)
      .join('; ');
  }

  return String(value).trim();
};

const normalizeAiList = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => stringifyAiValue(item))
      .flatMap((item) => item.split('\n'))
      .map((item) => item.trim())
      .filter(Boolean);
  }

  const rendered = stringifyAiValue(value);
  return rendered ? [rendered] : [];
};

const normalizeAiConfidence = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'low') return 'Low';
  if (normalized === 'medium') return 'Medium';
  if (normalized === 'high') return 'High';
  return stringifyAiValue(value);
};

const normalizeAiReport = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return {
    headline: stringifyAiValue(value.headline),
    executiveSummary: stringifyAiValue(value.executiveSummary),
    pricingRecommendation: stringifyAiValue(value.pricingRecommendation),
    offerStrategy: stringifyAiValue(value.offerStrategy),
    confidence: normalizeAiConfidence(value.confidence),
    riskFlags: normalizeAiList(value.riskFlags),
    nextSteps: normalizeAiList(value.nextSteps),
  };
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const matchesNumericRange = (value, min, max) => {
  const hasRange =
    (min !== null && min !== undefined) || (max !== null && max !== undefined);

  if (hasRange && (value === null || value === undefined)) {
    return false;
  }

  if (min !== null && min !== undefined && value < min) {
    return false;
  }

  if (max !== null && max !== undefined && value > max) {
    return false;
  }

  return true;
};

const normalizePropertyTypeKey = (value) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');

  if (!normalized) return '';
  if (normalized.includes('single')) return 'single-family';
  if (normalized.includes('condo')) return 'condo';
  if (normalized.includes('town')) return 'townhouse';
  if (
    normalized.includes('multi') ||
    normalized.includes('duplex') ||
    normalized.includes('triplex') ||
    normalized.includes('quadplex') ||
    normalized.includes('apartment')
  ) {
    return 'multi-family';
  }
  if (normalized.includes('mixed')) return 'mixed-use';
  if (
    normalized.includes('commercial') ||
    normalized.includes('retail') ||
    normalized.includes('office') ||
    normalized.includes('industrial')
  ) {
    return 'commercial';
  }
  if (normalized.includes('land') || normalized.includes('lot') || normalized.includes('vacant')) {
    return 'land';
  }
  return normalized === 'other' ? 'other' : 'other';
};

const resolveComparableUnitCount = (comp = {}) =>
  numberOrNull(comp?.features?.unitCount) ??
  numberOrNull(comp?.unitCount) ??
  (Array.isArray(comp?.units) ? comp.units.length : null);

const derivePropertyTypeFilter = (propertyType, unitCount) => {
  const normalizedType = normalizePropertyTypeKey(propertyType);
  const normalizedUnitCount = numberOrNull(unitCount);

  if (!normalizedType) return '';
  if (normalizedType === 'other') return '';
  if (normalizedType !== 'multi-family') return normalizedType;
  if (normalizedUnitCount !== null && normalizedUnitCount >= 5) return 'multi-family-5-plus';
  if (normalizedUnitCount !== null && normalizedUnitCount >= 2) return 'multi-family-2-4';
  return 'multi-family-any';
};

const matchesPropertyTypeFilter = (filterValue, propertyType, unitCount) => {
  const normalizedFilter = String(filterValue || '').trim();
  if (!normalizedFilter) return true;

  const normalizedType = normalizePropertyTypeKey(propertyType);
  const normalizedUnitCount = numberOrNull(unitCount);

  switch (normalizedFilter) {
    case 'multi-family-any':
      return normalizedType === 'multi-family';
    case 'multi-family-2-4':
      return (
        normalizedType === 'multi-family' &&
        normalizedUnitCount !== null &&
        normalizedUnitCount >= 2 &&
        normalizedUnitCount <= 4
      );
    case 'multi-family-5-plus':
      return normalizedType === 'multi-family' && normalizedUnitCount !== null && normalizedUnitCount >= 5;
    default:
      return normalizedType === normalizePropertyTypeKey(normalizedFilter);
  }
};

const buildLeadUpdates = (input = {}, { includeSharedFields = true } = {}) => {
  const updates = {};
  const allowedFields = includeSharedFields
    ? [...sharedLeadFields, ...stageLeadFields]
    : stageLeadFields;

  allowedFields.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(input, field)) return;

    const value = input[field];

    if (field === 'renovationPlan') {
      updates[field] = sanitizeRenovationPlan(value);
      return;
    }

    if (numericLeadFields.has(field)) {
      updates[field] = numberOrNull(value);
      return;
    }

    if (dateLeadFields.has(field)) {
      updates[field] = value ? new Date(value) : null;
      return;
    }

    if (booleanLeadFields.has(field)) {
      updates[field] = booleanFromInput(value) || false;
      return;
    }

    updates[field] = typeof value === 'string' ? value.trim() : value;
  });

  return updates;
};

const mergeLeadWithPreview = (base = {}, preview = {}) => {
  const merged = { ...base };

  Object.entries(preview).forEach(([key, value]) => {
    if (key === 'metadata' || value === undefined || value === null || value === '') return;
    const currentValue = merged[key];
    if (currentValue === undefined || currentValue === null || currentValue === '') {
      merged[key] = value;
    }
  });

  if (preview.address) {
    merged.address = preview.address;
  }

  return merged;
};

const buildPublicLeadSnapshot = (lead) => ({
  id: lead._id,
  address: lead.address,
  addressLine1: lead.addressLine1,
  addressLine2: lead.addressLine2,
  city: lead.city,
  state: lead.state,
  zipCode: lead.zipCode,
  county: lead.county,
  latitude: lead.latitude,
  longitude: lead.longitude,
  propertyType: lead.propertyType,
  bedrooms: lead.bedrooms,
  bathrooms: lead.bathrooms,
  squareFootage: lead.squareFootage,
  lotSize: lead.lotSize,
  yearBuilt: lead.yearBuilt,
  unitCount: lead.unitCount,
  sellerAskingPrice: lead.sellerAskingPrice,
  sellerName: lead.sellerName,
  sellerPhone: lead.sellerPhone,
  sellerEmail: lead.sellerEmail,
  leadSource: lead.leadSource,
  occupancyStatus: lead.occupancyStatus,
  motivation: lead.motivation,
  targetOffer: lead.targetOffer,
  arv: lead.arv,
  rehabEstimate: lead.rehabEstimate,
  nextAction: lead.nextAction,
  followUpDate: lead.followUpDate,
  listingStatus: lead.listingStatus,
  listedDate: lead.listedDate,
  daysOnMarket: lead.daysOnMarket,
  lastSalePrice: lead.lastSalePrice,
  lastSaleDate: lead.lastSaleDate,
  notes: lead.notes,
  status: lead.status,
  inPropertyWorkspace: Boolean(lead.inPropertyWorkspace),
  renovationPlan: lead.renovationPlan,
});

const cloneSerializable = (value) =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));

const buildProjectLeadSnapshot = (lead) => ({
  ...buildPublicLeadSnapshot(lead),
  compsAnalysis: cloneSerializable(lead.compsAnalysis || null),
});

const buildBudgetItemsFromLead = (lead, investmentId, userId) => {
  const sourceItems = Array.isArray(lead?.renovationPlan?.items) ? lead.renovationPlan.items : [];
  const normalizedItems = sourceItems
    .map((item, index) => {
      const name =
        typeof item?.name === 'string' && item.name.trim()
          ? item.name.trim()
          : titleCaseFromSlug(item?.category || `scope-${index + 1}`) || `Scope item ${index + 1}`;
      const budget = numberOrNull(item?.budget) ?? 0;

      if (!name && budget <= 0) {
        return null;
      }

      return {
        investment: investmentId,
        user: userId,
        category: name,
        description: typeof item?.scopeDescription === 'string' ? item.scopeDescription.trim() : '',
        sourceRenovationItemId:
          typeof item?.itemId === 'string' ? item.itemId.trim() : '',
        budgetedAmount: budget,
        originalBudgetAmount: budget,
        status: 'Not Started',
        awards: [],
      };
    })
    .filter(Boolean);

  if (normalizedItems.length > 0) {
    return normalizedItems;
  }

  const fallbackBudget = numberOrNull(lead?.rehabEstimate);
  if (fallbackBudget !== null && fallbackBudget > 0) {
    return [
      {
        investment: investmentId,
        user: userId,
        category: 'Renovation',
        description: 'Imported from the lead-level rehab estimate.',
        sourceRenovationItemId: '',
        budgetedAmount: fallbackBudget,
        originalBudgetAmount: fallbackBudget,
        status: 'Not Started',
        awards: [],
      },
    ];
  }

  return [];
};

const scoreComparable = (subject, comp, propertyTypeFilter = '') => {
  let score = 0;

  const activePropertyTypeFilter =
    propertyTypeFilter || derivePropertyTypeFilter(subject.propertyType, subject.unitCount);

  if (activePropertyTypeFilter && !matchesPropertyTypeFilter(activePropertyTypeFilter, comp.propertyType, comp.unitCount)) {
    score += 1.5;
  }

  if (subject.squareFootage && comp.squareFootage) {
    score += Math.abs(subject.squareFootage - comp.squareFootage) / Math.max(subject.squareFootage, 1);
  }

  if (subject.lotSize && comp.lotSize) {
    score += (Math.abs(subject.lotSize - comp.lotSize) / Math.max(subject.lotSize, 1)) * 0.2;
  }

  if (subject.bedrooms && comp.bedrooms) {
    score += Math.abs(subject.bedrooms - comp.bedrooms) * 0.25;
  }

  if (subject.bathrooms && comp.bathrooms) {
    score += Math.abs(subject.bathrooms - comp.bathrooms) * 0.2;
  }

  if (comp.distance !== null && comp.distance !== undefined) {
    score += comp.distance * 0.75;
  }

  if (comp.saleDate) {
    const soldAt = new Date(comp.saleDate);
    const daysAgo = (Date.now() - soldAt.valueOf()) / (1000 * 60 * 60 * 24);
    score += Math.max(daysAgo, 0) / 365;
  }

  return score;
};

const summarizeComps = (subject, comps, avmValue) => {
  const salePrices = comps.map((comp) => comp.salePrice).filter(Boolean);
  const pricePerSqftValues = comps.map((comp) => comp.pricePerSqft).filter(Boolean);
  const medianPricePerSqft = median(pricePerSqftValues);
  const soldEstimate = subject.squareFootage && medianPricePerSqft
    ? medianPricePerSqft * subject.squareFootage
    : median(salePrices);

  const estimatedValue = avmValue?.price || soldEstimate;
  const estimatedValueLow = avmValue?.priceRangeLow || (estimatedValue ? estimatedValue * 0.94 : null);
  const estimatedValueHigh = avmValue?.priceRangeHigh || (estimatedValue ? estimatedValue * 1.06 : null);
  const askingPrice = numberOrNull(subject.sellerAskingPrice);
  const askingPriceDelta = askingPrice && estimatedValue ? askingPrice - estimatedValue : null;

  return {
    saleCompCount: comps.length,
    averageSoldPrice: roundCurrency(average(salePrices)),
    medianSoldPrice: roundCurrency(median(salePrices)),
    averagePricePerSqft: average(pricePerSqftValues) ? Math.round(average(pricePerSqftValues)) : null,
    medianPricePerSqft: medianPricePerSqft ? Math.round(medianPricePerSqft) : null,
    estimatedValue: roundCurrency(estimatedValue),
    estimatedValueLow: roundCurrency(estimatedValueLow),
    estimatedValueHigh: roundCurrency(estimatedValueHigh),
    askingPrice,
    askingPriceDelta: roundCurrency(askingPriceDelta),
    recommendedOfferLow: estimatedValueLow ? roundCurrency(estimatedValueLow * 0.98) : null,
    recommendedOfferHigh: estimatedValue ? roundCurrency(estimatedValue) : null,
  };
};

const generateAiReport = async (subject, summary, comps, avmValue, analysisFilters = null) => {
  const openai = getOpenAIClient();
  if (!openai) return null;

  const payload = {
    subject: {
      address: subject.address,
      propertyType: subject.propertyType,
      unitCount: subject.unitCount,
      bedrooms: subject.bedrooms,
      bathrooms: subject.bathrooms,
      squareFootage: subject.squareFootage,
      lotSize: subject.lotSize,
      yearBuilt: subject.yearBuilt,
      sellerAskingPrice: subject.sellerAskingPrice,
      sellerName: subject.sellerName,
      leadSource: subject.leadSource,
      occupancyStatus: subject.occupancyStatus,
      motivation: subject.motivation,
      targetOffer: subject.targetOffer,
      arv: subject.arv,
      rehabEstimate: subject.rehabEstimate,
      nextAction: subject.nextAction,
      followUpDate: subject.followUpDate,
      listingStatus: subject.listingStatus,
      daysOnMarket: subject.daysOnMarket,
      lastSalePrice: subject.lastSalePrice,
      lastSaleDate: subject.lastSaleDate,
    },
    summary,
    avm: avmValue
      ? {
          price: avmValue.price,
          priceRangeLow: avmValue.priceRangeLow,
          priceRangeHigh: avmValue.priceRangeHigh,
        }
      : null,
    filtersUsed: analysisFilters,
    marketComparables: comps.map((comp) => ({
      address: comp.address,
      propertyType: comp.propertyType,
      unitCount: comp.unitCount,
      compPrice: comp.salePrice,
      compDate: comp.saleDate,
      distance: comp.distance,
      squareFootage: comp.squareFootage,
      lotSize: comp.lotSize,
      bedrooms: comp.bedrooms,
      bathrooms: comp.bathrooms,
      pricePerSqft: comp.pricePerSqft ? Math.round(comp.pricePerSqft) : null,
    })),
  };

  const systemPrompt = [
    'You are a sharp acquisitions analyst for residential real estate.',
    'Use the comparable properties and valuation summary to write a practical recommendation for a real estate investor.',
    'Keep the tone concise, specific, and decision-oriented.',
    'Return valid JSON only.',
  ].join(' ');

  const userPrompt = `
Analyze this lead and return JSON with exactly these keys:
- headline
- executiveSummary
- pricingRecommendation
- offerStrategy
- confidence
- riskFlags (array of strings)
- nextSteps (array of strings)

Confidence must be one of: Low, Medium, High.

Data:
${JSON.stringify(payload, null, 2)}
`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  return normalizeAiReport(JSON.parse(completion.choices[0].message.content));
};

// @desc    Get summary data for the leads dashboard
exports.getLeadSummary = async (req, res) => {
  try {
    const leads = await Lead.find({ user: req.user.id });
    const closedWon = leads.filter((lead) => lead.status === 'Closed - Won').length;
    const closedLost = leads.filter((lead) => lead.status === 'Closed - Lost').length;
    const totalClosed = closedWon + closedLost;

    res.json({
      totalLeads: leads.length,
      analyzingCount: leads.filter((lead) => lead.status === 'Analyzing').length,
      underContractCount: leads.filter((lead) => lead.status === 'Under Contract').length,
      closingRatio: totalClosed > 0 ? (closedWon / totalClosed) * 100 : 0,
    });
  } catch (error) {
    res.status(500).json({ msg: 'Server Error' });
  }
};

// @desc    Preview property details before creating a lead
exports.previewLeadProperty = async (req, res) => {
  try {
    const payload = buildLeadUpdates(req.body, { includeSharedFields: true });

    if (!payload.address) {
      return res.status(400).json({ msg: 'Address is required.' });
    }

    const preview = await getLeadPropertyPreview(payload);
    res.json(preview);
  } catch (error) {
    console.error('Lead preview error:', error.response?.data || error.message);
    res.status(500).json({ msg: 'Failed to preview property details.' });
  }
};

// @desc    Create a new lead
exports.createLead = async (req, res) => {
  try {
    const payload = buildLeadUpdates(req.body, { includeSharedFields: true });

    if (!payload.address) {
      return res.status(400).json({ msg: 'Address is required.' });
    }

    const preview = await getLeadPropertyPreview(payload).catch(() => null);
    const leadDraft = mergeLeadWithPreview(payload, preview || {});
    const property = await upsertCanonicalProperty({
      userId: req.user.id,
      source: leadDraft,
    });

    const newLead = new Lead({
      user: req.user.id,
      property: property?._id || null,
      ...leadDraft,
    });

    await newLead.save();
    res.status(201).json(newLead);
  } catch (error) {
    console.error('Create lead error:', error);
    res.status(500).json({ msg: 'Server Error' });
  }
};

// @desc    Get all of a user's leads
exports.getLeads = async (req, res) => {
  try {
    const leads = await Lead.find({ user: req.user.id }).sort({ createdAt: -1 });
    res.json(leads);
  } catch (error) {
    res.status(500).json({ msg: 'Server Error' });
  }
};

// @desc    Get a single lead by its ID
exports.getLeadById = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead || lead.user.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'Lead not found or user not authorized.' });
    }
    res.json(lead);
  } catch (error) {
    res.status(500).json({ msg: 'Server Error' });
  }
};

// @desc    Promote a closed-won lead into project management
exports.promoteLeadToProject = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead || lead.user.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'Lead not found or user not authorized.' });
    }

    if (lead.status !== 'Closed - Won') {
      return res.status(400).json({ msg: 'Only Closed - Won leads can move into project management.' });
    }

    const property = await upsertCanonicalProperty({
      userId: req.user.id,
      existingPropertyId: lead.property,
      source: lead,
    });

    const { project, created } = await createExecutionProjectFromLead({
      lead,
      userId: req.user.id,
      propertyId: property?._id || null,
      strategy: 'flip',
      type: 'flip',
      status: 'In Progress',
      linkLead: true,
    });

    res.status(created ? 201 : 200).json(project);
  } catch (error) {
    console.error('Promote lead to project error:', error);
    res.status(500).json({ msg: 'Server Error' });
  }
};

// @desc    Update a lead
exports.updateLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead || lead.user.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'Lead not found or user not authorized.' });
    }

    const updates = buildLeadUpdates(req.body, { includeSharedFields: true });
    let mergedUpdates = { ...updates };

    if (updates.address && updates.address !== lead.address) {
      const preview = await getLeadPropertyPreview({ ...buildPublicLeadSnapshot(lead), ...updates }).catch(() => null);
      mergedUpdates = mergeLeadWithPreview(mergedUpdates, preview || {});
    }

    Object.assign(lead, mergedUpdates);
    const property = await upsertCanonicalProperty({
      userId: req.user.id,
      existingPropertyId: lead.property,
      source: lead,
    });
    if (property) {
      lead.property = property._id;
    }
    await lead.save();
    res.json(lead);
  } catch (error) {
    console.error('Update lead error:', error);
    res.status(500).json({ msg: 'Server Error' });
  }
};

// @desc    Delete a lead
exports.deleteLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead || lead.user.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'Lead not found or user not authorized.' });
    }
    await lead.deleteOne();
    res.json({ msg: 'Lead deleted.' });
  } catch (error) {
    res.status(500).json({ msg: 'Server Error' });
  }
};

// @desc    Run the AI comps analysis for a specific lead
exports.analyzeComps = async (req, res) => {
  let analysisStep = 'initializing request';
  try {
    analysisStep = 'loading lead';
    const { id } = req.params;
    const { filters: filterPayload = {}, deal: dealPayload = {}, ...legacyFilterPayload } = req.body || {};

    const lead = await Lead.findById(id);
    if (!lead || lead.user.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'Lead not found or user not authorized.' });
    }

    analysisStep = 'checking billing access';
    const access = await getFeatureAccessState({
      user: req.user,
      featureKey: 'comps_report',
      resourceId: lead._id,
    });

    if (!access.accessGranted) {
      return res.status(402).json({
        msg: access.hasActiveSubscription
          ? 'You are out of comps credits. Buy 10 more credits to keep going.'
          : 'AI comps analysis requires available comps credits or Pro access.',
        billing: {
          featureKey: 'comps_report',
          planKey: access.planKey,
          hasActiveSubscription: access.hasActiveSubscription,
          hasUnusedPurchase: access.hasUnusedPurchase,
          monthlyIncludedLimit: access.monthlyIncludedLimit,
          monthlyIncludedUsedCount: access.monthlyIncludedUsedCount,
          monthlyIncludedRemainingCount: access.monthlyIncludedRemainingCount,
          monthlyIncludedResetsAt: access.monthlyIncludedResetsAt,
        },
      });
    }

    analysisStep = 'refreshing property preview';
    const preview = await getLeadPropertyPreview(buildPublicLeadSnapshot(lead)).catch(() => null);
    const subject = mergeLeadWithPreview(buildPublicLeadSnapshot(lead), preview || {});
    const filters = Object.keys(filterPayload || {}).length ? filterPayload : legacyFilterPayload;

    analysisStep = 'building master deal report';
    const masterReport = await buildMasterDealReport({
      subject,
      filters,
      deal: dealPayload,
    });

    const generatedAt = masterReport.generatedAt || new Date();

    analysisStep = 'saving comps analysis to lead';
    await Lead.updateOne(
      {
        _id: lead._id,
        user: req.user.id,
      },
      {
        $set: {
          compsAnalysis: buildLegacyCompsAnalysisSnapshot({
            generatedAt,
            filters: masterReport.filters,
            valuationContext: masterReport.valuationContext,
            summary: masterReport.summary,
            aiReport: masterReport.aiVerdict
              ? {
                  headline: masterReport.aiVerdict.headline,
                  executiveSummary: masterReport.aiVerdict.executiveSummary,
                  pricingRecommendation: masterReport.aiVerdict.valueTakeaway,
                  offerStrategy: masterReport.aiVerdict.dealTakeaway,
                  confidence: masterReport.aiVerdict.confidence,
                  riskFlags: masterReport.aiVerdict.riskFlags,
                  nextSteps: masterReport.aiVerdict.nextSteps,
                }
              : null,
            comps: masterReport.recentComps,
          }),
        },
      }
    );

    if (
      access.accessSource === 'trial_credits' ||
      access.accessSource === 'subscription_included' ||
      access.accessSource === 'purchased_credits'
    ) {
      analysisStep = 'recording feature usage';
      try {
        await consumeOneCompsCredit({
          userId: req.user.id,
          metadata: {
            featureKey: 'comps_report',
            resourceType: 'lead',
            resourceId: lead._id.toString(),
          },
        });
        await recordFeatureUsage({
          userId: req.user.id,
          featureKey: 'comps_report',
          resourceType: 'lead',
          resourceId: lead._id,
          source: access.accessSource,
          metadata: {
            ...masterReport.filters,
          },
        });
      } catch (usageError) {
        console.error(
          'Comps analysis usage logging failed:',
          usageError.response?.data || usageError.message || usageError
        );
      }
    }

    if (access.accessSource === 'one_time_purchase' && access.hasUnusedPurchase) {
      analysisStep = 'consuming one-time report purchase';
      try {
        await consumeMatchingPurchase({
          userId: req.user.id,
          kind: 'comps_report',
          resourceId: lead._id,
        });
      } catch (purchaseError) {
        console.error(
          'Comps analysis purchase consumption failed:',
          purchaseError.response?.data || purchaseError.message || purchaseError
        );
      }
    }

    analysisStep = 'returning response';
    res.status(200).json(masterReport);
  } catch (error) {
    const detail =
      error?.response?.data?.msg ||
      error?.response?.data?.message ||
      error?.message ||
      'Unexpected comps analysis error.';
    console.error(
      `Error analyzing lead comps during ${analysisStep}:`,
      error.response?.data || error.stack || error.message || error
    );
    res.status(500).json({
      msg: 'Server error during comps analysis.',
      step: analysisStep,
      detail,
    });
  }
};
