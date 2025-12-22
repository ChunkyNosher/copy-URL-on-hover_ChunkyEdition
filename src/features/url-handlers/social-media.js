/**
 * Social Media URL Handlers
 * URL detection for social media platforms
 *
 * v1.6.3.11-v4 Changes:
 * - FIX Issue #1: Added Shadow DOM support for Twitter/X, Instagram, TikTok
 * - FIX Issue #4: Enhanced fallback chain with Shadow DOM traversal
 *
 * v1.6.3.11-v5 Changes:
 * - Refactored to reduce cyclomatic complexity (Code Health 8.28 → 9.0+)
 * - Extracted common patterns into _findSocialMediaUrl helper
 * - Eliminated code duplication across find*Url functions
 */

import { findGenericUrl } from './generic.js';
import { findLinkInShadowDOM, findClosestAcrossShadow } from './shadow-dom.js';
import { debug } from '../../utils/debug.js';

// ==================== CONFIGURATION ====================

/**
 * Platform-specific configuration for social media URL detection
 * @private
 */
const PLATFORM_CONFIGS = {
  twitter: {
    containerSelector: '[data-testid="tweet"], [data-testid="tweetText"], article',
    linkSelector: 'a[href*="/status/"]',
    logPrefix: 'Twitter',
    useShadowDOM: true,
    useCrossShadow: true
  },
  reddit: {
    containerSelector: '[data-testid="post-container"], .Post, .post-container, [role="article"]',
    linkSelector: 'a[data-testid="post-title"], h3 a, .PostTitle a, [data-click-id="body"] a',
    logPrefix: 'Reddit',
    useShadowDOM: true,
    useCrossShadow: false
  },
  instagram: {
    containerSelector: '[role="article"], article',
    linkSelector: 'a[href*="/p/"], a[href*="/reel/"], time a',
    crossShadowSelector: 'a[href*="/p/"], a[href*="/reel/"]',
    logPrefix: 'Instagram',
    useShadowDOM: true,
    useCrossShadow: true
  },
  facebook: {
    containerSelector: '[role="article"], [data-testid="post"]',
    linkSelector: 'a[href*="/posts/"], a[href*="/photos/"], a[href*="/videos/"]',
    logPrefix: 'Facebook',
    useShadowDOM: true,
    useCrossShadow: false,
    useQuerySelectorAll: true
  },
  tikTok: {
    containerSelector:
      '[data-e2e="user-post-item"], .video-feed-item, [data-e2e="recommend-list-item-container"]',
    linkSelector: 'a[href*="/@"], a[href*="/video/"]',
    logPrefix: 'TikTok',
    useShadowDOM: true,
    useCrossShadow: true
  },
  threads: {
    containerSelector: '[role="article"]',
    linkSelector: 'a[href*="/t/"], time a',
    logPrefix: 'Threads',
    useShadowDOM: true,
    useCrossShadow: false
  },
  bluesky: {
    containerSelector: '[data-testid="postThreadItem"], [role="article"]',
    linkSelector: 'a[href*="/post/"]',
    logPrefix: 'Bluesky',
    useShadowDOM: true,
    useCrossShadow: false
  }
};

// ==================== HELPER FUNCTIONS ====================

/**
 * Check element for direct href
 * @private
 * @param {Element} element - DOM element
 * @param {string} logPrefix - Logging prefix for platform
 * @returns {string|null} URL or null
 */
function _checkDirectHref(element, logPrefix) {
  if (element?.href) {
    console.log(`[URL_EXTRACT] ${logPrefix} direct link:`, { href: element.href });
    return element.href;
  }
  return null;
}

/**
 * Search for link in container using standard and Shadow DOM methods
 * @private
 * @param {Element} container - Container element
 * @param {Object} config - Platform configuration
 * @returns {string|null} URL or null
 */
function _searchInContainer(container, config) {
  // Try standard selectors
  const link = config.useQuerySelectorAll
    ? container.querySelectorAll(config.linkSelector)[0]
    : container.querySelector(config.linkSelector);

  if (link?.href) {
    console.log(`[URL_EXTRACT] ${config.logPrefix} post link:`, { href: link.href });
    return link.href;
  }

  // Try Shadow DOM search if enabled
  if (config.useShadowDOM) {
    const shadowLink = findLinkInShadowDOM(container, config.linkSelector, 0);
    if (shadowLink?.href) {
      console.log(`[URL_EXTRACT] ${config.logPrefix} Shadow DOM link:`, { href: shadowLink.href });
      return shadowLink.href;
    }
  }

  return null;
}

