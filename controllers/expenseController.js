const Expense = require('../models/Expense');
const Investment = require('../models/Investment');
const BudgetItem = require('../models/BudgetItem');
const Vendor = require('../models/Vendor');
const cloudinary = require('cloudinary').v2;
const OpenAI = require('openai');

const LEGACY_PRIMARY_FUNDING_SOURCE_ID = 'legacy-primary-funding-source';
const EXPENSE_STATUS_VALUES = ['draft', 'approved', 'paid', 'reimbursed'];
const EXPENSE_PAYMENT_METHOD_VALUES = ['other', 'ach', 'wire', 'check', 'cash', 'credit_card', 'debit_card'];
const EXPENSE_RECURRING_CATEGORY_VALUES = ['', 'taxes', 'insurance', 'utilities', 'other_monthly'];

const getOpenAIClient = () => {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
};

const isPresent = (value) => value !== undefined && value !== null && value !== '';

const toOptionalString = (value) => {
  if (!isPresent(value)) return '';
  return String(value).trim();
};

const toOptionalNumber = (value) => {
  if (!isPresent(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseOptionalDate = (value) => {
  if (!isPresent(value)) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) ? parsed : undefined;
};

const parseExtractionPayload = (value) => {
  if (!isPresent(value)) return null;
  if (typeof value === 'object') return value;

  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
};

const toExpenseStatus = (value) => {
  const normalized = toOptionalString(value).toLowerCase();
  return EXPENSE_STATUS_VALUES.includes(normalized) ? normalized : 'paid';
};

const toExpensePaymentMethod = (value) => {
  const normalized = toOptionalString(value).toLowerCase();
  return EXPENSE_PAYMENT_METHOD_VALUES.includes(normalized) ? normalized : 'other';
};

const toExpenseRecurringCategory = (value) => {
  const normalized = toOptionalString(value).toLowerCase();
  return EXPENSE_RECURRING_CATEGORY_VALUES.includes(normalized) ? normalized : '';
};

const populateExpense = (query) =>
  query.populate('vendor', 'name trade specialties contactInfo');

const getAuthorizedInvestment = async (investmentId, userId) => {
  const investment = await Investment.findById(investmentId);
  if (!investment || String(investment.user) !== String(userId)) {
    return null;
  }

  return investment;
};

const getAuthorizedExpense = async (expenseId, userId) => {
  const expense = await Expense.findById(expenseId);

  if (!expense) {
    return { error: { status: 404, msg: 'Expense not found.' } };
  }

  if (String(expense.user) !== String(userId)) {
    return { error: { status: 401, msg: 'User not authorized.' } };
  }

  return { expense };
};

const getAuthorizedBudgetItem = async (budgetItemId, investmentId, userId) => {
  if (!budgetItemId) {
    return null;
  }

  const budgetItem = await BudgetItem.findById(budgetItemId);
  if (
    !budgetItem ||
    String(budgetItem.user) !== String(userId) ||
    String(budgetItem.investment) !== String(investmentId)
  ) {
    return null;
  }

  return budgetItem;
};

const findFundingSource = (investment, sourceId) => {
  if (!sourceId) {
    return null;
  }

  if (
    sourceId === LEGACY_PRIMARY_FUNDING_SOURCE_ID &&
    (!Array.isArray(investment?.fundingSources) || investment.fundingSources.length === 0) &&
    (toOptionalNumber(investment?.loanAmount) > 0 ||
      toOptionalString(investment?.loanType) ||
      toOptionalString(investment?.lenderName))
  ) {
    return {
      sourceId: LEGACY_PRIMARY_FUNDING_SOURCE_ID,
      name: toOptionalString(investment?.lenderName),
      type: toOptionalString(investment?.loanType),
    };
  }

  return (
    investment?.fundingSources?.find(
      (source) => String(source?.sourceId || '') === String(sourceId)
    ) || null
  );
};

const findDrawRequest = (investment, drawRequestId) => {
  if (!drawRequestId) {
    return null;
  }

  return (
    investment?.drawRequests?.find(
      (request) => String(request?.drawId || '') === String(drawRequestId)
    ) || null
  );
};

const resolveFinanceLink = ({ investment, fundingSourceId, drawRequestId }) => {
  const nextFundingSourceId = toOptionalString(fundingSourceId);
  const nextDrawRequestId = toOptionalString(drawRequestId);
  const matchedDrawRequest = findDrawRequest(investment, nextDrawRequestId);

  if (nextDrawRequestId && !matchedDrawRequest) {
    return { error: 'Selected draw request was not found for this project.' };
  }

  let resolvedFundingSourceId = nextFundingSourceId;

  if (matchedDrawRequest?.sourceId) {
    const drawSourceId = toOptionalString(matchedDrawRequest.sourceId);

    if (resolvedFundingSourceId && resolvedFundingSourceId !== drawSourceId) {
      return {
        error: 'Selected draw request does not match the chosen funding source.',
      };
    }

    resolvedFundingSourceId = drawSourceId;
  }

  if (resolvedFundingSourceId && !findFundingSource(investment, resolvedFundingSourceId)) {
    return { error: 'Selected funding source was not found for this project.' };
  }

  return {
    fundingSourceId: resolvedFundingSourceId,
    drawRequestId: nextDrawRequestId,
  };
};

const normalizeVendorKey = (value = '') =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const findSuggestedVendor = (vendors = [], candidate = '') => {
  const normalizedCandidate = normalizeVendorKey(candidate);
  if (!normalizedCandidate) {
    return null;
  }

  return (
    vendors.find((vendor) => {
      const names = [
        vendor.name,
        vendor.contactInfo?.contactName,
        vendor.trade,
      ]
        .map(normalizeVendorKey)
        .filter(Boolean);

      return names.some(
        (entry) =>
          entry === normalizedCandidate ||
          entry.includes(normalizedCandidate) ||
          normalizedCandidate.includes(entry)
      );
    }) || null
  );
};

const findSuggestedBudgetItem = (budgetItems = [], candidate = '') => {
  const normalizedCandidate = normalizeVendorKey(candidate);
  if (!normalizedCandidate) {
    return null;
  }

  return (
    budgetItems.find((item) => {
      const haystack = [item.category, item.description]
        .map(normalizeVendorKey)
        .filter(Boolean)
        .join(' ');

      return haystack.includes(normalizedCandidate);
    }) || null
  );
};

const buildExpensePayload = ({ body = {}, budgetItem = null }) => {
  const amount = toOptionalNumber(body.amount);
  const vendor = toOptionalString(body.vendor) || null;
  const payeeName = toOptionalString(body.payeeName);
  const awardId = toOptionalString(body.awardId);
  const title = toOptionalString(body.title || body.description);
  const description = toOptionalString(body.description);

  let inferredVendor = vendor;
  let inferredPayeeName = payeeName;

  if (budgetItem && awardId) {
    const selectedAward = budgetItem.awards.find((entry) => String(entry.awardId) === awardId);
    if (selectedAward) {
      inferredVendor = inferredVendor || selectedAward.vendor || null;
      inferredPayeeName = inferredPayeeName || selectedAward.vendorName || '';
    }
  }

  return {
    budgetItem: budgetItem?._id || null,
    awardId,
    fundingSourceId: toOptionalString(body.fundingSourceId),
    drawRequestId: toOptionalString(body.drawRequestId),
    status: toExpenseStatus(body.status),
    paymentMethod: toExpensePaymentMethod(body.paymentMethod),
    recurringCategory: toExpenseRecurringCategory(body.recurringCategory),
    title,
    description,
    amount,
    vendor: inferredVendor,
    payeeName: inferredPayeeName,
    date: parseOptionalDate(body.date),
    entryMethod: toOptionalString(body.entryMethod) === 'receipt_ai' ? 'receipt_ai' : 'manual',
    notes: toOptionalString(body.notes),
    receiptExtraction: parseExtractionPayload(body.receiptExtraction),
  };
};

// @desc    Create a new expense for an investment
exports.createExpense = async (req, res) => {
  try {
    const { investmentId } = req.body;
    const investment = await getAuthorizedInvestment(investmentId, req.user.id);
    if (!investment) {
      return res.status(401).json({ msg: 'Not authorized for this project.' });
    }

    const budgetItem = await getAuthorizedBudgetItem(
      toOptionalString(req.body.budgetItemId || req.body.budgetItem),
      investmentId,
      req.user.id
    );

    if (
      isPresent(req.body.budgetItemId || req.body.budgetItem) &&
      !budgetItem
    ) {
      return res.status(400).json({ msg: 'Selected scope item was not found for this project.' });
    }

    const payload = buildExpensePayload({ body: req.body, budgetItem });
    const financeLink = resolveFinanceLink({
      investment,
      fundingSourceId: payload.fundingSourceId,
      drawRequestId: payload.drawRequestId,
    });

    if (!payload.title || payload.amount === null) {
      return res.status(400).json({ msg: 'Title and amount are required.' });
    }

    if (!payload.vendor && !payload.payeeName) {
      return res.status(400).json({ msg: 'Choose a vendor or enter the payee name.' });
    }

    if (financeLink.error) {
      return res.status(400).json({ msg: financeLink.error });
    }

    const newExpense = new Expense({
      user: req.user.id,
      investment: investmentId,
      budgetItem: payload.budgetItem,
      awardId: payload.awardId,
      fundingSourceId: financeLink.fundingSourceId,
      drawRequestId: financeLink.drawRequestId,
      status: payload.status,
      paymentMethod: payload.paymentMethod,
      recurringCategory: payload.recurringCategory,
      title: payload.title,
      description: payload.description,
      amount: payload.amount,
      vendor: payload.vendor,
      payeeName: payload.payeeName,
      date: payload.date,
      notes: payload.notes,
      entryMethod: payload.entryMethod,
      receiptExtraction: payload.receiptExtraction,
    });

    if (req.file) {
      newExpense.receiptUrl = req.file.path;
      newExpense.receiptCloudinaryId = req.file.filename;
    }

    await newExpense.save();
    const populatedExpense = await populateExpense(Expense.findById(newExpense._id));
    res.status(201).json(populatedExpense);
  } catch (error) {
    console.error('Error creating expense:', error);
    res.status(500).json({ msg: 'Server Error' });
  }
};

// @desc    Analyze a receipt image and suggest vendor / scope matches
exports.analyzeReceipt = async (req, res) => {
  try {
    const { investmentId } = req.body;
    const investment = await getAuthorizedInvestment(investmentId, req.user.id);
    if (!investment) {
      return res.status(401).json({ msg: 'Not authorized for this project.' });
    }

    if (!req.file?.path) {
      return res.status(400).json({ msg: 'Upload a receipt image first.' });
    }

    if (!String(req.file.mimetype || '').startsWith('image/')) {
      return res.status(400).json({ msg: 'AI receipt assist currently supports images.' });
    }

    const openai = getOpenAIClient();
    if (!openai) {
      return res.status(503).json({ msg: 'OpenAI is not configured on the server.' });
    }

    const [vendors, budgetItems] = await Promise.all([
      Vendor.find({ user: req.user.id }).select('name trade contactInfo'),
      BudgetItem.find({ investment: investmentId }).select('category description awards vendorName'),
    ]);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You extract expense details from a receipt image for a rehab project. Return valid JSON only.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `
Analyze this receipt and return JSON with exactly these keys:
- title
- description
- vendorName
- amount
- expenseDate
- budgetItemHint
- notes

Use concise strings. amount must be a number when visible, otherwise null. expenseDate must be YYYY-MM-DD when visible, otherwise "".

Known vendors:
${JSON.stringify(
  vendors.map((vendor) => ({
    id: String(vendor._id),
    name: vendor.name,
    trade: vendor.trade,
    contactName: vendor.contactInfo?.contactName || '',
  })),
  null,
  2
)}

Known scope items:
${JSON.stringify(
  budgetItems.map((item) => ({
    id: String(item._id),
    category: item.category,
    description: item.description || '',
  })),
  null,
  2
)}
              `,
            },
            {
              type: 'image_url',
              image_url: {
                url: req.file.path,
              },
            },
          ],
        },
      ],
      temperature: 0.1,
    });

    const parsed = JSON.parse(completion.choices[0].message.content || '{}');
    const suggestedVendor = findSuggestedVendor(vendors, parsed.vendorName);
    const suggestedBudgetItem = findSuggestedBudgetItem(budgetItems, parsed.budgetItemHint);

    res.json({
      receiptUrl: req.file.path,
      receiptCloudinaryId: req.file.filename,
      extracted: {
        title: toOptionalString(parsed.title || parsed.description),
        description: toOptionalString(parsed.description),
        vendorName: toOptionalString(parsed.vendorName),
        amount: toOptionalNumber(parsed.amount),
        expenseDate: toOptionalString(parsed.expenseDate),
        budgetItemHint: toOptionalString(parsed.budgetItemHint),
        notes: toOptionalString(parsed.notes),
      },
      suggestedVendor: suggestedVendor
        ? {
            _id: suggestedVendor._id,
            name: suggestedVendor.name,
            trade: suggestedVendor.trade || '',
          }
        : null,
      suggestedBudgetItem: suggestedBudgetItem
        ? {
            _id: suggestedBudgetItem._id,
            category: suggestedBudgetItem.category,
            description: suggestedBudgetItem.description || '',
          }
        : null,
    });
  } catch (error) {
    console.error('Error analyzing receipt:', error);
    res.status(500).json({ msg: 'Failed to analyze receipt.' });
  }
};

