const OpenAI = require("openai");
const {
  fetchRentCastValueEstimate,
  numberOrNull,
} = require("./leadPropertyService");

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
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed / 1000) * 1000;
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

const toArray = (value) => (Array.isArray(value) ? value : []);

const pickFirst = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== "");

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

const matchesNumericRange = (value, min, max) => {
  const hasRange =
    (min !== null && min !== undefined) || (max !== null && max !== undefined);
  if (hasRange && (value === null || value === undefined)) return false;
  if (min !== null && min !== undefined && value < min) return false;
  if (max !== null && max !== undefined && value > max) return false;
  return true;
};

const buildComparableId = (comp = {}, fallbackIndex = 0) => {
  if (comp.id) return String(comp.id);

  const parts = [
    comp.formattedAddress ||
      [comp.addressLine1, comp.addressLine2, comp.city, comp.state, comp.zipCode]
        .filter(Boolean)
        .join(", ") ||
      comp.address,
    comp.lastSaleDate || comp.saleDate || comp.listedDate || comp.removedDate || "",
    comp.price || comp.salePrice || "",
    comp.latitude || comp.lat || "",
    comp.longitude || comp.lng || "",
    fallbackIndex,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return parts.join("|") || `comp-${fallbackIndex}`;
};

const normalizeComparableSale = (comp = {}, fallbackIndex = 0) => ({
  id: buildComparableId(comp, fallbackIndex),
  address:
    comp.formattedAddress ||
    comp.address ||
    [comp.addressLine1, comp.addressLine2, comp.city, comp.state, comp.zipCode]
      .filter(Boolean)
      .join(", "),
  propertyType: comp.propertyType || "",
  unitCount: resolveComparableUnitCount(comp),
  salePrice: numberOrNull(comp.price ?? comp.salePrice),
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
  latitude: numberOrNull(comp.latitude ?? comp.lat),
  longitude: numberOrNull(comp.longitude ?? comp.lng),
  pricePerSqft:
    numberOrNull(comp.pricePerSqft) ??
    (numberOrNull(comp.price ?? comp.salePrice) && numberOrNull(comp.squareFootage)
      ? numberOrNull(comp.price ?? comp.salePrice) / numberOrNull(comp.squareFootage)
      : null),
  status: comp.status || "",
  listingType: comp.listingType || "",
  removedDate: comp.removedDate || null,
  daysOnMarket: numberOrNull(comp.daysOnMarket),
});

const sanitizeSelectedComparable = (comp = {}, fallbackIndex = 0) => {
  const normalized = normalizeComparableSale(comp, fallbackIndex);
  if (!normalized.address || !normalized.salePrice) {
    return null;
  }

  return normalized;
};

const buildValuationContext = (avmValue = {}) => {
  if (!avmValue) return null;

  return {
    price: numberOrNull(avmValue?.price),
    priceRangeLow: numberOrNull(avmValue?.priceRangeLow),
    priceRangeHigh: numberOrNull(avmValue?.priceRangeHigh),
  };
};

const scoreComparable = (subject, comp, propertyTypeFilter = "", searchRadius = 1) => {
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
    // Treat radius as part of the ranking context so widening the search
    // meaningfully relaxes the distance penalty instead of returning the
    // exact same nearest-only set in dense markets.
    score += (comp.distance / Math.max(searchRadius, 0.25)) * 0.75;
  }

  if (comp.saleDate) {
    const soldAt = new Date(comp.saleDate);
    const daysAgo = (Date.now() - soldAt.valueOf()) / (1000 * 60 * 60 * 24);
    score += Math.max(daysAgo, 0) / 365;
  }

  return score;
};

