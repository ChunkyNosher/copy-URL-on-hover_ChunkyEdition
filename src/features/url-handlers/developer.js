/**
 * Developer URL Handlers
 * URL detection for developer platforms
 */

import { debug } from '../../utils/debug.js';
import { findGenericUrl } from './generic.js';

function findGitHubUrl(element) {
  const item = element.closest('[data-testid="issue-row"], .Box-row, .issue, [role="article"]');
  if (!item) return findGenericUrl(element);

  const link = item.querySelector(
    'a[href*="/issues/"], a[href*="/pull/"], a[href*="/discussions/"]'
  );
  if (link?.href) return link.href;

  return null;
}

function findGitLabUrl(element) {
  const item = element.closest('.issue, .merge-request, [data-qa-selector]');
  if (!item) return findGenericUrl(element);

  const link = item.querySelector('a[href*="/issues/"], a[href*="/merge_requests/"]');
  if (link?.href) return link.href;

  return null;
}

function findBitbucketUrl(element) {
  const item = element.closest('[data-testid="issue-row"], .iterable-item');
  if (!item) return findGenericUrl(element);

  const link = item.querySelector('a[href*="/issues/"], a[href*="/pull-requests/"]');
  if (link?.href) return link.href;

  return null;
}

function findStackOverflowUrl(element) {
  const question = element.closest('.s-post-summary, [data-post-id]');
  if (!question) return findGenericUrl(element);

  const link = question.querySelector('a.s-link[href*="/questions/"]');
  if (link?.href) return link.href;

  return null;
}

function findStackExchangeUrl(element) {
  const question = element.closest('.s-post-summary, .question-summary');
  if (!question) return findGenericUrl(element);

  const link = question.querySelector('a[href*="/questions/"]');
  if (link?.href) return link.href;

  return null;
}

function findServerFaultUrl(element) {
  // Server Fault uses the same Stack Exchange structure
  return findStackExchangeUrl(element);
}

function findSuperUserUrl(element) {
  // Super User uses the same Stack Exchange structure
  return findStackExchangeUrl(element);
}

function findCodepenUrl(element) {
  const pen = element.closest('[data-slug], .single-pen');
  if (!pen) return findGenericUrl(element);

  const link = pen.querySelector('a[href*="/pen/"]');
  if (link?.href) return link.href;

  return null;
}

function findJSFiddleUrl(element) {
  const fiddle = element.closest('.fiddle, [data-id]');
  if (!fiddle) return findGenericUrl(element);

  const link = fiddle.querySelector('a[href*="jsfiddle.net"]');
  if (link?.href) return link.href;

  return null;
}

function findReplitUrl(element) {
  const repl = element.closest('[data-repl-id], .repl-item');
  if (!repl) return findGenericUrl(element);

  const link = repl.querySelector('a[href*="/@"]');
  if (link?.href) return link.href;

  return null;
}

function findGlitchUrl(element) {
  const project = element.closest('.project, [data-project-id]');
  if (!project) return findGenericUrl(element);

  const link = project.querySelector('a[href*="glitch.com/~"]');
  if (link?.href) return link.href;

  return null;
}

function findCodesandboxUrl(element) {
  const sandbox = element.closest('[data-id], .sandbox-item');
  if (!sandbox) return findGenericUrl(element);

  const link = sandbox.querySelector('a[href*="/s/"]');
  if (link?.href) return link.href;

  return null;
}

export const developerHandlers = {
  gitHub: findGitHubUrl,
  gitLab: findGitLabUrl,
  bitbucket: findBitbucketUrl,
  stackOverflow: findStackOverflowUrl,
  stackExchange: findStackExchangeUrl,
  serverFault: findServerFaultUrl,
  superUser: findSuperUserUrl,
  codepen: findCodepenUrl,
  jSFiddle: findJSFiddleUrl,
  replit: findReplitUrl,
  glitch: findGlitchUrl,
  codesandbox: findCodesandboxUrl
};
