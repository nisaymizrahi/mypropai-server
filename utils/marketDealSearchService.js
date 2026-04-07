const OpenAI = require("openai");

const {
  fetchRentCastRentEstimate,
  fetchRentCastSaleListingById,
  fetchRentCastValueEstimate,
  numberOrNull,
  searchRentCastSaleListings,
} = require("./leadPropertyService");
const { normalizeSaleListing } = require("./marketSearchService");
const { normalizePropertyStrategy } = require("./propertyStrategy");

const DEAL_SEARCH_CACHE_TTL_MS = 45 * 1000;
const DEFAULT_RADIUS_MILES = 10;
const COUNTY_RADIUS_MILES = 18;
const MAX_RADIUS_MILES = 50;
const MAX_LOCATIONS = 8;
const SEARCH_LIMIT_PER_LOCATION = 60;
const ENRICHMENT_LIMIT = 12;
const RESULT_LIMIT = 10;
const MIN_VISIBLE_SCORE = 50;
const searchCache = new Map();

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const normalizeString = (value) => {
  if (value === undefined || value === null) return "";
  return String(value).trim();
};

const normalizeOptionalUrl = (value) => {
  const normalized = normalizeString(value);
  if (!normalized) return "";

  try {
    const url = new URL(normalized);
    if (!["http:", "https:"].includes(url.protocol)) {
      return "";
    }
    return url.toString();
  } catch (error) {
    return "";
  }
};

const buildGoogleSearchUrl = (listing = {}) => {
  const query = [
    listing.address,
    listing.city,
    listing.state,
    listing.zipCode,
    listing.mlsNumber ? `MLS ${listing.mlsNumber}` : "",
    "for sale",
  ]
    .filter(Boolean)
    .join(" ");

  if (!query) {
    return "";
  }

  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
};

