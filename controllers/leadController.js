const Lead = require('../models/Lead');
const Investment = require('../models/Investment');
const OpenAI = require('openai');
const axios = require('axios');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ✅ NEW: Function to get summary data for the leads dashboard
exports.getLeadSummary = async (req, res) => {
    try {
        const leads = await Lead.find({ user: req.user.id });

        const totalLeads = leads.length;
        const analyzingCount = leads.filter(l => l.status === 'Analyzing').length;
        const underContractCount = leads.filter(l => l.status === 'Under Contract').length;
        
        const closedWon = leads.filter(l => l.status === 'Closed - Won').length;
        const closedLost = leads.filter(l => l.status === 'Closed - Lost').length;
        const totalClosed = closedWon + closedLost;
        
        const closingRatio = totalClosed > 0 ? (closedWon / totalClosed) * 100 : 0;

        res.json({
            totalLeads,
            analyzingCount,
            underContractCount,
            closingRatio
        });

    } catch (error) {
        console.error('Error fetching lead summary:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Create a new lead
exports.createLead = async (req, res) => {
    try {
        const { address, notes } = req.body;
        if (!address) {
            return res.status(400).json({ msg: 'Address is required.' });
        }
        const newLead = new Lead({
            user: req.user.id,
            address,
            notes,
            status: 'Potential'
        });
        await newLead.save();
        res.status(201).json(newLead);
    } catch (error) {
        console.error('Error creating lead:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Get all of a user's leads
exports.getLeads = async (req, res) => {
    try {
        const leads = await Lead.find({ user: req.user.id }).sort({ createdAt: -1 });
        res.json(leads);
    } catch (error) {
        console.error('Error fetching leads:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Get a single lead by its ID
exports.getLeadById = async (req, res) => {
    try {
        const lead = await Lead.findById(req.params.id);
        if (!lead || lead.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'Lead not found or user not authorized.' });
        }
        res.json(lead);
    } catch (error) {
        console.error('Error fetching lead by ID:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Update a lead (status, notes)
exports.updateLead = async (req, res) => {
    try {
        const { status, notes } = req.body;
        const lead = await Lead.findById(req.params.id);
        if (!lead || lead.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'Lead not found or user not authorized.' });
        }
        if(status) lead.status = status;
        if(notes) lead.notes = notes;
        await lead.save();
        res.json(lead);
    } catch (error) {
        console.error('Error updating lead:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Delete a lead
exports.deleteLead = async (req, res) => {
    try {
        const lead = await Lead.findById(req.params.id);
        if (!lead || lead.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'Lead not found or user not authorized.' });
        }
        await lead.deleteOne();
        res.json({ msg: 'Lead deleted.' });
    } catch (error) {
        console.error('Error deleting lead:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Run the AI comps analysis for a specific lead
exports.analyzeComps = async (req, res) => {
    try {
        const { id } = req.params;
        const { radius, saleDateMonths } = req.body;

        const lead = await Lead.findById(id);
        if (!lead || lead.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'Lead not found or user not authorized.' });
        }

        const attomApiUrl = `https://api.attomdata.com/property/address`; // This URL might need adjustment
        const response = await axios.get(attomApiUrl, {
            params: {
                address: lead.address,
                radius: radius || 0.5,
                // Add other params like saleDate, etc. based on ATTOM docs
            },
            headers: {
                'apikey': process.env.ATTOM_API_KEY,
            }
        });

        const comps = response.data.property;
        if (!comps || comps.length === 0) {
            return res.status(404).json({ msg: 'No comparable properties found from data provider.' });
        }

        const systemPrompt = `You are a professional real estate analyst. Your task is to analyze a list of comparable properties (comps) and generate a summary. Select the top 3-5 most relevant comps, provide a table of their key details, and write a narrative summary estimating the value of the subject property based on the data.`;
        
        const compsString = comps.map(c => `Address: ${c.address}, Sold Price: $${c.sale.amount}, Sold Date: ${c.sale.saleDate}, SqFt: ${c.building.size}`).join('\n');
        const userPrompt = `Subject Property: ${lead.address}\n\nHere are the raw comps:\n${compsString}`;

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
        });

        const analysisReport = completion.choices[0].message.content;

        res.status(200).json({ report: analysisReport });

    } catch (error) {
        console.error('Error analyzing comps:', error);
        res.status(500).json({ msg: 'Server error during comps analysis.' });
    }
};
