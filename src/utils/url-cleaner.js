/**
 * URL Cleaner Utility
 * Strips tracking and affiliate parameters from URLs
 */

/**
 * Tracking parameters to remove from URLs
 * Organized by category for maintainability
 */
export const TRACKING_PARAMS = [
  // UTM tracking parameters
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'utm_cid',

  // Facebook tracking
  'fbclid',
  'fb_action_ids',
  'fb_action_types',
  'fb_ref',
  'fb_source',

  // Google tracking
  'gclid',
  'gclsrc',
  'dclid',
  'gbraid',
  'wbraid',
  'gad_source',

  // Amazon affiliate/tracking
  'tag',
  'linkCode',
  'linkId',
  'ref_',
  'ref',
  'camp',
  'creative',
  'ascsubtag',
  'pd_rd_w',
  'pd_rd_r',
  'pf_rd_p',
  'pf_rd_r',
  'pf_rd_s',
  'pf_rd_t',
  'pf_rd_i',
  'pd_rd_i',
  'pd_rd_wg',
  'content-id',
  'psc',
  'smid',
  'spIA',
  'sp_csd',
  'qid',

  // Social/Marketing platforms
  'mc_cid',
  'mc_eid',
  'yclid',
  '_openstat',
  'twclid',
  'msclkid',
  'igshid',
  's_kwcid',
  'si',
  'srsltid',

  // Analytics platforms
  '_ga',
  '_gl',
  '_hsenc',
  '_hsmi',
  '__hstc',
  '__hsfp',
  '__hssc',
  'hsCtaTracking',
  'vero_id',
  'mkt_tok',

  // Miscellaneous tracking
  'oly_anon_id',
  'oly_enc_id',
  'otc',
  'source',
  'click_id',
  'trk',
  'spm',
  'scm',

  // YouTube specific tracking (but NOT content params like v, t, list, index)
  'feature',
  'pp'
];

/**
 * Check if URL search params contain any parameters
 * @private
 * @param {URLSearchParams} params - The search params to check
 * @returns {boolean} - True if params are present
 */
function hasAnyParams(params) {
  for (const _key of params.keys()) {
    return true;
  }
  return false;
}

/**
 * Remove tracking parameters from URL search params
 * @private
 * @param {URLSearchParams} params - The search params to modify
 * @returns {boolean} - True if any parameters were removed
 */
function removeTrackingParams(params) {
  let removedAny = false;
  for (const param of TRACKING_PARAMS) {
    if (params.has(param)) {
      params.delete(param);
      removedAny = true;
    }
  }
  return removedAny;
}

/**
 * Build cleaned URL from components
 * @private
 * @param {URL} url - The parsed URL object
 * @param {URLSearchParams} params - The cleaned search params
 * @returns {string} - The rebuilt URL string
 */
function buildCleanedUrl(url, params) {
  let cleanedUrl = url.origin + url.pathname;
  
  if (hasAnyParams(params)) {
    cleanedUrl += '?' + params.toString();
  }
  
  if (url.hash) {
    cleanedUrl += url.hash;
  }
  
  return cleanedUrl;
}

/**
 * Clean tracking and affiliate parameters from a URL
 * 
 * @param {string} urlString - The URL string to clean
 * @returns {string} - The cleaned URL string, or original if invalid
 * 
 * @example
 * cleanUrl('https://example.com/page?utm_source=twitter&id=123')
 * // Returns: 'https://example.com/page?id=123'
 * 
 * @example
 * cleanUrl('https://example.com/page?utm_source=twitter')
 * // Returns: 'https://example.com/page'
 * 
 * @example
 * cleanUrl('invalid-url')
 * // Returns: 'invalid-url'
 */
export function cleanUrl(urlString) {
  // Handle null/undefined/empty strings
  if (!urlString || typeof urlString !== 'string') {
    return urlString;
  }

  try {
    const url = new URL(urlString);
    const params = url.searchParams;
    
    // If no params, return as-is (optimization)
    if (!hasAnyParams(params)) {
      return urlString;
    }
    
    // Remove tracking parameters
    const removedAny = removeTrackingParams(params);
    
    // If nothing was removed, return original
    if (!removedAny) {
      return urlString;
    }
    
    return buildCleanedUrl(url, params);
    
  } catch (error) {
    // Invalid URL - return original string unchanged
    return urlString;
  }
}
