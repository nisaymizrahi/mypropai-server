const Investment = require("../models/Investment");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

exports.generateAIReport = async (req, res) => {
  try {
    const { id } = req.params;
    const investment = await Investment.findOne({ _id: id, user: req.user.id });
    if (!investment) return res.status(404).json({ message: "Investment not found" });

    const summaryPrompt = `You are a real estate analyst. Based on the following investment data, generate a professional report:

Address: ${investment.address}
Type: ${investment.type}
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
