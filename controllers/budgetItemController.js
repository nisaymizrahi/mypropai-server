const BudgetItem = require('../models/BudgetItem');
const Expense = require('../models/Expense');
const Investment = require('../models/Investment');

const isPresent = (value) => value !== undefined && value !== null && value !== '';

const toOptionalNumber = (value) => {
  if (!isPresent(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toOptionalString = (value) => {
  if (!isPresent(value)) return '';
  return String(value).trim();
};

const populateBudgetItem = (query) =>
  query
    .populate('awards.vendor', 'name trade specialties contactInfo')
    .populate('awards.sourceBid', 'contractorName totalAmount decisionStatus sourceType vendor vendorSnapshot');

const getAuthorizedInvestment = async (investmentId, userId) => {
  const investment = await Investment.findById(investmentId);
  if (!investment || String(investment.user) !== String(userId)) {
    return null;
  }

  return investment;
};

const getAuthorizedBudgetItem = async (budgetItemId, userId) => {
  const budgetItem = await BudgetItem.findById(budgetItemId);

  if (!budgetItem) {
    return { error: { status: 404, msg: 'Budget item not found.' } };
  }

  if (String(budgetItem.user) !== String(userId)) {
    return { error: { status: 401, msg: 'User not authorized.' } };
  }

  return { budgetItem };
};

const buildAwardPayload = (input = {}) => {
  const amount = toOptionalNumber(input.amount);

  return {
    vendor: toOptionalString(input.vendor) || null,
    vendorName: toOptionalString(input.vendorName),
    description: toOptionalString(input.description),
    amount: amount ?? 0,
    notes: toOptionalString(input.notes),
    sourceBid: toOptionalString(input.sourceBid) || null,
  };
};

// @desc    Create a new budget item for an investment
exports.createBudgetItem = async (req, res) => {
  try {
    const {
      investmentId,
      category,
      description,
      budgetedAmount,
      originalBudgetAmount,
      status,
      dueDate,
      sourceRenovationItemId,
      scopeKey,
    } = req.body;

    const investment = await getAuthorizedInvestment(investmentId, req.user.id);
    if (!investment) {
      return res.status(401).json({ msg: 'Not authorized to add budget to this project.' });
    }

    const nextBudgetAmount = toOptionalNumber(budgetedAmount);
    if (!toOptionalString(category) || nextBudgetAmount === null) {
      return res.status(400).json({ msg: 'Category and budget are required.' });
    }

    const newBudgetItem = new BudgetItem({
      investment: investmentId,
      user: req.user.id,
      category: toOptionalString(category),
      description: toOptionalString(description),
      budgetedAmount: nextBudgetAmount,
      originalBudgetAmount: toOptionalNumber(originalBudgetAmount) ?? nextBudgetAmount,
      status: toOptionalString(status) || 'Not Started',
      dueDate: dueDate || undefined,
      sourceRenovationItemId: toOptionalString(sourceRenovationItemId),
      scopeKey: toOptionalString(scopeKey),
      awards: [],
    });

    await newBudgetItem.save();
    const populatedBudgetItem = await populateBudgetItem(BudgetItem.findById(newBudgetItem._id));
    res.status(201).json(populatedBudgetItem);
  } catch (error) {
    console.error('Error creating budget item:', error);
    res.status(500).json({ msg: 'Server Error' });
  }
};

// @desc    Get all budget items for a specific investment
exports.getBudgetItemsForInvestment = async (req, res) => {
  try {
    const { investmentId } = req.params;

    const investment = await getAuthorizedInvestment(investmentId, req.user.id);
    if (!investment) {
      return res.status(401).json({ msg: 'Not authorized to view this project.' });
    }

    const budgetItems = await populateBudgetItem(
      BudgetItem.find({ investment: investmentId }).sort({ createdAt: 1 })
    );
    res.json(budgetItems);
  } catch (error) {
    console.error('Error fetching budget items:', error);
    res.status(500).json({ msg: 'Server Error' });
  }
};

// @desc    Update a specific budget item
exports.updateBudgetItem = async (req, res) => {
  try {
    const { budgetItem, error } = await getAuthorizedBudgetItem(req.params.id, req.user.id);
    if (error) {
      return res.status(error.status).json({ msg: error.msg });
    }

    const {
      category,
      description,
      budgetedAmount,
      originalBudgetAmount,
      status,
      dueDate,
      sourceRenovationItemId,
      scopeKey,
    } = req.body;

    if (category !== undefined) budgetItem.category = toOptionalString(category);
    if (description !== undefined) budgetItem.description = toOptionalString(description);

    const nextBudgetAmount = toOptionalNumber(budgetedAmount);
    if (budgetedAmount !== undefined && nextBudgetAmount !== null) {
      budgetItem.budgetedAmount = nextBudgetAmount;
    }

    const nextOriginalBudget = toOptionalNumber(originalBudgetAmount);
    if (originalBudgetAmount !== undefined && nextOriginalBudget !== null) {
      budgetItem.originalBudgetAmount = nextOriginalBudget;
    }

    if (status !== undefined) budgetItem.status = toOptionalString(status) || budgetItem.status;
    if (dueDate !== undefined) budgetItem.dueDate = dueDate || undefined;
    if (sourceRenovationItemId !== undefined) {
      budgetItem.sourceRenovationItemId = toOptionalString(sourceRenovationItemId);
    }
    if (scopeKey !== undefined) {
      budgetItem.scopeKey = toOptionalString(scopeKey);
    }

    await budgetItem.save();
    const populatedBudgetItem = await populateBudgetItem(BudgetItem.findById(budgetItem._id));
    res.json(populatedBudgetItem);
  } catch (error) {
    console.error('Error updating budget item:', error);
    res.status(500).json({ msg: 'Server Error' });
  }
};

// @desc    Delete a specific budget item
exports.deleteBudgetItem = async (req, res) => {
  try {
    const { budgetItem, error } = await getAuthorizedBudgetItem(req.params.id, req.user.id);
    if (error) {
      return res.status(error.status).json({ msg: error.msg });
    }

    await Expense.deleteMany({ budgetItem: req.params.id });
    await budgetItem.deleteOne();

    res.json({ msg: 'Budget item and all associated expenses removed.' });
  } catch (error) {
    console.error('Error deleting budget item:', error);
    res.status(500).json({ msg: 'Server Error' });
  }
};

// @desc    Add a vendor award / commitment to a budget item
exports.addBudgetAward = async (req, res) => {
  try {
    const { budgetItem, error } = await getAuthorizedBudgetItem(req.params.id, req.user.id);
    if (error) {
      return res.status(error.status).json({ msg: error.msg });
    }

    const award = buildAwardPayload(req.body);
    if (!award.vendor && !award.vendorName) {
      return res.status(400).json({ msg: 'Choose a vendor or enter a payee name.' });
    }

    if (!Number.isFinite(award.amount) || award.amount <= 0) {
      return res.status(400).json({ msg: 'Award amount must be greater than zero.' });
    }

    budgetItem.awards.push(award);
    await budgetItem.save();

    const populatedBudgetItem = await populateBudgetItem(BudgetItem.findById(budgetItem._id));
    res.status(201).json(populatedBudgetItem);
  } catch (error) {
    console.error('Error adding budget award:', error);
    res.status(500).json({ msg: 'Server Error' });
  }
};

// @desc    Update a vendor award / commitment on a budget item
exports.updateBudgetAward = async (req, res) => {
  try {
    const { budgetItem, error } = await getAuthorizedBudgetItem(req.params.id, req.user.id);
    if (error) {
      return res.status(error.status).json({ msg: error.msg });
    }

    const award = budgetItem.awards.find(
      (entry) => String(entry.awardId) === String(req.params.awardId)
    );
    if (!award) {
      return res.status(404).json({ msg: 'Award not found.' });
    }

    const nextAward = buildAwardPayload({ ...award.toObject?.(), ...req.body });
    if (!nextAward.vendor && !nextAward.vendorName) {
      return res.status(400).json({ msg: 'Choose a vendor or enter a payee name.' });
    }

    if (!Number.isFinite(nextAward.amount) || nextAward.amount <= 0) {
      return res.status(400).json({ msg: 'Award amount must be greater than zero.' });
    }

    award.vendor = nextAward.vendor;
    award.vendorName = nextAward.vendorName;
    award.description = nextAward.description;
    award.amount = nextAward.amount;
    award.notes = nextAward.notes;
    award.sourceBid = nextAward.sourceBid;

    await budgetItem.save();
    const populatedBudgetItem = await populateBudgetItem(BudgetItem.findById(budgetItem._id));
    res.json(populatedBudgetItem);
  } catch (error) {
    console.error('Error updating budget award:', error);
    res.status(500).json({ msg: 'Server Error' });
  }
};

// @desc    Delete a vendor award / commitment from a budget item
exports.deleteBudgetAward = async (req, res) => {
  try {
    const { budgetItem, error } = await getAuthorizedBudgetItem(req.params.id, req.user.id);
    if (error) {
      return res.status(error.status).json({ msg: error.msg });
    }

    const nextAwards = budgetItem.awards.filter(
      (entry) => String(entry.awardId) !== String(req.params.awardId)
    );

    if (nextAwards.length === budgetItem.awards.length) {
      return res.status(404).json({ msg: 'Award not found.' });
    }

    budgetItem.awards = nextAwards;
    await budgetItem.save();
    await Expense.updateMany(
      { budgetItem: budgetItem._id, awardId: req.params.awardId },
      { $set: { awardId: '' } }
    );

    const populatedBudgetItem = await populateBudgetItem(BudgetItem.findById(budgetItem._id));
    res.json(populatedBudgetItem);
  } catch (error) {
    console.error('Error deleting budget award:', error);
    res.status(500).json({ msg: 'Server Error' });
  }
};
