// utils/google-ads-api.js
/**
 * Shared Google Ads API utilities
 * Centralizes OAuth token refresh and GAQL query execution
 * Includes automatic token caching to prevent 401 errors
 */

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

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
  
  // Handle direct result object: {"campaign": {...}, "metrics": {...}}
  // Check for common Google Ads API resource types
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
    console.log(`[DEBUG] Added login-customer-id header: ${cleanMccId}`);
  } else {
    console.warn('[WARNING] No MCC header - loginCustomerId and MANAGER_ID both missing. This may cause authorization issues for MCC-managed accounts.');
  }

  const response = await fetch(
    `https://googleads.googleapis.com/v21/customers/${customerId}/googleAds:searchStream`,
    {
      method: "POST",
      headers,
      body,
    }
  );

  // Handle 401 Unauthorized - token expired, clear cache and retry once
  if (response.status === 401 && refreshToken) {
    console.warn('⚠️ Received 401, clearing token cache and retrying...');
    tokenCache.delete(refreshToken); // Clear cache for this refresh token
    
    // Get a fresh token
    const newAccessToken = await getAccessTokenFromRefresh(refreshToken);
    
    // Retry the request with new token
    headers.Authorization = `Bearer ${newAccessToken}`;
    
    const retryResponse = await fetch(
      `https://googleads.googleapis.com/v21/customers/${customerId}/googleAds:searchStream`,
      {
        method: "POST",
        headers,
        body,
      }
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

    // Parse stream format (line-delimited JSON chunks)
    const text = await retryResponse.text();
    
    // Root Cause 4: Response structure validation
    console.log(`[DEBUG] Retry response status: ${retryResponse.status}`);
    console.log(`[DEBUG] Retry response text length: ${text.length}`);
    
    const lines = text.split("\n").filter(Boolean);
    console.log(`[DEBUG] Number of lines in retry response: ${lines.length}`);
    
    if (lines.length > 0) {
      console.log(`[DEBUG] Sample first line (first 300 chars): ${lines[0].substring(0, 300)}`);
    }
    
    const results = lines.flatMap((line, index) => {
      try {
        const chunk = JSON.parse(line);
        const parsed = parseSearchStreamChunk(chunk);
        
        if (parsed.length === 0 && index === 0) {
          // Log first chunk structure for debugging
          console.log(`[DEBUG] First chunk structure:`, JSON.stringify(chunk).substring(0, 500));
        }
        
        return parsed;
      } catch (parseError) {
        // Root Cause 2: Better error logging instead of silent suppression
        console.error(`[ERROR] Failed to parse line ${index + 1}:`, parseError.message);
        console.error(`[ERROR] Problematic line (first 200 chars):`, line.substring(0, 200));
        return [];
      }
    });

    console.log(`[DEBUG] Total results parsed from retry response: ${results.length}`);
    return results;
  }

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
  
  // Root Cause 4: Response structure validation
  console.log(`[DEBUG] Response status: ${response.status}`);
  console.log(`[DEBUG] Response text length: ${text.length}`);
  
  const lines = text.split("\n").filter(Boolean);
  console.log(`[DEBUG] Number of lines in response: ${lines.length}`);
  
  if (lines.length > 0) {
    console.log(`[DEBUG] Sample first line (first 300 chars): ${lines[0].substring(0, 300)}`);
  } else {
    console.warn(`[WARNING] Response has no lines after splitting by newline`);
    console.warn(`[WARNING] Raw response (first 500 chars):`, text.substring(0, 500));
  }
  
  const results = lines.flatMap((line, index) => {
    try {
      const chunk = JSON.parse(line);
      const parsed = parseSearchStreamChunk(chunk);
      
      if (parsed.length === 0 && index === 0) {
        // Log first chunk structure for debugging
        console.log(`[DEBUG] First chunk structure:`, JSON.stringify(chunk).substring(0, 500));
      }
      
      return parsed;
    } catch (parseError) {
      // Root Cause 2: Better error logging instead of silent suppression
      console.error(`[ERROR] Failed to parse line ${index + 1}:`, parseError.message);
      console.error(`[ERROR] Problematic line (first 200 chars):`, line.substring(0, 200));
      return [];
    }
  });

  console.log(`[DEBUG] Total results parsed: ${results.length}`);
  if (results.length === 0 && lines.length > 0) {
    console.warn(`[WARNING] No results parsed despite ${lines.length} lines. This may indicate a parsing format issue.`);
    // Log all chunks for debugging
    lines.forEach((line, idx) => {
      try {
        const chunk = JSON.parse(line);
        console.log(`[DEBUG] Line ${idx + 1} chunk keys:`, Object.keys(chunk));
      } catch (e) {
        console.log(`[DEBUG] Line ${idx + 1} is not valid JSON`);
      }
    });
  }

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
