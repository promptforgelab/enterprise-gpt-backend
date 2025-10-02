// api/create-test-account.js
const fetch = require("node-fetch");

const CLIENT_ID = process.env.GADS_CLIENT_ID;
const CLIENT_SECRET = process.env.GADS_CLIENT_SECRET;
const DEVELOPER_TOKEN = process.env.GADS_DEVELOPER_TOKEN;
const MANAGER_ID = process.env.GADS_MANAGER_ID; // 👈 Your MCC (no dashes!)

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
    throw new Error("Failed to refresh token: " + JSON.stringify(data, null, 2));
  }
  return data.access_token;
}

module.exports = async (req, res) => {
  try {
    const { refresh_token } = req.query;
    if (!refresh_token) {
      return res.status(400).json({ error: "Missing refresh_token" });
    }
    if (!MANAGER_ID) {
      return res.status(400).json({ error: "Missing GADS_MANAGER_ID env var" });
    }

    // 1. Get an access token
    const accessToken = await getAccessTokenFromRefresh(refresh_token);

    // 2. Build create test account request
    const body = {
      customerClient: {
        descriptiveName: "EnterpriseGPT Test Account",
        currencyCode: "USD",
        timeZone: "America/New_York",
        testAccount: true, // 👈 required for sandbox test accounts
      },
    };

    // 3. Call API
    const url = `https://googleads.googleapis.com/v14/customers/${MANAGER_ID}:createCustomerClient`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": DEVELOPER_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    return res.status(response.ok ? 200 : 500).json(json);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to create test account", details: err.message });
  }
};
