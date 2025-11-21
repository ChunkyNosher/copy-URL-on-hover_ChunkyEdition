# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.0.3  
**Language:** JavaScript (ES6+)  
**Architecture:** Domain-Driven Design with Clean Architecture  
**Purpose:** URL management with Solo/Mute visibility control, complete Firefox Container isolation, and persistent floating panel manager

**Key Features:**
- Solo/Mute tab-specific visibility control
- Firefox Container complete isolation
- Floating Quick Tabs Manager with persistent panel
- Cross-tab sync via BroadcastChannel + browser.storage
- Direct local creation pattern (content renders first, background persists)

---

## 🎯 CRITICAL: Robust Solutions Philosophy

### Core Principle: Fix Root Causes, Not Symptoms

**ALWAYS prioritize solutions that:**
- ✅ Fix the actual underlying behavior causing the issue
- ✅ Address root causes at the architectural level
- ✅ Eliminate technical debt rather than accumulating it
- ✅ Prevent entire classes of bugs from recurring
- ✅ Use the RIGHT pattern/API even if it takes more code

**NEVER accept solutions that:**
- ❌ Mask symptoms without fixing the root problem
- ❌ Add workarounds instead of fixing the core issue
- ❌ Use quick hacks just to "make it work"
- ❌ Sacrifice correctness for perceived simplicity
- ❌ Add technical debt for short-term convenience

**Code Review Red Flags:**

If you think: "This setTimeout should fix it" → ❌ Fix the race condition  
If you think: "I'll catch and ignore this error" → ❌ Fix the error source  
If you think: "This workaround is easier" → ❌ Implement properly  

**Remember: Complex-but-correct is better than simple-but-broken.**

---

## Memory Persistence Instructions 🧠

### CRITICAL: At the end of EVERY task, you MUST:

1. **Stage memory files for commit:**
   - `git add .in-memoria/`
   - `git add .agentic-tools/`
   - `git add .mcp-data/`

2. **Commit memory files with your code changes:**
   - Include memory files in your final commit
   - Use commit message: "chore: persist agent memory from task"

3. **Push to the PR branch:**
   - Ensure memory files are included in the push

### Memory File Locations

- `.in-memoria/` - Code intelligence patterns (In-Memoria MCP)
- `.agentic-tools/` - Task tracking and session memory (Agentic-Tools MCP)
- `.mcp-data/` - SQLite database for structured memory (Persistent-Memory MCP)

**Why This Matters:** Your memory files are stored in an ephemeral environment that gets destroyed when your session ends. If you don't commit them to the PR, they will be lost forever.

### Verification Before Finishing

Check that `.in-memoria/`, `.agentic-tools/`, and `.mcp-data/` appear in your commit. If missing, ADD THEM NOW.

### CRITICAL: Memory Tool Names: DO NOT USE "store_memory" TOOL CALL TO STORE A MEMORY, IT DOES NOT EXIST. 
Use either in-memoria, agentic-tools, or persistent-memory MCP to properly store a memory.

**This is NON-NEGOTIABLE for memory persistence across tasks.**

---

## MCP Server Utilization (12 Servers Configured)

### Critical Priority MCPs (ALWAYS Use)

#### ESLint MCP ⭐ MANDATORY
- **Purpose:** JavaScript linting, auto-fixing, code quality
- **Rule:** EVERY code change MUST be linted before committing
- **Workflow:** Write code → Lint immediately → Apply fixes → Verify zero errors → Commit

#### Context7 MCP ⭐ MANDATORY
- **Purpose:** Up-to-date API documentation
- **Rule:** ALWAYS fetch current docs instead of relying on training data
- **Use For:** WebExtensions APIs, external libraries, Firefox compatibility

#### Perplexity MCP ⭐ MANDATORY
- **Purpose:** Real-time web search with reasoning
- **Model:** sonar-reasoning-pro (with citations)
- **Use For:** Current information, best practices, recent solutions
- **Tool:** `perplexity_reason` - Advanced reasoning with web search

### High Priority MCPs (Use Frequently)

#### GitHub MCP (Write-Enabled)
- **Capabilities:** Create/update issues & PRs, add comments, trigger workflows
- **Use For:** Auto-creating issues from bug reports, updating status, PR management

