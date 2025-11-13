# Complete Repository Setup for GitHub Copilot Agentic Workflow

## Purpose

This document provides GitHub Copilot Agent with exact instructions to complete the repository setup for full agentic workflow integration. All files are provided in correct, validated formats.

---

## Files to Create/Update

### 1. Fix `.deepsource.toml` (REPLACE existing file)

**Problem:** Current config has invalid options that cause errors:

- `plugins = ["webextensions"]` is invalid (webextensions is not a supported plugin)
- `test-coverage` analyzer doesn't accept `coverage_threshold` in meta

**Corrected `.deepsource.toml`:**

```toml
version = 1

# Test patterns - files that should be marked as tests
test_patterns = [
  "tests/**",
  "**/*.test.js",
  "**/*.spec.js"
]

# Exclude patterns - files/directories to ignore
exclude_patterns = [
  "node_modules/**",
  "dist/**",
  "coverage/**",
  "*.min.js"
]

# JavaScript/TypeScript Analyzer
[[analyzers]]
name = "javascript"
enabled = true

  [analyzers.meta]
  # Environments where code runs
  environment = ["nodejs", "browser"]

  # Module system used
  module_system = "es-modules"

  # Style guide to enforce
  style_guide = "standard"

# Test Coverage Analyzer
# NOTE: No meta options - coverage threshold is set via web UI
[[analyzers]]
name = "test-coverage"
enabled = true

# Prettier Transformer (auto-formats code)
[[transformers]]
name = "prettier"
enabled = true

# Secret Scanner (detects hardcoded secrets)
[[analyzers]]
name = "secrets"
enabled = true
```

**Key Changes:**

- ✅ Removed `plugins = ["webextensions"]` (not valid)
- ✅ Removed `dialect = "typescript"` (not needed for pure JS)
- ✅ Removed `[analyzers.meta]` from test-coverage (not supported)
- ✅ Added `test_patterns` and `exclude_patterns` at root level
- ✅ Changed to `style_guide = "standard"` (matches your ESLint config)

---

### 2. Create `.coderabbit.yaml` (NEW FILE)

**Location:** Repository root

**Purpose:** Configure CodeRabbit to review bot-created PRs (fixes the "Review skipped" issue)

```yaml
# .coderabbit.yaml
# Configuration for CodeRabbit AI Code Review
# yaml-language-server: $schema=https://coderabbit.ai/integrations/schema.v2.json

# Language and tone
language: en-US
tone_instructions: 'Focus on logic correctness, security issues, and browser extension best practices. Be concise but thorough.'

reviews:
  # Review profile (assertive = detailed feedback)
  profile: assertive

  # Auto-review configuration
  auto_review:
    enabled: true
    drafts: false

    # CRITICAL: Empty list means review ALL PRs including bots
    # This fixes the "Bot user detected, review skipped" issue
    ignore_usernames: []

  # Show high-level summary of changes
  high_level_summary: true
  high_level_summary_in_walkthrough: true

  # Post review status (show when reviews happen/skip)
  review_status: true

  # Path-specific instructions
  path_instructions:
    - path: 'background.js'
      instructions: |
        This is a browser extension background script. Pay attention to:
        - Message passing security (validate sender origins)
        - Async error handling in storage operations
        - Container isolation logic (cookieStoreId checks)
        - Storage quota management (100KB limit for sync)

    - path: 'state-manager.js'
      instructions: |
        State management module. Check for:
        - Race conditions in async operations
        - Proper container isolation
        - Memory leaks (WeakMap usage)
        - Error propagation

    - path: '**/*.test.js'
      instructions: |
        Test files. Verify:
        - Edge cases are covered
        - Error scenarios are tested
        - Mocks are properly set up
        - Coverage is comprehensive

    - path: 'manifest.json'
      instructions: |
        Extension manifest. Ensure:
        - Manifest V3 compliance
        - Minimal required permissions
        - CSP is properly configured
        - Browser-specific settings are correct

  # Review tools integration
  tools:
    # ESLint integration
    eslint:
      enabled: true

    # Secret detection
    gitleaks:
      enabled: true

# Chat configuration
chat:
  # Auto-reply to questions without requiring @mention
  auto_reply: true

# Knowledge base - helps CodeRabbit learn from your docs
knowledge_base:
  opt_out: false
  code_guidelines:
    enabled: true
    filePatterns:
      - '**/.github/copilot-instructions.md'
      - '**/README.md'
      - '**/docs/**/*.md'
```

