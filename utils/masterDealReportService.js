const OpenAI = require('openai');
const {
  fetchRentCastMarketStats,
  fetchRentCastProperty,
  fetchRentCastRentEstimate,
  fetchRentCastRentalListing,
  fetchRentCastSaleListing,
  formatPropertyPreview,
  numberOrNull,
  searchRentCastProperties,
  searchRentCastSaleListings,
} = require('./leadPropertyService');
const { buildCompsAnalysis } = require('./compsAnalysisService');

const getOpenAIClient = () => {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const toArray = (value) => (Array.isArray(value) ? value : []);
const pickFirst = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== '');

const average = (values = []) => {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const median = (values = []) => {
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

const roundNumber = (value, precision = 1) => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const factor = 10 ** precision;
  return Math.round(parsed * factor) / factor;
};

const stringifyAiValue = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';

  if (Array.isArray(value)) {
    return value.map((item) => stringifyAiValue(item)).filter(Boolean).join('\n');
  }

  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, entryValue]) => {
        const rendered = stringifyAiValue(entryValue);
        if (!rendered) return '';
        return `${key}: ${rendered}`;
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

const normalizeConfidence = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'low') return 'Low';
  if (normalized === 'medium') return 'Medium';
  if (normalized === 'high') return 'High';
  return stringifyAiValue(value);
};

const normalizeVerdict = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (['strong', 'good', 'favorable'].includes(normalized)) return 'Strong';
  if (['mixed', 'average', 'watch'].includes(normalized)) return 'Mixed';
  if (['risky', 'weak', 'poor'].includes(normalized)) return 'Risky';
  return stringifyAiValue(value) || 'Mixed';
};

const normalizeCompSupport = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (['strong', 'high'].includes(normalized)) return 'Strong';
  if (['moderate', 'medium', 'average'].includes(normalized)) return 'Moderate';
  if (['weak', 'low'].includes(normalized)) return 'Weak';
  return stringifyAiValue(value) || 'Moderate';
};

const normalizeMasterVerdict = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return {
    headline: stringifyAiValue(value.headline),
    verdict: normalizeVerdict(value.verdict),
    executiveSummary: stringifyAiValue(value.executiveSummary),
    compSupport: normalizeCompSupport(value.compSupport),
    valueTakeaway: stringifyAiValue(value.valueTakeaway),
    dealTakeaway: stringifyAiValue(value.dealTakeaway),
    upsideFactors: normalizeAiList(value.upsideFactors),
    riskFlags: normalizeAiList(value.riskFlags),
    keyAssumptions: normalizeAiList(value.keyAssumptions),
    nextSteps: normalizeAiList(value.nextSteps),
    confidence: normalizeConfidence(value.confidence),
  };
};

const normalizeSubjectInput = (input = {}) => ({
  address: String(input.address || '').trim(),
  addressLine1: String(input.addressLine1 || '').trim(),
  addressLine2: String(input.addressLine2 || '').trim(),
  city: String(input.city || '').trim(),
  state: String(input.state || '').trim(),
  zipCode: String(input.zipCode || '').trim(),
  county: String(input.county || '').trim(),
  latitude: numberOrNull(input.latitude),
  longitude: numberOrNull(input.longitude),
  propertyType: String(input.propertyType || '').trim(),
  bedrooms: numberOrNull(input.bedrooms),
  bathrooms: numberOrNull(input.bathrooms),
  squareFootage: numberOrNull(input.squareFootage ?? input.sqft),
  lotSize: numberOrNull(input.lotSize),
  yearBuilt: numberOrNull(input.yearBuilt),
  unitCount: numberOrNull(input.unitCount),
  sellerAskingPrice: numberOrNull(input.sellerAskingPrice ?? input.askingPrice),
  rehabEstimate: numberOrNull(input.rehabEstimate),
  targetOffer: numberOrNull(input.targetOffer),
  arv: numberOrNull(input.arv),
  listingStatus: String(input.listingStatus || '').trim(),
  listedDate: input.listedDate || null,
  daysOnMarket: numberOrNull(input.daysOnMarket),
  lastSalePrice: numberOrNull(input.lastSalePrice),
  lastSaleDate: input.lastSaleDate || null,
});

const normalizeCompFilters = (input = {}, subject = {}) => {
  const subjectBedrooms = numberOrNull(subject.bedrooms);
  const subjectBathrooms = numberOrNull(subject.bathrooms);

  return {
    radius: clamp(numberOrNull(input.radius) ?? 1, 0.25, 10),
    saleDateMonths: clamp(numberOrNull(input.saleDateMonths) ?? 6, 1, 60),
    maxComps: clamp(numberOrNull(input.maxComps) ?? 8, 5, 12),
    propertyType: String(input.propertyType || '').trim(),
    minBedrooms:
      numberOrNull(input.minBedrooms) ??
      (subjectBedrooms !== null ? Math.max(0, Math.floor(subjectBedrooms - 1)) : null),
    maxBedrooms:
      numberOrNull(input.maxBedrooms) ??
      (subjectBedrooms !== null ? Math.ceil(subjectBedrooms + 1) : null),
    minBathrooms:
      numberOrNull(input.minBathrooms) ??
      (subjectBathrooms !== null ? Math.max(0, Math.floor(subjectBathrooms - 1)) : null),
    maxBathrooms:
      numberOrNull(input.maxBathrooms) ??
      (subjectBathrooms !== null ? Math.ceil(subjectBathrooms + 1) : null),
    minSquareFootage: numberOrNull(input.minSquareFootage),
    maxSquareFootage: numberOrNull(input.maxSquareFootage),
    minLotSize: numberOrNull(input.minLotSize),
    maxLotSize: numberOrNull(input.maxLotSize),
    minYearBuilt: numberOrNull(input.minYearBuilt),
    maxYearBuilt: numberOrNull(input.maxYearBuilt),
  };
};

const normalizeStrategy = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (['flip', 'hold', 'wholetail', 'rental'].includes(normalized)) return normalized;
  return 'flip';
};

const getStrategyDefaults = (strategy) => {
  switch (strategy) {
    case 'hold':
    case 'rental':
      return {
        holdingPeriodMonths: 6,
        acquisitionClosingCostPercent: 2,
        sellingCostPercent: 0,
        interestRatePercent: 8.5,
        financingPointsPercent: 1.5,
        loanToCostPercent: 75,
        monthlyInsurance: 150,
        monthlyUtilities: 120,
        monthlyMaintenance: 100,
        contingencyPercent: 5,
        desiredProfitMarginPercent: 0,
      };
    case 'wholetail':
      return {
        holdingPeriodMonths: 4,
        acquisitionClosingCostPercent: 2,
        sellingCostPercent: 7,
        interestRatePercent: 10,
        financingPointsPercent: 2,
        loanToCostPercent: 85,
        monthlyInsurance: 140,
        monthlyUtilities: 120,
        monthlyMaintenance: 100,
        contingencyPercent: 5,
        desiredProfitMarginPercent: 12,
      };
    case 'flip':
    default:
      return {
        holdingPeriodMonths: 6,
        acquisitionClosingCostPercent: 2,
        sellingCostPercent: 8,
        interestRatePercent: 10,
        financingPointsPercent: 2,
        loanToCostPercent: 85,
        monthlyInsurance: 150,
        monthlyUtilities: 150,
        monthlyMaintenance: 120,
        contingencyPercent: 7,
        desiredProfitMarginPercent: 15,
      };
  }
};