const summarizeComps = (subject, comps, valuationContext = null) => {
  const normalizedComps = toArray(comps).map((comp, index) => sanitizeSelectedComparable(comp, index)).filter(Boolean);
  const salePrices = normalizedComps.map((comp) => comp.salePrice).filter(Boolean);
  const pricePerSqftValues = normalizedComps.map((comp) => comp.pricePerSqft).filter(Boolean);
  const daysOnMarketValues = normalizedComps.map((comp) => comp.daysOnMarket).filter((value) => value !== null && value !== undefined);
  const medianPricePerSqft = median(pricePerSqftValues);
  const soldEstimate =
    subject.squareFootage && medianPricePerSqft
      ? medianPricePerSqft * subject.squareFootage
      : median(salePrices);

  const estimatedValue = valuationContext?.price || soldEstimate;
  const estimatedValueLow =
    valuationContext?.priceRangeLow || (estimatedValue ? estimatedValue * 0.94 : null);
  const estimatedValueHigh =
    valuationContext?.priceRangeHigh || (estimatedValue ? estimatedValue * 1.06 : null);
  const askingPrice = numberOrNull(subject.sellerAskingPrice);
  const askingPriceDelta = askingPrice && estimatedValue ? askingPrice - estimatedValue : null;

  return {
    saleCompCount: normalizedComps.length,
    averageSoldPrice: roundCurrency(average(salePrices)),
    medianSoldPrice: roundCurrency(median(salePrices)),
    lowSoldPrice: salePrices.length ? roundCurrency(Math.min(...salePrices)) : null,
    highSoldPrice: salePrices.length ? roundCurrency(Math.max(...salePrices)) : null,
    averagePricePerSqft: average(pricePerSqftValues) ? Math.round(average(pricePerSqftValues)) : null,
    medianPricePerSqft: medianPricePerSqft ? Math.round(medianPricePerSqft) : null,
    lowPricePerSqft: pricePerSqftValues.length ? Math.round(Math.min(...pricePerSqftValues)) : null,
    highPricePerSqft: pricePerSqftValues.length ? Math.round(Math.max(...pricePerSqftValues)) : null,
    averageDaysOnMarket: daysOnMarketValues.length ? Math.round(average(daysOnMarketValues)) : null,
    medianDaysOnMarket: daysOnMarketValues.length ? Math.round(median(daysOnMarketValues)) : null,
    lowDaysOnMarket: daysOnMarketValues.length ? Math.min(...daysOnMarketValues) : null,
    highDaysOnMarket: daysOnMarketValues.length ? Math.max(...daysOnMarketValues) : null,
    estimatedValue: roundCurrency(estimatedValue),
    estimatedValueLow: roundCurrency(estimatedValueLow),
    estimatedValueHigh: roundCurrency(estimatedValueHigh),
    askingPrice,
    askingPriceDelta: roundCurrency(askingPriceDelta),
    recommendedOfferLow: estimatedValueLow ? roundCurrency(estimatedValueLow * 0.98) : null,
    recommendedOfferHigh: estimatedValue ? roundCurrency(estimatedValue) : null,
  };
};

