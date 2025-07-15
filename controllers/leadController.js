const Lead = require('../models/Lead');
const OpenAI = require('openai');
const axios = require('axios');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// @desc    Get summary data for the leads dashboard
exports.getLeadSummary = async (req, res) => {
    try {
        const leads = await Lead.find({ user: req.user.id });
        const closedWon = leads.filter(l => l.status === 'Closed - Won').length;
        const closedLost = leads.filter(l => l.status === 'Closed - Lost').length;
        const totalClosed = closedWon + closedLost;
        res.json({
            totalLeads: leads.length,
            analyzingCount: leads.filter(l => l.status === 'Analyzing').length,
            underContractCount: leads.filter(l => l.status === 'Under Contract').length,
            closingRatio: totalClosed > 0 ? (closedWon / totalClosed) * 100 : 0
        });
    } catch (error) { res.status(500).json({ msg: 'Server Error' }); }
};

// @desc    Create a new lead
exports.createLead = async (req, res) => {
    try {
        const { address, notes } = req.body;
        if (!address) return res.status(400).json({ msg: 'Address is required.' });
        const newLead = new Lead({ user: req.user.id, address, notes });
        await newLead.save();
        res.status(201).json(newLead);
    } catch (error) { res.status(500).json({ msg: 'Server Error' }); }
};

// @desc    Get all of a user's leads
exports.getLeads = async (req, res) => {
    try {
        const leads = await Lead.find({ user: req.user.id }).sort({ createdAt: -1 });
        res.json(leads);
    } catch (error) { res.status(500).json({ msg: 'Server Error' }); }
};

// @desc    Get a single lead by its ID
exports.getLeadById = async (req, res) => {
    try {
        const lead = await Lead.findById(req.params.id);
        if (!lead || lead.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'Lead not found or user not authorized.' });
        }
        res.json(lead);
    } catch (error) { res.status(500).json({ msg: 'Server Error' }); }
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
    } catch (error) { res.status(500).json({ msg: 'Server Error' }); }
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
    } catch (error) { res.status(500).json({ msg: 'Server Error' }); }
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
        
        // ✅ CORRECTED: Using the proper ATTOM API endpoint
        const attomApiUrl = `https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/snapshot`;
        const response = await axios.get(attomApiUrl, {
            params: { address: lead.address, radius: radius || 0.5 },
            headers: { 'apikey': process.env.ATTOM_API_KEY }
        });
        
        const comps = response.data.property || [];
        if (comps.length === 0) {
            return res.status(404).json({ msg: 'No comparable properties found for this address.' });
        }

        const systemPrompt = `You are a professional real estate analyst. Your task is to analyze a list of comparable properties and generate a summary. Select the top 3-5 most relevant comps, provide a table of their key details, and write a narrative summary estimating the value of the subject property based on the data.`;
        const compsString = comps.map(c => `Address: ${c.address.oneLine}, Sold Price: $${c.sale?.amount}, Sold Date: ${c.sale?.saleDate}, SqFt: ${c.building?.size?.bldgsize}`).join('\n');
        const userPrompt = `Subject Property: ${lead.address}\n\nHere are the raw comps:\n${compsString}`;

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        });

        const analysisReport = completion.choices[0].message.content;
        res.status(200).json({ report: analysisReport });

    } catch (error) {
        console.error('Error analyzing comps:', error.response ? error.response.data : error.message);
        res.status(500).json({ msg: 'Server error during comps analysis.' });
    }
};
