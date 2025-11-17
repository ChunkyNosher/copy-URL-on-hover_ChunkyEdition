# MCP Server Utilization Guide for GitHub Copilot Coding Agent

## Overview

This repository has **15 MCP servers** configured to enhance GitHub Copilot Coding Agent's capabilities for Mozilla extension development. This guide provides explicit instructions on optimal usage.

---

## Configured MCP Servers

### Critical Priority MCPs (Use First)

#### 1. ESLint MCP Server ⭐⭐⭐

**Purpose:** JavaScript linting, auto-fixing, code quality enforcement

**MANDATORY USAGE:** Every code change MUST be linted before finalizing.

**When to Use:**
- BEFORE creating any commit or PR
- AFTER writing/modifying JavaScript files
- When code quality issues reported
- To enforce consistent code style

**Tools:**
- `lint_file` - Check specific files for errors
- `fix_file` - Apply ESLint auto-fixes automatically
- `explain_rule` - Get rule violation explanations
- `lint_directory` - Lint entire directories

**Example Prompts:**
```
"Run ESLint on background.js and apply all auto-fixes"
"Check src/ directory for ESLint violations"
"Explain the 'no-unused-vars' violation in popup.js line 45"
"Lint all modified JavaScript files before committing"
```

**Workflow:**
```
1. Write/modify code
2. IMMEDIATELY: "Lint [filename] with ESLint"
3. Apply auto-fixes
4. Fix remaining issues manually
5. Verify zero errors
6. Proceed with commit
```

**NO EXCEPTIONS** - ESLint is the primary quality gate.

---

#### 2. Context7 MCP Server ⭐⭐⭐

**Purpose:** Up-to-date documentation for libraries, frameworks, and APIs

**MANDATORY USAGE:** Always fetch current documentation instead of relying on training data.

**When to Use:**
- Implementing features with external APIs
- Using WebExtensions APIs
- Updating deprecated API usage
- Need current best practices
- Verifying API syntax/parameters

**Tools:**
- `get-library-docs` - Fetch library documentation
- `resolve-library-id` - Find library in database

**Example Prompts:**
```
"Use Context7 to get latest Firefox WebExtensions clipboard API docs"
"Fetch current Manifest V3 migration guidelines for Firefox"
"Get documentation for browser.storage.sync with quota limits"
"Find latest best practices for Firefox container integration"
```

**ALWAYS use Context7 when:**
- User mentions "latest" or "current" documentation
- Implementing with external APIs
- Unsure about API syntax
- Need to verify Firefox compatibility

---

#### 3. NPM Package Registry MCP Server ⭐⭐⭐

**Purpose:** Package search, dependency management, vulnerability checking

**MANDATORY USAGE:** Check packages before adding dependencies.

**When to Use:**
- Adding new npm packages
- Updating dependencies
- Checking for vulnerabilities
- Finding compatible packages
- Researching alternatives

**Tools:**
- `search-npm-packages` - Search registry
- `get-npm-package-details` - Get package info
- `check_vulnerability` - Security check
- `check_outdated` - Find outdated deps

**Example Prompts:**
```
"Search npm for clipboard management libraries compatible with WebExtensions"
"Check package.json for outdated dependencies"
"Get security vulnerabilities in current dependencies"
"Find the latest compatible Playwright version for Firefox"
```

**Workflow:**
```
1. Before adding dependency: Search NPM Registry
2. Get package details and check vulnerabilities
3. Verify compatibility with Firefox/WebExtensions
4. Check package is actively maintained
5. Proceed with installation
```

---

### High Priority MCPs (Use Frequently)

#### 4. GitHub MCP Server (Write-Enabled)

**Purpose:** Repository management with write permissions

**Capabilities:**
- Create/update/close issues and PRs
- Add comments, labels, assignees
- Trigger GitHub Actions workflows
- Read repository data

**When to Use:**
- Creating issues from bug reports
- Updating issue status
- Creating pull requests
- Adding review comments
- Triggering CI/CD

**Example Prompts:**
```
"Create GitHub issue for Quick Tab rendering bug with high priority label"
"Add comment to PR #45 explaining memory leak fix"
"Update issue #23 to mark completed and close"
"Create pull request for container isolation feature"
```

**Auto-Issue Creation:**
- When user provides bug list → Create issues automatically
- Use detailed descriptions with root cause analysis
- Apply appropriate labels (bug, enhancement, etc.)
- DO NOT auto-close issues - let user close manually

---

#### 5. Filesystem MCP Server

**Purpose:** Read/write files in repository

**Configured Paths:**
- `/workspace/src` - Source code
- `/workspace/tests` - Test files
- `/workspace/docs` - Documentation
- `/workspace/background.js` - Main background script
- `/workspace/popup.js` - Popup script
- `/workspace/manifest.json` - Extension manifest

**When to Use:**
- Reading source code
- Writing new code
- Updating documentation
- Searching for code patterns
- Analyzing project structure

**Example Prompts:**
```
"Read background.js and analyze message handlers"
"Update manifest.json to add clipboard permission"
"Search for all files using browser.storage API"
"Create new helper file in src/ for URL validation"
```