const pickFirstUrl = (...candidates) => {
  for (const candidate of candidates.flat()) {
    const normalized = normalizeOptionalUrl(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return "";
};

const buildSourceLink = (rawListing = {}, listing = {}) => {
  const directListingUrl = pickFirstUrl(
    rawListing.url,
    rawListing.href,
    rawListing.link,
    rawListing.listingUrl,
    rawListing.sourceUrl,
    rawListing.propertyUrl,
    rawListing.permalink,
    rawListing.website
  );

  if (directListingUrl) {
    return { sourceUrl: directListingUrl, sourceLinkType: "listing" };
  }

  const mlsUrl = pickFirstUrl(
    rawListing.mlsUrl,
    rawListing.mls?.url,
    rawListing.mls?.website,
    rawListing.mlsRecordUrl
  );

  if (mlsUrl) {
    return { sourceUrl: mlsUrl, sourceLinkType: "mls" };
  }

  const officeUrl = pickFirstUrl(
    rawListing.listingOffice?.website,
    rawListing.listingOffice?.url,
    rawListing.listingOffice?.officeUrl,
    rawListing.listingOfficeUrl,
    rawListing.office?.website,
    rawListing.office?.url
  );

  if (officeUrl) {
    return { sourceUrl: officeUrl, sourceLinkType: "office" };
  }

  const agentUrl = pickFirstUrl(
    rawListing.listingAgent?.website,
    rawListing.listingAgent?.url,
    rawListing.listingAgent?.profileUrl,
    rawListing.agent?.website,
    rawListing.agent?.url
  );

  if (agentUrl) {
    return { sourceUrl: agentUrl, sourceLinkType: "agent" };
  }

  const fallbackUrl = buildGoogleSearchUrl(listing);
  if (fallbackUrl) {
    return { sourceUrl: fallbackUrl, sourceLinkType: "search" };
  }

  return { sourceUrl: "", sourceLinkType: "" };
};

const haversineMiles = (leftLat, leftLng, rightLat, rightLng) => {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const deltaLat = toRadians(rightLat - leftLat);
  const deltaLng = toRadians(rightLng - leftLng);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(toRadians(leftLat)) *
      Math.cos(toRadians(rightLat)) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);

  return earthRadiusMiles * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

const normalizeViewport = (input = {}) => {
  const north = numberOrNull(input.north);
  const south = numberOrNull(input.south);
  const east = numberOrNull(input.east);
  const west = numberOrNull(input.west);

  if ([north, south, east, west].some((value) => value === null)) {
    return null;
  }

  if (north <= south || east <= west) {
    return null;
  }

  return { north, south, east, west };
};

const normalizeBbox = (input = {}) => {
  const north = numberOrNull(input.north || input.maxLat);
  const south = numberOrNull(input.south || input.minLat);
  const east = numberOrNull(input.east || input.maxLng);
  const west = numberOrNull(input.west || input.minLng);

  if ([north, south, east, west].some((value) => value === null)) {
    return null;
  }

  if (north <= south || east <= west) {
    return null;
  }

  return { north, south, east, west };
};

const buildSearchAreaFromBounds = (bounds) => {
  if (!bounds) {
    return null;
  }

  const centerLatitude = (bounds.north + bounds.south) / 2;
  const centerLongitude = (bounds.east + bounds.west) / 2;
  const cornerDistances = [
    haversineMiles(centerLatitude, centerLongitude, bounds.north, bounds.east),
    haversineMiles(centerLatitude, centerLongitude, bounds.north, bounds.west),
    haversineMiles(centerLatitude, centerLongitude, bounds.south, bounds.east),
    haversineMiles(centerLatitude, centerLongitude, bounds.south, bounds.west),
  ];

  return {
    latitude: centerLatitude,
    longitude: centerLongitude,
    radiusMiles: clamp(Math.max(...cornerDistances) * 1.15, 1, MAX_RADIUS_MILES),
  };
};

const listingWithinViewport = (listing = {}, viewport) => {
  if (!viewport) return true;

  const latitude = numberOrNull(listing.latitude);
  const longitude = numberOrNull(listing.longitude);
  if (latitude === null || longitude === null) {
    return false;
  }

  return (
    latitude <= viewport.north &&
    latitude >= viewport.south &&
    longitude <= viewport.east &&
    longitude >= viewport.west
  );
};

const normalizeAssetTypes = (value) => {
  const items = Array.isArray(value) ? value : [value];
  return [...new Set(items.map((item) => normalizeString(item)).filter(Boolean))];
};

const normalizeBrief = (input = {}) => {
  const strategy = normalizePropertyStrategy(input.strategy || "flip");
  const safeStrategy = strategy === "fix_and_rent" ? "fix_and_rent" : "flip";
  const priceValues = [numberOrNull(input.minPrice), numberOrNull(input.maxPrice)].filter(
    (value) => value !== null
  );

  return {
    strategy: safeStrategy,
    objective: normalizeString(input.objective),
    renovationPreference: normalizeString(input.renovationPreference),
    minPrice: priceValues.length ? Math.min(...priceValues) : null,
    maxPrice: priceValues.length ? Math.max(...priceValues) : null,
    assetTypes: normalizeAssetTypes(input.assetTypes),
  };
};

const normalizeFilters = (input = {}) => {
  const minPrice = numberOrNull(input.minPrice);
  const maxPrice = numberOrNull(input.maxPrice);

  return {
    radius: clamp(numberOrNull(input.radius) || DEFAULT_RADIUS_MILES, 1, MAX_RADIUS_MILES),
    minPrice: minPrice !== null && maxPrice !== null ? Math.min(minPrice, maxPrice) : minPrice,
    maxPrice: minPrice !== null && maxPrice !== null ? Math.max(minPrice, maxPrice) : maxPrice,
    minBedrooms: numberOrNull(input.minBedrooms),
    maxBedrooms: numberOrNull(input.maxBedrooms),
    minBathrooms: numberOrNull(input.minBathrooms),
    maxBathrooms: numberOrNull(input.maxBathrooms),
    propertyType: normalizeString(input.propertyType),
    minSquareFootage: numberOrNull(input.minSquareFootage),
    maxSquareFootage: numberOrNull(input.maxSquareFootage),
    minLotSize: numberOrNull(input.minLotSize),
    maxLotSize: numberOrNull(input.maxLotSize),
    minYearBuilt: numberOrNull(input.minYearBuilt),
    maxYearBuilt: numberOrNull(input.maxYearBuilt),
    maxDaysOnMarket: numberOrNull(input.maxDaysOnMarket),
    limit: clamp(Math.round(numberOrNull(input.limit) || SEARCH_LIMIT_PER_LOCATION), 1, SEARCH_LIMIT_PER_LOCATION),
  };
};

const inferLocationType = (location = {}) => {
  if (normalizeString(location.type)) {
    return normalizeString(location.type);
  }

  if (normalizeString(location.zipCode)) {
    return "zip";
  }

  if (normalizeString(location.county) || /county/i.test(normalizeString(location.label))) {
    return "county";
  }

  if (normalizeString(location.city)) {
    return "city";
  }

  return "custom";
};

const normalizeLocations = (locations = []) =>
  locations
    .slice(0, MAX_LOCATIONS)
    .map((location, index) => ({
      id: normalizeString(location.id) || `location-${index + 1}`,
      label: normalizeString(location.label || location.address || location.query),
      type: inferLocationType(location),
      address: normalizeString(location.address),
      city: normalizeString(location.city),
      state: normalizeString(location.state),
      zipCode: normalizeString(location.zipCode),
      county: normalizeString(location.county),
      latitude: numberOrNull(location.latitude),
      longitude: numberOrNull(location.longitude),
      bbox: normalizeBbox(location.bbox || location.viewport || {}),
    }))
    .filter(
      (location) =>
        location.label ||
        location.address ||
        location.zipCode ||
        location.city ||
        location.county ||
        (location.latitude !== null && location.longitude !== null)
    );

const buildSearchCacheKey = ({ brief, filters, locations, viewport }) =>
  JSON.stringify({ brief, filters, locations, viewport });

const pruneExpiredCache = () => {
  const now = Date.now();
  for (const [cacheKey, entry] of searchCache.entries()) {
    if (entry.expiresAt <= now) {
      searchCache.delete(cacheKey);
    }
  }

  if (searchCache.size <= 100) {
    return;
  }

  const keys = [...searchCache.keys()];
  keys.slice(0, searchCache.size - 100).forEach((cacheKey) => searchCache.delete(cacheKey));
};

const getCachedSearch = (cacheKey) => {
  pruneExpiredCache();
  const cachedEntry = searchCache.get(cacheKey);
  if (!cachedEntry) {
    return null;
  }

  if (cachedEntry.expiresAt <= Date.now()) {
    searchCache.delete(cacheKey);
    return null;
  }

  return cachedEntry.value;
};

const setCachedSearch = (cacheKey, value) => {
  pruneExpiredCache();
  searchCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + DEAL_SEARCH_CACHE_TTL_MS,
  });
};

