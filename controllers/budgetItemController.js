const BudgetItem = require('../models/BudgetItem');
const Expense = require('../models/Expense');
const Investment = require('../models/Investment');

// @desc    Create a new budget item for an investment
exports.createBudgetItem = async (req, res) => {
    try {
        const { investmentId, category, description, budgetedAmount, status, dueDate } = req.body;

        // Verify the parent investment exists and belongs to the user
        const investment = await Investment.findById(investmentId);
        if (!investment || investment.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'Not authorized to add budget to this investment.' });
        }

        const newBudgetItem = new BudgetItem({
            investment: investmentId,
            user: req.user.id,
            category,
            description,
            budgetedAmount,
            status,
            dueDate
        });

        await newBudgetItem.save();
        res.status(201).json(newBudgetItem);

    } catch (error) {
        console.error('Error creating budget item:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Get all budget items for a specific investment
exports.getBudgetItemsForInvestment = async (req, res) => {
    try {
        const { investmentId } = req.params;

        // Verify the parent investment exists and belongs to the user
        const investment = await Investment.findById(investmentId);
        if (!investment || investment.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'Not authorized to view this investment.' });
        }
        
        const budgetItems = await BudgetItem.find({ investment: investmentId }).sort({ createdAt: 1 });
        res.json(budgetItems);

    } catch (error) {
        console.error('Error fetching budget items:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Update a specific budget item
exports.updateBudgetItem = async (req, res) => {
    try {
        const budgetItem = await BudgetItem.findById(req.params.id);

        if (!budgetItem) {
            return res.status(404).json({ msg: 'Budget item not found.' });
        }

        // Check ownership
        if (budgetItem.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'User not authorized.' });
        }

        // Update fields from request body
        const { category, description, budgetedAmount, status, dueDate } = req.body;
        if(category) budgetItem.category = category;
        if(description) budgetItem.description = description;
        if(budgetedAmount) budgetItem.budgetedAmount = budgetedAmount;
        if(status) budgetItem.status = status;
        if(dueDate) budgetItem.dueDate = dueDate;

        await budgetItem.save();
        res.json(budgetItem);
        
    } catch (error) {
        console.error('Error updating budget item:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Delete a specific budget item
exports.deleteBudgetItem = async (req, res) => {
    try {
        const budgetItem = await BudgetItem.findById(req.params.id);

        if (!budgetItem) {
            return res.status(404).json({ msg: 'Budget item not found.' });
        }

        // Check ownership
        if (budgetItem.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'User not authorized.' });
        }
        
        // IMPORTANT: Before deleting a budget item, we must also delete all expenses linked to it.
        await Expense.deleteMany({ budgetItem: req.params.id });

        await budgetItem.deleteOne(); // Replaced remove() which is deprecated

        res.json({ msg: 'Budget item and all associated expenses removed.' });

    } catch (error) {
        console.error('Error deleting budget item:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};