// api/ads-metrics.js
const fetch = require("node-fetch");

const CLIENT_ID = process.env.GADS_CLIENT_ID;
const CLIENT_SECRET = process.env.GADS_CLIENT_SECRET;
const DEVELOPER_TOKEN = process.env.GADS_DEVELOPER_TOKEN;

async function getAccessTokenFromRefresh(refreshToken) {
  const params = new URLSearchParams();
  params.append("client_id", CLIENT_ID);
  params.append("client_secret", CLIENT_SECRET);
  params.append("grant_type", "refresh_token");
  params.append("refresh_token", refreshToken);

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: params,
  });

  const data = await r.json();
  if (!data.access_token) {
    throw new Error(
      "Failed to refresh token: " + JSON.stringify(data, null, 2)
    );
  }
  return data.access_token;
}

module.exports = async (req, res) => {
  try {
    const { customer_id, refresh_token } = req.query;
    if (!customer_id || !refresh_token) {
      return res
        .status(400)
        .json({ error: "Missing customer_id or refresh_token" });
    }

    // 1. Get new access token
    const accessToken = await getAccessTokenFromRefresh(refresh_token);

    // 2. Build GAQL query
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr,
        metrics.average_cpc
      FROM campaign
      WHERE segments.date DURING LAST_7_DAYS
    `;

    // 3. Call Google Ads API (must use searchStream in REST mode)
    const response = await fetch(
      `https://googleads.googleapis.com/v14/customers/${customer_id}/googleAds:searchStream`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": DEVELOPER_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      }
    );

    const text = await response.text();

    // Try parsing JSON, otherwise return raw text for debugging
    try {
      const data = JSON.parse(text);
      return res.status(200).json(data);
    } catch (e) {
      return res.status(500).json({
        error: "Google Ads API returned non-JSON",
        details: text,
      });
    }
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ error: "Failed to fetch metrics", details: err.message });
  }
};
