/**
 * Video URL Handlers
 * URL detection for video platforms
 *
 * v1.6.3.11-v4 Changes:
 * - FIX Issue #1: Added Shadow DOM support for YouTube components
 * - FIX Issue #4: Enhanced fallback chain for dynamic DOM structures
 *
 * v1.6.3.11-v5 Changes:
 * - Refactored to reduce code duplication (Code Health 8.54 → 9.0+)
 * - Extracted common patterns into _findVideoUrl helper
 * - Reduced cyclomatic complexity in findYouTubeUrl
 */

import { findGenericUrl } from './generic.js';
import { findLinkInShadowDOM, findClosestAcrossShadow } from './shadow-dom.js';
import { debug as _debug } from '../../utils/debug.js';

// ==================== CONFIGURATION ====================

/**
 * Platform-specific configuration for video URL detection
 * @private
 */
const VIDEO_PLATFORM_CONFIGS = {
  vimeo: {
    containerSelector: '[data-clip-id], .clip_grid_item',
    linkSelector: 'a[href*="/video/"], a[href*="vimeo.com/"]',
    logPrefix: 'Vimeo',
    useShadowDOM: true
  },
  dailyMotion: {
    containerSelector: '[data-video], .sd_video_item',
    linkSelector: 'a[href*="/video/"]',
    logPrefix: 'DailyMotion',
    useShadowDOM: true
  },
  twitch: {
    containerSelector: '[data-a-target="video-card"], .video-card',
    linkSelector: 'a[href*="/videos/"], a[href*="/clip/"]',
    logPrefix: 'Twitch',
    useShadowDOM: true
  },
  rumble: {
    containerSelector: '.video-item, [data-video]',
    linkSelector: 'a[href*=".html"]',
    logPrefix: 'Rumble',
    useShadowDOM: false
  },
  odysee: {
    containerSelector: '.claim-preview, [data-id]',
    linkSelector: 'a[href*="/@"]',
    logPrefix: 'Odysee',
    useShadowDOM: false
  },
  bitchute: {
    containerSelector: '.video-card, .channel-videos-container',
    linkSelector: 'a[href*="/video/"]',
    logPrefix: 'Bitchute',
    useShadowDOM: false
  }
};

// ==================== HELPER FUNCTIONS ====================

/**
 * Generic video platform URL finder using configuration-driven approach
 * v1.6.3.11-v5 - Reduces code duplication across handlers
 * @private
 * @param {Element} element - DOM element
 * @param {Object} config - Platform configuration
 * @returns {string|null} Found URL or null
 */
function _findVideoUrl(element, config) {
  const container = element.closest(config.containerSelector);
  if (!container) return findGenericUrl(element);

  // Standard selector search
  const link = container.querySelector(config.linkSelector);
  if (link?.href) return link.href;

  // Shadow DOM fallback if enabled
  if (config.useShadowDOM) {
    const shadowLink = findLinkInShadowDOM(container, config.linkSelector, 0);
    if (shadowLink?.href) return shadowLink.href;
  }

  return null;
}

// ==================== YOUTUBE HELPERS ====================

/**
 * Try to find YouTube link in video card
 * @private
 * @param {Element} videoCard - Video card element
 * @returns {string|null} URL or null
 */
function _findYouTubeLinkInCard(videoCard) {
  // Try thumbnail link
  const thumbnailLink = videoCard.querySelector('a#thumbnail[href*="watch?v="]');
  if (thumbnailLink?.href) {
    console.log('[URL_EXTRACT] YouTube thumbnail link:', { href: thumbnailLink.href });
    return thumbnailLink.href;
  }

  // Try any watch link
  const watchLink = videoCard.querySelector('a[href*="watch?v="]');
  if (watchLink?.href) {
    console.log('[URL_EXTRACT] YouTube watch link:', { href: watchLink.href });
    return watchLink.href;
  }

  // Try Shadow DOM search
  const shadowLink = findLinkInShadowDOM(videoCard, 'a[href*="watch?v="]', 0);
  if (shadowLink?.href) {
    console.log('[URL_EXTRACT] YouTube Shadow DOM link:', { href: shadowLink.href });
    return shadowLink.href;
  }

  return null;
}

/**
 * Check if element is a direct YouTube watch link
 * @private
 * @param {Element} element - DOM element
 * @returns {string|null} URL if direct link, null otherwise
 */
