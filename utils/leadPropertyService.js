const axios = require('axios');

const RENTCAST_BASE_URL = 'https://api.rentcast.io/v1';

const numberOrNull = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildFormattedAddress = (input = {}) => {
  if (input.address) return input.address;

  const line1 = input.addressLine1 || '';
  const line2 = input.addressLine2 || '';
  const city = input.city || '';
  const state = input.state || '';
  const zipCode = input.zipCode || '';

  return [line1, line2, city, state, zipCode].filter(Boolean).join(', ');
};

const buildRentCastParams = (input = {}) => {
  const params = { limit: 1 };

  if (input.address) {
    params.address = input.address;
    return params;
  }

  if (input.addressLine1) params.addressLine1 = input.addressLine1;
  if (input.addressLine2) params.addressLine2 = input.addressLine2;
  if (input.city) params.city = input.city;
  if (input.state) params.state = input.state;
  if (input.zipCode) params.zipCode = input.zipCode;

  return params;
};

const buildRangeParam = (min, max) => {
  const normalizedMin = numberOrNull(min);
  const normalizedMax = numberOrNull(max);

  if (normalizedMin === null && normalizedMax === null) return null;
  if (normalizedMin !== null && normalizedMax !== null) {
    return `${Math.min(normalizedMin, normalizedMax)}:${Math.max(normalizedMin, normalizedMax)}`;
  }

  return String(normalizedMin ?? normalizedMax);
};

const formatPropertyTypeForRentCast = (value = '') => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');

  switch (normalized) {
    case 'single-family':
      return 'Single Family';
    case 'townhouse':
      return 'Townhouse';
    case 'condo':
      return 'Condo';
    case 'multi-family':
    case 'multi-family-any':
    case 'multi-family-2-4':
    case 'multi-family-5-plus':
      return 'Multi Family';
    case 'mixed-use':
      return 'Mixed Use';
    case 'commercial':
      return 'Commercial';
    case 'land':
      return 'Land';
    case 'manufactured':
      return 'Manufactured';
    default:
      return value ? String(value).trim() : '';
  }
};

const buildRentCastSearchParams = (input = {}, options = {}) => {
  const params = {};
  const formattedAddress = buildFormattedAddress(input);
  const latitude = numberOrNull(input.latitude);
  const longitude = numberOrNull(input.longitude);
  const radius = numberOrNull(options.radius ?? input.radius);
  const price = buildRangeParam(options.minPrice ?? input.minPrice, options.maxPrice ?? input.maxPrice);
  const bedrooms = buildRangeParam(options.minBedrooms ?? input.minBedrooms, options.maxBedrooms ?? input.maxBedrooms);
  const bathrooms = buildRangeParam(options.minBathrooms ?? input.minBathrooms, options.maxBathrooms ?? input.maxBathrooms);
  const squareFootage = buildRangeParam(
    options.minSquareFootage ?? input.minSquareFootage ?? input.squareFootage,
    options.maxSquareFootage ?? input.maxSquareFootage ?? input.squareFootage
  );
  const lotSize = buildRangeParam(options.minLotSize ?? input.minLotSize, options.maxLotSize ?? input.maxLotSize);
  const yearBuilt = buildRangeParam(options.minYearBuilt ?? input.minYearBuilt ?? input.yearBuilt, options.maxYearBuilt ?? input.maxYearBuilt ?? input.yearBuilt);
  const daysOld = buildRangeParam(
    options.minDaysOld ?? input.minDaysOld,
    options.maxDaysOld ?? options.daysOld ?? input.maxDaysOld ?? input.daysOld
  );
  const limit = numberOrNull(options.limit);
  const offset = numberOrNull(options.offset);
  const saleDateRange = buildRangeParam(options.minSaleDateRange, options.maxSaleDateRange ?? options.saleDateRange);
  const propertyType = formatPropertyTypeForRentCast(options.propertyType ?? input.propertyType);

  if (formattedAddress) {
    params.address = formattedAddress;
  } else if (latitude !== null && longitude !== null) {
    params.latitude = latitude;
    params.longitude = longitude;
  } else {
    if (input.addressLine1) params.addressLine1 = input.addressLine1;
    if (input.addressLine2) params.addressLine2 = input.addressLine2;
    if (input.city) params.city = input.city;
    if (input.state) params.state = input.state;
    if (input.zipCode) params.zipCode = input.zipCode;
  }

  if (radius !== null) params.radius = radius;
  if (propertyType) params.propertyType = propertyType;
  if (price !== null) params.price = price;
  if (bedrooms !== null) params.bedrooms = bedrooms;
  if (bathrooms !== null) params.bathrooms = bathrooms;
  if (squareFootage !== null) params.squareFootage = squareFootage;
  if (lotSize !== null) params.lotSize = lotSize;
  if (yearBuilt !== null) params.yearBuilt = yearBuilt;
  if (daysOld !== null) params.daysOld = daysOld;
  if (saleDateRange !== null) params.saleDateRange = saleDateRange;
  if (limit !== null) params.limit = Math.max(1, Math.round(limit));
  if (offset !== null) params.offset = Math.max(0, Math.round(offset));
  if (options.includeTotalCount) params.includeTotalCount = true;
  if (options.dataType) params.dataType = options.dataType;
  if (options.historyRange !== undefined && options.historyRange !== null) {
    params.historyRange = Math.max(1, Math.round(options.historyRange));
  }

  return params;
};

