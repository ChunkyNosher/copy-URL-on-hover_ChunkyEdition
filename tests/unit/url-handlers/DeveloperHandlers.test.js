/**
 * Developer Platform URL Handlers Tests
 * Tests for developer platform URL detection (GitHub, GitLab, etc.)
 */

import { developerHandlers } from '../../../src/features/url-handlers/developer.js';

const {
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
} = developerHandlers;

describe('Developer Platform URL Handlers', () => {
  describe('findGitHubUrl', () => {
    test('should extract issue URL from data-testid="issue-row"', () => {
      const row = document.createElement('div');
      row.setAttribute('data-testid', 'issue-row');
      
      const link = document.createElement('a');
      link.href = 'https://github.com/user/repo/issues/123';
      row.appendChild(link);
      
      const span = document.createElement('span');
      row.appendChild(span);
      
      const result = findGitHubUrl(span);
      
      expect(result).toBe('https://github.com/user/repo/issues/123');
    });

    test('should extract pull request URL from .Box-row', () => {
      const row = document.createElement('div');
      row.className = 'Box-row';
      
      const link = document.createElement('a');
      link.href = 'https://github.com/org/project/pull/456';
      row.appendChild(link);
      
      const result = findGitHubUrl(row);
      
      expect(result).toBe('https://github.com/org/project/pull/456');
    });

    test('should extract discussion URL from .issue container', () => {
      const issue = document.createElement('div');
      issue.className = 'issue';
      
      const link = document.createElement('a');
      link.href = 'https://github.com/community/discussions/789';
      issue.appendChild(link);
      
      const result = findGitHubUrl(issue);
      
      expect(result).toBe('https://github.com/community/discussions/789');
    });

    test('should extract URL from role="article"', () => {
      const article = document.createElement('article');
      article.setAttribute('role', 'article');
      
      const link = document.createElement('a');
      link.href = 'https://github.com/owner/repo/issues/999';
      article.appendChild(link);
      
      const result = findGitHubUrl(article);
      
      expect(result).toBe('https://github.com/owner/repo/issues/999');
    });

    test('should fallback to generic handler when no item container', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com';
      div.appendChild(link);
      
      const result = findGitHubUrl(link);
      
      expect(result).toBe('https://example.com/');
    });

    test('should return null when no matching link found', () => {
      const row = document.createElement('div');
      row.className = 'Box-row';
      
      const link = document.createElement('a');
      link.href = 'https://github.com/user/repo';
      row.appendChild(link);
      
      const result = findGitHubUrl(row);
      
      expect(result).toBeNull();
    });

    test('should handle multiple links and return first match', () => {
      const row = document.createElement('div');
      row.setAttribute('data-testid', 'issue-row');
      
      const link1 = document.createElement('a');
      link1.href = 'https://github.com/user';
      row.appendChild(link1);
      
      const link2 = document.createElement('a');
      link2.href = 'https://github.com/user/repo/issues/1';
      row.appendChild(link2);
      
      const result = findGitHubUrl(row);
      
      expect(result).toBe('https://github.com/user/repo/issues/1');
    });
  });

  describe('findGitLabUrl', () => {
    test('should extract issue URL from .issue container', () => {
      const issue = document.createElement('div');
      issue.className = 'issue';
      
      const link = document.createElement('a');
      link.href = 'https://gitlab.com/group/project/-/issues/123';
      issue.appendChild(link);
      
      const result = findGitLabUrl(issue);
      
      expect(result).toBe('https://gitlab.com/group/project/-/issues/123');
    });

    test('should extract merge request URL from .merge-request', () => {
      const mr = document.createElement('div');
      mr.className = 'merge-request';
      
      const link = document.createElement('a');
      link.href = 'https://gitlab.com/org/repo/-/merge_requests/456';
      mr.appendChild(link);
      
      const result = findGitLabUrl(mr);
      
      expect(result).toBe('https://gitlab.com/org/repo/-/merge_requests/456');
    });

    test('should extract URL from data-qa-selector container', () => {
      const item = document.createElement('div');
      item.setAttribute('data-qa-selector', 'issue_container');
      
      const link = document.createElement('a');
      link.href = 'https://gitlab.com/project/-/issues/789';
      item.appendChild(link);
      
      const result = findGitLabUrl(item);
      
      expect(result).toBe('https://gitlab.com/project/-/issues/789');
    });

    test('should fallback to generic handler when no item', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com';
      div.appendChild(link);
      
      const result = findGitLabUrl(link);
      
      expect(result).toBe('https://example.com/');
    });

    test('should return null when no matching link', () => {
      const issue = document.createElement('div');
      issue.className = 'issue';
      
      const link = document.createElement('a');
      link.href = 'https://gitlab.com/project';
      issue.appendChild(link);
      
      const result = findGitLabUrl(issue);
      
      expect(result).toBeNull();
    });
  });

  describe('findBitbucketUrl', () => {
    test('should extract issue URL from data-testid="issue-row"', () => {
      const row = document.createElement('div');
      row.setAttribute('data-testid', 'issue-row');
      
      const link = document.createElement('a');
      link.href = 'https://bitbucket.org/team/repo/issues/123';
      row.appendChild(link);
      
      const result = findBitbucketUrl(row);
      
      expect(result).toBe('https://bitbucket.org/team/repo/issues/123');
    });

    test('should extract pull request URL from .iterable-item', () => {
      const item = document.createElement('div');
      item.className = 'iterable-item';
      
      const link = document.createElement('a');
      link.href = 'https://bitbucket.org/workspace/project/pull-requests/456';
      item.appendChild(link);
      
      const result = findBitbucketUrl(item);
      
      expect(result).toBe('https://bitbucket.org/workspace/project/pull-requests/456');
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com';
      div.appendChild(link);
      
      const result = findBitbucketUrl(link);
      
      expect(result).toBe('https://example.com/');
    });

    test('should return null when no matching link', () => {
      const item = document.createElement('div');
      item.className = 'iterable-item';
      
      const link = document.createElement('a');
      link.href = 'https://bitbucket.org/team/repo';
      item.appendChild(link);
      
      const result = findBitbucketUrl(item);
      
      expect(result).toBeNull();
    });
  });

  describe('findStackOverflowUrl', () => {
    test('should extract question URL from .s-post-summary', () => {
      const summary = document.createElement('div');
      summary.className = 's-post-summary';
      
      const link = document.createElement('a');
      link.className = 's-link';
      link.href = 'https://stackoverflow.com/questions/123456/how-to-test';
      summary.appendChild(link);
      
      const result = findStackOverflowUrl(summary);
      
      expect(result).toBe('https://stackoverflow.com/questions/123456/how-to-test');
    });

    test('should extract URL from data-post-id container', () => {
      const question = document.createElement('div');
      question.setAttribute('data-post-id', '987654');
      
      const link = document.createElement('a');
      link.className = 's-link';
      link.href = 'https://stackoverflow.com/questions/987654/javascript-question';
      question.appendChild(link);
      
      const result = findStackOverflowUrl(question);
      
      expect(result).toBe('https://stackoverflow.com/questions/987654/javascript-question');
    });

    test('should require both .s-link class and /questions/ in URL', () => {
      const summary = document.createElement('div');
      summary.className = 's-post-summary';
      
      const link1 = document.createElement('a');
      link1.href = 'https://stackoverflow.com/questions/111/test';
      summary.appendChild(link1);
      
      const link2 = document.createElement('a');
      link2.className = 's-link';
      link2.href = 'https://stackoverflow.com/users/123';
      summary.appendChild(link2);
      
      const result = findStackOverflowUrl(summary);
      
      expect(result).toBeNull();
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com';
      div.appendChild(link);
      
      const result = findStackOverflowUrl(link);
      
      expect(result).toBe('https://example.com/');
    });
  });

  describe('findStackExchangeUrl', () => {
    test('should extract question URL from .s-post-summary', () => {
      const summary = document.createElement('div');
      summary.className = 's-post-summary';
      
      const link = document.createElement('a');
      link.href = 'https://unix.stackexchange.com/questions/12345/bash-scripting';
      summary.appendChild(link);
      
      const result = findStackExchangeUrl(summary);
      
      expect(result).toBe('https://unix.stackexchange.com/questions/12345/bash-scripting');
    });

    test('should extract URL from .question-summary', () => {
      const summary = document.createElement('div');
      summary.className = 'question-summary';
      
      const link = document.createElement('a');
      link.href = 'https://askubuntu.com/questions/67890/ubuntu-help';
      summary.appendChild(link);
      
      const result = findStackExchangeUrl(summary);
      
      expect(result).toBe('https://askubuntu.com/questions/67890/ubuntu-help');
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com';
      div.appendChild(link);
      
      const result = findStackExchangeUrl(link);
      
      expect(result).toBe('https://example.com/');
    });

    test('should return null when no /questions/ link', () => {
      const summary = document.createElement('div');
      summary.className = 's-post-summary';
      
      const link = document.createElement('a');
      link.href = 'https://unix.stackexchange.com/users/123';
      summary.appendChild(link);
      
      const result = findStackExchangeUrl(summary);
      
      expect(result).toBeNull();
    });
  });

  describe('findServerFaultUrl', () => {
    test('should use Stack Exchange structure', () => {
      const summary = document.createElement('div');
      summary.className = 's-post-summary';
      
      const link = document.createElement('a');
      link.href = 'https://serverfault.com/questions/54321/server-config';
      summary.appendChild(link);
      
      const result = findServerFaultUrl(summary);
      
      expect(result).toBe('https://serverfault.com/questions/54321/server-config');
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com';
      div.appendChild(link);
      
      const result = findServerFaultUrl(link);
      
      expect(result).toBe('https://example.com/');
    });
  });

  describe('findSuperUserUrl', () => {
    test('should use Stack Exchange structure', () => {
      const summary = document.createElement('div');
      summary.className = 'question-summary';
      
      const link = document.createElement('a');
      link.href = 'https://superuser.com/questions/98765/desktop-question';
      summary.appendChild(link);
      
      const result = findSuperUserUrl(summary);
      
      expect(result).toBe('https://superuser.com/questions/98765/desktop-question');
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com';
      div.appendChild(link);
      
      const result = findSuperUserUrl(link);
      
      expect(result).toBe('https://example.com/');
    });
  });

  describe('findCodepenUrl', () => {
    test('should extract pen URL from data-slug container', () => {
      const pen = document.createElement('div');
      pen.setAttribute('data-slug', 'abc123');
      
      const link = document.createElement('a');
      link.href = 'https://codepen.io/username/pen/abc123';
      pen.appendChild(link);
      
      const result = findCodepenUrl(pen);
      
      expect(result).toBe('https://codepen.io/username/pen/abc123');
    });

    test('should extract URL from .single-pen', () => {
      const pen = document.createElement('div');
      pen.className = 'single-pen';
      
      const link = document.createElement('a');
      link.href = 'https://codepen.io/creator/pen/xyz789';
      pen.appendChild(link);
      
      const result = findCodepenUrl(pen);
      
      expect(result).toBe('https://codepen.io/creator/pen/xyz789');
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com';
      div.appendChild(link);
      
      const result = findCodepenUrl(link);
      
      expect(result).toBe('https://example.com/');
    });

    test('should return null when no /pen/ link', () => {
      const pen = document.createElement('div');
      pen.setAttribute('data-slug', 'test');
      
      const link = document.createElement('a');
      link.href = 'https://codepen.io/username';
      pen.appendChild(link);
      
      const result = findCodepenUrl(pen);
      
      expect(result).toBeNull();
    });
  });

  describe('findJSFiddleUrl', () => {
    test('should extract fiddle URL from .fiddle container', () => {
      const fiddle = document.createElement('div');
      fiddle.className = 'fiddle';
      
      const link = document.createElement('a');
      link.href = 'https://jsfiddle.net/user/abc123/';
      fiddle.appendChild(link);
      
      const result = findJSFiddleUrl(fiddle);
      
      expect(result).toBe('https://jsfiddle.net/user/abc123/');
    });

    test('should extract URL from data-id container', () => {
      const fiddle = document.createElement('div');
      fiddle.setAttribute('data-id', 'fiddle-123');
      
      const link = document.createElement('a');
      link.href = 'https://jsfiddle.net/creator/xyz789/';
      fiddle.appendChild(link);
      
      const result = findJSFiddleUrl(fiddle);
      
      expect(result).toBe('https://jsfiddle.net/creator/xyz789/');
    });

    test('should require jsfiddle.net in URL', () => {
      const fiddle = document.createElement('div');
      fiddle.className = 'fiddle';
      
      const link = document.createElement('a');
      link.href = 'https://example.com/fiddle';
      fiddle.appendChild(link);
      
      const result = findJSFiddleUrl(fiddle);
      
      expect(result).toBeNull();
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);
      
      const result = findJSFiddleUrl(link);
      
      expect(result).toBe('https://example.com/');
    });
  });

  describe('findReplitUrl', () => {
    test('should extract repl URL from data-repl-id container', () => {
      const repl = document.createElement('div');
      repl.setAttribute('data-repl-id', '123');
      
      const link = document.createElement('a');
      link.href = 'https://replit.com/@username/project-name';
      repl.appendChild(link);
      
      const result = findReplitUrl(repl);
      
      expect(result).toBe('https://replit.com/@username/project-name');
    });

    test('should extract URL from .repl-item', () => {
      const repl = document.createElement('div');
      repl.className = 'repl-item';
      
      const link = document.createElement('a');
      link.href = 'https://replit.com/@creator/my-app';
      repl.appendChild(link);
      
      const result = findReplitUrl(repl);
      
      expect(result).toBe('https://replit.com/@creator/my-app');
    });

    test('should require /@ in URL', () => {
      const repl = document.createElement('div');
      repl.className = 'repl-item';
      
      const link = document.createElement('a');
      link.href = 'https://replit.com/explore';
      repl.appendChild(link);
      
      const result = findReplitUrl(repl);
      
      expect(result).toBeNull();
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);
      
      const result = findReplitUrl(link);
      
      expect(result).toBe('https://example.com/');
    });
  });

  describe('findGlitchUrl', () => {
    test('should extract project URL from .project container', () => {
      const project = document.createElement('div');
      project.className = 'project';
      
      const link = document.createElement('a');
      link.href = 'https://glitch.com/~project-name';
      project.appendChild(link);
      
      const result = findGlitchUrl(project);
      
      expect(result).toBe('https://glitch.com/~project-name');
    });

    test('should extract URL from data-project-id container', () => {
      const project = document.createElement('div');
      project.setAttribute('data-project-id', 'abc-123');
      
      const link = document.createElement('a');
      link.href = 'https://glitch.com/~awesome-app';
      project.appendChild(link);
      
      const result = findGlitchUrl(project);
      
      expect(result).toBe('https://glitch.com/~awesome-app');
    });

    test('should require glitch.com/~ in URL', () => {
      const project = document.createElement('div');
      project.className = 'project';
      
      const link = document.createElement('a');
      link.href = 'https://glitch.com/projects';
      project.appendChild(link);
      
      const result = findGlitchUrl(project);
      
      expect(result).toBeNull();
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);
      
      const result = findGlitchUrl(link);
      
      expect(result).toBe('https://example.com/');
    });
  });

  describe('findCodesandboxUrl', () => {
    test('should extract sandbox URL from data-id container', () => {
      const sandbox = document.createElement('div');
      sandbox.setAttribute('data-id', 'sandbox-123');
      
      const link = document.createElement('a');
      link.href = 'https://codesandbox.io/s/abc123';
      sandbox.appendChild(link);
      
      const result = findCodesandboxUrl(sandbox);
      
      expect(result).toBe('https://codesandbox.io/s/abc123');
    });

    test('should extract URL from .sandbox-item', () => {
      const sandbox = document.createElement('div');
      sandbox.className = 'sandbox-item';
      
      const link = document.createElement('a');
      link.href = 'https://codesandbox.io/s/xyz789';
      sandbox.appendChild(link);
      
      const result = findCodesandboxUrl(sandbox);
      
      expect(result).toBe('https://codesandbox.io/s/xyz789');
    });

    test('should require /s/ in URL', () => {
      const sandbox = document.createElement('div');
      sandbox.className = 'sandbox-item';
      
      const link = document.createElement('a');
      link.href = 'https://codesandbox.io/dashboard';
      sandbox.appendChild(link);
      
      const result = findCodesandboxUrl(sandbox);
      
      expect(result).toBeNull();
    });

    test('should fallback to generic handler', () => {
      const div = document.createElement('div');
      const link = document.createElement('a');
      link.href = 'https://example.com/';
      div.appendChild(link);
      
      const result = findCodesandboxUrl(link);
      
      expect(result).toBe('https://example.com/');
    });
  });
});
