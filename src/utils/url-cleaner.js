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
  'ttclid',
  'msclkid',
  'igshid',
  'igsh',
  'ref_src',
  'ref_url',
  'guce_referrer',
  'guce_referrer_sig',
  'guccounter',
  'li_fat_id',
  'rdt_cid',
  'irclickid',
  '_branch_match_id',
  's_kwcid',
  'si',
  'srsltid',
  'pk_campaign',
  'pk_medium',
  'pk_source',
  'mtm_campaign',
  'mtm_medium',
  'mtm_source',
  'mtm_content',
  'mtm_term',

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

const AMAZON_HOST_SUFFIXES = [
  'amazon.com',
  'amazon.ca',
  'amazon.com.mx',
  'amazon.com.br',
  'amazon.co.uk',
  'amazon.de',
  'amazon.fr',
  'amazon.it',
  'amazon.es',
  'amazon.nl',
  'amazon.pl',
  'amazon.se',
  'amazon.com.tr',
  'amazon.ae',
  'amazon.sa',
  'amazon.in',
  'amazon.sg',
  'amazon.com.au',
  'amazon.co.jp'
];

/**
 * Extract ASIN from Amazon URL pathname
 * @private
 * @param {string} pathname - The URL pathname
 * @returns {string|null} - The ASIN if found, null otherwise
 */
function extractAmazonAsin(pathname) {
  // Match /dp/{ASIN} or /gp/product/{ASIN} patterns
  const match = pathname.match(/\/(?:dp|gp\/product)\/([A-Za-z0-9]{10})(?:\/|$)/);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Check if hostname belongs to an official Amazon retail domain
 * @private
 * @param {string} hostname - The URL hostname
 * @returns {boolean} - True if hostname is an allowed Amazon domain/subdomain
 */
function isAmazonRetailHostname(hostname) {
  const lowerHostname = hostname.toLowerCase();
  return AMAZON_HOST_SUFFIXES.some(
    (suffix) => lowerHostname === suffix || lowerHostname.endsWith(`.${suffix}`)
  );
}

/**
 * Extract ASIN from trusted Amazon product URL
 * @private
 * @param {URL} url - The parsed URL object
 * @returns {string|null} - ASIN for trusted Amazon product URL, else null
 */
function getAmazonAsinFromProductUrl(url) {
  if (!isAmazonRetailHostname(url.hostname)) {
    return null;
  }
  return extractAmazonAsin(url.pathname);
}

/**
 * Build canonical Amazon product URL
 * @private
 * @param {URL} url - The parsed URL object
 * @param {string} asin - Amazon ASIN
 * @returns {string} - Canonical Amazon product URL
 */
function buildCanonicalAmazonUrl(url, asin) {
  const canonicalUrl = new URL(url.toString());
  canonicalUrl.pathname = `/dp/${asin}/`;
  canonicalUrl.search = '';
  return canonicalUrl.toString();
}

/**
 * Build cleaned URL from components
 * @private
 * @param {URL} url - The parsed URL object (already mutated)
 * @param {URLSearchParams} params - The cleaned search params (unused)
 * @returns {string} - The rebuilt URL string
 */
function buildCleanedUrl(url, _params) {
  // The URL instance's searchParams have already been mutated
  // by removeTrackingParams(). Use the built-in serializer so
  // scheme-specific formatting (e.g., file:, about:, moz-extension:)
  // and other components (username, password, port) are preserved.
  return url.toString();
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

    // Amazon product URLs always get canonical treatment
    const amazonAsin = getAmazonAsinFromProductUrl(url);
    if (amazonAsin) {
      return buildCanonicalAmazonUrl(url, amazonAsin);
    }

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
