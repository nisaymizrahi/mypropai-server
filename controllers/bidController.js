const Bid = require('../models/Bid');
const Lead = require('../models/Lead');
const OpenAI = require('openai');
const axios = require('axios');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// @desc    Upload an estimate, parse it with AI, and create a new bid
exports.importBid = async (req, res) => {
    try {
        const { leadId } = req.body;
        if (!req.file) {
            return res.status(400).json({ msg: 'Estimate file is required.' });
        }

        const lead = await Lead.findById(leadId);
        if (!lead || lead.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'Lead not found or user not authorized.' });
        }
        
        const ocrData = new URLSearchParams({
            url: req.file.path,
            isOverlayRequired: 'false',
            language: 'eng',
            filetype: req.file.originalname.split('.').pop()
        });

        const ocrResponse = await axios.post('https://api.ocr.space/parse/image', ocrData, {
            headers: {
                'apikey': process.env.OCR_SPACE_API_KEY,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
        });

        if (ocrResponse.data.IsErroredOnProcessing) {
            const errorMessage = ocrResponse.data.ErrorMessage.join(', ');
            if (errorMessage.includes("maximum page limit")) {
                 return res.status(400).json({ msg: 'Import failed: The free plan only supports documents up to 3 pages.' });
            }
            throw new Error(errorMessage);
        }
        
        const extractedText = ocrResponse.data.ParsedResults[0].ParsedText;
        if (!extractedText || extractedText.trim() === '') {
            throw new Error('OCR could not extract any text from the document. The file may be too messy for the AI to read.');
        }
        
        const systemPrompt = `You are an expert data extraction bot for real estate estimates. Analyze the following text extracted from a contractor's bid. Your task is to identify the contractor's name, the total bid amount, and all individual line items with their descriptions and costs. Structure your response as a valid JSON object with the following keys: "contractorName", "totalAmount", and "items". The "items" key should be an array of objects, where each object has a "description" and a "cost" key. If you cannot find a value for a field, set it to an empty string or 0. Ensure every item in the "items" array has both a description and a cost.`;
        const userPrompt = `Here is the raw text from the estimate:\n\n${extractedText}`;

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
            response_format: { type: "json_object" },
        });

        const structuredData = JSON.parse(completion.choices[0].message.content);

        // ✅ NEW: Validate and filter the items returned by the AI
        const validItems = structuredData.items.filter(item => item.description && typeof item.cost === 'number');

        const newBid = new Bid({
            user: req.user.id,
            lead: leadId,
            contractorName: structuredData.contractorName,
            totalAmount: structuredData.totalAmount,
            items: validItems, // Save only the valid items
        });

        await newBid.save();
        res.status(201).json(newBid);

    } catch (error) {
        console.error('Error importing bid:', error);
        res.status(500).json({ msg: 'Server Error during bid import.' });
    }
};

// @desc    Get all bids for a specific lead
exports.getBidsForLead = async (req, res) => {
    try {
        const { leadId } = req.params;
        const lead = await Lead.findById(leadId);
        if (!lead || lead.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'Lead not found or user not authorized.' });
        }
        const bids = await Bid.find({ lead: leadId }).sort({ createdAt: -1 });
        res.json(bids);
    } catch (error) {
        console.error('Error fetching bids:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// ✅ NEW: Function to update an existing bid
exports.updateBid = async (req, res) => {
    try {
        const { contractorName, totalAmount, items } = req.body;
        const bid = await Bid.findById(req.params.id);

        if (!bid || bid.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'Bid not found or user not authorized.' });
        }

        bid.contractorName = contractorName || bid.contractorName;
        bid.totalAmount = totalAmount || bid.totalAmount;
        bid.items = items || bid.items;

        await bid.save();
        res.json(bid);
    } catch (error) {
        console.error('Error updating bid:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Delete a bid
exports.deleteBid = async (req, res) => {
    try {
        const bid = await Bid.findById(req.params.id);
        if (!bid || bid.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'Bid not found or user not authorized.' });
        }
        await bid.deleteOne();
        res.json({ msg: 'Bid deleted.' });
    } catch (error) {
        console.error('Error deleting bid:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};