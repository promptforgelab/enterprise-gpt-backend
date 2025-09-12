// api/build-campaign.js

// tiny CSV escaper (no deps)
function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

module.exports = (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const {
      product_name,
      target_audience, // not used in export but accepted
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
      res.status(400).json({
        error:
          "Missing required fields (product_name, geo, headlines[], descriptions[], cta_pool[])"
      });
      return;
    }

    // build rows
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

    // headers
    const headers = [
      "Campaign",
      "AdGroup",
      "Headline",
      "Description",
      "CTA",
      "Geo",
      "Platform",
      "Budget",
      "Tone"
    ];

    // assemble CSV
    const lines = [];
    lines.push(headers.join(","));
    for (const r of rows) {
      lines.push(headers.map(h => csvEscape(r[h])).join(","));
    }
    const csv = lines.join("\r\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="bulk_ads_export.csv"'
    );
    res.status(200).send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate export" });
  }
};