const normalizePropertyTypeKey = (value) =>
  normalizeString(value)
    .toLowerCase()
    .replace(/[_\s]+/g, "-");

const matchesAssetTypes = (listing = {}, assetTypes = []) => {
  if (!assetTypes.length) {
    return true;
  }

  const normalizedType = normalizePropertyTypeKey(listing.propertyType);
  return assetTypes.some((assetType) => normalizePropertyTypeKey(assetType) === normalizedType);
};

const dedupeListings = (listings = []) => {
  const listingMap = new Map();

  listings.forEach((listing) => {
    const listingKey = normalizeString(listing.listingId)
      ? `listing:${normalizeString(listing.listingId)}`
      : `address:${normalizeString(listing.address).toLowerCase()}`;

    if (!listingMap.has(listingKey)) {
      listingMap.set(listingKey, listing);
      return;
    }

    const existing = listingMap.get(listingKey);
    const existingLocations = new Set(existing.matchedLocationIds || []);
    (listing.matchedLocationIds || []).forEach((locationId) => existingLocations.add(locationId));
    listingMap.set(listingKey, {
      ...existing,
      matchedLocationIds: [...existingLocations],
    });
  });

  return [...listingMap.values()];
};

const getMarketSearchHealthStatus = () => {
  const rentCastConfigured = Boolean(normalizeString(process.env.RENTCAST_API_KEY));
  const openAiConfigured = Boolean(normalizeString(process.env.OPENAI_API_KEY));

  let status = "down";
  let searchMode = "offline";
  let summary = "RentCast is not configured, so AI market search cannot load live listings yet.";

  if (rentCastConfigured && openAiConfigured) {
    status = "healthy";
    searchMode = "rentcast_plus_openai";
    summary = "RentCast listings and OpenAI deal scoring are both connected.";
  } else if (rentCastConfigured) {
    status = "degraded";
    searchMode = "rentcast_only";
    summary =
      "RentCast is connected and search is live. OpenAI scoring is in fallback mode, so ranking will use heuristics until OPENAI_API_KEY is configured.";
  }

  return {
    checkedAt: new Date().toISOString(),
    status,
    ready: rentCastConfigured,
    searchMode,
    summary,
    services: {
      rentcast: {
        configured: rentCastConfigured,
        required: true,
        status: rentCastConfigured ? "connected" : "missing",
        impact: rentCastConfigured
          ? "Live listings and valuation enrichment are available."
          : "Deal search cannot return live listings until RENTCAST_API_KEY is configured.",
      },
      openai: {
        configured: openAiConfigured,
        required: false,
        status: openAiConfigured ? "connected" : "fallback",
        impact: openAiConfigured
          ? "AI ranking and rationale are enabled."
          : "Search still works with heuristic scoring until OPENAI_API_KEY is configured.",
      },
    },
  };
};

