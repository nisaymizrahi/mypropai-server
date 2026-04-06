const OpenAI = require('openai');

const BudgetItem = require('../models/BudgetItem');
const Expense = require('../models/Expense');
const ProjectDocument = require('../models/ProjectDocument');
const PropertyReport = require('../models/PropertyReport');
const Task = require('../models/Task');
const UnitDocument = require('../models/UnitDocument');
const {
  buildPropertyRecord,
  findPropertyGroupForUser,
} = require('../utils/propertyWorkspace');
const {
  normalizeSearchableDocuments,
  searchPropertyDocuments,
} = require('../utils/propertyCopilotDocumentService');

const PROPERTY_TAB_META = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Property identity, status, KPIs, activity, and quick actions.',
  },
  {
    id: 'financials',
    label: 'Financials',
    description: 'Budget, expenses, capital, lenders, draws, and profitability.',
  },
  {
    id: 'work',
    label: 'Work',
    description: 'Tasks, schedule, vendors, bids, commitments, and execution.',
  },
  {
    id: 'documents',
    label: 'Documents',
    description: 'Uploads, categories, recent files, and linked support docs.',
  },
  {
    id: 'analysis',
    label: 'Analysis',
    description: 'Comps, reports, assumptions, scope, and deal analysis.',
  },
  {
    id: 'settings',
    label: 'Settings',
    description: 'Workspace status, linked records, and property-level controls.',
  },
];

const NAV_DESTINATIONS = [
  ...PROPERTY_TAB_META.map((tab) => tab.id),
  'lead_workspace',
  'acquisitions_workspace',
  'management_workspace',
];

const VALID_URGENCIES = new Set(['low', 'medium', 'high', 'critical']);
const MAX_TOOL_ITERATIONS = 4;
const COPILOT_TIMEZONE = 'America/New_York';

const getOpenAIClient = () => {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
};

const isPresent = (value) => value !== undefined && value !== null && value !== '';

const toNumber = (value, fallback = null) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const sumBy = (items = [], selector) =>
  items.reduce((sum, item) => sum + toNumber(selector(item), 0), 0);

const sortByRecent = (items = []) =>
  [...items].sort(
    (left, right) =>
      new Date(right.updatedAt || right.createdAt || 0) -
      new Date(left.updatedAt || left.createdAt || 0)
  );

const pickPrimaryDocument = (documents = []) => sortByRecent(documents)[0] || null;

const buildPropertyWorkspacePath = (propertyKey, tabId) =>
  `/properties/${encodeURIComponent(propertyKey)}/${tabId}`;

const getCurrentDateLabel = () =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: COPILOT_TIMEZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date());

const normalizeUrgency = (value) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return VALID_URGENCIES.has(normalized) ? normalized : 'medium';
};

const buildBudgetSummary = (budgetItems = [], expenses = []) => {
  const totalBudget = sumBy(budgetItems, (item) => item?.budgetedAmount);
  const originalBudget = sumBy(
    budgetItems,
    (item) => item?.originalBudgetAmount || item?.budgetedAmount
  );
  const awardedAmount = sumBy(budgetItems, (item) =>
    Array.isArray(item?.awards)
      ? item.awards.reduce((sum, award) => sum + toNumber(award?.amount, 0), 0)
      : 0
  );
  const actualSpend = sumBy(expenses, (expense) => expense?.amount);
  const paidSpend = sumBy(expenses, (expense) =>
    ['paid', 'reimbursed'].includes(expense?.status) ? expense?.amount : 0
  );
  const approvedSpend = sumBy(expenses, (expense) =>
    ['approved', 'paid', 'reimbursed'].includes(expense?.status) ? expense?.amount : 0
  );

  const categories = new Map();

  budgetItems.forEach((item) => {
    const key = item?.category || 'Other';
    const current = categories.get(key) || {
      category: key,
      budgetedAmount: 0,
      awardedAmount: 0,
      expenseAmount: 0,
    };

    current.budgetedAmount += toNumber(item?.budgetedAmount, 0);
    current.awardedAmount += Array.isArray(item?.awards)
      ? item.awards.reduce((sum, award) => sum + toNumber(award?.amount, 0), 0)
      : 0;

    categories.set(key, current);
  });

  expenses.forEach((expense) => {
    const budgetCategory = expense?.budgetItem?.category || 'Unassigned';
    const current = categories.get(budgetCategory) || {
      category: budgetCategory,
      budgetedAmount: 0,
      awardedAmount: 0,
      expenseAmount: 0,
    };
    current.expenseAmount += toNumber(expense?.amount, 0);
    categories.set(budgetCategory, current);
  });

  return {
    budgetItemCount: budgetItems.length,
    expenseCount: expenses.length,
    totalBudget,
    originalBudget,
    awardedAmount,
    actualSpend,
    approvedSpend,
    paidSpend,
    remainingBudget: totalBudget - actualSpend,
    topCategories: [...categories.values()]
      .sort(
        (left, right) =>
          right.budgetedAmount + right.expenseAmount - (left.budgetedAmount + left.expenseAmount)
      )
      .slice(0, 6),
  };
};

