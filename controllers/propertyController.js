const Lead = require('../models/Lead');
const Investment = require('../models/Investment');
const {
  fetchPropertyGroupsForUser,
  findPropertyGroupForUser,
  buildPropertyRecord,
  normalizeNumber,
} = require('../utils/propertyWorkspace');
const { getLeadPropertyPreview } = require('../utils/leadPropertyService');
const { normalizePropertyStrategy } = require('../utils/propertyStrategy');

const sharedNumericFields = new Set([
  'bedrooms',
  'bathrooms',
  'squareFootage',
  'lotSize',
  'yearBuilt',
  'unitCount',
]);

const buildSharedUpdates = (input = {}) => {
  const updates = {};

  Object.entries(input).forEach(([key, value]) => {
    if (sharedNumericFields.has(key)) {
      updates[key] = normalizeNumber(value);
      return;
    }

    if (key === 'address' || key === 'propertyType') {
      updates[key] = typeof value === 'string' ? value.trim() : value;
    }
  });

  return updates;
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

    await Promise.all([
      ...property.leads.map((lead) => applyLeadUpdates(lead, updates)),
      ...property.investments.map((investment) => applyInvestmentUpdates(investment, updates)),
      ...property.managedProperties.map((managedProperty) =>
        applyManagedPropertyUpdates(managedProperty, updates)
      ),
    ]);

    const groups = await fetchPropertyGroupsForUser(req.user.id);
    const refreshed = findGroupBySourceIds(groups, property);

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
    const lead = await Lead.create({
      user: req.user.id,
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

    const investment = await Investment.create({
      user: req.user.id,
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
