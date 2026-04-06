const Investment = require('../models/Investment');
const BudgetItem = require('../models/BudgetItem');
const { numberOrNull } = require('./leadPropertyService');
const { buildBudgetScopeMeta, titleCaseFromSlug } = require('./projectScopes');

const buildPublicLeadSnapshot = (lead) => ({
  id: lead._id,
  address: lead.address,
  addressLine1: lead.addressLine1,
  addressLine2: lead.addressLine2,
  city: lead.city,
  state: lead.state,
  zipCode: lead.zipCode,
  county: lead.county,
  latitude: lead.latitude,
  longitude: lead.longitude,
  propertyType: lead.propertyType,
  bedrooms: lead.bedrooms,
  bathrooms: lead.bathrooms,
  squareFootage: lead.squareFootage,
  lotSize: lead.lotSize,
  yearBuilt: lead.yearBuilt,
  unitCount: lead.unitCount,
  sellerAskingPrice: lead.sellerAskingPrice,
  sellerName: lead.sellerName,
  sellerPhone: lead.sellerPhone,
  sellerEmail: lead.sellerEmail,
  leadSource: lead.leadSource,
  occupancyStatus: lead.occupancyStatus,
  motivation: lead.motivation,
  targetOffer: lead.targetOffer,
  arv: lead.arv,
  rehabEstimate: lead.rehabEstimate,
  nextAction: lead.nextAction,
  followUpDate: lead.followUpDate,
  listingStatus: lead.listingStatus,
  listedDate: lead.listedDate,
  daysOnMarket: lead.daysOnMarket,
  lastSalePrice: lead.lastSalePrice,
  lastSaleDate: lead.lastSaleDate,
  notes: lead.notes,
  status: lead.status,
  inPropertyWorkspace: Boolean(lead.inPropertyWorkspace),
  renovationPlan: lead.renovationPlan,
});

const cloneSerializable = (value) =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));

const buildProjectLeadSnapshot = (lead) => ({
  ...buildPublicLeadSnapshot(lead),
  compsAnalysis: cloneSerializable(lead.compsAnalysis || null),
});

const buildBudgetItemsFromLead = (lead, investmentId, userId) => {
  const sourceItems = Array.isArray(lead?.renovationPlan?.items) ? lead.renovationPlan.items : [];
  const normalizedItems = sourceItems
    .map((item, index) => {
      const categoryLabel =
        typeof item?.name === 'string' && item.name.trim()
          ? item.name.trim()
          : titleCaseFromSlug(item?.category || `scope-${index + 1}`) || `Scope item ${index + 1}`;
      const budget = numberOrNull(item?.budget) ?? 0;

      if (!categoryLabel && budget <= 0) {
        return null;
      }

      const scopeMeta = buildBudgetScopeMeta({
        scopeKey: item?.category || '',
        category: categoryLabel,
        description: item?.scopeDescription || '',
      });

      return {
        investment: investmentId,
        user: userId,
        scopeKey: scopeMeta.scopeKey,
        scopeGroup: scopeMeta.scopeGroup,
        category: categoryLabel || scopeMeta.defaultCategory,
        description: typeof item?.scopeDescription === 'string' ? item.scopeDescription.trim() : '',
        sourceRenovationItemId: typeof item?.itemId === 'string' ? item.itemId.trim() : '',
        budgetedAmount: budget,
        originalBudgetAmount: budget,
        status: 'Not Started',
        awards: [],
      };
    })
    .filter(Boolean);

  if (normalizedItems.length > 0) {
    return normalizedItems;
  }

  const fallbackBudget = numberOrNull(lead?.rehabEstimate);
  if (fallbackBudget !== null && fallbackBudget > 0) {
    const scopeMeta = buildBudgetScopeMeta({
      scopeKey: 'renovation',
      category: 'Renovation',
      description: 'Imported from the lead-level rehab estimate.',
    });

    return [
      {
        investment: investmentId,
        user: userId,
        scopeKey: scopeMeta.scopeKey,
        scopeGroup: scopeMeta.scopeGroup,
        category: 'Renovation',
        description: 'Imported from the lead-level rehab estimate.',
        sourceRenovationItemId: '',
        budgetedAmount: fallbackBudget,
        originalBudgetAmount: fallbackBudget,
        status: 'Not Started',
        awards: [],
      },
    ];
  }

  return [];
};

const findExistingProjectForLead = async ({ lead, userId }) => {
  let existingProject = null;

  if (lead.projectManagement) {
    existingProject = await Investment.findOne({
      _id: lead.projectManagement,
      user: userId,
    })
      .populate('property')
      .populate('sourceLead', 'address status projectManagement');
  }

  if (!existingProject) {
    existingProject = await Investment.findOne({
      user: userId,
      sourceLead: lead._id,
    })
      .populate('property')
      .populate('sourceLead', 'address status projectManagement');
  }

  return existingProject;
};

const createExecutionProjectFromLead = async ({
  lead,
  userId,
  propertyId = null,
  strategy = 'flip',
  type = strategy,
  status = 'In Progress',
  linkLead = true,
}) => {
  const existingProject = await findExistingProjectForLead({ lead, userId });
  if (existingProject) {
    if (linkLead && !lead.projectManagement) {
      lead.projectManagement = existingProject._id;
      if (propertyId && String(lead.property || '') !== String(propertyId)) {
        lead.property = propertyId;
      }
      await lead.save();
    }

    return { project: existingProject, created: false };
  }

  const project = await Investment.create({
    user: userId,
    property: propertyId || lead.property || null,
    sourceLead: lead._id,
    sourceLeadSnapshot: buildProjectLeadSnapshot(lead),
    address: lead.address,
    strategy,
    type,
    status,
    purchasePrice: numberOrNull(lead.targetOffer) ?? numberOrNull(lead.sellerAskingPrice) ?? 0,
    arv: numberOrNull(lead.arv) ?? 0,
    propertyType: lead.propertyType || '',
    lotSize: numberOrNull(lead.lotSize) ?? undefined,
    sqft: numberOrNull(lead.squareFootage) ?? undefined,
    bedrooms: numberOrNull(lead.bedrooms) ?? undefined,
    bathrooms: numberOrNull(lead.bathrooms) ?? undefined,
    yearBuilt: numberOrNull(lead.yearBuilt) ?? undefined,
    unitCount: numberOrNull(lead.unitCount) ?? undefined,
  });

  const budgetItems = buildBudgetItemsFromLead(lead, project._id, userId);
  if (budgetItems.length > 0) {
    await BudgetItem.insertMany(budgetItems);
  }

  if (linkLead) {
    lead.projectManagement = project._id;
    if (propertyId && String(lead.property || '') !== String(propertyId)) {
      lead.property = propertyId;
    }
    await lead.save();
  }

  const populatedProject = await Investment.findById(project._id)
    .populate('property')
    .populate('sourceLead', 'address status projectManagement');

  return { project: populatedProject, created: true };
};

module.exports = {
  buildBudgetItemsFromLead,
  buildProjectLeadSnapshot,
  createExecutionProjectFromLead,
  findExistingProjectForLead,
};
