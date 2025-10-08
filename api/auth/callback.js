// api/auth/callback.js
const fetch = require("node-fetch");

module.exports = async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.status(400).send("Missing code parameter");

    const params = new URLSearchParams({
      code,
      client_id: process.env.GADS_CLIENT_ID,
      client_secret: process.env.GADS_CLIENT_SECRET,
      redirect_uri: process.env.GADS_REDIRECT_URI,
      grant_type: "authorization_code",
    });

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });

    const data = await response.json();

    if (data.error) {
      console.error("OAuth Error:", data);
      return res.status(400).send(`
        <h2>❌ OAuth Failed</h2>
        <p>Error: ${data.error}</p>
        <p>Description: ${data.error_description}</p>
        <pre>${JSON.stringify(data, null, 2)}</pre>
        <hr />
        <p>Possible fix: Verify your redirect URI matches exactly:<br>
        <strong>${process.env.GADS_REDIRECT_URI}</strong></p>
      `);
    }

    res.status(200).send(`
      <h2>✅ OAuth Success!</h2>
      <h3>Refresh Token (save this):</h3>
      <pre>${data.refresh_token || "No refresh token (try adding &prompt=consent to the auth link)"}</pre>
      <p>
        Now go to your Google Ads UI and copy your Customer ID (top right corner, looks like 123-456-7890).<br/>
        Remove the dashes → e.g. 1234567890.
      </p>
      <p>
        Then call:<br/>
        /api/ads-metrics?customer_id=YOUR_ID&refresh_token=${data.refresh_token || "YOUR_REFRESH_TOKEN"}
      </p>
    `);
  } catch (err) {
    console.error("OAuth Error:", err);
    res.status(500).send(`
      <h2>⚠️ Internal Error</h2>
      <pre>${err.message}</pre>
    `);
  }
};
