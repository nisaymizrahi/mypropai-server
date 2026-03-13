const mongoose = require('mongoose');
const Property = require('../models/Property');

const isPresent = (value) => value !== undefined && value !== null && value !== '';

const normalizeString = (value) => {
  if (!isPresent(value)) return undefined;
  return String(value).trim();
};

const normalizeNumber = (value) => {
  if (!isPresent(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const parseAddressParts = (address = '') => {
  const parts = String(address)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 2) {
    return {
      addressLine1: normalizeString(address),
      city: undefined,
      state: undefined,
      zipCode: undefined,
    };
  }

  const [addressLine1, city, ...rest] = parts;
  const regionTokens = rest.join(' ').trim().split(/\s+/).filter(Boolean);

  return {
    addressLine1: normalizeString(addressLine1),
    city: normalizeString(city),
    state: normalizeString(regionTokens[0]),
    zipCode: normalizeString(regionTokens[1]),
  };
};

const getAddressParts = (source = {}) => {
  const parsed = parseAddressParts(source.address);

  return {
    address: normalizeString(source.address),
    addressLine1: normalizeString(source.addressLine1) || parsed.addressLine1,
    addressLine2: normalizeString(source.addressLine2),
    city: normalizeString(source.city) || parsed.city,
    state: normalizeString(source.state) || parsed.state,
    zipCode: normalizeString(source.zipCode) || parsed.zipCode,
    county: normalizeString(source.county),
  };
};

const buildPropertyPayload = (source = {}) => {
  const addressParts = getAddressParts(source);
  const unitCount = Array.isArray(source.units)
    ? source.units.length
    : source.unitCount;

  return {
    ...addressParts,
    latitude: normalizeNumber(source.latitude),
    longitude: normalizeNumber(source.longitude),
    propertyType: normalizeString(source.propertyType),
    bedrooms: normalizeNumber(source.bedrooms),
    bathrooms: normalizeNumber(source.bathrooms),
    squareFootage: normalizeNumber(source.squareFootage ?? source.sqft),
    lotSize: normalizeNumber(source.lotSize),
    yearBuilt: normalizeNumber(source.yearBuilt),
    unitCount: normalizeNumber(unitCount),
    listingStatus: normalizeString(source.listingStatus),
    sellerAskingPrice: normalizeNumber(source.sellerAskingPrice),
  };
};

const applyPropertyPayload = (property, payload = {}) => {
  Object.entries(payload).forEach(([key, value]) => {
    if (value !== undefined) {
      property[key] = value;
    }
  });
};

const findMatchingProperty = async ({ userId, payload, excludePropertyId }) => {
  if (!payload.address && !payload.addressLine1) {
    return null;
  }

  const query = { user: userId };

  if (excludePropertyId) {
    query._id = { $ne: excludePropertyId };
  }

  if (payload.addressLine1 && payload.city && payload.state) {
    query.addressLine1 = new RegExp(`^${escapeRegExp(payload.addressLine1)}$`, 'i');
    query.city = new RegExp(`^${escapeRegExp(payload.city)}$`, 'i');
    query.state = new RegExp(`^${escapeRegExp(payload.state)}$`, 'i');
    if (payload.zipCode) {
      query.zipCode = new RegExp(`^${escapeRegExp(payload.zipCode)}$`, 'i');
    }
    return Property.findOne(query).sort({ updatedAt: -1 });
  }

  if (payload.address) {
    query.address = new RegExp(`^${escapeRegExp(payload.address)}$`, 'i');
    return Property.findOne(query).sort({ updatedAt: -1 });
  }

  return null;
};

const resolveCanonicalProperty = async ({ userId, existingPropertyId, source }) => {
  const payload = buildPropertyPayload(source);
  if (!payload.address && !payload.addressLine1) {
    return { property: null, created: false };
  }

  let property = null;
  let created = false;

  if (existingPropertyId && mongoose.isValidObjectId(existingPropertyId)) {
    property = await Property.findOne({ _id: existingPropertyId, user: userId });
  }

  if (!property) {
    property = await findMatchingProperty({
      userId,
      payload,
      excludePropertyId: existingPropertyId,
    });
  }

  if (!property) {
    property = new Property({
      user: userId,
      address: payload.address || payload.addressLine1,
    });
    created = true;
  }

  applyPropertyPayload(property, payload);

  if (!property.address && payload.addressLine1) {
    property.address = payload.addressLine1;
  }

  await property.save();
  return { property, created };
};

const upsertCanonicalProperty = async ({ userId, existingPropertyId, source }) => {
  const { property } = await resolveCanonicalProperty({ userId, existingPropertyId, source });
  return property;
};

const attachPropertyToGroupDocuments = async (group, propertyId) => {
  const documents = [
    ...(group?.leads || []),
    ...(group?.investments || []),
    ...(group?.managedProperties || []),
  ];

  await Promise.all(
    documents.map(async (document) => {
      if (String(document.property || '') === String(propertyId)) {
        return;
      }

      document.property = propertyId;
      await document.save();
    })
  );
};

module.exports = {
  buildPropertyPayload,
  findMatchingProperty,
  resolveCanonicalProperty,
  upsertCanonicalProperty,
  attachPropertyToGroupDocuments,
};
