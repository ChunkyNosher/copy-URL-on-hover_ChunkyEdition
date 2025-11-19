/**
 * Tests for URLHandlerRegistry
 * v1.6.0 - Phase 7.6: URL handler coverage improvement
 *
 * Target: Bring url-handlers from 0% to 50%+
 */

import { jest } from '@jest/globals';

import { URLHandlerRegistry } from '../../../src/features/url-handlers/index.js';

describe('URLHandlerRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new URLHandlerRegistry();
  });

  describe('Constructor', () => {
    test('should initialize with all handler categories', () => {
      expect(registry.handlers).toBeDefined();
      expect(typeof registry.handlers).toBe('object');
      expect(Object.keys(registry.handlers).length).toBeGreaterThan(0);
    });

    test('should merge handlers from all categories', () => {
      const supportedDomains = registry.getSupportedDomains();

      // Verify we have handlers from multiple categories
      expect(supportedDomains.length).toBeGreaterThan(10); // Should have many handlers
    });
  });

  describe('findURL()', () => {
    test('should return href from direct A element', () => {
      const link = document.createElement('a');
      link.href = 'https://example.com/page';

      const result = registry.findURL(link, 'unknown');

      expect(result).toBe('https://example.com/page');
    });

    test('should find href in parent elements (1 level)', () => {
      const link = document.createElement('a');
      link.href = 'https://example.com/nested';

      const span = document.createElement('span');
      span.textContent = 'Click me';
      link.appendChild(span);

      const result = registry.findURL(span, 'unknown');

      expect(result).toBe('https://example.com/nested');
    });

    test('should find href in parent elements (multiple levels)', () => {
      const link = document.createElement('a');
      link.href = 'https://example.com/deep';

      const div1 = document.createElement('div');
      const div2 = document.createElement('div');
      const span = document.createElement('span');

      link.appendChild(div1);
      div1.appendChild(div2);
      div2.appendChild(span);

      const result = registry.findURL(span, 'unknown');

      expect(result).toBe('https://example.com/deep');
    });

    test('should prioritize direct href over parent href', () => {
      const outerLink = document.createElement('a');
      outerLink.href = 'https://example.com/outer';

      const innerLink = document.createElement('a');
      innerLink.href = 'https://example.com/inner';

      outerLink.appendChild(innerLink);

      const result = registry.findURL(innerLink, 'unknown');

      // Should return inner link's href
      expect(result).toBe('https://example.com/inner');
    });

    test('should use site-specific handler when available', () => {
      // Mock a handler
      const mockHandler = jest.fn(() => 'https://twitter.com/user/status/123');
      registry.handlers.twitter = mockHandler;

      const element = document.createElement('div');
      element.setAttribute('data-tweet-id', '123');

      const result = registry.findURL(element, 'twitter');

      expect(mockHandler).toHaveBeenCalledWith(element);
      expect(result).toBe('https://twitter.com/user/status/123');
    });

    test('should use generic handler as final fallback', () => {
      // Mock a handler that returns null
      const mockHandler = jest.fn(() => null);
      registry.handlers.customsite = mockHandler;

      // Create element without direct link (generic will be used)
      const div = document.createElement('div');

      const result = registry.findURL(div, 'customsite');

      expect(mockHandler).toHaveBeenCalled();
      // Generic handler returns null for plain div
      expect(result).toBeNull();
    });

    test('should handle element without any links', () => {
      const div = document.createElement('div');
      div.textContent = 'No links here';

      const result = registry.findURL(div, 'unknown');

      // Generic handler returns null
      expect(result).toBeNull();
    });
  });

  describe('getSupportedDomains()', () => {
    test('should return array of domain type keys', () => {
      const domains = registry.getSupportedDomains();

      expect(Array.isArray(domains)).toBe(true);
      expect(domains.length).toBeGreaterThan(0);
    });

    test('should not include duplicate domains', () => {
      const domains = registry.getSupportedDomains();
      const uniqueDomains = [...new Set(domains)];

      expect(domains.length).toBe(uniqueDomains.length);
    });
  });

  describe('isSupported()', () => {
    test('should return true for supported domains', () => {
      // Get a real supported domain
      const domains = registry.getSupportedDomains();
      expect(domains.length).toBeGreaterThan(0);

      const firstDomain = domains[0];
      const result = registry.isSupported(firstDomain);

      expect(result).toBe(true);
    });

    test('should return false for unsupported domains', () => {
      const result = registry.isSupported('totally-fake-domain-123');

      expect(result).toBe(false);
    });

    test('should handle empty string', () => {
      const result = registry.isSupported('');

      expect(result).toBe(false);
    });

    test('should handle null', () => {
      const result = registry.isSupported(null);

      expect(result).toBe(false);
    });

    test('should handle undefined', () => {
      const result = registry.isSupported(undefined);

      expect(result).toBe(false);
    });
  });

  describe('Handler Integration', () => {
    test('should preserve all handlers after initialization', () => {
      const domains = registry.getSupportedDomains();

      // Verify all handlers are functions
      for (const domain of domains) {
        expect(typeof registry.handlers[domain]).toBe('function');
      }
    });

    test('should allow adding custom handlers', () => {
      const customHandler = jest.fn(() => 'https://custom.com/url');
      registry.handlers.customdomain = customHandler;

      expect(registry.isSupported('customdomain')).toBe(true);

      const element = document.createElement('div');
      const result = registry.findURL(element, 'customdomain');

      expect(customHandler).toHaveBeenCalledWith(element);
      expect(result).toBe('https://custom.com/url');
    });
  });

  describe('Edge Cases', () => {
    test('should handle detached elements', () => {
      const link = document.createElement('a');
      link.href = 'https://example.com/detached';
      // Not appended to document

      const result = registry.findURL(link, 'unknown');

      expect(result).toBe('https://example.com/detached');
    });

    test('should handle elements with special characters in href', () => {
      const link = document.createElement('a');
      link.href = 'https://example.com/path?query=value&foo=bar#fragment';

      const result = registry.findURL(link, 'unknown');

      expect(result).toBe('https://example.com/path?query=value&foo=bar#fragment');
    });

    test('should find URL in link container with role=article', () => {
      const container = document.createElement('div');
      container.setAttribute('role', 'article');
      const link = document.createElement('a');
      link.href = 'https://example.com/in-role-article';
      container.appendChild(link);

      const result = registry.findURL(container, 'unknown');

      // Generic handler searches within elements with role=article
      expect(result).toBe('https://example.com/in-role-article');
    });

    test('should check up to 20 parent levels', () => {
      // Create a link at top
      const link = document.createElement('a');
      link.href = 'https://example.com/deep-parent';

      // Create nested structure (15 levels)
      let current = link;
      for (let i = 0; i < 15; i++) {
        const div = document.createElement('div');
        current.appendChild(div);
        current = div;
      }

      // Target element is 15 levels deep (within limit)
      const result = registry.findURL(current, 'unknown');

      // Should find parent link
      expect(result).toBe('https://example.com/deep-parent');
    });

    test('should handle empty href', () => {
      const link = document.createElement('a');
      link.href = '';

      const result = registry.findURL(link, 'unknown');

      // Empty href gets resolved to base URL by browser
      expect(result).toContain('localhost');
    });
  });
});
