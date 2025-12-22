/**
 * Social Media URL Handlers
 * URL detection for social media platforms
 *
 * v1.6.3.11-v4 Changes:
 * - FIX Issue #1: Added Shadow DOM support for Twitter/X, Instagram, TikTok
 * - FIX Issue #4: Enhanced fallback chain with Shadow DOM traversal
 */

import { findGenericUrl } from './generic.js';
import { findLinkInShadowDOM, findClosestAcrossShadow } from './shadow-dom.js';
import { debug } from '../../utils/debug.js';

/**
 * Find Twitter/X URL with Shadow DOM support
 * v1.6.3.11-v4 - FIX Issue #1 & #4: Twitter uses web components
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
  if (element && element.href) {
    debug(`URL found directly from hovered element: ${element.href}`);
    console.log('[URL_EXTRACT] Twitter direct link:', { href: element.href });
    return element.href;
  }

  // v1.6.3.11-v4 - FIX Issue #1: Try Shadow DOM traversal for Twitter
  // Twitter uses custom elements like <div data-testid="tweet">
  const tweet = element.closest('[data-testid="tweet"], [data-testid="tweetText"], article');
  if (tweet) {
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

function findRedditUrl(element) {
  const post = element.closest(
    '[data-testid="post-container"], .Post, .post-container, [role="article"]'
  );
  if (!post) return findGenericUrl(element);

  const titleLink = post.querySelector(
    'a[data-testid="post-title"], h3 a, .PostTitle a, [data-click-id="body"] a'
  );
  if (titleLink?.href) return titleLink.href;

  // v1.6.3.11-v4 - Shadow DOM fallback
  const shadowLink = findLinkInShadowDOM(post, 'a[href]', 0);
  if (shadowLink?.href) return shadowLink.href;

  return null;
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
 * @param {Element} element - DOM element
 * @returns {string|null} Found URL or null
 */
function findInstagramUrl(element) {
  console.log('[HANDLER_SELECT] Instagram handler invoked:', {
    tag: element.tagName,
    hasShadow: !!element.shadowRoot
  });

  const post = element.closest('[role="article"], article');
  if (!post) {
    // v1.6.3.11-v4 - Try cross-shadow search for Instagram
    const closestLink = findClosestAcrossShadow(element, 'a[href*="/p/"], a[href*="/reel/"]', 15);
    if (closestLink?.href) {
      console.log('[URL_EXTRACT] Instagram cross-shadow link:', { href: closestLink.href });
      return closestLink.href;
    }
    return findGenericUrl(element);
  }

  // Standard selectors
  const link = post.querySelector('a[href*="/p/"], a[href*="/reel/"], time a');
  if (link?.href) {
    console.log('[URL_EXTRACT] Instagram post link:', { href: link.href });
    return link.href;
  }

  // v1.6.3.11-v4 - Shadow DOM search
  const shadowLink = findLinkInShadowDOM(post, 'a[href*="/p/"], a[href*="/reel/"]', 0);
  if (shadowLink?.href) {
    console.log('[URL_EXTRACT] Instagram Shadow DOM link:', { href: shadowLink.href });
    return shadowLink.href;
  }

  return null;
}

function findFacebookUrl(element) {
  const post = element.closest('[role="article"], [data-testid="post"]');
  if (!post) return findGenericUrl(element);

  const links = post.querySelectorAll(
    'a[href*="/posts/"], a[href*="/photos/"], a[href*="/videos/"]'
  );
  if (links.length > 0) return links[0].href;

  // v1.6.3.11-v4 - Shadow DOM fallback
  const shadowLink = findLinkInShadowDOM(post, 'a[href]', 0);
  if (shadowLink?.href) return shadowLink.href;

  return null;
}

/**
 * Find TikTok URL with Shadow DOM support
 * v1.6.3.11-v4 - FIX Issue #1 & #4: TikTok uses web components
 * @param {Element} element - DOM element
 * @returns {string|null} Found URL or null
 */
function findTikTokUrl(element) {
  console.log('[HANDLER_SELECT] TikTok handler invoked:', {
    tag: element.tagName,
    hasShadow: !!element.shadowRoot
  });

  const video = element.closest(
    '[data-e2e="user-post-item"], .video-feed-item, [data-e2e="recommend-list-item-container"]'
  );
  if (!video) {
    // v1.6.3.11-v4 - Try cross-shadow search for TikTok
    const closestLink = findClosestAcrossShadow(element, 'a[href*="/@"], a[href*="/video/"]', 15);
    if (closestLink?.href) {
      console.log('[URL_EXTRACT] TikTok cross-shadow link:', { href: closestLink.href });
      return closestLink.href;
    }
    return findGenericUrl(element);
  }

  // Standard selectors
  const link = video.querySelector('a[href*="/@"], a[href*="/video/"]');
  if (link?.href) {
    console.log('[URL_EXTRACT] TikTok video link:', { href: link.href });
    return link.href;
  }

  // v1.6.3.11-v4 - Shadow DOM search
  const shadowLink = findLinkInShadowDOM(video, 'a[href*="/@"], a[href*="/video/"]', 0);
  if (shadowLink?.href) {
    console.log('[URL_EXTRACT] TikTok Shadow DOM link:', { href: shadowLink.href });
    return shadowLink.href;
  }

  return null;
}

function findThreadsUrl(element) {
  const post = element.closest('[role="article"]');
  if (!post) return findGenericUrl(element);

  const link = post.querySelector('a[href*="/t/"], time a');
  if (link?.href) return link.href;

  // v1.6.3.11-v4 - Shadow DOM fallback
  const shadowLink = findLinkInShadowDOM(post, 'a[href]', 0);
  if (shadowLink?.href) return shadowLink.href;

  return null;
}

function findBlueskyUrl(element) {
  const post = element.closest('[data-testid="postThreadItem"], [role="article"]');
  if (!post) return findGenericUrl(element);

  const link = post.querySelector('a[href*="/post/"]');
  if (link?.href) return link.href;

  // v1.6.3.11-v4 - Shadow DOM fallback
  const shadowLink = findLinkInShadowDOM(post, 'a[href]', 0);
  if (shadowLink?.href) return shadowLink.href;

  return null;
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
