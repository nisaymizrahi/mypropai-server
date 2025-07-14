const OpenAI = require('openai');

// Initialize the OpenAI client with your API key
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// @desc    Generate a property listing description using AI
exports.generateDescription = async (req, res) => {
  const { propertyType, beds, baths, keywords } = req.body;

  if (!propertyType || !keywords) {
    return res.status(400).json({ msg: 'Property type and keywords are required.' });
  }

  // This is the prompt we send to the AI.
  // We give it a role and a specific request to get the best results.
  const systemPrompt = `
    You are a professional real estate copywriter. Your goal is to write compelling,
    enticing, and professional property listing descriptions based on the details provided.
    Write in a friendly but professional tone. Highlight the best features.
    Do not use overly cliché phrases. End with a clear call to action to schedule a tour.
  `;
  
  const userPrompt = `
    Please write a property listing description.
    - Property Type: ${propertyType}
    - Details: ${beds} bedrooms, ${baths} bathrooms.
    - Key features to highlight: ${keywords}
  `;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // A powerful and cost-effective model
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const description = completion.choices[0].message.content;
    res.status(200).json({ description });

  } catch (error) {
    console.error('Error communicating with OpenAI API:', error);
    res.status(500).json({ msg: 'Failed to generate AI description.' });
  }
};