const getOpenAIClient = () => {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
};

const lower = (value) => normalizeString(value).toLowerCase();

const buildRenovationFit = ({ listing, brief, valueEstimate }) => {
  const preference = lower(brief.renovationPreference);
  const objective = lower(brief.objective);
  const fullContext = `${preference} ${objective}`.trim();
  const yearBuilt = numberOrNull(listing.yearBuilt) || 0;
  const price = numberOrNull(listing.price) || 0;
  const estimatedValue = numberOrNull(valueEstimate?.price);
  const upsideRatio =
    estimatedValue && price > 0 ? Math.max((estimatedValue - price) / price, 0) : 0;

  if (/full gut|major rehab|heavy rehab|extensive/.test(fullContext)) {
    if (yearBuilt <= 1975 || upsideRatio >= 0.18) {
      return {
        label: "Good fit for heavy rehab",
        scoreDelta: 10,
      };
    }

    return {
      label: "Looks lighter than a full-gut target",
      scoreDelta: -6,
    };
  }

  if (/cosmetic|light rehab|paint|turnover|minor/.test(fullContext)) {
    if (yearBuilt >= 1985 || upsideRatio <= 0.12) {
      return {
        label: "Closer to cosmetic scope",
        scoreDelta: 8,
      };
    }

    return {
      label: "May require more than light rehab",
      scoreDelta: -8,
    };
  }

  if (/avoid foundation|avoid structural|avoid major systems/.test(fullContext)) {
    if (yearBuilt >= 1980) {
      return {
        label: "Signals lower major-system risk",
        scoreDelta: 6,
      };
    }

    return {
      label: "Older-vintage asset may need deeper diligence",
      scoreDelta: -5,
    };
  }

  if (yearBuilt <= 1980 || upsideRatio >= 0.15) {
    return {
      label: "Likely rehab candidate",
      scoreDelta: 4,
    };
  }

  return {
    label: "Likely lighter renovation profile",
    scoreDelta: 2,
  };
};