const getRentCastHeaders = () => {
  if (!process.env.RENTCAST_API_KEY) {
    throw new Error('RENTCAST_API_KEY is not configured.');
  }

  return {
    'X-Api-Key': process.env.RENTCAST_API_KEY,
    Accept: 'application/json',
  };
};

const requestRentCast = async (path, params) => {
  try {
    const response = await axios.get(`${RENTCAST_BASE_URL}${path}`, {
      params,
      headers: getRentCastHeaders(),
    });
    return response.data;
  } catch (error) {
    if (error.response?.status === 404) return null;
    throw error;
  }
};

const resolveUnitCount = (record = {}) =>
  numberOrNull(record?.features?.unitCount) ??
  numberOrNull(record?.unitCount) ??
  (Array.isArray(record?.units) ? record.units.length : null);

const fetchRentCastProperty = async (input) => {
  const params = buildRentCastParams(input);
  const data = await requestRentCast('/properties', params);
  return Array.isArray(data) ? data[0] || null : data;
};

const searchRentCastProperties = async (input, options = {}) => {
  const params = buildRentCastSearchParams(input, options);
  const data = await requestRentCast('/properties', params);
  return Array.isArray(data) ? data : [];
};

const fetchRentCastSaleListing = async (input) => {
  const params = buildRentCastParams(input);
  const data = await requestRentCast('/listings/sale', params);
  return Array.isArray(data) ? data[0] || null : data;
};

const fetchRentCastSaleListingById = async (listingId) => {
  const normalizedId = String(listingId || '').trim();
  if (!normalizedId) {
    return null;
  }

  return requestRentCast(`/listings/sale/${encodeURIComponent(normalizedId)}`);
};

const searchRentCastSaleListings = async (input, options = {}) => {
  const params = buildRentCastSearchParams(input, options);
  const data = await requestRentCast('/listings/sale', params);
  return Array.isArray(data) ? data : [];
};

const fetchRentCastRentalListing = async (input) => {
  const params = buildRentCastParams(input);
  const data = await requestRentCast('/listings/rental/long-term', params);
  return Array.isArray(data) ? data[0] || null : data;
};

const searchRentCastRentalListings = async (input, options = {}) => {
  const params = buildRentCastSearchParams(input, options);
  const data = await requestRentCast('/listings/rental/long-term', params);
  return Array.isArray(data) ? data : [];
};

const fetchRentCastValueEstimate = async (input) => {
  const params = {
    address: buildFormattedAddress(input),
    compCount: Math.min(Math.max(numberOrNull(input.compCount) || 8, 5), 25),
  };

  const propertyType = input.propertyType ? String(input.propertyType).trim() : '';
  const bedrooms = numberOrNull(input.bedrooms);
  const bathrooms = numberOrNull(input.bathrooms);
  const squareFootage = numberOrNull(input.squareFootage);
  const maxRadius = numberOrNull(input.maxRadius);
  const daysOld = numberOrNull(input.daysOld);

  if (propertyType) params.propertyType = propertyType;
  if (bedrooms) params.bedrooms = bedrooms;
  if (bathrooms) params.bathrooms = bathrooms;
  if (squareFootage) params.squareFootage = squareFootage;
  if (maxRadius) params.maxRadius = maxRadius;
  if (daysOld) params.daysOld = Math.max(1, Math.round(daysOld));

  return requestRentCast('/avm/value', params);
};