const normalizeDealInputs = (input = {}, subject = {}, latestTax = null) => {
  const strategy = normalizeStrategy(input.strategy);
  const defaults = getStrategyDefaults(strategy);
  const askingPrice = numberOrNull(input.askingPrice) ?? numberOrNull(subject.sellerAskingPrice);
  const rehabEstimate = numberOrNull(input.rehabEstimate) ?? numberOrNull(subject.rehabEstimate) ?? 0;
  const annualTaxes =
    numberOrNull(input.annualTaxes) ??
    numberOrNull(latestTax?.taxAmount) ??
    (askingPrice ? roundNumber(askingPrice * 0.012, 0) : null);

  return {
    strategy,
    askingPrice,
    rehabEstimate,
    holdingPeriodMonths: clamp(
      numberOrNull(input.holdingPeriodMonths) ?? defaults.holdingPeriodMonths,
      1,
      60
    ),
    acquisitionClosingCostPercent: clamp(
      numberOrNull(input.acquisitionClosingCostPercent ?? input.closingCostsPercent) ??
        defaults.acquisitionClosingCostPercent,
      0,
      15
    ),
    sellingCostPercent: clamp(
      numberOrNull(input.sellingCostPercent) ?? defaults.sellingCostPercent,
      0,
      20
    ),
    interestRatePercent: clamp(
      numberOrNull(input.interestRatePercent ?? input.financingCostPercent) ??
        defaults.interestRatePercent,
      0,
      25
    ),
    financingPointsPercent: clamp(
      numberOrNull(input.financingPointsPercent ?? input.loanPointsPercent) ??
        defaults.financingPointsPercent,
      0,
      10
    ),
    loanToCostPercent: clamp(
      numberOrNull(input.loanToCostPercent) ?? defaults.loanToCostPercent,
      0,
      100
    ),
    annualTaxes,
    monthlyInsurance:
      numberOrNull(input.monthlyInsurance) ?? defaults.monthlyInsurance,
    monthlyUtilities:
      numberOrNull(input.monthlyUtilities) ?? defaults.monthlyUtilities,
    monthlyMaintenance:
      numberOrNull(input.monthlyMaintenance) ?? defaults.monthlyMaintenance,
    contingencyPercent: clamp(
      numberOrNull(input.contingencyPercent) ?? defaults.contingencyPercent,
      0,
      25
    ),
    desiredProfitMarginPercent: clamp(
      numberOrNull(input.desiredProfitMarginPercent) ?? defaults.desiredProfitMarginPercent,
      0,
      50
    ),
    notes: String(input.notes || input.dealNotes || '').trim(),
  };
};

