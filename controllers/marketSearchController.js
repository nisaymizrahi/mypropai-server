const Lead = require('../models/Lead');
const Property = require('../models/Property');
const { getLeadPropertyPreview, numberOrNull } = require('../utils/leadPropertyService');
const { fetchSaleListingSnapshot, normalizeSaleListing, searchSaleListings } = require('../utils/marketSearchService');
const {
  buildSourceLink,
  getMarketSearchHealthStatus,
  searchDealMatches,
} = require('../utils/marketDealSearchService');
const { upsertCanonicalProperty } = require('../utils/propertyRecordService');

const normalizeString = (value) => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const toDateOrNull = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) ? parsed : null;
};

const mergeLeadDraftWithPreview = (base = {}, preview = {}) => {
  const merged = { ...base };

  Object.entries(preview).forEach(([key, value]) => {
    if (key === 'metadata' || value === undefined || value === null || value === '') {
      return;
    }

    if (merged[key] === undefined || merged[key] === null || merged[key] === '') {
      merged[key] = value;
    }
  });

  if (preview.address) {
    merged.address = preview.address;
  }

  return merged;
};

const buildImportedSourceListing = ({
  provider,
  listingId,
  listing,
  rawListing,
  importSource,
}) => ({
  provider,
  listingId,
  listingType: listing.listingType || 'sale',
  importSource,
  importedAt: new Date(),
  status: listing.status || '',
  price: numberOrNull(listing.price),
  url: listing.sourceUrl || '',
  linkType: listing.sourceLinkType || '',
  listedDate: toDateOrNull(listing.listedDate),
  removedDate: toDateOrNull(listing.removedDate),
  daysOnMarket: numberOrNull(listing.daysOnMarket),
  primaryPhotoUrl: listing.photoUrl || '',
  photoCount: Array.isArray(listing.photos) ? listing.photos.length : numberOrNull(listing.photoCount) || 0,
  snapshot: rawListing || null,
});

const buildLeadDraftFromListing = ({
  listing,
  rawListing,
  leadSource,
  importSource,
  marketSearchAssessment,
}) => ({
  address: listing.address,
  addressLine1: listing.addressLine1 || '',
  addressLine2: listing.addressLine2 || '',
  city: listing.city || '',
  state: listing.state || '',
  zipCode: listing.zipCode || '',
  county: listing.county || '',
  latitude: numberOrNull(listing.latitude),
  longitude: numberOrNull(listing.longitude),
  propertyType: listing.propertyType || '',
  bedrooms: numberOrNull(listing.bedrooms),
  bathrooms: numberOrNull(listing.bathrooms),
  squareFootage: numberOrNull(listing.squareFootage),
  lotSize: numberOrNull(listing.lotSize),
  yearBuilt: numberOrNull(listing.yearBuilt),
  unitCount: numberOrNull(listing.unitCount),
  sellerAskingPrice: numberOrNull(listing.price),
  listingStatus: listing.status || '',
  listedDate: toDateOrNull(listing.listedDate),
  daysOnMarket: numberOrNull(listing.daysOnMarket),
  leadSource,
  status: 'Potential',
  inPropertyWorkspace: false,
  sourceListing: buildImportedSourceListing({
    provider: listing.provider,
    listingId: listing.listingId,
    listing,
    rawListing,
    importSource,
  }),
  externalListingProvider: listing.provider,
  externalListingId: listing.listingId,
  marketSearchAssessment: marketSearchAssessment || undefined,
});

const buildLeadResponse = (lead) => ({
  _id: lead._id,
  address: lead.address,
  status: lead.status,
  property: lead.property,
  leadSource: lead.leadSource || '',
  inPropertyWorkspace: Boolean(lead.inPropertyWorkspace),
  sourceListing: lead.sourceListing
    ? {
        provider: lead.sourceListing.provider || '',
        listingId: lead.sourceListing.listingId || '',
        url: lead.sourceListing.url || '',
        linkType: lead.sourceListing.linkType || '',
        importedAt: lead.sourceListing.importedAt || null,
      }
    : null,
  marketSearchAssessment: lead.marketSearchAssessment || null,
});

const buildImportResponse = ({ lead, propertyId, created, duplicateReason = '' }) => ({
  created,
  duplicateReason,
  leadId: String(lead._id),
  propertyId: propertyId ? String(propertyId) : '',
  propertyKey: propertyId ? String(propertyId) : '',
  lead: buildLeadResponse(lead),
});