**ALWAYS use specific paths** from configured list above.

---

#### 6. Git MCP Server

**Purpose:** Version control operations

**When to Use:**
- Creating commits
- Checking file changes
- Viewing commit history
- Generating commit messages
- Tracking modifications

**Tools:**
- `git_status` - Check repo status
- `git_commit` - Create commits
- `git_log` - View history
- `git_diff` - Show differences

**Example Prompts:**
```
"Show what files changed since last commit"
"Create commit with descriptive message for background.js changes"
"View git history for manifest.json to see permission changes"
```

---

#### 7. Playwright (Firefox) MCP Server

**Purpose:** Browser automation and testing

**Configuration:**
- Browser: Firefox (optimized for Mozilla extensions)
- Permissions: clipboard-read, clipboard-write, notifications
- Isolated mode: Clean environment per test
- Output: /workspace/test-results

**When to Use:**
- Testing extension functionality
- Verifying UI changes
- Reproducing bugs
- Creating automated tests
- Cross-site compatibility testing

**Example Prompts:**
```
"Use Playwright to test URL copy functionality on GitHub.com"
"Load extension in Firefox and verify popup appears on hover"
"Take screenshot of Quick Tab creation flow"
"Test clipboard access in containerized tab"
```

**ALWAYS test UI changes** with Playwright before finalizing.

---

### Medium Priority MCPs (Use As Needed)

#### 8. Sentry MCP Server

**Purpose:** Error monitoring and debugging

**When to Use:**
- Debugging production errors
- Analyzing error trends
- Getting AI fix suggestions
- Investigating crashes
- Monitoring error rates

**Tools:**
- `list-issues` - Search Sentry issues
- `get-issue` - Get error details
- `invoke-seer` - AI-powered fix suggestions
- `search-errors-in-file` - Find file-specific errors

**Example Prompts:**
```
"Query Sentry for errors in background.js from last week"
"Get stack trace for most recent clipboard error"
"Use Sentry Seer to suggest fixes for container isolation bug"
```

---

#### 9. Memory MCP Server

**Purpose:** Context persistence across sessions

**When to Use:**
- Starting new task on same issue
- Referencing previous decisions
- Continuing work from previous session
- Avoiding repeated mistakes
- Building on previous context

**Example Prompts:**
```
"Remember Quick Tab rendering issue was fixed using isRendered() tracking"
"Recall container isolation approach we implemented"
"What was workaround for storage sync race condition?"
```

**ALWAYS store important decisions** in memory.

---

#### 10. Code Review MCP Server

**Purpose:** Automated PR reviews

**When to Use:**
- Before merging PRs
- Reviewing code changes
- Comparing branches
- Quality assurance checks
- Pre-merge validation

**Example Prompts:**
```
"Review latest PR for code quality issues"
"Compare feature/quick-tabs branch with main"
"Generate code review for changes in background.js"
```

---

#### 11. Screenshot Website MCP Server

**Purpose:** Visual verification

**When to Use:**
- Verifying UI changes
- Documenting visual bugs
- Creating README screenshots
- Comparing before/after states
- Visual regression testing

**Example Prompts:**
```
"Take screenshot of extension popup after style changes"
"Capture how Quick Tab appears on GitHub.com"
"Screenshot options page with all settings visible"
```

---

### Lower Priority MCPs (Specialized Use)

#### 12. Perplexity MCP Server

**Purpose:** Real-time web search

**When to Use:**
- Need current information
- Researching best practices
- Finding recent solutions
- Verifying API availability

**Example:** "Use Perplexity to research current Firefox container API best practices"

---

#### 13. Brave Deep Research MCP Server

**Purpose:** Deep research and analysis

**When to Use:**
- Complex research questions
- Comprehensive understanding needed
- Comparing multiple approaches
- Deep technical investigations

**Example:** "Use Brave Deep Research to compare approaches for cross-tab communication"

---

#### 14. REST API Tester MCP Server

**Purpose:** API endpoint testing

**When to Use:**
- Testing external APIs
- Debugging API responses
- Verifying webhooks
- Validating API contracts

**Example:** "Test the GitHub API endpoint for repository information"

---

#### 15. GitHub Actions MCP Server

**Purpose:** CI/CD management

**When to Use:**
- Running workflows
- Checking build status
- Creating automation
- Debugging failed builds

**Example:** "Trigger the test workflow for the latest commit"

---

## MCP Utilization Workflows

### Bug Fix Standard Workflow

```
1. Sentry MCP: Query error stack traces
2. Filesystem MCP: Read affected code
3. Context7 MCP: Get API documentation ⭐ MANDATORY
4. Filesystem MCP: Write fix
5. ESLint MCP: Lint and fix code ⭐ MANDATORY
6. Playwright MCP: Test fix
7. Git MCP: Create commit
8. GitHub MCP: Update issue status
```

### New Feature Standard Workflow

