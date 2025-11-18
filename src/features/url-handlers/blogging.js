/**
 * Blogging URL Handlers
 * URL detection for blogging platforms
 */

import { findGenericUrl } from './generic.js';
import { debug } from '../../utils/debug.js';

function findMediumUrl(element) {
  const article = element.closest('[data-post-id], article');
  if (!article) return findGenericUrl(element);

  const link = article.querySelector('a[data-action="open-post"], h2 a, h3 a');
  if (link?.href) return link.href;

  return null;
}

function findDevToUrl(element) {
  const article = element.closest('.crayons-story, [data-article-id]');
  if (!article) return findGenericUrl(element);

  const link = article.querySelector('a[id*="article-link"], h2 a, h3 a');
  if (link?.href) return link.href;

  return null;
}

function findHashnodeUrl(element) {
  const article = element.closest('[data-post-id], .post-card');
  if (!article) return findGenericUrl(element);

  const link = article.querySelector('a[href*="/post/"], h1 a, h2 a');
  if (link?.href) return link.href;

  return null;
}

function findSubstackUrl(element) {
  const article = element.closest('.post, [data-testid="post-preview"]');
  if (!article) return findGenericUrl(element);

  const link = article.querySelector('a[href*="/p/"], h2 a, h3 a');
  if (link?.href) return link.href;

  return null;
}

function findWordpressUrl(element) {
  const post = element.closest('.post, .hentry, article');
  if (!post) return findGenericUrl(element);

  const link = post.querySelector('a.entry-title-link, h2 a, .entry-title a');
  if (link?.href) return link.href;

  return null;
}

function findBloggerUrl(element) {
  const post = element.closest('.post, .post-outer');
  if (!post) return findGenericUrl(element);

  const link = post.querySelector('h3.post-title a, a.post-title');
  if (link?.href) return link.href;

  return null;
}

function findGhostUrl(element) {
  const article = element.closest('.post-card, article');
  if (!article) return findGenericUrl(element);

  const link = article.querySelector('.post-card-title a, h2 a');
  if (link?.href) return link.href;

  return null;
}

function findNotionUrl(element) {
  // Notion typically uses current page URL
  return window.location.href;
}

export const bloggingHandlers = {
  medium: findMediumUrl,
  devTo: findDevToUrl,
  hashnode: findHashnodeUrl,
  substack: findSubstackUrl,
  wordpress: findWordpressUrl,
  blogger: findBloggerUrl,
  ghost: findGhostUrl,
  notion: findNotionUrl
};
