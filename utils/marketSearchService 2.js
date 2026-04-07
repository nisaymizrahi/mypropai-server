const {
  fetchRentCastSaleListingById,
  numberOrNull,
  searchRentCastSaleListings,
} = require('./leadPropertyService');

const SEARCH_CACHE_TTL_MS = 45 * 1000;
const DEFAULT_RADIUS_MILES = 8;
const DEFAULT_LIMIT = 120;
const MAX_LIMIT = 150;
const searchCache = new Map();

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const normalizeString = (value) => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const buildAddress = (listing = {}) =>
  normalizeString(
    listing.formattedAddress ||
      [listing.addressLine1, listing.addressLine2, listing.city, listing.state, listing.zipCode]
        .filter(Boolean)
        .join(', ')
  );

const extractListingId = (listing = {}) =>
  normalizeString(listing.id || listing.listingId || listing.propertyId || listing.mlsNumber);

const extractPhotoUrls = (listing = {}) => {
  const candidates = [
    listing.photos,
    listing.photoUrls,
    listing.images,
    listing.listingPhotos,
  ];

  return candidates
    .flatMap((value) => (Array.isArray(value) ? value : []))
    .map((entry) => {
      if (!entry) return '';
      if (typeof entry === 'string') return entry.trim();
      return normalizeString(
        entry.url ||
          entry.href ||
          entry.src ||
          entry.large ||
          entry.medium ||
          entry.small ||
          entry.photoUrl
      );
    })
    .filter(Boolean);
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

const buildViewportSearchArea = (viewport) => {
  if (!viewport) {
    return null;
  }

  const centerLatitude = (viewport.north + viewport.south) / 2;
  const centerLongitude = (viewport.east + viewport.west) / 2;
  const cornerDistances = [
    haversineMiles(centerLatitude, centerLongitude, viewport.north, viewport.east),
    haversineMiles(centerLatitude, centerLongitude, viewport.north, viewport.west),
    haversineMiles(centerLatitude, centerLongitude, viewport.south, viewport.east),
    haversineMiles(centerLatitude, centerLongitude, viewport.south, viewport.west),
  ];
  const radiusMiles = clamp(Math.max(...cornerDistances, DEFAULT_RADIUS_MILES / 2) * 1.12, 0.5, 50);

  return {
    latitude: centerLatitude,
    longitude: centerLongitude,
    radiusMiles,
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

const buildSearchCacheKey = ({ location, viewport, filters, searchArea }) =>
  JSON.stringify({
    location,
    viewport,
    filters,
    searchArea,
  });

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
    expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
  });
};

const normalizeLocation = (input = {}) => ({
  label: normalizeString(input.label || input.address || input.query),
  address: normalizeString(input.address),
  addressLine1: normalizeString(input.addressLine1),
  city: normalizeString(input.city),
  state: normalizeString(input.state),
  zipCode: normalizeString(input.zipCode),
  latitude: numberOrNull(input.latitude),
  longitude: numberOrNull(input.longitude),
});

const normalizeFilters = (input = {}) => ({
  minPrice: numberOrNull(input.minPrice),
  maxPrice: numberOrNull(input.maxPrice),
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
  maxDaysOnMarket: numberOrNull(input.maxDaysOnMarket ?? input.daysOnMarket),
  limit: clamp(Math.round(numberOrNull(input.limit) || DEFAULT_LIMIT), 1, MAX_LIMIT),
  offset: Math.max(0, Math.round(numberOrNull(input.offset) || 0)),
});

