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
    console.log(`[DEBUG] /api/adgroups - customer_id: ${normalizedCustomerId}`);
    console.log(`[DEBUG] /api/adgroups - login_customer_id provided: ${login_customer_id || 'none'}`);
    console.log(`[DEBUG] /api/adgroups - mccId resolved: ${mccId || 'none (will use env var if set)'}`);

    // Get access token
    const accessToken = await getAccessTokenFromRefresh(refresh_token);

    // Build ad_group_ad GAQL (for Search/DSA/YouTube standard)
    let adGroupAdQuery = `
    SELECT
  campaign.id,
  campaign.name,
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
ORDER BY campaign.id, ad_group.id, ad_group_ad.ad.id
    `;

    if (campaign_id) {
      const normalizedCampaignId = campaign_id.replace(/-/g, '');
      adGroupAdQuery += ` WHERE campaign.id = ${normalizedCampaignId}`;
    } else {
      adGroupAdQuery += ` ORDER BY campaign.id, ad_group.id, ad_group_ad.ad.id`;
    }

    // Execute primary query (ad_group_ad)
    let results = await executeGAQLQuery(normalizedCustomerId, accessToken, adGroupAdQuery, mccId, refresh_token);
    console.log(`[DEBUG] /api/adgroups - using ad_group_ad query`);
    console.log(`[DEBUG] /api/adgroups - raw results count (ad_group_ad): ${results.length}`);

    // If no ad_group_ad rows, try Performance Max / Demand Gen via asset_group
    let usedAssetGroupFlow = false;
    if (results.length === 0) {
      console.log('[DEBUG] /api/adgroups - no rows from ad_group_ad. Trying asset_group (PMax/Demand Gen/YouTube).');

      // First, fetch asset groups
      let assetGroupQuery = `
        SELECT
          asset_group.id,
          asset_group.name,
          asset_group.status,
          campaign.id
        FROM asset_group
      `;
      if (campaign_id) {
        const normalizedCampaignId = campaign_id.replace(/-/g, '');
        assetGroupQuery += ` WHERE campaign.id = ${normalizedCampaignId}`;
      } else {
        assetGroupQuery += ` ORDER BY campaign.id, asset_group.id`;
      }

      let assetGroups = await executeGAQLQuery(normalizedCustomerId, accessToken, assetGroupQuery, mccId, refresh_token);
      console.log(`[DEBUG] /api/adgroups - using asset_group query, group count: ${assetGroups.length}`);

      if (assetGroups.length > 0) {
        usedAssetGroupFlow = true;

        // Then fetch assets for those groups (headlines, descriptions, images, videos)
        let assetGroupAssetsQuery = `
          SELECT
            asset_group.id,
            asset_group_asset.field_type,
            asset_group_asset.status,
            asset.text_asset.text,
            asset.image_asset.full_size.url,
            asset.youtube_video_asset.youtube_video_id
          FROM asset_group_asset
        `;
        if (campaign_id) {
          const normalizedCampaignId = campaign_id.replace(/-/g, '');
          assetGroupAssetsQuery += ` WHERE campaign.id = ${normalizedCampaignId}`;
        } else {
          assetGroupAssetsQuery += ` ORDER BY asset_group.id`;
        }

        let assetItems = [];
        try {
          assetItems = await executeGAQLQuery(normalizedCustomerId, accessToken, assetGroupAssetsQuery, mccId, refresh_token);
        } catch (agErr) {
          console.warn('[DEBUG] /api/adgroups - asset_group_asset query failed:', agErr.message);
        }

        // Map into results compatible shape (simulate ad objects from assets)
        const agMap = new Map();
        assetGroups.forEach(g => {
          const gid = g.asset_group?.id?.toString();
          if (!gid) return;
          agMap.set(gid, {
            id: gid,
            name: g.asset_group?.name || 'Unnamed Asset Group',
            status: g.asset_group?.status || 'UNKNOWN',
            ads: [{
              id: `${gid}-assets`,
              name: 'Asset Group Bundle',
              type: 'ASSET_GROUP',
              status: 'ENABLED',
              assets: {
                headlines: [],
                descriptions: [],
                images: [],
                videos: [],
              },
            }],
          });
        });

        assetItems.forEach(a => {
          const gid = a.asset_group?.id?.toString();
          if (!gid || !agMap.has(gid)) return;
          const group = agMap.get(gid);
          const bundle = group.ads[0];

          const ft = a.asset_group_asset?.field_type;
          const text = a.asset?.text_asset?.text || null;
          const imageUrl = a.asset?.image_asset?.full_size?.url || null;
          const videoId = a.asset?.youtube_video_asset?.youtube_video_id || null;

          if (text && (ft === 'HEADLINE' || ft === 'LONG_HEADLINE')) bundle.assets.headlines.push(text);
          if (text && ft === 'DESCRIPTION') bundle.assets.descriptions.push(text);
          if (imageUrl && (ft === 'MARKETING_IMAGE' || ft === 'LOGO')) bundle.assets.images.push(imageUrl);
          if (videoId && ft === 'YOUTUBE_VIDEO') bundle.assets.videos.push(videoId);
        });

        // Convert to results compatible shape (ad_group-like)
        results = Array.from(agMap.values()).map(g => ({
          ad_group: { id: g.id, name: g.name, status: g.status, type: 'ASSET_GROUP' },
          ad_group_ad: { ad: { id: `${g.id}-assets`, name: 'Asset Group Bundle', type: 'ASSET_GROUP' } },
          // no metrics here; will be filled with zeros below
        }));
      }
    }

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
          type: r.ad_group?.type || (usedAssetGroupFlow ? 'ASSET_GROUP' : 'UNKNOWN'),
          ads: [],
        });
      }

      const adGroup = adGroupsMap.get(adGroupId);

      // Extract ad data
      if (adId && !adGroup.ads.find(ad => ad.id === adId)) {
        const ad = {
          id: adId,
          name: r.ad_group_ad?.ad?.name || 'Unnamed Ad',
          type: r.ad_group_ad?.ad?.type || (usedAssetGroupFlow ? 'ASSET_GROUP' : 'UNKNOWN'),
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

    console.log(`[DEBUG] /api/adgroups - final ad_groups count: ${adGroups.length}`);
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
