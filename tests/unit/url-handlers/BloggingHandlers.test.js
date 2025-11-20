/**
 * Blogging Platform URL Handlers Tests
 * Tests for blogging platform URL detection (Medium, Dev.to, etc.)
 */

import { bloggingHandlers } from '../../../src/features/url-handlers/blogging.js';

const {
  medium: findMediumUrl,
  devTo: findDevToUrl,
  hashnode: findHashnodeUrl,
  substack: findSubstackUrl,
  wordpress: findWordpressUrl,
  blogger: findBloggerUrl,
  ghost: findGhostUrl,
  notion: findNotionUrl
} = bloggingHandlers;

describe('Blogging Platform URL Handlers', () => {
  describe('findMediumUrl', () => {
    test('should extract URL from article with data-post-id', () => {
      const article = document.createElement('article');
      article.setAttribute('data-post-id', '123456');

      const link = document.createElement('a');
      link.setAttribute('data-action', 'open-post');
      link.href = 'https://medium.com/@author/post-title-abc123';
      article.appendChild(link);

      const element = document.createElement('div');
      article.appendChild(element);

      const result = findMediumUrl(element);

      expect(result).toBe('https://medium.com/@author/post-title-abc123');
    });

    test('should extract URL from h2 link in article', () => {
      const article = document.createElement('article');

      const h2 = document.createElement('h2');
      const link = document.createElement('a');
      link.href = 'https://medium.com/@author/another-post-xyz789';
      h2.appendChild(link);
      article.appendChild(h2);

      const element = document.createElement('span');
      article.appendChild(element);

      const result = findMediumUrl(element);

      expect(result).toBe('https://medium.com/@author/another-post-xyz789');
    });

    test('should extract URL from h3 link in article', () => {
      const article = document.createElement('article');

      const h3 = document.createElement('h3');
      const link = document.createElement('a');
      link.href = 'https://medium.com/publication/story-title-def456';
      h3.appendChild(link);
      article.appendChild(h3);

      const element = document.createElement('div');
      article.appendChild(element);

      const result = findMediumUrl(element);

      expect(result).toBe('https://medium.com/publication/story-title-def456');
    });

    test('should fallback to generic when no article found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findMediumUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no link in article', () => {
      const article = document.createElement('article');
      article.setAttribute('data-post-id', '123');

      const element = document.createElement('div');
      article.appendChild(element);

      const result = findMediumUrl(element);

      expect(result).toBeNull();
    });
  });

  describe('findDevToUrl', () => {
    test('should extract URL from crayons-story', () => {
      const story = document.createElement('div');
      story.className = 'crayons-story';

      const h2 = document.createElement('h2');
      const link = document.createElement('a');
      link.href = 'https://dev.to/author/article-title-123';
      h2.appendChild(link);
      story.appendChild(h2);

      const element = document.createElement('span');
      story.appendChild(element);

      const result = findDevToUrl(element);

      expect(result).toBe('https://dev.to/author/article-title-123');
    });

    test('should extract URL from data-article-id element', () => {
      const article = document.createElement('div');
      article.setAttribute('data-article-id', '456789');

      const link = document.createElement('a');
      link.id = 'article-link-456789';
      link.href = 'https://dev.to/community/post-abc';
      article.appendChild(link);

      const element = document.createElement('div');
      article.appendChild(element);

      const result = findDevToUrl(element);

      expect(result).toBe('https://dev.to/community/post-abc');
    });

    test('should fallback to generic when no article found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/page';
      div.appendChild(link);

      const result = findDevToUrl(link);

      expect(result).toBe('https://example.com/page');
    });

    test('should return null when no link in article', () => {
      const story = document.createElement('div');
      story.className = 'crayons-story';

      const element = document.createElement('div');
      story.appendChild(element);

      const result = findDevToUrl(element);

      expect(result).toBeNull();
    });
  });

  describe('findHashnodeUrl', () => {
    test('should extract URL from post-card', () => {
      const card = document.createElement('div');
      card.className = 'post-card';

      const h2 = document.createElement('h2');
      const link = document.createElement('a');
      link.href = 'https://hashnode.dev/post/article-title-123';
      h2.appendChild(link);
      card.appendChild(h2);

      const element = document.createElement('span');
      card.appendChild(element);

      const result = findHashnodeUrl(element);

      expect(result).toBe('https://hashnode.dev/post/article-title-123');
    });

    test('should extract URL from data-post-id element', () => {
      const post = document.createElement('article');
      post.setAttribute('data-post-id', 'abc123');

      const link = document.createElement('a');
      link.href = 'https://blog.hashnode.dev/post/my-article';
      post.appendChild(link);

      const element = document.createElement('div');
      post.appendChild(element);

      const result = findHashnodeUrl(element);

      expect(result).toBe('https://blog.hashnode.dev/post/my-article');
    });

    test('should fallback to generic when no post found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findHashnodeUrl(link);

      expect(result).toBe('https://example.com/');
    });
  });

  describe('findSubstackUrl', () => {
    test('should extract URL from post element', () => {
      const post = document.createElement('div');
      post.className = 'post';

      const h2 = document.createElement('h2');
      const link = document.createElement('a');
      link.href = 'https://newsletter.substack.com/p/post-title';
      h2.appendChild(link);
      post.appendChild(h2);

      const element = document.createElement('span');
      post.appendChild(element);

      const result = findSubstackUrl(element);

      expect(result).toBe('https://newsletter.substack.com/p/post-title');
    });

    test('should extract URL from data-testid post-preview', () => {
      const preview = document.createElement('article');
      preview.setAttribute('data-testid', 'post-preview');

      const h3 = document.createElement('h3');
      const link = document.createElement('a');
      link.href = 'https://author.substack.com/p/article-123';
      h3.appendChild(link);
      preview.appendChild(h3);

      const element = document.createElement('div');
      preview.appendChild(element);

      const result = findSubstackUrl(element);

      expect(result).toBe('https://author.substack.com/p/article-123');
    });

    test('should fallback to generic when no post found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findSubstackUrl(link);

      expect(result).toBe('https://example.com/');
    });
  });

  describe('findWordpressUrl', () => {
    test('should extract URL from post with entry-title-link', () => {
      const post = document.createElement('article');
      post.className = 'post';

      const link = document.createElement('a');
      link.className = 'entry-title-link';
      link.href = 'https://myblog.wordpress.com/2024/post-title/';
      post.appendChild(link);

      const element = document.createElement('div');
      post.appendChild(element);

      const result = findWordpressUrl(element);

      expect(result).toBe('https://myblog.wordpress.com/2024/post-title/');
    });

    test('should extract URL from h2 link in hentry', () => {
      const entry = document.createElement('div');
      entry.className = 'hentry';

      const h2 = document.createElement('h2');
      const link = document.createElement('a');
      link.href = 'https://site.com/blog/article/';
      h2.appendChild(link);
      entry.appendChild(h2);

      const element = document.createElement('span');
      entry.appendChild(element);

      const result = findWordpressUrl(element);

      expect(result).toBe('https://site.com/blog/article/');
    });

    test('should extract URL from entry-title link', () => {
      const article = document.createElement('article');

      const title = document.createElement('div');
      title.className = 'entry-title';
      const link = document.createElement('a');
      link.href = 'https://blog.example.com/post-123/';
      title.appendChild(link);
      article.appendChild(title);

      const element = document.createElement('div');
      article.appendChild(element);

      const result = findWordpressUrl(element);

      expect(result).toBe('https://blog.example.com/post-123/');
    });

    test('should fallback to generic when no post found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findWordpressUrl(link);

      expect(result).toBe('https://example.com/');
    });
  });

  describe('findBloggerUrl', () => {
    test('should extract URL from post element', () => {
      const post = document.createElement('div');
      post.className = 'post';

      const h3 = document.createElement('h3');
      h3.className = 'post-title';
      const link = document.createElement('a');
      link.href = 'https://myblog.blogspot.com/2024/post-title.html';
      h3.appendChild(link);
      post.appendChild(h3);

      const element = document.createElement('span');
      post.appendChild(element);

      const result = findBloggerUrl(element);

      expect(result).toBe('https://myblog.blogspot.com/2024/post-title.html');
    });

    test('should extract URL from post-outer', () => {
      const outer = document.createElement('div');
      outer.className = 'post-outer';

      const link = document.createElement('a');
      link.className = 'post-title';
      link.href = 'https://author.blogspot.com/2024/article.html';
      outer.appendChild(link);

      const element = document.createElement('div');
      outer.appendChild(element);

      const result = findBloggerUrl(element);

      expect(result).toBe('https://author.blogspot.com/2024/article.html');
    });

    test('should fallback to generic when no post found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findBloggerUrl(link);

      expect(result).toBe('https://example.com/');
    });
  });

  describe('findGhostUrl', () => {
    test('should extract URL from post-card', () => {
      const card = document.createElement('div');
      card.className = 'post-card';

      const title = document.createElement('div');
      title.className = 'post-card-title';
      const link = document.createElement('a');
      link.href = 'https://blog.example.com/post-title/';
      title.appendChild(link);
      card.appendChild(title);

      const element = document.createElement('span');
      card.appendChild(element);

      const result = findGhostUrl(element);

      expect(result).toBe('https://blog.example.com/post-title/');
    });

    test('should extract URL from h2 link in article', () => {
      const article = document.createElement('article');

      const h2 = document.createElement('h2');
      const link = document.createElement('a');
      link.href = 'https://ghost-site.com/article-123/';
      h2.appendChild(link);
      article.appendChild(h2);

      const element = document.createElement('div');
      article.appendChild(element);

      const result = findGhostUrl(element);

      expect(result).toBe('https://ghost-site.com/article-123/');
    });

    test('should fallback to generic when no post found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findGhostUrl(link);

      expect(result).toBe('https://example.com/');
    });
  });

  describe('findNotionUrl', () => {
    test('should return current page URL', () => {
      // Mock window.location.href
      const originalLocation = window.location.href;

      Object.defineProperty(window, 'location', {
        value: {
          href: 'https://notion.so/page-123'
        },
        writable: true
      });

      const element = document.createElement('div');
      const result = findNotionUrl(element);

      expect(result).toBe('https://notion.so/page-123');

      // Restore original location
      Object.defineProperty(window, 'location', {
        value: {
          href: originalLocation
        },
        writable: true
      });
    });
  });
});
