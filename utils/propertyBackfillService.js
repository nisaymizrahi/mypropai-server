const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const Investment = require('../models/Investment');
const ManagedProperty = require('../models/ManagedProperty');
const Property = require('../models/Property');
const {
  buildPropertyPayload,
  findMatchingProperty,
  resolveCanonicalProperty,
} = require('./propertyRecordService');

const toIdString = (value) => {
  if (!value) return null;
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
};

const buildPayloadKey = (userId, payload = {}) =>
  JSON.stringify({
    userId: String(userId),
    address: payload.address || '',
    addressLine1: payload.addressLine1 || '',
    city: payload.city || '',
    state: payload.state || '',
    zipCode: payload.zipCode || '',
  });

const getPropertyLinkStats = async () => {
  const [
    propertyCount,
    leadTotal,
    leadLinked,
    investmentTotal,
    investmentLinked,
    managedTotal,
    managedLinked,
  ] = await Promise.all([
    Property.countDocuments(),
    Lead.countDocuments(),
    Lead.countDocuments({ property: { $exists: true, $ne: null } }),
    Investment.countDocuments(),
    Investment.countDocuments({ property: { $exists: true, $ne: null } }),
    ManagedProperty.countDocuments(),
    ManagedProperty.countDocuments({ property: { $exists: true, $ne: null } }),
  ]);

  return {
    properties: {
      total: propertyCount,
    },
    leads: {
      total: leadTotal,
      linked: leadLinked,
      unlinked: leadTotal - leadLinked,
    },
    investments: {
      total: investmentTotal,
      linked: investmentLinked,
      unlinked: investmentTotal - investmentLinked,
    },
    managedProperties: {
      total: managedTotal,
      linked: managedLinked,
      unlinked: managedTotal - managedLinked,
    },
  };
};

const resolveDryRunPropertyId = async ({
  userId,
  existingPropertyId,
  source,
  simulatedProperties,
  summary,
}) => {
  if (existingPropertyId && mongoose.isValidObjectId(existingPropertyId)) {
    const existingProperty = await Property.findOne({ _id: existingPropertyId, user: userId }).select('_id');
    if (existingProperty) {
      return String(existingProperty._id);
    }
  }

  const payload = buildPropertyPayload(source);
  if (!payload.address && !payload.addressLine1) {
    return null;
  }

  const matchedProperty = await findMatchingProperty({
    userId,
    payload,
    excludePropertyId: existingPropertyId,
  });

  if (matchedProperty) {
    return String(matchedProperty._id);
  }

  const cacheKey = buildPayloadKey(userId, payload);
  if (!simulatedProperties.has(cacheKey)) {
    simulatedProperties.set(cacheKey, `simulated:${simulatedProperties.size + 1}`);
    summary.propertiesProjected += 1;
  }

  return simulatedProperties.get(cacheKey);
};

