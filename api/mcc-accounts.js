// api/mcc-accounts.js
/**
 * MCC / Account List Endpoint
 * Lists all sub-accounts accessible under a given MCC
 */

const { logAndRespond, extractGoogleAdsError } = require('../utils/error-logger');
const { getAccessTokenFromRefresh, executeGAQLQuery, normalizeCustomerId } = require('../utils/google-ads-api');

module.exports = async (req, res) => {
  const context = 'GET /api/mcc-accounts';
  
  try {
    const { refresh_token, manager_customer_id } = req.query;
    
    if (!refresh_token) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters',
        message: 'refresh_token is required',
      });
    }

    // Get access token
    const accessToken = await getAccessTokenFromRefresh(refresh_token);

    // Use manager_customer_id if provided, otherwise use GADS_MANAGER_ID from env
    let mccId = manager_customer_id;
    if (!mccId) {
      mccId = process.env.GADS_MANAGER_ID;
    }

    if (!mccId) {
      return res.status(400).json({
        success: false,
        error: 'Missing MCC ID',
        message: 'Either provide manager_customer_id in query or set GADS_MANAGER_ID environment variable',
      });
    }

    // Normalize MCC ID (remove dashes)
    const normalizedMccId = normalizeCustomerId(mccId);

    // GAQL query to fetch client accounts
    const query = `
      SELECT
        customer_client.id,
        customer_client.descriptive_name,
        customer_client.currency_code,
        customer_client.time_zone,
        customer_client.status,
        customer_client.manager,
        customer_client.test_account,
        customer_client.id
      FROM customer_client
      WHERE customer_client.manager = false
      ORDER BY customer_client.descriptive_name
    `;

    // Execute query (query the MCC account itself)
    const results = await executeGAQLQuery(normalizedMccId, accessToken, query, normalizedMccId, refresh_token);

    // Map results to response format
    const accounts = results.map(r => ({
      id: r.customer_client?.id?.toString() || null,
      name: r.customer_client?.descriptive_name || 'Unnamed Account',
      currency_code: r.customer_client?.currency_code || null,
      time_zone: r.customer_client?.time_zone || null,
      status: r.customer_client?.status || 'UNKNOWN',
      is_manager: r.customer_client?.manager || false,
      is_test_account: r.customer_client?.test_account || false,
    }));

    return res.status(200).json({
      success: true,
      manager_account_id: normalizedMccId,
      count: accounts.length,
      accounts,
    });

  } catch (err) {
    // Check if it's a known Google Ads API error
    const googleAdsError = extractGoogleAdsError(err);
    if (googleAdsError) {
      const errorResponse = logAndRespond(err, context, { googleAdsErrorType: googleAdsError.type });
      
      // Handle specific error: REQUESTED_METRICS_FOR_MANAGER
      if (googleAdsError.type === 'REQUESTED_METRICS_FOR_MANAGER') {
        errorResponse.message = 'Cannot query metrics for manager accounts. Query individual client accounts instead.';
      }
      
      return res.status(400).json(errorResponse);
    }

    // Generic error handling
    const errorResponse = logAndRespond(err, context);
    return res.status(500).json(errorResponse);
  }
};