const buildTaskSummary = (tasks = []) => {
  const now = new Date();
  const openTasks = tasks.filter((task) => task.status !== 'complete');
  const overdueCount = openTasks.filter((task) => {
    const dueDate = task?.dueDate ? new Date(task.dueDate) : null;
    return dueDate && Number.isFinite(dueDate.valueOf()) && dueDate < now;
  }).length;

  return {
    totalCount: tasks.length,
    openCount: openTasks.length,
    overdueCount,
    recent: sortByRecent(tasks)
      .slice(0, 8)
      .map((task) => ({
        id: String(task._id),
        title: task.title,
        status: task.status,
        urgency: task.urgency,
        dueDate: task.dueDate || null,
        description: task.description || '',
      })),
  };
};

const buildDocumentSummary = ({
  projectDocuments = [],
  managedDocuments = [],
  searchableDocumentCount = 0,
}) => {
  const categoryCounts = new Map();

  projectDocuments.forEach((document) => {
    const category = document?.category || 'General';
    categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
  });

  managedDocuments.forEach((document) => {
    const category = document?.unit ? 'Unit' : 'Property';
    categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
  });

  return {
    projectDocumentCount: projectDocuments.length,
    managedDocumentCount: managedDocuments.length,
    searchableDocumentCount,
    categories: [...categoryCounts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((left, right) => right.count - left.count || left.category.localeCompare(right.category))
      .slice(0, 8),
    latest: sortByRecent(projectDocuments)
      .slice(0, 6)
      .map((document) => ({
        id: String(document._id),
        displayName: document.displayName,
        category: document.category || 'General',
        createdAt: document.createdAt || null,
        updatedAt: document.updatedAt || null,
      })),
  };
};

const buildReportSummary = ({ reports = [], lead = null }) => ({
  savedCount: reports.length,
  latest: reports.slice(0, 4).map((report) => ({
    id: String(report._id),
    title: report.title || 'Saved comps report',
    generatedAt: report.generatedAt || report.createdAt || null,
    estimatedValue: report.summary?.estimatedValue ?? null,
    recommendedOfferLow: report.summary?.recommendedOfferLow ?? null,
    recommendedOfferHigh: report.summary?.recommendedOfferHigh ?? null,
  })),
  latestLeadSnapshot: lead?.compsAnalysis
    ? {
        generatedAt: lead.compsAnalysis.generatedAt || null,
        estimatedValue: lead.compsAnalysis.estimatedValue ?? null,
        recommendedOfferLow: lead.compsAnalysis.recommendedOfferLow ?? null,
        recommendedOfferHigh: lead.compsAnalysis.recommendedOfferHigh ?? null,
        confidence: lead.compsAnalysis.report?.confidence || '',
        headline: lead.compsAnalysis.report?.headline || '',
      }
    : null,
});

const buildNavigationSummary = (propertyRecord) => ({
  currentPropertyPath: buildPropertyWorkspacePath(propertyRecord.propertyKey, 'overview'),
  tabs: PROPERTY_TAB_META.map((tab) => ({
    ...tab,
    path: buildPropertyWorkspacePath(propertyRecord.propertyKey, tab.id),
  })),
  linked: {
    leadWorkspace: propertyRecord.workspaces?.pipeline
      ? {
          available: true,
          path: propertyRecord.workspaces.pipeline.path,
          status: propertyRecord.workspaces.pipeline.status || '',
        }
      : {
          available: false,
          path: null,
        },
    acquisitionsWorkspace: propertyRecord.workspaces?.acquisitions
      ? {
          available: true,
          path: propertyRecord.workspaces.acquisitions.path,
          status: propertyRecord.workspaces.acquisitions.status || '',
        }
      : {
          available: false,
          path: null,
        },
    managementWorkspace: propertyRecord.workspaces?.management
      ? {
          available: true,
          path: propertyRecord.workspaces.management.path,
          status: propertyRecord.workspaces.management.status || '',
        }
      : {
          available: false,
          path: null,
        },
  },
});

const buildReportQuery = ({ userId, lead, investment, address }) => {
  const scopes = [
    lead ? { lead: lead._id } : null,
    investment ? { investment: investment._id } : null,
    address ? { address } : null,
  ].filter(Boolean);

  if (!scopes.length) {
    return { user: userId, _id: null };
  }

  return {
    user: userId,
    $or: scopes,
  };
};

const buildCopilotContext = async ({ userId, propertyGroup, activeTab }) => {
  const propertyRecord = buildPropertyRecord(propertyGroup);
  const lead = pickPrimaryDocument(propertyGroup.leads);
  const investment = pickPrimaryDocument(propertyGroup.investments);
  const managedProperty = pickPrimaryDocument(propertyGroup.managedProperties);

  const managedUnitIds = Array.isArray(managedProperty?.units)
    ? managedProperty.units.map((unit) => unit?._id || unit).filter(Boolean)
    : [];

  const [
    propertyTasks,
    budgetItems,
    expenses,
    projectDocuments,
    reports,
    managedDocuments,
  ] = await Promise.all([
    Task.find({ user: userId, propertyKey: propertyRecord.propertyKey })
      .sort({ updatedAt: -1, dueDate: 1 })
      .limit(12)
      .lean(),
    investment
      ? BudgetItem.find({ user: userId, investment: investment._id }).lean()
      : Promise.resolve([]),
    investment
      ? Expense.find({ user: userId, investment: investment._id })
          .populate('budgetItem', 'category')
          .lean()
      : Promise.resolve([]),
    investment
      ? ProjectDocument.find({ ownerAccount: userId, investment: investment._id }).lean()
      : Promise.resolve([]),
    PropertyReport.find(
      buildReportQuery({
        userId,
        lead,
        investment,
        address: propertyRecord.sharedProfile?.address || '',
      })
    )
      .sort({ generatedAt: -1, createdAt: -1 })
      .limit(6)
      .lean(),
    managedProperty
      ? UnitDocument.find({
          $or: [
            { property: managedProperty._id, unit: null },
            managedUnitIds.length ? { unit: { $in: managedUnitIds } } : null,
          ].filter(Boolean),
        })
          .populate('unit', '_id unitNumber name')
          .lean()
      : Promise.resolve([]),
  ]);

  const searchableDocuments = await normalizeSearchableDocuments({
    projectDocuments,
    managedDocuments: Array.isArray(managedDocuments) ? managedDocuments : [],
  });

  return {
    propertyRecord,
    context: {
      currentTab: PROPERTY_TAB_META.find((tab) => tab.id === activeTab) || null,
      property: {
        propertyKey: propertyRecord.propertyKey,
        propertyId: propertyRecord.propertyId,
        title: propertyRecord.title,
        placement: propertyRecord.placement,
        updatedAt: propertyRecord.updatedAt,
        sharedProfile: propertyRecord.sharedProfile,
      },
      workspaces: propertyRecord.workspaces,
      lead: lead
        ? {
            id: String(lead._id),
            status: lead.status || '',
            sellerAskingPrice: lead.sellerAskingPrice ?? null,
            targetOffer: lead.targetOffer ?? null,
            arv: lead.arv ?? null,
            rehabEstimate: lead.rehabEstimate ?? null,
            nextAction: lead.nextAction || '',
            followUpDate: lead.followUpDate || null,
            listingStatus: lead.listingStatus || '',
          }
        : null,
      acquisitions: investment
        ? {
            id: String(investment._id),
            status: investment.status || '',
            strategy: investment.strategy || investment.type || '',
            purchasePrice: investment.purchasePrice ?? null,
            arv: investment.arv ?? null,
            loanAmount: investment.loanAmount ?? null,
            interestRate: investment.interestRate ?? null,
            holdingMonths: investment.holdingMonths ?? null,
            buyClosingCost: investment.buyClosingCost ?? null,
            sellClosingCost: investment.sellClosingCost ?? null,
            lenderName: investment.lenderName || '',
            fundingSourceCount: Array.isArray(investment.fundingSources)
              ? investment.fundingSources.length
              : 0,
            drawRequestCount: Array.isArray(investment.drawRequests)
              ? investment.drawRequests.length
              : 0,
            paymentRecordCount: Array.isArray(investment.paymentRecords)
              ? investment.paymentRecords.length
              : 0,
            budgetSummary: buildBudgetSummary(budgetItems, expenses),
          }
        : null,
      tasks: buildTaskSummary(propertyTasks),
      documents: buildDocumentSummary({
        projectDocuments,
        managedDocuments: Array.isArray(managedDocuments) ? managedDocuments : [],
        searchableDocumentCount: searchableDocuments.length,
      }),
      reports: buildReportSummary({
        reports,
        lead,
      }),
      navigation: buildNavigationSummary(propertyRecord),
    },
    documentSearchState: {
      projectDocuments,
      managedDocuments: Array.isArray(managedDocuments) ? managedDocuments : [],
      searchableDocumentCount: searchableDocuments.length,
    },
  };
};

const buildNavigateResult = ({ propertyRecord, destination }) => {
  if (PROPERTY_TAB_META.some((tab) => tab.id === destination)) {
    const tab = PROPERTY_TAB_META.find((entry) => entry.id === destination);
    return {
      ok: true,
      destination,
      label: `Open ${tab.label}`,
      path: buildPropertyWorkspacePath(propertyRecord.propertyKey, destination),
      message: `Opening ${tab.label.toLowerCase()} for this property.`,
    };
  }

  if (destination === 'lead_workspace') {
    const path = propertyRecord.workspaces?.pipeline?.path || null;
    return path
      ? {
          ok: true,
          destination,
          label: 'Open lead workspace',
          path,
          message: 'Opening the linked lead workspace.',
        }
      : {
          ok: false,
          destination,
          label: 'Open settings',
          path: buildPropertyWorkspacePath(propertyRecord.propertyKey, 'settings'),
          message: 'This property does not have a linked lead workspace yet.',
        };
  }

  if (destination === 'acquisitions_workspace') {
    const path = propertyRecord.workspaces?.acquisitions?.path || null;
    return path
      ? {
          ok: true,
          destination,
          label: 'Open acquisitions workspace',
          path,
          message: 'Opening the linked acquisitions workspace.',
        }
      : {
          ok: false,
          destination,
          label: 'Open financials',
          path: buildPropertyWorkspacePath(propertyRecord.propertyKey, 'financials'),
          message: 'This property does not have a linked acquisitions workspace yet.',
        };
  }

  if (destination === 'management_workspace') {
    const path = propertyRecord.workspaces?.management?.path || null;
    return path
      ? {
          ok: true,
          destination,
          label: 'Open management workspace',
          path,
          message: 'Opening the linked management workspace.',
        }
      : {
          ok: false,
          destination,
          label: 'Open settings',
          path: buildPropertyWorkspacePath(propertyRecord.propertyKey, 'settings'),
          message: 'This property does not have a management workspace yet.',
        };
  }

  return {
    ok: false,
    destination,
    label: 'Open overview',
    path: buildPropertyWorkspacePath(propertyRecord.propertyKey, 'overview'),
    message: 'That destination is not available for this property.',
  };
};

const createPropertyTask = async ({
  userId,
  propertyRecord,
  args,
}) => {
  const title = String(args?.title || '').trim();
  const dueDate = args?.dueDate ? new Date(args.dueDate) : null;

  if (!title) {
    return {
      ok: false,
      message: 'A task title is required before I can create the task.',
    };
  }

  if (!dueDate || Number.isNaN(dueDate.valueOf())) {
    return {
      ok: false,
      message:
        'I need a valid due date before creating the task. Please provide a specific date.',
    };
  }

  const task = await Task.create({
    user: userId,
    title,
    description: String(args?.description || '').trim(),
    dueDate,
    urgency: normalizeUrgency(args?.urgency),
    status: 'open',
    propertyKey: propertyRecord.propertyKey,
    propertyAddress: propertyRecord.sharedProfile?.address || propertyRecord.title,
    sourceType: 'property',
    sourceId: propertyRecord.propertyId || propertyRecord.propertyKey,
    sourceLabel: 'Property workspace',
  });

  return {
    ok: true,
    message: `Created task "${task.title}".`,
    task: {
      id: String(task._id),
      title: task.title,
      dueDate: task.dueDate,
      urgency: task.urgency,
      status: task.status,
    },
  };
};

const parseToolArguments = (toolCall) => {
  try {
    return JSON.parse(toolCall.arguments || '{}');
  } catch (error) {
    return null;
  }
};

const isModelFallbackCandidate = (error) => {
  const status = error?.status || error?.code || null;
  return [400, 403, 404].includes(status);
};

const createResponseWithFallback = async (openai, payload) => {
  const configuredModel = String(process.env.OPENAI_PROPERTY_COPILOT_MODEL || '').trim();
  const modelCandidates = [
    configuredModel,
    'gpt-5.4-mini',
    'gpt-4o-mini',
  ].filter(Boolean);

  let lastError = null;

  for (const model of [...new Set(modelCandidates)]) {
    try {
      return await openai.responses.create({
        ...payload,
        model,
      });
    } catch (error) {
      lastError = error;
      if (!isModelFallbackCandidate(error)) {
        throw error;
      }
    }
  }

  throw lastError;
};

const buildInstructions = () => `
You are Fliprop Property Copilot, an in-product real estate workspace assistant.

Rules:
- Answer using only the property workspace context and tool outputs provided in this conversation.
- If a detail is missing, say so clearly instead of guessing.
- Keep responses concise, professional, and action-oriented.
- If the user asks to open, go to, show, or navigate to a section, call navigate_property_workspace.
- If the user asks what an uploaded document, PDF, contract, invoice, inspection, receipt, report, permit, closing file, or lease says, call search_property_documents first.
- If the user asks to create, add, remind, or follow up with a task and both title and due date are clear, call create_property_task.
- Do not create a task unless the title and due date are both available.
- When discussing relative dates like today or tomorrow, interpret them relative to ${getCurrentDateLabel()} in ${COPILOT_TIMEZONE}. Mention exact dates when helpful.
- Do not give legal, tax, or investment advice beyond summarizing the saved workspace data.
`.trim();

const buildUserInput = ({ message, context }) =>
  [
    'Current workspace context (authoritative JSON):',
    JSON.stringify(context, null, 2),
    '',
    'User request:',
    String(message || '').trim(),
  ].join('\n');

const buildToolDefinitions = () => [
  {
    type: 'function',
    name: 'navigate_property_workspace',
    description:
      'Open a property workspace tab or a linked lead, acquisitions, or management workspace.',
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        destination: {
          type: 'string',
          enum: NAV_DESTINATIONS,
        },
      },
      required: ['destination'],
    },
  },
  {
    type: 'function',
    name: 'search_property_documents',
    description:
      'Search the uploaded property PDFs when the user asks a question about document contents.',
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
        },
      },
      required: ['query'],
    },
  },
  {
    type: 'function',
    name: 'create_property_task',
    description:
      'Create a follow-up task tied to the current property workspace when the user explicitly asks for it.',
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: {
          type: 'string',
        },
        dueDate: {
          type: 'string',
          description:
            'Specific due date in ISO 8601 format. Convert relative dates like tomorrow into exact dates.',
        },
        urgency: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
        },
        description: {
          type: 'string',
        },
      },
      required: ['title', 'dueDate'],
    },
  },
];

