// api/ad-optimizer.js
const { Configuration, OpenAIApi } = require("openai");
const { Parser } = require("json2csv");

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY, // store in Vercel env
});
const openai = new OpenAIApi(configuration);

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { product_name, target_audience, tone, ads = [], num_variants = 5 } = req.body;

    if (!product_name || !target_audience || ads.length === 0) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Build GPT prompt
    const prompt = `
You are a world-class ad copywriter. 
Optimize and generate new ad variations for ${product_name}, targeting ${target_audience}, with a tone of ${tone}.
The goal is to maximize CTR and conversions.

Input ads: ${JSON.stringify(ads)}

Generate ${num_variants} new ads.
Each ad must include:
- Headline (max 30 chars)
- Description (max 90 chars)
- CTA (short, punchy).

Return in strict JSON format:
[
 { "Headline": "...", "Description": "...", "CTA": "..." }
]
    `;

    // Call GPT
    const gptResponse = await openai.createChatCompletion({
      model: "gpt-4o-mini", // fast + cheap, upgradeable
      messages: [{ role: "user", content: prompt }],
      temperature: 0.8,
    });

    const raw = gptResponse.data.choices[0].message.content.trim();

    // Try parsing JSON
    let newAds;
    try {
      newAds = JSON.parse(raw);
    } catch (err) {
      return res.status(500).json({ error: "Failed to parse GPT output", raw });
    }

    // Convert to CSV
    const parser = new Parser({ fields: ["Headline", "Description", "CTA"] });
    const csv = parser.parse(newAds);

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=optimized_ads.csv");
    return res.status(200).send(csv);

  } catch (error) {
    console.error("Ad Optimizer error:", error.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
