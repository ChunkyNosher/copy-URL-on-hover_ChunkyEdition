/**
 * Social Media URL Handlers
 * URL detection for social media platforms
 */

import { findGenericUrl } from './generic.js';
import { debug } from '../../utils/debug.js';

function findTwitterUrl(element) {
  debug('=== TWITTER URL FINDER ===');
  debug('Hovered element: ' + element.tagName + ' - ' + element.className);

  if (element && element.href) {
    debug(`URL found directly from hovered element: ${element.href}`);
    return element.href;
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

  return null;
}

function findInstagramUrl(element) {
  const post = element.closest('[role="article"], article');
  if (!post) return findGenericUrl(element);

  const link = post.querySelector('a[href*="/p/"], a[href*="/reel/"], time a');
  if (link?.href) return link.href;

  return null;
}

function findFacebookUrl(element) {
  const post = element.closest('[role="article"], [data-testid="post"]');
  if (!post) return findGenericUrl(element);

  const links = post.querySelectorAll(
    'a[href*="/posts/"], a[href*="/photos/"], a[href*="/videos/"]'
  );
  if (links.length > 0) return links[0].href;

  return null;
}

function findTikTokUrl(element) {
  const video = element.closest('[data-e2e="user-post-item"], .video-feed-item');
  if (!video) return findGenericUrl(element);

  const link = video.querySelector('a[href*="/@"]');
  if (link?.href) return link.href;

  return null;
}

function findThreadsUrl(element) {
  const post = element.closest('[role="article"]');
  if (!post) return findGenericUrl(element);

  const link = post.querySelector('a[href*="/t/"], time a');
  if (link?.href) return link.href;

  return null;
}

function findBlueskyUrl(element) {
  const post = element.closest('[data-testid="postThreadItem"], [role="article"]');
  if (!post) return findGenericUrl(element);

  const link = post.querySelector('a[href*="/post/"]');
  if (link?.href) return link.href;

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
