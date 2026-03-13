const Lead = require('../models/Lead');
const Investment = require('../models/Investment');
const {
  fetchPropertyGroupsForUser,
  findPropertyGroupForUser,
  buildPropertyRecord,
  normalizeNumber,
} = require('../utils/propertyWorkspace');
const { getLeadPropertyPreview } = require('../utils/leadPropertyService');
const {
  getPropertyStrategyLabel,
  isManagementEligibleStrategy,
  normalizePropertyStrategy,
} = require('../utils/propertyStrategy');
const {
  attachPropertyToGroupDocuments,
  upsertCanonicalProperty,
} = require('../utils/propertyRecordService');
const { startManagementWorkspace } = require('../utils/managementWorkspaceService');

const sharedNumericFields = new Set([
  'bedrooms',
  'bathrooms',
  'squareFootage',
  'lotSize',
  'yearBuilt',
  'unitCount',
  'latitude',
  'longitude',
]);

const sharedStringFields = new Set([
  'address',
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'zipCode',
  'county',
  'propertyType',
]);

const leadNumericFields = [
  'sellerAskingPrice',
  'targetOffer',
  'arv',
  'rehabEstimate',
  'daysOnMarket',
  'lastSalePrice',
];

const optionalString = (value) => {
  if (value === undefined || value === null) return undefined;

  const normalized = String(value).trim();
  return normalized || undefined;
};

const optionalDate = (value) => {
  if (!value) return undefined;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const buildSharedUpdates = (input = {}) => {
  const updates = {};

  Object.entries(input).forEach(([key, value]) => {
    if (sharedNumericFields.has(key)) {
      updates[key] = normalizeNumber(value);
      return;
    }

    if (sharedStringFields.has(key)) {
      updates[key] = typeof value === 'string' ? value.trim() : value;
    }
  });

  return updates;
};

const buildLeadPayload = (userId, property, input = {}) => {
  const payload = {
    user: userId,
    property: property._id,
    address: property.address,
    addressLine1: property.addressLine1,
    addressLine2: property.addressLine2,
    city: property.city,
    state: property.state,
    zipCode: property.zipCode,
    county: property.county,
    latitude: property.latitude,
    longitude: property.longitude,
    propertyType: property.propertyType || '',
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    squareFootage: property.squareFootage,
    lotSize: property.lotSize,
    yearBuilt: property.yearBuilt,
    sellerName: optionalString(input.sellerName),
    sellerPhone: optionalString(input.sellerPhone),
    sellerEmail: optionalString(input.sellerEmail),
    leadSource: optionalString(input.leadSource),
    occupancyStatus: optionalString(input.occupancyStatus),
    motivation: optionalString(input.motivation),
    nextAction: optionalString(input.nextAction),
    notes: optionalString(input.notes),
    listingStatus: optionalString(input.listingStatus),
    followUpDate: optionalDate(input.followUpDate),
    lastSaleDate: optionalDate(input.lastSaleDate),
  };

  leadNumericFields.forEach((field) => {
    const normalized = normalizeNumber(input[field]);
    if (normalized !== null) {
      payload[field] = normalized;
    }
  });

  return payload;
};

const buildInvestmentPayload = ({
  userId,
  property,
  input = {},
  defaultStrategy = 'flip',
}) => {
  const strategy = normalizePropertyStrategy(input.strategy || defaultStrategy);

  return {
    user: userId,
    property: property._id,
    address: property.address,
    propertyType: property.propertyType || '',
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    sqft: property.squareFootage,
    lotSize: property.lotSize,
    yearBuilt: property.yearBuilt,
    unitCount: property.unitCount,
    purchasePrice:
      normalizeNumber(input.purchasePrice) ??
      normalizeNumber(input.targetOffer) ??
      normalizeNumber(input.sellerAskingPrice) ??
      0,
    arv: normalizeNumber(input.arv) ?? 0,
    strategy,
    type: strategy,
  };
};

const findGroupBySourceIds = (groups, property) => {
  const leadIds = new Set(property.leads.map((lead) => String(lead._id)));
  const investmentIds = new Set(property.investments.map((investment) => String(investment._id)));
  const managementIds = new Set(
    property.managedProperties.map((managedProperty) => String(managedProperty._id))
  );

  return (
    groups.find((group) =>
      group.leads.some((lead) => leadIds.has(String(lead._id))) ||
      group.investments.some((investment) => investmentIds.has(String(investment._id))) ||
      group.managedProperties.some((managedProperty) =>
        managementIds.has(String(managedProperty._id))
      )
    ) || null
  );
};

const ensureCanonicalPropertyForGroup = async (userId, group, baseSource = {}) => {
  const property = await upsertCanonicalProperty({
    userId,
    existingPropertyId: group.canonicalProperty?._id || group.propertyKey,
    source: {
      ...buildPropertyRecord(group).sharedProfile,
      ...baseSource,
    },
  });

  if (property) {
    await attachPropertyToGroupDocuments(group, property._id);
  }

  return property;
};

const applyLeadUpdates = async (lead, updates) => {
  if (updates.address && updates.address !== lead.address) {
    const preview = await getLeadPropertyPreview({
      address: updates.address,
      propertyType: updates.propertyType ?? lead.propertyType,
      bedrooms: updates.bedrooms ?? lead.bedrooms,
      bathrooms: updates.bathrooms ?? lead.bathrooms,
      squareFootage: updates.squareFootage ?? lead.squareFootage,
      lotSize: updates.lotSize ?? lead.lotSize,
      yearBuilt: updates.yearBuilt ?? lead.yearBuilt,
    }).catch(() => null);

    lead.address = preview?.address || updates.address;

    if (preview) {
      lead.addressLine1 = preview.addressLine1 || lead.addressLine1;
      lead.addressLine2 = preview.addressLine2 || lead.addressLine2;
      lead.city = preview.city || lead.city;
      lead.state = preview.state || lead.state;
      lead.zipCode = preview.zipCode || lead.zipCode;
      lead.county = preview.county || lead.county;
      lead.latitude = preview.latitude ?? lead.latitude;
      lead.longitude = preview.longitude ?? lead.longitude;
    }
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'propertyType')) {
    lead.propertyType = updates.propertyType || '';
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'bedrooms')) {
    lead.bedrooms = updates.bedrooms;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'bathrooms')) {
    lead.bathrooms = updates.bathrooms;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'squareFootage')) {
    lead.squareFootage = updates.squareFootage;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'lotSize')) {
    lead.lotSize = updates.lotSize;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'yearBuilt')) {
    lead.yearBuilt = updates.yearBuilt;
  }

  await lead.save();
};

