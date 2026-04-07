const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildHeuristicMatch,
  buildSourceLink,
  getMarketSearchHealthStatus,
  normalizeDealSearchRequest,
} = require("../utils/marketDealSearchService");

test("normalizeDealSearchRequest clamps and normalizes the investor brief", () => {
  const normalized = normalizeDealSearchRequest({
    brief: {
      strategy: "Fix & Rent",
      objective: "Target light rehab holds",
      renovationPreference: "cosmetic",
      minPrice: "450000",
      maxPrice: "250000",
      assetTypes: ["single family", "multi-family"],
    },
    locations: [
      {
        label: "Maricopa County, AZ",
        county: "Maricopa County",
        state: "AZ",
        latitude: 33.4,
        longitude: -112.0,
      },
    ],
    filters: {
      radius: "72",
      minBedrooms: "3",
    },
  });

  assert.equal(normalized.brief.strategy, "fix_and_rent");
  assert.equal(normalized.brief.minPrice, 250000);
  assert.equal(normalized.brief.maxPrice, 450000);
  assert.deepEqual(normalized.brief.assetTypes, ["single family", "multi-family"]);
  assert.equal(normalized.filters.radius, 50);
  assert.equal(normalized.locations[0].type, "county");
});

test("buildSourceLink prefers direct URLs and falls back to public search", () => {
  const direct = buildSourceLink(
    {
      listingUrl: "https://example.com/listing/123",
      listingOffice: { website: "https://broker.example.com" },
    },
    {
      address: "123 Main St",
      city: "Phoenix",
      state: "AZ",
      zipCode: "85016",
    }
  );

  assert.equal(direct.sourceLinkType, "listing");
  assert.equal(direct.sourceUrl, "https://example.com/listing/123");

  const fallback = buildSourceLink(
    {},
    {
      address: "123 Main St",
      city: "Phoenix",
      state: "AZ",
      zipCode: "85016",
    }
  );

  assert.equal(fallback.sourceLinkType, "search");
  assert.match(fallback.sourceUrl, /google\.com\/search/);
});

test("buildHeuristicMatch boosts strong fix-and-rent yield and flags weaker flip spreads", () => {
  const holdMatch = buildHeuristicMatch({
    brief: {
      strategy: "fix_and_rent",
      objective: "Light rehab hold",
      renovationPreference: "cosmetic",
    },
    listing: {
      price: 220000,
      yearBuilt: 1998,
      photoUrl: "https://images.example.com/1.jpg",
    },
    rentEstimate: { rent: 2600 },
    valueEstimate: { price: 250000 },
  });

  assert.equal(holdMatch.verdict, "strong");
  assert.ok(holdMatch.score >= 74);
  assert.match(holdMatch.strategyFit, /fix-and-rent/i);

  const flipMatch = buildHeuristicMatch({
    brief: {
      strategy: "flip",
      objective: "Need a wide value spread",
      renovationPreference: "full_gut",
    },
    listing: {
      price: 400000,
      yearBuilt: 2005,
      daysOnMarket: 92,
    },
    valueEstimate: { price: 385000 },
  });

  assert.equal(flipMatch.verdict, "weak");
  assert.ok(flipMatch.riskFlags.some((flag) => /asking price|market time/i.test(flag)));
});

test("getMarketSearchHealthStatus reports healthy, degraded, and down modes", () => {
  const originalRentCastKey = process.env.RENTCAST_API_KEY;
  const originalOpenAiKey = process.env.OPENAI_API_KEY;

  try {
    process.env.RENTCAST_API_KEY = "rentcast-test-key";
    process.env.OPENAI_API_KEY = "openai-test-key";

    let health = getMarketSearchHealthStatus();
    assert.equal(health.status, "healthy");
    assert.equal(health.ready, true);
    assert.equal(health.searchMode, "rentcast_plus_openai");
    assert.equal(health.services.rentcast.status, "connected");
    assert.equal(health.services.openai.status, "connected");

    delete process.env.OPENAI_API_KEY;

    health = getMarketSearchHealthStatus();
    assert.equal(health.status, "degraded");
    assert.equal(health.ready, true);
    assert.equal(health.searchMode, "rentcast_only");
    assert.equal(health.services.rentcast.status, "connected");
    assert.equal(health.services.openai.status, "fallback");

    delete process.env.RENTCAST_API_KEY;

    health = getMarketSearchHealthStatus();
    assert.equal(health.status, "down");
    assert.equal(health.ready, false);
    assert.equal(health.searchMode, "offline");
    assert.equal(health.services.rentcast.status, "missing");
    assert.equal(health.services.openai.status, "fallback");
  } finally {
    if (originalRentCastKey === undefined) {
      delete process.env.RENTCAST_API_KEY;
    } else {
      process.env.RENTCAST_API_KEY = originalRentCastKey;
    }

    if (originalOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiKey;
    }
  }
});
