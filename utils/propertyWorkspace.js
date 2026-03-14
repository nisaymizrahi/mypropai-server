const Property = require('../models/Property');
const Lead = require('../models/Lead');
const Investment = require('../models/Investment');
const ManagedProperty = require('../models/ManagedProperty');
const {
  getPropertyStrategyLabel,
  normalizePropertyStrategy,
} = require('./propertyStrategy');

const isPresent = (value) => value !== undefined && value !== null && value !== '';

const normalizeNumber = (value) => {
  if (!isPresent(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const slugify = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const parseAddressParts = (address = '') => {
  const parts = String(address)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 2) {
    return {
      addressLine1: address,
      city: '',
      state: '',
      zipCode: '',
    };
  }

  const [addressLine1, city, ...rest] = parts;
  const regionPart = rest.join(' ').trim();
  const regionTokens = regionPart.split(/\s+/).filter(Boolean);

  return {
    addressLine1,
    city: city || '',
    state: regionTokens[0] || '',
    zipCode: regionTokens[1] || '',
  };
};

const getPropertyRefId = (subject = {}) => {
  if (!subject?.property) return null;
  if (typeof subject.property === 'object' && subject.property._id) {
    return String(subject.property._id);
  }

  return String(subject.property);
};

const buildAddressGroupingKey = (subject = {}) => {
  const parsedAddress = parseAddressParts(subject.address);
  const parts = [
    subject.addressLine1 || parsedAddress.addressLine1 || subject.address,
    subject.city || parsedAddress.city,
    subject.state || parsedAddress.state,
    subject.zipCode || parsedAddress.zipCode,
  ]
    .map(slugify)
    .filter(Boolean);

  if (parts.length > 0) {
    return parts.join('--');
  }

  return slugify(subject.address);
};

const buildPropertyKey = (subject = {}) => getPropertyRefId(subject) || buildAddressGroupingKey(subject);

const getPrimaryDocument = (documents = []) =>
  [...documents].sort(
    (left, right) => new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0)
  )[0] || null;

const pickFirst = (...values) => {
  for (const value of values) {
    if (isPresent(value)) {
      return value;
    }
  }

  return null;
};

const readPropertyProfile = (property) => ({
  address: property?.address || '',
  addressLine1: property?.addressLine1 || '',
  addressLine2: property?.addressLine2 || '',
  city: property?.city || '',
  state: property?.state || '',
  zipCode: property?.zipCode || '',
  county: property?.county || '',
  latitude: normalizeNumber(property?.latitude),
  longitude: normalizeNumber(property?.longitude),
  propertyType: property?.propertyType || '',
  bedrooms: normalizeNumber(property?.bedrooms),
  bathrooms: normalizeNumber(property?.bathrooms),
  squareFootage: normalizeNumber(property?.squareFootage),
  lotSize: normalizeNumber(property?.lotSize),
  yearBuilt: normalizeNumber(property?.yearBuilt),
  unitCount: normalizeNumber(property?.unitCount),
  listingStatus: property?.listingStatus || '',
  sellerAskingPrice: normalizeNumber(property?.sellerAskingPrice),
});

const readLeadProfile = (lead) => ({
  address: lead?.address || '',
  addressLine1: lead?.addressLine1 || '',
  addressLine2: lead?.addressLine2 || '',
  city: lead?.city || '',
  state: lead?.state || '',
  zipCode: lead?.zipCode || '',
  county: lead?.county || '',
  latitude: normalizeNumber(lead?.latitude),
  longitude: normalizeNumber(lead?.longitude),
  propertyType: lead?.propertyType || '',
  bedrooms: normalizeNumber(lead?.bedrooms),
  bathrooms: normalizeNumber(lead?.bathrooms),
  squareFootage: normalizeNumber(lead?.squareFootage),
  lotSize: normalizeNumber(lead?.lotSize),
  yearBuilt: normalizeNumber(lead?.yearBuilt),
  listingStatus: lead?.listingStatus || '',
  sellerAskingPrice: normalizeNumber(lead?.sellerAskingPrice),
});

const readInvestmentProfile = (investment) => ({
  address: investment?.address || '',
  propertyType: investment?.propertyType || '',
  bedrooms: normalizeNumber(investment?.bedrooms),
  bathrooms: normalizeNumber(investment?.bathrooms),
  squareFootage: normalizeNumber(investment?.sqft),
  lotSize: normalizeNumber(investment?.lotSize),
  yearBuilt: normalizeNumber(investment?.yearBuilt),
  unitCount: normalizeNumber(investment?.unitCount),
});

const readManagedProfile = (property) => ({
  address: property?.address || '',
  unitCount: Array.isArray(property?.units) ? property.units.length : null,
});

const buildSharedProfile = (group) => {
  const primaryLead = getPrimaryDocument(group.leads);
  const primaryInvestment = getPrimaryDocument(group.investments);
  const primaryManagedProperty = getPrimaryDocument(group.managedProperties);

  const propertyProfile = readPropertyProfile(group.canonicalProperty);
  const leadProfile = readLeadProfile(primaryLead);
  const investmentProfile = readInvestmentProfile(primaryInvestment);
  const managedProfile = readManagedProfile(primaryManagedProperty);

  return {
    address: pickFirst(propertyProfile.address, managedProfile.address, investmentProfile.address, leadProfile.address, ''),
    addressLine1: pickFirst(propertyProfile.addressLine1, leadProfile.addressLine1, ''),
    addressLine2: pickFirst(propertyProfile.addressLine2, leadProfile.addressLine2, ''),
    city: pickFirst(propertyProfile.city, leadProfile.city, ''),
    state: pickFirst(propertyProfile.state, leadProfile.state, ''),
    zipCode: pickFirst(propertyProfile.zipCode, leadProfile.zipCode, ''),
    county: pickFirst(propertyProfile.county, leadProfile.county, ''),
    latitude: pickFirst(propertyProfile.latitude, leadProfile.latitude, null),
    longitude: pickFirst(propertyProfile.longitude, leadProfile.longitude, null),
    propertyType: pickFirst(propertyProfile.propertyType, investmentProfile.propertyType, leadProfile.propertyType, ''),
    bedrooms: pickFirst(propertyProfile.bedrooms, investmentProfile.bedrooms, leadProfile.bedrooms, null),
    bathrooms: pickFirst(propertyProfile.bathrooms, investmentProfile.bathrooms, leadProfile.bathrooms, null),
    squareFootage: pickFirst(propertyProfile.squareFootage, investmentProfile.squareFootage, leadProfile.squareFootage, null),
    lotSize: pickFirst(propertyProfile.lotSize, investmentProfile.lotSize, leadProfile.lotSize, null),
    yearBuilt: pickFirst(propertyProfile.yearBuilt, investmentProfile.yearBuilt, leadProfile.yearBuilt, null),
    unitCount: pickFirst(propertyProfile.unitCount, investmentProfile.unitCount, managedProfile.unitCount, null),
    listingStatus: pickFirst(propertyProfile.listingStatus, leadProfile.listingStatus, ''),
    sellerAskingPrice: pickFirst(
      propertyProfile.sellerAskingPrice,
      leadProfile.sellerAskingPrice,
      null
    ),
  };
};

const buildWorkspaces = (group) => {
  const primaryLead = getPrimaryDocument(group.leads);
  const primaryInvestment = getPrimaryDocument(group.investments);
  const primaryManagedProperty = getPrimaryDocument(group.managedProperties);

  const investmentStrategy = primaryInvestment
    ? normalizePropertyStrategy(primaryInvestment.strategy || primaryInvestment.type)
    : null;

  return {
    pipeline: primaryLead
      ? {
          id: primaryLead._id,
          count: group.leads.length,
          status: primaryLead.status,
          label: 'Pipeline',
          path: `/leads/${primaryLead._id}`,
        }
      : null,
    acquisitions: primaryInvestment
      ? {
          id: primaryInvestment._id,
          count: group.investments.length,
          status: primaryInvestment.status,
          strategy: investmentStrategy,
          strategyLabel: getPropertyStrategyLabel(investmentStrategy),
          label: 'Project Management',
          path: `/project-management/${primaryInvestment._id}`,
        }
      : null,
    management: primaryManagedProperty
      ? {
          id: primaryManagedProperty._id,
          count: group.managedProperties.length,
          status: primaryManagedProperty.isActive ? 'Active' : 'Archived',
          unitCount: Array.isArray(primaryManagedProperty.units)
            ? primaryManagedProperty.units.length
            : 0,
          label: 'Management',
          path: `/management/${primaryManagedProperty._id}`,
        }
      : null,
  };
};

const buildPlacement = (workspaces) => {
  if (workspaces.management) return 'management';
  if (workspaces.acquisitions) return 'acquisitions';
  if (workspaces.pipeline) return 'pipeline';
  return 'unassigned';
};

const buildLatestUpdatedAt = (group) => {
  const timestamps = [
    group.canonicalProperty,
    ...group.leads,
    ...group.investments,
    ...group.managedProperties,
  ]
    .filter(Boolean)
    .map((document) => new Date(document.updatedAt || document.createdAt || 0).valueOf())
    .filter(Boolean);

  if (timestamps.length === 0) {
    return null;
  }

  return new Date(Math.max(...timestamps)).toISOString();
};

const buildPropertyRecord = (group) => {
  const sharedProfile = buildSharedProfile(group);
  const workspaces = buildWorkspaces(group);

  return {
    propertyKey: group.propertyKey,
    propertyId: group.canonicalProperty ? String(group.canonicalProperty._id) : null,
    title: sharedProfile.address || 'Untitled property',
    sharedProfile,
    workspaces,
    placement: buildPlacement(workspaces),
    updatedAt: buildLatestUpdatedAt(group),
  };
};

const buildPropertyGroups = ({
  properties = [],
  leads = [],
  investments = [],
  managedProperties = [],
}) => {
  const groups = new Map();

  const ensureGroup = (propertyKey, canonicalProperty = null) => {
    if (!groups.has(propertyKey)) {
      groups.set(propertyKey, {
        propertyKey,
        canonicalProperty: canonicalProperty || null,
        addressKeys: new Set(),
        leads: [],
        investments: [],
        managedProperties: [],
      });
    }

    const group = groups.get(propertyKey);
    if (!group.canonicalProperty && canonicalProperty) {
      group.canonicalProperty = canonicalProperty;
    }

    return group;
  };

  const rememberAddressKey = (group, subject) => {
    const addressKey = buildAddressGroupingKey(subject);
    if (addressKey) {
      group.addressKeys.add(addressKey);
    }
  };

  const findAddressMatchedGroup = (subject) => {
    const addressKey = buildAddressGroupingKey(subject);
    if (!addressKey) {
      return null;
    }

    return [...groups.values()].find((group) => group.addressKeys.has(addressKey)) || null;
  };

  const addDocument = (collectionKey, document, fallbackPrefix) => {
    const propertyRefId = getPropertyRefId(document);

    if (propertyRefId) {
      const canonicalProperty =
        typeof document.property === 'object' && document.property?._id ? document.property : null;
      const group = ensureGroup(propertyRefId, canonicalProperty);
      rememberAddressKey(group, canonicalProperty || document);
      group[collectionKey].push(document);
      return;
    }

    const matchedGroup = findAddressMatchedGroup(document);
    if (matchedGroup) {
      rememberAddressKey(matchedGroup, document);
      matchedGroup[collectionKey].push(document);
      return;
    }

    const propertyKey = buildAddressGroupingKey(document) || `${fallbackPrefix}-${document._id}`;
    const group = ensureGroup(propertyKey);
    rememberAddressKey(group, document);
    group[collectionKey].push(document);
  };

  properties.forEach((property) => {
    const propertyKey = String(property._id);
    const group = ensureGroup(propertyKey, property);
    rememberAddressKey(group, property);
  });

  leads.forEach((lead) => addDocument('leads', lead, 'lead'));
  investments.forEach((investment) => addDocument('investments', investment, 'investment'));
  managedProperties.forEach((property) => addDocument('managedProperties', property, 'management'));

  return [...groups.values()].sort((left, right) => {
    const leftRecord = buildPropertyRecord(left);
    const rightRecord = buildPropertyRecord(right);
    return new Date(rightRecord.updatedAt || 0) - new Date(leftRecord.updatedAt || 0);
  });
};

const fetchPropertyGroupsForUser = async (userId) => {
  const [properties, leads, investments, managedProperties] = await Promise.all([
    Property.find({ user: userId }).sort({ updatedAt: -1 }),
    Lead.find({ user: userId }).populate('property').sort({ updatedAt: -1 }),
    Investment.find({ user: userId }).populate('property').sort({ updatedAt: -1 }),
    ManagedProperty.find({ user: userId })
      .populate('property')
      .populate('units', '_id')
      .sort({ updatedAt: -1 }),
  ]);

  return buildPropertyGroups({ properties, leads, investments, managedProperties });
};

const findPropertyGroupForUser = async (userId, propertyKey) => {
  const groups = await fetchPropertyGroupsForUser(userId);
  return groups.find((group) => group.propertyKey === propertyKey) || null;
};

module.exports = {
  buildPropertyKey,
  buildPropertyRecord,
  fetchPropertyGroupsForUser,
  findPropertyGroupForUser,
  normalizeNumber,
};