const resolveCompDistance = (subject, comp = {}) => {
  const directDistance = numberOrNull(comp.distance);
  if (directDistance !== null) return directDistance;

  const subjectLat = numberOrNull(subject.latitude);
  const subjectLng = numberOrNull(subject.longitude);
  const compLat = numberOrNull(comp.latitude);
  const compLng = numberOrNull(comp.longitude);

  if (subjectLat === null || subjectLng === null || compLat === null || compLng === null) {
    return null;
  }

  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const latDelta = toRadians(compLat - subjectLat);
  const lngDelta = toRadians(compLng - subjectLng);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(toRadians(subjectLat)) *
      Math.cos(toRadians(compLat)) *
      Math.sin(lngDelta / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMiles * c;
};

const scorePropertySimilarity = (subject = {}, comp = {}, targetRadius = 1) => {
  let score = 100;
  const reasons = [];
  const subjectSqft = numberOrNull(subject.squareFootage);
  const subjectLot = numberOrNull(subject.lotSize);
  const subjectBeds = numberOrNull(subject.bedrooms);
  const subjectBaths = numberOrNull(subject.bathrooms);
  const subjectYearBuilt = numberOrNull(subject.yearBuilt);
  const compDistance = resolveCompDistance(subject, comp);

  if (compDistance !== null) {
    const penalty = Math.min((compDistance / Math.max(targetRadius, 0.25)) * 18, 18);
    score -= penalty;
    reasons.push(`${roundNumber(compDistance, 2)} mi away`);
  }

  if (subjectSqft && numberOrNull(comp.squareFootage)) {
    const deltaRatio = Math.abs(subjectSqft - comp.squareFootage) / Math.max(subjectSqft, 1);
    score -= Math.min(deltaRatio * 28, 22);
    reasons.push(`${Math.round(deltaRatio * 100)}% sqft delta`);
  }

  if (subjectLot && numberOrNull(comp.lotSize)) {
    const deltaRatio = Math.abs(subjectLot - comp.lotSize) / Math.max(subjectLot, 1);
    score -= Math.min(deltaRatio * 12, 8);
  }

  if (subjectBeds !== null && numberOrNull(comp.bedrooms) !== null) {
    score -= Math.min(Math.abs(subjectBeds - comp.bedrooms) * 7, 14);
  }

  if (subjectBaths !== null && numberOrNull(comp.bathrooms) !== null) {
    score -= Math.min(Math.abs(subjectBaths - comp.bathrooms) * 6, 12);
  }

  if (
    subject.propertyType &&
    comp.propertyType &&
    String(subject.propertyType).trim().toLowerCase() !==
      String(comp.propertyType).trim().toLowerCase()
  ) {
    score -= 12;
  }

  if (subjectYearBuilt && numberOrNull(comp.yearBuilt)) {
    score -= Math.min(Math.abs(subjectYearBuilt - comp.yearBuilt) / 6, 8);
  }

  if (comp.correlation) {
    score += comp.correlation * 4;
    reasons.push(`AVM correlation ${roundNumber(comp.correlation, 3)}`);
  }

  if (comp.saleDate || comp.listedDate) {
    const rawDate = comp.saleDate || comp.listedDate;
    const timestamp = new Date(rawDate).valueOf();
    if (Number.isFinite(timestamp)) {
      const daysAgo = Math.max(0, (Date.now() - timestamp) / (1000 * 60 * 60 * 24));
      score -= Math.min(daysAgo / 90, 10);
      reasons.push(`${Math.round(daysAgo)} days old`);
    }
  }

  return {
    score: Math.max(1, Math.min(100, roundNumber(score, 1))),
    reasons: reasons.filter(Boolean).slice(0, 3),
  };
};

const normalizeListingSummary = (listing = {}) => {
  if (!listing) return null;

  return {
    status: listing?.status || '',
    price: numberOrNull(listing?.price),
    listedDate: listing?.listedDate || null,
    removedDate: listing?.removedDate || null,
    daysOnMarket: numberOrNull(listing?.daysOnMarket),
    listingType: listing?.listingType || '',
    mlsName: listing?.mlsName || '',
    mlsNumber: listing?.mlsNumber || '',
    agentName:
      pickFirst(
        listing?.listingAgent?.name,
        [listing?.listingAgent?.firstName, listing?.listingAgent?.lastName]
          .filter(Boolean)
          .join(' ')
          .trim()
      ) || '',
    officeName: pickFirst(listing?.listingOffice?.name, listing?.listingOfficeName) || '',
    builderName: pickFirst(listing?.builder?.name, listing?.builderName) || '',
    hoaFee: pickFirst(numberOrNull(listing?.hoa?.fee), numberOrNull(listing?.hoaFee)),
  };
};

const buildFullAddress = (parts = {}) =>
  [
    pickFirst(parts.formattedAddress, parts.address, parts.addressLine1, parts.mailingAddressLine1),
    parts.addressLine2 || parts.mailingAddressLine2,
    parts.city,
    parts.state,
    parts.zipCode,
  ]
    .filter(Boolean)
    .join(', ');

const normalizeOwnerSummary = (property = {}) => {
  const owner = property?.owner || {};
  return {
    name:
      pickFirst(
        owner?.name,
        owner?.fullName,
        [owner?.firstName, owner?.lastName].filter(Boolean).join(' ').trim(),
        property?.ownerName
      ) || '',
    type: pickFirst(owner?.type, property?.ownerType) || '',
    mailingAddress:
      pickFirst(
        typeof owner?.mailingAddress === 'string' ? owner.mailingAddress : '',
        buildFullAddress(owner?.mailingAddress || {}),
        buildFullAddress(owner),
        buildFullAddress(property?.owner || {})
      ) || '',
    occupied: pickFirst(owner?.occupied, property?.ownerOccupied) ?? null,
  };
};

const normalizeTaxAssessment = (assessment = {}) => ({
  year: pickFirst(numberOrNull(assessment?.year), numberOrNull(assessment?.taxYear)),
  assessedValue: pickFirst(
    numberOrNull(assessment?.assessedValue),
    numberOrNull(assessment?.value),
    numberOrNull(assessment?.totalValue)
  ),
  landValue: pickFirst(numberOrNull(assessment?.landValue), numberOrNull(assessment?.land)),
  improvementValue: pickFirst(
    numberOrNull(assessment?.improvementValue),
    numberOrNull(assessment?.improvementsValue),
    numberOrNull(assessment?.improvement)
  ),
  taxAmount: pickFirst(numberOrNull(assessment?.taxAmount), numberOrNull(assessment?.amount)),
});

const normalizePropertyHistoryItem = (item = {}) => ({
  date: pickFirst(item?.eventDate, item?.date, item?.saleDate, item?.recordingDate) || null,
  eventType: pickFirst(item?.eventType, item?.type, item?.event) || '',
  price: pickFirst(numberOrNull(item?.price), numberOrNull(item?.salePrice), numberOrNull(item?.amount)),
  buyerName: pickFirst(item?.buyerName, item?.buyer) || '',
  sellerName: pickFirst(item?.sellerName, item?.seller) || '',
});

const buildFeatureEntries = (property = {}) => {
  const features = property?.features || {};
  const candidates = [
    ['Stories', pickFirst(numberOrNull(features?.stories), numberOrNull(property?.stories))],
    ['Garage Spaces', pickFirst(numberOrNull(features?.garageSpaces), numberOrNull(property?.garageSpaces))],
    ['Pool', pickFirst(features?.pool, property?.pool)],
    ['Fireplace', pickFirst(features?.fireplace, property?.fireplace)],
    ['Basement', pickFirst(features?.basement, property?.basement)],
    ['Cooling', pickFirst(features?.cooling, property?.cooling)],
    ['Heating', pickFirst(features?.heating, property?.heating)],
    ['Parking', pickFirst(features?.parking, property?.parking)],
    ['Construction', pickFirst(features?.constructionType, property?.constructionType)],
    ['Roof', pickFirst(features?.roofType, property?.roofType)],
    ['Architecture', pickFirst(features?.architectureType, property?.architectureType)],
    ['Exterior', pickFirst(features?.exteriorType, property?.exteriorType)],
    ['View', pickFirst(features?.view, property?.view)],
    ['Water Source', pickFirst(features?.waterSource, property?.waterSource)],
    ['Sewer', pickFirst(features?.sewer, property?.sewer)],
  ];

  return candidates
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([label, value]) => ({ label, value }));
};

const normalizeRentSummary = (rentEstimate = {}) => {
  if (!rentEstimate) return null;

  return {
    estimatedRent: pickFirst(numberOrNull(rentEstimate?.rent), numberOrNull(rentEstimate?.price)),
    low: pickFirst(numberOrNull(rentEstimate?.rentRangeLow), numberOrNull(rentEstimate?.priceRangeLow)),
    high: pickFirst(numberOrNull(rentEstimate?.rentRangeHigh), numberOrNull(rentEstimate?.priceRangeHigh)),
    comparables: toArray(rentEstimate?.comparables).map((comp) => ({
      address:
        comp.formattedAddress ||
        [comp.addressLine1, comp.addressLine2, comp.city, comp.state, comp.zipCode]
          .filter(Boolean)
          .join(', '),
      rent: pickFirst(numberOrNull(comp?.price), numberOrNull(comp?.rent)),
      listedDate: pickFirst(comp?.listedDate, comp?.date) || null,
      distance: numberOrNull(comp?.distance),
      bedrooms: numberOrNull(comp?.bedrooms),
      bathrooms: numberOrNull(comp?.bathrooms),
      squareFootage: numberOrNull(comp?.squareFootage),
      latitude: numberOrNull(comp?.latitude),
      longitude: numberOrNull(comp?.longitude),
    })),
  };
};

const sortByYearDesc = (items = []) =>
  [...items].sort((left, right) => (right?.year || 0) - (left?.year || 0));

const sortByDateDesc = (items = []) =>
  [...items].sort((left, right) => {
    const leftTime = left?.date ? new Date(left.date).valueOf() : 0;
    const rightTime = right?.date ? new Date(right.date).valueOf() : 0;
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  });

const normalizeValueSummary = (valuationContext = {}) => {
  if (!valuationContext) return null;

  return {
    estimatedValue: pickFirst(numberOrNull(valuationContext?.price), numberOrNull(valuationContext?.estimatedValue)),
    low: pickFirst(numberOrNull(valuationContext?.priceRangeLow), numberOrNull(valuationContext?.low)),
    high: pickFirst(numberOrNull(valuationContext?.priceRangeHigh), numberOrNull(valuationContext?.high)),
  };
};