const buildStrategySignals = ({ brief, listing, valueEstimate, rentEstimate }) => {
  const price = numberOrNull(listing.price) || 0;
  const estimatedValue = numberOrNull(valueEstimate?.price);
  const estimatedRent = numberOrNull(rentEstimate?.rent);
  const reasons = [];
  const risks = [];
  let score = 50;
  let nextStep = "Open the listing and confirm condition before moving it into Potential Properties.";

  if (brief.strategy === "fix_and_rent") {
    const monthlyRent = estimatedRent || 0;
    const annualRent = monthlyRent * 12;
    const grossYield = price > 0 ? annualRent / price : 0;

    if (grossYield >= 0.12) {
      score += 18;
      reasons.push("Estimated rent looks strong relative to the asking price.");
      nextStep =
        "Verify rent assumptions, confirm scope, and move it into Potential Properties for hold underwriting.";
    } else if (grossYield >= 0.09) {
      score += 10;
      reasons.push("Rent coverage looks workable for a fix-and-rent screen.");
    } else if (monthlyRent > 0) {
      score -= 8;
      risks.push("Estimated rent may be thin for the current price.");
    } else {
      score -= 4;
      risks.push("Rent estimate is missing, so the hold case still needs validation.");
    }

    if (estimatedValue && price > 0 && estimatedValue >= price) {
      score += 6;
      reasons.push("Value estimate supports the basis while you underwrite the hold case.");
    }
  } else {
    if (estimatedValue && price > 0) {
      const spreadRatio = (estimatedValue - price) / price;
      if (spreadRatio >= 0.18) {
        score += 18;
        reasons.push("The value spread leaves room for a flip-style margin.");
        nextStep =
          "Confirm rehab scope, tighten the buy box, and move it into Potential Properties for flip analysis.";
      } else if (spreadRatio >= 0.1) {
        score += 10;
        reasons.push("There appears to be enough spread to justify deeper flip diligence.");
      } else if (spreadRatio < 0) {
        score -= 14;
        risks.push("Estimated value is under the asking price.");
      } else {
        score -= 3;
        risks.push("The spread is narrow unless the renovation scope stays disciplined.");
      }
    } else {
      score -= 4;
      risks.push("Value estimate is missing, so resale upside is still uncertain.");
    }

    if (numberOrNull(listing.daysOnMarket) && Number(listing.daysOnMarket) <= 14) {
      score += 4;
      reasons.push("Fresh inventory may still offer motivated acquisition timing.");
    }
  }

  return {
    score,
    reasons,
    risks,
    nextStep,
  };
};

const buildHeuristicMatch = ({ brief, listing, valueEstimate = null, rentEstimate = null }) => {
  const signals = buildStrategySignals({ brief, listing, valueEstimate, rentEstimate });
  const renovationFit = buildRenovationFit({ listing, brief, valueEstimate });
  let score = signals.score + renovationFit.scoreDelta;
  const reasons = [...signals.reasons];
  const riskFlags = [...signals.risks];

  if (numberOrNull(listing.daysOnMarket) && Number(listing.daysOnMarket) >= 75) {
    score -= 4;
    riskFlags.push("Long market time can signal pricing or condition friction.");
  }

  if (!listing.photoUrl) {
    score -= 3;
    riskFlags.push("Listing has limited marketing detail, so condition confidence is lower.");
  }

  if (!normalizeString(listing.propertyType)) {
    riskFlags.push("Property type is incomplete in the source record.");
  }

  if (listing.matchedLocationIds?.length > 1) {
    reasons.push("This property surfaced across more than one selected market focus.");
    score += 2;
  }

  score = clamp(Math.round(score), 18, 95);

  let verdict = "watch";
  if (score >= 74) {
    verdict = "strong";
  } else if (score < MIN_VISIBLE_SCORE) {
    verdict = "weak";
  }

  const summaryParts = [
    signals.reasons[0],
    signals.risks[0],
    `Renovation fit: ${renovationFit.label.toLowerCase()}.`,
  ].filter(Boolean);

  return {
    score,
    verdict,
    strategyFit:
      brief.strategy === "fix_and_rent" ? "Aligned with fix-and-rent criteria" : "Aligned with flip criteria",
    renovationFit: renovationFit.label,
    summary:
      summaryParts[0] ||
      "This listing broadly matches the investor brief, but the core assumptions still need confirmation.",
    reasons: reasons.slice(0, 3),
    riskFlags: [...new Set(riskFlags)].slice(0, 3),
    nextStep: signals.nextStep,
    rentEstimate: rentEstimate
      ? {
          rent: numberOrNull(rentEstimate.rent),
          rentRangeLow: numberOrNull(rentEstimate.rentRangeLow),
          rentRangeHigh: numberOrNull(rentEstimate.rentRangeHigh),
        }
      : null,
    valueEstimate: valueEstimate
      ? {
          price: numberOrNull(valueEstimate.price),
          priceRangeLow: numberOrNull(valueEstimate.priceRangeLow),
          priceRangeHigh: numberOrNull(valueEstimate.priceRangeHigh),
        }
      : null,
  };
};

const buildAiPromptPayload = (brief, candidates = []) => ({
  brief,
  candidates: candidates.map((candidate) => ({
    listingId: candidate.listingId,
    address: candidate.address,
    city: candidate.city,
    state: candidate.state,
    zipCode: candidate.zipCode,
    price: candidate.price,
    propertyType: candidate.propertyType,
    bedrooms: candidate.bedrooms,
    bathrooms: candidate.bathrooms,
    squareFootage: candidate.squareFootage,
    yearBuilt: candidate.yearBuilt,
    daysOnMarket: candidate.daysOnMarket,
    sourceLinkType: candidate.sourceLinkType,
    heuristicMatch: candidate.match,
  })),
});

