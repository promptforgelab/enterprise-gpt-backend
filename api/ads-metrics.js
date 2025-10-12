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
    if (!customer_id || !refresh_token)
      return res
        .status(400)
        .json({ error: "Missing customer_id or refresh_token" });

    const accessToken = await getAccessTokenFromRefresh(refresh_token);

    // ✅ REST GAQL endpoint instead of gRPC
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

    const body = JSON.stringify({ query });

    const response = await fetch(
      `https://googleads.googleapis.com/v14/customers/${customer_id}/googleAds:search`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": DEVELOPER_TOKEN,
          "Content-Type": "application/json",
        },
        body,
      }
    );

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error("Non-JSON response: " + text.slice(0, 200));
    }

    if (!response.ok) {
      return res
        .status(response.status)
        .json({ error: "Google Ads API error", details: data });
    }

    // ✅ Trim payload so GPT never hits ResponseTooLargeError
    const limited = (data.results || []).slice(0, 10);

    return res.status(200).json({
      success: true,
      mode: "basic_access",
      count: limited.length,
      campaigns: limited.map(r => ({
        id: r.campaign?.id,
        name: r.campaign?.name,
        impressions: r.metrics?.impressions,
        clicks: r.metrics?.clicks,
        ctr: r.metrics?.ctr,
        average_cpc: r.metrics?.average_cpc,
      })),
    });
  } catch (err) {
    console.error("Metrics fetch failed:", err);
    res
      .status(500)
      .json({ error: "Failed to fetch metrics", details: err.message });
  }
};