const normalizeSaleListing = (listing = {}) => {
  const listingId = extractListingId(listing);
  const address = buildAddress(listing);
  const photoUrls = extractPhotoUrls(listing);
  const latitude = numberOrNull(listing.latitude);
  const longitude = numberOrNull(listing.longitude);

  return {
    id: `rentcast:${listingId || `${latitude || 'na'}:${longitude || 'na'}:${address}`}`,
    provider: 'rentcast',
    listingId,
    address,
    addressLine1: normalizeString(listing.addressLine1),
    addressLine2: normalizeString(listing.addressLine2),
    city: normalizeString(listing.city),
    state: normalizeString(listing.state),
    zipCode: normalizeString(listing.zipCode),
    county: normalizeString(listing.county),
    latitude,
    longitude,
    price: numberOrNull(listing.price),
    bedrooms: numberOrNull(listing.bedrooms),
    bathrooms: numberOrNull(listing.bathrooms),
    squareFootage: numberOrNull(listing.squareFootage),
    lotSize: numberOrNull(listing.lotSize),
    yearBuilt: numberOrNull(listing.yearBuilt),
    unitCount:
      numberOrNull(listing.features?.unitCount) ??
      numberOrNull(listing.unitCount) ??
      (Array.isArray(listing.units) ? listing.units.length : null),
    propertyType: normalizeString(listing.propertyType),
    status: normalizeString(listing.status),
    listingType: normalizeString(listing.listingType || 'sale'),
    listedDate: listing.listedDate || null,
    removedDate: listing.removedDate || null,
    daysOnMarket: numberOrNull(listing.daysOnMarket),
    mlsName: normalizeString(listing.mlsName),
    mlsNumber: normalizeString(listing.mlsNumber),
    hoaFee: numberOrNull(listing.hoa?.fee ?? listing.hoaFee),
    photoUrl: photoUrls[0] || '',
    photos: photoUrls,
    photoCount: photoUrls.length,
  };
};

const dedupeListings = (listings = []) => {
  const seenListingIds = new Set();
  const seenAddresses = new Set();

  return listings.filter((listing) => {
    const listingKey = normalizeString(listing.listingId);
    if (listingKey) {
      if (seenListingIds.has(listingKey)) {
        return false;
      }
      seenListingIds.add(listingKey);
      return true;
    }

    const addressKey = normalizeString(listing.address).toLowerCase();
    if (!addressKey) {
      return true;
    }
    if (seenAddresses.has(addressKey)) {
      return false;
    }
    seenAddresses.add(addressKey);
    return true;
  });
};

const searchSaleListings = async (input = {}) => {
  const location = normalizeLocation(input.location || {});
  const viewport = normalizeViewport(input.viewport || input.bounds || {});
  const filters = normalizeFilters(input.filters || {});
  const viewportArea = buildViewportSearchArea(viewport);
  const searchArea = viewportArea || (
    location.latitude !== null && location.longitude !== null
      ? {
          latitude: location.latitude,
          longitude: location.longitude,
          radiusMiles: clamp(numberOrNull(input.radius) || DEFAULT_RADIUS_MILES, 1, 50),
        }
      : null
  );

  const cacheKey = buildSearchCacheKey({ location, viewport, filters, searchArea });
  const cachedSearch = getCachedSearch(cacheKey);
  if (cachedSearch) {
    return { ...cachedSearch, meta: { ...cachedSearch.meta, cached: true } };
  }

  const rentCastInput = searchArea
    ? {
        latitude: searchArea.latitude,
        longitude: searchArea.longitude,
      }
    : {
        address: location.address,
        addressLine1: location.addressLine1,
        city: location.city,
        state: location.state,
        zipCode: location.zipCode,
      };

  const rentCastOptions = {
    radius: searchArea?.radiusMiles,
    limit: filters.limit,
    offset: filters.offset,
    propertyType: filters.propertyType || undefined,
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
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
    maxDaysOld: filters.maxDaysOnMarket,
  };

  const rawListings = await searchRentCastSaleListings(rentCastInput, rentCastOptions);
  const normalizedListings = dedupeListings(rawListings.map((listing) => normalizeSaleListing(listing)))
    .filter((listing) => Boolean(listing.address))
    .filter((listing) => listingWithinViewport(listing, viewport));

  const result = {
    listings: normalizedListings,
    meta: {
      locationLabel:
        location.label ||
        location.address ||
        [location.city, location.state, location.zipCode].filter(Boolean).join(', '),
      cached: false,
      returnedCount: normalizedListings.length,
      radiusMiles: searchArea?.radiusMiles || null,
      searchCenter:
        searchArea && searchArea.latitude !== null && searchArea.longitude !== null
          ? {
              latitude: searchArea.latitude,
              longitude: searchArea.longitude,
            }
          : null,
      viewport,
      limit: filters.limit,
      offset: filters.offset,
      searchStrategy: viewport ? 'viewport_radius' : searchArea ? 'center_radius' : 'address_lookup',
    },
  };

  setCachedSearch(cacheKey, result);
  return result;
};

const fetchSaleListingSnapshot = async (provider, listingId) => {
  if (normalizeString(provider).toLowerCase() !== 'rentcast') {
    throw new Error('Unsupported listing provider.');
  }

  return fetchRentCastSaleListingById(listingId);
};

module.exports = {
  fetchSaleListingSnapshot,
  normalizeSaleListing,
  searchSaleListings,
};
