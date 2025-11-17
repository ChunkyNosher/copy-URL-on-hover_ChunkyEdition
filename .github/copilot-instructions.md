# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.5.9.11  
**Language:** JavaScript (ES6+)  
**Architecture:** Hybrid Modular/EventBus Architecture (Architecture #10)  
**Purpose:** URL management with Firefox Container isolation support and
persistent floating panel manager

---

### v1.5.9.11 Highlights

- **Quick Tab rendering bug - Root cause resolution:** Fixed critical bug with
  robust architectural solution. Quick Tabs created in Tab 1 now appear
  immediately in Tab 1 (not just other tabs). Root cause was THREE cascading
  failures: (1) Message action name mismatch between background and content
  scripts, (2) Initial creation flow bypassing local `createQuickTab()` call,
  (3) Pending saveId system creating deadlock. Fix implements **direct local
  creation** - originating tab creates and renders immediately, THEN notifies
  background for persistence. BroadcastChannel handles cross-tab sync (<10ms),
  storage serves as backup (see
  `docs/manual/1.5.9 docs/quick-tabs-rendering-bug-analysis-v15910.md`).
- **Architectural improvement:** Proper separation of concerns - content script
  handles UI rendering, BroadcastChannel handles real-time sync, background
  handles persistence. Eliminates race conditions and ensures immediate visual
  feedback.

### v1.5.9.10 Highlights

- **Quick Tab cross-tab rendering fix:** Fixed critical bug where Quick Tabs
  created in Tab 1 didn't appear visually in Tab 1, but appeared in other tabs
  instead. Root cause was BroadcastChannel message timing—tabs received their
  own broadcasts but skipped rendering because the tab "already existed" in
  memory. Now `QuickTabWindow` tracks rendering state with `isRendered()`, and
  `createQuickTab()` always ensures tabs are rendered even when they exist in
  memory (see
  `docs/manual/1.5.9 docs/quick-tabs-cross-tab-rendering-bug-v1599.md`).
- **Architectural improvement:** Separated creation logic from rendering logic
  by tracking rendering state independently, preventing memory/visual
  desynchronization.

### v1.5.9.8 Highlights

- **Quick Tab race condition fixes:** Content-side `CREATE_QUICK_TAB` requests
  now include a tracked `saveId`, background persists the same token, and
  QuickTabsManager ignores storage changes while any save is pending. Debounced
  storage sync means resize storms can't cascade-delete the entire stack (see
  `docs/manual/1.5.9 docs/v1-5-9-7-forensic-debug.md`).
- **Single-source creation + off-screen staging:** Quick Tabs don't render
  immediately on shortcut. The manager waits for the storage snapshot, then
  spawns each window off-screen before animating into the tooltip-clamped
  position derived from the hovered element/mouse location, eliminating the
  top-left flash.
- **Advanced tab log maintenance:** A new **Clear Log History** button (under
  Export Console Logs) sends `CLEAR_CONSOLE_LOGS` to `background.js`, which
  wipes its buffer and broadcasts `CLEAR_CONTENT_LOGS` so every tab purges both
  the console interceptor and `debug.js` buffers.

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
2. **Check for Autofix availability** - If DeepSource offers an autofix, review
   it first
3. **Combine with broader context** - Consider how the fix affects other parts
   of the codebase
4. **Explain disagreements** - If you disagree with a finding, document why

**Example response:**

```
DeepSource correctly identified this issue. However, based on how this
function is used in background.js (lines 234-256), I recommend a different
approach that also addresses the race condition on line 245:
[Show enhanced fix]
```

### Working with CodeRabbit Findings

