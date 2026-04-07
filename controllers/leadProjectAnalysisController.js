const OpenAI = require('openai');

const Lead = require('../models/Lead');

const DEFAULT_TIMEZONE = 'America/New_York';

const getOpenAIClient = () => {
    if (!process.env.OPENAI_API_KEY) {
        return null;
    }

    return new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });
};

const isModelFallbackCandidate = (error) => {
    const status = error?.status || error?.code || null;
    return [400, 403, 404].includes(status);
};

const createResponseWithFallback = async (openai, payload) => {
    const configuredModel = String(process.env.OPENAI_LEAD_PROJECT_ANALYSIS_MODEL || '').trim();
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

const toNumber = (value, fallback = null) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const buildScenarioOutputs = ({ askingPrice, targetOffer, scenarios = [] }) => {
    const acquisitionBasis = toNumber(targetOffer, null) ?? toNumber(askingPrice, 0);

    return scenarios.map((scenario) => {
        const rehabEstimate = toNumber(scenario?.rehabEstimate, 0);
        const arv = toNumber(scenario?.arv, 0);
        const holdingMonths = Math.max(toNumber(scenario?.holdingMonths, 6) || 6, 0);
        const holdingCost = Math.round(acquisitionBasis * 0.006 * holdingMonths);
        const totalProjectCost = acquisitionBasis + rehabEstimate + holdingCost;
        const projectedProfit = arv - totalProjectCost;
        const projectedMargin = arv > 0 ? projectedProfit / arv : null;

        return {
            scenarioId: String(scenario?.scenarioId || ''),
            label: scenario?.label || 'Scenario',
            rehabEstimate,
            arv,
            holdingMonths,
            totalProjectCost,
            projectedProfit,
            projectedMargin,
        };
    });
};

const buildFallbackResponse = ({ message, scenarios = [] }) => {
    const strongestScenario = buildScenarioOutputs({
        askingPrice: message?.leadSnapshot?.sellerAskingPrice,
        targetOffer: message?.leadSnapshot?.targetOffer,
        scenarios,
    }).sort((left, right) => (right.projectedProfit || 0) - (left.projectedProfit || 0))[0];

    return {
        responseId: `lead-project-analysis-fallback-${Date.now()}`,
        message: strongestScenario
            ? `The strongest rough scenario right now looks like ${strongestScenario.label}. Review the rehab estimate, ARV, and carry assumptions before you commit, then apply the draft if it matches what you want to test next.`
            : 'I can help compare scenarios once you add at least one draft in the Scenario Lab.',
        actions: [],
        proposedScenarioPatches: strongestScenario
            ? [
                {
                    scenarioId: strongestScenario.scenarioId,
                    patch: {
                        notes: 'Fallback recommendation: validate the ARV and rehab estimate against your contractor feedback before using this scenario for decision-making.',
                    },
                },
            ]
            : [],
        proposedSummaryPatch: strongestScenario
            ? {
                aiSummary: `Current best draft: ${strongestScenario.label} with an estimated profit of $${Math.round(
                    strongestScenario.projectedProfit || 0
                ).toLocaleString()}.`,
            }
            : null,
    };
};

const parseCopilotPayload = (rawText = '') => {
    const trimmed = String(rawText || '').trim();
    if (!trimmed) {
        return null;
    }

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        return null;
    }

    try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch (error) {
        return null;
    }
};

const buildSystemPrompt = () => `
You are Fliprop Project Analysis Assistant.

You help a residential real estate investor compare rehab scenarios on a potential property.

Rules:
- Keep the answer concise, practical, and investor-focused.
- Do not silently change data. Suggest patches only.
- Treat all numbers as rough planning assumptions, not certainty.
- Prefer simple, high-signal recommendations over long explanations.
- When you recommend a scenario change, return it as a patch to an existing scenario.
- When discussing relative dates like today or tomorrow, interpret them relative to ${DEFAULT_TIMEZONE}.
- Return JSON only with these keys:
  responseId
  message
  actions
  proposedScenarioPatches
  proposedSummaryPatch

actions must be an array of objects with:
- type
- label

proposedScenarioPatches must be an array of objects with:
- scenarioId
- patch

patch may include:
- label
- strategyType
- rehabEstimate
- arv
- extensionPlanned
- extensionSquareFootage
- holdingMonths
- notes

proposedSummaryPatch may be null or an object with:
- aiSummary
`.trim();

exports.respond = async (req, res) => {
    try {
        const lead = await Lead.findById(req.params.id);
        if (!lead || lead.user.toString() !== req.user.id) {
            return res.status(401).json({ msg: 'Lead not found or user not authorized.' });
        }

        const message = String(req.body?.message || '').trim();
        if (!message) {
            return res.status(400).json({ msg: 'A message is required.' });
        }

        const scenarios = Array.isArray(req.body?.currentScenarioDrafts)
            ? req.body.currentScenarioDrafts
            : Array.isArray(lead?.projectAnalysis?.scenarios)
                ? lead.projectAnalysis.scenarios
                : [];

        const leadSnapshot = req.body?.leadSnapshot || {
            address: lead.address,
            sellerAskingPrice: lead.sellerAskingPrice,
            targetOffer: lead.targetOffer,
            arv: lead.arv,
            rehabEstimate: lead.rehabEstimate,
            status: lead.status,
            nextAction: lead.nextAction,
            followUpDate: lead.followUpDate,
        };

        const openai = getOpenAIClient();
        if (!openai) {
            return res.json(
                buildFallbackResponse({
                    message: { leadSnapshot },
                    scenarios,
                })
            );
        }

        const response = await createResponseWithFallback(openai, {
            input: [
                {
                    role: 'system',
                    content: buildSystemPrompt(),
                },
                {
                    role: 'user',
                    content: [
                        'Lead project-analysis context (JSON):',
                        JSON.stringify(
                            {
                                activePanel: req.body?.activePanel || 'scenario-lab',
                                previousResponseId: req.body?.previousResponseId || '',
                                leadSnapshot,
                                currentScenarioDrafts: scenarios,
                                computedScenarioOutputs: buildScenarioOutputs({
                                    askingPrice: leadSnapshot?.sellerAskingPrice,
                                    targetOffer: leadSnapshot?.targetOffer,
                                    scenarios,
                                }),
                            },
                            null,
                            2
                        ),
                        '',
                        'User request:',
                        message,
                    ].join('\n'),
                },
            ],
        });

        const parsed = parseCopilotPayload(response.output_text);
        if (!parsed) {
            return res.json(
                buildFallbackResponse({
                    message: { leadSnapshot },
                    scenarios,
                })
            );
        }

        return res.json({
            responseId: parsed.responseId || response.id || `lead-project-analysis-${Date.now()}`,
            message:
                typeof parsed.message === 'string' && parsed.message.trim()
                    ? parsed.message.trim()
                    : 'I reviewed the scenarios and have a draft recommendation ready.',
            actions: Array.isArray(parsed.actions) ? parsed.actions : [],
            proposedScenarioPatches: Array.isArray(parsed.proposedScenarioPatches)
                ? parsed.proposedScenarioPatches
                : [],
            proposedSummaryPatch:
                parsed.proposedSummaryPatch && typeof parsed.proposedSummaryPatch === 'object'
                    ? parsed.proposedSummaryPatch
                    : null,
        });
    } catch (error) {
        console.error('Lead project analysis copilot error:', error);
        return res.status(500).json({ msg: 'Failed to respond from the project analysis assistant.' });
    }
};
