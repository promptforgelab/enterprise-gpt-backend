// utils/error-logger.js
/**
 * Centralized error logging and response formatting utility
 * Ensures consistent error handling across all endpoints
 */

/**
 * Masks sensitive tokens in logs (shows first few chars + last few chars)
 * @param {string} token - Token to mask
 * @returns {string} Masked token
 */
function maskToken(token) {
  if (!token || typeof token !== 'string' || token.length < 10) {
    return '***';
  }
  return `${token.substring(0, 8)}...${token.substring(token.length - 6)}`;
}

/**
 * Logs error with context and returns standardized error response
 * @param {Error|Object} error - Error object or error-like object
 * @param {string} context - Context where error occurred (e.g., "GET /api/campaigns")
 * @param {Object} additionalData - Additional data to include in logs
 * @returns {Object} Standardized error response object
 */
function logAndRespond(error, context = '', additionalData = {}) {
  const errorMessage = error?.message || error?.error?.message || 'Unknown error';
  const errorDetails = error?.details || error?.error?.details || error?.body || error;
  const errorStack = error?.stack || null;

  // Mask any tokens in error details
  let sanitizedDetails = errorDetails;
  if (typeof sanitizedDetails === 'string') {
    // Try to mask tokens in string details
    sanitizedDetails = sanitizedDetails.replace(/refresh[_-]?token[=:]\s*['"]?([^'"\s]+)/gi, (match, token) => {
      return match.replace(token, maskToken(token));
    });
  } else if (typeof sanitizedDetails === 'object' && sanitizedDetails !== null) {
    sanitizedDetails = JSON.parse(JSON.stringify(sanitizedDetails));
    // Recursively mask tokens in objects
    const maskTokensInObject = (obj) => {
      for (const key in obj) {
        if (key.toLowerCase().includes('token') && typeof obj[key] === 'string') {
          obj[key] = maskToken(obj[key]);
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          maskTokensInObject(obj[key]);
        }
      }
    };
    maskTokensInObject(sanitizedDetails);
  }

  // Log error with full context
  console.error(`[ERROR][${context}]`, {
    message: errorMessage,
    details: sanitizedDetails,
    stack: errorStack,
    ...additionalData,
    timestamp: new Date().toISOString(),
  });

  // Return standardized error response
  return {
    success: false,
    context: context || 'Unknown',
    message: errorMessage,
    details: sanitizedDetails,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Checks if error is a known Google Ads API error and extracts error code
 * @param {Error|Object} error - Error object
 * @returns {Object|null} Extracted error code and type, or null
 */
function extractGoogleAdsError(error) {
  const errorString = JSON.stringify(error).toLowerCase();
  const errorMessage = error?.message?.toLowerCase() || '';
  
  // Known Google Ads API error patterns
  const errorPatterns = {
    REQUESTED_METRICS_FOR_MANAGER: /metrics.*cannot.*requested.*manager/i,
    AUTHENTICATION_ERROR: /authentication|unauthorized|invalid.*token/i,
    PERMISSION_DENIED: /permission.*denied|forbidden/i,
    INVALID_CUSTOMER_ID: /invalid.*customer|customer.*not.*found/i,
    QUERY_ERROR: /query.*error|invalid.*query/i,
  };

  for (const [errorType, pattern] of Object.entries(errorPatterns)) {
    if (pattern.test(errorString) || pattern.test(errorMessage)) {
      return {
        type: errorType,
        message: error?.message || error?.error?.message || 'Google Ads API error',
      };
    }
  }

  return null;
}

module.exports = {
  logAndRespond,
  maskToken,
  extractGoogleAdsError,
};