const syncImportedListingToLead = async ({ lead, propertyId, draft }) => {
  if (propertyId && String(lead.property || '') !== String(propertyId)) {
    lead.property = propertyId;
  }

  lead.leadSource = lead.leadSource || draft.leadSource;

  if (!lead.sourceListing?.listingId) {
    lead.sourceListing = draft.sourceListing;
  } else if (!lead.sourceListing.snapshot && draft.sourceListing?.snapshot) {
    lead.sourceListing.snapshot = draft.sourceListing.snapshot;
  }

  if (!lead.sourceListing?.url && draft.sourceListing?.url) {
    lead.sourceListing.url = draft.sourceListing.url;
  }

  if (!lead.sourceListing?.linkType && draft.sourceListing?.linkType) {
    lead.sourceListing.linkType = draft.sourceListing.linkType;
  }

  if (!lead.sellerAskingPrice && draft.sellerAskingPrice) {
    lead.sellerAskingPrice = draft.sellerAskingPrice;
  }

  if (!lead.listingStatus && draft.listingStatus) {
    lead.listingStatus = draft.listingStatus;
  }

  if (!lead.listedDate && draft.listedDate) {
    lead.listedDate = draft.listedDate;
  }

  if ((lead.daysOnMarket === null || lead.daysOnMarket === undefined) && draft.daysOnMarket !== null) {
    lead.daysOnMarket = draft.daysOnMarket;
  }

  if (draft.marketSearchAssessment) {
    lead.marketSearchAssessment = draft.marketSearchAssessment;
  }

  await lead.save();
  return lead;
};

const attachImportedLeadStatus = async (userId, listings = []) => {
  const listingIds = [...new Set(listings.map((listing) => normalizeString(listing.listingId)).filter(Boolean))];
  if (!listingIds.length) {
    return listings;
  }

  const directLeadMatches = await Lead.find({
    user: userId,
    'sourceListing.provider': 'rentcast',
    'sourceListing.listingId': { $in: listingIds },
  })
    .select('_id status property sourceListing')
    .sort({ updatedAt: -1 })
    .lean();

  const listingLeadMap = new Map();
  directLeadMatches.forEach((lead) => {
    const listingId = normalizeString(lead?.sourceListing?.listingId);
    if (listingId && !listingLeadMap.has(listingId)) {
      listingLeadMap.set(listingId, lead);
    }
  });

  const unresolvedListingIds = listingIds.filter((listingId) => !listingLeadMap.has(listingId));
  if (unresolvedListingIds.length) {
    const matchingProperties = await Property.find({
      user: userId,
      externalListingProvider: 'rentcast',
      externalListingId: { $in: unresolvedListingIds },
    })
      .select('_id externalListingId')
      .lean();

    if (matchingProperties.length) {
      const propertyLeadMatches = await Lead.find({
        user: userId,
        property: { $in: matchingProperties.map((property) => property._id) },
      })
        .select('_id status property')
        .sort({ updatedAt: -1 })
        .lean();

      const propertyLeadMap = new Map();
      propertyLeadMatches.forEach((lead) => {
        const propertyId = normalizeString(lead?.property);
        if (propertyId && !propertyLeadMap.has(propertyId)) {
          propertyLeadMap.set(propertyId, lead);
        }
      });

      matchingProperties.forEach((property) => {
        const propertyId = normalizeString(property._id);
        const listingId = normalizeString(property.externalListingId);
        if (!propertyId || !listingId || listingLeadMap.has(listingId)) {
          return;
        }

        const lead = propertyLeadMap.get(propertyId);
        if (lead) {
          listingLeadMap.set(listingId, lead);
        }
      });
    }
  }

  return listings.map((listing) => {
    const matchedLead = listingLeadMap.get(normalizeString(listing.listingId));
    if (!matchedLead) {
      return listing;
    }

    return {
      ...listing,
      existingLeadId: String(matchedLead._id),
      existingLeadStatus: matchedLead.status || '',
    };
  });
};

exports.getMarketSearchHealth = (req, res) => {
  res.status(200).json(getMarketSearchHealthStatus());
};

