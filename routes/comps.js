const express = require("express");
const OpenAI = require("openai");
const {
  fetchRentCastProperty,
  fetchRentCastRentalListing,
  fetchRentCastRentEstimate,
  fetchRentCastSaleListing,
  fetchRentCastValueEstimate,
  formatPropertyPreview,
  getLeadPropertyPreview,
  numberOrNull,
} = require("../utils/leadPropertyService");
const {
  buildCompsAnalysis: buildSharedCompsAnalysis,
  generateAiReport: generateSharedAiReport,
} = require("../utils/compsAnalysisService");
const { getFeatureAccessState, recordFeatureUsage } = require("../utils/billingAccess");

const router = express.Router();

const getOpenAIClient = () => {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

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

const formatAiObjectKey = (value = "") => {
  const normalized = String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();

  if (!normalized) return "Value";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const stringifyAiValue = (value) => {
  if (value === null || value === undefined) return "";

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (Array.isArray(value)) {
    return value.map((item) => stringifyAiValue(item)).filter(Boolean).join("\n");
  }

  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, entryValue]) => {
        const rendered = stringifyAiValue(entryValue);
        if (!rendered) return "";
        return `${formatAiObjectKey(key)}: ${rendered}`;
      })
      .filter(Boolean)
      .join("; ");
  }

  return String(value).trim();
};

const normalizeAiList = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => stringifyAiValue(item))
      .flatMap((item) => item.split("\n"))
      .map((item) => item.trim())
      .filter(Boolean);
  }

  const rendered = stringifyAiValue(value);
  return rendered ? [rendered] : [];
};

const normalizeAiConfidence = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "low") return "Low";
  if (normalized === "medium") return "Medium";
  if (normalized === "high") return "High";
  return stringifyAiValue(value);
};

const normalizeAiReport = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
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

const normalizeFullPropertyAiReport = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return {
    headline: stringifyAiValue(value.headline),
    executiveSummary: stringifyAiValue(value.executiveSummary),
    ownershipTakeaway: stringifyAiValue(value.ownershipTakeaway),
    valuationTakeaway: stringifyAiValue(value.valuationTakeaway),
    rentalTakeaway: stringifyAiValue(value.rentalTakeaway),
    strengths: normalizeAiList(value.strengths),
    risks: normalizeAiList(value.risks),
    nextSteps: normalizeAiList(value.nextSteps),
    confidence: normalizeAiConfidence(value.confidence),
  };
};

const matchesNumericRange = (value, min, max) => {
  const hasRange =
    (min !== null && min !== undefined) || (max !== null && max !== undefined);
  if (hasRange && (value === null || value === undefined)) return false;
  if (min !== null && min !== undefined && value < min) return false;
  if (max !== null && max !== undefined && value > max) return false;
  return true;
};

const normalizeSubjectInput = (input = {}) => ({
  address: String(input.address || "").trim(),
  addressLine1: String(input.addressLine1 || "").trim(),
  city: String(input.city || "").trim(),
  state: String(input.state || "").trim(),
  zipCode: String(input.zipCode || "").trim(),
  propertyType: String(input.propertyType || "").trim(),
  bedrooms: numberOrNull(input.bedrooms),
  bathrooms: numberOrNull(input.bathrooms),
  squareFootage: numberOrNull(input.squareFootage ?? input.sqft),
  lotSize: numberOrNull(input.lotSize),
  yearBuilt: numberOrNull(input.yearBuilt),
  unitCount: numberOrNull(input.unitCount),
  sellerAskingPrice: numberOrNull(input.sellerAskingPrice),
  targetOffer: numberOrNull(input.targetOffer),
  arv: numberOrNull(input.arv),
  occupancyStatus: String(input.occupancyStatus || "").trim(),
  motivation: String(input.motivation || "").trim(),
  rehabEstimate: numberOrNull(input.rehabEstimate),
  nextAction: String(input.nextAction || "").trim(),
  listingStatus: String(input.listingStatus || "").trim(),
  daysOnMarket: numberOrNull(input.daysOnMarket),
  lastSalePrice: numberOrNull(input.lastSalePrice),
  lastSaleDate: input.lastSaleDate || null,
});

