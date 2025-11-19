/**
 * Social Media URL Handlers Tests
 * Tests for social media platform URL detection
 */

import { social_mediaHandlers } from '../../../src/features/url-handlers/social-media.js';

const {
  twitter: findTwitterUrl,
  reddit: findRedditUrl,
  linkedIn: findLinkedInUrl,
  instagram: findInstagramUrl,
  facebook: findFacebookUrl,
  tikTok: findTikTokUrl,
  mastodon: findMastodonUrl,
  bluesky: findBlueskyUrl,
  threads: findThreadsUrl,
  snapchat: findSnapchatUrl,
  whatsapp: findWhatsappUrl,
  telegram: findTelegramUrl
} = social_mediaHandlers;

describe('Social Media URL Handlers', () => {
  describe('findTwitterUrl', () => {
    test('should extract URL from direct link element', () => {
      const link = document.createElement('a');
      link.href = 'https://twitter.com/user/status/123456';
      
      const result = findTwitterUrl(link);
      
      expect(result).toBe('https://twitter.com/user/status/123456');
    });

    test('should return null when element has no href', () => {
      const div = document.createElement('div');
      
      const result = findTwitterUrl(div);
      
      expect(result).toBeNull();
    });

    test('should extract URL from nested link', () => {
      const container = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://x.com/user/status/789012';
      container.appendChild(link);
      
      const result = findTwitterUrl(link);
      
      expect(result).toBe('https://x.com/user/status/789012');
    });

    test('should handle element with empty href', () => {
      const link = document.createElement('a');
      link.href = '';
      
      const result = findTwitterUrl(link);
      
      // Empty href resolves to current page URL (localhost in tests)
      expect(result).toContain('localhost');
    });
  });

  describe('findRedditUrl', () => {
    test('should extract URL from post container with data-testid', () => {
      const post = document.createElement('div');
      post.setAttribute('data-testid', 'post-container');
      
      const titleLink = document.createElement('a');
      titleLink.setAttribute('data-testid', 'post-title');
      titleLink.href = 'https://reddit.com/r/programming/comments/abc123/title';
      post.appendChild(titleLink);
      
      const span = document.createElement('span');
      post.appendChild(span);
      
      const result = findRedditUrl(span);
      
      expect(result).toBe('https://reddit.com/r/programming/comments/abc123/title');
    });

    test('should extract URL from .Post container', () => {
      const post = document.createElement('div');
      post.className = 'Post';
      
      const h3 = document.createElement('h3');
      const titleLink = document.createElement('a');
      titleLink.href = 'https://reddit.com/r/webdev/comments/xyz789/post';
      h3.appendChild(titleLink);
      post.appendChild(h3);
      
      const img = document.createElement('img');
      post.appendChild(img);
      
      const result = findRedditUrl(img);
      
      expect(result).toBe('https://reddit.com/r/webdev/comments/xyz789/post');
    });

    test('should extract URL from role="article" container with data-click-id', () => {
      const article = document.createElement('article');
      article.setAttribute('role', 'article');
      
      const container = document.createElement('div');
      container.setAttribute('data-click-id', 'body');
      
      const link = document.createElement('a');
      link.href = 'https://old.reddit.com/r/javascript/comments/test123';
      container.appendChild(link);
      article.appendChild(container);
      
      const button = document.createElement('button');
      article.appendChild(button);
      
      const result = findRedditUrl(button);
      
      expect(result).toBe('https://old.reddit.com/r/javascript/comments/test123');
    });

    test('should fallback to generic handler when no post container found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com';
      div.appendChild(link);
      
      // findGenericUrl will be called, which returns the direct link
      const result = findRedditUrl(link);
      
      expect(result).toBe('https://example.com/');
    });

    test('should return null when post has no title link', () => {
      const post = document.createElement('div');
      post.setAttribute('data-testid', 'post-container');
      
      const span = document.createElement('span');
      post.appendChild(span);
      
      const result = findRedditUrl(span);
      
      expect(result).toBeNull();
    });

    test('should handle .PostTitle selector', () => {
      const post = document.createElement('div');
      post.className = 'post-container';
      
      const titleDiv = document.createElement('div');
      titleDiv.className = 'PostTitle';
      const link = document.createElement('a');
      link.href = 'https://reddit.com/r/test/comments/abc';
      titleDiv.appendChild(link);
      post.appendChild(titleDiv);
      
      const result = findRedditUrl(post);
      
      expect(result).toBe('https://reddit.com/r/test/comments/abc');
    });
  });

  describe('findLinkedInUrl', () => {
    test('should extract URL from feed-shared-update-v2 container', () => {
      const post = document.createElement('div');
      post.className = 'feed-shared-update-v2';
      
      const link1 = document.createElement('a');
      link1.href = 'https://linkedin.com/feed/update/123';
      post.appendChild(link1);
      
      const link2 = document.createElement('a');
      link2.href = 'https://linkedin.com/in/profile';
      post.appendChild(link2);
      
      const result = findLinkedInUrl(post);
      
      expect(result).toBe('https://linkedin.com/feed/update/123');
    });

    test('should extract URL from data-id container', () => {
      const post = document.createElement('div');
      post.setAttribute('data-id', 'activity-123');
      
      const link = document.createElement('a');
      link.href = 'https://linkedin.com/posts/company-123';
      post.appendChild(link);
      
      const result = findLinkedInUrl(post);
      
      expect(result).toBe('https://linkedin.com/posts/company-123');
    });

    test('should prioritize /feed/ URLs over other URLs', () => {
      const post = document.createElement('div');
      post.setAttribute('data-test', 'activity-item');
      
      const link1 = document.createElement('a');
      link1.href = 'https://linkedin.com/in/someone';
      post.appendChild(link1);
      
      const link2 = document.createElement('a');
      link2.href = 'https://linkedin.com/feed/update/xyz';
      post.appendChild(link2);
      
      const result = findLinkedInUrl(post);
      
      expect(result).toBe('https://linkedin.com/feed/update/xyz');
    });

    test('should fallback to generic handler when no post found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/page';
      div.appendChild(link);
      
      const result = findLinkedInUrl(link);
      
      expect(result).toBe('https://example.com/page');
    });

    test('should return null when post has no matching links', () => {
      const post = document.createElement('div');
      post.className = 'feed-shared-update-v2';
      
      const link = document.createElement('a');
      link.href = 'https://linkedin.com/in/profile';
      post.appendChild(link);
      
      const result = findLinkedInUrl(post);
      
      expect(result).toBeNull();
    });
  });

  describe('findInstagramUrl', () => {
    test('should extract URL from article with /p/ link', () => {
      const article = document.createElement('article');
      article.setAttribute('role', 'article');
      
      const link = document.createElement('a');
      link.href = 'https://instagram.com/p/ABC123xyz/';
      article.appendChild(link);
      
      const img = document.createElement('img');
      article.appendChild(img);
      
      const result = findInstagramUrl(img);
      
      expect(result).toBe('https://instagram.com/p/ABC123xyz/');
    });

    test('should extract URL from article with /reel/ link', () => {
      const article = document.createElement('article');
      
      const link = document.createElement('a');
      link.href = 'https://instagram.com/reel/XYZ789/';
      article.appendChild(link);
      
      const result = findInstagramUrl(article);
      
      expect(result).toBe('https://instagram.com/reel/XYZ789/');
    });

    test('should extract URL from time element link', () => {
      const article = document.createElement('article');
      article.setAttribute('role', 'article');
      
      const time = document.createElement('time');
      const link = document.createElement('a');
      link.href = 'https://instagram.com/p/timestamp123/';
      time.appendChild(link);
      article.appendChild(time);
      
      const result = findInstagramUrl(article);
      
      expect(result).toBe('https://instagram.com/p/timestamp123/');
    });

    test('should fallback to generic handler when no article found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com';
      div.appendChild(link);
      
      const result = findInstagramUrl(link);
      
      expect(result).toBe('https://example.com/');
    });

    test('should return null when article has no matching link', () => {
      const article = document.createElement('article');
      
      const link = document.createElement('a');
      link.href = 'https://instagram.com/username/';
      article.appendChild(link);
      
      const result = findInstagramUrl(article);
      
      expect(result).toBeNull();
    });
  });

  describe('findFacebookUrl', () => {
    test('should extract /posts/ URL from role="article"', () => {
      const article = document.createElement('div');
      article.setAttribute('role', 'article');
      
      const link = document.createElement('a');
      link.href = 'https://facebook.com/user/posts/123456789';
      article.appendChild(link);
      
      const result = findFacebookUrl(article);
      
      expect(result).toBe('https://facebook.com/user/posts/123456789');
    });

    test('should extract /photos/ URL from data-testid="post"', () => {
      const post = document.createElement('div');
      post.setAttribute('data-testid', 'post');
      
      const link = document.createElement('a');
      link.href = 'https://facebook.com/photos/abc123';
      post.appendChild(link);
      
      const result = findFacebookUrl(post);
      
      expect(result).toBe('https://facebook.com/photos/abc123');
    });

    test('should extract /videos/ URL', () => {
      const article = document.createElement('div');
      article.setAttribute('role', 'article');
      
      const link = document.createElement('a');
      link.href = 'https://facebook.com/videos/456789123';
      article.appendChild(link);
      
      const result = findFacebookUrl(article);
      
      expect(result).toBe('https://facebook.com/videos/456789123');
    });

    test('should return first matching link when multiple exist', () => {
      const article = document.createElement('div');
      article.setAttribute('role', 'article');
      
      const link1 = document.createElement('a');
      link1.href = 'https://facebook.com/posts/111';
      article.appendChild(link1);
      
      const link2 = document.createElement('a');
      link2.href = 'https://facebook.com/posts/222';
      article.appendChild(link2);
      
      const result = findFacebookUrl(article);
      
      expect(result).toBe('https://facebook.com/posts/111');
    });

    test('should fallback to generic handler when no post found', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com';
      div.appendChild(link);
      
      const result = findFacebookUrl(link);
      
      expect(result).toBe('https://example.com/');
    });

    test('should return null when no matching links found', () => {
      const article = document.createElement('div');
      article.setAttribute('role', 'article');
      
      const link = document.createElement('a');
      link.href = 'https://facebook.com/username';
      article.appendChild(link);
      
      const result = findFacebookUrl(article);
      
      expect(result).toBeNull();
    });
  });

  describe('findTikTokUrl', () => {
    test('should extract URL from data-e2e="user-post-item"', () => {
      const video = document.createElement('div');
      video.setAttribute('data-e2e', 'user-post-item');
      
      const link = document.createElement('a');
      link.href = 'https://tiktok.com/@username/video/123456789';
      video.appendChild(link);
      
      const result = findTikTokUrl(video);
      
      expect(result).toBe('https://tiktok.com/@username/video/123456789');
    });

    test('should extract URL from .video-feed-item', () => {
      const video = document.createElement('div');
      video.className = 'video-feed-item';
      
      const link = document.createElement('a');
      link.href = 'https://tiktok.com/@creator/video/987654321';
      video.appendChild(link);
      
      const result = findTikTokUrl(video);
      
      expect(result).toBe('https://tiktok.com/@creator/video/987654321');
    });

    test('should require /@ in URL', () => {
      const video = document.createElement('div');
      video.className = 'video-feed-item';
      
      const link1 = document.createElement('a');
      link1.href = 'https://tiktok.com/trending';
      video.appendChild(link1);
      
      const link2 = document.createElement('a');
      link2.href = 'https://tiktok.com/@user/video/123';
      video.appendChild(link2);
      
      const result = findTikTokUrl(video);
      
      expect(result).toBe('https://tiktok.com/@user/video/123');
    });

    test('should fallback to generic handler when no video container', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com';
      div.appendChild(link);
      
      const result = findTikTokUrl(link);
      
      expect(result).toBe('https://example.com/');
    });

    test('should return null when no matching link', () => {
      const video = document.createElement('div');
      video.setAttribute('data-e2e', 'user-post-item');
      
      const link = document.createElement('a');
      link.href = 'https://tiktok.com/trending';
      video.appendChild(link);
      
      const result = findTikTokUrl(video);
      
      expect(result).toBeNull();
    });
  });

  describe('findMastodonUrl', () => {
    test('should extract toot URL from .status with timestamp link', () => {
      const status = document.createElement('div');
      status.className = 'status';
      
      const link = document.createElement('a');
      link.className = 'status__relative-time';
      link.href = 'https://mastodon.social/@user/123456789';
      status.appendChild(link);
      
      const result = findMastodonUrl(status);
      
      expect(result).toBe('https://mastodon.social/@user/123456789');
    });

    test('should extract URL from detailed status datetime', () => {
      const status = document.createElement('div');
      status.setAttribute('data-id', 'status-123');
      
      const link = document.createElement('a');
      link.className = 'detailed-status__datetime';
      link.href = 'https://mastodon.xyz/@creator/987654';
      status.appendChild(link);
      
      const result = findMastodonUrl(status);
      
      expect(result).toBe('https://mastodon.xyz/@creator/987654');
    });

    test('should fallback to generic handler when no status container', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com';
      div.appendChild(link);
      
      const result = findMastodonUrl(link);
      
      expect(result).toBe('https://example.com/');
    });

    test('should return null when no matching timestamp link', () => {
      const status = document.createElement('div');
      status.className = 'status';
      
      const link = document.createElement('a');
      link.href = 'https://mastodon.social/@user';
      status.appendChild(link);
      
      const result = findMastodonUrl(status);
      
      expect(result).toBeNull();
    });
  });

  describe('findBlueskyUrl', () => {
    test('should extract post URL from data-testid="postThreadItem"', () => {
      const post = document.createElement('div');
      post.setAttribute('data-testid', 'postThreadItem');
      
      const link = document.createElement('a');
      link.href = 'https://bsky.app/profile/user.bsky.social/post/abc123';
      post.appendChild(link);
      
      const result = findBlueskyUrl(post);
      
      expect(result).toBe('https://bsky.app/profile/user.bsky.social/post/abc123');
    });

    test('should extract post URL from role="article"', () => {
      const article = document.createElement('article');
      article.setAttribute('role', 'article');
      
      const link = document.createElement('a');
      link.href = 'https://bsky.app/profile/creator.bsky.social/post/xyz789';
      article.appendChild(link);
      
      const result = findBlueskyUrl(article);
      
      expect(result).toBe('https://bsky.app/profile/creator.bsky.social/post/xyz789');
    });

    test('should fallback to generic handler when no post container', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com';
      div.appendChild(link);
      
      const result = findBlueskyUrl(link);
      
      expect(result).toBe('https://example.com/');
    });

    test('should return null when no /post/ link found', () => {
      const post = document.createElement('div');
      post.setAttribute('data-testid', 'postThreadItem');
      
      const link = document.createElement('a');
      link.href = 'https://bsky.app/profile/user.bsky.social';
      post.appendChild(link);
      
      const result = findBlueskyUrl(post);
      
      expect(result).toBeNull();
    });
  });

  describe('findThreadsUrl', () => {
    test('should extract thread URL from role="article" with /t/ link', () => {
      const article = document.createElement('article');
      article.setAttribute('role', 'article');
      
      const link = document.createElement('a');
      link.href = 'https://threads.net/t/ABC123xyz';
      article.appendChild(link);
      
      const result = findThreadsUrl(article);
      
      expect(result).toBe('https://threads.net/t/ABC123xyz');
    });

    test('should extract URL from time element link', () => {
      const article = document.createElement('article');
      article.setAttribute('role', 'article');
      
      const time = document.createElement('time');
      const link = document.createElement('a');
      link.href = 'https://threads.net/@username/post/XYZ789';
      time.appendChild(link);
      article.appendChild(time);
      
      const result = findThreadsUrl(article);
      
      expect(result).toBe('https://threads.net/@username/post/XYZ789');
    });

    test('should fallback to generic handler when no article', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com';
      div.appendChild(link);
      
      const result = findThreadsUrl(link);
      
      expect(result).toBe('https://example.com/');
    });

    test('should return null when no /t/ link found', () => {
      const article = document.createElement('article');
      article.setAttribute('role', 'article');
      
      const link = document.createElement('a');
      link.href = 'https://threads.net/@username';
      article.appendChild(link);
      
      const result = findThreadsUrl(article);
      
      expect(result).toBeNull();
    });
  });

  describe('findSnapchatUrl', () => {
    test('should extract URL from role="article" with /add/ link', () => {
      const article = document.createElement('article');
      article.setAttribute('role', 'article');
      
      const link = document.createElement('a');
      link.href = 'https://snapchat.com/add/username';
      article.appendChild(link);
      
      const result = findSnapchatUrl(article);
      
      expect(result).toBe('https://snapchat.com/add/username');
    });

    test('should extract URL from .Story with /spotlight/ link', () => {
      const story = document.createElement('div');
      story.className = 'Story';
      
      const link = document.createElement('a');
      link.href = 'https://snapchat.com/spotlight/abc123';
      story.appendChild(link);
      
      const result = findSnapchatUrl(story);
      
      expect(result).toBe('https://snapchat.com/spotlight/abc123');
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com';
      div.appendChild(link);
      
      const result = findSnapchatUrl(link);
      
      expect(result).toBe('https://example.com/');
    });

    test('should return null when no matching link', () => {
      const article = document.createElement('article');
      article.setAttribute('role', 'article');
      
      const link = document.createElement('a');
      link.href = 'https://snapchat.com/discover';
      article.appendChild(link);
      
      const result = findSnapchatUrl(article);
      
      expect(result).toBeNull();
    });
  });

  describe('findWhatsappUrl', () => {
    test('should return current page URL', () => {
      // WhatsApp Web is a single-page app
      const originalLocation = window.location.href;
      
      const result = findWhatsappUrl(document.body);
      
      expect(result).toBe(originalLocation);
    });

    test('should work with any element', () => {
      const div = document.createElement('div');
      
      const result = findWhatsappUrl(div);
      
      expect(result).toBe(window.location.href);
    });
  });

  describe('findTelegramUrl', () => {
    test('should extract t.me URL from .message', () => {
      const message = document.createElement('div');
      message.className = 'message';
      
      const link = document.createElement('a');
      link.href = 'https://t.me/channel/123';
      message.appendChild(link);
      
      const result = findTelegramUrl(message);
      
      expect(result).toBe('https://t.me/channel/123');
    });

    test('should extract URL from data-mid container', () => {
      const message = document.createElement('div');
      message.setAttribute('data-mid', 'msg-456');
      
      const link = document.createElement('a');
      link.href = 'https://t.me/c/789/999';
      message.appendChild(link);
      
      const result = findTelegramUrl(message);
      
      expect(result).toBe('https://t.me/c/789/999');
    });

    test('should fallback to generic handler when no message container', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com';
      div.appendChild(link);
      
      const result = findTelegramUrl(link);
      
      expect(result).toBe('https://example.com/');
    });

    test('should return null when no t.me link found', () => {
      const message = document.createElement('div');
      message.className = 'message';
      
      const link = document.createElement('a');
      link.href = 'https://telegram.org';
      message.appendChild(link);
      
      const result = findTelegramUrl(message);
      
      expect(result).toBeNull();
    });
  });
});
