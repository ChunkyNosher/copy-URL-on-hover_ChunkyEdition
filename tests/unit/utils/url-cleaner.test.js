/**
 * URL Cleaner Unit Tests
 * Tests for tracking parameter removal utility
 *
 * @version 1.6.4
 */

import { cleanUrl, TRACKING_PARAMS } from '../../../src/utils/url-cleaner.js';

describe('URL Cleaner', () => {
  describe('TRACKING_PARAMS', () => {
    test('should export array of tracking parameters', () => {
      expect(Array.isArray(TRACKING_PARAMS)).toBe(true);
      expect(TRACKING_PARAMS.length).toBeGreaterThan(0);
    });

    test('should include common UTM parameters', () => {
      expect(TRACKING_PARAMS).toContain('utm_source');
      expect(TRACKING_PARAMS).toContain('utm_medium');
      expect(TRACKING_PARAMS).toContain('utm_campaign');
    });

    test('should include Facebook tracking parameters', () => {
      expect(TRACKING_PARAMS).toContain('fbclid');
      expect(TRACKING_PARAMS).toContain('fb_action_ids');
    });

    test('should include Google tracking parameters', () => {
      expect(TRACKING_PARAMS).toContain('gclid');
      expect(TRACKING_PARAMS).toContain('gclsrc');
    });

    test('should include Amazon tracking parameters', () => {
      expect(TRACKING_PARAMS).toContain('tag');
      expect(TRACKING_PARAMS).toContain('linkCode');
      expect(TRACKING_PARAMS).toContain('ref');
    });
  });

  describe('cleanUrl()', () => {
    describe('basic functionality', () => {
      test('should remove single UTM parameter', () => {
        const url = 'https://example.com/page?utm_source=twitter';
        const expected = 'https://example.com/page';
        expect(cleanUrl(url)).toBe(expected);
      });

      test('should remove multiple UTM parameters', () => {
        const url = 'https://example.com/page?utm_source=twitter&utm_medium=social&utm_campaign=spring';
        const expected = 'https://example.com/page';
        expect(cleanUrl(url)).toBe(expected);
      });

      test('should keep non-tracking parameters', () => {
        const url = 'https://example.com/page?id=123&name=test&utm_source=twitter';
        const expected = 'https://example.com/page?id=123&name=test';
        expect(cleanUrl(url)).toBe(expected);
      });

      test('should handle mixed tracking and non-tracking parameters', () => {
        const url = 'https://example.com/page?id=123&utm_source=twitter&category=news&fbclid=abc123';
        const expected = 'https://example.com/page?id=123&category=news';
        expect(cleanUrl(url)).toBe(expected);
      });
    });

    describe('tracking parameter categories', () => {
      test('should remove Facebook tracking parameters', () => {
        const url = 'https://example.com/page?fbclid=abc123&fb_action_ids=456';
        const expected = 'https://example.com/page';
        expect(cleanUrl(url)).toBe(expected);
      });

      test('should remove Google tracking parameters', () => {
        const url = 'https://example.com/page?gclid=abc123&gclsrc=test';
        const expected = 'https://example.com/page';
        expect(cleanUrl(url)).toBe(expected);
      });

      test('should remove Amazon tracking parameters', () => {
        const url = 'https://amazon.com/product?tag=affiliate-20&linkCode=osi';
        const expected = 'https://amazon.com/product';
        expect(cleanUrl(url)).toBe(expected);
      });

      test('should remove analytics parameters', () => {
        const url = 'https://example.com/page?_ga=123&_gl=456';
        const expected = 'https://example.com/page';
        expect(cleanUrl(url)).toBe(expected);
      });

      test('should remove YouTube tracking while preserving content params', () => {
        const url = 'https://youtube.com/watch?v=dQw4w9WgXcQ&feature=share&si=abc123';
        const expected = 'https://youtube.com/watch?v=dQw4w9WgXcQ';
        expect(cleanUrl(url)).toBe(expected);
      });
    });

    describe('edge cases', () => {
      test('should return URL unchanged if no parameters', () => {
        const url = 'https://example.com/page';
        expect(cleanUrl(url)).toBe(url);
      });

      test('should return URL unchanged if no tracking parameters', () => {
        const url = 'https://example.com/page?id=123&name=test';
        expect(cleanUrl(url)).toBe(url);
      });

      test('should remove question mark if all params are tracking', () => {
        const url = 'https://example.com/page?utm_source=twitter';
        const expected = 'https://example.com/page';
        expect(cleanUrl(url)).toBe(expected);
        expect(expected).not.toContain('?');
      });

      test('should preserve hash fragments', () => {
        const url = 'https://example.com/page?utm_source=twitter#section1';
        const expected = 'https://example.com/page#section1';
        expect(cleanUrl(url)).toBe(expected);
      });

      test('should preserve hash fragments with remaining params', () => {
        const url = 'https://example.com/page?id=123&utm_source=twitter#section1';
        const expected = 'https://example.com/page?id=123#section1';
        expect(cleanUrl(url)).toBe(expected);
      });

      test('should handle URLs with ports', () => {
        const url = 'https://example.com:8080/page?utm_source=twitter';
        const expected = 'https://example.com:8080/page';
        expect(cleanUrl(url)).toBe(expected);
      });

      test('should handle URLs with subdomains', () => {
        const url = 'https://blog.example.com/page?utm_source=twitter';
        const expected = 'https://blog.example.com/page';
        expect(cleanUrl(url)).toBe(expected);
      });

      test('should handle complex paths', () => {
        const url = 'https://example.com/path/to/deep/page?utm_source=twitter';
        const expected = 'https://example.com/path/to/deep/page';
        expect(cleanUrl(url)).toBe(expected);
      });
    });

    describe('invalid input handling', () => {
      test('should return invalid URL string unchanged', () => {
        const invalidUrl = 'not-a-valid-url';
        expect(cleanUrl(invalidUrl)).toBe(invalidUrl);
      });

      test('should handle null input', () => {
        expect(cleanUrl(null)).toBe(null);
      });

      test('should handle undefined input', () => {
        expect(cleanUrl(undefined)).toBe(undefined);
      });

      test('should handle empty string', () => {
        expect(cleanUrl('')).toBe('');
      });

      test('should handle non-string input', () => {
        const numInput = 123;
        const objInput = {};
        const arrInput = [];
        expect(cleanUrl(numInput)).toBe(numInput);
        expect(cleanUrl(objInput)).toBe(objInput);
        expect(cleanUrl(arrInput)).toBe(arrInput);
      });
    });

    describe('real-world URLs', () => {
      test('should clean Amazon product URL', () => {
        const url = 'https://www.amazon.com/product/dp/B08N5WRWNW?tag=test-20&linkCode=ogi&th=1&psc=1';
        const expected = 'https://www.amazon.com/product/dp/B08N5WRWNW?th=1';
        expect(cleanUrl(url)).toBe(expected);
      });

      test('should clean YouTube video URL', () => {
        const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=youtu.be&si=abc123';
        const expected = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
        expect(cleanUrl(url)).toBe(expected);
      });

      test('should clean Facebook shared URL', () => {
        const url = 'https://www.facebook.com/share/page?fbclid=IwAR123456&u=https://example.com';
        const expected = 'https://www.facebook.com/share/page?u=https%3A%2F%2Fexample.com';
        expect(cleanUrl(url)).toBe(expected);
      });

      test('should clean Google search result URL', () => {
        const url = 'https://example.com/page?gclid=abc123&gclsrc=aw.ds&id=456';
        const expected = 'https://example.com/page?id=456';
        expect(cleanUrl(url)).toBe(expected);
      });

      test('should clean email campaign URL', () => {
        const url = 'https://example.com/page?utm_source=newsletter&utm_medium=email&utm_campaign=july2024&id=123';
        const expected = 'https://example.com/page?id=123';
        expect(cleanUrl(url)).toBe(expected);
      });

      test('should clean URL with multiple tracking systems', () => {
        const url = 'https://example.com/page?id=123&utm_source=twitter&fbclid=abc&gclid=def&_ga=xyz';
        const expected = 'https://example.com/page?id=123';
        expect(cleanUrl(url)).toBe(expected);
      });
    });

    describe('parameter order preservation', () => {
      test('should preserve order of remaining parameters', () => {
        const url = 'https://example.com/page?first=1&utm_source=twitter&second=2&fbclid=abc&third=3';
        const cleaned = cleanUrl(url);
        // Should maintain the order: first, second, third
        expect(cleaned).toBe('https://example.com/page?first=1&second=2&third=3');
      });
    });

    describe('special characters in parameters', () => {
      test('should handle URL-encoded values', () => {
        const url = 'https://example.com/page?name=John%20Doe&utm_source=twitter';
        const cleaned = cleanUrl(url);
        // URL API may normalize encoding differently
        expect(cleaned.startsWith('https://example.com/page?name=')).toBe(true);
        expect(cleaned).not.toContain('utm_source');
      });

      test('should handle special characters in remaining params', () => {
        const url = 'https://example.com/page?query=test+value&utm_source=twitter';
        const cleaned = cleanUrl(url);
        expect(cleaned.startsWith('https://example.com/page?query=')).toBe(true);
        expect(cleaned).not.toContain('utm_source');
      });
    });
  });
});