const applyInvestmentUpdates = async (investment, updates) => {
  if (Object.prototype.hasOwnProperty.call(updates, 'address')) {
    investment.address = updates.address;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'propertyType')) {
    investment.propertyType = updates.propertyType || '';
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'bedrooms')) {
    investment.bedrooms = updates.bedrooms;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'bathrooms')) {
    investment.bathrooms = updates.bathrooms;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'squareFootage')) {
    investment.sqft = updates.squareFootage;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'lotSize')) {
    investment.lotSize = updates.lotSize;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'yearBuilt')) {
    investment.yearBuilt = updates.yearBuilt;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'unitCount')) {
    investment.unitCount = updates.unitCount;
  }

  await investment.save();
};

const applyManagedPropertyUpdates = async (managedProperty, updates) => {
  if (Object.prototype.hasOwnProperty.call(updates, 'address')) {
    managedProperty.address = updates.address;
    await managedProperty.save();
  }
};

exports.getProperties = async (req, res) => {
  try {
    const groups = await fetchPropertyGroupsForUser(req.user.id);
    res.json(groups.map(buildPropertyRecord));
  } catch (error) {
    console.error('Get properties error:', error);
    res.status(500).json({ msg: 'Failed to load unified properties.' });
  }
};

exports.createProperty = async (req, res) => {
  try {
    const sharedProfile = buildSharedUpdates(req.body);
    const workspaceKey = req.body?.workspaceKey || 'property_only';

    if (!sharedProfile.address) {
      return res.status(400).json({ msg: 'Address is required.' });
    }

    const property = await upsertCanonicalProperty({
      userId: req.user.id,
      source: sharedProfile,
    });

    if (!property) {
      return res.status(400).json({ msg: 'Could not create the property.' });
    }

    let lead = null;
    let investment = null;
    let managedProperty = null;

    if (workspaceKey === 'pipeline') {
      lead = await Lead.create(buildLeadPayload(req.user.id, property, req.body));
    }

    if (workspaceKey === 'acquisitions') {
      investment = await Investment.create(
        buildInvestmentPayload({
          userId: req.user.id,
          property,
          input: req.body,
          defaultStrategy: 'flip',
        })
      );
    }

    if (workspaceKey === 'management') {
      const requestedStrategy = normalizePropertyStrategy(req.body?.strategy || 'rental');
      if (!isManagementEligibleStrategy(requestedStrategy)) {
        return res.status(400).json({
          msg: `${getPropertyStrategyLabel(requestedStrategy)} properties cannot start in management. Use Fix & Rent or Rental.`,
        });
      }

      investment = await Investment.create(
        buildInvestmentPayload({
          userId: req.user.id,
          property,
          input: req.body,
          defaultStrategy: requestedStrategy,
        })
      );

      managedProperty = await startManagementWorkspace({
        investment,
        userId: req.user.id,
      });
    }

    const groups = await fetchPropertyGroupsForUser(req.user.id);
    const createdGroup = groups.find((group) => group.propertyKey === String(property._id));

    return res.status(201).json({
      property: createdGroup ? buildPropertyRecord(createdGroup) : null,
      propertyId: property._id,
      leadId: lead?._id || null,
      investmentId: investment?._id || null,
      managedPropertyId: managedProperty?._id || null,
    });
  } catch (error) {
    console.error('Create property error:', error);

    if (error?.code === 11000) {
      return res.status(409).json({ msg: 'A similar property record already exists.' });
    }

    return res.status(500).json({ msg: 'Failed to create the property.' });
  }
};

