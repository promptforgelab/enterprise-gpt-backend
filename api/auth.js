// api/auth.js
const { google } = require("googleapis");

const CLIENT_ID = process.env.GADS_CLIENT_ID;
const CLIENT_SECRET = process.env.GADS_CLIENT_SECRET;
const REDIRECT_URI = process.env.GADS_REDIRECT_URI;

module.exports = (req, res) => {
  try {
    const oauth2Client = new google.auth.OAuth2(
      CLIENT_ID,
      CLIENT_SECRET,
      REDIRECT_URI
    );

    // Generate minimal Google OAuth URL
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/adwords"],
    });

    // 🪶 Lightweight response: only the URL, no metadata
    res.status(200).json({ auth_url: authUrl });
  } catch (err) {
    console.error("OAuth start error:", err);
    // Return minimal error payload to prevent response overflow
    res
      .status(500)
      .json({ error: "OAuth initiation failed", reason: err.message || "Unknown" });
  }
};
