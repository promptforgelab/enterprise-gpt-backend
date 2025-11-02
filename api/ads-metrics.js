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

    // ✅ Fix: Query campaigns first WITHOUT metrics to ensure all campaigns are returned
    // When querying metrics, Google Ads API requires a date segment and excludes campaigns
    // with no activity in that date range. Paused/unserving campaigns won't appear.
    const campaignsQuery = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.serving_status,
        campaign.advertising_channel_type
      FROM campaign
      WHERE campaign.status IN ('ENABLED', 'PAUSED', 'REMOVED')
      ORDER BY campaign.id
    `;

    // Separate query for metrics with extended date range (LAST_30_DAYS)
    // This will return metrics only for campaigns with activity, but we merge with campaign list
    const metricsQuery = `
      SELECT
        campaign.id,
        campaign.name,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr,
        metrics.average_cpc,
        metrics.conversions
      FROM campaign
      WHERE segments.date DURING LAST_30_DAYS
        AND campaign.status IN ('ENABLED', 'PAUSED', 'REMOVED')
    `;

    // Helper function to execute GAQL query
    const executeQuery = async (query) => {
      const body = JSON.stringify({ query });
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": DEVELOPER_TOKEN,
        "Content-Type": "application/json",
      };

      // Add MCC header if GADS_MANAGER_ID is set
      // Note: MCC ID should be provided without dashes (e.g., "1843930354" not "184-393-0354")
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
        throw new Error(`Google Ads API error: ${errText.slice(0, 500)}`);
      }

      // Parse stream format (line-delimited JSON chunks)
      const text = await response.text();
      const lines = text.split("\n").filter(Boolean);
      return lines.flatMap(line => {
        try {
          const chunk = JSON.parse(line);
          return chunk.results || [];
        } catch {
          return [];
        }
      });
    };

    // Step 1: Get all campaigns (without metrics) - this ensures all campaigns are returned
    const campaigns = await executeQuery(campaignsQuery);
    
    // Step 2: Get metrics (with date range) - this may exclude campaigns with no activity
    let metricsMap = {};
    try {
      const metricsResults = await executeQuery(metricsQuery);
      metricsResults.forEach(r => {
        if (r.campaign?.id) {
          metricsMap[r.campaign.id] = {
            impressions: r.metrics?.impressions || 0,
            clicks: r.metrics?.clicks || 0,
            ctr: r.metrics?.ctr || 0,
            average_cpc: r.metrics?.average_cpc || 0,
            conversions: r.metrics?.conversions || 0,
          };
        }
      });
    } catch (metricsError) {
      // If metrics query fails (e.g., account has no activity), just use empty metrics
      console.warn("Metrics query failed (expected for paused accounts):", metricsError.message);
    }

    // Merge campaigns with their metrics
    const campaignsWithMetrics = campaigns.map(r => ({
      id: r.campaign?.id,
      name: r.campaign?.name,
      status: r.campaign?.status || 'UNKNOWN',
      serving_status: r.campaign?.serving_status || 'UNKNOWN',
      advertising_channel_type: r.campaign?.advertising_channel_type || 'UNKNOWN',
      // Merge metrics if available, otherwise use 0
      ...(metricsMap[r.campaign?.id] || {
        impressions: 0,
        clicks: 0,
        ctr: 0,
        average_cpc: 0,
        conversions: 0,
      }),
    }));

    return res.status(200).json({
      success: true,
      count: campaignsWithMetrics.length,
      campaigns: campaignsWithMetrics.slice(0, 50),
    });
  } catch (err) {
    console.error("Metrics fetch failed:", err);
    res.status(500).json({
      error: "Failed to fetch metrics",
      details: err.message,
    });
  }
};
