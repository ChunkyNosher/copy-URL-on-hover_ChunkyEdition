/**
 * Ecommerce URL Handlers
 * URL detection for ecommerce platforms
 */

import { findGenericUrl } from './generic.js';
import { debug as _debug } from '../../utils/debug.js';

function findAmazonUrl(element) {
  const product = element.closest(
    '[data-component-type="s-search-result"], .s-result-item, [data-asin]'
  );
  if (!product) return findGenericUrl(element);

  const link = product.querySelector('a.a-link-normal[href*="/dp/"], h2 a');
  if (link?.href) return link.href;

  return null;
}

function findEbayUrl(element) {
  const item = element.closest('.s-item, [data-view="mi"]');
  if (!item) return findGenericUrl(element);

  const link = item.querySelector('a.s-item__link, .vip a');
  if (link?.href) return link.href;

  return null;
}

function findEtsyUrl(element) {
  const listing = element.closest('[data-listing-id], .listing-link');
  if (!listing) return findGenericUrl(element);

  const link = listing.querySelector('a[href*="/listing/"]');
  if (link?.href) return link.href;

  return null;
}

function findWalmartUrl(element) {
  const product = element.closest('[data-item-id], .search-result-gridview-item');
  if (!product) return findGenericUrl(element);

  const link = product.querySelector('a[href*="/ip/"]');
  if (link?.href) return link.href;

  return null;
}

function findFlipkartUrl(element) {
  const product = element.closest('[data-id], ._2kHMtA');
  if (!product) return findGenericUrl(element);

  const link = product.querySelector('a[href*="/p/"]');
  if (link?.href) return link.href;

  return null;
}

function findAliexpressUrl(element) {
  const product = element.closest('[data-product-id], .product-item');
  if (!product) return findGenericUrl(element);

  const link = product.querySelector('a[href*="/item/"]');
  if (link?.href) return link.href;

  return null;
}

function findAlibabaUrl(element) {
  const product = element.closest('[data-content], .organic-list-offer');
  if (!product) return findGenericUrl(element);

  const link = product.querySelector('a[href*="/product-detail/"]');
  if (link?.href) return link.href;

  return null;
}

function findShopifyUrl(element) {
  const product = element.closest('.product-item, .grid-item, [data-product-id]');
  if (!product) return findGenericUrl(element);

  const link = product.querySelector('a[href*="/products/"]');
  if (link?.href) return link.href;

  return null;
}

function findTargetUrl(element) {
  const product = element.closest('[data-test="product-grid-item"]');
  if (!product) return findGenericUrl(element);

  const link = product.querySelector('a[href*="/p/"]');
  if (link?.href) return link.href;

  return null;
}

function findBestBuyUrl(element) {
  const product = element.closest('.sku-item, [data-sku-id]');
  if (!product) return findGenericUrl(element);

  const link = product.querySelector('a[href*="/site/"]');
  if (link?.href) return link.href;

  return null;
}

function findNeweggUrl(element) {
  const item = element.closest('.item-cell, [data-item]');
  if (!item) return findGenericUrl(element);

  const link = item.querySelector('a.item-title');
  if (link?.href) return link.href;

  return null;
}

function findWishUrl(element) {
  const product = element.closest('[data-productid], .ProductCard');
  if (!product) return findGenericUrl(element);

  const link = product.querySelector('a[href*="/product/"]');
  if (link?.href) return link.href;

  return null;
}

export const ecommerceHandlers = {
  amazon: findAmazonUrl,
  ebay: findEbayUrl,
  etsy: findEtsyUrl,
  walmart: findWalmartUrl,
  flipkart: findFlipkartUrl,
  aliexpress: findAliexpressUrl,
  alibaba: findAlibabaUrl,
  shopify: findShopifyUrl,
  target: findTargetUrl,
  bestBuy: findBestBuyUrl,
  newegg: findNeweggUrl,
  wish: findWishUrl
};
