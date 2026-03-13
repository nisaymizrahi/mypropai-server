const Bid = require('../models/Bid');
const Lead = require('../models/Lead');
const OpenAI = require('openai');
const axios = require('axios');

const getOpenAIClient = () => {
    if (!process.env.OPENAI_API_KEY) {
        return null;
    }

    return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
};

const normalizeCurrencyValue = (value) => {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    const normalized = String(value).replace(/[^0-9.-]/g, '');
    if (!normalized) {
        return null;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
};

const clampConfidence = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return null;
    }

    return Math.max(0, Math.min(1, parsed));
};

const sanitizeBidItems = (input = []) => {
    if (!Array.isArray(input)) {
        return [];
    }

    return input
        .map((item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                return null;
            }

            const description = typeof item.description === 'string' ? item.description.trim() : '';
            const cost = normalizeCurrencyValue(item.cost);

            if (!description || cost === null) {
                return null;
            }

            return {
                description,
                category:
                    typeof item.category === 'string' && item.category.trim()
                        ? item.category.trim()
                        : 'Uncategorized',
                cost,
            };
        })
        .filter(Boolean);
};

const buildRenovationItemContext = (lead) => {
    const items = Array.isArray(lead?.renovationPlan?.items) ? lead.renovationPlan.items : [];

    return items
        .map((item) => {
            if (!item?.itemId) {
                return null;
            }

            return {
                renovationItemId: String(item.itemId),
                renovationItemName: String(item.name || '').trim(),
                category: String(item.category || '').trim(),
                budget: normalizeCurrencyValue(item.budget),
                scopeDescription: String(item.scopeDescription || '').trim(),
            };
        })
        .filter(Boolean);
};

const normalizeKeyword = (value = '') =>
    String(value)
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/[\s-]+/)
        .filter(Boolean);

const sanitizeBidAssignments = (input = [], renovationItems = []) => {
    if (!Array.isArray(input)) {
        return [];
    }

    const renovationById = new Map(
        renovationItems.map((item) => [String(item.renovationItemId), item])
    );
    const renovationByName = new Map(
        renovationItems.map((item) => [String(item.renovationItemName || '').trim().toLowerCase(), item])
    );

    return input
        .map((assignment) => {
            if (!assignment || typeof assignment !== 'object' || Array.isArray(assignment)) {
                return null;
            }

            const requestedId = String(assignment.renovationItemId || '').trim();
            const requestedName = String(
                assignment.renovationItemName || assignment.itemName || assignment.name || ''
            ).trim();

            let matchedRenovationItem =
                renovationById.get(requestedId) ||
                renovationByName.get(requestedName.toLowerCase()) ||
                null;

            if (!matchedRenovationItem && renovationItems.length === 1) {
                matchedRenovationItem = renovationItems[0];
            }

            if (!matchedRenovationItem) {
                return null;
            }

            const amount = normalizeCurrencyValue(assignment.amount);
            const matchedLineItems = Array.isArray(assignment.matchedLineItems)
                ? assignment.matchedLineItems
                    .map((item) => String(item || '').trim())
                    .filter(Boolean)
                : [];

            return {
                renovationItemId: String(matchedRenovationItem.renovationItemId),
                renovationItemName:
                    String(matchedRenovationItem.renovationItemName || requestedName).trim() ||
                    'Renovation item',
                amount,
                scopeSummary:
                    typeof assignment.scopeSummary === 'string' ? assignment.scopeSummary.trim() : '',
                confidence: clampConfidence(assignment.confidence),
                matchedLineItems,
            };
        })
        .filter((assignment) => assignment && assignment.amount !== null);
};

