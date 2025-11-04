// utils/google-ads-api.js
/**
 * Shared Google Ads API utilities
 * Centralizes OAuth token refresh and GAQL query execution
 * Includes automatic token caching to prevent 401 errors
 */

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

// API Version - single source of truth
const GOOGLE_ADS_API_VERSION = 'v22';

const CLIENT_ID = process.env.GADS_CLIENT_ID || process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.GADS_CLIENT_SECRET || process.env.CLIENT_SECRET;
const DEVELOPER_TOKEN = process.env.GADS_DEVELOPER_TOKEN || process.env.DEVELOPER_TOKEN;
const MANAGER_ID = process.env.GADS_MANAGER_ID || process.env.MANAGER_CUSTOMER_ID;

// In-memory token cache: Map<refreshToken, {token, expiry}>
const tokenCache = new Map();

/**
 * Retrieves a fresh access token, using cache if available and valid
 * @param {string} refreshToken - OAuth refresh token (optional, falls back to env var)
 * @returns {Promise<string>} Access token
 */
async function getAccessTokenFromRefresh(refreshToken = null) {
  // Use provided refresh_token or fall back to environment variable
  const token = refreshToken || process.env.GADS_REFRESH_TOKEN || process.env.REFRESH_TOKEN;
  
  if (!token) {
    throw new Error('Refresh token is required (provide via parameter or GADS_REFRESH_TOKEN/REFRESH_TOKEN env var)');
  }

  // Check cache first
  const now = Date.now();
  const cached = tokenCache.get(token);
  
  if (cached && now < cached.expiry) {
    console.log('✅ Using cached access token');
    return cached.token;
  }

  // Cache expired or missing, refresh token
  console.log('🔄 Refreshing access token...');
  
  const params = new URLSearchParams();
  params.append("client_id", CLIENT_ID);
  params.append("client_secret", CLIENT_SECRET);
  params.append("grant_type", "refresh_token");
  params.append("refresh_token", token);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: params,
  });

  const data = await response.json();
  
  if (!response.ok || !data.access_token) {
    console.error('❌ Failed to refresh access token:', data);
    throw new Error(`Failed to refresh token: ${JSON.stringify(data, null, 2)}`);
  }

  // Cache the new token (expires_in is in seconds, cache for 55 minutes)
  const expiresIn = data.expires_in || 3600; // Default to 1 hour if not provided
  const cacheExpiry = now + (expiresIn - 300) * 1000; // 5 minutes before expiry (55 min cache)
  
  tokenCache.set(token, {
    token: data.access_token,
    expiry: cacheExpiry,
  });

  console.log('✅ New access token generated and cached successfully');
  return data.access_token;
}

/**
 * Parses a single chunk from searchStream response
 * Handles both direct result objects and batch format (chunk.results)
 * @param {Object} chunk - Parsed JSON chunk from response line
 * @returns {Array} Array of result objects
 */
function parseSearchStreamChunk(chunk) {
  // Handle batch format: {"results": [{...}, {...}]}
  if (chunk.results && Array.isArray(chunk.results)) {
    return chunk.results;
  }

  // Normalize common resource keys to support both snake_case and camelCase
  if (chunk && typeof chunk === 'object') {
    if (!chunk.ad_group && chunk.adGroup) chunk.ad_group = chunk.adGroup;
    if (!chunk.ad_group_ad && chunk.adGroupAd) chunk.ad_group_ad = chunk.adGroupAd;
    if (!chunk.customer_client && chunk.customerClient) chunk.customer_client = chunk.customerClient;
  }

  // Handle direct result object
  if (chunk.campaign || chunk.ad_group || chunk.ad_group_ad || chunk.customer_client || chunk.metrics) {
    return [chunk];
  }

  // If chunk has no recognized structure, log warning and return empty
  console.warn('[DEBUG] Unexpected chunk format. Keys:', Object.keys(chunk));
  return [];
}

/**
 * Executes a GAQL query against Google Ads API with automatic token refresh on 401
 * @param {string} customerId - Google Ads customer ID (without dashes)
 * @param {string} accessToken - OAuth access token
 * @param {string} query - GAQL query string
 * @param {string} loginCustomerId - Optional MCC/Manager ID (for MCC token context)
 * @param {string} refreshToken - Optional refresh token for retry on 401
 * @returns {Promise<Array>} Array of result objects from API
 */
