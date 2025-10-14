// api/ads-metrics.js
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const CLIENT_ID = process.env.GADS_CLIENT_ID;
const CLIENT_SECRET = process.env.GADS_CLIENT_SECRET;
const DEVELOPER_TOKEN = process.env.GADS_DEVELOPER_TOKEN;

async function getAccessTokenFromRefresh(refreshToken) {
  const params = new URLSearchParams();
  params.append("client_id", CLIENT_ID);
  params.append("client_secret", CLIENT_SECRET);
  params.append("grant_type", "refresh_token");
  params.append("refresh_token", refreshToken);

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: params,
  });
  const data = await tokenRes.json();
  if (!data.access_token) {
    throw new Error("Failed to refresh token: " + JSON.stringify(data, null, 2));
  }
  return data.access_token;
}

module.exports = async (req, res) => {
  try {
    const { customer_id, refresh_token } = req.query;
    if (!customer_id || !refresh_token) {
      return res.status(400).json({ error: "Missing customer_id or refresh_token" });
    }

    const accessToken = await getAccessTokenFromRefresh(refresh_token);

    const query = `
      SELECT
        campaign.id,
        campaign.name,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr,
        metrics.average_cpc,
        metrics.conversions
      FROM campaign
      WHERE segments.date DURING LAST_7_DAYS
      ORDER BY metrics.impressions DESC
      LIMIT 50
    `;

    const body = JSON.stringify({ query });

    // ✅ Correct endpoint (streaming search) - Updated to v21
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": DEVELOPER_TOKEN,
      "Content-Type": "application/json",
    };

    // Add MCC header if GADS_MANAGER_ID is set
    if (process.env.GADS_MANAGER_ID) {
      headers["login-customer-id"] = process.env.GADS_MANAGER_ID;
    }

    const response = await fetch(
      `https://googleads.googleapis.com/v21/customers/${customer_id}/googleAds:searchStream`,
      {
        method: "POST",
        headers,
        body,
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({
        error: "Google Ads API error",
        details: errText.slice(0, 500),
      });
    }

    // ✅ Parse stream format (line-delimited JSON chunks)
    const text = await response.text();
    const lines = text.split("\n").filter(Boolean);
    const results = lines.flatMap(line => {
      try {
        const chunk = JSON.parse(line);
        return chunk.results || [];
      } catch {
        return [];
      }
    });

    const limited = results.slice(0, 10);

    return res.status(200).json({
      success: true,
      count: limited.length,
      campaigns: limited.map(r => ({
        id: r.campaign?.id,
        name: r.campaign?.name,
        impressions: r.metrics?.impressions,
        clicks: r.metrics?.clicks,
        ctr: r.metrics?.ctr,
        average_cpc: r.metrics?.average_cpc,
        conversions: r.metrics?.conversions,
      })),
    });
  } catch (err) {
    console.error("Metrics fetch failed:", err);
    res.status(500).json({
      error: "Failed to fetch metrics",
      details: err.message,
    });
  }
};
