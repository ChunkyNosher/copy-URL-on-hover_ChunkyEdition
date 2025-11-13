/**
 * Image Design URL Handlers
 * URL detection for image design platforms
 */

import { debug } from '../../utils/debug.js';
import { findGenericUrl } from './generic.js';

function findPinterestUrl(element) {
  const pin = element.closest('[data-test-id="pin"], [role="button"]');
  if (!pin) return findGenericUrl(element);

  const link = pin.querySelector('a[href*="/pin/"]');
  if (link?.href) return link.href;

  return null;
}

function findTumblrUrl(element) {
  const post = element.closest('[data-id], article');
  if (!post) return findGenericUrl(element);

  const link = post.querySelector('a[href*="/post/"]');
  if (link?.href) return link.href;

  return null;
}

function findDribbbleUrl(element) {
  const shot = element.closest('[data-thumbnail-target], .shot-thumbnail');
  if (!shot) return findGenericUrl(element);

  const link = shot.querySelector('a[href*="/shots/"]');
  if (link?.href) return link.href;

  return null;
}

function findBehanceUrl(element) {
  const project = element.closest('[data-project-id], .Project');
  if (!project) return findGenericUrl(element);

  const link = project.querySelector('a[href*="/gallery/"]');
  if (link?.href) return link.href;

  return null;
}

function findDeviantartUrl(element) {
  const deviation = element.closest('[data-deviationid], ._2vUXu');
  if (!deviation) return findGenericUrl(element);

  const link = deviation.querySelector('a[data-hook="deviation_link"]');
  if (link?.href) return link.href;

  return null;
}

function findFlickrUrl(element) {
  const photo = element.closest('.photo-list-photo-view, [data-photo-id]');
  if (!photo) return findGenericUrl(element);

  const link = photo.querySelector('a[href*="/photos/"]');
  if (link?.href) return link.href;

  return null;
}

function find500pxUrl(element) {
  const photo = element.closest('[data-test="photo-item"]');
  if (!photo) return findGenericUrl(element);

  const link = photo.querySelector('a[href*="/photo/"]');
  if (link?.href) return link.href;

  return null;
}

function findUnsplashUrl(element) {
  const photo = element.closest('figure, [data-test="photo-grid-single-column-figure"]');
  if (!photo) return findGenericUrl(element);

  const link = photo.querySelector('a[href*="/photos/"]');
  if (link?.href) return link.href;

  return null;
}

function findPexelsUrl(element) {
  const photo = element.closest('[data-photo-modal-medium], article');
  if (!photo) return findGenericUrl(element);

  const link = photo.querySelector('a[href*="/photo/"]');
  if (link?.href) return link.href;

  return null;
}

function findPixabayUrl(element) {
  const photo = element.closest('[data-id], .item');
  if (!photo) return findGenericUrl(element);

  const link = photo.querySelector('a[href*="/photos/"], a[href*="/illustrations/"]');
  if (link?.href) return link.href;

  return null;
}

function findArtstationUrl(element) {
  const project = element.closest('.project, [data-project-id]');
  if (!project) return findGenericUrl(element);

  const link = project.querySelector('a[href*="/artwork/"]');
  if (link?.href) return link.href;

  return null;
}

function findImgurUrl(element) {
  const post = element.closest('[id^="post-"], .Post');
  if (!post) return findGenericUrl(element);

  const link = post.querySelector('a[href*="/gallery/"]');
  if (link?.href) return link.href;

  return null;
}

function findGiphyUrl(element) {
  const gif = element.closest('[data-giphy-id], .gif');
  if (!gif) return findGenericUrl(element);

  const link = gif.querySelector('a[href*="/gifs/"]');
  if (link?.href) return link.href;

  return null;
}

export const image_designHandlers = {
  pinterest: findPinterestUrl,
  tumblr: findTumblrUrl,
  dribbble: findDribbbleUrl,
  behance: findBehanceUrl,
  deviantart: findDeviantartUrl,
  flickr: findFlickrUrl,
  '500px': find500pxUrl,
  unsplash: findUnsplashUrl,
  pexels: findPexelsUrl,
  pixabay: findPixabayUrl,
  artstation: findArtstationUrl,
  imgur: findImgurUrl,
  giphy: findGiphyUrl
};
