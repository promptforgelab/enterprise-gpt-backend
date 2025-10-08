// api/auth.js
const { google } = require("googleapis");

const CLIENT_ID = process.env.GADS_CLIENT_ID;
const CLIENT_SECRET = process.env.GADS_CLIENT_SECRET;
const REDIRECT_URI = process.env.GADS_REDIRECT_URI;

module.exports = (req, res) => {
  try {
    // Initialize OAuth2 client
    const oauth2Client = new google.auth.OAuth2(
      CLIENT_ID,
      CLIENT_SECRET,
      REDIRECT_URI
    );

    // Generate Google OAuth URL
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline", // ensures refresh_token is returned
      prompt: "consent", // always show consent screen
      scope: ["https://www.googleapis.com/auth/adwords"],
    });

    // ✅ Differentiate between human vs GPT (machine)
    if (req.query.mode === "machine") {
      // For GPT / API clients
      return res.status(200).json({
        auth_url: authUrl,
        message: "Machine mode: provide this URL to the user for authentication.",
      });
    } else {
      // For human users (browser)
      return res.redirect(authUrl);
    }
  } catch (err) {
    console.error("OAuth start error:", err);
    res
      .status(500)
      .json({ error: "Failed to initiate OAuth flow", details: err.message });
  }
};