#### Playwright (Firefox & Chrome) MCPs
- **Configuration:** Firefox & Chrome browsers, clipboard permissions, isolated mode
- **Use For:** Testing extension functionality, verifying UI changes, automated tests

#### CodeScene MCP
- **Purpose:** Code health analysis, technical debt detection
- **Use For:** Architecture analysis, refactoring priorities, complexity monitoring

#### Codecov MCP
- **Purpose:** Test coverage analysis
- **Use For:** Coverage reports, tracking test quality, identifying gaps

#### GitHub Actions MCP
- **Purpose:** CI/CD workflow management
- **Use For:** Triggering workflows, checking build status, automation

### Memory & Intelligence MCPs (Session Persistence)

#### In-Memoria MCP 🧠
- **Purpose:** Semantic code intelligence with vector embeddings
- **Storage:** `.in-memoria/patterns.db` (SQLite) + embeddings (SurrealDB)
- **Tools:** `learn_codebase_intelligence`, `query_patterns`, `contribute_insights`
- **CRITICAL:** Commit `.in-memoria/patterns.db` to persist learnings

#### Agentic-Tools MCP 🧠
- **Purpose:** Task management and agent memories
- **Storage:** `.agentic-tools/` (JSON files)
- **Tools:** `create_task`, `create_memory`, `search_memories`, `get_project_info`
- **CRITICAL:** Commit `.agentic-tools/*.json` to persist tasks/memories

#### Persistent-Memory MCP 🧠
- **Purpose:** SQLite-based structured memory
- **Storage:** `.mcp-data/memory.db`
- **Tools:** `sqlite_execute`, `sqlite_get_catalog`
- **CRITICAL:** Commit `.mcp-data/memory.db` to persist data

---

## Standard MCP Workflows

### Bug Fix Workflow
```
1. Context7 MCP: Get API docs ⭐
2. Write fix
3. ESLint MCP: Lint and fix ⭐ MANDATORY
4. Playwright MCP: Test fix
5. GitHub MCP: Update issue
6. Commit memory files 🧠
```

### New Feature Workflow
```
1. Perplexity MCP: Research best practices ⭐
2. Context7 MCP: Get API docs ⭐
3. Write feature code
4. ESLint MCP: Lint and fix ⭐ MANDATORY
5. Playwright MCP: Create tests
6. GitHub MCP: Create PR
7. Commit memory files 🧠
```

### Memory Persistence Workflow (EVERY Task)
```
1. Complete work
2. git add .in-memoria/ .agentic-tools/ .mcp-data/
3. git commit -m "chore: persist agent memory from task"
4. git push
```

---

## Browser Extension Specific Rules

### Message Passing Security

**ALWAYS validate sender:**
```javascript
// ✅ GOOD - Validate sender
browser.runtime.onMessage.addListener((message, sender) => {
  if (!sender.id || sender.id !== browser.runtime.id) {
    return Promise.reject(new Error('Unauthorized'));
  }
  // Process message
});
```

### Storage API Best Practices

**Always handle quotas and errors:**
```javascript
// ✅ GOOD - Check quota and handle errors
async function saveState(state) {
  try {
    const stateSize = new Blob([JSON.stringify(state)]).size;
    if (stateSize > 100 * 1024) { // sync has 100KB limit
      throw new Error(`State too large: ${stateSize} bytes`);
    }
    await browser.storage.sync.set({ state });
  } catch (error) {
    console.error('Storage error:', error);
    // Fallback to local storage
    await browser.storage.local.set({ state });
  }
}
```

### Container Isolation

**Always use `cookieStoreId` for container-aware operations:**
```javascript
async function getTabState(tabId) {
  const tab = await browser.tabs.get(tabId);
  const cookieStoreId = tab.cookieStoreId || 'firefox-default';
  return await getStateForContainer(cookieStoreId);
}
```

---

## Testing Requirements

### Minimum Coverage Standards
- **Critical paths:** 100% coverage (container isolation, state management, message handlers)
- **New features:** 80% coverage minimum
- **Bug fixes:** Add regression test

### Required Test Types
1. Unit tests - Individual functions
2. Integration tests - Component interactions
3. Error scenario tests - Failure cases
4. Container isolation tests - Multi-container scenarios