/**
 * Try cross-shadow boundary search
 * @private
 * @param {Element} element - DOM element
 * @param {Object} config - Platform configuration
 * @returns {string|null} URL or null
 */
function _tryCrossShadowSearch(element, config) {
  if (!config.useCrossShadow) return null;

  const crossSelector = config.crossShadowSelector || config.linkSelector;
  const closestLink = findClosestAcrossShadow(element, crossSelector, 15);
  if (closestLink?.href) {
    console.log(`[URL_EXTRACT] ${config.logPrefix} cross-shadow link:`, { href: closestLink.href });
    return closestLink.href;
  }
  return null;
}

/**
 * Generic social media URL finder using configuration-driven approach
 * v1.6.3.11-v5 - Reduces code duplication across handlers
 * @private
 * @param {Element} element - DOM element
 * @param {Object} config - Platform configuration
 * @returns {string|null} Found URL or null
 */
function _findSocialMediaUrl(element, config) {
  console.log(`[HANDLER_SELECT] ${config.logPrefix} handler invoked:`, {
    tag: element.tagName,
    hasShadow: !!element.shadowRoot
  });

  // Find container
  const container = element.closest(config.containerSelector);

  // No container found - try cross-shadow or fallback to generic
  if (!container) {
    const crossShadowResult = _tryCrossShadowSearch(element, config);
    if (crossShadowResult) return crossShadowResult;
    return findGenericUrl(element);
  }

  // Search in container
  const result = _searchInContainer(container, config);
  if (result) return result;

  return null;
}

/**
 * Search tweet container for status link
 * @private
 * @param {Element} tweet - Tweet container element
 * @returns {string|null} URL or null
 */
function _searchTweetContainer(tweet) {
  // Try standard selectors
  const tweetLink = tweet.querySelector('a[href*="/status/"]');
  if (tweetLink?.href) {
    console.log('[URL_EXTRACT] Twitter status link:', { href: tweetLink.href });
    return tweetLink.href;
  }

  // Try Shadow DOM search
  const shadowLink = findLinkInShadowDOM(tweet, 'a[href*="/status/"]', 0);
  if (shadowLink?.href) {
    console.log('[URL_EXTRACT] Twitter Shadow DOM link:', { href: shadowLink.href });
    return shadowLink.href;
  }

  return null;
}

// ==================== PLATFORM HANDLERS ====================

/**
 * Find Twitter/X URL with Shadow DOM support
 * v1.6.3.11-v4 - FIX Issue #1 & #4: Twitter uses web components
 * v1.6.3.11-v5 - Refactored to reduce cyclomatic complexity (cc=10 → cc<9)
 * @param {Element} element - DOM element
 * @returns {string|null} Found URL or null
 */
function findTwitterUrl(element) {
  debug('=== TWITTER URL FINDER ===');
  debug('Hovered element: ' + element.tagName + ' - ' + element.className);

  console.log('[HANDLER_SELECT] Twitter handler invoked:', {
    tag: element.tagName,
    hasShadow: !!element.shadowRoot
  });

  // Direct href check
  const directUrl = _checkDirectHref(element, 'Twitter');
  if (directUrl) {
    debug(`URL found directly from hovered element: ${directUrl}`);
    return directUrl;
  }

  // v1.6.3.11-v4 - FIX Issue #1: Try Shadow DOM traversal for Twitter
  const tweet = element.closest('[data-testid="tweet"], [data-testid="tweetText"], article');
  if (tweet) {
    const containerUrl = _searchTweetContainer(tweet);
    if (containerUrl) return containerUrl;
  }

  // v1.6.3.11-v4 - Fallback: cross-shadow boundary search
  const closestLink = findClosestAcrossShadow(element, 'a[href*="/status/"]', 15);
  if (closestLink?.href) {
    console.log('[URL_EXTRACT] Twitter cross-shadow link:', { href: closestLink.href });
    return closestLink.href;
  }

  debug('No Twitter URL found on the provided element.');
  return null;
}

