const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

exports.generateBudgetLines = async (req, res) => {
  try {
    const { description, sqft, beds, baths, yearBuilt } = req.body;

    const prompt = `
You are a real estate rehab estimator. A user wants to renovate a ${beds || '?'}-bed, ${baths || '?'}-bath, ${sqft || '?'} sqft property built in ${yearBuilt || '?'}. 

Their goals: ${description || "no specific goals described"}

Return a JSON array of budget categories with estimated dollar amounts, like:
[
  { "category": "Plumbing", "budgetedAmount": 6000 },
  { "category": "Paint", "budgetedAmount": 3000 }
]
Respond ONLY with JSON. No extra text.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      max_tokens: 500,
    });

    const parsed = JSON.parse(completion.choices[0].message.content);
    res.json({ budgetLines: parsed });
  } catch (err) {
    console.error("AI Budget Gen Error:", err);
    res.status(500).json({ error: "Failed to generate budget lines" });
  }
};
