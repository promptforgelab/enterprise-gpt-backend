// api/build-campaign.js
const { Parser } = require("json2csv");

module.exports = (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const {
      product_name,
      target_audience,
      geo,
      budget,
      tone,
      num_variants,
      platform,
      headlines = [],
      descriptions = [],
      cta_pool = []
    } = req.body || {};

    const n = Math.max(1, Number(num_variants || 1));
    if (!product_name || !geo || headlines.length === 0 || descriptions.length === 0 || cta_pool.length === 0) {
      res.status(400).json({ error: "Missing required fields (product_name, geo, headlines[], descriptions[], cta_pool[])" });
      return;
    }

    const rows = [];
    for (let i = 0; i < n; i++) {
      rows.push({
        Campaign: `${product_name} - ${geo}`,
        AdGroup: `${product_name} - Core`,
        Headline: headlines[i % headlines.length],
        Description: descriptions[i % descriptions.length],
        CTA: cta_pool[i % cta_pool.length],
        Geo: geo,
        Platform: platform || "Google Search",
        Budget: budget || "",
        Tone: tone || ""
      });
    }

    const csv = new Parser().parse(rows);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=bulk_ads_export.csv");
    res.status(200).send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate export" });
  }
};