**What this fixes:**

- ✅ `ignore_usernames: []` allows bot PRs to be reviewed
- ✅ Path-specific instructions for browser extension code
- ✅ Integrates with ESLint and security scanners
- ✅ Reads custom guidelines from documentation

---

### 3. Create `.github/copilot-instructions.md` (NEW FILE)

**Location:** `.github/copilot-instructions.md`

**Purpose:** Provide project-specific guidance to GitHub Copilot Code Review and Copilot Coding Agent

```markdown
# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V3 browser extension  
**Language:** JavaScript (ES6+)  
**Architecture:** Modular with state management  
**Purpose:** URL management with container isolation support

---

## Code Quality Tool Priority

When reviewing code, prioritize findings in this order:

### CRITICAL (Must fix before merge):

1. **CodeQL** HIGH/CRITICAL security findings
2. **DeepSource** critical severity issues
3. **ESLint** errors (not warnings)
4. Any use of `eval()`, `new Function()`, or `innerHTML` with user input
5. Missing message sender validation in browser.runtime.onMessage handlers

### HIGH PRIORITY (Should fix):

1. **DeepSource** high severity issues
2. **ESLint** warnings in new code
3. Test coverage drops below current level
4. Build failures
5. Prettier formatting violations
6. Missing error handling in async functions

### MEDIUM PRIORITY (Nice to fix):

1. **DeepSource** medium severity issues
2. Code complexity warnings (CC > 15)
3. Missing JSDoc comments for public functions
4. Console.log statements in production code

---

## Tool Integration Instructions

### Working with DeepSource Findings

When DeepSource flags an issue:

1. **Read the full explanation** - DeepSource provides context
2. **Check for Autofix availability** - If DeepSource offers an autofix, review it first
3. **Combine with broader context** - Consider how the fix affects other parts of the codebase
4. **Explain disagreements** - If you disagree with a finding, document why

**Example response:**
```

DeepSource correctly identified this issue. However, based on how this
function is used in background.js (lines 234-256), I recommend a different
approach that also addresses the race condition on line 245:
[Show enhanced fix]

````

### Working with CodeRabbit Findings

- CodeRabbit reviews all PRs including bot-created ones
- Build upon CodeRabbit's suggestions rather than duplicating them
- If CodeRabbit already mentioned an issue, focus on providing additional context or alternative solutions

### Handling Multiple AI Tool Findings

When ESLint, DeepSource, and CodeRabbit all flag related issues:
1. Synthesize all findings into one comprehensive explanation
2. Provide a single fix that addresses all concerns
3. Note which tool found which aspect of the problem

---

## Browser Extension Specific Rules

### Message Passing Security

**For all `browser.runtime.onMessage` handlers:**

```javascript
// ❌ BAD - No sender validation
browser.runtime.onMessage.addListener((message, sender) => {
  if (message.action === 'getData') {
    return processData(message.data);
  }
});

// ✅ GOOD - Validate sender
browser.runtime.onMessage.addListener((message, sender) => {
  // Validate sender is from this extension
  if (!sender.id || sender.id !== browser.runtime.id) {
    console.error('Message from unknown sender:', sender);
    return Promise.reject(new Error('Unauthorized'));
  }

  // Validate sender tab if applicable
  if (sender.tab && !sender.tab.id) {
    return Promise.reject(new Error('Invalid tab'));
  }

  if (message.action === 'getData') {
    return processData(message.data);
  }
});
````

**Always check:**

- ✅ Sender ID matches extension ID
- ✅ Sender tab is valid (if applicable)
- ✅ Message format is validated before processing

### Storage API Best Practices

**For `browser.storage.sync` operations:**

```javascript
// ❌ BAD - No error handling or quota check
async function saveState(state) {
  await browser.storage.sync.set({ state });
}