/**
 * Find Reddit URL
 * v1.6.3.11-v5 - Refactored to use _findSocialMediaUrl helper
 * @param {Element} element - DOM element
 * @returns {string|null} Found URL or null
 */
function findRedditUrl(element) {
  return _findSocialMediaUrl(element, PLATFORM_CONFIGS.reddit);
}

function findLinkedInUrl(element) {
  const post = element.closest('[data-id], .feed-shared-update-v2, [data-test="activity-item"]');
  if (!post) return findGenericUrl(element);

  const links = post.querySelectorAll('a[href]');
  for (const link of links) {
    const url = link.href;
    if (url.includes('/feed/') || url.includes('/posts/')) return url;
  }

  // v1.6.3.11-v4 - Shadow DOM fallback
  const shadowLink = findLinkInShadowDOM(post, 'a[href]', 0);
  if (shadowLink?.href) return shadowLink.href;

  return null;
}

/**
 * Find Instagram URL with Shadow DOM support
 * v1.6.3.11-v4 - FIX Issue #1 & #4: Instagram uses web components
 * v1.6.3.11-v5 - Refactored to use _findSocialMediaUrl helper
 * @param {Element} element - DOM element
 * @returns {string|null} Found URL or null
 */
function findInstagramUrl(element) {
  return _findSocialMediaUrl(element, PLATFORM_CONFIGS.instagram);
}

/**
 * Find Facebook URL
 * v1.6.3.11-v5 - Refactored to use _findSocialMediaUrl helper
 * @param {Element} element - DOM element
 * @returns {string|null} Found URL or null
 */
function findFacebookUrl(element) {
  return _findSocialMediaUrl(element, PLATFORM_CONFIGS.facebook);
}

/**
 * Find TikTok URL with Shadow DOM support
 * v1.6.3.11-v4 - FIX Issue #1 & #4: TikTok uses web components
 * v1.6.3.11-v5 - Refactored to use _findSocialMediaUrl helper
 * @param {Element} element - DOM element
 * @returns {string|null} Found URL or null
 */
function findTikTokUrl(element) {
  return _findSocialMediaUrl(element, PLATFORM_CONFIGS.tikTok);
}

/**
 * Find Threads URL
 * v1.6.3.11-v5 - Refactored to use _findSocialMediaUrl helper
 * @param {Element} element - DOM element
 * @returns {string|null} Found URL or null
 */
function findThreadsUrl(element) {
  return _findSocialMediaUrl(element, PLATFORM_CONFIGS.threads);
}

/**
 * Find Bluesky URL
 * v1.6.3.11-v5 - Refactored to use _findSocialMediaUrl helper
 * @param {Element} element - DOM element
 * @returns {string|null} Found URL or null
 */
function findBlueskyUrl(element) {
  return _findSocialMediaUrl(element, PLATFORM_CONFIGS.bluesky);
}

function findMastodonUrl(element) {
  const post = element.closest('.status, [data-id]');
  if (!post) return findGenericUrl(element);

  const link = post.querySelector('a.status__relative-time, a.detailed-status__datetime');
  if (link?.href) return link.href;

  return null;
}

function findSnapchatUrl(element) {
  const story = element.closest('[role="article"], .Story');
  if (!story) return findGenericUrl(element);

  const link = story.querySelector('a[href*="/add/"], a[href*="/spotlight/"]');
  if (link?.href) return link.href;

  return null;
}

function findWhatsappUrl(_element) {
  // WhatsApp Web doesn't use traditional links - it's a single-page app
  // The current chat/conversation URL is the most relevant URL to copy
  return window.location.href;
}

function findTelegramUrl(element) {
  const message = element.closest('.message, [data-mid]');
  if (!message) return findGenericUrl(element);

  const link = message.querySelector('a[href*="t.me"]');
  if (link?.href) return link.href;

  return null;
}

export const social_mediaHandlers = {
  twitter: findTwitterUrl,
  reddit: findRedditUrl,
  linkedIn: findLinkedInUrl,
  instagram: findInstagramUrl,
  facebook: findFacebookUrl,
  tikTok: findTikTokUrl,
  threads: findThreadsUrl,
  bluesky: findBlueskyUrl,
  mastodon: findMastodonUrl,
  snapchat: findSnapchatUrl,
  whatsapp: findWhatsappUrl,
  telegram: findTelegramUrl
};
