/**
 * Other URL Handlers
 * URL detection for other platforms
 */

import { debug } from "../../utils/debug.js";
import { findGenericUrl } from "./generic.js";

function findArchiveOrgUrl(element) {
  const item = element.closest(".item-ia, [data-id]");
  if (!item) return findGenericUrl(element);

  const link = item.querySelector('a[href*="/details/"]');
  if (link?.href) return link.href;

  return null;
}

function findPatreonUrl(element) {
  const post = element.closest('[data-tag="post-card"]');
  if (!post) return findGenericUrl(element);

  const link = post.querySelector('a[href*="/posts/"]');
  if (link?.href) return link.href;

  return null;
}

function findKoFiUrl(element) {
  const post = element.closest(".feed-item, [data-post-id]");
  if (!post) return findGenericUrl(element);

  const link = post.querySelector('a[href*="/post/"]');
  if (link?.href) return link.href;

  return null;
}

function findBuyMeACoffeeUrl(element) {
  const post = element.closest(".feed-card");
  if (!post) return findGenericUrl(element);

  const link = post.querySelector('a[href*="/p/"]');
  if (link?.href) return link.href;

  return null;
}

function findGumroadUrl(element) {
  const product = element.closest("[data-permalink], .product-card");
  if (!product) return findGenericUrl(element);

  const link = product.querySelector('a[href*="gumroad.com/"]');
  if (link?.href) return link.href;

  return null;
}

export const otherHandlers = {
  archiveOrg: findArchiveOrgUrl,
  patreon: findPatreonUrl,
  koFi: findKoFiUrl,
  buyMeACoffee: findBuyMeACoffeeUrl,
  gumroad: findGumroadUrl,
};