const applyAiEvaluations = (candidates = [], evaluations = []) => {
  if (!Array.isArray(evaluations) || !evaluations.length) {
    return candidates;
  }

  const evaluationMap = new Map(
    evaluations
      .filter((entry) => normalizeString(entry.listingId))
      .map((entry) => [normalizeString(entry.listingId), entry])
  );

  return candidates.map((candidate) => {
    const evaluation = evaluationMap.get(normalizeString(candidate.listingId));
    if (!evaluation) {
      return candidate;
    }

    const score = clamp(Math.round(numberOrNull(evaluation.score) || candidate.match.score), 18, 95);
    const normalizedVerdict = ["strong", "watch", "weak"].includes(lower(evaluation.verdict))
      ? lower(evaluation.verdict)
      : candidate.match.verdict;

    return {
      ...candidate,
      match: {
        ...candidate.match,
        score,
        verdict: normalizedVerdict,
        strategyFit: normalizeString(evaluation.strategyFit) || candidate.match.strategyFit,
        renovationFit: normalizeString(evaluation.renovationFit) || candidate.match.renovationFit,
        summary: normalizeString(evaluation.summary) || candidate.match.summary,
        reasons: Array.isArray(evaluation.reasons) && evaluation.reasons.length
          ? evaluation.reasons.map((item) => normalizeString(item)).filter(Boolean).slice(0, 3)
          : candidate.match.reasons,
        riskFlags: Array.isArray(evaluation.riskFlags) && evaluation.riskFlags.length
          ? evaluation.riskFlags.map((item) => normalizeString(item)).filter(Boolean).slice(0, 3)
          : candidate.match.riskFlags,
        nextStep: normalizeString(evaluation.nextStep) || candidate.match.nextStep,
      },
    };
  });
};

const maybeApplyAiRanking = async ({ brief, candidates }) => {
  const openai = getOpenAIClient();
  if (!openai || !candidates.length) {
    return candidates;
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are an acquisitions analyst for US residential real estate investors. Review each listing against the investor brief and return JSON only. Stay practical, concise, and do not invent unsupported facts.",
        },
        {
          role: "user",
          content: `Return JSON with exactly one key named "evaluations". It must be an array of objects with these keys:
- listingId
- score (integer 18-95)
- verdict ("strong", "watch", or "weak")
- strategyFit
- renovationFit
- summary
- reasons (array of up to 3 strings)
- riskFlags (array of up to 3 strings)
- nextStep

Data:
${JSON.stringify(buildAiPromptPayload(brief, candidates), null, 2)}`,
        },
      ],
    });

    const responseContent = normalizeString(completion?.choices?.[0]?.message?.content);
    if (!responseContent) {
      return candidates;
    }

    const parsed = JSON.parse(responseContent);
    return applyAiEvaluations(candidates, parsed.evaluations);
  } catch (error) {
    console.error("AI deal ranking failed:", error.response?.data || error.message);
    return candidates;
  }
};

const enrichCandidate = async (candidate, brief) => {
  const rawSnapshot = candidate.listingId
    ? await fetchRentCastSaleListingById(candidate.listingId).catch(() => null)
    : null;

  const normalizedSnapshot = rawSnapshot ? normalizeSaleListing(rawSnapshot) : null;
  const mergedListing = normalizedSnapshot
    ? {
        ...candidate,
        ...normalizedSnapshot,
      }
    : candidate;

  const sourceLink = buildSourceLink(rawSnapshot || candidate._rawListing || {}, mergedListing);

  const [valueEstimate, rentEstimate] = await Promise.all([
    fetchRentCastValueEstimate({
      address: mergedListing.address,
      propertyType: mergedListing.propertyType,
      bedrooms: mergedListing.bedrooms,
      bathrooms: mergedListing.bathrooms,
      squareFootage: mergedListing.squareFootage,
      daysOld: 180,
      maxRadius: 2,
      compCount: 8,
    }).catch(() => null),
    fetchRentCastRentEstimate({
      address: mergedListing.address,
      propertyType: mergedListing.propertyType,
      bedrooms: mergedListing.bedrooms,
      bathrooms: mergedListing.bathrooms,
      squareFootage: mergedListing.squareFootage,
      daysOld: 180,
      maxRadius: 3,
      compCount: 8,
    }).catch(() => null),
  ]);

  return {
    ...mergedListing,
    sourceUrl: sourceLink.sourceUrl,
    sourceLinkType: sourceLink.sourceLinkType,
    match: buildHeuristicMatch({
      brief,
      listing: mergedListing,
      valueEstimate,
      rentEstimate,
    }),
  };
};