async function executeGAQLQuery(customerId, accessToken, query, loginCustomerId = null, refreshToken = null) {
  if (!customerId || !accessToken || !query) {
    throw new Error('customerId, accessToken, and query are required');
  }

  // Normalize customer ID (remove dashes)
  const normalizedCustomerId = customerId.replace(/-/g, '');
  const body = JSON.stringify({ query });
  
  // Prepare headers with exact case sensitivity
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'developer-token': DEVELOPER_TOKEN,
    'Content-Type': 'application/json',
  };

  // Add MCC header if loginCustomerId is provided or GADS_MANAGER_ID is set
  const mccId = loginCustomerId || MANAGER_ID;
  if (mccId) {
    // Ensure no dashes in MCC ID and store as number (Google's preferred format)
    const cleanMccId = String(mccId).replace(/[^0-9]/g, '');
    headers['login-customer-id'] = cleanMccId;
    console.log(`[DEBUG] Added login-customer-id header: ${cleanMccId}`);
  } else {
    console.warn('[WARNING] No MCC header - loginCustomerId and MANAGER_ID both missing');
  }

  // Use /search endpoint explicitly (temporary MCC reliability fix)
  const effectiveUrl = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${normalizedCustomerId}/googleAds:search`;
  console.log('[DEBUG] Using explicit /search endpoint (temporary MCC fix)');
  console.log(`[DEBUG] Making request to: ${effectiveUrl}`);
  
  const requestOptions = {
    method: 'POST',
    headers,
    body,
  };

  // Log request details for debugging
  console.log('[DEBUG] Request headers:', JSON.stringify({
    ...headers,
    'Authorization': 'Bearer [REDACTED]',
    'developer-token': headers['developer-token'] ? '[REDACTED]' : 'MISSING',
  }, null, 2));

  // Verify presence of login-customer-id header
  if (!headers['login-customer-id']) {
    console.error('[ERROR] login-customer-id header missing before request.');
  } else {
    console.log('[DEBUG] login-customer-id header verified:', headers['login-customer-id']);
  }

  let response = await fetch(effectiveUrl, requestOptions);
  let shouldTrySearchFallback = false;
  // Read once for normal path
  if (response.status === 200) {
    const text = await response.text();
    // Cache parsed text for normal path to avoid double-reading the stream
    response.parsedText = text;
  }

  // Handle 401 Unauthorized - token expired, clear cache and retry once
  if ((response.status === 401 || shouldTrySearchFallback) && refreshToken) {
    if (response.status === 401) {
      console.warn('⚠️ Received 401, clearing token cache and retrying...');
      tokenCache.delete(refreshToken); // Clear cache for this refresh token
      
      // Get a fresh token
      const newAccessToken = await getAccessTokenFromRefresh(refreshToken);
      
      // Update authorization header with new token
      headers.Authorization = `Bearer ${newAccessToken}`;
    } else {
      console.log('🔄 Attempting fallback to /search endpoint');
    }
    
    // Retry using /search endpoint as well
    let retryResponse = await fetch(
      `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${normalizedCustomerId}/googleAds:search`,
      { method: 'POST', headers, body }
    );

    if (!retryResponse.ok) {
      const errText = await retryResponse.text();
      let errorDetails;
      try {
        errorDetails = JSON.parse(errText);
      } catch {
        errorDetails = errText;
      }
      throw new Error(`Google Ads API error (${retryResponse.status}) after token refresh: ${JSON.stringify(errorDetails)}`);
    }

    // Handle /search response (single JSON object with results array)
    let results = [];
    const responseText = await retryResponse.text();
    try {
      const responseData = JSON.parse(responseText);
      console.log(`[DEBUG] Retry /search response keys:`, Object.keys(responseData));
      if (Array.isArray(responseData)) {
        results = responseData.flatMap(parseSearchStreamChunk);
      } else if (responseData.results && Array.isArray(responseData.results)) {
        results = responseData.results.flatMap(parseSearchStreamChunk);
      } else {
        results = parseSearchStreamChunk(responseData);
      }
    } catch (error) {
      console.error('[ERROR] Failed to parse retry /search response:', error);
      throw new Error(`Failed to parse retry /search response: ${error.message}`);
    }
    console.log(`[DEBUG] Total results parsed from retry response: ${results.length}`);
    return results;
  }

  // ✅ Normal (non-fallback) execution path
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

  // Parse /search JSON response
  const text = response.parsedText ?? await response.text();
  console.log(`[DEBUG] Response status: ${response.status}`);
  console.log(`[DEBUG] Response text length: ${text.length}`);

  let results = [];
  try {
    const data = JSON.parse(text);
    console.log('[DEBUG] /search response top-level keys:', Array.isArray(data) ? ['<array>'] : Object.keys(data));
    if (Array.isArray(data)) {
      results = data.flatMap(parseSearchStreamChunk);
    } else if (data.results && Array.isArray(data.results)) {
      results = data.results.flatMap(parseSearchStreamChunk);
    } else {
      results = parseSearchStreamChunk(data);
    }
  } catch (e) {
    console.error('[ERROR] Failed to parse /search response JSON:', e.message);
    console.error('[ERROR] Raw body (first 500 chars):', text.substring(0, 500));
    throw new Error(`Failed to parse /search response JSON: ${e.message}`);
  }

  console.log(`[DEBUG] Total results parsed: ${results.length}`);
  return results; // ✅ final return
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
