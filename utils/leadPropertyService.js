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

const fetchRentCastSaleListing = async (input) => {
  const params = buildRentCastParams(input);
  const data = await requestRentCast('/listings/sale', params);
  return Array.isArray(data) ? data[0] || null : data;
};

const fetchRentCastValueEstimate = async (input) => {
  const params = {
    address: buildFormattedAddress(input),
    compCount: Math.min(Math.max(numberOrNull(input.compCount) || 8, 5), 12),
  };

  const bedrooms = numberOrNull(input.bedrooms);
  const bathrooms = numberOrNull(input.bathrooms);
  const squareFootage = numberOrNull(input.squareFootage);

  if (bedrooms) params.bedrooms = bedrooms;
  if (bathrooms) params.bathrooms = bathrooms;
  if (squareFootage) params.squareFootage = squareFootage;

  return requestRentCast('/avm/value', params);
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
  fetchRentCastValueEstimate,
  getLeadPropertyPreview,
  numberOrNull,
};
