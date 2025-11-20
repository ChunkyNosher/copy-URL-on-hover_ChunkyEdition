/**
 * Generic URL Handler Tests
 * Tests for generic/fallback URL detection
 */

import { findGenericUrl, getLinkText } from '../../../src/features/url-handlers/generic.js';

describe('Generic URL Handler', () => {
  describe('findGenericUrl', () => {
    describe('Direct href handling', () => {
      test('should return href from element with href', () => {
        const link = document.createElement('a');
        link.href = 'https://example.com/page';

        const result = findGenericUrl(link);

        expect(result).toBe('https://example.com/page');
      });

      test('should handle complex URLs', () => {
        const link = document.createElement('a');
        link.href = 'https://example.com/path?param1=value1&param2=value2#fragment';

        const result = findGenericUrl(link);

        expect(result).toBe('https://example.com/path?param1=value1&param2=value2#fragment');
      });

      test('should handle relative URLs', () => {
        const link = document.createElement('a');
        link.href = '/relative/path';
        // jsdom converts relative URLs to absolute based on document.baseURI
        // so we just check that href is accessible
        expect(link.href).toBeTruthy();

        const result = findGenericUrl(link);
        expect(result).toBeTruthy();
      });
    });

    describe('Closest link handling', () => {
      test('should find closest parent link', () => {
        const link = document.createElement('a');
        link.href = 'https://example.com/parent';

        const span = document.createElement('span');
        span.textContent = 'Click me';
        link.appendChild(span);

        const result = findGenericUrl(span);

        expect(result).toBe('https://example.com/parent');
      });

      test('should find closest link through multiple levels', () => {
        const link = document.createElement('a');
        link.href = 'https://example.com/deep';

        const div = document.createElement('div');
        const span = document.createElement('span');
        const textNode = document.createElement('strong');
        textNode.textContent = 'Deep text';

        link.appendChild(div);
        div.appendChild(span);
        span.appendChild(textNode);

        const result = findGenericUrl(textNode);

        expect(result).toBe('https://example.com/deep');
      });

      test('should handle element without parent link', () => {
        const div = document.createElement('div');
        div.textContent = 'No link here';

        const result = findGenericUrl(div);

        expect(result).toBeNull();
      });
    });

    describe('Container link detection', () => {
      test('should find link inside ARTICLE element', () => {
        const article = document.createElement('article');
        const link = document.createElement('a');
        link.href = 'https://example.com/article';
        article.appendChild(link);

        const result = findGenericUrl(article);

        expect(result).toBe('https://example.com/article');
      });

      test('should find link inside element with role="article"', () => {
        const div = document.createElement('div');
        div.setAttribute('role', 'article');

        const link = document.createElement('a');
        link.href = 'https://example.com/role-article';
        div.appendChild(link);

        const result = findGenericUrl(div);

        expect(result).toBe('https://example.com/role-article');
      });

      test('should find link inside element with role="link"', () => {
        const div = document.createElement('div');
        div.setAttribute('role', 'link');

        const link = document.createElement('a');
        link.href = 'https://example.com/role-link';
        div.appendChild(link);

        const result = findGenericUrl(div);

        expect(result).toBe('https://example.com/role-link');
      });

      test('should find link inside element with class="post"', () => {
        const div = document.createElement('div');
        div.className = 'post';

        const link = document.createElement('a');
        link.href = 'https://example.com/post';
        div.appendChild(link);

        const result = findGenericUrl(div);

        expect(result).toBe('https://example.com/post');
      });

      test('should find link inside element with data-testid', () => {
        const div = document.createElement('div');
        div.setAttribute('data-testid', 'item-123');

        const link = document.createElement('a');
        link.href = 'https://example.com/testid';
        div.appendChild(link);

        const result = findGenericUrl(div);

        expect(result).toBe('https://example.com/testid');
      });

      test('should find link inside element with data-id', () => {
        const div = document.createElement('div');
        div.setAttribute('data-id', '456');

        const link = document.createElement('a');
        link.href = 'https://example.com/dataid';
        div.appendChild(link);

        const result = findGenericUrl(div);

        expect(result).toBe('https://example.com/dataid');
      });

      test('should not search inside non-container elements', () => {
        const div = document.createElement('div');
        // No container attributes

        const link = document.createElement('a');
        link.href = 'https://example.com/non-container';
        div.appendChild(link);

        const result = findGenericUrl(div);

        // Should not find inner link because div is not a container
        expect(result).toBeNull();
      });

      test('should return first link in container', () => {
        const article = document.createElement('article');

        const link1 = document.createElement('a');
        link1.href = 'https://example.com/first';
        article.appendChild(link1);

        const link2 = document.createElement('a');
        link2.href = 'https://example.com/second';
        article.appendChild(link2);

        const result = findGenericUrl(article);

        expect(result).toBe('https://example.com/first');
      });
    });

    describe('Edge cases', () => {
      test('should return null for element without any links', () => {
        const div = document.createElement('div');
        div.textContent = 'Just text, no links';

        const result = findGenericUrl(div);

        expect(result).toBeNull();
      });

      test('should handle null element gracefully', () => {
        expect(() => findGenericUrl(null)).toThrow();
      });

      test('should handle link without href attribute', () => {
        const link = document.createElement('a');
        // No href set

        const result = findGenericUrl(link);

        // Link.href returns empty string or current page URL in jsdom
        // We just verify it doesn't crash
        expect(result === null || typeof result === 'string').toBe(true);
      });

      test('should prioritize direct href over parent link', () => {
        const parentLink = document.createElement('a');
        parentLink.href = 'https://example.com/parent';

        const childLink = document.createElement('a');
        childLink.href = 'https://example.com/child';
        parentLink.appendChild(childLink);

        const result = findGenericUrl(childLink);

        expect(result).toBe('https://example.com/child');
      });

      test('should prioritize closest link over container link', () => {
        const article = document.createElement('article');

        const containerLink = document.createElement('a');
        containerLink.href = 'https://example.com/container';
        article.appendChild(containerLink);

        const parentLink = document.createElement('a');
        parentLink.href = 'https://example.com/parent';
        article.appendChild(parentLink);

        const span = document.createElement('span');
        parentLink.appendChild(span);

        const result = findGenericUrl(span);

        expect(result).toBe('https://example.com/parent');
      });
    });

    describe('Multiple class names', () => {
      test('should match element with multiple classes including "post"', () => {
        const div = document.createElement('div');
        div.className = 'card post featured';

        const link = document.createElement('a');
        link.href = 'https://example.com/multi-class';
        div.appendChild(link);

        const result = findGenericUrl(div);

        expect(result).toBe('https://example.com/multi-class');
      });
    });
  });

  describe('getLinkText', () => {
    test('should get text from anchor element', () => {
      const link = document.createElement('a');
      link.textContent = 'Click here';

      const result = getLinkText(link);

      expect(result).toBe('Click here');
    });

    test('should trim whitespace from anchor text', () => {
      const link = document.createElement('a');
      link.textContent = '  Trimmed text  ';

      const result = getLinkText(link);

      expect(result).toBe('Trimmed text');
    });

    test('should get text from first link inside element', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.textContent = 'Link text';
      div.appendChild(link);

      const result = getLinkText(div);

      expect(result).toBe('Link text');
    });

    test('should truncate long text to 100 chars', () => {
      const div = document.createElement('div');
      const longText = 'a'.repeat(150);
      div.textContent = longText;

      const result = getLinkText(div);

      expect(result.length).toBe(100);
      expect(result).toBe('a'.repeat(100));
    });

    test('should handle element without link', () => {
      const div = document.createElement('div');
      div.textContent = 'Just text, no link';

      const result = getLinkText(div);

      expect(result).toBe('Just text, no link');
    });

    test('should handle empty element', () => {
      const div = document.createElement('div');

      const result = getLinkText(div);

      expect(result).toBe('');
    });

    test('should extract nested text from link', () => {
      const link = document.createElement('a');
      const span = document.createElement('span');
      span.textContent = 'Nested ';
      link.appendChild(span);

      const strong = document.createElement('strong');
      strong.textContent = 'text';
      link.appendChild(strong);

      const result = getLinkText(link);

      expect(result).toBe('Nested text');
    });

    test('should get link text from within container', () => {
      const div = document.createElement('div');
      
      const link = document.createElement('a');
      link.textContent = 'Link text';
      div.appendChild(link);

      const result = getLinkText(div);

      // When container has a link, returns the link's text
      expect(result).toBe('Link text');
    });
  });
});