```
1. NPM Registry MCP: Search compatible packages ⭐ MANDATORY
2. NPM Registry MCP: Check vulnerabilities ⭐ MANDATORY
3. Context7 MCP: Get API docs ⭐ MANDATORY
4. Perplexity/Brave MCP: Research best practices
5. Filesystem MCP: Write feature code
6. ESLint MCP: Lint and fix ⭐ MANDATORY
7. Playwright MCP: Create tests
8. Screenshot MCP: Document UI changes
9. Git MCP: Commit changes
10. GitHub MCP: Create pull request
```

### Code Review Standard Workflow

```
1. Code Review MCP: Analyze changes
2. ESLint MCP: Check linting ⭐ MANDATORY
3. Git MCP: View commit history
4. Playwright MCP: Run tests
5. GitHub MCP: Add review comments
```

### Dependency Update Standard Workflow

```
1. NPM Registry MCP: Check for updates ⭐ MANDATORY
2. NPM Registry MCP: Check vulnerabilities ⭐ MANDATORY
3. Context7 MCP: Get migration guides
4. Filesystem MCP: Update package.json
5. ESLint MCP: Verify code passes ⭐ MANDATORY
6. Playwright MCP: Run test suite
7. Git MCP: Commit updates
8. GitHub MCP: Create PR
```

---

## MANDATORY MCP Usage Rules

### Rule 1: ALWAYS Use ESLint Before Finalizing

**Process:**
1. Write/modify code
2. IMMEDIATELY run ESLint on changed files
3. Apply auto-fixes
4. Fix remaining issues
5. Verify zero errors
6. Proceed with commit

**NO EXCEPTIONS.**

### Rule 2: ALWAYS Use Context7 for API Docs

**Never rely on training data** for API syntax - always fetch current docs from Context7.

### Rule 3: ALWAYS Check Dependencies with NPM Registry

Before adding dependencies:
1. Search NPM Registry
2. Check vulnerabilities
3. Verify maintenance status
4. Check Firefox compatibility

### Rule 4: ALWAYS Use GitHub MCP for Issues

When creating issues from bug reports - use GitHub MCP to create them automatically.

### Rule 5: ALWAYS Test UI Changes with Playwright

When modifying UI:
1. Test with Playwright
2. Capture screenshots
3. Verify in Firefox

---

## MCP Server Priority Matrix

### Critical (Use First)
1. ESLint MCP - Code quality
2. Context7 MCP - API documentation
3. NPM Registry MCP - Dependency management

### High Priority (Use Frequently)
4. GitHub MCP - Issue/PR management
5. Filesystem MCP - Code access
6. Git MCP - Version control
7. Playwright MCP - Testing

### Medium Priority (Use As Needed)
8. Sentry MCP - Error debugging
9. Memory MCP - Context persistence
10. Code Review MCP - Quality assurance
11. Screenshot MCP - Visual verification

### Lower Priority (Specialized Use)
12. Perplexity MCP - Research
13. Brave Deep Research MCP - Deep analysis
14. REST API Tester MCP - API testing
15. GitHub Actions MCP - CI/CD management

---

## Common MCP Combinations

### Bug Investigation
```
Sentry MCP → Filesystem MCP → Context7 MCP → ESLint MCP → Playwright MCP → Git MCP → GitHub MCP
```

### Feature Implementation
```
NPM Registry MCP → Context7 MCP → Filesystem MCP → ESLint MCP → Playwright MCP → Screenshot MCP → Git MCP → GitHub MCP
```

### Code Quality Improvement
```
ESLint MCP → Code Review MCP → Filesystem MCP → Git MCP → GitHub MCP
```

### Documentation Update
```
Filesystem MCP → Screenshot MCP → Git MCP → GitHub MCP
```

---

## Before Every Commit Checklist

- [ ] ESLint MCP used on all modified JavaScript files ⭐
- [ ] Zero ESLint errors remaining ⭐
- [ ] Context7 used for any API implementations ⭐
- [ ] NPM Registry checked for any new dependencies ⭐
- [ ] Playwright tests run for UI changes
- [ ] Git commit created with descriptive message

---

## Before Every PR Checklist

- [ ] All commits linted with ESLint ⭐
- [ ] Code Review MCP analysis completed
- [ ] Playwright test suite passes
- [ ] GitHub MCP used to create PR
- [ ] Documentation updated (README, agent files)

---

## Troubleshooting MCP Issues

### If MCP Server Fails

1. Check error message
2. Verify secrets configured correctly
3. Try alternative MCP
4. Document the issue

### If Tool Not Available

1. Verify tool name
2. Check MCP configuration
3. Use alternative approach

---

## Summary

**Always utilize appropriate MCP servers** for:

- ✅ High code quality (ESLint)
- ✅ Current documentation (Context7)
- ✅ Secure dependencies (NPM Registry)
- ✅ Proper tracking (GitHub)
- ✅ Comprehensive testing (Playwright)
- ✅ Effective debugging (Sentry)
- ✅ Professional workflows (Git, Code Review)

**MCPs are tools that enhance capabilities - use them proactively and systematically.**
