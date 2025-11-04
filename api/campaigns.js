// api/campaigns.js
/**
 * Campaign Discovery Endpoint
 * Retrieves all campaign metadata for a given customer_id
 */

const { logAndRespond, extractGoogleAdsError } = require('../utils/error-logger');
const { getAccessTokenFromRefresh, executeGAQLQuery, normalizeCustomerId } = require('../utils/google-ads-api');

module.exports = async (req, res) => {
  const context = 'GET /api/campaigns';
  
  try {
    const { customer_id, refresh_token, login_customer_id } = req.query;
    
    if (!customer_id || !refresh_token) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters',
        message: 'Both customer_id and refresh_token are required',
      });
    }

    // Normalize customer ID (remove dashes)
    const normalizedCustomerId = normalizeCustomerId(customer_id);
    const mccId = login_customer_id ? normalizeCustomerId(login_customer_id) : null;

    // Root Cause 3: Log MCC header usage
    console.log(`[DEBUG] /api/campaigns - customer_id: ${normalizedCustomerId}`);
    console.log(`[DEBUG] /api/campaigns - login_customer_id provided: ${login_customer_id || 'none'}`);
    console.log(`[DEBUG] /api/campaigns - mccId resolved: ${mccId || 'none (will use env var if set)'}`);

    // Get access token
    const accessToken = await getAccessTokenFromRefresh(refresh_token);

    // GAQL query to fetch all campaigns
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.serving_status,
        campaign.advertising_channel_type,
        campaign.start_date,
        campaign.end_date,
        campaign.bidding_strategy_type,
        campaign.advertising_channel_sub_type
      FROM campaign
      WHERE campaign.status IN ('ENABLED', 'PAUSED', 'REMOVED')
      ORDER BY campaign.id
    `;

    // Execute query
    const results = await executeGAQLQuery(normalizedCustomerId, accessToken, query, mccId, refresh_token);

    // Map results to response format
    const campaigns = results.map(r => ({
      id: r.campaign?.id?.toString() || null,
      name: r.campaign?.name || 'Unnamed Campaign',
      status: r.campaign?.status || 'UNKNOWN',
      serving_status: r.campaign?.serving_status || 'UNKNOWN',
      advertising_channel_type: r.campaign?.advertising_channel_type || 'UNKNOWN',
      advertising_channel_sub_type: r.campaign?.advertising_channel_sub_type || null,
      start_date: r.campaign?.start_date || null,
      end_date: r.campaign?.end_date || null,
      bidding_strategy_type: r.campaign?.bidding_strategy_type || null,
    }));

    return res.status(200).json({
      success: true,
      count: campaigns.length,
      campaigns,
    });

  } catch (err) {
    // Check if it's a known Google Ads API error
    const googleAdsError = extractGoogleAdsError(err);
    if (googleAdsError) {
      const errorResponse = logAndRespond(err, context, { googleAdsErrorType: googleAdsError.type });
      return res.status(400).json(errorResponse);
    }

    // Generic error handling
    const errorResponse = logAndRespond(err, context);
    return res.status(500).json(errorResponse);
  }
};