const sortByMatchScore = (left, right) => {
  const scoreDelta = (right.match?.score || 0) - (left.match?.score || 0);
  if (scoreDelta !== 0) {
    return scoreDelta;
  }

  const priceDelta = (left.price || 0) - (right.price || 0);
  if (priceDelta !== 0) {
    return priceDelta;
  }

  return normalizeString(left.address).localeCompare(normalizeString(right.address));
};

const buildSearchInputForLocation = ({ location, filters }) => {
  const bboxSearchArea = buildSearchAreaFromBounds(location.bbox);
  const radius =
    location.type === "county"
      ? Math.max(filters.radius, COUNTY_RADIUS_MILES)
      : filters.radius;

  if (bboxSearchArea) {
    return {
      input: {
        latitude: bboxSearchArea.latitude,
        longitude: bboxSearchArea.longitude,
      },
      options: {
        radius: bboxSearchArea.radiusMiles,
      },
    };
  }

  if (location.latitude !== null && location.longitude !== null) {
    return {
      input: {
        latitude: location.latitude,
        longitude: location.longitude,
      },
      options: {
        radius,
      },
    };
  }

  if (location.zipCode) {
    return {
      input: {
        zipCode: location.zipCode,
        city: location.city,
        state: location.state,
      },
      options: {},
    };
  }

  if (location.city && location.state) {
    return {
      input: {
        city: location.city,
        state: location.state,
      },
      options: {},
    };
  }

  if (location.address) {
    return {
      input: {
        address: location.address,
      },
      options: {},
    };
  }

  return {
    input: {
      address: location.label,
    },
    options: {},
  };
};

const searchLocationListings = async ({ location, brief, filters }) => {
  const searchInput = buildSearchInputForLocation({ location, filters });
  const rawListings = await searchRentCastSaleListings(searchInput.input, {
    ...searchInput.options,
    limit: filters.limit,
    minPrice: filters.minPrice ?? brief.minPrice,
    maxPrice: filters.maxPrice ?? brief.maxPrice,
    minBedrooms: filters.minBedrooms,
    maxBedrooms: filters.maxBedrooms,
    minBathrooms: filters.minBathrooms,
    maxBathrooms: filters.maxBathrooms,
    propertyType:
      brief.assetTypes.length === 1 ? brief.assetTypes[0] : filters.propertyType || undefined,
    minSquareFootage: filters.minSquareFootage,
    maxSquareFootage: filters.maxSquareFootage,
    minLotSize: filters.minLotSize,
    maxLotSize: filters.maxLotSize,
    minYearBuilt: filters.minYearBuilt,
    maxYearBuilt: filters.maxYearBuilt,
    maxDaysOld: filters.maxDaysOnMarket,
  });

  return rawListings
    .map((rawListing) => {
      const normalizedListing = normalizeSaleListing(rawListing);
      const sourceLink = buildSourceLink(rawListing, normalizedListing);

      return {
        ...normalizedListing,
        sourceUrl: sourceLink.sourceUrl,
        sourceLinkType: sourceLink.sourceLinkType,
        matchedLocationIds: [location.id],
        _rawListing: rawListing,
        _snapshotListingId: normalizeString(rawListing?.id || rawListing?.listingId),
      };
    })
    .filter((listing) => Boolean(listing.address))
    .filter((listing) => matchesAssetTypes(listing, brief.assetTypes));
};