const fetchRentCastRentEstimate = async (input) => {
  const params = {
    address: buildFormattedAddress(input),
    compCount: Math.min(Math.max(numberOrNull(input.compCount) || 8, 5), 25),
  };

  const propertyType = input.propertyType ? String(input.propertyType).trim() : '';
  const bedrooms = numberOrNull(input.bedrooms);
  const bathrooms = numberOrNull(input.bathrooms);
  const squareFootage = numberOrNull(input.squareFootage);
  const maxRadius = numberOrNull(input.maxRadius);
  const daysOld = numberOrNull(input.daysOld);

  if (propertyType) params.propertyType = propertyType;
  if (bedrooms) params.bedrooms = bedrooms;
  if (bathrooms) params.bathrooms = bathrooms;
  if (squareFootage) params.squareFootage = squareFootage;
  if (maxRadius) params.maxRadius = maxRadius;
  if (daysOld) params.daysOld = Math.max(1, Math.round(daysOld));

  return requestRentCast('/avm/rent/long-term', params);
};

const fetchRentCastMarketStats = async (input = {}, options = {}) => {
  const zipCode = String(options.zipCode || input.zipCode || '').trim();
  if (!zipCode) {
    return null;
  }

  const params = buildRentCastSearchParams(
    {},
    {
      zipCode,
      dataType: options.dataType || 'All',
      historyRange: options.historyRange ?? 12,
    }
  );

  params.zipCode = zipCode;
  delete params.limit;
  delete params.offset;
  return requestRentCast('/markets', params);
};

const formatPropertyPreview = (input = {}, property, listing) => ({
  address: property?.formattedAddress || listing?.formattedAddress || buildFormattedAddress(input),
  addressLine1: property?.addressLine1 || listing?.addressLine1 || input.addressLine1 || '',
  addressLine2: property?.addressLine2 || listing?.addressLine2 || input.addressLine2 || '',
  city: property?.city || listing?.city || input.city || '',
  state: property?.state || listing?.state || input.state || '',
  zipCode: property?.zipCode || listing?.zipCode || input.zipCode || '',
  county: property?.county || listing?.county || input.county || '',
  latitude: numberOrNull(property?.latitude) ?? numberOrNull(listing?.latitude) ?? numberOrNull(input.latitude),
  longitude: numberOrNull(property?.longitude) ?? numberOrNull(listing?.longitude) ?? numberOrNull(input.longitude),
  propertyType: property?.propertyType || listing?.propertyType || input.propertyType || '',
  bedrooms: numberOrNull(property?.bedrooms) ?? numberOrNull(listing?.bedrooms) ?? numberOrNull(input.bedrooms),
  bathrooms: numberOrNull(property?.bathrooms) ?? numberOrNull(listing?.bathrooms) ?? numberOrNull(input.bathrooms),
  squareFootage: numberOrNull(property?.squareFootage) ?? numberOrNull(listing?.squareFootage) ?? numberOrNull(input.squareFootage),
  lotSize: numberOrNull(property?.lotSize) ?? numberOrNull(input.lotSize),
  yearBuilt: numberOrNull(property?.yearBuilt) ?? numberOrNull(listing?.yearBuilt) ?? numberOrNull(input.yearBuilt),
  unitCount: resolveUnitCount(property) ?? resolveUnitCount(listing) ?? numberOrNull(input.unitCount),
  sellerAskingPrice: numberOrNull(listing?.price) ?? numberOrNull(input.sellerAskingPrice),
  listingStatus: listing?.status || input.listingStatus || '',
  listedDate: listing?.listedDate || input.listedDate || null,
  daysOnMarket: numberOrNull(listing?.daysOnMarket) ?? numberOrNull(input.daysOnMarket),
  lastSalePrice: numberOrNull(property?.lastSalePrice) ?? numberOrNull(input.lastSalePrice),
  lastSaleDate: property?.lastSaleDate || input.lastSaleDate || null,
});

const getLeadPropertyPreview = async (input = {}) => {
  const [property, listing] = await Promise.all([
    fetchRentCastProperty(input).catch(() => null),
    fetchRentCastSaleListing(input).catch(() => null),
  ]);

  return {
    ...formatPropertyPreview(input, property, listing),
    metadata: {
      propertyFound: Boolean(property),
      activeListingFound: Boolean(listing),
    },
  };
};

module.exports = {
  buildRangeParam,
  buildRentCastSearchParams,
  formatPropertyTypeForRentCast,
  fetchRentCastProperty,
  fetchRentCastMarketStats,
  fetchRentCastRentalListing,
  fetchRentCastRentEstimate,
  fetchRentCastSaleListing,
  fetchRentCastSaleListingById,
  fetchRentCastValueEstimate,
  formatPropertyPreview,
  getLeadPropertyPreview,
  numberOrNull,
  searchRentCastProperties,
  searchRentCastRentalListings,
  searchRentCastSaleListings,
};