const buildPropertySnapshot = ({
  subject,
  propertyRecord,
  saleListing,
  owner,
  latestTax,
  taxHistory,
  history,
  features,
}) => ({
  address: subject.address,
  county: pickFirst(subject.county, propertyRecord?.county) || '',
  parcelId:
    pickFirst(
      propertyRecord?.apn,
      propertyRecord?.parcelId,
      propertyRecord?.parcelNumber,
      propertyRecord?.assessorID,
      propertyRecord?.assessorId
    ) || '',
  legalDescription:
    pickFirst(
      propertyRecord?.legalDescription,
      propertyRecord?.subdivision,
      propertyRecord?.legalLot,
      propertyRecord?.legalBlock
    ) || '',
  propertyType: pickFirst(subject.propertyType, propertyRecord?.propertyType, saleListing?.propertyType) || '',
  bedrooms: pickFirst(numberOrNull(subject.bedrooms), numberOrNull(propertyRecord?.bedrooms), numberOrNull(saleListing?.bedrooms)),
  bathrooms: pickFirst(numberOrNull(subject.bathrooms), numberOrNull(propertyRecord?.bathrooms), numberOrNull(saleListing?.bathrooms)),
  squareFootage: pickFirst(numberOrNull(subject.squareFootage), numberOrNull(propertyRecord?.squareFootage), numberOrNull(saleListing?.squareFootage)),
  lotSize: pickFirst(numberOrNull(subject.lotSize), numberOrNull(propertyRecord?.lotSize)),
  yearBuilt: pickFirst(numberOrNull(subject.yearBuilt), numberOrNull(propertyRecord?.yearBuilt), numberOrNull(saleListing?.yearBuilt)),
  unitCount: pickFirst(numberOrNull(subject.unitCount), numberOrNull(propertyRecord?.features?.unitCount), Array.isArray(propertyRecord?.units) ? propertyRecord.units.length : null),
  latitude: pickFirst(numberOrNull(subject.latitude), numberOrNull(propertyRecord?.latitude), numberOrNull(saleListing?.latitude)),
  longitude: pickFirst(numberOrNull(subject.longitude), numberOrNull(propertyRecord?.longitude), numberOrNull(saleListing?.longitude)),
  lastSalePrice: pickFirst(numberOrNull(subject.lastSalePrice), numberOrNull(propertyRecord?.lastSalePrice)),
  lastSaleDate: pickFirst(subject.lastSaleDate, propertyRecord?.lastSaleDate) || null,
  hoaFee: pickFirst(numberOrNull(propertyRecord?.hoa?.fee), numberOrNull(saleListing?.hoa?.fee), numberOrNull(saleListing?.hoaFee)),
  owner,
  listing: normalizeListingSummary(saleListing),
  latestTax: latestTax || null,
  taxHistory,
  history,
  features,
});

const buildCompEntry = ({ subject, comp, category, sourceLabel, requestedRadius }) => {
  const similarity = scorePropertySimilarity(subject, comp, requestedRadius);
  return {
    id: comp.id || comp.address,
    category,
    sourceLabel,
    address: comp.address || '',
    propertyType: comp.propertyType || '',
    salePrice: pickFirst(numberOrNull(comp.salePrice), numberOrNull(comp.price)),
    estimatedValue: pickFirst(numberOrNull(comp.estimatedValue), numberOrNull(comp.value)),
    saleDate: comp.saleDate || comp.listedDate || null,
    listedDate: comp.listedDate || null,
    dateSource: comp.rawDateSource || null,
    pricePerSqft: pickFirst(numberOrNull(comp.pricePerSqft), numberOrNull(comp.salePrice) && numberOrNull(comp.squareFootage) ? comp.salePrice / comp.squareFootage : null),
    distance: resolveCompDistance(subject, comp),
    bedrooms: numberOrNull(comp.bedrooms),
    bathrooms: numberOrNull(comp.bathrooms),
    squareFootage: numberOrNull(comp.squareFootage),
    lotSize: numberOrNull(comp.lotSize),
    yearBuilt: numberOrNull(comp.yearBuilt),
    status: comp.status || '',
    listingType: comp.listingType || '',
    removedDate: comp.removedDate || null,
    daysOnMarket: numberOrNull(comp.daysOnMarket),
    mlsName: comp.mlsName || '',
    correlation: numberOrNull(comp.correlation),
    relevanceScore: numberOrNull(comp.relevanceScore),
    similarityScore: similarity.score,
    whySelected:
      comp.selectionReason ||
      similarity.reasons.join(' | ') ||
      'Selected for attribute similarity and distance to the subject property.',
    latitude: numberOrNull(comp.latitude),
    longitude: numberOrNull(comp.longitude),
    compDataSource: comp.compDataSource || sourceLabel,
  };
};

const filterByNumericRange = (value, min, max) => {
  if (min !== null && min !== undefined && (value === null || value === undefined || value < min)) {
    return false;
  }
  if (max !== null && max !== undefined && (value === null || value === undefined || value > max)) {
    return false;
  }
  return true;
};

const normalizeCompPropertyType = (value = '') => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');

  if (!normalized) return '';
  if (normalized.includes('single')) return 'single-family';
  if (normalized.includes('town')) return 'townhouse';
  if (normalized.includes('condo')) return 'condo';
  if (normalized.includes('mixed')) return 'mixed-use';
  if (normalized.includes('commercial')) return 'commercial';
  if (normalized.includes('land') || normalized.includes('lot')) return 'land';
  if (normalized.includes('multi') || normalized.includes('duplex') || normalized.includes('triplex') || normalized.includes('quad')) {
    if (normalized.includes('5') || normalized.includes('apartment') || normalized.includes('complex')) {
      return 'multi-family-5-plus';
    }
    if (normalized.includes('2') || normalized.includes('3') || normalized.includes('4') || normalized.includes('duplex') || normalized.includes('triplex') || normalized.includes('quad')) {
      return 'multi-family-2-4';
    }
    return 'multi-family-any';
  }

  return normalized;
};

const propertyTypesMatch = (filterValue = '', compValue = '') => {
  const normalizedFilter = normalizeCompPropertyType(filterValue);
  const normalizedComp = normalizeCompPropertyType(compValue);

  if (!normalizedFilter || !normalizedComp) return true;
  if (normalizedFilter === normalizedComp) return true;

  if (normalizedFilter === 'multi-family-any') {
    return normalizedComp === 'multi-family-any' || normalizedComp === 'multi-family-2-4' || normalizedComp === 'multi-family-5-plus';
  }

  if (normalizedFilter === 'multi-family-2-4') {
    return normalizedComp === 'multi-family-2-4';
  }

  if (normalizedFilter === 'multi-family-5-plus') {
    return normalizedComp === 'multi-family-5-plus';
  }

  return normalizedComp.includes(normalizedFilter);
};

