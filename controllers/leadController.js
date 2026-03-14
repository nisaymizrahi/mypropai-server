const Lead = require('../models/Lead');
const Investment = require('../models/Investment');
const BudgetItem = require('../models/BudgetItem');
const OpenAI = require('openai');
const {
  fetchRentCastValueEstimate,
  getLeadPropertyPreview,
  numberOrNull,
} = require('../utils/leadPropertyService');
const { consumeMatchingPurchase, getFeatureAccessState, recordFeatureUsage } = require('../utils/billingAccess');
const { upsertCanonicalProperty } = require('../utils/propertyRecordService');

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

    let existingProject = null;
    if (lead.projectManagement) {
      existingProject = await Investment.findOne({
        _id: lead.projectManagement,
        user: req.user.id,
      })
        .populate('property')
        .populate('sourceLead', 'address status projectManagement');
    }

    if (!existingProject) {
      existingProject = await Investment.findOne({
        user: req.user.id,
        sourceLead: lead._id,
      })
        .populate('property')
        .populate('sourceLead', 'address status projectManagement');
    }

    if (existingProject) {
      if (!lead.projectManagement) {
        lead.projectManagement = existingProject._id;
        await lead.save();
      }

      return res.json(existingProject);
    }

    const property = await upsertCanonicalProperty({
      userId: req.user.id,
      existingPropertyId: lead.property,
      source: lead,
    });

    const project = await Investment.create({
      user: req.user.id,
      property: property?._id || null,
      sourceLead: lead._id,
      sourceLeadSnapshot: buildProjectLeadSnapshot(lead),
      address: lead.address,
      strategy: 'flip',
      type: 'flip',
      status: 'In Progress',
      purchasePrice: numberOrNull(lead.targetOffer) ?? numberOrNull(lead.sellerAskingPrice) ?? 0,
      arv: numberOrNull(lead.arv) ?? 0,
      propertyType: lead.propertyType || '',
      lotSize: numberOrNull(lead.lotSize) ?? undefined,
      sqft: numberOrNull(lead.squareFootage) ?? undefined,
      bedrooms: numberOrNull(lead.bedrooms) ?? undefined,
      bathrooms: numberOrNull(lead.bathrooms) ?? undefined,
      yearBuilt: numberOrNull(lead.yearBuilt) ?? undefined,
      unitCount: numberOrNull(lead.unitCount) ?? undefined,
    });

    const budgetItems = buildBudgetItemsFromLead(lead, project._id, req.user.id);
    if (budgetItems.length > 0) {
      await BudgetItem.insertMany(budgetItems);
    }

    lead.projectManagement = project._id;
    if (property && String(lead.property || '') !== String(property._id)) {
      lead.property = property._id;
    }
    await lead.save();

    const populatedProject = await Investment.findById(project._id)
      .populate('property')
      .populate('sourceLead', 'address status projectManagement');

    res.status(201).json(populatedProject);
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
    const {
      radius,
      saleDateMonths,
      maxComps,
      propertyType: requestedPropertyTypeRaw,
      minSquareFootage,
      maxSquareFootage,
      minLotSize,
      maxLotSize,
    } = req.body;

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
          ? 'You have used all 10 included Pro comps reports for this month. Buy this report one time to continue.'
          : 'AI comps analysis requires Pro or a one-time comps report purchase for this lead.',
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
    const requestedRadius = clamp(numberOrNull(radius) ?? 1, 0.25, 10);
    const requestedSaleDateMonths = clamp(numberOrNull(saleDateMonths) ?? 6, 1, 60);
    const requestedMaxComps = clamp(numberOrNull(maxComps) ?? 8, 5, 12);
    const requestedPropertyType = String(requestedPropertyTypeRaw || '').trim();
    const squareFootageInputs = [
      numberOrNull(minSquareFootage),
      numberOrNull(maxSquareFootage),
    ];
    const lotSizeInputs = [numberOrNull(minLotSize), numberOrNull(maxLotSize)];
    const requestedMinSquareFootage =
      squareFootageInputs[0] !== null && squareFootageInputs[1] !== null
        ? Math.min(squareFootageInputs[0], squareFootageInputs[1])
        : squareFootageInputs[0];
    const requestedMaxSquareFootage =
      squareFootageInputs[0] !== null && squareFootageInputs[1] !== null
        ? Math.max(squareFootageInputs[0], squareFootageInputs[1])
        : squareFootageInputs[1];
    const requestedMinLotSize =
      lotSizeInputs[0] !== null && lotSizeInputs[1] !== null
        ? Math.min(lotSizeInputs[0], lotSizeInputs[1])
        : lotSizeInputs[0];
    const requestedMaxLotSize =
      lotSizeInputs[0] !== null && lotSizeInputs[1] !== null
        ? Math.max(lotSizeInputs[0], lotSizeInputs[1])
        : lotSizeInputs[1];
    const analysisFilters = {
      radius: requestedRadius,
      saleDateMonths: requestedSaleDateMonths,
      maxComps: requestedMaxComps,
      propertyType: requestedPropertyType,
      minSquareFootage: requestedMinSquareFootage,
      maxSquareFootage: requestedMaxSquareFootage,
      minLotSize: requestedMinLotSize,
      maxLotSize: requestedMaxLotSize,
    };
    const activePropertyTypeFilter =
      requestedPropertyType || derivePropertyTypeFilter(subject.propertyType, subject.unitCount);

    analysisStep = 'fetching AVM comparables';
    const avmValue = await fetchRentCastValueEstimate({
      ...subject,
      compCount: requestedMaxComps,
    }).catch((error) => {
      console.error('RentCast AVM lookup failed:', error.response?.data || error.message);
      return null;
    });

    analysisStep = 'filtering comparable properties';
    const compCutoff = new Date();
    compCutoff.setMonth(compCutoff.getMonth() - requestedSaleDateMonths);

    const marketComps = (Array.isArray(avmValue?.comparables) ? avmValue.comparables : [])
      .filter((comp) => comp && typeof comp === 'object' && !Array.isArray(comp))
      .map((comp) => {
        const saleDate = toValidDateOrNull(
          comp.lastSaleDate ||
            comp.saleDate ||
            comp.listedDate ||
            comp.lastSeenDate ||
            comp.removedDate ||
            null
        );

        return {
          address:
            comp.formattedAddress ||
            [comp.addressLine1, comp.addressLine2, comp.city, comp.state, comp.zipCode]
              .filter(Boolean)
              .join(', '),
          propertyType: comp.propertyType,
          unitCount: resolveComparableUnitCount(comp),
          salePrice: numberOrNull(comp.price),
          saleDate,
          distance: numberOrNull(comp.distance),
          bedrooms: numberOrNull(comp.bedrooms),
          bathrooms: numberOrNull(comp.bathrooms),
          squareFootage: numberOrNull(comp.squareFootage),
          lotSize: numberOrNull(comp.lotSize),
          yearBuilt: numberOrNull(comp.yearBuilt),
          pricePerSqft: comp.price && comp.squareFootage ? comp.price / comp.squareFootage : null,
        };
      })
      .filter((comp) => {
        if (!comp.salePrice) return false;
        if (!comp.saleDate) return true;
        return comp.saleDate >= compCutoff;
      })
      .filter(
        (comp) =>
          (comp.distance === null || comp.distance === undefined || comp.distance <= requestedRadius) &&
          matchesPropertyTypeFilter(requestedPropertyType, comp.propertyType, comp.unitCount) &&
          matchesNumericRange(
            comp.squareFootage,
            requestedMinSquareFootage,
            requestedMaxSquareFootage
          ) &&
          matchesNumericRange(comp.lotSize, requestedMinLotSize, requestedMaxLotSize)
      );

    if (!marketComps.length) {
      return res.status(200).json({
        noResults: true,
        msg: 'No comparable properties matched the selected filters. Try widening the radius or relaxing the size filters.',
        subject,
        summary: null,
        comps: [],
        ai: null,
        filters: analysisFilters,
        generatedAt: null,
      });
    }

    analysisStep = 'ranking comparable properties';
    const rankedComps = marketComps
      .map((comp) => ({
        ...comp,
        relevanceScore: scoreComparable(subject, comp, activePropertyTypeFilter),
      }))
      .sort((a, b) => a.relevanceScore - b.relevanceScore)
      .slice(0, requestedMaxComps)
      .map(({ relevanceScore, ...comp }) => comp);

    analysisStep = 'summarizing comparable properties';
    const summary = summarizeComps(subject, rankedComps, avmValue);

    analysisStep = 'generating AI report';
    const aiReport = await generateAiReport(
      subject,
      summary,
      rankedComps,
      avmValue,
      analysisFilters
    ).catch((error) => {
      console.error('Lead AI report generation failed:', error.response?.data || error.message);
      return null;
    });

    analysisStep = 'saving comps analysis to lead';
    const generatedAt = new Date();
    const nextCompsAnalysis = {
      generatedAt,
      filters: analysisFilters,
      estimatedValue: summary.estimatedValue,
      estimatedValueLow: summary.estimatedValueLow,
      estimatedValueHigh: summary.estimatedValueHigh,
      averageSoldPrice: summary.averageSoldPrice,
      medianSoldPrice: summary.medianSoldPrice,
      averagePricePerSqft: summary.averagePricePerSqft,
      medianPricePerSqft: summary.medianPricePerSqft,
      saleCompCount: summary.saleCompCount,
      askingPriceDelta: summary.askingPriceDelta,
      recommendedOfferLow: summary.recommendedOfferLow,
      recommendedOfferHigh: summary.recommendedOfferHigh,
      report: aiReport || undefined,
      recentComps: rankedComps.map((comp) => ({
        address: comp.address,
        propertyType: comp.propertyType,
        salePrice: comp.salePrice,
        saleDate: comp.saleDate,
        pricePerSqft: comp.pricePerSqft ? Math.round(comp.pricePerSqft) : null,
        distance: comp.distance,
        bedrooms: comp.bedrooms,
        bathrooms: comp.bathrooms,
        squareFootage: comp.squareFootage,
        lotSize: comp.lotSize,
        unitCount: comp.unitCount,
        yearBuilt: comp.yearBuilt,
      })),
    };

    await Lead.updateOne(
      {
        _id: lead._id,
        user: req.user.id,
      },
      {
        $set: {
          compsAnalysis: nextCompsAnalysis,
        },
      }
    );

    if (access.accessSource === 'subscription_included') {
      analysisStep = 'recording feature usage';
      try {
        await recordFeatureUsage({
          userId: req.user.id,
          featureKey: 'comps_report',
          resourceType: 'lead',
          resourceId: lead._id,
          source: 'subscription_included',
          metadata: {
            maxComps: requestedMaxComps,
            radius: requestedRadius,
            saleDateMonths: requestedSaleDateMonths,
            propertyType: requestedPropertyType,
            minSquareFootage: requestedMinSquareFootage,
            maxSquareFootage: requestedMaxSquareFootage,
            minLotSize: requestedMinLotSize,
            maxLotSize: requestedMaxLotSize,
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
    res.status(200).json({
      subject,
      summary,
      comps: rankedComps,
      ai: aiReport,
      filters: analysisFilters,
      generatedAt,
    });
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
