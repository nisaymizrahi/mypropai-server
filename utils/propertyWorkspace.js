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

const buildPropertyKey = (subject = {}) => {
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

const readLeadProfile = (lead) => ({
  address: lead?.address || '',
  propertyType: lead?.propertyType || '',
  bedrooms: normalizeNumber(lead?.bedrooms),
  bathrooms: normalizeNumber(lead?.bathrooms),
  squareFootage: normalizeNumber(lead?.squareFootage),
  lotSize: normalizeNumber(lead?.lotSize),
  yearBuilt: normalizeNumber(lead?.yearBuilt),
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

  const leadProfile = readLeadProfile(primaryLead);
  const investmentProfile = readInvestmentProfile(primaryInvestment);
  const managedProfile = readManagedProfile(primaryManagedProperty);

  return {
    address: pickFirst(managedProfile.address, investmentProfile.address, leadProfile.address, ''),
    propertyType: pickFirst(investmentProfile.propertyType, leadProfile.propertyType, ''),
    bedrooms: pickFirst(investmentProfile.bedrooms, leadProfile.bedrooms, null),
    bathrooms: pickFirst(investmentProfile.bathrooms, leadProfile.bathrooms, null),
    squareFootage: pickFirst(investmentProfile.squareFootage, leadProfile.squareFootage, null),
    lotSize: pickFirst(investmentProfile.lotSize, leadProfile.lotSize, null),
    yearBuilt: pickFirst(investmentProfile.yearBuilt, leadProfile.yearBuilt, null),
    unitCount: pickFirst(investmentProfile.unitCount, managedProfile.unitCount, null),
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
          label: 'Acquisitions',
          path: `/investments/${primaryInvestment._id}`,
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
  const timestamps = [...group.leads, ...group.investments, ...group.managedProperties]
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
    title: sharedProfile.address || 'Untitled property',
    sharedProfile,
    workspaces,
    placement: buildPlacement(workspaces),
    updatedAt: buildLatestUpdatedAt(group),
  };
};

const buildPropertyGroups = ({ leads = [], investments = [], managedProperties = [] }) => {
  const groups = new Map();

  const ensureGroup = (propertyKey) => {
    if (!groups.has(propertyKey)) {
      groups.set(propertyKey, {
        propertyKey,
        leads: [],
        investments: [],
        managedProperties: [],
      });
    }

    return groups.get(propertyKey);
  };

  leads.forEach((lead) => {
    const propertyKey = buildPropertyKey(lead) || `lead-${lead._id}`;
    ensureGroup(propertyKey).leads.push(lead);
  });

  investments.forEach((investment) => {
    const propertyKey = buildPropertyKey(investment) || `investment-${investment._id}`;
    ensureGroup(propertyKey).investments.push(investment);
  });

  managedProperties.forEach((property) => {
    const propertyKey = buildPropertyKey(property) || `management-${property._id}`;
    ensureGroup(propertyKey).managedProperties.push(property);
  });

  return [...groups.values()].sort((left, right) => {
    const leftRecord = buildPropertyRecord(left);
    const rightRecord = buildPropertyRecord(right);
    return new Date(rightRecord.updatedAt || 0) - new Date(leftRecord.updatedAt || 0);
  });
};

const fetchPropertyGroupsForUser = async (userId) => {
  const [leads, investments, managedProperties] = await Promise.all([
    Lead.find({ user: userId }).sort({ updatedAt: -1 }),
    Investment.find({ user: userId }).sort({ updatedAt: -1 }),
    ManagedProperty.find({ user: userId }).populate('units', '_id').sort({ updatedAt: -1 }),
  ]);

  return buildPropertyGroups({ leads, investments, managedProperties });
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