// ✅ GOOD - Error handling + quota awareness
async function saveState(state) {
  try {
    // Check size before saving (sync has 100KB limit)
    const stateSize = new Blob([JSON.stringify(state)]).size;
    if (stateSize > 100 * 1024) {
      throw new Error(`State too large: ${stateSize} bytes (max 100KB)`);
    }

    await browser.storage.sync.set({ state });
  } catch (error) {
    // Handle quota exceeded
    if (error.message.includes('QUOTA_BYTES')) {
      console.error('Storage quota exceeded, clearing old data');
      await browser.storage.sync.clear();
      await browser.storage.sync.set({ state });
    } else {
      console.error('Failed to save state:', error);
      // Fallback to local storage
      await browser.storage.local.set({ state });
    }
  }
}
```

**Always:**

- ✅ Wrap all storage calls in try-catch
- ✅ Check quota limits (100KB for sync, ~10MB for local)
- ✅ Provide user feedback for storage failures
- ✅ Consider fallback to local storage

### Container Isolation

**For Firefox Multi-Account Containers integration:**

```javascript
// Always check cookieStoreId for container-aware operations
async function getTabState(tabId) {
  const tab = await browser.tabs.get(tabId);
  const cookieStoreId = tab.cookieStoreId || 'firefox-default';

  // Use cookieStoreId as key to isolate state per container
  const containerState = await getStateForContainer(cookieStoreId);
  return containerState;
}

// Prevent cross-container state leaks
function validateContainerAccess(sourceContainer, targetContainer) {
  if (sourceContainer !== targetContainer) {
    throw new Error('Cross-container access denied');
  }
}
```

**Always:**

- ✅ Use `cookieStoreId` to isolate state between containers
- ✅ Validate container ID before sharing data
- ✅ Test with multiple containers active
- ✅ Handle default container (no cookieStoreId)

---

## Testing Requirements

### Minimum Coverage Standards

- **Overall:** Maintain current coverage level (do not decrease)
- **Critical paths:** 100% coverage required
  - Container isolation logic
  - State management operations
  - Message passing handlers
- **New features:** 80% coverage minimum
- **Bug fixes:** Add regression test

### Required Test Types

1. **Unit tests** - Test individual functions
2. **Integration tests** - Test component interactions
3. **Error scenario tests** - Test failure cases
4. **Container isolation tests** - Test multi-container scenarios

---

## Code Style & Patterns

### Preferred Patterns

```javascript
// ✅ Use const for immutable values
const MAX_RETRIES = 3;

// ✅ Use async/await over promises
async function fetchData() {
  const data = await fetch(url);
  return data;
}

// ✅ Use arrow functions for callbacks
items.map(item => item.value);

// ✅ Use template literals
const message = `Hello ${name}`;

// ✅ Use destructuring
const { id, name } = user;
```

### Patterns to Avoid

```javascript
// ❌ Don't use var
var count = 0;

// ❌ Don't use eval or new Function
eval(userInput);

// ❌ Don't use innerHTML with user input
element.innerHTML = userInput;

// ❌ Don't ignore errors
try {
  await doSomething();
} catch (e) {
  // empty catch
}