const mergeSubjectWithPreview = (base = {}, preview = {}) => {
  const merged = { ...base };

  Object.entries(preview).forEach(([key, value]) => {
    if (key === "metadata" || value === undefined || value === null || value === "") return;
    const currentValue = merged[key];
    if (currentValue === undefined || currentValue === null || currentValue === "") {
      merged[key] = value;
    }
  });

  if (preview.address) {
    merged.address = preview.address;
  }

  return merged;
};

const normalizePropertyTypeKey = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");

  if (!normalized) return "";
  if (normalized.includes("single")) return "single-family";
  if (normalized.includes("condo")) return "condo";
  if (normalized.includes("town")) return "townhouse";
  if (
    normalized.includes("multi") ||
    normalized.includes("duplex") ||
    normalized.includes("triplex") ||
    normalized.includes("quadplex") ||
    normalized.includes("apartment")
  ) {
    return "multi-family";
  }
  if (normalized.includes("mixed")) return "mixed-use";
  if (
    normalized.includes("commercial") ||
    normalized.includes("retail") ||
    normalized.includes("office") ||
    normalized.includes("industrial")
  ) {
    return "commercial";
  }
  if (normalized.includes("land") || normalized.includes("lot") || normalized.includes("vacant")) {
    return "land";
  }
  return normalized === "other" ? "other" : "other";
};

const resolveComparableUnitCount = (comp = {}) =>
  numberOrNull(comp?.features?.unitCount) ??
  numberOrNull(comp?.unitCount) ??
  (Array.isArray(comp?.units) ? comp.units.length : null);

const derivePropertyTypeFilter = (propertyType, unitCount) => {
  const normalizedType = normalizePropertyTypeKey(propertyType);
  const normalizedUnitCount = numberOrNull(unitCount);

  if (!normalizedType) return "";
  if (normalizedType === "other") return "";
  if (normalizedType !== "multi-family") return normalizedType;
  if (normalizedUnitCount !== null && normalizedUnitCount >= 5) return "multi-family-5-plus";
  if (normalizedUnitCount !== null && normalizedUnitCount >= 2) return "multi-family-2-4";
  return "multi-family-any";
};

const matchesPropertyTypeFilter = (filterValue, propertyType, unitCount) => {
  const normalizedFilter = String(filterValue || "").trim();
  if (!normalizedFilter) return true;

  const normalizedType = normalizePropertyTypeKey(propertyType);
  const normalizedUnitCount = numberOrNull(unitCount);

  switch (normalizedFilter) {
    case "multi-family-any":
      return normalizedType === "multi-family";
    case "multi-family-2-4":
      return (
        normalizedType === "multi-family" &&
        normalizedUnitCount !== null &&
        normalizedUnitCount >= 2 &&
        normalizedUnitCount <= 4
      );
    case "multi-family-5-plus":
      return normalizedType === "multi-family" && normalizedUnitCount !== null && normalizedUnitCount >= 5;
    default:
      return normalizedType === normalizePropertyTypeKey(normalizedFilter);
  }
};

const normalizeComparable = (comp = {}) => ({
  id: comp.id || comp.formattedAddress || `${comp.latitude},${comp.longitude}`,
  address:
    comp.formattedAddress ||
    [comp.addressLine1, comp.addressLine2, comp.city, comp.state, comp.zipCode]
      .filter(Boolean)
      .join(", "),
  beds: numberOrNull(comp.bedrooms),
  baths: numberOrNull(comp.bathrooms),
  sqft: numberOrNull(comp.squareFootage),
  price: numberOrNull(comp.price),
  saleDate: comp.listedDate || comp.lastSeenDate || comp.removedDate || null,
  lat: numberOrNull(comp.latitude),
  lng: numberOrNull(comp.longitude),
  distance: numberOrNull(comp.distance),
  propertyType: comp.propertyType || "",
  status: comp.status || "",
  correlation: numberOrNull(comp.correlation),
});

