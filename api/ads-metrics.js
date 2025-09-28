// api/ads-metrics.js
const { GoogleAdsApi } = require("google-ads-api");

const CLIENT_ID = process.env.GADS_CLIENT_ID;
const CLIENT_SECRET = process.env.GADS_CLIENT_SECRET;
const DEVELOPER_TOKEN = process.env.GADS_DEVELOPER_TOKEN;

module.exports = async (req, res) => {
  try {
    const { customer_id, refresh_token } = req.query;
    if (!customer_id || !refresh_token) {
      return res
        .status(400)
        .json({ error: "Missing customer_id or refresh_token" });
    }

    // 1. Init Google Ads API client
    const client = new GoogleAdsApi({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      developer_token: DEVELOPER_TOKEN,
      login_customer_id: customer_id, // ✅ required
    });

    // 2. Connect customer
    const customer = client.Customer({
      customer_account_id: customer_id,
      refresh_token,
    });

    // 3. GAQL query
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

    // 4. Run search
    const result = await customer.search(query);

    return res.status(200).json(result);
  } catch (err) {
    console.error("Ads metrics error", err);
    return res
      .status(500)
      .json({ error: "Failed to fetch metrics", details: err.message });
  }
};