const filterCompsLocally = (subject, comps = [], filters = {}) =>
  comps.filter((comp) => {
    const distance = resolveCompDistance(subject, comp);
    if (distance !== null && distance > filters.radius) return false;
    if (!filterByNumericRange(numberOrNull(comp.bedrooms), filters.minBedrooms, filters.maxBedrooms)) {
      return false;
    }
    if (!filterByNumericRange(numberOrNull(comp.bathrooms), filters.minBathrooms, filters.maxBathrooms)) {
      return false;
    }
    if (!filterByNumericRange(numberOrNull(comp.squareFootage), filters.minSquareFootage, filters.maxSquareFootage)) {
      return false;
    }
    if (!filterByNumericRange(numberOrNull(comp.lotSize), filters.minLotSize, filters.maxLotSize)) {
      return false;
    }
    if (!filterByNumericRange(numberOrNull(comp.yearBuilt), filters.minYearBuilt, filters.maxYearBuilt)) {
      return false;
    }

    if (filters.propertyType) {
      if (!propertyTypesMatch(filters.propertyType, comp.propertyType)) {
        return false;
      }
    }

    return true;
  });

const normalizeRecentSaleProperty = (property = {}) => ({
  id: property?.id || property?.formattedAddress,
  address:
    property?.formattedAddress ||
    [property?.addressLine1, property?.addressLine2, property?.city, property?.state, property?.zipCode]
      .filter(Boolean)
      .join(', '),
  propertyType: property?.propertyType || '',
  salePrice: numberOrNull(property?.lastSalePrice),
  saleDate: property?.lastSaleDate || null,
  squareFootage: numberOrNull(property?.squareFootage),
  lotSize: numberOrNull(property?.lotSize),
  bedrooms: numberOrNull(property?.bedrooms),
  bathrooms: numberOrNull(property?.bathrooms),
  yearBuilt: numberOrNull(property?.yearBuilt),
  latitude: numberOrNull(property?.latitude),
  longitude: numberOrNull(property?.longitude),
  compDataSource: 'rentcast_properties_recent_sale',
  rawDateSource: 'lastSaleDate',
  status: 'Recorded sale',
  listingType: 'Closed',
  removedDate: null,
  daysOnMarket: null,
});

const normalizeActiveListingComp = (listing = {}) => ({
  id: listing?.id || listing?.formattedAddress,
  address:
    listing?.formattedAddress ||
    [listing?.addressLine1, listing?.addressLine2, listing?.city, listing?.state, listing?.zipCode]
      .filter(Boolean)
      .join(', '),
  propertyType: listing?.propertyType || '',
  salePrice: numberOrNull(listing?.price),
  saleDate: listing?.listedDate || null,
  listedDate: listing?.listedDate || null,
  squareFootage: numberOrNull(listing?.squareFootage),
  lotSize: numberOrNull(listing?.lotSize),
  bedrooms: numberOrNull(listing?.bedrooms),
  bathrooms: numberOrNull(listing?.bathrooms),
  yearBuilt: numberOrNull(listing?.yearBuilt),
  latitude: numberOrNull(listing?.latitude),
  longitude: numberOrNull(listing?.longitude),
  status: listing?.status || '',
  listingType: listing?.listingType || '',
  removedDate: listing?.removedDate || null,
  daysOnMarket: numberOrNull(listing?.daysOnMarket),
  mlsName: listing?.mlsName || '',
  compDataSource: 'rentcast_sale_listing_search',
  rawDateSource: listing?.listedDate ? 'listedDate' : null,
});

const summarizeCompSet = (items = []) => {
  const salePrices = items.map((item) => item.salePrice).filter((value) => value !== null && value !== undefined);
  const pricePerSqft = items.map((item) => item.pricePerSqft).filter((value) => value !== null && value !== undefined);
  const distances = items.map((item) => item.distance).filter((value) => value !== null && value !== undefined);

  return {
    count: items.length,
    averagePrice: roundCurrency(average(salePrices)),
    medianPrice: roundCurrency(median(salePrices)),
    averagePricePerSqft: roundNumber(average(pricePerSqft), 0),
    medianPricePerSqft: roundNumber(median(pricePerSqft), 0),
    averageDistance: roundNumber(average(distances), 2),
    maxDistance: distances.length ? roundNumber(Math.max(...distances), 2) : null,
  };
};

const buildMarketContext = (marketData = {}, propertySnapshot = {}) => {
  if (!marketData) {
    return null;
  }

  const saleData = marketData.saleData || null;
  const rentalData = marketData.rentalData || null;
  const normalizedPropertyType = String(propertySnapshot.propertyType || '').trim().toLowerCase();
  const subjectBedrooms = numberOrNull(propertySnapshot.bedrooms);

  const propertyTypeSegment =
    toArray(saleData?.dataByPropertyType).find((segment) =>
      String(segment?.propertyType || '').trim().toLowerCase().includes(normalizedPropertyType)
    ) || null;
  const bedroomSegment =
    toArray(saleData?.dataByBedrooms).find(
      (segment) => numberOrNull(segment?.bedrooms) === subjectBedrooms
    ) || null;

  const notes = [];
  if (saleData?.medianPrice !== undefined && saleData?.medianPricePerSquareFoot !== undefined) {
    notes.push(
      `Zip-level median sale price is ${roundCurrency(saleData.medianPrice)} with median ${roundNumber(
        saleData.medianPricePerSquareFoot,
        0
      )} per sqft.`
    );
  }
  if (saleData?.medianDaysOnMarket !== undefined) {
    notes.push(`Median days on market in this zip is ${Math.round(saleData.medianDaysOnMarket)}.`);
  }
  if (saleData?.newListings !== undefined && saleData?.totalListings !== undefined) {
    notes.push(`${saleData.newListings} new sale listings out of ${saleData.totalListings} total listings.`);
  }

  return {
    zipCode: marketData.zipCode || propertySnapshot.zipCode || '',
    saleData,
    rentalData,
    propertyTypeSegment,
    bedroomSegment,
    notes,
  };
};

const buildValuationSection = ({
  valueSummary,
  primarySummary,
  recentSaleSummary,
  activeSummary,
}) => {
  const candidates = [
    numberOrNull(primarySummary?.medianPrice),
    numberOrNull(recentSaleSummary?.medianPrice),
    numberOrNull(valueSummary?.estimatedValue),
  ].filter((value) => value !== null);

  const weightedBlend =
    (numberOrNull(recentSaleSummary?.medianPrice) || 0) * 0.45 +
    (numberOrNull(primarySummary?.medianPrice) || 0) * 0.35 +
    (numberOrNull(valueSummary?.estimatedValue) || 0) * 0.2;
  const blendedEstimate =
    candidates.length > 0 ? roundCurrency(weightedBlend || median(candidates)) : null;
  const lowCandidates = [
    numberOrNull(valueSummary?.low),
    numberOrNull(primarySummary?.medianPrice),
    numberOrNull(recentSaleSummary?.medianPrice),
  ].filter((value) => value !== null);
  const highCandidates = [
    numberOrNull(valueSummary?.high),
    numberOrNull(primarySummary?.medianPrice),
    numberOrNull(recentSaleSummary?.medianPrice),
    numberOrNull(activeSummary?.medianPrice),
  ].filter((value) => value !== null);

  const notes = [];
  if (valueSummary?.estimatedValue) {
    notes.push('RentCast AVM is included as one pricing input, not treated as a single source of truth.');
  }
  if (recentSaleSummary?.count) {
    notes.push(`Recent recorded sales contributed ${recentSaleSummary.count} nearby sale comps.`);
  }
  if (primarySummary?.count) {
    notes.push(`AVM valuation comps contributed ${primarySummary.count} ranked comparables.`);
  }

  return {
    rentCastEstimate: numberOrNull(valueSummary?.estimatedValue),
    rentCastLow: numberOrNull(valueSummary?.low),
    rentCastHigh: numberOrNull(valueSummary?.high),
    primaryCompMedian: numberOrNull(primarySummary?.medianPrice),
    primaryCompAverage: numberOrNull(primarySummary?.averagePrice),
    recentSaleMedian: numberOrNull(recentSaleSummary?.medianPrice),
    recentSaleAverage: numberOrNull(recentSaleSummary?.averagePrice),
    activeMarketMedian: numberOrNull(activeSummary?.medianPrice),
    blendedEstimate,
    blendedLow: lowCandidates.length ? roundCurrency(Math.min(...lowCandidates)) : null,
    blendedHigh: highCandidates.length ? roundCurrency(Math.max(...highCandidates)) : null,
    notes,
  };
};