const normalizeComparableSale = (comp = {}) => ({
  address:
    comp.formattedAddress ||
    [comp.addressLine1, comp.addressLine2, comp.city, comp.state, comp.zipCode]
      .filter(Boolean)
      .join(", "),
  propertyType: comp.propertyType || "",
  unitCount: resolveComparableUnitCount(comp),
  salePrice: numberOrNull(comp.price),
  saleDate:
    comp.lastSaleDate ||
    comp.saleDate ||
    comp.listedDate ||
    comp.lastSeenDate ||
    comp.removedDate ||
    null,
  distance: numberOrNull(comp.distance),
  bedrooms: numberOrNull(comp.bedrooms),
  bathrooms: numberOrNull(comp.bathrooms),
  squareFootage: numberOrNull(comp.squareFootage),
  lotSize: numberOrNull(comp.lotSize),
  yearBuilt: numberOrNull(comp.yearBuilt),
  latitude: numberOrNull(comp.latitude),
  longitude: numberOrNull(comp.longitude),
  pricePerSqft: comp.price && comp.squareFootage ? comp.price / comp.squareFootage : null,
  status: comp.status || "",
  listingType: comp.listingType || "",
  removedDate: comp.removedDate || null,
  daysOnMarket: numberOrNull(comp.daysOnMarket),
});

const pickFirst = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== "");

const toArray = (value) => (Array.isArray(value) ? value : []);

const buildFullAddress = (parts = {}) => {
  if (parts.formattedAddress) return parts.formattedAddress;

  return [
    pickFirst(parts.addressLine1, parts.mailingAddressLine1),
    pickFirst(parts.addressLine2, parts.mailingAddressLine2),
    parts.city,
    parts.state,
    parts.zipCode,
  ]
    .filter(Boolean)
    .join(", ");
};

const stringifyAddress = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value !== "object" || Array.isArray(value)) return "";
  return buildFullAddress(value);
};

const normalizeOwnerSummary = (property = {}) => {
  const owner = property?.owner || {};
  const name =
    pickFirst(
      owner?.name,
      owner?.fullName,
      [owner?.firstName, owner?.lastName].filter(Boolean).join(" ").trim(),
      property?.ownerName
    ) || "";

  return {
    name,
    type: pickFirst(owner?.type, property?.ownerType) || "",
    mailingAddress:
      pickFirst(
        typeof owner?.mailingAddress === "string" ? owner.mailingAddress : "",
        stringifyAddress(owner?.mailingAddress),
        buildFullAddress(owner),
        buildFullAddress(property?.owner || {})
      ) || "",
    occupied:
      pickFirst(
        owner?.occupied,
        property?.ownerOccupied
      ) ?? null,
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
  eventType: pickFirst(item?.eventType, item?.type, item?.event) || "",
  price: pickFirst(numberOrNull(item?.price), numberOrNull(item?.salePrice), numberOrNull(item?.amount)),
  buyerName: pickFirst(item?.buyerName, item?.buyer) || "",
  sellerName: pickFirst(item?.sellerName, item?.seller) || "",
});

const normalizeListingSummary = (listing = {}) => {
  if (!listing) return null;

  return {
    status: listing?.status || "",
    price: numberOrNull(listing?.price),
    listedDate: listing?.listedDate || null,
    removedDate: listing?.removedDate || null,
    daysOnMarket: numberOrNull(listing?.daysOnMarket),
    listingType: listing?.listingType || "",
    mlsName: listing?.mlsName || "",
    mlsNumber: listing?.mlsNumber || "",
    agentName:
      pickFirst(
        listing?.listingAgent?.name,
        [listing?.listingAgent?.firstName, listing?.listingAgent?.lastName].filter(Boolean).join(" ").trim()
      ) || "",
    officeName: pickFirst(listing?.listingOffice?.name, listing?.listingOfficeName) || "",
    builderName: pickFirst(listing?.builder?.name, listing?.builderName) || "",
    hoaFee: pickFirst(numberOrNull(listing?.hoa?.fee), numberOrNull(listing?.hoaFee)),
  };
};

