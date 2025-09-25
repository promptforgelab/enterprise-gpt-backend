// api/auth.js
const { google } = require('googleapis');

const CLIENT_ID = process.env.GADS_CLIENT_ID;
const CLIENT_SECRET = process.env.GADS_CLIENT_SECRET;
const REDIRECT_URI = process.env.GADS_REDIRECT_URI;

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

module.exports = (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',   // ensures we get refresh_token
    prompt: 'consent',        // forces Google to always show consent screen
    scope: ['https://www.googleapis.com/auth/adwords'],
  });
  res.redirect(url);
};
