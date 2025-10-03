// api/ad-optimizer.js
const { Parser } = require("json2csv");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { ads = [] } = req.body;

    if (!Array.isArray(ads) || ads.length === 0) {
      return res.status(400).json({ error: "Missing or invalid ads array" });
    }

    // Ensure ads have consistent fields
    const parser = new Parser({ fields: ["Headline", "Description", "CTA"] });
    const csv = parser.parse(ads);

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=optimized_ads.csv");
    return res.status(200).send(csv);

  } catch (error) {
    console.error("Ad Optimizer error:", error.message);
    return res.status(500).json({ error: "Internal server error", details: error.message });
  }
};
