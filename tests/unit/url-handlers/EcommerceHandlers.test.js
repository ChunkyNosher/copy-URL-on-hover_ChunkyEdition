/**
 * Ecommerce Platform URL Handlers Tests
 * Tests for ecommerce platform URL detection
 */

import { ecommerceHandlers } from '../../../src/features/url-handlers/ecommerce.js';

const {
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
} = ecommerceHandlers;

describe('Ecommerce Platform URL Handlers', () => {
  describe('findAmazonUrl', () => {
    test('should extract URL from data-component-type="s-search-result"', () => {
      const product = document.createElement('div');
      product.setAttribute('data-component-type', 's-search-result');
      
      const link = document.createElement('a');
      link.className = 'a-link-normal';
      link.href = 'https://amazon.com/product-name/dp/B01234ABCD';
      product.appendChild(link);
      
      const result = findAmazonUrl(product);
      
      expect(result).toBe('https://amazon.com/product-name/dp/B01234ABCD');
    });

    test('should extract URL from .s-result-item with h2 link', () => {
      const item = document.createElement('div');
      item.className = 's-result-item';
      
      const h2 = document.createElement('h2');
      const link = document.createElement('a');
      link.href = 'https://amazon.com/dp/B09876ZYXW';
      h2.appendChild(link);
      item.appendChild(h2);
      
      const result = findAmazonUrl(item);
      
      expect(result).toBe('https://amazon.com/dp/B09876ZYXW');
    });

    test('should extract URL from data-asin container', () => {
      const product = document.createElement('div');
      product.setAttribute('data-asin', 'B012345678');
      
      const link = document.createElement('a');
      link.className = 'a-link-normal';
      link.href = 'https://amazon.com/title/dp/B012345678/ref=xyz';
      product.appendChild(link);
      
      const result = findAmazonUrl(product);
      
      expect(result).toBe('https://amazon.com/title/dp/B012345678/ref=xyz');
    });

    test('should require /dp/ in URL', () => {
      const product = document.createElement('div');
      product.className = 's-result-item';
      
      const link1 = document.createElement('a');
      link1.className = 'a-link-normal';
      link1.href = 'https://amazon.com/customer-reviews';
      product.appendChild(link1);
      
      const h2 = document.createElement('h2');
      const link2 = document.createElement('a');
      link2.href = 'https://amazon.com/product/dp/B123';
      h2.appendChild(link2);
      product.appendChild(h2);
      
      const result = findAmazonUrl(product);
      
      expect(result).toBe('https://amazon.com/product/dp/B123');
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);
      
      const result = findAmazonUrl(link);
      
      expect(result).toBe('https://example.com/');
    });

    test('should return null when no /dp/ link found', () => {
      const product = document.createElement('div');
      product.className = 's-result-item';
      
      const link = document.createElement('a');
      link.href = 'https://amazon.com/deals';
      product.appendChild(link);
      
      const result = findAmazonUrl(product);
      
      expect(result).toBeNull();
    });
  });

  describe('findEbayUrl', () => {
    test('should extract URL from .s-item with .s-item__link', () => {
      const item = document.createElement('div');
      item.className = 's-item';
      
      const link = document.createElement('a');
      link.className = 's-item__link';
      link.href = 'https://ebay.com/itm/123456789';
      item.appendChild(link);
      
      const result = findEbayUrl(item);
      
      expect(result).toBe('https://ebay.com/itm/123456789');
    });

    test('should extract URL from data-view="mi" with .vip link', () => {
      const item = document.createElement('div');
      item.setAttribute('data-view', 'mi');
      
      const vip = document.createElement('div');
      vip.className = 'vip';
      const link = document.createElement('a');
      link.href = 'https://ebay.com/itm/987654321';
      vip.appendChild(link);
      item.appendChild(vip);
      
      const result = findEbayUrl(item);
      
      expect(result).toBe('https://ebay.com/itm/987654321');
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);
      
      const result = findEbayUrl(link);
      
      expect(result).toBe('https://example.com/');
    });

    test('should return null when no matching link', () => {
      const item = document.createElement('div');
      item.className = 's-item';
      
      const link = document.createElement('a');
      link.href = 'https://ebay.com/deals';
      item.appendChild(link);
      
      const result = findEbayUrl(item);
      
      expect(result).toBeNull();
    });
  });

  describe('findEtsyUrl', () => {
    test('should extract URL from data-listing-id', () => {
      const listing = document.createElement('div');
      listing.setAttribute('data-listing-id', '123456');
      
      const link = document.createElement('a');
      link.href = 'https://etsy.com/listing/123456/product-name';
      listing.appendChild(link);
      
      const result = findEtsyUrl(listing);
      
      expect(result).toBe('https://etsy.com/listing/123456/product-name');
    });

    test('should extract URL from .listing-link', () => {
      const listing = document.createElement('a');
      listing.className = 'listing-link';
      
      const link = document.createElement('a');
      link.href = 'https://etsy.com/listing/789012/another-product';
      listing.appendChild(link);
      
      const result = findEtsyUrl(listing);
      
      expect(result).toBe('https://etsy.com/listing/789012/another-product');
    });

    test('should require /listing/ in URL', () => {
      const listing = document.createElement('div');
      listing.setAttribute('data-listing-id', '123');
      
      const link = document.createElement('a');
      link.href = 'https://etsy.com/shop/store-name';
      listing.appendChild(link);
      
      const result = findEtsyUrl(listing);
      
      expect(result).toBeNull();
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);
      
      const result = findEtsyUrl(link);
      
      expect(result).toBe('https://example.com/');
    });
  });

  describe('findWalmartUrl', () => {
    test('should extract URL from data-item-id', () => {
      const product = document.createElement('div');
      product.setAttribute('data-item-id', 'abc123');
      
      const link = document.createElement('a');
      link.href = 'https://walmart.com/ip/Product-Name/12345678';
      product.appendChild(link);
      
      const result = findWalmartUrl(product);
      
      expect(result).toBe('https://walmart.com/ip/Product-Name/12345678');
    });

    test('should extract URL from .search-result-gridview-item', () => {
      const item = document.createElement('div');
      item.className = 'search-result-gridview-item';
      
      const link = document.createElement('a');
      link.href = 'https://walmart.com/ip/87654321';
      item.appendChild(link);
      
      const result = findWalmartUrl(item);
      
      expect(result).toBe('https://walmart.com/ip/87654321');
    });

    test('should require /ip/ in URL', () => {
      const product = document.createElement('div');
      product.setAttribute('data-item-id', 'test');
      
      const link = document.createElement('a');
      link.href = 'https://walmart.com/browse/electronics';
      product.appendChild(link);
      
      const result = findWalmartUrl(product);
      
      expect(result).toBeNull();
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);
      
      const result = findWalmartUrl(link);
      
      expect(result).toBe('https://example.com/');
    });
  });

  describe('findFlipkartUrl', () => {
    test('should extract URL from data-id', () => {
      const product = document.createElement('div');
      product.setAttribute('data-id', 'PROD123');
      
      const link = document.createElement('a');
      link.href = 'https://flipkart.com/product-name/p/itm123456';
      product.appendChild(link);
      
      const result = findFlipkartUrl(product);
      
      expect(result).toBe('https://flipkart.com/product-name/p/itm123456');
    });

    test('should extract URL from ._2kHMtA class', () => {
      const product = document.createElement('div');
      product.className = '_2kHMtA';
      
      const link = document.createElement('a');
      link.href = 'https://flipkart.com/item/p/xyz789';
      product.appendChild(link);
      
      const result = findFlipkartUrl(product);
      
      expect(result).toBe('https://flipkart.com/item/p/xyz789');
    });

    test('should require /p/ in URL', () => {
      const product = document.createElement('div');
      product.className = '_2kHMtA';
      
      const link = document.createElement('a');
      link.href = 'https://flipkart.com/search?q=product';
      product.appendChild(link);
      
      const result = findFlipkartUrl(product);
      
      expect(result).toBeNull();
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);
      
      const result = findFlipkartUrl(link);
      
      expect(result).toBe('https://example.com/');
    });
  });

  describe('findAliexpressUrl', () => {
    test('should extract URL from data-product-id', () => {
      const product = document.createElement('div');
      product.setAttribute('data-product-id', '1234567890');
      
      const link = document.createElement('a');
      link.href = 'https://aliexpress.com/item/1234567890.html';
      product.appendChild(link);
      
      const result = findAliexpressUrl(product);
      
      expect(result).toBe('https://aliexpress.com/item/1234567890.html');
    });

    test('should extract URL from .product-item', () => {
      const product = document.createElement('div');
      product.className = 'product-item';
      
      const link = document.createElement('a');
      link.href = 'https://aliexpress.com/item/0987654321.html';
      product.appendChild(link);
      
      const result = findAliexpressUrl(product);
      
      expect(result).toBe('https://aliexpress.com/item/0987654321.html');
    });

    test('should require /item/ in URL', () => {
      const product = document.createElement('div');
      product.className = 'product-item';
      
      const link = document.createElement('a');
      link.href = 'https://aliexpress.com/store/123456';
      product.appendChild(link);
      
      const result = findAliexpressUrl(product);
      
      expect(result).toBeNull();
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);
      
      const result = findAliexpressUrl(link);
      
      expect(result).toBe('https://example.com/');
    });
  });

  describe('findAlibabaUrl', () => {
    test('should extract URL from data-content', () => {
      const product = document.createElement('div');
      product.setAttribute('data-content', 'product-info');
      
      const link = document.createElement('a');
      link.href = 'https://alibaba.com/product-detail/item123';
      product.appendChild(link);
      
      const result = findAlibabaUrl(product);
      
      expect(result).toBe('https://alibaba.com/product-detail/item123');
    });

    test('should extract URL from .organic-list-offer', () => {
      const product = document.createElement('div');
      product.className = 'organic-list-offer';
      
      const link = document.createElement('a');
      link.href = 'https://alibaba.com/product-detail/xyz789';
      product.appendChild(link);
      
      const result = findAlibabaUrl(product);
      
      expect(result).toBe('https://alibaba.com/product-detail/xyz789');
    });

    test('should require /product-detail/ in URL', () => {
      const product = document.createElement('div');
      product.className = 'organic-list-offer';
      
      const link = document.createElement('a');
      link.href = 'https://alibaba.com/suppliers/company';
      product.appendChild(link);
      
      const result = findAlibabaUrl(product);
      
      expect(result).toBeNull();
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);
      
      const result = findAlibabaUrl(link);
      
      expect(result).toBe('https://example.com/');
    });
  });

  describe('findShopifyUrl', () => {
    test('should extract URL from .product-item', () => {
      const product = document.createElement('div');
      product.className = 'product-item';
      
      const link = document.createElement('a');
      link.href = 'https://store.myshopify.com/products/awesome-product';
      product.appendChild(link);
      
      const result = findShopifyUrl(product);
      
      expect(result).toBe('https://store.myshopify.com/products/awesome-product');
    });

    test('should extract URL from .grid-item', () => {
      const product = document.createElement('div');
      product.className = 'grid-item';
      
      const link = document.createElement('a');
      link.href = 'https://shop.example.com/products/item-123';
      product.appendChild(link);
      
      const result = findShopifyUrl(product);
      
      expect(result).toBe('https://shop.example.com/products/item-123');
    });

    test('should extract URL from data-product-id', () => {
      const product = document.createElement('div');
      product.setAttribute('data-product-id', '789');
      
      const link = document.createElement('a');
      link.href = 'https://store.com/products/product-name';
      product.appendChild(link);
      
      const result = findShopifyUrl(product);
      
      expect(result).toBe('https://store.com/products/product-name');
    });

    test('should require /products/ in URL', () => {
      const product = document.createElement('div');
      product.className = 'product-item';
      
      const link = document.createElement('a');
      link.href = 'https://store.myshopify.com/collections/all';
      product.appendChild(link);
      
      const result = findShopifyUrl(product);
      
      expect(result).toBeNull();
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);
      
      const result = findShopifyUrl(link);
      
      expect(result).toBe('https://example.com/');
    });
  });

  describe('findTargetUrl', () => {
    test('should extract URL from data-test="product-grid-item"', () => {
      const product = document.createElement('div');
      product.setAttribute('data-test', 'product-grid-item');
      
      const link = document.createElement('a');
      link.href = 'https://target.com/p/product-name/-/A-12345678';
      product.appendChild(link);
      
      const result = findTargetUrl(product);
      
      expect(result).toBe('https://target.com/p/product-name/-/A-12345678');
    });

    test('should require /p/ in URL', () => {
      const product = document.createElement('div');
      product.setAttribute('data-test', 'product-grid-item');
      
      const link = document.createElement('a');
      link.href = 'https://target.com/c/category';
      product.appendChild(link);
      
      const result = findTargetUrl(product);
      
      expect(result).toBeNull();
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);
      
      const result = findTargetUrl(link);
      
      expect(result).toBe('https://example.com/');
    });
  });

  describe('findBestBuyUrl', () => {
    test('should extract URL from .sku-item', () => {
      const product = document.createElement('div');
      product.className = 'sku-item';
      
      const link = document.createElement('a');
      link.href = 'https://bestbuy.com/site/product-name/1234567.p';
      product.appendChild(link);
      
      const result = findBestBuyUrl(product);
      
      expect(result).toBe('https://bestbuy.com/site/product-name/1234567.p');
    });

    test('should extract URL from data-sku-id', () => {
      const product = document.createElement('div');
      product.setAttribute('data-sku-id', '987654');
      
      const link = document.createElement('a');
      link.href = 'https://bestbuy.com/site/item/987654.p';
      product.appendChild(link);
      
      const result = findBestBuyUrl(product);
      
      expect(result).toBe('https://bestbuy.com/site/item/987654.p');
    });

    test('should require /site/ in URL', () => {
      const product = document.createElement('div');
      product.className = 'sku-item';
      
      const link = document.createElement('a');
      link.href = 'https://bestbuy.com/deals';
      product.appendChild(link);
      
      const result = findBestBuyUrl(product);
      
      expect(result).toBeNull();
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);
      
      const result = findBestBuyUrl(link);
      
      expect(result).toBe('https://example.com/');
    });
  });

  describe('findNeweggUrl', () => {
    test('should extract URL from .item-cell with .item-title', () => {
      const item = document.createElement('div');
      item.className = 'item-cell';
      
      const link = document.createElement('a');
      link.className = 'item-title';
      link.href = 'https://newegg.com/product/N82E16-123';
      item.appendChild(link);
      
      const result = findNeweggUrl(item);
      
      expect(result).toBe('https://newegg.com/product/N82E16-123');
    });

    test('should extract URL from data-item', () => {
      const item = document.createElement('div');
      item.setAttribute('data-item', 'product-123');
      
      const link = document.createElement('a');
      link.className = 'item-title';
      link.href = 'https://newegg.com/item/XYZ789';
      item.appendChild(link);
      
      const result = findNeweggUrl(item);
      
      expect(result).toBe('https://newegg.com/item/XYZ789');
    });

    test('should require .item-title class', () => {
      const item = document.createElement('div');
      item.className = 'item-cell';
      
      const link = document.createElement('a');
      link.href = 'https://newegg.com/product/ABC';
      item.appendChild(link);
      
      const result = findNeweggUrl(item);
      
      expect(result).toBeNull();
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);
      
      const result = findNeweggUrl(link);
      
      expect(result).toBe('https://example.com/');
    });
  });

  describe('findWishUrl', () => {
    test('should extract URL from data-productid', () => {
      const product = document.createElement('div');
      product.setAttribute('data-productid', 'abc123xyz');
      
      const link = document.createElement('a');
      link.href = 'https://wish.com/product/abc123xyz';
      product.appendChild(link);
      
      const result = findWishUrl(product);
      
      expect(result).toBe('https://wish.com/product/abc123xyz');
    });

    test('should extract URL from .ProductCard', () => {
      const product = document.createElement('div');
      product.className = 'ProductCard';
      
      const link = document.createElement('a');
      link.href = 'https://wish.com/product/xyz789abc';
      product.appendChild(link);
      
      const result = findWishUrl(product);
      
      expect(result).toBe('https://wish.com/product/xyz789abc');
    });

    test('should require /product/ in URL', () => {
      const product = document.createElement('div');
      product.className = 'ProductCard';
      
      const link = document.createElement('a');
      link.href = 'https://wish.com/browse';
      product.appendChild(link);
      
      const result = findWishUrl(product);
      
      expect(result).toBeNull();
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);
      
      const result = findWishUrl(link);
      
      expect(result).toBe('https://example.com/');
    });
  });
});