- CodeRabbit reviews all PRs including bot-created ones
- Build upon CodeRabbit's suggestions rather than duplicating them
- If CodeRabbit already mentioned an issue, focus on providing additional
  context or alternative solutions

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
```

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

### Log Export Pipeline (v1.5.9.7+)

- Popup collects logs but immediately sends an `EXPORT_LOGS` message to
  `background.js`.
- Background script validates `sender.id === browser.runtime.id` and checks that
  `logText` + `filename` are strings before starting downloads.
- `handleLogExport()` creates the Blob, calls `downloads.download()` with
  `saveAs: true`, and revokes the Blob URL only after `downloads.onChanged`
  reports `complete`/`interrupted` (plus a 60s fallback timeout).
- Never reintroduce popup-side download logic—Firefox kills the popup whenever
  the Save As dialog opens, which terminates event listeners.
- Advanced tab now also exposes **Clear Log History**, which sends
  `CLEAR_CONSOLE_LOGS` to background so both the persistent buffer and each
  content script's console interceptors/`debug.js` buffers are wiped before the
  next export.

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

## Manifest V2 Requirements

- ✅ Use `manifest_version: 2` (required for webRequestBlocking)
- ✅ Use `background.scripts` with persistent: true
- ✅ Use `browser_action` instead of `action`
- ✅ Declare all permissions explicitly
- ✅ Use `content_scripts` for page injection
- ✅ CSP: `script-src 'self'` (no inline scripts)

---

## Final Notes

When in doubt:

1. **Prioritize security** over convenience
2. **Add error handling** rather than assuming success
3. **Write tests** before marking as done
4. **Document decisions** in code comments
5. **Ask for human review** on security-critical changes

**Remember:** This extension handles user data and has access to browsing
history. Security and privacy are paramount.

---

## MANDATORY: Documentation Update Requirements

**Every GitHub Copilot Agent MUST follow these requirements for ALL pull
requests:**

### 1. README Update (REQUIRED)

**ALWAYS update the README.md file** when making changes to:

- Version numbers (manifest.json, package.json)
- Feature functionality or architecture
- API changes or new APIs used
- User-facing behavior
- Settings or configuration options
- Known limitations or bugs

**README Update Checklist:**

- [ ] Update version number in header
- [ ] Update "What's New in v{version}" section
- [ ] Update feature list if functionality changed
- [ ] Update usage instructions if UI/UX changed
- [ ] Update settings documentation if config changed
- [ ] Update version footer at bottom
- [ ] Remove outdated information

### 2. Copilot Agent Files Update (REQUIRED)

**ALWAYS update ALL agent files** in `.github/agents/` and
`.github/copilot-instructions.md` when making changes to:

- Version numbers
- Architecture (new patterns, refactoring, module structure)
- Framework or technology changes
- New APIs or features
- Build/test/deploy processes
- Repository structure
- Development workflows

**Agent Files to Update:**

1. `.github/copilot-instructions.md` - Main instructions
2. `.github/agents/bug-architect.md` - Bug analysis specialist
3. `.github/agents/bug-fixer.md` - Bug fixing specialist
4. `.github/agents/feature-builder.md` - Feature implementation specialist
5. `.github/agents/feature-optimizer.md` - Feature optimization specialist
6. `.github/agents/master-orchestrator.md` - Coordination specialist
7. `.github/agents/refactor-specialist.md` - Code refactoring specialist

**Agent Files Update Checklist:**

- [ ] Update version numbers in all agent files
- [ ] Update architecture knowledge (if structure changed)
- [ ] Update API/framework information (if changed)
- [ ] Add new features to knowledge base
- [ ] Update build/test/deploy instructions (if changed)
- [ ] Ensure consistency across all agent files

### 3. Implementation Rules

**When implementing changes:**

1. **Before starting work:**
   - Check current README for accuracy
   - Check current agent files for accuracy
   - Plan what documentation needs updating

2. **During implementation:**
   - Keep a mental note of changes that affect documentation
   - Note new features, changed behaviors, removed features

3. **Before finalizing PR:**
   - Update README with all changes
   - Update ALL agent files with new information
   - Verify consistency across all documentation
   - Double-check version numbers match everywhere

4. **PR Description:**
   - Include "README Updated" checklist item
   - Include "Agent Files Updated" checklist item
   - List specific documentation changes made

### 4. Non-Compliance Consequences

**Failure to update documentation will result in:**

- PR rejection
- Request for immediate documentation updates
- Potential delays in merging

**No exceptions.** Documentation is as important as code changes.

### 5. Quick Reference

**Files that must be kept in sync:**

- `manifest.json` (version)
- `package.json` (version)
- `README.md` (version, features, architecture)
- `.github/copilot-instructions.md` (version, architecture)
- All files in `.github/agents/` (version, architecture, features)

**When version changes from X.Y.Z to X.Y.Z+1:**

- Update 5 version references (manifest, package, README header, README footer,
  copilot-instructions)
- Add "What's New" section to README
- Update all 7 agent files with version and changes

---

## Bug Reporting and Issue Creation Workflow

**IMPORTANT: When users report bugs or request features:**

### Automatic Issue Creation (ENABLED)

When a user provides a list of bugs or features to implement:

1. **Document all issues** in a markdown file in `docs/manual/` or
   `docs/implementation-summaries/`
2. **DO AUTOMATICALLY CREATE GITHUB ISSUES** - Create GitHub issues for all bugs
   and features
3. **DO NOT mark issues as completed automatically** - The user will manually
   close issues when work is done
4. **Provide a clear list** of all bugs/features with:
   - Issue title
   - Detailed description
   - Priority level
   - Suggested labels
   - Root cause analysis (for bugs)
   - Implementation strategy

### How to Create GitHub Issues

When creating GitHub issues from user input or .md files:

1. **Extract all bugs/features** from the user's prompt or from .md files in the
   repository
2. **For each bug/feature**, create a GitHub issue with:
   - **Title**: Clear, actionable title (e.g., "Fix Quick Tab flash in top-left
     corner")
   - **Description**: Complete description including:
     - Problem statement or feature request
     - Root cause analysis (for bugs)
     - Implementation strategy
     - Testing requirements
   - **Labels**: Appropriate labels (bug, enhancement, documentation, etc.)
   - **Assignees**: Leave unassigned unless specified
3. **Track created issues** in your implementation documentation
4. **DO NOT automatically close issues** - Let the user manually close them

### Issue Documentation Format

For each bug/feature, document:

```markdown
### Issue Title: [Clear, descriptive title]