// @desc    Get all expenses for a specific investment
exports.getExpensesForInvestment = async (req, res) => {
  try {
    const { investmentId } = req.params;
    const investment = await getAuthorizedInvestment(investmentId, req.user.id);
    if (!investment) {
      return res.status(401).json({ msg: 'Not authorized to view this project.' });
    }

    const expenses = await populateExpense(
      Expense.find({ investment: investmentId }).sort({ date: -1, createdAt: -1 })
    );

    res.json(expenses);
  } catch (error) {
    console.error('Error fetching expenses:', error);
    res.status(500).json({ msg: 'Server Error' });
  }
};

// @desc    Update a specific expense
exports.updateExpense = async (req, res) => {
  try {
    const { expense, error } = await getAuthorizedExpense(req.params.id, req.user.id);
    if (error) {
      return res.status(error.status).json({ msg: error.msg });
    }

    const investment = await getAuthorizedInvestment(expense.investment, req.user.id);
    if (!investment) {
      return res.status(401).json({ msg: 'Not authorized for this project.' });
    }

    const hasBudgetItemInput =
      Object.prototype.hasOwnProperty.call(req.body, 'budgetItemId') ||
      Object.prototype.hasOwnProperty.call(req.body, 'budgetItem');
    const hasFundingSourceInput = Object.prototype.hasOwnProperty.call(req.body, 'fundingSourceId');
    const hasDrawRequestInput = Object.prototype.hasOwnProperty.call(req.body, 'drawRequestId');
    const requestedBudgetItemId = toOptionalString(req.body.budgetItemId || req.body.budgetItem);
    const budgetItem = hasBudgetItemInput
      ? await getAuthorizedBudgetItem(requestedBudgetItemId, String(expense.investment), req.user.id)
      : expense.budgetItem
        ? await BudgetItem.findById(expense.budgetItem)
        : null;

    if (hasBudgetItemInput && requestedBudgetItemId && !budgetItem) {
      return res.status(400).json({ msg: 'Selected scope item was not found for this project.' });
    }

    const payload = buildExpensePayload({ body: req.body, budgetItem });
    const financeLink =
      hasFundingSourceInput || hasDrawRequestInput
        ? resolveFinanceLink({
            investment,
            fundingSourceId: hasFundingSourceInput
              ? req.body.fundingSourceId
              : expense.fundingSourceId,
            drawRequestId: hasDrawRequestInput ? req.body.drawRequestId : expense.drawRequestId,
          })
        : null;

    if (req.body.title !== undefined || req.body.description !== undefined) {
      if (!payload.title) {
        return res.status(400).json({ msg: 'Title is required.' });
      }
      expense.title = payload.title;
      expense.description = payload.description;
    }

    if (req.body.amount !== undefined) {
      if (payload.amount === null) {
        return res.status(400).json({ msg: 'Amount must be a valid number.' });
      }
      expense.amount = payload.amount;
    }

    if (hasBudgetItemInput) {
      expense.budgetItem = budgetItem?._id || null;
    }

    if (req.body.awardId !== undefined) expense.awardId = payload.awardId;
    if (req.body.vendor !== undefined) expense.vendor = payload.vendor;
    if (req.body.payeeName !== undefined) expense.payeeName = payload.payeeName;
    if (req.body.date !== undefined) expense.date = payload.date || expense.date;
    if (req.body.notes !== undefined) expense.notes = payload.notes;
    if (req.body.entryMethod !== undefined) expense.entryMethod = payload.entryMethod;
    if (req.body.status !== undefined) expense.status = payload.status;
    if (req.body.paymentMethod !== undefined) expense.paymentMethod = payload.paymentMethod;
    if (req.body.recurringCategory !== undefined) {
      expense.recurringCategory = payload.recurringCategory;
    }
    if (req.body.receiptExtraction !== undefined) {
      expense.receiptExtraction = payload.receiptExtraction;
    }

    if (financeLink?.error) {
      return res.status(400).json({ msg: financeLink.error });
    }

    if (hasFundingSourceInput || hasDrawRequestInput) {
      expense.fundingSourceId = financeLink?.fundingSourceId || '';
      expense.drawRequestId = financeLink?.drawRequestId || '';
    }

    if (!expense.vendor && !expense.payeeName) {
      return res.status(400).json({ msg: 'Choose a vendor or enter the payee name.' });
    }

    await expense.save();
    const populatedExpense = await populateExpense(Expense.findById(expense._id));
    res.json(populatedExpense);
  } catch (error) {
    console.error('Error updating expense:', error);
    res.status(500).json({ msg: 'Server Error' });
  }
};

// @desc    Delete a specific expense
exports.deleteExpense = async (req, res) => {
  try {
    const { expense, error } = await getAuthorizedExpense(req.params.id, req.user.id);
    if (error) {
      return res.status(error.status).json({ msg: error.msg });
    }

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
