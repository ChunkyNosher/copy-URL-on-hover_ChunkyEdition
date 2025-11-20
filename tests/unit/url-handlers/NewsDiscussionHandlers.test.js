/**
 * News Discussion Platform URL Handlers Tests
 * Tests for news discussion platform URL detection
 */

import { news_discussionHandlers } from '../../../src/features/url-handlers/news-discussion.js';

const {
  hackerNews: findHackerNewsUrl,
  productHunt: findProductHuntUrl,
  quora: findQuoraUrl,
  discord: findDiscordUrl,
  slack: findSlackUrl,
  lobsters: findLobstersUrl,
  googleNews: findGoogleNewsUrl,
  feedly: findFeedlyUrl
} = news_discussionHandlers;

describe('News Discussion Platform URL Handlers', () => {
  describe('findHackerNewsUrl', () => {
    test('should extract URL from .athing with .titlelink', () => {
      const row = document.createElement('tr');
      row.className = 'athing';

      const link = document.createElement('a');
      link.className = 'titlelink';
      link.href = 'https://example.com/article';
      row.appendChild(link);

      const span = document.createElement('span');
      row.appendChild(span);

      const result = findHackerNewsUrl(span);

      expect(result).toBe('https://example.com/article');
    });

    test('should extract URL from .athing with .storylink', () => {
      const row = document.createElement('tr');
      row.className = 'athing';

      const link = document.createElement('a');
      link.className = 'storylink';
      link.href = 'https://news.ycombinator.com/item?id=123456';
      row.appendChild(link);

      const result = findHackerNewsUrl(row);

      expect(result).toBe('https://news.ycombinator.com/item?id=123456');
    });

    test('should fallback to generic handler when no .athing', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findHackerNewsUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when .athing has no matching link', () => {
      const row = document.createElement('tr');
      row.className = 'athing';

      const link = document.createElement('a');
      link.href = 'https://example.com';
      row.appendChild(link);

      const result = findHackerNewsUrl(row);

      expect(result).toBeNull();
    });
  });

  describe('findProductHuntUrl', () => {
    test('should extract URL from data-test="post-item"', () => {
      const item = document.createElement('div');
      item.setAttribute('data-test', 'post-item');

      const link = document.createElement('a');
      link.href = 'https://producthunt.com/posts/awesome-product';
      item.appendChild(link);

      const result = findProductHuntUrl(item);

      expect(result).toBe('https://producthunt.com/posts/awesome-product');
    });

    test('should require /posts/ in URL', () => {
      const item = document.createElement('div');
      item.setAttribute('data-test', 'post-item');

      const link1 = document.createElement('a');
      link1.href = 'https://producthunt.com/user/someone';
      item.appendChild(link1);

      const link2 = document.createElement('a');
      link2.href = 'https://producthunt.com/posts/product';
      item.appendChild(link2);

      const result = findProductHuntUrl(item);

      expect(result).toBe('https://producthunt.com/posts/product');
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findProductHuntUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no /posts/ link', () => {
      const item = document.createElement('div');
      item.setAttribute('data-test', 'post-item');

      const link = document.createElement('a');
      link.href = 'https://producthunt.com/topics';
      item.appendChild(link);

      const result = findProductHuntUrl(item);

      expect(result).toBeNull();
    });
  });

  describe('findQuoraUrl', () => {
    test('should extract URL from data-scroll-id with /q/ link', () => {
      const question = document.createElement('div');
      question.setAttribute('data-scroll-id', 'question-123');

      const link = document.createElement('a');
      link.href = 'https://quora.com/q/test-question';
      question.appendChild(link);

      const result = findQuoraUrl(question);

      expect(result).toBe('https://quora.com/q/test-question');
    });

    test('should extract URL from .q-box with /question/ link', () => {
      const question = document.createElement('div');
      question.className = 'q-box';

      const link = document.createElement('a');
      link.href = 'https://quora.com/question/what-is-something';
      question.appendChild(link);

      const result = findQuoraUrl(question);

      expect(result).toBe('https://quora.com/question/what-is-something');
    });

    test('should extract URL with .question_link class', () => {
      const question = document.createElement('div');
      question.setAttribute('data-scroll-id', 'q-456');

      const link = document.createElement('a');
      link.className = 'question_link';
      link.href = 'https://quora.com/How-do-I-test';
      question.appendChild(link);

      const result = findQuoraUrl(question);

      expect(result).toBe('https://quora.com/How-do-I-test');
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findQuoraUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no matching link', () => {
      const question = document.createElement('div');
      question.className = 'q-box';

      const link = document.createElement('a');
      link.href = 'https://quora.com/profile/user';
      question.appendChild(link);

      const result = findQuoraUrl(question);

      expect(result).toBeNull();
    });
  });

  describe('findDiscordUrl', () => {
    test('should extract URL from message starting with chat-messages-', () => {
      const message = document.createElement('div');
      message.id = 'chat-messages-123456789';

      const link = document.createElement('a');
      link.href = 'https://discord.com/channels/server/channel/message';
      message.appendChild(link);

      const result = findDiscordUrl(message);

      expect(result).toBe('https://discord.com/channels/server/channel/message');
    });

    test('should extract URL from .message class', () => {
      const message = document.createElement('div');
      message.className = 'message';

      const link = document.createElement('a');
      link.href = 'https://example.com/article';
      message.appendChild(link);

      const result = findDiscordUrl(message);

      expect(result).toBe('https://example.com/article');
    });

    test('should get first link in message', () => {
      const message = document.createElement('div');
      message.className = 'message';

      const link1 = document.createElement('a');
      link1.href = 'https://first.com';
      message.appendChild(link1);

      const link2 = document.createElement('a');
      link2.href = 'https://second.com';
      message.appendChild(link2);

      const result = findDiscordUrl(message);

      expect(result).toBe('https://first.com/');
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findDiscordUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when message has no links', () => {
      const message = document.createElement('div');
      message.className = 'message';

      const span = document.createElement('span');
      span.textContent = 'Text message';
      message.appendChild(span);

      const result = findDiscordUrl(message);

      expect(result).toBeNull();
    });
  });

  describe('findSlackUrl', () => {
    test('should extract URL from data-qa="message_container"', () => {
      const message = document.createElement('div');
      message.setAttribute('data-qa', 'message_container');

      const link = document.createElement('a');
      link.href = 'https://workspace.slack.com/archives/channel123/p123456';
      message.appendChild(link);

      const result = findSlackUrl(message);

      expect(result).toBe('https://workspace.slack.com/archives/channel123/p123456');
    });

    test('should require /archives/ in URL', () => {
      const message = document.createElement('div');
      message.setAttribute('data-qa', 'message_container');

      const link1 = document.createElement('a');
      link1.href = 'https://workspace.slack.com/team/user';
      message.appendChild(link1);

      const link2 = document.createElement('a');
      link2.href = 'https://workspace.slack.com/archives/general/msg123';
      message.appendChild(link2);

      const result = findSlackUrl(message);

      expect(result).toBe('https://workspace.slack.com/archives/general/msg123');
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findSlackUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no /archives/ link', () => {
      const message = document.createElement('div');
      message.setAttribute('data-qa', 'message_container');

      const link = document.createElement('a');
      link.href = 'https://workspace.slack.com/messages';
      message.appendChild(link);

      const result = findSlackUrl(message);

      expect(result).toBeNull();
    });
  });

  describe('findLobstersUrl', () => {
    test('should extract URL from .story with .u-url', () => {
      const story = document.createElement('div');
      story.className = 'story';

      const link = document.createElement('a');
      link.className = 'u-url';
      link.href = 'https://lobste.rs/s/abc123/story-title';
      story.appendChild(link);

      const result = findLobstersUrl(story);

      expect(result).toBe('https://lobste.rs/s/abc123/story-title');
    });

    test('should require .u-url class', () => {
      const story = document.createElement('div');
      story.className = 'story';

      const link1 = document.createElement('a');
      link1.href = 'https://lobste.rs/u/user';
      story.appendChild(link1);

      const link2 = document.createElement('a');
      link2.className = 'u-url';
      link2.href = 'https://lobste.rs/s/xyz789/another-story';
      story.appendChild(link2);

      const result = findLobstersUrl(story);

      expect(result).toBe('https://lobste.rs/s/xyz789/another-story');
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findLobstersUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no .u-url link', () => {
      const story = document.createElement('div');
      story.className = 'story';

      const link = document.createElement('a');
      link.href = 'https://lobste.rs/newest';
      story.appendChild(link);

      const result = findLobstersUrl(story);

      expect(result).toBeNull();
    });
  });

  describe('findGoogleNewsUrl', () => {
    test('should extract URL from article with /articles/ link', () => {
      const article = document.createElement('article');

      const link = document.createElement('a');
      link.href = 'https://news.google.com/./articles/CBMi...';
      article.appendChild(link);

      const result = findGoogleNewsUrl(article);

      // Browser normalizes ./articles/ to /articles/
      expect(result).toBe('https://news.google.com/articles/CBMi...');
    });

    test('should extract URL from data-n-tid with h3 link', () => {
      const article = document.createElement('div');
      article.setAttribute('data-n-tid', 'article-123');

      const h3 = document.createElement('h3');
      const link = document.createElement('a');
      link.href = 'https://news.google.com/articles/xyz';
      h3.appendChild(link);
      article.appendChild(h3);

      const result = findGoogleNewsUrl(article);

      expect(result).toBe('https://news.google.com/articles/xyz');
    });

    test('should extract URL from h4 link', () => {
      const article = document.createElement('article');

      const h4 = document.createElement('h4');
      const link = document.createElement('a');
      link.href = 'https://example.com/news/article';
      h4.appendChild(link);
      article.appendChild(h4);

      const result = findGoogleNewsUrl(article);

      expect(result).toBe('https://example.com/news/article');
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findGoogleNewsUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no matching link', () => {
      const article = document.createElement('article');

      const link = document.createElement('a');
      link.href = 'https://news.google.com';
      article.appendChild(link);

      const result = findGoogleNewsUrl(article);

      expect(result).toBeNull();
    });
  });

  describe('findFeedlyUrl', () => {
    test('should extract URL from data-entry-id with .entry__title', () => {
      const entry = document.createElement('div');
      entry.setAttribute('data-entry-id', 'entry-123');

      const link = document.createElement('a');
      link.className = 'entry__title';
      link.href = 'https://example.com/article';
      entry.appendChild(link);

      const result = findFeedlyUrl(entry);

      expect(result).toBe('https://example.com/article');
    });

    test('should extract URL from .entry with .entry__title', () => {
      const entry = document.createElement('div');
      entry.className = 'entry';

      const link = document.createElement('a');
      link.className = 'entry__title';
      link.href = 'https://blog.example.com/post/123';
      entry.appendChild(link);

      const result = findFeedlyUrl(entry);

      expect(result).toBe('https://blog.example.com/post/123');
    });

    test('should require .entry__title class', () => {
      const entry = document.createElement('div');
      entry.className = 'entry';

      const link1 = document.createElement('a');
      link1.href = 'https://example.com/first';
      entry.appendChild(link1);

      const link2 = document.createElement('a');
      link2.className = 'entry__title';
      link2.href = 'https://example.com/second';
      entry.appendChild(link2);

      const result = findFeedlyUrl(entry);

      expect(result).toBe('https://example.com/second');
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);

      const result = findFeedlyUrl(link);

      expect(result).toBe('https://example.com/');
    });

    test('should return null when no .entry__title link', () => {
      const entry = document.createElement('div');
      entry.setAttribute('data-entry-id', 'test');

      const link = document.createElement('a');
      link.href = 'https://example.com';
      entry.appendChild(link);

      const result = findFeedlyUrl(entry);

      expect(result).toBeNull();
    });
  });
});
