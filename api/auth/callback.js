// api/auth/callback.js
const { google } = require('googleapis');
const fetch = require('node-fetch');

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
    oauth2Client.setCredentials(tokens);

    // 2. Use access_token to list accessible accounts
    const response = await fetch(
      "https://googleads.googleapis.com/v14/customers:listAccessibleCustomers",
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${tokens.access_token}`,
          "developer-token": DEVELOPER_TOKEN,
        }
      }
    );

    const accounts = await response.json();

    // 3. Display result (for now, just show tokens + accounts in browser)
    res.status(200).send(`
      <h2>✅ OAuth Success!</h2>
      <h3>Tokens:</h3>
      <pre>${JSON.stringify(tokens, null, 2)}</pre>
      <h3>Accessible Accounts:</h3>
      <pre>${JSON.stringify(accounts, null, 2)}</pre>
      <p>Pick a customer ID from above and use it in /api/ads-metrics.</p>
    `);

  } catch (err) {
    console.error(err);
    res.status(500).send("OAuth Error: " + err.message);
  }
};