exports.searchSaleListings = async (req, res) => {
  try {
    const result = await searchSaleListings(req.body || {});
    const listings = await attachImportedLeadStatus(req.user.id, result.listings);

    res.json({
      listings,
      meta: result.meta,
    });
  } catch (error) {
    console.error('Market search error:', error.response?.data || error.message);
    res.status(500).json({ msg: 'Failed to load sale listings.' });
  }
};

exports.searchDealMatches = async (req, res) => {
  try {
    const result = await searchDealMatches(req.body || {});
    const results = await attachImportedLeadStatus(req.user.id, result.results);

    res.json({
      results,
      meta: result.meta,
    });
  } catch (error) {
    console.error('AI market deal search error:', error.response?.data || error.message);
    res.status(500).json({ msg: error.message || 'Failed to analyze the market search brief.' });
  }
};

exports.importSaleListing = async (req, res) => {
  try {
    const provider = normalizeString(req.body?.provider || 'rentcast').toLowerCase();
    const listingId = normalizeString(req.body?.listingId);
    const leadSource = normalizeString(req.body?.leadSource) || 'rentcast_ai_market_search';
    const importSource = 'market_search';

    if (provider !== 'rentcast') {
      return res.status(400).json({ msg: 'Unsupported listing provider.' });
    }

    if (!listingId) {
      return res.status(400).json({ msg: 'listingId is required.' });
    }

    const rawListing = await fetchSaleListingSnapshot(provider, listingId).catch(() => null);
    const normalizedListing = normalizeSaleListing(rawListing || req.body?.listing || {});
    const sourceLink = buildSourceLink(rawListing || req.body?.listing || {}, {
      ...normalizedListing,
      sourceUrl: req.body?.listing?.sourceUrl,
      sourceLinkType: req.body?.listing?.sourceLinkType,
    });
    normalizedListing.sourceUrl = req.body?.listing?.sourceUrl || sourceLink.sourceUrl;
    normalizedListing.sourceLinkType = req.body?.listing?.sourceLinkType || sourceLink.sourceLinkType;

    if (!normalizedListing.address) {
      return res.status(404).json({ msg: 'Sale listing not found.' });
    }

    const marketSearchAssessment =
      req.body?.marketSearchAssessment && typeof req.body.marketSearchAssessment === 'object'
        ? {
            searchedAt: new Date(),
            brief: req.body.marketSearchAssessment.brief || {},
            match: req.body.marketSearchAssessment.match || {},
          }
        : null;

    const preview = await getLeadPropertyPreview({
      ...normalizedListing,
      address: normalizedListing.address,
    }).catch(() => null);

    const leadDraft = mergeLeadDraftWithPreview(
      buildLeadDraftFromListing({
        listing: normalizedListing,
        rawListing,
        leadSource,
        importSource,
        marketSearchAssessment,
      }),
      preview || {}
    );

    const property = await upsertCanonicalProperty({
      userId: req.user.id,
      source: leadDraft,
    });
    const propertyId = property?._id || null;

    let existingLead = await Lead.findOne({
      user: req.user.id,
      'sourceListing.provider': provider,
      'sourceListing.listingId': listingId,
    }).sort({ updatedAt: -1 });

    if (existingLead) {
      existingLead = await syncImportedListingToLead({
        lead: existingLead,
        propertyId,
        draft: leadDraft,
      });

      return res.status(200).json(
        buildImportResponse({
          lead: existingLead,
          propertyId,
          created: false,
          duplicateReason: 'listing',
        })
      );
    }

    if (propertyId) {
      existingLead = await Lead.findOne({
        user: req.user.id,
        property: propertyId,
      }).sort({ updatedAt: -1 });
    }

    if (existingLead) {
      existingLead = await syncImportedListingToLead({
        lead: existingLead,
        propertyId,
        draft: leadDraft,
      });

      return res.status(200).json(
        buildImportResponse({
          lead: existingLead,
          propertyId,
          created: false,
          duplicateReason: 'property',
        })
      );
    }

    const lead = new Lead({
      user: req.user.id,
      property: propertyId,
      ...leadDraft,
    });

    await lead.save();

    res.status(201).json(
      buildImportResponse({
        lead,
        propertyId,
        created: true,
      })
    );
  } catch (error) {
    console.error('Market import error:', error);
    res.status(500).json({ msg: 'Failed to add the property to Potential Properties.' });
  }
};

exports.__private = {
  buildImportedSourceListing,
  buildLeadDraftFromListing,
  syncImportedListingToLead,
};