const buildDealAnalysis = ({
  strategy,
  dealInputs,
  valuation,
  rentSummary,
}) => {
  const purchasePrice = numberOrNull(dealInputs.askingPrice) || 0;
  const rehabEstimate = numberOrNull(dealInputs.rehabEstimate) || 0;
  const exitValue = numberOrNull(valuation.blendedEstimate) || numberOrNull(valuation.rentCastEstimate);
  const loanRatio = (numberOrNull(dealInputs.loanToCostPercent) || 0) / 100;
  const acquisitionClosingCosts = purchasePrice * ((numberOrNull(dealInputs.acquisitionClosingCostPercent) || 0) / 100);
  const contingency = rehabEstimate * ((numberOrNull(dealInputs.contingencyPercent) || 0) / 100);
  const loanBase = (purchasePrice + rehabEstimate) * loanRatio;
  const financingPoints = loanBase * ((numberOrNull(dealInputs.financingPointsPercent) || 0) / 100);
  const monthlyInterestCarry = loanBase * ((numberOrNull(dealInputs.interestRatePercent) || 0) / 100) / 12;
  const monthlyTaxCarry = numberOrNull(dealInputs.annualTaxes) ? dealInputs.annualTaxes / 12 : 0;
  const monthlyInsurance = numberOrNull(dealInputs.monthlyInsurance) || 0;
  const monthlyUtilities = numberOrNull(dealInputs.monthlyUtilities) || 0;
  const monthlyMaintenance = numberOrNull(dealInputs.monthlyMaintenance) || 0;
  const totalHoldingCarry =
    (monthlyInterestCarry +
      monthlyTaxCarry +
      monthlyInsurance +
      monthlyUtilities +
      monthlyMaintenance) *
    (numberOrNull(dealInputs.holdingPeriodMonths) || 0);

  if (strategy === 'hold' || strategy === 'rental') {
    const stabilizedBasis =
      purchasePrice +
      rehabEstimate +
      acquisitionClosingCosts +
      financingPoints +
      totalHoldingCarry +
      contingency;
    const estimatedRent = numberOrNull(rentSummary?.estimatedRent);
    const annualRent = estimatedRent ? estimatedRent * 12 : null;
    const grossYieldPercent =
      annualRent && stabilizedBasis ? roundNumber((annualRent / stabilizedBasis) * 100, 1) : null;
    const onePercentRule =
      estimatedRent && stabilizedBasis ? roundNumber((estimatedRent / stabilizedBasis) * 100, 2) : null;
    const equitySpread = exitValue ? roundCurrency(exitValue - stabilizedBasis) : null;

    return {
      mode: 'hold',
      strategy,
      exitValue,
      costBreakdown: [
        { label: 'Asking Price', amount: purchasePrice, group: 'basis' },
        { label: 'Renovation Cost', amount: rehabEstimate, group: 'basis' },
        { label: 'Acquisition Closing Costs', amount: acquisitionClosingCosts, group: 'soft' },
        { label: 'Financing Points', amount: financingPoints, group: 'soft' },
        { label: 'Interest Carry', amount: roundCurrency(monthlyInterestCarry * dealInputs.holdingPeriodMonths), group: 'carry' },
        { label: 'Taxes Carry', amount: roundCurrency(monthlyTaxCarry * dealInputs.holdingPeriodMonths), group: 'carry' },
        { label: 'Insurance Carry', amount: roundCurrency(monthlyInsurance * dealInputs.holdingPeriodMonths), group: 'carry' },
        { label: 'Utilities Carry', amount: roundCurrency(monthlyUtilities * dealInputs.holdingPeriodMonths), group: 'carry' },
        { label: 'Maintenance Carry', amount: roundCurrency(monthlyMaintenance * dealInputs.holdingPeriodMonths), group: 'carry' },
        { label: 'Contingency', amount: contingency, group: 'soft' },
      ],
      metrics: {
        purchasePrice: roundCurrency(purchasePrice),
        rehabEstimate: roundCurrency(rehabEstimate),
        stabilizedBasis: roundCurrency(stabilizedBasis),
        estimatedMonthlyRent: roundCurrency(estimatedRent),
        annualRent: roundCurrency(annualRent),
        grossYieldPercent,
        onePercentRule,
        equitySpread,
        totalHoldingCarry: roundCurrency(totalHoldingCarry),
        loanAmount: roundCurrency(loanBase),
      },
    };
  }

  const sellingCosts = exitValue
    ? exitValue * ((numberOrNull(dealInputs.sellingCostPercent) || 0) / 100)
    : 0;
  const totalProjectCost =
    purchasePrice +
    rehabEstimate +
    acquisitionClosingCosts +
    financingPoints +
    totalHoldingCarry +
    sellingCosts +
    contingency;
  const grossSpread = exitValue ? roundCurrency(exitValue - purchasePrice) : null;
  const estimatedProfit = exitValue ? roundCurrency(exitValue - totalProjectCost) : null;
  const marginPercent =
    exitValue && estimatedProfit !== null ? roundNumber((estimatedProfit / exitValue) * 100, 1) : null;
  const returnOnCostPercent =
    totalProjectCost && estimatedProfit !== null
      ? roundNumber((estimatedProfit / totalProjectCost) * 100, 1)
      : null;
  const cashRequired = roundCurrency(totalProjectCost - loanBase);
  const cashOnCashPercent =
    cashRequired && estimatedProfit !== null ? roundNumber((estimatedProfit / cashRequired) * 100, 1) : null;

  return {
    mode: 'flip',
    strategy,
    exitValue,
    costBreakdown: [
      { label: 'Asking Price', amount: purchasePrice, group: 'basis' },
      { label: 'Renovation Cost', amount: rehabEstimate, group: 'basis' },
      { label: 'Acquisition Closing Costs', amount: acquisitionClosingCosts, group: 'soft' },
      { label: 'Financing Points', amount: financingPoints, group: 'soft' },
      { label: 'Interest Carry', amount: roundCurrency(monthlyInterestCarry * dealInputs.holdingPeriodMonths), group: 'carry' },
      { label: 'Taxes Carry', amount: roundCurrency(monthlyTaxCarry * dealInputs.holdingPeriodMonths), group: 'carry' },
      { label: 'Insurance Carry', amount: roundCurrency(monthlyInsurance * dealInputs.holdingPeriodMonths), group: 'carry' },
      { label: 'Utilities Carry', amount: roundCurrency(monthlyUtilities * dealInputs.holdingPeriodMonths), group: 'carry' },
      { label: 'Maintenance Carry', amount: roundCurrency(monthlyMaintenance * dealInputs.holdingPeriodMonths), group: 'carry' },
      { label: 'Selling Costs', amount: roundCurrency(sellingCosts), group: 'exit' },
      { label: 'Contingency', amount: contingency, group: 'soft' },
    ],
    metrics: {
      purchasePrice: roundCurrency(purchasePrice),
      rehabEstimate: roundCurrency(rehabEstimate),
      exitValue: roundCurrency(exitValue),
      totalProjectCost: roundCurrency(totalProjectCost),
      grossSpread,
      estimatedProfit,
      marginPercent,
      returnOnCostPercent,
      loanAmount: roundCurrency(loanBase),
      cashRequired,
      cashOnCashPercent,
      totalHoldingCarry: roundCurrency(totalHoldingCarry),
    },
  };
};

