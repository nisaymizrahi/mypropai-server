const OperatingExpense = require('../models/OperatingExpense');
const ManagedProperty = require('../models/ManagedProperty');
const cloudinary = require('cloudinary').v2;

// @desc    Create a new operating expense for a managed property
exports.createOperatingExpense = async (req, res) => {
    try {
        const { propertyId, description, category, amount, date } = req.body;

        if (!propertyId || !description || !category || !amount || !date) {
            return res.status(400).json({ msg: 'Please provide all required fields.' });
        }

        const property = await ManagedProperty.findById(propertyId);
        if (!property || property.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'User not authorized for this property.' });
        }

        const newExpense = new OperatingExpense({
            user: req.user.id,
            property: propertyId,
            description,
            category,
            amount,
            date,
        });

        if (req.file) {
            newExpense.receiptUrl = req.file.path;
            newExpense.receiptCloudinaryId = req.file.filename;
        }

        await newExpense.save();
        res.status(201).json(newExpense);

    } catch (error) {
        console.error('Error creating operating expense:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Get all operating expenses for a specific property
exports.getOperatingExpensesForProperty = async (req, res) => {
    try {
        const { propertyId } = req.params;

        const property = await ManagedProperty.findById(propertyId);
        if (!property || property.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'User not authorized for this property.' });
        }

        const expenses = await OperatingExpense.find({ property: propertyId }).sort({ date: -1 });
        res.json(expenses);

    } catch (error) {
        console.error('Error fetching operating expenses:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Update an operating expense
exports.updateOperatingExpense = async (req, res) => {
    try {
        const { description, category, amount, date } = req.body;
        const expense = await OperatingExpense.findById(req.params.expenseId);

        if (!expense) {
            return res.status(404).json({ msg: 'Expense not found.' });
        }
        if (expense.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'User not authorized.' });
        }

        if(description) expense.description = description;
        if(category) expense.category = category;
        if(amount) expense.amount = amount;
        if(date) expense.date = date;

        await expense.save();
        res.json(expense);

    } catch (error) {
        console.error('Error updating operating expense:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Delete an operating expense
exports.deleteOperatingExpense = async (req, res) => {
    try {
        const expense = await OperatingExpense.findById(req.params.expenseId);

        if (!expense) {
            return res.status(404).json({ msg: 'Expense not found.' });
        }
        if (expense.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'User not authorized.' });
        }

        if (expense.receiptCloudinaryId) {
            await cloudinary.uploader.destroy(expense.receiptCloudinaryId);
        }

        await expense.deleteOne();
        res.json({ msg: 'Operating expense removed.' });

    } catch (error) {
        console.error('Error deleting operating expense:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};