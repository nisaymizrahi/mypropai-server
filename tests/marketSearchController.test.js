const test = require("node:test");
const assert = require("node:assert/strict");

const marketSearchController = require("../controllers/marketSearchController");
const { __private } = marketSearchController;

test("buildLeadDraftFromListing preserves source link and market search assessment", () => {
  const draft = __private.buildLeadDraftFromListing({
    listing: {
      provider: "rentcast",
      listingId: "listing-123",
      address: "123 Main St",
      city: "Phoenix",
      state: "AZ",
      zipCode: "85016",
      price: 280000,
      status: "Active",
      sourceUrl: "https://mls.example.com/listing-123",
      sourceLinkType: "mls",
    },
    rawListing: { id: "listing-123" },
    leadSource: "rentcast_ai_market_search",
    importSource: "market_search",
    marketSearchAssessment: {
      searchedAt: new Date("2026-04-06T12:00:00.000Z"),
      brief: { strategy: "flip" },
      match: { score: 81, verdict: "strong" },
    },
  });

  assert.equal(draft.sourceListing.url, "https://mls.example.com/listing-123");
  assert.equal(draft.sourceListing.linkType, "mls");
  assert.equal(draft.marketSearchAssessment.brief.strategy, "flip");
  assert.equal(draft.marketSearchAssessment.match.score, 81);
});

test("getMarketSearchHealth returns deployment-ready API status", async () => {
  const originalRentCastKey = process.env.RENTCAST_API_KEY;
  const originalOpenAiKey = process.env.OPENAI_API_KEY;

  try {
    process.env.RENTCAST_API_KEY = "rentcast-test-key";
    delete process.env.OPENAI_API_KEY;

    let statusCode = null;
    let payload = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        payload = body;
        return this;
      },
    };

    await marketSearchController.getMarketSearchHealth({}, res);

    assert.equal(statusCode, 200);
    assert.equal(payload.status, "degraded");
    assert.equal(payload.ready, true);
    assert.equal(payload.services.rentcast.status, "connected");
    assert.equal(payload.services.openai.status, "fallback");
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
