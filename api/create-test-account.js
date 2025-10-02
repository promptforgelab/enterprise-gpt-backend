// api/create-test-account.js
const { GoogleAdsApi } = require("google-ads-api");

const CLIENT_ID = process.env.GADS_CLIENT_ID;
const CLIENT_SECRET = process.env.GADS_CLIENT_SECRET;
const DEVELOPER_TOKEN = process.env.GADS_DEVELOPER_TOKEN;
const MANAGER_ID = process.env.GADS_MANAGER_ID; // Your MCC ID (no dashes)

module.exports = async (req, res) => {
  try {
    const { refresh_token } = req.query;
    if (!refresh_token) {
      return res.status(400).json({ error: "Missing refresh_token" });
    }

    // Init client
    const client = new GoogleAdsApi({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      developer_token: DEVELOPER_TOKEN,
      login_customer_id: MANAGER_ID,
    });

    // Connect to MCC
    const mcc = client.Customer({
      customer_account_id: MANAGER_ID,
      refresh_token,
    });

    // Create a child account (test account)
    const result = await mcc.mutateResources({
      customerClients: [
        {
          _operation: "create",
          descriptiveName: "EnterpriseGPT Test Account",
          currencyCode: "USD",
          timeZone: "America/New_York",
          testAccount: true,
        },
      ],
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error("Create test account error:", err);
    return res.status(500).json({
      error: "Failed to create test account",
      details: err.message,
    });
  }
};
