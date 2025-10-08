// api/auth/callback.js
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

    // ✅ Use native fetch (no need for node-fetch)
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
        <p><strong>Error:</strong> ${data.error}</p>
        <p><strong>Description:</strong> ${data.error_description || "N/A"}</p>
        <pre>${JSON.stringify(data, null, 2)}</pre>
        <hr />
        <p>✅ <strong>Check this first:</strong><br>
        Your redirect URI must exactly match:<br>
        <code>${process.env.GADS_REDIRECT_URI}</code></p>
      `);
    }

    // ✅ Lightweight HTML with minimal payload (safe for both browser & GPT)
    const refreshToken =
      data.refresh_token ||
      "No refresh token received (try adding &prompt=consent to the auth link)";

    res.status(200).send(`
      <h2>✅ OAuth Success!</h2>
      <p><strong>Refresh Token (save this):</strong></p>
      <pre>${refreshToken}</pre>
      <p>
        Next steps:<br/>
        1️⃣ Copy your Google Ads Customer ID (e.g., 123-456-7890).<br/>
        2️⃣ Remove dashes → 1234567890.<br/>
        3️⃣ Then call:<br/>
        <code>/api/ads-metrics?customer_id=YOUR_ID&refresh_token=${refreshToken}</code>
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