const buildFeatureEntries = (property = {}) => {
  const features = property?.features || {};
  const candidates = [
    ["Stories", pickFirst(numberOrNull(features?.stories), numberOrNull(property?.stories))],
    ["Garage Spaces", pickFirst(numberOrNull(features?.garageSpaces), numberOrNull(property?.garageSpaces))],
    ["Pool", pickFirst(features?.pool, property?.pool)],
    ["Fireplace", pickFirst(features?.fireplace, property?.fireplace)],
    ["Basement", pickFirst(features?.basement, property?.basement)],
    ["Cooling", pickFirst(features?.cooling, property?.cooling)],
    ["Heating", pickFirst(features?.heating, property?.heating)],
    ["Parking", pickFirst(features?.parking, property?.parking)],
    ["Construction", pickFirst(features?.constructionType, property?.constructionType)],
    ["Roof", pickFirst(features?.roofType, property?.roofType)],
    ["Architecture", pickFirst(features?.architectureType, property?.architectureType)],
    ["Exterior", pickFirst(features?.exteriorType, property?.exteriorType)],
    ["View", pickFirst(features?.view, property?.view)],
    ["Water Source", pickFirst(features?.waterSource, property?.waterSource)],
    ["Sewer", pickFirst(features?.sewer, property?.sewer)],
  ];

  return candidates
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
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
          .join(", "),
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

const hasValue = (value) => {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

const sortByYearDesc = (items = []) =>
  [...items].sort((left, right) => (right?.year || 0) - (left?.year || 0));

const sortByDateDesc = (items = []) =>
  [...items].sort((left, right) => {
    const leftTime = left?.date ? new Date(left.date).valueOf() : 0;
    const rightTime = right?.date ? new Date(right.date).valueOf() : 0;
    const safeLeftTime = Number.isFinite(leftTime) ? leftTime : 0;
    const safeRightTime = Number.isFinite(rightTime) ? rightTime : 0;
    return safeRightTime - safeLeftTime;
  });

const normalizeValueSummary = (avmValue = {}) => {
  if (!avmValue) return null;

  return {
    estimatedValue: pickFirst(numberOrNull(avmValue?.price), numberOrNull(avmValue?.value)),
    low: pickFirst(numberOrNull(avmValue?.priceRangeLow), numberOrNull(avmValue?.valueRangeLow)),
    high: pickFirst(numberOrNull(avmValue?.priceRangeHigh), numberOrNull(avmValue?.valueRangeHigh)),
  };
};

const buildPropertyOverview = (subject = {}, property = {}, saleListing = {}) => ({
  address: subject.address || "",
  county: pickFirst(subject.county, property?.county, saleListing?.county) || "",
  parcelId:
    pickFirst(
      property?.apn,
      property?.parcelId,
      property?.parcelNumber,
      property?.assessorID,
      property?.assessorId
    ) || "",
  legalDescription:
    pickFirst(
      property?.legalDescription,
      property?.subdivision,
      property?.legalLot,
      property?.legalBlock
    ) || "",
  propertyType: pickFirst(subject.propertyType, property?.propertyType, saleListing?.propertyType) || "",
  bedrooms: pickFirst(
    numberOrNull(subject.bedrooms),
    numberOrNull(property?.bedrooms),
    numberOrNull(saleListing?.bedrooms)
  ),
  bathrooms: pickFirst(
    numberOrNull(subject.bathrooms),
    numberOrNull(property?.bathrooms),
    numberOrNull(saleListing?.bathrooms)
  ),
  squareFootage: pickFirst(
    numberOrNull(subject.squareFootage),
    numberOrNull(property?.squareFootage),
    numberOrNull(saleListing?.squareFootage)
  ),
  lotSize: pickFirst(numberOrNull(subject.lotSize), numberOrNull(property?.lotSize)),
  yearBuilt: pickFirst(
    numberOrNull(subject.yearBuilt),
    numberOrNull(property?.yearBuilt),
    numberOrNull(saleListing?.yearBuilt)
  ),
  unitCount: pickFirst(
    numberOrNull(subject.unitCount),
    resolveComparableUnitCount(property),
    resolveComparableUnitCount(saleListing)
  ),
  latitude: pickFirst(
    numberOrNull(subject.latitude),
    numberOrNull(property?.latitude),
    numberOrNull(saleListing?.latitude)
  ),
  longitude: pickFirst(
    numberOrNull(subject.longitude),
    numberOrNull(property?.longitude),
    numberOrNull(saleListing?.longitude)
  ),
  lastSalePrice: pickFirst(numberOrNull(subject.lastSalePrice), numberOrNull(property?.lastSalePrice)),
  lastSaleDate: pickFirst(subject.lastSaleDate, property?.lastSaleDate) || null,
  listingStatus: pickFirst(subject.listingStatus, saleListing?.status) || "",
  listedDate: pickFirst(subject.listedDate, saleListing?.listedDate) || null,
  daysOnMarket: pickFirst(numberOrNull(subject.daysOnMarket), numberOrNull(saleListing?.daysOnMarket)),
});

const buildFinancialSnapshot = ({
  subject = {},
  saleListing = null,
  valueSummary = null,
  rentSummary = null,
  compsSummary = null,
}) => {
  const askingPrice =
    pickFirst(numberOrNull(saleListing?.price), numberOrNull(subject.sellerAskingPrice)) || null;
  const annualizedRent = rentSummary?.estimatedRent ? rentSummary.estimatedRent * 12 : null;
  const pricingBasis =
    askingPrice ||
    pickFirst(
      numberOrNull(compsSummary?.estimatedValue),
      numberOrNull(valueSummary?.estimatedValue)
    ) ||
    null;

  return {
    askingPrice,
    estimatedValue:
      pickFirst(numberOrNull(compsSummary?.estimatedValue), numberOrNull(valueSummary?.estimatedValue)) ||
      null,
    estimatedValueLow:
      pickFirst(numberOrNull(compsSummary?.estimatedValueLow), numberOrNull(valueSummary?.low)) || null,
    estimatedValueHigh:
      pickFirst(numberOrNull(compsSummary?.estimatedValueHigh), numberOrNull(valueSummary?.high)) || null,
    estimatedRent: numberOrNull(rentSummary?.estimatedRent),
    estimatedRentLow: numberOrNull(rentSummary?.low),
    estimatedRentHigh: numberOrNull(rentSummary?.high),
    annualizedRent,
    grossYieldPercent: annualizedRent && pricingBasis ? (annualizedRent / pricingBasis) * 100 : null,
  };
};

const buildSourceSummary = ({
  propertyRecord,
  saleListing,
  rentalListing,
  valueSummary,
  rentSummary,
  aiReport,
}) => [
  { label: "RentCast property record", available: Boolean(propertyRecord) },
  { label: "RentCast sale listing", available: Boolean(saleListing) },
  { label: "RentCast rental listing", available: Boolean(rentalListing) },
  { label: "RentCast value estimate", available: Boolean(valueSummary?.estimatedValue) },
  { label: "RentCast rent estimate", available: Boolean(rentSummary?.estimatedRent) },
  { label: "OpenAI investor memo", available: Boolean(aiReport) },
];

const scoreComparable = (subject, comp, propertyTypeFilter = "") => {
  let score = 0;

  const activePropertyTypeFilter =
    propertyTypeFilter || derivePropertyTypeFilter(subject.propertyType, subject.unitCount);

  if (
    activePropertyTypeFilter &&
    !matchesPropertyTypeFilter(activePropertyTypeFilter, comp.propertyType, comp.unitCount)
  ) {
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
  const soldEstimate =
    subject.squareFootage && medianPricePerSqft
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
      occupancyStatus: subject.occupancyStatus,
      motivation: subject.motivation,
      targetOffer: subject.targetOffer,
      arv: subject.arv,
      rehabEstimate: subject.rehabEstimate,
      nextAction: subject.nextAction,
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

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a sharp acquisitions analyst for residential real estate. Use the comparable properties and valuation summary to write a practical recommendation for a real estate investor. Keep the tone concise, specific, and decision-oriented. Return valid JSON only.",
      },
      {
        role: "user",
        content: `Analyze this property and return JSON with exactly these keys:
- headline
- executiveSummary
- pricingRecommendation
- offerStrategy
- confidence
- riskFlags (array of strings)
- nextSteps (array of strings)

Confidence must be one of: Low, Medium, High.

Data:
${JSON.stringify(payload, null, 2)}`,
      },
    ],
  });

  return normalizeAiReport(JSON.parse(completion.choices[0].message.content));
};

