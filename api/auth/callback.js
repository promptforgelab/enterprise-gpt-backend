// api/auth/callback.js
const { google } = require("googleapis");

const CLIENT_ID = process.env.GADS_CLIENT_ID;
const CLIENT_SECRET = process.env.GADS_CLIENT_SECRET;
const REDIRECT_URI = process.env.GADS_REDIRECT_URI;

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

module.exports = async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) {
      return res.status(400).send("Missing code parameter");
    }

    // 1. Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);

    // 2. Display refresh token and explain next step
    res.status(200).send(`
      <h2>✅ OAuth Success!</h2>
      <p>Refresh Token (save this):</p>
      <pre>${tokens.refresh_token}</pre>
      <p>
        Now go to your Google Ads UI and copy your Customer ID (top right corner, looks like 123-456-7890).<br/>
        Remove the dashes → e.g. 1234567890.
      </p>
      <p>
        Then call:<br/>
        /api/ads-metrics?customer_id=YOUR_ID&refresh_token=${tokens.refresh_token}
      </p>
    `);
  } catch (err) {
    console.error("OAuth Error", err);
    res.status(500).send("OAuth Error: " + err.message);
  }
};
