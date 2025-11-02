// api/adgroups.js
/**
 * Ad Group / Ad Data Retrieval Endpoint
 * Retrieves ad groups and ads nested under campaigns
 */

const { logAndRespond, extractGoogleAdsError } = require('../utils/error-logger');
const { getAccessTokenFromRefresh, executeGAQLQuery, normalizeCustomerId } = require('../utils/google-ads-api');

module.exports = async (req, res) => {
  const context = 'GET /api/adgroups';
  
  try {
    const { customer_id, refresh_token, campaign_id, login_customer_id } = req.query;
    
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

    // Build GAQL query with optional campaign filter
    let query = `
      SELECT
        ad_group.id,
        ad_group.name,
        ad_group.status,
        ad_group.type,
        ad_group_ad.ad.id,
        ad_group_ad.ad.name,
        ad_group_ad.ad.type,
        ad_group_ad.status,
        ad_group_ad.ad.responsive_search_ad.headlines,
        ad_group_ad.ad.responsive_search_ad.descriptions,
        ad_group_ad.ad.responsive_search_ad.path1,
        ad_group_ad.ad.responsive_search_ad.path2,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr,
        metrics.cost_micros
      FROM ad_group_ad
    `;

    // Add campaign filter if provided
    if (campaign_id) {
      const normalizedCampaignId = campaign_id.replace(/-/g, '');
      query += ` WHERE campaign.id = ${normalizedCampaignId}`;
    } else {
      // If no campaign filter, we'll need to group by campaign
      query += ` ORDER BY campaign.id, ad_group.id, ad_group_ad.ad.id`;
    }

    // Execute query
    const results = await executeGAQLQuery(normalizedCustomerId, accessToken, query, mccId, refresh_token);

    // Group results by ad group
    const adGroupsMap = new Map();

    results.forEach(r => {
      const adGroupId = r.ad_group?.id?.toString();
      const adId = r.ad_group_ad?.ad?.id?.toString();
      
      if (!adGroupId) return; // Skip if no ad group ID

      if (!adGroupsMap.has(adGroupId)) {
        adGroupsMap.set(adGroupId, {
          id: adGroupId,
          name: r.ad_group?.name || 'Unnamed Ad Group',
          status: r.ad_group?.status || 'UNKNOWN',
          type: r.ad_group?.type || 'UNKNOWN',
          ads: [],
        });
      }

      const adGroup = adGroupsMap.get(adGroupId);

      // Extract ad data
      if (adId && !adGroup.ads.find(ad => ad.id === adId)) {
        const ad = {
          id: adId,
          name: r.ad_group_ad?.ad?.name || 'Unnamed Ad',
          type: r.ad_group_ad?.ad?.type || 'UNKNOWN',
          status: r.ad_group_ad?.status || 'UNKNOWN',
        };

        // Extract responsive search ad details if available
        if (r.ad_group_ad?.ad?.responsive_search_ad) {
          const rsa = r.ad_group_ad.ad.responsive_search_ad;
          ad.headlines = rsa.headlines?.map(h => h.text) || [];
          ad.descriptions = rsa.descriptions?.map(d => d.text) || [];
          ad.path1 = rsa.path1 || null;
          ad.path2 = rsa.path2 || null;
        }

        // Add metrics (always include, even if 0)
        ad.metrics = r.metrics ? {
          impressions: parseInt(r.metrics.impressions || 0),
          clicks: parseInt(r.metrics.clicks || 0),
          ctr: parseFloat(r.metrics.ctr || 0),
          cost_micros: parseInt(r.metrics.cost_micros || 0),
          cost: parseFloat(r.metrics.cost_micros || 0) / 1_000_000, // Convert micros to currency
        } : {
          impressions: 0,
          clicks: 0,
          ctr: 0,
          cost_micros: 0,
          cost: 0,
        };

        adGroup.ads.push(ad);
      }
    });

    // Convert map to array
    const adGroups = Array.from(adGroupsMap.values());

    // Group by campaign if campaign_id was not provided
    let response;
    if (campaign_id) {
      response = {
        success: true,
        campaign_id: campaign_id.replace(/-/g, ''),
        ad_groups: adGroups,
        count: adGroups.length,
      };
    } else {
      // Group by campaign
      const campaignsMap = new Map();
      
      // We need to fetch campaign IDs for ad groups
      // For now, return all ad groups (can be enhanced to group by campaign)
      response = {
        success: true,
        ad_groups: adGroups,
        count: adGroups.length,
      };
    }

    return res.status(200).json(response);

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
