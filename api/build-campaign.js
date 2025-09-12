const { Parser } = require("json2csv");

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
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
      headlines,
      descriptions,
      cta_pool
    } = req.body;

    let data = [];

    for (let i = 0; i < num_variants; i++) {
      const headline = headlines[i % headlines.length];
      const description = descriptions[i % descriptions.length];
      const cta = cta_pool[i % cta_pool.length];

      data.push({
        Campaign: `${product_name} - ${geo}`,
        Headline: headline,
        Description: description,
        CTA: cta,
        Geo: geo,
        Platform: platform,
        Budget: budget,
        Tone: tone
      });
    }

    const parser = new Parser();
    const csv = parser.parse(data);

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=bulk_ads_export.csv");
    return res.status(200).send(csv);
  } catch (error) {
    console.error("Error generating CSV:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
