// api/ads-metrics.js
// ✅ REST-based fallback version for Basic Access accounts
// Works in both Vercel + GPT environments

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
  if (!data.access_token)
    throw new Error("Failed to refresh token: " + JSON.stringify(data));
  return data.access_token;
}

module.exports = async (req, res) => {
  try {
    const { customer_id, refresh_token } = req.query;

    if (!customer_id || !refresh_token) {
      return res
        .status(400)
        .json({ error: "Missing customer_id or refresh_token" });
    }

    // 1️⃣ Refresh access token
    const accessToken = await getAccessTokenFromRefresh(refresh_token);

    // 2️⃣ Make a REST call to list campaigns
    // Basic Access allows only limited endpoints — no gRPC or GAQL
    const response = await fetch(
      `https://googleads.googleapis.com/v14/customers/${customer_id}/campaigns`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": DEVELOPER_TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Google Ads API returned non-JSON: " + text);
    }

    // 3️⃣ Check for errors
    if (!response.ok) {
      console.error("Google Ads API error:", data);
      return res.status(response.status).json({
        error: "Failed to fetch campaign data",
        details: data.error || data,
      });
    }

    // 4️⃣ Return clean response
    return res.status(200).json({
      success: true,
      mode: "basic_access",
      message:
        "Showing limited campaign data (Upgrade to Standard Access for full metrics).",
      campaigns: data,
    });
  } catch (err) {
    console.error("Ads metrics error:", err);
    return res
      .status(500)
      .json({ error: "Failed to fetch metrics", details: err.message });
  }
};
