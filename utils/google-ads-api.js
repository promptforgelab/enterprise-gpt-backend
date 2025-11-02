// utils/google-ads-api.js
/**
 * Shared Google Ads API utilities
 * Centralizes OAuth token refresh and GAQL query execution
 */

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const CLIENT_ID = process.env.GADS_CLIENT_ID;
const CLIENT_SECRET = process.env.GADS_CLIENT_SECRET;
const DEVELOPER_TOKEN = process.env.GADS_DEVELOPER_TOKEN;
const MANAGER_ID = process.env.GADS_MANAGER_ID;

/**
 * Refreshes OAuth access token from refresh token
 * @param {string} refreshToken - OAuth refresh token
 * @returns {Promise<string>} Access token
 */
async function getAccessTokenFromRefresh(refreshToken) {
  if (!refreshToken) {
    throw new Error('Refresh token is required');
  }

  const params = new URLSearchParams();
  params.append("client_id", CLIENT_ID);
  params.append("client_secret", CLIENT_SECRET);
  params.append("grant_type", "refresh_token");
  params.append("refresh_token", refreshToken);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: params,
  });

  const data = await response.json();
  
  if (!data.access_token) {
    throw new Error(`Failed to refresh token: ${JSON.stringify(data, null, 2)}`);
  }

  return data.access_token;
}

/**
 * Executes a GAQL query against Google Ads API
 * @param {string} customerId - Google Ads customer ID (without dashes)
 * @param {string} accessToken - OAuth access token
 * @param {string} query - GAQL query string
 * @param {string} loginCustomerId - Optional MCC/Manager ID (for MCC token context)
 * @returns {Promise<Array>} Array of result objects from API
 */
async function executeGAQLQuery(customerId, accessToken, query, loginCustomerId = null) {
  if (!customerId || !accessToken || !query) {
    throw new Error('customerId, accessToken, and query are required');
  }

  const body = JSON.stringify({ query });
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": DEVELOPER_TOKEN,
    "Content-Type": "application/json",
  };

  // Add MCC header if loginCustomerId is provided or GADS_MANAGER_ID is set
  const mccId = loginCustomerId || MANAGER_ID;
  if (mccId) {
    // Ensure no dashes in MCC ID
    const cleanMccId = mccId.replace(/-/g, '');
    headers["login-customer-id"] = cleanMccId;
  }

  const response = await fetch(
    `https://googleads.googleapis.com/v21/customers/${customerId}/googleAds:searchStream`,
    {
      method: "POST",
      headers,
      body,
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    let errorDetails;
    try {
      errorDetails = JSON.parse(errText);
    } catch {
      errorDetails = errText;
    }
    throw new Error(`Google Ads API error (${response.status}): ${JSON.stringify(errorDetails)}`);
  }

  // Parse stream format (line-delimited JSON chunks)
  const text = await response.text();
  const lines = text.split("\n").filter(Boolean);
  
  const results = lines.flatMap(line => {
    try {
      const chunk = JSON.parse(line);
      return chunk.results || [];
    } catch (parseError) {
      // Skip invalid JSON lines (may be empty chunks)
      return [];
    }
  });

  return results;
}

/**
 * Validates and normalizes customer ID (removes dashes)
 * @param {string} customerId - Customer ID (with or without dashes)
 * @returns {string} Normalized customer ID (no dashes)
 */
function normalizeCustomerId(customerId) {
  if (!customerId || typeof customerId !== 'string') {
    throw new Error('Invalid customer ID');
  }
  return customerId.replace(/-/g, '');
}

module.exports = {
  getAccessTokenFromRefresh,
  executeGAQLQuery,
  normalizeCustomerId,
};