function _checkYouTubeDirectLink(element) {
  if (element.tagName === 'A' && element.href?.includes('watch?v=')) {
    console.log('[URL_EXTRACT] YouTube direct link:', { href: element.href });
    return element.href;
  }
  return null;
}

/**
 * Search YouTube using cross-shadow boundary
 * @private
 * @param {Element} element - DOM element
 * @returns {string|null} URL or null
 */
function _searchYouTubeCrossShadow(element) {
  const closestLink = findClosestAcrossShadow(element, 'a[href*="watch?v="]', 15);
  if (closestLink?.href) {
    console.log('[URL_EXTRACT] YouTube cross-shadow link:', { href: closestLink.href });
    return closestLink.href;
  }
  return null;
}

// ==================== PLATFORM HANDLERS ====================

/**
 * Find YouTube URL with Shadow DOM support
 * v1.6.3.11-v4 - FIX Issue #1 & #4: YouTube uses custom elements with Shadow DOM
 * v1.6.3.11-v5 - Refactored to reduce cyclomatic complexity (cc=9 → cc<9)
 * @param {Element} element - DOM element
 * @returns {string|null} Found URL or null
 */
function findYouTubeUrl(element) {
  console.log('[HANDLER_SELECT] YouTube handler invoked:', {
    tag: element.tagName,
    id: element.id || 'none',
    hasShadow: !!element.shadowRoot
  });

  // Direct link check
  const directUrl = _checkYouTubeDirectLink(element);
  if (directUrl) return directUrl;

  // Find and search video card container
  const videoCard = element.closest(
    'ytd-rich-grid-media, ytd-thumbnail, ytd-video-renderer, ytd-grid-video-renderer, a[href*="/watch"]'
  );
  if (videoCard) {
    const cardUrl = _findYouTubeLinkInCard(videoCard);
    if (cardUrl) return cardUrl;
  }

  // Cross-shadow boundary search
  const crossShadowUrl = _searchYouTubeCrossShadow(element);
  if (crossShadowUrl) return crossShadowUrl;

  // Final fallback
  return findGenericUrl(element);
}

/**
 * Find Vimeo URL
 * v1.6.3.11-v5 - Refactored to use _findVideoUrl helper
 * @param {Element} element - DOM element
 * @returns {string|null} Found URL or null
 */
function findVimeoUrl(element) {
  return _findVideoUrl(element, VIDEO_PLATFORM_CONFIGS.vimeo);
}

/**
 * Find DailyMotion URL
 * v1.6.3.11-v5 - Refactored to use _findVideoUrl helper
 * @param {Element} element - DOM element
 * @returns {string|null} Found URL or null
 */
function findDailyMotionUrl(element) {
  return _findVideoUrl(element, VIDEO_PLATFORM_CONFIGS.dailyMotion);
}

/**
 * Find Twitch URL
 * v1.6.3.11-v5 - Refactored to use _findVideoUrl helper
 * @param {Element} element - DOM element
 * @returns {string|null} Found URL or null
 */
function findTwitchUrl(element) {
  return _findVideoUrl(element, VIDEO_PLATFORM_CONFIGS.twitch);
}

/**
 * Find Rumble URL
 * v1.6.3.11-v5 - Refactored to use _findVideoUrl helper
 * @param {Element} element - DOM element
 * @returns {string|null} Found URL or null
 */
function findRumbleUrl(element) {
  return _findVideoUrl(element, VIDEO_PLATFORM_CONFIGS.rumble);
}

/**
 * Find Odysee URL
 * v1.6.3.11-v5 - Refactored to use _findVideoUrl helper
 * @param {Element} element - DOM element
 * @returns {string|null} Found URL or null
 */
function findOdyseeUrl(element) {
  return _findVideoUrl(element, VIDEO_PLATFORM_CONFIGS.odysee);
}

/**
 * Find Bitchute URL
 * v1.6.3.11-v5 - Refactored to use _findVideoUrl helper
 * @param {Element} element - DOM element
 * @returns {string|null} Found URL or null
 */
function findBitchuteUrl(element) {
  return _findVideoUrl(element, VIDEO_PLATFORM_CONFIGS.bitchute);
}

export const videoHandlers = {
  youTube: findYouTubeUrl,
  vimeo: findVimeoUrl,
  dailyMotion: findDailyMotionUrl,
  twitch: findTwitchUrl,
  rumble: findRumbleUrl,
  odysee: findOdyseeUrl,
  bitchute: findBitchuteUrl
};