const generateFullPropertyAiReport = async (payload) => {
  const openai = getOpenAIClient();
  if (!openai) return null;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a practical real-estate acquisitions analyst. Summarize source-backed property data into a concise investor memo. Do not invent missing facts. Return valid JSON only.",
      },
      {
        role: "user",
        content: `Analyze this property and return JSON with exactly these keys:
- headline
- executiveSummary
- ownershipTakeaway
- valuationTakeaway
- rentalTakeaway
- strengths (array of strings)
- risks (array of strings)
- nextSteps (array of strings)
- confidence

Confidence must be one of: Low, Medium, High.

Data:
${JSON.stringify(payload, null, 2)}`,
      },
    ],
  });

  return normalizeFullPropertyAiReport(JSON.parse(completion.choices[0].message.content));
};

const buildCompsAnalysis = async (subject, rawFilters = {}) => {
  const requestedRadius = clamp(numberOrNull(rawFilters.radius) ?? 1, 0.25, 10);
  const requestedSaleDateMonths = clamp(numberOrNull(rawFilters.saleDateMonths) ?? 6, 1, 60);
  const requestedMaxComps = clamp(numberOrNull(rawFilters.maxComps) ?? 8, 5, 12);
  const requestedPropertyType = String(rawFilters.propertyType || "").trim();
  const squareFootageInputs = [
    numberOrNull(rawFilters.minSquareFootage),
    numberOrNull(rawFilters.maxSquareFootage),
  ];
  const lotSizeInputs = [numberOrNull(rawFilters.minLotSize), numberOrNull(rawFilters.maxLotSize)];
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

  const avmValue = await fetchRentCastValueEstimate({
    ...subject,
    compCount: Math.max(requestedMaxComps, 20),
    maxRadius: requestedRadius,
    daysOld: Math.max(1, Math.round(requestedSaleDateMonths * 30)),
  }).catch((error) => {
    console.error("RentCast AVM lookup failed:", error.response?.data || error.message);
    return null;
  });

  const compCutoff = new Date();
  compCutoff.setMonth(compCutoff.getMonth() - requestedSaleDateMonths);

  const marketComps = toArray(avmValue?.comparables)
    .map(normalizeComparableSale)
    .filter((comp) => {
      if (!comp.salePrice) return false;
      if (!comp.saleDate) return true;
      const compDate = new Date(comp.saleDate);
      return Number.isFinite(compDate.valueOf()) ? compDate >= compCutoff : true;
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
    return {
      noResults: true,
      analysisFilters,
      avmValue,
      rankedComps: [],
      summary: null,
    };
  }

  const rankedComps = marketComps
    .map((comp) => ({
      ...comp,
      relevanceScore: scoreComparable(subject, comp, activePropertyTypeFilter),
    }))
    .sort((a, b) => a.relevanceScore - b.relevanceScore)
    .slice(0, requestedMaxComps)
    .map(({ relevanceScore, ...comp }) => comp);

  return {
    noResults: false,
    analysisFilters,
    avmValue,
    rankedComps,
    summary: summarizeComps(subject, rankedComps, avmValue),
  };
};

router.get("/", async (req, res) => {
  try {
    const address = String(req.query.address || "").trim();
    if (!address) {
      return res.status(400).json({ message: "Address is required." });
    }

    const radius = clamp(numberOrNull(req.query.radius) ?? numberOrNull(req.query.distance) ?? 1, 0.25, 10);
    const propertyType = String(req.query.propertyType || "").trim().toLowerCase();
    const minBeds = numberOrNull(req.query.minBeds);
    const maxBeds = numberOrNull(req.query.maxBeds);
    const minBaths = numberOrNull(req.query.minBaths);
    const maxBaths = numberOrNull(req.query.maxBaths);
    const minSqft = numberOrNull(req.query.minSqft);
    const maxSqft = numberOrNull(req.query.maxSqft);

    const subject = await getLeadPropertyPreview({ address });
    const avm = await fetchRentCastValueEstimate({
      ...subject,
      address: subject.address || address,
      compCount: 20,
      maxRadius: radius,
    });

    let comps = Array.isArray(avm?.comparables) ? avm.comparables.map(normalizeComparable) : [];

    if (radius) {
      comps = comps.filter((comp) => comp.distance === null || comp.distance <= radius);
    }

    if (propertyType) {
      comps = comps.filter((comp) => comp.propertyType.toLowerCase() === propertyType);
    }

    comps = comps.filter(
      (comp) =>
        matchesNumericRange(comp.beds, minBeds, maxBeds) &&
        matchesNumericRange(comp.baths, minBaths, maxBaths) &&
        matchesNumericRange(comp.sqft, minSqft, maxSqft)
    );

    res.json(comps);
  } catch (error) {
    console.error("Error fetching market comps:", error.response?.data || error.message);
    res.status(500).json({ message: "Failed to fetch comparable properties." });
  }
});

router.post("/report", async (req, res) => {
  try {
    const { subject: rawSubject = {}, ...rawFilters } = req.body || {};
    const subjectInput = normalizeSubjectInput(rawSubject);

    if (!subjectInput.address) {
      return res.status(400).json({ msg: "Address is required." });
    }

    const access = await getFeatureAccessState({
      user: req.user,
      featureKey: "comps_report",
    });

    if (!access.accessGranted) {
      return res.status(402).json({
        msg: access.hasActiveSubscription
          ? "You have used all 10 included Pro comps reports for this month."
          : "AI comps analysis requires Pro for standalone comps reports.",
      });
    }

    const preview = await getLeadPropertyPreview(subjectInput).catch(() => null);
    const subject = mergeSubjectWithPreview(subjectInput, preview || {});
    const compsAnalysis = await buildSharedCompsAnalysis(subject, rawFilters);

    if (compsAnalysis.noResults) {
      return res.status(200).json({
        noResults: true,
        msg: "No comparable properties matched the selected filters. Try widening the radius or relaxing the size filters.",
        subject,
        summary: null,
        comps: [],
        ai: null,
        filters: compsAnalysis.analysisFilters,
        valuationContext: compsAnalysis.valuationContext,
        generatedAt: null,
      });
    }

    const aiReport = await generateSharedAiReport(
      subject,
      compsAnalysis.summary,
      compsAnalysis.rankedComps,
      compsAnalysis.valuationContext,
      compsAnalysis.analysisFilters
    ).catch((error) => {
      console.error("Standalone AI report generation failed:", error.response?.data || error.message);
      return null;
    });

    if (access.accessSource === "subscription_included") {
      await recordFeatureUsage({
        userId: req.user.id,
        featureKey: "comps_report",
        resourceType: "comps_report",
        source: "subscription_included",
        metadata: {
          address: subject.address,
          mode: "comps_report",
          ...compsAnalysis.analysisFilters,
        },
      });
    }

    res.json({
      subject,
      summary: compsAnalysis.summary,
      comps: compsAnalysis.rankedComps,
      ai: aiReport,
      filters: compsAnalysis.analysisFilters,
      valuationContext: compsAnalysis.valuationContext,
      generatedAt: new Date(),
    });
  } catch (error) {
    console.error("Standalone comps report error:", error.response?.data || error.message);
    res.status(500).json({ msg: "Server error during comps analysis." });
  }
});

router.post("/report/full", async (req, res) => {
  try {
    const { subject: rawSubject = {}, ...rawFilters } = req.body || {};
    const subjectInput = normalizeSubjectInput(rawSubject);

    if (!subjectInput.address) {
      return res.status(400).json({ msg: "Address is required." });
    }

    const access = await getFeatureAccessState({
      user: req.user,
      featureKey: "comps_report",
    });

    if (!access.accessGranted) {
      return res.status(402).json({
        msg: access.hasActiveSubscription
          ? "You have used all 10 included Pro comps reports for this month."
          : "Full property analysis requires Pro for standalone property reports.",
      });
    }

    const [propertyRecord, saleListingRecord, rentalListingRecord] = await Promise.all([
      fetchRentCastProperty(subjectInput).catch((error) => {
        console.error("RentCast property lookup failed:", error.response?.data || error.message);
        return null;
      }),
      fetchRentCastSaleListing(subjectInput).catch((error) => {
        console.error("RentCast sale listing lookup failed:", error.response?.data || error.message);
        return null;
      }),
      fetchRentCastRentalListing(subjectInput).catch((error) => {
        console.error("RentCast rental listing lookup failed:", error.response?.data || error.message);
        return null;
      }),
    ]);

    const preview = formatPropertyPreview(subjectInput, propertyRecord, saleListingRecord);
    const subject = mergeSubjectWithPreview(subjectInput, preview || {});

    const compsAnalysis = await buildSharedCompsAnalysis(subject, rawFilters);
    const rentEstimateRecord = await fetchRentCastRentEstimate({
      ...subject,
      compCount: Math.max(compsAnalysis.analysisFilters.maxComps, 20),
      maxRadius: compsAnalysis.analysisFilters.radius,
      daysOld: Math.max(1, Math.round(compsAnalysis.analysisFilters.saleDateMonths * 30)),
    }).catch((error) => {
      console.error("RentCast rent estimate lookup failed:", error.response?.data || error.message);
      return null;
    });

    const overview = buildPropertyOverview(subject, propertyRecord, saleListingRecord);
    const owner = normalizeOwnerSummary(propertyRecord || {});
    const saleListing = normalizeListingSummary(saleListingRecord);
    const rentalListing = normalizeListingSummary(rentalListingRecord);
    const value = normalizeValueSummary(compsAnalysis.valuationContext);
    const rent = normalizeRentSummary(rentEstimateRecord);
    const features = buildFeatureEntries(propertyRecord || {});

    const assessmentHistory = sortByYearDesc(
      toArray(propertyRecord?.taxAssessments)
        .map(normalizeTaxAssessment)
        .filter((item) => Object.values(item).some(hasValue))
    );
    const history = sortByDateDesc(
      toArray(propertyRecord?.history)
        .map(normalizePropertyHistoryItem)
        .filter((item) => Object.values(item).some(hasValue))
    ).slice(0, 12);
    const metrics = buildFinancialSnapshot({
      subject,
      saleListing,
      valueSummary: value,
      rentSummary: rent,
      compsSummary: compsAnalysis.summary,
    });

    const aiPayload = {
      subject,
      overview,
      owner,
      saleListing,
      rentalListing,
      value,
      rent,
      metrics,
      taxHistory: assessmentHistory.slice(0, 5),
      history: history.slice(0, 8),
      features,
      compsSummary: {
        noResults: compsAnalysis.noResults,
        summary: compsAnalysis.summary,
        filters: compsAnalysis.analysisFilters,
        comps: compsAnalysis.rankedComps.slice(0, 5).map((comp) => ({
          address: comp.address,
          salePrice: comp.salePrice,
          saleDate: comp.saleDate,
          distance: comp.distance,
          squareFootage: comp.squareFootage,
          bedrooms: comp.bedrooms,
          bathrooms: comp.bathrooms,
        })),
      },
    };

    const aiReport = await generateFullPropertyAiReport(aiPayload).catch((error) => {
      console.error("Full property AI report generation failed:", error.response?.data || error.message);
      return null;
    });

    if (access.accessSource === "subscription_included") {
      await recordFeatureUsage({
        userId: req.user.id,
        featureKey: "comps_report",
        resourceType: "property_report",
        source: "subscription_included",
        metadata: {
          address: subject.address,
          mode: "full_property_analysis",
          ...compsAnalysis.analysisFilters,
        },
      });
    }

    res.json({
      subject,
      overview,
      metrics,
      owner,
      saleListing,
      rentalListing,
      taxes: {
        latest: assessmentHistory[0] || null,
        history: assessmentHistory,
      },
      history,
      features,
      value,
      rent,
      compsSummary: {
        noResults: compsAnalysis.noResults,
        summary: compsAnalysis.summary,
        comps: compsAnalysis.rankedComps,
        filters: compsAnalysis.analysisFilters,
      },
      ai: aiReport,
      sources: buildSourceSummary({
        propertyRecord,
        saleListing: saleListingRecord,
        rentalListing: rentalListingRecord,
        valueSummary: value,
        rentSummary: rent,
        aiReport,
      }),
      generatedAt: new Date(),
    });
  } catch (error) {
    console.error("Standalone full property report error:", error.response?.data || error.message);
    res.status(500).json({ msg: "Server error during property analysis." });
  }
});

module.exports = router;
