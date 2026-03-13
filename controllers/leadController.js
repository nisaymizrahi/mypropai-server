const Lead = require('../models/Lead');
const OpenAI = require('openai');
const {
  fetchRentCastValueEstimate,
  getLeadPropertyPreview,
  numberOrNull,
} = require('../utils/leadPropertyService');
const { consumeMatchingPurchase, getFeatureAccessState } = require('../utils/billingAccess');

const getOpenAIClient = () => {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
};

const allowedLeadFields = [
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
];

const numericLeadFields = new Set([
  'latitude',
  'longitude',
  'bedrooms',
  'bathrooms',
  'squareFootage',
  'lotSize',
  'yearBuilt',
  'sellerAskingPrice',
  'targetOffer',
  'arv',
  'rehabEstimate',
  'daysOnMarket',
  'lastSalePrice',
]);

const dateLeadFields = new Set(['listedDate', 'lastSaleDate', 'followUpDate']);

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
  return Math.round(value / 1000) * 1000;
};

const buildLeadUpdates = (input = {}) => {
  const updates = {};

  allowedLeadFields.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(input, field)) return;

    const value = input[field];

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
});

const scoreComparable = (subject, comp) => {
  let score = 0;

  if (subject.propertyType && comp.propertyType && subject.propertyType !== comp.propertyType) {
    score += 1.5;
  }

  if (subject.squareFootage && comp.squareFootage) {
    score += Math.abs(subject.squareFootage - comp.squareFootage) / Math.max(subject.squareFootage, 1);
  }

  if (subject.bedrooms && comp.bedrooms) {
    score += Math.abs(subject.bedrooms - comp.bedrooms) * 0.25;
  }

  if (subject.bathrooms && comp.bathrooms) {
    score += Math.abs(subject.bathrooms - comp.bathrooms) * 0.2;
  }

  if (comp.distance) {
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

const generateAiReport = async (subject, summary, comps, avmValue) => {
  const openai = getOpenAIClient();
  if (!openai) return null;

  const payload = {
    subject: {
      address: subject.address,
      propertyType: subject.propertyType,
      bedrooms: subject.bedrooms,
      bathrooms: subject.bathrooms,
      squareFootage: subject.squareFootage,
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
    marketComparables: comps.map((comp) => ({
      address: comp.address,
      propertyType: comp.propertyType,
      compPrice: comp.salePrice,
      compDate: comp.saleDate,
      distance: comp.distance,
      squareFootage: comp.squareFootage,
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

  return JSON.parse(completion.choices[0].message.content);
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
    const payload = buildLeadUpdates(req.body);

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
    const payload = buildLeadUpdates(req.body);

    if (!payload.address) {
      return res.status(400).json({ msg: 'Address is required.' });
    }

    const preview = await getLeadPropertyPreview(payload).catch(() => null);
    const newLead = new Lead({
      user: req.user.id,
      ...mergeLeadWithPreview(payload, preview || {}),
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

// @desc    Update a lead
exports.updateLead = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead || lead.user.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'Lead not found or user not authorized.' });
    }

    const updates = buildLeadUpdates(req.body);
    let mergedUpdates = { ...updates };

    if (updates.address && updates.address !== lead.address) {
      const preview = await getLeadPropertyPreview({ ...buildPublicLeadSnapshot(lead), ...updates }).catch(() => null);
      mergedUpdates = mergeLeadWithPreview(mergedUpdates, preview || {});
    }

    Object.assign(lead, mergedUpdates);
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
  try {
    const { id } = req.params;
    const { radius, saleDateMonths, maxComps } = req.body;

    const lead = await Lead.findById(id);
    if (!lead || lead.user.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'Lead not found or user not authorized.' });
    }

    const access = await getFeatureAccessState({
      user: req.user,
      featureKey: 'comps_report',
      resourceId: lead._id,
    });

    if (!access.accessGranted) {
      return res.status(402).json({
        msg: 'AI comps analysis requires an active Pro subscription or a one-time comps report purchase for this lead.',
        billing: {
          featureKey: 'comps_report',
          planKey: access.planKey,
          hasActiveSubscription: access.hasActiveSubscription,
          hasUnusedPurchase: access.hasUnusedPurchase,
        },
      });
    }

    const preview = await getLeadPropertyPreview(buildPublicLeadSnapshot(lead)).catch(() => null);
    const subject = mergeLeadWithPreview(buildPublicLeadSnapshot(lead), preview || {});

    if (!subject.latitude || !subject.longitude) {
      return res.status(400).json({ msg: 'This lead is missing location data. Re-save the address to refresh property details.' });
    }

    const avmValue = await fetchRentCastValueEstimate({
      ...subject,
      compCount: Math.min(Math.max(numberOrNull(maxComps) || 8, 6), 10),
    }).catch((error) => {
      console.error('RentCast AVM lookup failed:', error.response?.data || error.message);
      return null;
    });

    const compCutoff = new Date();
    compCutoff.setMonth(compCutoff.getMonth() - (numberOrNull(saleDateMonths) || 6));

    const marketComps = (avmValue?.comparables || [])
      .map((comp) => ({
        address: comp.formattedAddress,
        propertyType: comp.propertyType,
        salePrice: numberOrNull(comp.price),
        saleDate: comp.listedDate || comp.lastSeenDate || null,
        distance: numberOrNull(comp.distance),
        bedrooms: numberOrNull(comp.bedrooms),
        bathrooms: numberOrNull(comp.bathrooms),
        squareFootage: numberOrNull(comp.squareFootage),
        yearBuilt: numberOrNull(comp.yearBuilt),
        pricePerSqft: comp.price && comp.squareFootage ? comp.price / comp.squareFootage : null,
      }))
      .filter((comp) => {
        if (!comp.salePrice) return false;
        if (!comp.saleDate) return true;
        const compDate = new Date(comp.saleDate);
        return Number.isFinite(compDate.valueOf()) ? compDate >= compCutoff : true;
      });

    if (!marketComps.length) {
      return res.status(404).json({ msg: 'No comparable properties were found for this lead.' });
    }

    const rankedComps = marketComps
      .map((comp) => ({ ...comp, relevanceScore: scoreComparable(subject, comp) }))
      .sort((a, b) => a.relevanceScore - b.relevanceScore)
      .slice(0, Math.min(Math.max(numberOrNull(maxComps) || 8, 5), 12))
      .map(({ relevanceScore, ...comp }) => comp);

    const summary = summarizeComps(subject, rankedComps, avmValue);

    const aiReport = await generateAiReport(subject, summary, rankedComps, avmValue).catch((error) => {
      console.error('Lead AI report generation failed:', error.response?.data || error.message);
      return null;
    });

    Object.assign(lead, mergeLeadWithPreview({}, preview || {}));
    lead.compsAnalysis = {
      generatedAt: new Date(),
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
        yearBuilt: comp.yearBuilt,
      })),
    };

    await lead.save();

    if (!access.hasActiveSubscription && access.hasUnusedPurchase) {
      await consumeMatchingPurchase({
        userId: req.user.id,
        kind: 'comps_report',
        resourceId: lead._id,
      });
    }

    res.status(200).json({
      subject,
      summary,
      comps: rankedComps,
      ai: aiReport,
      generatedAt: lead.compsAnalysis.generatedAt,
    });
  } catch (error) {
    console.error('Error analyzing lead comps:', error.response?.data || error.message);
    res.status(500).json({ msg: 'Server error during comps analysis.' });
  }
};
