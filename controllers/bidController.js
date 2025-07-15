const Bid = require('../models/Bid');
const Lead = require('../models/Lead');
const OpenAI = require('openai');
const axios = require('axios');
const FormData = require('form-data');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

        // --- Step 1: Call OCR.space API with the file buffer ---
        const form = new FormData();
        // ✅ THIS IS THE FIX: Send the file content directly from memory
        form.append('file', req.file.buffer, { filename: req.file.originalname });
        form.append('isOverlayRequired', 'false');
        form.append('language', 'eng');

        const ocrResponse = await axios.post('https://api.ocr.space/parse/image', form, {
            headers: {
                'apikey': process.env.OCR_SPACE_API_KEY,
                ...form.getHeaders(),
            },
        });
        
        if (ocrResponse.data.IsErroredOnProcessing) {
            throw new Error(ocrResponse.data.ErrorMessage.join(', '));
        }
        
        const extractedText = ocrResponse.data.ParsedResults[0].ParsedText;
        if (!extractedText || extractedText.trim() === '') {
            throw new Error('OCR could not extract any text from the document.');
        }
        
        // --- Step 2: Send extracted text to OpenAI for structuring ---
        const systemPrompt = `You are an expert data extraction bot for real estate estimates. Analyze the following text extracted from a contractor's bid. Your task is to identify the contractor's name, the total bid amount, and all individual line items with their descriptions and costs. Structure your response as a valid JSON object with the following keys: "contractorName", "totalAmount", and "items". The "items" key should be an array of objects, where each object has a "description" and a "cost" key. If you cannot find a value for a field, set it to an empty string or 0.`;
        const userPrompt = `Here is the raw text from the estimate:\n\n${extractedText}`;

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
            response_format: { type: "json_object" },
        });

        const structuredData = JSON.parse(completion.choices[0].message.content);

        // --- Step 3: Save the structured bid to the database ---
        const newBid = new Bid({
            user: req.user.id,
            lead: leadId,
            contractorName: structuredData.contractorName,
            totalAmount: structuredData.totalAmount,
            items: structuredData.items,
        });

        await newBid.save();
        res.status(201).json(newBid);

    } catch (error) {
        console.error('Error importing bid:', error);
        res.status(500).json({ msg: 'Server Error during bid import.' });
    }
};

// --- Other functions (getBidsForLead, deleteBid) remain the same ---
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