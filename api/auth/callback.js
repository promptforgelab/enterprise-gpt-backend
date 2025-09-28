// api/auth/callback.js
const { google } = require("googleapis");
const { GoogleAdsApi } = require("google-ads-api");

const CLIENT_ID = process.env.GADS_CLIENT_ID;
const CLIENT_SECRET = process.env.GADS_CLIENT_SECRET;
const REDIRECT_URI = process.env.GADS_REDIRECT_URI;
const DEVELOPER_TOKEN = process.env.GADS_DEVELOPER_TOKEN;

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

module.exports = async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) {
      return res.status(400).send("Missing code parameter");
    }

    // 1. Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);

    // 2. Initialize Ads API client
    const client = new GoogleAdsApi({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      developer_token: DEVELOPER_TOKEN,
    });

    // 3. List accessible accounts (using refresh_token)
    const accounts = await client.listAccessibleCustomers({
      refresh_token: tokens.refresh_token,
    });

    // 4. Display result
    res.status(200).send(`
      <h2>✅ OAuth Success!</h2>
      <h3>Refresh Token (save this):</h3>
      <pre>${tokens.refresh_token}</pre>
      <h3>Accessible Accounts:</h3>
      <pre>${JSON.stringify(accounts, null, 2)}</pre>
      <p>Pick a customer ID and use it with /api/ads-metrics.</p>
    `);
  } catch (err) {
    console.error("OAuth Error", err);
    res.status(500).send("OAuth Error: " + err.message);
  }
};