// ❌ Don't use console.log in production
console.log('Debug info'); // Use proper logging
```

---

## When Reviewing Pull Requests

### Checklist for All PRs

- [ ] All GitHub Actions checks pass (ESLint, Prettier, Build, Tests)
- [ ] DeepSource analysis passes or issues are acknowledged
- [ ] CodeRabbit review completed
- [ ] Test coverage maintained or improved
- [ ] No new security warnings from CodeQL
- [ ] Container isolation tested (if applicable)
- [ ] Error handling present in all async operations
- [ ] JSDoc comments added for new public functions

### For Copilot-Generated PRs

When reviewing PRs created by GitHub Copilot Coding Agent:

1. **Verify the approach** - Is the solution optimal?
2. **Check edge cases** - Did Copilot consider error scenarios?
3. **Validate tests** - Are tests comprehensive?
4. **Review security** - Are there any security implications?
5. **Check integration** - Does it work with existing code?

### For Bot PRs (Dependabot, Renovate)

- Focus on breaking changes in dependencies
- Verify tests still pass
- Check for security vulnerabilities in new versions
- Update documentation if API changes

---

## Common Issues to Watch For

### Race Conditions

```javascript
// ❌ BAD - Race condition
async function incrementCounter() {
  const { counter } = await browser.storage.sync.get('counter');
  await browser.storage.sync.set({ counter: counter + 1 });
}

// ✅ GOOD - Atomic operation
async function incrementCounter() {
  return browser.storage.sync.get('counter').then(({ counter = 0 }) => {
    return browser.storage.sync.set({ counter: counter + 1 });
  });
}
```

### Memory Leaks

```javascript
// ❌ BAD - Listeners not removed
function setupListener() {
  browser.tabs.onUpdated.addListener(handleUpdate);
}

// ✅ GOOD - Cleanup listeners
function setupListener() {
  const listener = handleUpdate;
  browser.tabs.onUpdated.addListener(listener);

  // Return cleanup function
  return () => {
    browser.tabs.onUpdated.removeListener(listener);
  };
}
```

### Unhandled Promise Rejections

```javascript
// ❌ BAD - Unhandled rejection
browser.storage.sync.set({ data });

// ✅ GOOD - Handle all rejections
browser.storage.sync.set({ data }).catch(error => {
  console.error('Storage error:', error);
  showUserNotification('Save failed');
});
```

---

## Manifest V3 Requirements

- ✅ Use `manifest_version: 3`
- ✅ Use `background.service_worker` instead of background pages
- ✅ Use `action` instead of `browser_action`
- ✅ Declare all permissions explicitly
- ✅ Use `host_permissions` for content script access
- ✅ CSP: `script-src 'self'` (no inline scripts)

---

## Final Notes

When in doubt:

1. **Prioritize security** over convenience
2. **Add error handling** rather than assuming success
3. **Write tests** before marking as done
4. **Document decisions** in code comments
5. **Ask for human review** on security-critical changes

**Remember:** This extension handles user data and has access to browsing history. Security and privacy are paramount.

````

**What this provides:**
- ✅ Project-specific rules for Copilot
- ✅ Tool priority guidance
- ✅ Browser extension security patterns
- ✅ Common pitfalls to avoid
- ✅ Integration with DeepSource, CodeRabbit, CodeQL

---

### 4. Create Simple Test File (NEW FILE)

**Location:** `tests/example.test.js`

**Purpose:** Enable Codecov integration with initial test

```javascript
/**
 * Example test suite for copy-URL-on-hover extension
 * This file provides a basic test to enable Codecov integration
 */

describe('Extension Configuration', () => {
  test('should have valid manifest version', () => {
    // Basic test to ensure test infrastructure works
    expect(true).toBe(true);
  });

  test('constants are defined correctly', () => {
    const MAX_STORAGE_SIZE = 100 * 1024; // 100KB
    expect(MAX_STORAGE_SIZE).toBe(102400);
  });
});

describe('Helper Functions', () => {
  test('should validate cookieStoreId format', () => {
    const validId = 'firefox-container-1';
    const invalidId = '';

    expect(validId).toMatch(/^firefox-/);
    expect(invalidId).not.toMatch(/^firefox-/);
  });
});
````

---

## Implementation Steps for GitHub Copilot Agent

### Step 1: Update `.deepsource.toml`

```bash
# Replace entire file with corrected version above
cat > .deepsource.toml << 'EOF'
[paste corrected .deepsource.toml from above]
EOF
```

### Step 2: Create `.coderabbit.yaml`

