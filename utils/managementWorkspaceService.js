const ManagedProperty = require('../models/ManagedProperty');
const Unit = require('../models/Unit');
const {
  getPropertyStrategyLabel,
  isManagementEligibleStrategy,
  normalizePropertyStrategy,
} = require('./propertyStrategy');
const { upsertCanonicalProperty } = require('./propertyRecordService');

const createWorkspaceError = (status, message) =>
  Object.assign(new Error(message), { status });

const startManagementWorkspace = async ({ investment, userId }) => {
  if (!investment) {
    throw createWorkspaceError(404, 'Investment not found.');
  }

  if (String(investment.user) !== String(userId)) {
    throw createWorkspaceError(401, 'User not authorized.');
  }

  const strategy = normalizePropertyStrategy(investment.strategy || investment.type);
  if (!isManagementEligibleStrategy(strategy)) {
    throw createWorkspaceError(
      400,
      `${getPropertyStrategyLabel(strategy)} properties cannot be started in management. Use Fix & Rent or Rental.`
    );
  }

  if (investment.managedProperty) {
    throw createWorkspaceError(400, 'This property is already being managed.');
  }

  const property = await upsertCanonicalProperty({
    userId,
    existingPropertyId: investment.property,
    source: investment,
  });

  if (property && String(investment.property || '') !== String(property._id)) {
    investment.property = property._id;
  }

  const managedProperty = new ManagedProperty({
    property: property?._id || null,
    investment: investment._id,
    user: userId,
    address: investment.address,
  });

  const defaultUnit = new Unit({
    property: managedProperty._id,
    name: investment.unitCount > 1 ? 'Unit 1' : 'Main Unit',
    status: 'Vacant',
  });

  managedProperty.units.push(defaultUnit._id);
  investment.managedProperty = managedProperty._id;

  await managedProperty.save();
  await defaultUnit.save();
  await investment.save();

  return managedProperty;
};

module.exports = {
  startManagementWorkspace,
};