---

## Code Style & Patterns

### Preferred Patterns
```javascript
// ✅ Use const for immutable values
const MAX_RETRIES = 3;

// ✅ Use async/await
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
// ❌ Don't use eval or new Function
// ❌ Don't use innerHTML with user input
// ❌ Don't ignore errors (empty catch blocks)
// ❌ Don't use console.log in production
```

---

## Documentation Update Requirements

### MANDATORY Updates Based on Change Type

#### Update README.md when:
- Version numbers change
- Features or functionality change
- User interface or UX changes
- Settings or configuration change
- Known limitations change

**README must stay under 10KB** - Remove outdated information, historical data goes to `docs/CHANGELOG.md`

#### Update Agent Files when:
- Version numbers change
- Architecture changes (patterns, structure)
- New APIs or features across multiple agents
- Build/test/deploy processes change
- Repository structure changes

**Agent files to update:**
- `.github/copilot-instructions.md` (this file) - Common knowledge
- Individual files in `.github/agents/` - Agent-specific methodologies

### Version Synchronization

When version changes from X.Y.Z to X.Y.Z+1:
- Update `manifest.json` version
- Update `package.json` version
- Update README header & footer
- Update `.github/copilot-instructions.md` (Project Overview)
- Add "What's New" section to README

---

## Bug Reporting and Issue Creation

### Automatic Issue Creation (ENABLED)

When user reports bugs or requests features:

1. **Document all issues** in `docs/manual/` or `docs/implementation-summaries/`
2. **CREATE GITHUB ISSUES** automatically using GitHub MCP
3. **DO NOT auto-close issues** - User closes manually
4. **Include:**
   - Clear, actionable title
   - Detailed description
   - Root cause analysis (for bugs)
   - Implementation strategy
   - Appropriate labels

### Checklist Format

Use `- [ ]` for pending items (NOT `- [x]`):

```markdown
✅ CORRECT:
- [ ] Fix RAM usage bug (GitHub issue #123 created)
- [ ] Add console log export (GitHub issue #124 created)
```

---

## Common Issues to Watch For

### Race Conditions
```javascript
// ❌ BAD
async function incrementCounter() {
  const { counter } = await browser.storage.sync.get('counter');
  await browser.storage.sync.set({ counter: counter + 1 });
}

// ✅ GOOD - Atomic operation
async function incrementCounter() {
  return browser.storage.sync.get('counter').then(({ counter = 0 }) =>
    browser.storage.sync.set({ counter: counter + 1 })
  );
}
```

### Memory Leaks
```javascript
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
// ✅ GOOD - Handle all rejections
browser.storage.sync.set({ data }).catch(error => {
  console.error('Storage error:', error);
  showUserNotification('Save failed');
});
```

---

## Before Every Commit Checklist

- [ ] ESLint MCP used on all modified JS files ⭐
- [ ] Zero ESLint errors remaining ⭐
- [ ] Context7 used for API implementations ⭐
- [ ] Playwright tests run for UI changes
- [ ] **Memory files committed** (.in-memoria/, .agentic-tools/, .mcp-data/) 🧠

---

## Before Every PR Checklist

- [ ] All commits linted with ESLint ⭐
- [ ] Playwright test suite passes
- [ ] Documentation updated (README, agent files if applicable)
- [ ] **Memory files included in PR** 🧠
- [ ] GitHub MCP used to create PR

---

## Documentation Organization

**Save markdown files to appropriate `docs/` subdirectories:**
- Bug analysis → `docs/manual/`
- Implementation guides → `docs/manual/`
- Implementation summaries → `docs/implementation-summaries/`
- Release summaries → `docs/misc/`
- Changelog updates → **APPEND to `docs/CHANGELOG.md`**

**DO NOT** save markdown files to root directory (except README.md).

---

## Final Notes

**When in doubt:**
1. Prioritize security over convenience
2. Add error handling rather than assuming success
3. Write tests before marking as done
4. Document decisions in code comments
5. Ask for human review on security-critical changes
6. **ALWAYS commit memory files before finishing** 🧠

**This extension handles user data and browsing history. Security and privacy are paramount.**
