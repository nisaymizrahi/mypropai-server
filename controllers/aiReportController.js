const Investment = require("../models/Investment");
const OpenAI = require("openai");
const { getFeatureAccessState } = require('../utils/billingAccess');
const {
  getPropertyStrategyLabel,
  normalizePropertyStrategy,
} = require("../utils/propertyStrategy");

const getOpenAIClient = () => {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
};

exports.generateAIReport = async (req, res) => {
  try {
    const openai = getOpenAIClient();
    if (!openai) {
      return res.status(503).json({ message: "OpenAI is not configured on the server" });
    }

    const { id } = req.params;
    const investment = await Investment.findOne({ _id: id, user: req.user.id });
    if (!investment) return res.status(404).json({ message: "Investment not found" });
    const strategyLabel = getPropertyStrategyLabel(
      normalizePropertyStrategy(investment.strategy || investment.type)
    );

    const access = await getFeatureAccessState({
      user: req.user,
      featureKey: 'ai_investment_report',
    });

    if (!access.accessGranted) {
      return res.status(402).json({
        msg: 'AI investment reports are available on the Pro subscription.',
        billing: {
          featureKey: 'ai_investment_report',
          planKey: access.planKey,
          hasActiveSubscription: access.hasActiveSubscription,
        },
      });
    }

    const summaryPrompt = `You are a real estate analyst. Based on the following investment data, generate a professional report:

Address: ${investment.address}
Strategy: ${strategyLabel}
Status: ${investment.status || "Unknown"}
Purchase Price: $${investment.purchasePrice}
ARV: $${investment.arv}
Rent Estimate: $${investment.rentEstimate}
Loan Amount: $${investment.financingDetails?.purchaseLoan?.loanAmount || 0}
Interest Rate: ${investment.financingDetails?.purchaseLoan?.interestRate || 0}%
Holding Duration: ${investment.dealAnalysis?.holdingCosts?.durationMonths || 0} months
Buying Costs: $${investment.dealAnalysis?.buyingCosts || 0}
Selling Costs: ${investment.dealAnalysis?.sellingCosts?.value || 0} (${investment.dealAnalysis?.sellingCosts?.isPercentage ? "%" : "$"})

Please return a 3-part summary:
1. Executive Summary
2. Deal Analysis Summary
3. Risks & Recommendations

Use bullet points and keep it professional.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: "You are a real estate investment assistant." },
        { role: "user", content: summaryPrompt },
      ],
      max_tokens: 600,
      temperature: 0.7,
    });

    const report = completion.choices[0].message.content;
    res.json({ report });
  } catch (err) {
    console.error("AI Report Error:", err);
    res.status(500).json({ message: "Failed to generate report" });
  }
};