const deriveAssignmentsFromItems = (bidItems = [], renovationItems = []) => {
    if (!bidItems.length || !renovationItems.length) {
        return [];
    }

    const assignmentMap = new Map();

    bidItems.forEach((item) => {
        const haystack = normalizeKeyword(`${item.description} ${item.category}`).join(' ');

        let bestMatch = null;
        let bestScore = 0;

        renovationItems.forEach((renovationItem) => {
            const keywords = [
                ...normalizeKeyword(renovationItem.renovationItemName),
                ...normalizeKeyword(renovationItem.category),
            ];
            const uniqueKeywords = [...new Set(keywords)];
            if (!uniqueKeywords.length) {
                return;
            }

            const score = uniqueKeywords.reduce(
                (total, keyword) => total + (haystack.includes(keyword) ? 1 : 0),
                0
            );

            if (score > bestScore) {
                bestScore = score;
                bestMatch = renovationItem;
            }
        });

        if (!bestMatch || bestScore === 0) {
            return;
        }

        const existing = assignmentMap.get(bestMatch.renovationItemId) || {
            renovationItemId: bestMatch.renovationItemId,
            renovationItemName: bestMatch.renovationItemName,
            amount: 0,
            scopeSummary: '',
            confidence: 0.55,
            matchedLineItems: [],
        };

        existing.amount += item.cost;
        existing.matchedLineItems.push(item.description);
        existing.scopeSummary = existing.scopeSummary || item.description;
        assignmentMap.set(bestMatch.renovationItemId, existing);
    });

    return [...assignmentMap.values()];
};

// @desc    Upload an estimate, parse it with AI, and create a new bid
exports.importBid = async (req, res) => {
    try {
        const openai = getOpenAIClient();
        if (!openai) {
            return res.status(503).json({ msg: 'OpenAI is not configured on the server.' });
        }

        const { leadId } = req.body;
        if (!req.file) {
            return res.status(400).json({ msg: 'Estimate file is required.' });
        }

        const lead = await Lead.findById(leadId);
        if (!lead || lead.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'Lead not found or user not authorized.' });
        }

        const renovationItems = buildRenovationItemContext(lead);
        
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
        
        const systemPrompt = `You are an expert data extraction bot for real estate contractor estimates. Analyze the OCR text from a contractor bid and extract structured data. Return a valid JSON object with these keys:
"contractorName": string
"totalAmount": number
"items": array of objects with "description", "cost", and optional "category"
"renovationAssignments": array of objects with "renovationItemId", "renovationItemName", "amount", optional "scopeSummary", optional "matchedLineItems", and optional "confidence"

If a quote clearly covers one or more renovation items provided by the user, map the relevant amount to those renovation items. Only assign an amount when the document gives you enough evidence to do so. If the quote is only a whole-project quote and you cannot confidently split it by renovation item, return an empty renovationAssignments array.`;
        const userPrompt = `Renovation items for this lead:\n${JSON.stringify(renovationItems, null, 2)}\n\nHere is the raw text from the estimate:\n\n${extractedText}`;

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
            response_format: { type: "json_object" },
        });

        const structuredData = JSON.parse(completion.choices[0].message.content);
        const validItems = sanitizeBidItems(structuredData.items);
        const validAssignments = sanitizeBidAssignments(
            structuredData.renovationAssignments,
            renovationItems
        );
        const fallbackAssignments =
            validAssignments.length > 0
                ? validAssignments
                : deriveAssignmentsFromItems(validItems, renovationItems);
        const totalAmount =
            normalizeCurrencyValue(structuredData.totalAmount) ??
            validItems.reduce((sum, item) => sum + item.cost, 0);

        const newBid = new Bid({
            user: req.user.id,
            lead: leadId,
            contractorName: structuredData.contractorName,
            totalAmount,
            sourceFileName: req.file.originalname,
            sourceDocumentUrl: req.file.path,
            items: validItems,
            renovationAssignments: fallbackAssignments,
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
        const { contractorName, totalAmount, items, renovationAssignments } = req.body;
        const bid = await Bid.findById(req.params.id);

        if (!bid || bid.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'Bid not found or user not authorized.' });
        }

        const lead = await Lead.findById(bid.lead);
        const renovationItems = buildRenovationItemContext(lead);

        bid.contractorName = contractorName || bid.contractorName;
        bid.totalAmount = normalizeCurrencyValue(totalAmount) ?? bid.totalAmount;
        bid.items = Array.isArray(items) ? sanitizeBidItems(items) : bid.items;
        bid.renovationAssignments = Array.isArray(renovationAssignments)
            ? sanitizeBidAssignments(renovationAssignments, renovationItems)
            : bid.renovationAssignments;

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