const dedupeActions = (actions = []) => {
  const seen = new Set();

  return actions.filter((action) => {
    const signature = JSON.stringify(action);
    if (seen.has(signature)) {
      return false;
    }
    seen.add(signature);
    return true;
  });
};

exports.respond = async (req, res) => {
  try {
    const openai = getOpenAIClient();
    if (!openai) {
      return res.status(503).json({ msg: 'OpenAI is not configured on the server.' });
    }

    const message = String(req.body?.message || '').trim();
    const previousResponseId = String(req.body?.previousResponseId || '').trim();
    const activeTab = String(req.body?.activeTab || 'overview').trim().toLowerCase();

    if (!message) {
      return res.status(400).json({ msg: 'A message is required.' });
    }

    const propertyGroup = await findPropertyGroupForUser(req.user.id, req.params.propertyKey);
    if (!propertyGroup) {
      return res.status(404).json({ msg: 'Property not found.' });
    }

    const { propertyRecord, context, documentSearchState } = await buildCopilotContext({
      userId: req.user.id,
      propertyGroup,
      activeTab,
    });

    const instructions = buildInstructions();
    const tools = buildToolDefinitions();
    const actions = [];
    const createdTasks = [];

    let response = await createResponseWithFallback(openai, {
      instructions,
      previous_response_id: previousResponseId || undefined,
      input: buildUserInput({ message, context }),
      tools,
      tool_choice: 'auto',
      parallel_tool_calls: false,
      max_output_tokens: 700,
      temperature: 0.3,
      user: String(req.user.id),
    });

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
      const toolCalls = Array.isArray(response.output)
        ? response.output.filter((item) => item?.type === 'function_call')
        : [];

      if (!toolCalls.length) {
        break;
      }

      const toolOutputs = [];

      for (const toolCall of toolCalls) {
        const args = parseToolArguments(toolCall);

        if (!args) {
          toolOutputs.push({
            type: 'function_call_output',
            call_id: toolCall.call_id,
            output: JSON.stringify({
              ok: false,
              message: 'Could not parse the tool arguments.',
            }),
          });
          continue;
        }

        if (toolCall.name === 'navigate_property_workspace') {
          const result = buildNavigateResult({
            propertyRecord,
            destination: args.destination,
          });

          if (result.path) {
            actions.push({
              type: 'navigate',
              label: result.label,
              path: result.path,
            });
          }

          toolOutputs.push({
            type: 'function_call_output',
            call_id: toolCall.call_id,
            output: JSON.stringify(result),
          });
          continue;
        }

        if (toolCall.name === 'search_property_documents') {
          const result = await searchPropertyDocuments({
            openai,
            userId: req.user.id,
            propertyKey: propertyRecord.propertyKey,
            propertyId: propertyRecord.propertyId,
            propertyTitle: propertyRecord.title,
            projectDocuments: documentSearchState.projectDocuments,
            managedDocuments: documentSearchState.managedDocuments,
            query: String(args.query || '').trim(),
          });

          if (result.ok) {
            result.results.slice(0, 3).forEach((documentResult) => {
              if (!documentResult.assetId) {
                return;
              }

              actions.push({
                type: 'open_document',
                label: `Open ${documentResult.filename}`,
                assetId: documentResult.assetId,
              });
            });
          }

          toolOutputs.push({
            type: 'function_call_output',
            call_id: toolCall.call_id,
            output: JSON.stringify(result),
          });
          continue;
        }

        if (toolCall.name === 'create_property_task') {
          const result = await createPropertyTask({
            userId: req.user.id,
            propertyRecord,
            args,
          });

          if (result.ok && result.task) {
            createdTasks.push(result.task);
            actions.push({
              type: 'refresh_tasks',
              label: 'Refresh tasks',
            });
          }

          toolOutputs.push({
            type: 'function_call_output',
            call_id: toolCall.call_id,
            output: JSON.stringify(result),
          });
          continue;
        }

        toolOutputs.push({
          type: 'function_call_output',
          call_id: toolCall.call_id,
          output: JSON.stringify({
            ok: false,
            message: `Unknown tool "${toolCall.name}".`,
          }),
        });
      }

      response = await createResponseWithFallback(openai, {
        instructions,
        previous_response_id: response.id,
        input: toolOutputs,
        tools,
        tool_choice: 'auto',
        parallel_tool_calls: false,
        max_output_tokens: 700,
        temperature: 0.3,
        user: String(req.user.id),
      });
    }

    const reply =
      String(response.output_text || '').trim() ||
      (createdTasks.length
        ? `I created ${createdTasks.length === 1 ? 'that task' : 'those tasks'} for this property.`
        : 'I checked the property workspace and did not find anything more to add.');

    return res.json({
      message: reply,
      responseId: response.id,
      actions: dedupeActions(actions),
      createdTasks,
    });
  } catch (error) {
    console.error('Property copilot error:', error);
    return res.status(500).json({ msg: 'Failed to respond from the property copilot.' });
  }
};
