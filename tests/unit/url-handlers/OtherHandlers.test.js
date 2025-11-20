/**
 * Other Platform URL Handlers Tests
 * Tests for other platform URL detection (Archive.org, Patreon, etc.)
 */

import { otherHandlers } from '../../../src/features/url-handlers/other.js';

const {
  archiveOrg: findArchiveOrgUrl,
  patreon: findPatreonUrl,
  koFi: findKoFiUrl,
  buyMeACoffee: findBuyMeACoffeeUrl,
  gumroad: findGumroadUrl
} = otherHandlers;

describe('Other Platform URL Handlers', () => {
  describe('findArchiveOrgUrl', () => {
    test('should extract URL from item-ia class', () => {
      const item = document.createElement('div');
      item.className = 'item-ia';

      const link = document.createElement('a');
      link.href = 'https://archive.org/details/item-identifier';
      item.appendChild(link);

      const element = document.createElement('span');
      item.appendChild(element);

      const result = findArchiveOrgUrl(element);

      expect(result).toBe('https://archive.org/details/item-identifier');
    });

    test('should extract URL from data-id element', () => {
      const item = document.createElement('div');
      item.setAttribute('data-id', 'archive-123');

      const link = document.createElement('a');
      link.href = 'https://archive.org/details/book-collection';
      item.appendChild(link);

      const element = document.createElement('div');
      item.appendChild(element);

      const result = findArchiveOrgUrl(element);

      expect(result).toBe('https://archive.org/details/book-collection');
    });

    test('should fallback to generic when no item found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findArchiveOrgUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no link in item', () => {
      const item = document.createElement('div');
      item.className = 'item-ia';

      const element = document.createElement('div');
      item.appendChild(element);

      const result = findArchiveOrgUrl(element);

      expect(result).toBeNull();
    });
  });

  describe('findPatreonUrl', () => {
    test('should extract URL from post-card', () => {
      const post = document.createElement('div');
      post.setAttribute('data-tag', 'post-card');

      const link = document.createElement('a');
      link.href = 'https://www.patreon.com/posts/post-title-12345678';
      post.appendChild(link);

      const element = document.createElement('span');
      post.appendChild(element);

      const result = findPatreonUrl(element);

      expect(result).toBe('https://www.patreon.com/posts/post-title-12345678');
    });

    test('should extract post URL with ID', () => {
      const post = document.createElement('div');
      post.setAttribute('data-tag', 'post-card');

      const link = document.createElement('a');
      link.href = 'https://www.patreon.com/posts/87654321';
      post.appendChild(link);

      const element = document.createElement('div');
      post.appendChild(element);

      const result = findPatreonUrl(element);

      expect(result).toBe('https://www.patreon.com/posts/87654321');
    });

    test('should fallback to generic when no post found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findPatreonUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no link in post', () => {
      const post = document.createElement('div');
      post.setAttribute('data-tag', 'post-card');

      const element = document.createElement('div');
      post.appendChild(element);

      const result = findPatreonUrl(element);

      expect(result).toBeNull();
    });
  });

  describe('findKoFiUrl', () => {
    test('should extract URL from feed-item', () => {
      const item = document.createElement('div');
      item.className = 'feed-item';

      const link = document.createElement('a');
      link.href = 'https://ko-fi.com/username/post/abc123xyz';
      item.appendChild(link);

      const element = document.createElement('span');
      item.appendChild(element);

      const result = findKoFiUrl(element);

      expect(result).toBe('https://ko-fi.com/username/post/abc123xyz');
    });

    test('should extract URL from data-post-id', () => {
      const post = document.createElement('div');
      post.setAttribute('data-post-id', 'xyz789abc');

      const link = document.createElement('a');
      link.href = 'https://ko-fi.com/creator/post/xyz789abc';
      post.appendChild(link);

      const element = document.createElement('div');
      post.appendChild(element);

      const result = findKoFiUrl(element);

      expect(result).toBe('https://ko-fi.com/creator/post/xyz789abc');
    });

    test('should fallback to generic when no post found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findKoFiUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no link in feed item', () => {
      const item = document.createElement('div');
      item.className = 'feed-item';

      const element = document.createElement('div');
      item.appendChild(element);

      const result = findKoFiUrl(element);

      expect(result).toBeNull();
    });
  });

  describe('findBuyMeACoffeeUrl', () => {
    test('should extract URL from feed-card', () => {
      const card = document.createElement('div');
      card.className = 'feed-card';

      const link = document.createElement('a');
      link.href = 'https://www.buymeacoffee.com/username/p/post-title-abc123';
      card.appendChild(link);

      const element = document.createElement('span');
      card.appendChild(element);

      const result = findBuyMeACoffeeUrl(element);

      expect(result).toBe('https://www.buymeacoffee.com/username/p/post-title-abc123');
    });

    test('should extract post URL with ID', () => {
      const card = document.createElement('div');
      card.className = 'feed-card';

      const link = document.createElement('a');
      link.href = 'https://buymeacoffee.com/creator/p/xyz789';
      card.appendChild(link);

      const element = document.createElement('div');
      card.appendChild(element);

      const result = findBuyMeACoffeeUrl(element);

      expect(result).toBe('https://buymeacoffee.com/creator/p/xyz789');
    });

    test('should fallback to generic when no card found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findBuyMeACoffeeUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no link in feed card', () => {
      const card = document.createElement('div');
      card.className = 'feed-card';

      const element = document.createElement('div');
      card.appendChild(element);

      const result = findBuyMeACoffeeUrl(element);

      expect(result).toBeNull();
    });
  });

  describe('findGumroadUrl', () => {
    test('should extract URL from data-permalink', () => {
      const product = document.createElement('div');
      product.setAttribute('data-permalink', 'product-name');

      const link = document.createElement('a');
      link.href = 'https://username.gumroad.com/l/product-name';
      product.appendChild(link);

      const element = document.createElement('span');
      product.appendChild(element);

      const result = findGumroadUrl(element);

      expect(result).toBe('https://username.gumroad.com/l/product-name');
    });

    test('should extract URL from product-card', () => {
      const card = document.createElement('div');
      card.className = 'product-card';

      const link = document.createElement('a');
      link.href = 'https://gumroad.com/l/awesome-product';
      card.appendChild(link);

      const element = document.createElement('div');
      card.appendChild(element);

      const result = findGumroadUrl(element);

      expect(result).toBe('https://gumroad.com/l/awesome-product');
    });

    test('should extract creator store URL', () => {
      const product = document.createElement('div');
      product.setAttribute('data-permalink', 'digital-product');

      const link = document.createElement('a');
      link.href = 'https://creator.gumroad.com/l/digital-product';
      product.appendChild(link);

      const element = document.createElement('span');
      product.appendChild(element);

      const result = findGumroadUrl(element);

      expect(result).toBe('https://creator.gumroad.com/l/digital-product');
    });

    test('should fallback to generic when no product found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findGumroadUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no link in product', () => {
      const product = document.createElement('div');
      product.className = 'product-card';

      const element = document.createElement('div');
      product.appendChild(element);

      const result = findGumroadUrl(element);

      expect(result).toBeNull();
    });
  });
});