const buildCompLogic = ({
  primaryComps,
  recentSales,
  activeListings,
  filters,
  primaryMeta,
}) => {
  const notes = [
    'Primary valuation comps come from RentCast AVM comparables and may include listing-style records.',
    'Recent sale comps come from property records with recorded last sale data.',
    'Active market comps come from nearby sale listings and are shown as market context, not closed sales.',
  ];

  if (
    primaryMeta?.rawComparableCount === 25 &&
    primaryMeta?.searchMeta?.returnedDistanceRange?.max !== null &&
    primaryMeta?.searchMeta?.returnedDistanceRange?.max !== undefined &&
    primaryMeta.searchMeta.returnedDistanceRange.max < filters.radius
  ) {
    notes.push(
      `Widening radius beyond ${roundNumber(
        primaryMeta.searchMeta.returnedDistanceRange.max,
        2
      )} mi may not change the AVM comp set because RentCast already returned its full candidate pool inside that smaller area.`
    );
  }

  return {
    nativeFilters: primaryMeta?.searchMeta?.nativeFilters || null,
    localFilters: primaryMeta?.searchMeta?.localFilters || null,
    rawComparableCount: numberOrNull(primaryMeta?.rawComparableCount),
    candidateComparableCount: numberOrNull(primaryMeta?.candidateComparableCount),
    visiblePrimaryCount: primaryComps.length,
    visibleRecentSaleCount: recentSales.length,
    visibleActiveMarketCount: activeListings.length,
    notes,
  };
};

const buildSourceSummary = ({
  propertyRecord,
  saleListing,
  rentalListing,
  marketData,
  primaryComps,
  recentSales,
  activeListings,
  valueSummary,
  rentSummary,
  aiVerdict,
}) => [
  { label: 'RentCast property record', available: Boolean(propertyRecord) },
  { label: 'RentCast sale listing', available: Boolean(saleListing) },
  { label: 'RentCast rental listing', available: Boolean(rentalListing) },
  { label: 'RentCast market stats', available: Boolean(marketData) },
  { label: 'RentCast AVM value estimate', available: Boolean(valueSummary?.estimatedValue) },
  { label: 'RentCast rent estimate', available: Boolean(rentSummary?.estimatedRent) },
  { label: 'AVM valuation comps', available: primaryComps.length > 0 },
  { label: 'Recorded recent sale comps', available: recentSales.length > 0 },
  { label: 'Nearby active market listings', available: activeListings.length > 0 },
  { label: 'OpenAI deal verdict', available: Boolean(aiVerdict) },
];

const generateMasterDealAiVerdict = async (payload) => {
  const openai = getOpenAIClient();
  if (!openai) return null;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You are a practical real-estate acquisitions analyst. Evaluate whether the deal looks strong, mixed, or risky based only on the provided data. Be clear, sober, and investor-facing. Do not invent facts. Return valid JSON only.',
      },
      {
        role: 'user',
        content: `Analyze this deal and return JSON with exactly these keys:
- headline
- verdict
- executiveSummary
- compSupport
- valueTakeaway
- dealTakeaway
- upsideFactors (array of strings)
- riskFlags (array of strings)
- keyAssumptions (array of strings)
- nextSteps (array of strings)
- confidence

Rules:
- verdict must be one of Strong, Mixed, Risky
- compSupport must be one of Strong, Moderate, Weak
- confidence must be one of Low, Medium, High

Data:
${JSON.stringify(payload, null, 2)}`,
      },
    ],
  });

  return normalizeMasterVerdict(JSON.parse(completion.choices[0].message.content));
};

const mergeSubjectWithPreview = (subject, preview) => {
  const merged = { ...subject };

  Object.entries(preview || {}).forEach(([key, value]) => {
    if (key === 'metadata' || value === undefined || value === null || value === '') return;
    if (merged[key] === undefined || merged[key] === null || merged[key] === '') {
      merged[key] = value;
    }
  });

  if (preview?.address) {
    merged.address = preview.address;
  }

  return merged;
};

