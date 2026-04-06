const ProjectReceipt = require('../models/ProjectReceipt');
const Investment = require('../models/Investment');

const getAuthorizedInvestment = async (investmentId, userId) => {
  const investment = await Investment.findById(investmentId);
  if (!investment || String(investment.user) !== String(userId)) {
    return null;
  }

  return investment;
};

const populateReceipt = (query) =>
  query
    .populate('vendor', 'name trade specialties contactInfo')
    .populate('budgetItem', 'category scopeKey scopeGroup description')
    .populate('expense', 'title amount date status');

exports.getReceiptsForInvestment = async (req, res) => {
  try {
    const { investmentId } = req.params;
    const investment = await getAuthorizedInvestment(investmentId, req.user.id);
    if (!investment) {
      return res.status(401).json({ msg: 'Not authorized to view receipts for this project.' });
    }

    const receipts = await populateReceipt(
      ProjectReceipt.find({ investment: investmentId }).sort({ createdAt: -1 })
    );

    res.json(receipts);
  } catch (error) {
    console.error('Error fetching project receipts:', error);
    res.status(500).json({ msg: 'Server Error' });
  }
};
