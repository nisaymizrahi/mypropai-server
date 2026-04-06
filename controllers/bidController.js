const Bid = require('../models/Bid');
const Lead = require('../models/Lead');
const Investment = require('../models/Investment');
const BudgetItem = require('../models/BudgetItem');
const Vendor = require('../models/Vendor');
const OpenAI = require('openai');
const axios = require('axios');
const { buildBudgetScopeMeta } = require('../utils/projectScopes');

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

const normalizeOptionalString = (value) => {
    if (value === null || value === undefined) {
        return '';
    }

    return String(value).trim();
};

const normalizePhoneKey = (value) =>
    String(value || '')
        .replace(/[^0-9]/g, '')
        .trim();

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
                budgetItemId: null,
                budgetItemLabel: '',
                category: String(item.category || '').trim(),
                budget: normalizeCurrencyValue(item.budget),
                scopeDescription: String(item.scopeDescription || '').trim(),
            };
        })
        .filter(Boolean);
};

const buildBudgetItemScopeContext = async (investmentId) => {
    const budgetItems = await BudgetItem.find({ investment: investmentId }).select(
        '_id category description budgetedAmount sourceRenovationItemId scopeKey scopeGroup'
    );

    return budgetItems
        .map((item) => {
            const scopeMeta = buildBudgetScopeMeta({
                scopeKey: item.scopeKey,
                category: item.category,
                description: item.description,
            });

            return {
                renovationItemId: String(item._id),
                renovationItemName: String(item.category || scopeMeta.defaultCategory || '').trim(),
                budgetItemId: item._id,
                budgetItemLabel: String(item.category || scopeMeta.defaultCategory || '').trim(),
                sourceRenovationItemId: String(item.sourceRenovationItemId || '').trim(),
                category: String(scopeMeta.scopeKey || '').trim(),
                budget: normalizeCurrencyValue(item.budgetedAmount),
                scopeDescription: String(item.description || '').trim(),
            };
        })
        .filter((item) => item.renovationItemId && item.renovationItemName);
};

const buildVendorSnapshot = (input = {}, fallbackName = '') => {
    const snapshot = {
        name: normalizeOptionalString(input.name || fallbackName),
        contactName: normalizeOptionalString(input.contactName),
        email: normalizeOptionalString(input.email).toLowerCase(),
        phone: normalizeOptionalString(input.phone),
        address: normalizeOptionalString(input.address),
    };

    return Object.values(snapshot).some(Boolean) ? snapshot : null;
};

const buildVendorSnapshotFromVendor = (vendor) => {
    if (!vendor) {
        return null;
    }

    return buildVendorSnapshot({
        name: vendor.name,
        contactName: vendor.contactInfo?.contactName,
        email: vendor.contactInfo?.email,
        phone: vendor.contactInfo?.phone,
        address: vendor.contactInfo?.address,
    });
};

const populateBidVendor = async (bid) => bid.populate('vendor', 'name trade specialties contactInfo');