const normalizeDealSearchRequest = (input = {}) => {
  const brief = normalizeBrief(input.brief || {});
  const filters = normalizeFilters(input.filters || {});
  const locations = normalizeLocations(input.locations || []);
  const viewport = normalizeViewport(input.viewport || {});

  return {
    brief,
    filters,
    locations,
    viewport,
  };
};

const buildSearchedLocationsMeta = (locations = []) =>
  locations.map((location) => ({
    id: location.id,
    label: location.label,
    type: location.type,
  }));

const buildMeta = ({ locations, viewport, candidateCount, matchedCount, hiddenWeakFitCount }) => ({
  searchedLocations: buildSearchedLocationsMeta(locations),
  candidateCount,
  matchedCount,
  hiddenWeakFitCount,
  cached: false,
  searchStrategy: viewport ? "viewport_multi_location" : locations.length > 1 ? "multi_location" : "single_location",
});

const stripPrivateFields = (listing = {}) => {
  const nextListing = { ...listing };
  delete nextListing._rawListing;
  delete nextListing._snapshotListingId;
  return nextListing;
};

const searchDealMatches = async (input = {}) => {
  const request = normalizeDealSearchRequest(input);
  if (!request.locations.length && !request.viewport) {
    throw new Error("At least one market location is required.");
  }

  const cacheKey = buildSearchCacheKey(request);
  const cachedSearch = getCachedSearch(cacheKey);
  if (cachedSearch) {
    return {
      ...cachedSearch,
      meta: {
        ...cachedSearch.meta,
        cached: true,
      },
    };
  }

  const locationListings = await Promise.all(
    request.locations.map((location) =>
      searchLocationListings({
        location,
        brief: request.brief,
        filters: request.filters,
      }).catch((error) => {
        console.error("Deal search location failed:", error.response?.data || error.message);
        return [];
      })
    )
  );

  const dedupedCandidates = dedupeListings(locationListings.flat())
    .filter((listing) => listingWithinViewport(listing, request.viewport))
    .map((listing) => ({
      ...listing,
      match: buildHeuristicMatch({
        brief: request.brief,
        listing,
      }),
    }))
    .sort(sortByMatchScore);

  const candidatesForEnrichment = dedupedCandidates.slice(0, ENRICHMENT_LIMIT);
  const enrichedCandidates = await Promise.all(
    candidatesForEnrichment.map((candidate) => enrichCandidate(candidate, request.brief))
  );

  const enrichedById = new Map(
    enrichedCandidates.map((candidate) => [
      normalizeString(candidate.listingId) || normalizeString(candidate.address).toLowerCase(),
      candidate,
    ])
  );

  const mergedCandidates = dedupedCandidates.map((candidate) => {
    const candidateKey =
      normalizeString(candidate.listingId) || normalizeString(candidate.address).toLowerCase();

    return enrichedById.get(candidateKey) || candidate;
  });

  const aiRankedCandidates = await maybeApplyAiRanking({
    brief: request.brief,
    candidates: mergedCandidates.slice(0, ENRICHMENT_LIMIT),
  });

  const aiRankedMap = new Map(
    aiRankedCandidates.map((candidate) => [
      normalizeString(candidate.listingId) || normalizeString(candidate.address).toLowerCase(),
      candidate,
    ])
  );

  const finalCandidates = mergedCandidates
    .map((candidate) => {
      const candidateKey =
        normalizeString(candidate.listingId) || normalizeString(candidate.address).toLowerCase();
      return aiRankedMap.get(candidateKey) || candidate;
    })
    .sort(sortByMatchScore);

  const visibleResults = finalCandidates
    .filter((candidate) => (candidate.match?.score || 0) >= MIN_VISIBLE_SCORE)
    .slice(0, RESULT_LIMIT)
    .map(stripPrivateFields);

  const hiddenWeakFitCount = Math.max(finalCandidates.length - visibleResults.length, 0);
  const result = {
    results: visibleResults,
    meta: buildMeta({
      locations: request.locations,
      viewport: request.viewport,
      candidateCount: finalCandidates.length,
      matchedCount: visibleResults.length,
      hiddenWeakFitCount,
    }),
  };

  setCachedSearch(cacheKey, result);
  return result;
};

module.exports = {
  buildHeuristicMatch,
  buildSourceLink,
  getMarketSearchHealthStatus,
  normalizeDealSearchRequest,
  searchDealMatches,
};