exports.getPropertyByKey = async (req, res) => {
  try {
    const property = await findPropertyGroupForUser(req.user.id, req.params.propertyKey);
    if (!property) {
      return res.status(404).json({ msg: 'Property not found.' });
    }

    res.json(buildPropertyRecord(property));
  } catch (error) {
    console.error('Get property workspace error:', error);
    res.status(500).json({ msg: 'Failed to load the property workspace.' });
  }
};

exports.updatePropertyProfile = async (req, res) => {
  try {
    const property = await findPropertyGroupForUser(req.user.id, req.params.propertyKey);
    if (!property) {
      return res.status(404).json({ msg: 'Property not found.' });
    }

    const updates = buildSharedUpdates(req.body);
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ msg: 'No shared property fields were provided.' });
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'address') && !updates.address) {
      return res.status(400).json({ msg: 'Address is required.' });
    }

    const canonicalProperty = await ensureCanonicalPropertyForGroup(req.user.id, property, updates);

    await Promise.all([
      ...property.leads.map((lead) => applyLeadUpdates(lead, updates)),
      ...property.investments.map((investment) => applyInvestmentUpdates(investment, updates)),
      ...property.managedProperties.map((managedProperty) =>
        applyManagedPropertyUpdates(managedProperty, updates)
      ),
    ]);

    const groups = await fetchPropertyGroupsForUser(req.user.id);
    const refreshed = canonicalProperty
      ? groups.find((group) => group.propertyKey === String(canonicalProperty._id))
      : findGroupBySourceIds(groups, property);

    res.json(refreshed ? buildPropertyRecord(refreshed) : null);
  } catch (error) {
    console.error('Update property workspace error:', error);
    res.status(500).json({ msg: 'Failed to update the shared property profile.' });
  }
};

exports.createPipelineWorkspace = async (req, res) => {
  try {
    const property = await findPropertyGroupForUser(req.user.id, req.params.propertyKey);
    if (!property) {
      return res.status(404).json({ msg: 'Property not found.' });
    }

    if (property.leads.length > 0) {
      return res.status(400).json({ msg: 'This property already has a pipeline workspace.' });
    }

    const record = buildPropertyRecord(property);
    const canonicalProperty = await ensureCanonicalPropertyForGroup(req.user.id, property, record.sharedProfile);
    const lead = await Lead.create({
      user: req.user.id,
      property: canonicalProperty?._id || null,
      address: record.sharedProfile.address,
      propertyType: record.sharedProfile.propertyType || '',
      bedrooms: record.sharedProfile.bedrooms,
      bathrooms: record.sharedProfile.bathrooms,
      squareFootage: record.sharedProfile.squareFootage,
      lotSize: record.sharedProfile.lotSize,
      yearBuilt: record.sharedProfile.yearBuilt,
      arv: property.investments[0]?.arv || null,
    });

    const groups = await fetchPropertyGroupsForUser(req.user.id);
    const refreshed =
      groups.find((group) => group.leads.some((existingLead) => String(existingLead._id) === String(lead._id))) ||
      findGroupBySourceIds(groups, property);

    res.status(201).json({
      property: refreshed ? buildPropertyRecord(refreshed) : null,
      leadId: lead._id,
    });
  } catch (error) {
    console.error('Create pipeline workspace error:', error);
    res.status(500).json({ msg: 'Failed to create the pipeline workspace.' });
  }
};

