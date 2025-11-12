/**
 * News Discussion URL Handlers
 * URL detection for news discussion platforms
 */

import { debug } from '../../utils/debug.js';
import { findGenericUrl } from './generic.js';

function findHackerNewsUrl(element) {
  const row = element.closest('.athing');
  if (!row) return findGenericUrl(element);
  
  const link = row.querySelector('a.titlelink, .storylink');
  if (link?.href) return link.href;
  
  return null;
}

function findProductHuntUrl(element) {
  const item = element.closest('[data-test="post-item"]');
  if (!item) return findGenericUrl(element);
  
  const link = item.querySelector('a[href*="/posts/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findQuoraUrl(element) {
  const question = element.closest('[data-scroll-id], .q-box');
  if (!question) return findGenericUrl(element);
  
  const link = question.querySelector('a[href*="/q/"], a[href*="/question/"], a.question_link');
  if (link?.href) return link.href;
  
  return null;
}

function findDiscordUrl(element) {
  const message = element.closest('[id^="chat-messages-"], .message');
  if (!message) return findGenericUrl(element);
  
  const link = message.querySelector('a[href]');
  if (link?.href) return link.href;
  
  return null;
}

function findSlackUrl(element) {
  const message = element.closest('[data-qa="message_container"]');
  if (!message) return findGenericUrl(element);
  
  const link = message.querySelector('a[href*="/archives/"]');
  if (link?.href) return link.href;
  
  return null;
}

function findLobstersUrl(element) {
  const story = element.closest('.story');
  if (!story) return findGenericUrl(element);
  
  const link = story.querySelector('a.u-url');
  if (link?.href) return link.href;
  
  return null;
}

function findGoogleNewsUrl(element) {
  const article = element.closest('article, [data-n-tid]');
  if (!article) return findGenericUrl(element);
  
  const link = article.querySelector('a[href*="./articles/"], h3 a, h4 a');
  if (link?.href) return link.href;
  
  return null;
}

function findFeedlyUrl(element) {
  const entry = element.closest('[data-entry-id], .entry');
  if (!entry) return findGenericUrl(element);
  
  const link = entry.querySelector('a.entry__title');
  if (link?.href) return link.href;
  
  return null;
}

export const news_discussionHandlers = {
  hackerNews: findHackerNewsUrl,
  productHunt: findProductHuntUrl,
  quora: findQuoraUrl,
  discord: findDiscordUrl,
  slack: findSlackUrl,
  lobsters: findLobstersUrl,
  googleNews: findGoogleNewsUrl,
  feedly: findFeedlyUrl,
};