const buildMasterDealReport = async ({
  subject: rawSubject = {},
  filters: rawFilters = {},
  deal: rawDeal = {},
}) => {
  const subjectInput = normalizeSubjectInput(rawSubject);
  if (!subjectInput.address) {
    throw new Error('Address is required.');
  }

  const [propertyRecord, saleListingRecord, rentalListingRecord] = await Promise.all([
    fetchRentCastProperty(subjectInput).catch(() => null),
    fetchRentCastSaleListing(subjectInput).catch(() => null),
    fetchRentCastRentalListing(subjectInput).catch(() => null),
  ]);

  const preview = formatPropertyPreview(subjectInput, propertyRecord, saleListingRecord);
  const subject = mergeSubjectWithPreview(subjectInput, preview);
  const filters = normalizeCompFilters(rawFilters, subject);
  const primaryAnalysis = await buildCompsAnalysis(subject, filters);
  const rentEstimateRecord = await fetchRentCastRentEstimate({
    ...subject,
    compCount: Math.max(filters.maxComps, 20),
    maxRadius: filters.radius,
    daysOld: Math.max(1, Math.round(filters.saleDateMonths * 30)),
  }).catch(() => null);
  const marketData = await fetchRentCastMarketStats(subject, {
    zipCode: subject.zipCode,
    dataType: 'All',
    historyRange: 12,
  }).catch(() => null);

  const recentSaleCandidates = await searchRentCastProperties(subject, {
    radius: filters.radius,
    propertyType: filters.propertyType || subject.propertyType,
    minBedrooms: filters.minBedrooms,
    maxBedrooms: filters.maxBedrooms,
    minBathrooms: filters.minBathrooms,
    maxBathrooms: filters.maxBathrooms,
    minSquareFootage: filters.minSquareFootage,
    maxSquareFootage: filters.maxSquareFootage,
    minLotSize: filters.minLotSize,
    maxLotSize: filters.maxLotSize,
    minYearBuilt: filters.minYearBuilt,
    maxYearBuilt: filters.maxYearBuilt,
    maxSaleDateRange: Math.round(filters.saleDateMonths * 30),
    limit: 25,
  }).catch(() => []);

  const activeMarketCandidates = await searchRentCastSaleListings(subject, {
    radius: filters.radius,
    propertyType: filters.propertyType || subject.propertyType,
    minBedrooms: filters.minBedrooms,
    maxBedrooms: filters.maxBedrooms,
    minBathrooms: filters.minBathrooms,
    maxBathrooms: filters.maxBathrooms,
    minSquareFootage: filters.minSquareFootage,
    maxSquareFootage: filters.maxSquareFootage,
    minLotSize: filters.minLotSize,
    maxLotSize: filters.maxLotSize,
    minYearBuilt: filters.minYearBuilt,
    maxYearBuilt: filters.maxYearBuilt,
    daysOld: Math.round(filters.saleDateMonths * 30),
    limit: 20,
  }).catch(() => []);

  const primaryComps = toArray(primaryAnalysis?.rankedComps).map((comp) =>
    buildCompEntry({
      subject,
      comp,
      category: 'primary_valuation',
      sourceLabel: 'RentCast AVM comparable',
      requestedRadius: filters.radius,
    })
  );

  const recentSales = filterCompsLocally(
    subject,
    recentSaleCandidates.map(normalizeRecentSaleProperty),
    filters
  )
    .map((comp) =>
      buildCompEntry({
        subject,
        comp,
        category: 'recent_sale',
        sourceLabel: 'Recorded nearby sale',
        requestedRadius: filters.radius,
      })
    )
    .sort((a, b) => b.similarityScore - a.similarityScore)
    .slice(0, Math.max(filters.maxComps, 6));

  const activeMarket = filterCompsLocally(
    subject,
    activeMarketCandidates.map(normalizeActiveListingComp),
    filters
  )
    .map((comp) =>
      buildCompEntry({
        subject,
        comp,
        category: 'active_market',
        sourceLabel: 'Nearby sale listing',
        requestedRadius: filters.radius,
      })
    )
    .sort((a, b) => b.similarityScore - a.similarityScore)
    .slice(0, Math.max(filters.maxComps, 6));

  const saleListing = normalizeListingSummary(saleListingRecord);
  const owner = normalizeOwnerSummary(propertyRecord || {});
  const taxHistory = sortByYearDesc(
    toArray(propertyRecord?.taxAssessments)
      .map(normalizeTaxAssessment)
      .filter((item) => Object.values(item).some((value) => value !== null && value !== undefined && value !== ''))
  );
  const history = sortByDateDesc(
    toArray(propertyRecord?.history)
      .map(normalizePropertyHistoryItem)
      .filter((item) => Object.values(item).some((value) => value !== null && value !== undefined && value !== ''))
  ).slice(0, 12);
  const features = buildFeatureEntries(propertyRecord || {});
  const propertySnapshot = buildPropertySnapshot({
    subject,
    propertyRecord,
    saleListing: saleListingRecord,
    owner,
    latestTax: taxHistory[0] || null,
    taxHistory,
    history,
    features,
  });
  const dealInputs = normalizeDealInputs(rawDeal, subject, taxHistory[0] || null);
  const valueSummary = normalizeValueSummary(primaryAnalysis?.valuationContext);
  const rentSummary = normalizeRentSummary(rentEstimateRecord);
  const primarySummary = summarizeCompSet(primaryComps);
  const recentSaleSummary = summarizeCompSet(recentSales);
  const activeSummary = summarizeCompSet(activeMarket);
  const valuation = buildValuationSection({
    valueSummary,
    primarySummary,
    recentSaleSummary,
    activeSummary,
  });
  const dealAnalysis = buildDealAnalysis({
    strategy: dealInputs.strategy,
    dealInputs,
    valuation,
    rentSummary,
  });
  const marketContext = buildMarketContext(marketData, propertySnapshot);
  const compLogic = buildCompLogic({
    primaryComps,
    recentSales,
    activeListings: activeMarket,
    filters,
    primaryMeta: primaryAnalysis,
  });

  const aiVerdict = await generateMasterDealAiVerdict({
    subject,
    propertySnapshot,
    dealInputs,
    valuation,
    dealAnalysis,
    marketContext,
    compLogic,
    primaryComps: primaryComps.slice(0, 8),
    recentSales: recentSales.slice(0, 8),
    activeMarket: activeMarket.slice(0, 8),
  }).catch((error) => {
    console.error('Master deal verdict generation failed:', error.response?.data || error.message);
    return null;
  });

  const title = `${subject.address || 'Property'} - Master Deal Report`;
  const generatedAt = new Date();

  return {
    kind: 'master_deal',
    title,
    generatedAt,
    subject,
    propertySnapshot,
    dealInputs,
    compFilters: filters,
    comps: {
      primary: {
        label: 'Primary valuation comps',
        source: 'RentCast /avm/value',
        honestLabel:
          'These are RentCast AVM comparables. They support valuation, but some records carry listing-style dates and statuses rather than confirmed closed-sale timestamps.',
        summary: primarySummary,
        items: primaryComps,
      },
      recentSales: {
        label: 'Recent recorded sales',
        source: 'RentCast /properties',
        honestLabel:
          'These come from recorded property sale history and are the cleanest sale-date reference set in this report.',
        summary: recentSaleSummary,
        items: recentSales,
      },
      activeMarket: {
        label: 'Active market listings',
        source: 'RentCast /listings/sale',
        honestLabel:
          'These listings provide market competition context and should not be read as closed-sale comps.',
        summary: activeSummary,
        items: activeMarket,
      },
      logic: compLogic,
      mapSet: [...primaryComps, ...recentSales, ...activeMarket],
    },
    valuation,
    dealAnalysis,
    aiVerdict,
    marketContext,
    rent: rentSummary,
    sources: buildSourceSummary({
      propertyRecord,
      saleListing: saleListingRecord,
      rentalListing: rentalListingRecord,
      marketData,
      primaryComps,
      recentSales,
      activeListings: activeMarket,
      valueSummary,
      rentSummary,
      aiVerdict,
    }),
    summary: primaryAnalysis?.summary || null,
    filters,
    valuationContext: primaryAnalysis?.valuationContext || null,
    recentComps: primaryComps,
    masterReportVersion: 1,
  };
};

module.exports = {
  buildMasterDealReport,
  normalizeCompFilters,
  normalizeDealInputs,
  normalizeSubjectInput,
};
