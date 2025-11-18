/**
 * Video URL Handlers
 * URL detection for video platforms
 */

import { findGenericUrl } from './generic.js';
import { debug as _debug } from '../../utils/debug.js';

function findYouTubeUrl(element) {
  const videoCard = element.closest(
    'ytd-rich-grid-media, ytd-thumbnail, ytd-video-renderer, ytd-grid-video-renderer, a[href*="/watch"]'
  );
  if (!videoCard) return findGenericUrl(element);

  const thumbnailLink = videoCard.querySelector('a#thumbnail[href*="watch?v="]');
  if (thumbnailLink?.href) return thumbnailLink.href;

  const watchLink = videoCard.querySelector('a[href*="watch?v="]');
  if (watchLink?.href) return watchLink.href;

  return null;
}

function findVimeoUrl(element) {
  const video = element.closest('[data-clip-id], .clip_grid_item');
  if (!video) return findGenericUrl(element);

  const link = video.querySelector('a[href*="/video/"], a[href*="vimeo.com/"]');
  if (link?.href) return link.href;

  return null;
}

function findDailyMotionUrl(element) {
  const video = element.closest('[data-video], .sd_video_item');
  if (!video) return findGenericUrl(element);

  const link = video.querySelector('a[href*="/video/"]');
  if (link?.href) return link.href;

  return null;
}

function findTwitchUrl(element) {
  const stream = element.closest('[data-a-target="video-card"], .video-card');
  if (!stream) return findGenericUrl(element);

  const link = stream.querySelector('a[href*="/videos/"], a[href*="/clip/"]');
  if (link?.href) return link.href;

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