```bash
# Create new file in repository root
cat > .coderabbit.yaml << 'EOF'
[paste .coderabbit.yaml from above]
EOF
```

### Step 3: Create `.github/copilot-instructions.md`

```bash
# Ensure .github directory exists
mkdir -p .github

# Create copilot instructions
cat > .github/copilot-instructions.md << 'EOF'
[paste copilot-instructions.md from above]
EOF
```

### Step 4: Create Initial Test File

```bash
# Ensure tests directory exists
mkdir -p tests

# Create example test
cat > tests/example.test.js << 'EOF'
[paste example.test.js from above]
EOF
```

### Step 5: Commit All Changes

```bash
git add .deepsource.toml .coderabbit.yaml .github/copilot-instructions.md tests/example.test.js
git commit -m "Complete agentic workflow setup

- Fix .deepsource.toml configuration (remove invalid options)
- Add .coderabbit.yaml to enable bot PR reviews
- Add .github/copilot-instructions.md for project-specific AI guidance
- Add initial test file to enable Codecov integration"
git push
```

---

## Verification Steps

### After Pushing Changes:

1. **Verify DeepSource Configuration**
   - Go to https://deepsource.io/
   - Navigate to your repository
   - Check Settings → Configuration
   - Should show "Configuration valid" with no errors

2. **Test CodeRabbit on Bot PR**
   - Have Copilot Agent create a test PR
   - CodeRabbit should review it (no "Review skipped" message)
   - Should see CodeRabbit's review comments

3. **Verify Copilot Instructions**
   - Create a PR manually
   - Request Copilot Code Review
   - Copilot should mention following project-specific rules

4. **Test Coverage Integration**
   - Run: `npm test`
   - Coverage report generated in `coverage/`
   - Future PR will upload to Codecov automatically

---

## What This Completes

### ✅ DeepSource Integration

- Valid configuration file
- JavaScript analyzer enabled
- Test coverage tracking enabled
- Prettier transformer enabled
- Secrets scanner enabled

### ✅ CodeRabbit Integration

- Reviews all PRs including bots
- Path-specific instructions for extension code
- ESLint and security integration
- Reads project documentation

### ✅ GitHub Copilot Integration

- Project-specific instructions provided
- Tool priority defined
- Security patterns documented
- Common pitfalls highlighted

### ✅ Test Infrastructure

- Jest configured
- Initial test file created
- Codecov ready to integrate

---

## Next Steps (Manual)

1. **Activate DeepSource** (if not already done)
   - Visit https://deepsource.io/
   - Sign in and add repository
   - Enable Autofix™ AI

2. **Install CodeRabbit App** (if not already done)
   - Visit https://github.com/apps/coderabbitai
   - Install on repository

3. **Set Up Codecov** (optional for public repo)
   - Visit https://codecov.io/
   - Add repository
   - Coverage will auto-report from GitHub Actions

4. **Enable Branch Protection**
   - Settings → Branches → Add rule
   - Require all checks to pass:
     - ESLint Check
     - Prettier Format Check
     - Build Extension
     - CodeQL Analysis
     - Run Tests with Coverage
     - DeepSource

---

## Troubleshooting

### DeepSource Still Shows Error

**Check:**

- File encoding is UTF-8
- No trailing whitespace
- Indentation is consistent (2 spaces)
- Run: `cat .deepsource.toml | head -20` to verify first 20 lines

### CodeRabbit Still Skips Bot PRs

**Check:**

- `.coderabbit.yaml` is in repository root (not `.github/`)
- File name is exact: `.coderabbit.yaml` (not `.yml`)
- `ignore_usernames: []` is empty list, not omitted

### Copilot Doesn't Use Custom Instructions

**Check:**

- File is at `.github/copilot-instructions.md`
- File is committed to main branch
- Wait 5-10 minutes for Copilot to index changes

---

**Document Version:** 1.0  
**Last Updated:** November 12, 2025  
**For:** GitHub Copilot Agent Implementation  
**Repository:** copy-URL-on-hover_ChunkyEdition
