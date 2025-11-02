// api/ads-metrics.js
/**
 * Campaign Metrics Retrieval Endpoint
 * Retrieves campaign performance metrics from Google Ads
 * Supports dynamic date ranges and field selection
 */

const { logAndRespond, extractGoogleAdsError } = require('../utils/error-logger');
const { getAccessTokenFromRefresh, executeGAQLQuery, normalizeCustomerId } = require('../utils/google-ads-api');

module.exports = async (req, res) => {
  const context = 'GET /api/ads-metrics';
  
  try {
    const { 
      customer_id, 
      refresh_token, 
      login_customer_id,
      date_range = 'LAST_30_DAYS',  // LAST_7_DAYS, LAST_30_DAYS, LAST_90_DAYS, etc.
      include_all_campaigns = 'true' // If true, includes paused campaigns with 0 metrics
    } = req.query;
    
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

    // Get access token
    const accessToken = await getAccessTokenFromRefresh(refresh_token);

    // Build metrics query with dynamic date range
    const metricsQuery = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.serving_status,
        campaign.advertising_channel_type,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr,
        metrics.average_cpc,
        metrics.conversions,
        metrics.cost_micros,
        metrics.conversions_value,
        metrics.average_cpv,
        segments.date
      FROM campaign
      WHERE segments.date DURING ${date_range}
        AND campaign.status IN ('ENABLED', 'PAUSED', 'REMOVED')
      ORDER BY metrics.impressions DESC
    `;

    // Execute metrics query
    let metricsResults = [];
    let metricsMap = {};
    
    try {
      metricsResults = await executeGAQLQuery(normalizedCustomerId, accessToken, metricsQuery, mccId, refresh_token);
      
      // Build metrics map by campaign ID
      metricsResults.forEach(r => {
        const campaignId = r.campaign?.id?.toString();
        if (campaignId) {
          // Aggregate metrics (if multiple date segments)
          if (!metricsMap[campaignId]) {
            metricsMap[campaignId] = {
              impressions: 0,
              clicks: 0,
              ctr: 0,
              average_cpc: 0,
              conversions: 0,
              cost_micros: 0,
              conversions_value: 0,
              average_cpv: 0,
            };
          }
          
          metricsMap[campaignId].impressions += parseInt(r.metrics?.impressions || 0);
          metricsMap[campaignId].clicks += parseInt(r.metrics?.clicks || 0);
          metricsMap[campaignId].conversions += parseFloat(r.metrics?.conversions || 0);
          metricsMap[campaignId].cost_micros += parseInt(r.metrics?.cost_micros || 0);
          metricsMap[campaignId].conversions_value += parseFloat(r.metrics?.conversions_value || 0);
        }
      });

      // Recalculate aggregate metrics
      Object.keys(metricsMap).forEach(campaignId => {
        const metrics = metricsMap[campaignId];
        metrics.ctr = metrics.impressions > 0 ? (metrics.clicks / metrics.impressions) : 0;
        metrics.average_cpc = metrics.clicks > 0 ? (metrics.cost_micros / metrics.clicks / 1_000_000) : 0;
        metrics.average_cpv = metrics.clicks > 0 ? (metrics.conversions_value / metrics.clicks) : 0;
        metrics.cost = metrics.cost_micros / 1_000_000; // Convert micros to currency
      });

    } catch (metricsError) {
      // If metrics query fails (e.g., account has no activity), log but continue
      console.warn(`[${context}] Metrics query failed (may be expected for paused accounts):`, metricsError.message);
    }

    // If include_all_campaigns is true, fetch all campaigns and merge with metrics
    let campaigns = [];
    if (include_all_campaigns === 'true') {
      const campaignsQuery = `
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.serving_status,
          campaign.advertising_channel_type
        FROM campaign
        WHERE campaign.status IN ('ENABLED', 'PAUSED', 'REMOVED')
        ORDER BY campaign.id
      `;

      try {
        const campaignResults = await executeGAQLQuery(normalizedCustomerId, accessToken, campaignsQuery, mccId, refresh_token);
        
        // Merge campaigns with metrics
        campaigns = campaignResults.map(r => {
          const campaignId = r.campaign?.id?.toString();
          const metrics = metricsMap[campaignId] || {
            impressions: 0,
            clicks: 0,
            ctr: 0,
            average_cpc: 0,
            conversions: 0,
            cost_micros: 0,
            cost: 0,
            conversions_value: 0,
            average_cpv: 0,
          };

          return {
            id: campaignId,
            name: r.campaign?.name || 'Unnamed Campaign',
            status: r.campaign?.status || 'UNKNOWN',
            serving_status: r.campaign?.serving_status || 'UNKNOWN',
            advertising_channel_type: r.campaign?.advertising_channel_type || 'UNKNOWN',
            ...metrics,
          };
        });
      } catch (campaignError) {
        // If campaign query fails, fall back to metrics-only results
        campaigns = metricsResults.map(r => ({
          id: r.campaign?.id?.toString(),
          name: r.campaign?.name || 'Unnamed Campaign',
          status: r.campaign?.status || 'UNKNOWN',
          serving_status: r.campaign?.serving_status || 'UNKNOWN',
          advertising_channel_type: r.campaign?.advertising_channel_type || 'UNKNOWN',
          ...(metricsMap[r.campaign?.id?.toString()] || {
            impressions: 0,
            clicks: 0,
            ctr: 0,
            average_cpc: 0,
            conversions: 0,
            cost_micros: 0,
            cost: 0,
            conversions_value: 0,
            average_cpv: 0,
          }),
        }));
      }
    } else {
      // Return only campaigns with metrics data
      campaigns = metricsResults.map(r => ({
        id: r.campaign?.id?.toString(),
        name: r.campaign?.name || 'Unnamed Campaign',
        status: r.campaign?.status || 'UNKNOWN',
        serving_status: r.campaign?.serving_status || 'UNKNOWN',
        advertising_channel_type: r.campaign?.advertising_channel_type || 'UNKNOWN',
        ...(metricsMap[r.campaign?.id?.toString()] || {
          impressions: 0,
          clicks: 0,
          ctr: 0,
          average_cpc: 0,
          conversions: 0,
          cost_micros: 0,
          cost: 0,
          conversions_value: 0,
          average_cpv: 0,
        }),
      }));
    }

    return res.status(200).json({
      success: true,
      count: campaigns.length,
      date_range,
      campaigns: campaigns.slice(0, 50),
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
