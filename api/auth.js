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

    // Generate Google OAuth URL
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/adwords"],
    });

    // ✅ Redirect instead of returning JSON
    return res.redirect(authUrl);
  } catch (err) {
    console.error("OAuth start error:", err);
    res
      .status(500)
      .send(
        `<h2>Google Ads OAuth Error</h2><p>${err.message || "Unknown error"}</p>`
      );
  }
};