const backfillPropertyLinks = async ({ dryRun = false } = {}) => {
  const before = await getPropertyLinkStats();
  const summary = {
    dryRun,
    propertiesProjected: 0,
    propertiesCreated: 0,
    leadsLinked: 0,
    investmentsLinked: 0,
    managedPropertiesLinked: 0,
  };

  const simulatedProperties = new Map();
  const resolvedInvestmentProperties = new Map();

  const leads = await Lead.find().sort({ updatedAt: -1 });
  for (const lead of leads) {
    const dryRunPropertyId = dryRun
      ? await resolveDryRunPropertyId({
          userId: lead.user,
          existingPropertyId: lead.property,
          source: lead,
          simulatedProperties,
          summary,
        })
      : null;

    const liveResult = dryRun
      ? null
      : await resolveCanonicalProperty({
          userId: lead.user,
          existingPropertyId: lead.property,
          source: lead,
        });

    const resolvedPropertyId = dryRun
      ? dryRunPropertyId
      : liveResult?.property?._id;

    if (!resolvedPropertyId) {
      continue;
    }

    if (!dryRun && liveResult?.created) {
      summary.propertiesCreated += 1;
    }

    if (String(lead.property || '') !== String(resolvedPropertyId)) {
      summary.leadsLinked += 1;
      if (!dryRun) {
        lead.property = resolvedPropertyId;
        await lead.save();
      }
    }
  }

  const investments = await Investment.find().sort({ updatedAt: -1 });
  for (const investment of investments) {
    if (dryRun) {
      const resolvedPropertyId = await resolveDryRunPropertyId({
        userId: investment.user,
        existingPropertyId: investment.property,
        source: investment,
        simulatedProperties,
        summary,
      });

      if (resolvedPropertyId) {
        resolvedInvestmentProperties.set(String(investment._id), resolvedPropertyId);
      }

      if (String(investment.property || '') !== String(resolvedPropertyId || '')) {
        summary.investmentsLinked += resolvedPropertyId ? 1 : 0;
      }

      continue;
    }

    const { property, created } = await resolveCanonicalProperty({
      userId: investment.user,
      existingPropertyId: investment.property,
      source: investment,
    });

    if (!property) {
      continue;
    }

    resolvedInvestmentProperties.set(String(investment._id), String(property._id));
    if (created) {
      summary.propertiesCreated += 1;
    }

    if (String(investment.property || '') !== String(property._id)) {
      summary.investmentsLinked += 1;
      investment.property = property._id;
      await investment.save();
    }
  }

  const managedProperties = await ManagedProperty.find()
    .populate('investment', 'user property address propertyType bedrooms bathrooms sqft lotSize yearBuilt unitCount')
    .populate('units', '_id')
    .sort({ updatedAt: -1 });

  for (const managedProperty of managedProperties) {
    const relatedInvestmentId = toIdString(managedProperty.investment);
    const relatedInvestmentPropertyId = relatedInvestmentId
      ? resolvedInvestmentProperties.get(relatedInvestmentId) || toIdString(managedProperty.investment?.property)
      : null;

    if (dryRun) {
      const resolvedPropertyId =
        relatedInvestmentPropertyId ||
        (await resolveDryRunPropertyId({
          userId: managedProperty.user,
          existingPropertyId: managedProperty.property,
          source: managedProperty,
          simulatedProperties,
          summary,
        }));

      if (String(managedProperty.property || '') !== String(resolvedPropertyId || '')) {
        summary.managedPropertiesLinked += resolvedPropertyId ? 1 : 0;
      }

      continue;
    }

    const { property, created } = await resolveCanonicalProperty({
      userId: managedProperty.user,
      existingPropertyId: relatedInvestmentPropertyId || managedProperty.property,
      source: managedProperty,
    });

    if (!property) {
      continue;
    }

    if (created) {
      summary.propertiesCreated += 1;
    }

    if (String(managedProperty.property || '') !== String(property._id)) {
      summary.managedPropertiesLinked += 1;
      managedProperty.property = property._id;
      await managedProperty.save();
    }
  }

  const after = dryRun
    ? {
        properties: {
          total: before.properties.total + summary.propertiesProjected,
        },
        leads: {
          ...before.leads,
          linked: before.leads.linked + summary.leadsLinked,
          unlinked: Math.max(before.leads.unlinked - summary.leadsLinked, 0),
        },
        investments: {
          ...before.investments,
          linked: before.investments.linked + summary.investmentsLinked,
          unlinked: Math.max(before.investments.unlinked - summary.investmentsLinked, 0),
        },
        managedProperties: {
          ...before.managedProperties,
          linked: before.managedProperties.linked + summary.managedPropertiesLinked,
          unlinked: Math.max(
            before.managedProperties.unlinked - summary.managedPropertiesLinked,
            0
          ),
        },
      }
    : await getPropertyLinkStats();

  return {
    before,
    after,
    summary,
  };
};

module.exports = {
  getPropertyLinkStats,
  backfillPropertyLinks,
};
