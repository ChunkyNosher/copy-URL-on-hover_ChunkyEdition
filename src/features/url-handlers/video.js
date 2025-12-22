/**
 * Video URL Handlers
 * URL detection for video platforms
 *
 * v1.6.3.11-v4 Changes:
 * - FIX Issue #1: Added Shadow DOM support for YouTube components
 * - FIX Issue #4: Enhanced fallback chain for dynamic DOM structures
 */

import { findGenericUrl } from './generic.js';
import { findLinkInShadowDOM, findClosestAcrossShadow } from './shadow-dom.js';
import { debug as _debug } from '../../utils/debug.js';

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
 * Find YouTube URL with Shadow DOM support
 * v1.6.3.11-v4 - FIX Issue #1 & #4: YouTube uses custom elements with Shadow DOM
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
  if (element.tagName === 'A' && element.href?.includes('watch?v=')) {
    console.log('[URL_EXTRACT] YouTube direct link:', { href: element.href });
    return element.href;
  }

  // Find video card container
  const videoCard = element.closest(
    'ytd-rich-grid-media, ytd-thumbnail, ytd-video-renderer, ytd-grid-video-renderer, a[href*="/watch"]'
  );

  // Search within video card
  if (videoCard) {
    const cardUrl = _findYouTubeLinkInCard(videoCard);
    if (cardUrl) return cardUrl;
  }

  // Cross-shadow boundary search
  const closestLink = findClosestAcrossShadow(element, 'a[href*="watch?v="]', 15);
  if (closestLink?.href) {
    console.log('[URL_EXTRACT] YouTube cross-shadow link:', { href: closestLink.href });
    return closestLink.href;
  }

  // Final fallback
  return findGenericUrl(element);
}

// ==================== OTHER VIDEO PLATFORM HANDLERS ====================

function findVimeoUrl(element) {
  const video = element.closest('[data-clip-id], .clip_grid_item');
  if (!video) return findGenericUrl(element);

  const linkSelector = 'a[href*="/video/"], a[href*="vimeo.com/"]';
  const link = video.querySelector(linkSelector);
  if (link?.href) return link.href;

  // Shadow DOM fallback with same selector
  const shadowLink = findLinkInShadowDOM(video, linkSelector, 0);
  if (shadowLink?.href) return shadowLink.href;

  return null;
}

function findDailyMotionUrl(element) {
  const video = element.closest('[data-video], .sd_video_item');
  if (!video) return findGenericUrl(element);

  const linkSelector = 'a[href*="/video/"]';
  const link = video.querySelector(linkSelector);
  if (link?.href) return link.href;

  // Shadow DOM fallback with same selector
  const shadowLink = findLinkInShadowDOM(video, linkSelector, 0);
  if (shadowLink?.href) return shadowLink.href;

  return null;
}

function findTwitchUrl(element) {
  const stream = element.closest('[data-a-target="video-card"], .video-card');
  if (!stream) return findGenericUrl(element);

  const linkSelector = 'a[href*="/videos/"], a[href*="/clip/"]';
  const link = stream.querySelector(linkSelector);
  if (link?.href) return link.href;

  // Shadow DOM fallback with same selector
  const shadowLink = findLinkInShadowDOM(stream, linkSelector, 0);
  if (shadowLink?.href) return shadowLink.href;

  return null;
}

function findRumbleUrl(element) {
  const video = element.closest('.video-item, [data-video]');
  if (!video) return findGenericUrl(element);

  const link = video.querySelector('a[href*=".html"]');
  if (link?.href) return link.href;

  return null;
}

function findOdyseeUrl(element) {
  const video = element.closest('.claim-preview, [data-id]');
  if (!video) return findGenericUrl(element);

  const link = video.querySelector('a[href*="/@"]');
  if (link?.href) return link.href;

  return null;
}

function findBitchuteUrl(element) {
  const video = element.closest('.video-card, .channel-videos-container');
  if (!video) return findGenericUrl(element);

  const link = video.querySelector('a[href*="/video/"]');
  if (link?.href) return link.href;

  return null;
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
