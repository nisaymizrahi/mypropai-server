const Expense = require('../models/Expense');
const Investment = require('../models/Investment');
const BudgetItem = require('../models/BudgetItem');
const cloudinary = require('cloudinary').v2;

// @desc    Create a new expense for an investment
exports.createExpense = async (req, res) => {
    try {
        const { investmentId, budgetItemId, description, amount, vendor, date, notes } = req.body;

        // Basic validation
        if (!investmentId || !budgetItemId || !description || !amount) {
            return res.status(400).json({ msg: 'Please provide all required fields for the expense.' });
        }

        // Verify the parent investment exists and belongs to the user
        const investment = await Investment.findById(investmentId);
        if (!investment || investment.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'Not authorized for this investment.' });
        }

        const newExpense = new Expense({
            investment: investmentId,
            budgetItem: budgetItemId,
            user: req.user.id,
            description,
            amount,
            vendor,
            date,
            notes
        });

        // Check for an uploaded receipt file
        if (req.file) {
            newExpense.receiptUrl = req.file.path;
            newExpense.receiptCloudinaryId = req.file.filename;
        }

        await newExpense.save();
        res.status(201).json(newExpense);

    } catch (error) {
        console.error('Error creating expense:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Get all expenses for a specific investment
exports.getExpensesForInvestment = async (req, res) => {
    try {
        const { investmentId } = req.params;

        // Verify the parent investment exists and belongs to the user
        const investment = await Investment.findById(investmentId);
        if (!investment || investment.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'Not authorized to view this investment.' });
        }
        
        // Find all expenses for the investment and populate vendor details
        const expenses = await Expense.find({ investment: investmentId })
            .populate('vendor', 'name trade')
            .sort({ date: -1 });
            
        res.json(expenses);

    } catch (error) {
        console.error('Error fetching expenses:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Update a specific expense
exports.updateExpense = async (req, res) => {
    try {
        const expense = await Expense.findById(req.params.id);

        if (!expense) {
            return res.status(404).json({ msg: 'Expense not found.' });
        }

        // Check ownership
        if (expense.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'User not authorized.' });
        }

        // Update fields from request body
        const { description, amount, vendor, date, notes } = req.body;
        if(description) expense.description = description;
        if(amount) expense.amount = amount;
        if(vendor) expense.vendor = vendor;
        if(date) expense.date = date;
        if(notes) expense.notes = notes;

        await expense.save();
        res.json(expense);
        
    } catch (error) {
        console.error('Error updating expense:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Delete a specific expense
exports.deleteExpense = async (req, res) => {
    try {
        const expense = await Expense.findById(req.params.id);

        if (!expense) {
            return res.status(404).json({ msg: 'Expense not found.' });
        }

        // Check ownership
        if (expense.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'User not authorized.' });
        }
        
        // If there's a receipt in Cloudinary, delete it first
        if (expense.receiptCloudinaryId) {
            await cloudinary.uploader.destroy(expense.receiptCloudinaryId);
        }

        await expense.deleteOne();

        res.json({ msg: 'Expense removed.' });

    } catch (error) {
        console.error('Error deleting expense:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};