exports.createAcquisitionWorkspace = async (req, res) => {
  try {
    const property = await findPropertyGroupForUser(req.user.id, req.params.propertyKey);
    if (!property) {
      return res.status(404).json({ msg: 'Property not found.' });
    }

    if (property.investments.length > 0) {
      return res.status(400).json({ msg: 'This property already has an acquisitions workspace.' });
    }

    const record = buildPropertyRecord(property);
    const lead = property.leads[0] || null;
    const requestedStrategy = normalizePropertyStrategy(req.body?.strategy || 'flip');
    const canonicalProperty = await ensureCanonicalPropertyForGroup(req.user.id, property, record.sharedProfile);

    const investment = await Investment.create({
      user: req.user.id,
      property: canonicalProperty?._id || null,
      address: record.sharedProfile.address,
      propertyType: record.sharedProfile.propertyType || '',
      bedrooms: record.sharedProfile.bedrooms,
      bathrooms: record.sharedProfile.bathrooms,
      sqft: record.sharedProfile.squareFootage,
      lotSize: record.sharedProfile.lotSize,
      yearBuilt: record.sharedProfile.yearBuilt,
      unitCount: record.sharedProfile.unitCount,
      purchasePrice: lead?.targetOffer || lead?.sellerAskingPrice || 0,
      arv: lead?.arv || 0,
      strategy: requestedStrategy,
      type: requestedStrategy,
    });

    const groups = await fetchPropertyGroupsForUser(req.user.id);
    const refreshed =
      groups.find((group) =>
        group.investments.some((existingInvestment) => String(existingInvestment._id) === String(investment._id))
      ) || findGroupBySourceIds(groups, property);

    res.status(201).json({
      property: refreshed ? buildPropertyRecord(refreshed) : null,
      investmentId: investment._id,
    });
  } catch (error) {
    console.error('Create acquisition workspace error:', error);
    res.status(500).json({ msg: 'Failed to create the acquisitions workspace.' });
  }
};

exports.createManagementWorkspace = async (req, res) => {
  try {
    const property = await findPropertyGroupForUser(req.user.id, req.params.propertyKey);
    if (!property) {
      return res.status(404).json({ msg: 'Property not found.' });
    }

    if (property.managedProperties.length > 0) {
      return res.status(400).json({ msg: 'This property already has a management workspace.' });
    }

    const requestedStrategy = normalizePropertyStrategy(
      req.body?.strategy ||
        property.investments[0]?.strategy ||
        property.investments[0]?.type ||
        'rental'
    );

    if (!isManagementEligibleStrategy(requestedStrategy)) {
      return res.status(400).json({
        msg: `${getPropertyStrategyLabel(requestedStrategy)} properties cannot start in management. Use Fix & Rent or Rental.`,
      });
    }

    const record = buildPropertyRecord(property);
    const canonicalProperty = await ensureCanonicalPropertyForGroup(
      req.user.id,
      property,
      record.sharedProfile
    );

    let investment = property.investments[0] || null;

    if (!investment) {
      investment = await Investment.create(
        buildInvestmentPayload({
          userId: req.user.id,
          property: canonicalProperty || { ...record.sharedProfile, _id: null },
          input: {
            ...req.body,
            targetOffer: property.leads[0]?.targetOffer,
            sellerAskingPrice: property.leads[0]?.sellerAskingPrice,
            arv: property.leads[0]?.arv,
          },
          defaultStrategy: requestedStrategy,
        })
      );
    } else {
      const currentStrategy = normalizePropertyStrategy(investment.strategy || investment.type);

      if (!isManagementEligibleStrategy(currentStrategy) || currentStrategy !== requestedStrategy) {
        investment.strategy = requestedStrategy;
        investment.type = requestedStrategy;
      }

      if (canonicalProperty && String(investment.property || '') !== String(canonicalProperty._id)) {
        investment.property = canonicalProperty._id;
      }

      await investment.save();
    }

    const managedProperty = await startManagementWorkspace({
      investment,
      userId: req.user.id,
    });

    const groups = await fetchPropertyGroupsForUser(req.user.id);
    const refreshed =
      groups.find((group) =>
        group.managedProperties.some(
          (existingManagedProperty) => String(existingManagedProperty._id) === String(managedProperty._id)
        )
      ) || findGroupBySourceIds(groups, property);

    return res.status(201).json({
      property: refreshed ? buildPropertyRecord(refreshed) : null,
      investmentId: investment._id,
      managedPropertyId: managedProperty._id,
    });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ msg: error.message });
    }

    console.error('Create management workspace error:', error);
    return res.status(500).json({ msg: 'Failed to create the management workspace.' });
  }
};