const generateAiReport = async (
  subject,
  summary,
  comps,
  valuationContext = null,
  analysisFilters = null
) => {
  const openai = getOpenAIClient();
  if (!openai) return null;

  const normalizedComps = toArray(comps)
    .map((comp, index) => sanitizeSelectedComparable(comp, index))
    .filter(Boolean);

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
      targetOffer: subject.targetOffer,
      arv: subject.arv,
      rehabEstimate: subject.rehabEstimate,
      occupancyStatus: subject.occupancyStatus,
      motivation: subject.motivation,
      listingStatus: subject.listingStatus,
      daysOnMarket: subject.daysOnMarket,
      lastSalePrice: subject.lastSalePrice,
      lastSaleDate: subject.lastSaleDate,
    },
    summary,
    avm: valuationContext,
    filtersUsed: analysisFilters,
    selectedComparables: normalizedComps.map((comp) => ({
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
      daysOnMarket: comp.daysOnMarket,
    })),
  };

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a sharp acquisitions analyst for residential real estate. Use the selected comparable properties and valuation summary to write a practical recommendation for a real estate investor. Keep the tone concise, specific, and decision-oriented. Return valid JSON only.",
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
    // Pull the maximum comparable set allowed by RentCast so a wider radius
    // can actually surface additional candidate comps before local ranking.
    compCount: 25,
    maxRadius: requestedRadius,
    daysOld: Math.max(1, Math.round(requestedSaleDateMonths * 30)),
  }).catch((error) => {
    console.error("RentCast AVM lookup failed:", error.response?.data || error.message);
    return null;
  });

  const valuationContext = buildValuationContext(avmValue);

  const compCutoff = new Date();
  compCutoff.setMonth(compCutoff.getMonth() - requestedSaleDateMonths);

  const marketComps = toArray(avmValue?.comparables)
    .map((comp, index) => normalizeComparableSale(comp, index))
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
      valuationContext,
      rankedComps: [],
      summary: null,
    };
  }

  const rankedComps = marketComps
    .map((comp) => ({
      ...comp,
      relevanceScore: scoreComparable(
        subject,
        comp,
        activePropertyTypeFilter,
        requestedRadius
      ),
    }))
    .sort((a, b) => a.relevanceScore - b.relevanceScore)
    .slice(0, requestedMaxComps)
    .map(({ relevanceScore, ...comp }) => comp);

  return {
    noResults: false,
    analysisFilters,
    valuationContext,
    rankedComps,
    summary: summarizeComps(subject, rankedComps, valuationContext),
  };
};

const buildLegacyCompsAnalysisSnapshot = ({
  generatedAt = new Date(),
  filters = {},
  valuationContext = null,
  summary = {},
  aiReport = null,
  comps = [],
}) => ({
  generatedAt,
  filters,
  valuationContext: valuationContext || undefined,
  estimatedValue: summary.estimatedValue ?? null,
  estimatedValueLow: summary.estimatedValueLow ?? null,
  estimatedValueHigh: summary.estimatedValueHigh ?? null,
  averageSoldPrice: summary.averageSoldPrice ?? null,
  medianSoldPrice: summary.medianSoldPrice ?? null,
  lowSoldPrice: summary.lowSoldPrice ?? null,
  highSoldPrice: summary.highSoldPrice ?? null,
  averagePricePerSqft: summary.averagePricePerSqft ?? null,
  medianPricePerSqft: summary.medianPricePerSqft ?? null,
  lowPricePerSqft: summary.lowPricePerSqft ?? null,
  highPricePerSqft: summary.highPricePerSqft ?? null,
  averageDaysOnMarket: summary.averageDaysOnMarket ?? null,
  medianDaysOnMarket: summary.medianDaysOnMarket ?? null,
  lowDaysOnMarket: summary.lowDaysOnMarket ?? null,
  highDaysOnMarket: summary.highDaysOnMarket ?? null,
  saleCompCount: summary.saleCompCount ?? null,
  askingPriceDelta: summary.askingPriceDelta ?? null,
  recommendedOfferLow: summary.recommendedOfferLow ?? null,
  recommendedOfferHigh: summary.recommendedOfferHigh ?? null,
  report: aiReport || undefined,
  recentComps: toArray(comps)
    .map((comp, index) => sanitizeSelectedComparable(comp, index))
    .filter(Boolean)
    .map((comp) => ({
      id: comp.id,
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
      latitude: comp.latitude,
      longitude: comp.longitude,
      status: comp.status,
      listingType: comp.listingType,
      removedDate: comp.removedDate,
      daysOnMarket: comp.daysOnMarket,
    })),
});

module.exports = {
  buildComparableId,
  buildCompsAnalysis,
  buildLegacyCompsAnalysisSnapshot,
  buildValuationContext,
  clamp,
  derivePropertyTypeFilter,
  generateAiReport,
  matchesNumericRange,
  matchesPropertyTypeFilter,
  normalizeComparableSale,
  resolveComparableUnitCount,
  roundCurrency,
  sanitizeSelectedComparable,
  summarizeComps,
};