const findMatchingVendor = async (userId, vendorSnapshot = {}, contractorName = '') => {
    const normalizedName = normalizeOptionalString(vendorSnapshot.name || contractorName).toLowerCase();
    const normalizedEmail = normalizeOptionalString(vendorSnapshot.email).toLowerCase();
    const normalizedPhone = normalizePhoneKey(vendorSnapshot.phone);

    if (!normalizedName && !normalizedEmail && !normalizedPhone) {
        return null;
    }

    const vendors = await Vendor.find({ user: userId }).select('name contactInfo trade specialties');

    return (
        vendors.find((vendor) => {
            const vendorName = normalizeOptionalString(vendor.name).toLowerCase();
            const vendorEmail = normalizeOptionalString(vendor.contactInfo?.email).toLowerCase();
            const vendorPhone = normalizePhoneKey(vendor.contactInfo?.phone);

            return (
                (normalizedEmail && vendorEmail && normalizedEmail === vendorEmail) ||
                (normalizedPhone && vendorPhone && normalizedPhone === vendorPhone) ||
                (normalizedName && vendorName && normalizedName === vendorName)
            );
        }) || null
    );
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
    const renovationBySourceId = new Map(
        renovationItems
            .filter((item) => item?.sourceRenovationItemId)
            .map((item) => [String(item.sourceRenovationItemId), item])
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
                renovationBySourceId.get(requestedId) ||
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
                budgetItemId: matchedRenovationItem.budgetItemId || null,
                budgetItemLabel: matchedRenovationItem.budgetItemLabel || '',
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
            budgetItemId: bestMatch.budgetItemId || null,
            budgetItemLabel: bestMatch.budgetItemLabel || '',
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

const getAuthorizedLead = async (leadId, userId) => {
    const lead = await Lead.findById(leadId);
    if (!lead || lead.user.toString() !== userId) {
        return null;
    }

    return lead;
};

const getAuthorizedInvestment = async (investmentId, userId) => {
    if (!investmentId) {
        return null;
    }

    const investment = await Investment.findById(investmentId);
    if (!investment || String(investment.user) !== String(userId)) {
        return null;
    }

    return investment;
};

const getAuthorizedBudgetItem = async (budgetItemId, userId) => {
    if (!budgetItemId) {
        return null;
    }

    const budgetItem = await BudgetItem.findById(budgetItemId);
    if (!budgetItem || String(budgetItem.user) !== String(userId)) {
        return null;
    }

    return budgetItem;
};

const getAuthorizedVendor = async (vendorId, userId) => {
    if (!vendorId) {
        return null;
    }

    const vendor = await Vendor.findById(vendorId);
    if (!vendor || vendor.user.toString() !== userId) {
        return null;
    }

    return vendor;
};

const resolveBidScopeContext = async ({ leadId, investmentId, userId }) => {
    const investment = await getAuthorizedInvestment(investmentId, userId);
    if (investmentId && !investment) {
        return { error: { status: 401, msg: 'Project not found or user not authorized.' } };
    }

    const resolvedLeadId = leadId || investment?.sourceLead || '';
    const lead = resolvedLeadId ? await getAuthorizedLead(resolvedLeadId, userId) : null;

    if (resolvedLeadId && !lead) {
        return { error: { status: 401, msg: 'Lead not found or user not authorized.' } };
    }

    let scopeItems = investment
        ? await buildBudgetItemScopeContext(investment._id)
        : buildRenovationItemContext(lead);

    if ((!scopeItems || scopeItems.length === 0) && lead) {
        scopeItems = buildRenovationItemContext(lead);
    }

    if (!lead) {
        return {
            error: {
                status: 400,
                msg: 'Bids require a project linked to a lead, or a lead with scope items.',
            },
        };
    }

    return {
        lead,
        investment,
        scopeItems,
    };
};

// @desc    Upload an estimate, parse it with AI, and create a new bid
exports.importBid = async (req, res) => {
    try {
        const openai = getOpenAIClient();
        if (!openai) {
            return res.status(503).json({ msg: 'OpenAI is not configured on the server.' });
        }

        const { leadId, investmentId } = req.body;
        if (!req.file) {
            return res.status(400).json({ msg: 'Estimate file is required.' });
        }

        const { lead, investment, scopeItems, error } = await resolveBidScopeContext({
            leadId,
            investmentId,
            userId: req.user.id,
        });
        if (error) {
            return res.status(error.status).json({ msg: error.msg });
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
        
        const systemPrompt = `You are an expert data extraction bot for real estate contractor estimates. Analyze the OCR text from a contractor bid and extract structured data. Return a valid JSON object with these keys:
"contractorName": string
"contractorContactName": string
"contractorEmail": string
"contractorPhone": string
"contractorAddress": string
"totalAmount": number
"items": array of objects with "description", "cost", and optional "category"
"renovationAssignments": array of objects with "renovationItemId", "renovationItemName", "amount", optional "scopeSummary", optional "matchedLineItems", and optional "confidence"

If a quote clearly covers one or more scope items provided by the user, map the relevant amount to those scope items. Only assign an amount when the document gives you enough evidence to do so. If the quote is only a whole-project quote and you cannot confidently split it by scope item, return an empty renovationAssignments array.`;
        const userPrompt = `Scope items for this project:\n${JSON.stringify(scopeItems, null, 2)}\n\nHere is the raw text from the estimate:\n\n${extractedText}`;

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
            response_format: { type: "json_object" },
        });

        const structuredData = JSON.parse(completion.choices[0].message.content);
        const validItems = sanitizeBidItems(structuredData.items);
        const validAssignments = sanitizeBidAssignments(
            structuredData.renovationAssignments,
            scopeItems
        );
        const fallbackAssignments =
            validAssignments.length > 0
                ? validAssignments
                : deriveAssignmentsFromItems(validItems, scopeItems);
        const totalAmount =
            normalizeCurrencyValue(structuredData.totalAmount) ??
            validItems.reduce((sum, item) => sum + item.cost, 0);
        const vendorSnapshot = buildVendorSnapshot({
            name: structuredData.contractorName,
            contactName: structuredData.contractorContactName,
            email: structuredData.contractorEmail,
            phone: structuredData.contractorPhone,
            address: structuredData.contractorAddress,
        });
        const matchedVendor = await findMatchingVendor(
            req.user.id,
            vendorSnapshot,
            structuredData.contractorName
        );

        const newBid = new Bid({
            user: req.user.id,
            lead: lead._id,
            investment: investment?._id || null,
            contractorName: structuredData.contractorName,
            totalAmount,
            vendor: matchedVendor?._id || null,
            sourceType: 'imported',
            sourceFileName: req.file.originalname,
            sourceDocumentUrl: req.file.path,
            notes: '',
            vendorSnapshot,
            items: validItems,
            renovationAssignments: fallbackAssignments,
        });

        await newBid.save();
        await populateBidVendor(newBid);
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
        const lead = await getAuthorizedLead(leadId, req.user.id);
        if (!lead) {
            return res.status(401).json({ msg: 'Lead not found or user not authorized.' });
        }
        const bids = await Bid.find({ lead: leadId })
            .populate('vendor', 'name trade specialties contactInfo')
            .sort({ createdAt: -1 });
        res.json(bids);
    } catch (error) {
        console.error('Error fetching bids:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @desc    Create a custom bid
exports.createBid = async (req, res) => {
    try {
        const {
            leadId,
            investmentId,
            vendorId,
            contractorName,
            totalAmount,
            items,
            renovationAssignments,
            notes,
        } = req.body;

        const { lead, investment, scopeItems, error } = await resolveBidScopeContext({
            leadId,
            investmentId,
            userId: req.user.id,
        });
        if (error) {
            return res.status(error.status).json({ msg: error.msg });
        }

        const vendor = await getAuthorizedVendor(vendorId, req.user.id);
        if (vendorId && !vendor) {
            return res.status(400).json({ msg: 'Selected vendor was not found.' });
        }

        const sanitizedItems = Array.isArray(items) ? sanitizeBidItems(items) : [];
        const sanitizedAssignments = Array.isArray(renovationAssignments)
            ? sanitizeBidAssignments(renovationAssignments, scopeItems)
            : [];
        const assignmentTotal = sanitizedAssignments.reduce(
            (sum, assignment) => sum + (assignment.amount || 0),
            0
        );
        const itemTotal = sanitizedItems.reduce((sum, item) => sum + (item.cost || 0), 0);
        const derivedTotal =
            normalizeCurrencyValue(totalAmount) ??
            (sanitizedAssignments.length ? assignmentTotal : itemTotal);

        if (!vendor && !normalizeOptionalString(contractorName)) {
            return res.status(400).json({ msg: 'Choose a vendor for this custom quote.' });
        }

        if (sanitizedAssignments.length === 0 && sanitizedItems.length === 0) {
            return res.status(400).json({ msg: 'Add at least one renovation item amount for this quote.' });
        }

        const bid = new Bid({
            user: req.user.id,
            lead: lead._id,
            investment: investment?._id || null,
            vendor: vendor?._id || null,
            contractorName: normalizeOptionalString(contractorName) || vendor?.name || 'Custom quote',
            totalAmount: derivedTotal,
            sourceType: 'manual',
            notes: normalizeOptionalString(notes),
            vendorSnapshot: buildVendorSnapshotFromVendor(vendor) || buildVendorSnapshot({ name: contractorName }),
            items: sanitizedItems,
            renovationAssignments: sanitizedAssignments,
        });

        await bid.save();
        await populateBidVendor(bid);
        res.status(201).json(bid);
    } catch (error) {
        console.error('Error creating bid:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// ✅ NEW: Function to update an existing bid
exports.updateBid = async (req, res) => {
    try {
        const {
            contractorName,
            totalAmount,
            items,
            renovationAssignments,
            vendorId,
            notes,
            investmentId,
            decisionStatus,
        } = req.body;
        const bid = await Bid.findById(req.params.id);

        if (!bid || bid.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'Bid not found or user not authorized.' });
        }

        const { lead, investment, scopeItems, error } = await resolveBidScopeContext({
            leadId: bid.lead,
            investmentId: investmentId || bid.investment,
            userId: req.user.id,
        });
        if (error) {
            return res.status(error.status).json({ msg: error.msg });
        }
        const vendor = vendorId !== undefined
            ? await getAuthorizedVendor(vendorId, req.user.id)
            : null;

        if (vendorId && !vendor) {
            return res.status(400).json({ msg: 'Selected vendor was not found.' });
        }

        bid.contractorName = contractorName || bid.contractorName;
        bid.totalAmount = normalizeCurrencyValue(totalAmount) ?? bid.totalAmount;
        bid.items = Array.isArray(items) ? sanitizeBidItems(items) : bid.items;
        bid.renovationAssignments = Array.isArray(renovationAssignments)
            ? sanitizeBidAssignments(renovationAssignments, scopeItems)
            : bid.renovationAssignments;
        bid.investment = investment?._id || bid.investment || null;
        if (vendorId !== undefined) {
            bid.vendor = vendor?._id || null;
            if (vendor) {
                bid.contractorName = bid.contractorName || vendor.name;
                bid.vendorSnapshot = buildVendorSnapshotFromVendor(vendor);
            }
        }
        if (notes !== undefined) {
            bid.notes = normalizeOptionalString(notes);
        }
        if (decisionStatus && ['open', 'awarded', 'archived'].includes(decisionStatus)) {
            bid.decisionStatus = decisionStatus;
        }

        await bid.save();
        await populateBidVendor(bid);
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

exports.getBidsForProject = async (req, res) => {
    try {
        const investment = await getAuthorizedInvestment(req.params.investmentId, req.user.id);
        if (!investment) {
            return res.status(401).json({ msg: 'Project not found or user not authorized.' });
        }

        const query = investment.sourceLead
            ? {
                $or: [
                    { investment: investment._id },
                    { lead: investment.sourceLead },
                ],
            }
            : { investment: investment._id };

        const bids = await Bid.find({
            user: req.user.id,
            ...query,
        })
            .populate('vendor', 'name trade specialties contactInfo')
            .sort({ createdAt: -1 });

        res.json(bids);
    } catch (error) {
        console.error('Error fetching project bids:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};

exports.awardBidToBudgetItem = async (req, res) => {
    try {
        const bid = await Bid.findById(req.params.id);
        if (!bid || String(bid.user) !== String(req.user.id)) {
            return res.status(401).json({ msg: 'Bid not found or user not authorized.' });
        }

        const budgetItem = await getAuthorizedBudgetItem(req.body.budgetItemId, req.user.id);
        if (!budgetItem) {
            return res.status(400).json({ msg: 'Selected scope item was not found.' });
        }

        const investment = await getAuthorizedInvestment(budgetItem.investment, req.user.id);
        if (!investment) {
            return res.status(400).json({ msg: 'Project not found for this scope item.' });
        }

        const awardAmount = normalizeCurrencyValue(req.body.amount) ?? normalizeCurrencyValue(bid.totalAmount);
        if (awardAmount === null || awardAmount <= 0) {
            return res.status(400).json({ msg: 'Award amount must be greater than zero.' });
        }

        const awardDescription = normalizeOptionalString(req.body.description || req.body.scopeSummary || bid.notes);
        const vendorName =
            bid.vendorSnapshot?.name ||
            bid.contractorName ||
            normalizeOptionalString(req.body.vendorName) ||
            'Selected vendor';

        const existingAward = (budgetItem.awards || []).find(
            (award) => String(award.sourceBid || '') === String(bid._id)
        );

        if (existingAward) {
            existingAward.vendor = bid.vendor || null;
            existingAward.vendorName = bid.vendor?.name || vendorName;
            existingAward.description = awardDescription || existingAward.description;
            existingAward.amount = awardAmount;
            existingAward.notes = normalizeOptionalString(req.body.notes) || existingAward.notes;
        } else {
            budgetItem.awards.push({
                vendor: bid.vendor || null,
                vendorName: bid.vendor?.name || vendorName,
                description: awardDescription,
                amount: awardAmount,
                notes: normalizeOptionalString(req.body.notes),
                sourceBid: bid._id,
            });
        }

        await budgetItem.save();

        const savedAward = (budgetItem.awards || []).find(
            (award) => String(award.sourceBid || '') === String(bid._id)
        );

        bid.investment = investment._id;
        bid.decisionStatus = 'awarded';
        bid.awardedAt = new Date();
        const existingBidAward = (bid.awards || []).find(
            (award) => String(award.budgetItem || '') === String(budgetItem._id)
        );
        if (existingBidAward) {
            existingBidAward.amount = awardAmount;
            existingBidAward.awardId = savedAward?.awardId || existingBidAward.awardId;
        } else {
            bid.awards.push({
                budgetItem: budgetItem._id,
                awardId: savedAward?.awardId || '',
                amount: awardAmount,
            });
        }

        await bid.save();
        await populateBidVendor(bid);

        res.json({
            bid,
            budgetItemId: budgetItem._id,
            awardId: savedAward?.awardId || '',
        });
    } catch (error) {
        console.error('Error awarding bid to budget item:', error);
        res.status(500).json({ msg: 'Server Error' });
    }
};