**Priority:** [Critical/High/Medium/Low]  
**Labels:** [bug/feature], [component], [other-labels]  
**GitHub Issue:** #XXX (link to created issue)

**Description:** [Detailed description of the issue or feature]

**Root Cause Analysis:** (for bugs) [Why the bug occurs, what code is affected]

**Implementation Strategy:** (for features) or **Fix Strategy:** (for bugs) [How
to implement/fix, what changes are needed]
```

### Checklist Items

When creating a checklist in PR descriptions:

- Use `- [ ]` for pending items (NOT `- [x]`)
- Let the user manually check off completed items
- Don't auto-check items even after you've completed the work
- Include links to GitHub issues you created

### Example

❌ **WRONG:**

```markdown
- [x] Fixed RAM usage bug (completed)
- [x] Closed GitHub issue #123
```

✅ **CORRECT:**

```markdown
- [ ] Fix RAM usage bug (GitHub issue #123 created)
- [ ] Fix Quick Tab flash (GitHub issue #124 created)
- [ ] Add console log export (GitHub issue #125 created)
```

This ensures that all bugs and features are tracked in GitHub issues while
allowing the user to manually mark them as complete when satisfied with the
implementation.

---

## MCP Server Utilization (MANDATORY)

This repository has **15 MCP servers** configured. GitHub Copilot Coding Agent MUST utilize them optimally for all tasks.

### Critical Priority MCPs (ALWAYS Use)

#### ESLint MCP Server ⭐ MANDATORY

**Rule:** EVERY code change MUST be linted with ESLint before committing.

**Workflow:**
1. Write/modify JavaScript
2. IMMEDIATELY: "Lint [filename] with ESLint"
3. Apply auto-fixes
4. Fix remaining issues
5. Verify zero errors
6. Proceed with commit

**NO EXCEPTIONS** - This is the primary quality gate.

#### Context7 MCP Server ⭐ MANDATORY

**Rule:** ALWAYS fetch current API documentation instead of relying on training data.

**Use Cases:**
- Implementing WebExtensions APIs
- Using external libraries
- Verifying API syntax
- Checking Firefox compatibility

**Example:** "Use Context7 to get latest Firefox clipboard API documentation"

#### NPM Package Registry MCP Server ⭐ MANDATORY

**Rule:** ALWAYS check packages before adding dependencies.

**Workflow:**
1. Search NPM Registry for package
2. Get package details
3. Check for vulnerabilities
4. Verify Firefox compatibility
5. Confirm active maintenance
6. Proceed with installation

**Example:** "Search npm for clipboard libraries compatible with WebExtensions and check for vulnerabilities"

### High Priority MCPs (Use Frequently)

#### GitHub MCP Server (Write-Enabled)

**Capabilities:** Create issues/PRs, add comments, update labels, trigger workflows

**Use For:**
- Creating GitHub issues automatically from bug reports
- Updating issue status and labels
- Creating pull requests
- Adding review comments

**Auto-Issue Creation:** When user provides bug list, automatically create GitHub issues using GitHub MCP.

#### Filesystem MCP Server

**Configured Paths:**
- `/workspace/src`, `/workspace/tests`, `/workspace/docs`
- `/workspace/background.js`, `/workspace/popup.js`, `/workspace/manifest.json`

**Use For:** Reading source code, writing new files, updating existing files

#### Git MCP Server

**Use For:** Creating commits, checking status, viewing history, showing diffs

#### Playwright (Firefox) MCP Server

**Configuration:** Firefox browser, clipboard permissions, isolated mode, traces saved

**Use For:** Testing extension functionality, verifying UI changes, creating automated tests

**ALWAYS test UI changes** with Playwright before finalizing.

### Medium Priority MCPs

- **Sentry MCP**: Error monitoring, stack traces, AI fix suggestions
- **Memory MCP**: Context persistence across sessions
- **Code Review MCP**: Automated PR reviews
- **Screenshot MCP**: Visual verification

### Lower Priority MCPs

- **Perplexity MCP**: Real-time web search
- **Brave Deep Research MCP**: Deep research
- **REST API Tester MCP**: API endpoint testing
- **GitHub Actions MCP**: CI/CD management

---

## Standard MCP Workflows

### Bug Fix Standard Workflow

```
1. Sentry MCP: Query error traces
2. Filesystem MCP: Read affected code
3. Context7 MCP: Get API docs ⭐
4. Filesystem MCP: Write fix
5. ESLint MCP: Lint code ⭐ MANDATORY
6. Playwright MCP: Test fix
7. Git MCP: Create commit
8. GitHub MCP: Update issue
```

### New Feature Standard Workflow

```
1. NPM Registry MCP: Search packages ⭐ MANDATORY
2. Context7 MCP: Get API docs ⭐ MANDATORY
3. Perplexity/Brave MCP: Research practices
4. Filesystem MCP: Write code
5. ESLint MCP: Lint code ⭐ MANDATORY
6. Playwright MCP: Create tests
7. Screenshot MCP: Document UI
8. Git MCP: Commit
9. GitHub MCP: Create PR
```

### Code Review Standard Workflow

```
1. Code Review MCP: Analyze changes
2. ESLint MCP: Check linting ⭐ MANDATORY
3. Git MCP: View history
4. Playwright MCP: Run tests
5. GitHub MCP: Add comments
```

### Dependency Update Standard Workflow

```
1. NPM Registry MCP: Check updates ⭐ MANDATORY
2. NPM Registry MCP: Check vulnerabilities ⭐ MANDATORY
3. Context7 MCP: Get migration guides
4. Filesystem MCP: Update package.json
5. ESLint MCP: Verify passes ⭐ MANDATORY
6. Playwright MCP: Run tests
7. Git MCP: Commit
8. GitHub MCP: Create PR
```

---

## MCP Usage Enforcement

### Before Every Commit Checklist

- [ ] ESLint MCP used on all modified JavaScript files
- [ ] Zero ESLint errors remaining
- [ ] Context7 used for any API implementations
- [ ] NPM Registry checked for any new dependencies
- [ ] Playwright tests run for UI changes
- [ ] Git commit created with descriptive message

### Before Every PR Checklist

- [ ] All commits linted with ESLint
- [ ] Code Review MCP analysis completed
- [ ] Playwright test suite passes
- [ ] GitHub MCP used to create PR
- [ ] Documentation updated (README, agent files)

---

## Quick Reference

**Full MCP Reference:** See `.github/mcp-utilization-guide.md` for complete details on all 15 MCP servers.

**Key Principle:** Utilize MCPs proactively and systematically to ensure highest quality code and comprehensive testing.
