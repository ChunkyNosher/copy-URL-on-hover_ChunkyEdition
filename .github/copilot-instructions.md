# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.0.10  
**Language:** JavaScript (ES6+)  
**Purpose:** URL management with Solo/Mute visibility control, complete Firefox Container isolation, and persistent floating panel manager

---

## 🎯 CRITICAL: Robust Solutions Philosophy

**ALWAYS prioritize:**
- ✅ Fix root causes at the architectural level
- ✅ Eliminate technical debt rather than accumulating it
- ✅ Use the RIGHT pattern/API even if it takes more code

**NEVER accept:**
- ❌ Mask symptoms without fixing the root problem
- ❌ Quick hacks just to "make it work"
- ❌ Sacrifice correctness for perceived simplicity

**Remember: Complex-but-correct is better than simple-but-broken.**

---

## Memory Persistence 🧠 MANDATORY

### At the end of EVERY task:

```bash
git add .agentic-tools-mcp/
git commit -m "chore: persist agent memory from task"
git push
```

**Memory File Locations:**
- `.agentic-tools-mcp/memories/` - Individual JSON files by category
- `.agentic-tools-mcp/tasks/` - Task and project data

**Why:** Ephemeral environment destroyed when session ends. If you don't commit, they're lost forever.

---

## Memory Workflow (Agentic-Tools MCP)

### 1. ALWAYS Search Memories First 🔍

**Before ANY task:**
```javascript
const memories = await searchMemories({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  query: "keywords about task/feature/component",
  limit: 5,
  threshold: 0.3,
  category: "architecture"  // Optional filter
});
```

**Check for:** Similar work, architectural decisions, research, patterns

---

### 2. Create Memories for Learnings

```javascript
await createMemory({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  title: "Short Title (max 50 chars)",
  content: "Detailed content (no limit)",
  category: "architecture",  // See categories below
  metadata: {
    components: ["file1.js", "file2.js"],
    relatedIssues: ["#123"],
    importance: "critical",  // critical|high|medium|low
    tags: ["container", "isolation"],
    implementedDate: "2025-11-21",
    confidence: 0.9  // 0-1 scale
  }
});
```

**Memory Categories:**

| Category | Use For |
|----------|---------|
| `architecture` | Design patterns, system architecture |
| `technical` | Implementation details, API usage |
| `best-practices` | Standards, conventions |
| `preferences` | User preferences, style guides |
| `research` | Research findings, external resources |
| `troubleshooting` | Known issues, solutions, fixes |
| `project-context` | Repo structure, build config |

---

## Task Management 📋

### When to Use

Multi-step features, complex refactors, projects with dependencies, work spanning multiple PR sessions.

### Core Tools

**Create Project:**
```javascript
await createProject({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  name: "Feature Name",
  description: "High-level overview"
});
```

**Create Task (Unlimited Nesting):**
```javascript
await createTask({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  projectId: "[project-id]",
  parentId: "[parent-id]",  // Optional - creates subtask
  name: "Task name",
  details: "Detailed description",
  priority: 8,        // 1-10 (10 = highest)
  complexity: 6,      // 1-10 (10 = most complex)
  status: "pending",  // pending|in-progress|blocked|done
  tags: ["refactor", "architecture"],
  estimatedHours: 8,
  dependsOn: ["[other-task-id]"]  // Optional dependencies
});
```

**Update Task:**
```javascript
await updateTask({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  id: "[task-id]",
  status: "done",
  completed: true,
  actualHours: 7
});
```

---

## AI Agent Advanced Tools 🤖

### Task Recommendations

Get AI-powered next task suggestion:
```javascript
const recommendation = await getNextTaskRecommendation({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  projectId: "[project-id]"
});
// Returns optimal task based on dependencies, priority, complexity
```

### Complexity Analysis

Identify overly complex tasks:
```javascript
const analysis = await analyzeTaskComplexity({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  taskId: "[task-id]",
  complexityThreshold: 7
});
// If > threshold, returns suggested subtask breakdown
```

### PRD Parsing

Auto-generate tasks from requirements:
```javascript
await parsePRD({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  projectId: "[project-id]",
  prdContent: `
## Feature: Name

### Requirements
1. Requirement 1 (HIGH PRIORITY)
   - Detail A
   - Estimated: 8 hours

2. Requirement 2 (MEDIUM PRIORITY)
   - Detail B
   - Estimated: 6 hours
  `
});
// Creates complete project structure automatically
```

### Progress Inference

Auto-detect task completion:
```javascript
const progress = await inferTaskProgress({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  projectId: "[project-id]",
  autoUpdateTasks: true,
  confidenceThreshold: 0.7
});
// Analyzes codebase for completion evidence
```

### Research Automation

```javascript
// 1. Generate research queries
const queries = await generateResearchQueries({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  taskId: "[task-id]",
  queryTypes: ["implementation", "best_practices"]
});

// 2. Research with Perplexity MCP
const results = await perplexity_reason({
  messages: [
    { role: "system", content: "Research assistant" },
    { role: "user", content: queries[0] }
  ]
});

// 3. Store as memory
await createMemory({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  title: "Research: Topic",
  content: results.content,
  category: "research",
  metadata: { relatedTask: "[task-id]" }
});
```

---

## MCP Server Utilization

### MANDATORY MCPs (ALWAYS Use)

**ESLint MCP ⭐**
- EVERY code change MUST be linted before committing
- Write code → Lint → Apply fixes → Verify zero errors → Commit

**Context7 MCP ⭐**
- ALWAYS fetch current docs instead of relying on training data
- Use for WebExtensions APIs, external libraries, Firefox compatibility

**Perplexity MCP ⭐**
- Real-time web search with reasoning
- Model: `sonar-reasoning-pro` (with citations)
- Tool: `perplexity_reason`

### High Priority MCPs

**GitHub MCP** - Create/update issues & PRs, add comments, trigger workflows  
**Playwright (Firefox & Chrome)** - Testing extension functionality, UI verification  
**CodeScene MCP** - Code health analysis, technical debt detection  
**Codecov MCP** - Test coverage analysis  
**GitHub Actions MCP** - CI/CD workflow management

---

## Standard Workflows

### Bug Fix
```
1. Search memories (similar bugs) 🧠🔍
2. Context7: Get API docs ⭐
3. Write fix
4. ESLint: Lint and fix ⭐
5. Playwright: Test fix
6. GitHub MCP: Update issue
7. Create memory (fix details) 🧠
8. Commit memory files 🧠
```

### New Feature (With Tasks)
```
1. Search memories (related features) 🧠🔍
2. Create project + tasks 📋
3. Get task recommendation 📋
4. Perplexity: Research ⭐
5. Context7: Get API docs ⭐
6. Update task to in-progress 📋
7. Write code
8. ESLint: Lint and fix ⭐
9. Playwright: Create tests
10. Mark task done 📋
11. Create memory (architecture) 🧠
12. Commit memory + task files 🧠📋
```

---

## Browser Extension Rules

### Message Passing Security
```javascript
// ✅ GOOD - Validate sender
browser.runtime.onMessage.addListener((message, sender) => {
  if (!sender.id || sender.id !== browser.runtime.id) {
    return Promise.reject(new Error('Unauthorized'));
  }
  // Process message
});
```

### Storage API
```javascript
// ✅ Handle quotas and errors
async function saveState(state) {
  try {
    const size = new Blob([JSON.stringify(state)]).size;
    if (size > 100 * 1024) throw new Error(`Too large: ${size}`);
    await browser.storage.sync.set({ state });
  } catch (error) {
    await browser.storage.local.set({ state }); // Fallback
  }
}
```

### Container Isolation
```javascript
// ✅ Always use cookieStoreId
async function getTabState(tabId) {
  const tab = await browser.tabs.get(tabId);
  const cookieStoreId = tab.cookieStoreId || 'firefox-default';
  return await getStateForContainer(cookieStoreId);
}
```

---

## Testing (Playwright MCP) 🎭

### Test Bridge Pattern

**Setup:**
```javascript
import { ExtensionTestHelper } from './tests/extension/helpers/extension-test-utils.js';

test('create Quick Tab', async ({ page }) => {
  const helper = new ExtensionTestHelper(page);
  await page.goto('https://example.com');
  
  await helper.waitForTestBridge();
  await helper.createQuickTab('https://github.com');
  
  const tabs = await helper.getQuickTabs();
  expect(tabs).toHaveLength(1);
});
```

**Run Tests:**
```bash
npm run test:extension        # All tests
npm run test:extension:ui     # With UI
npm run test:extension:debug  # Debug mode
```

**Test Bridge API:**
- `createQuickTab(url, options)` - Create Quick Tab
- `getQuickTabs()` - Get all Quick Tabs
- `minimizeQuickTab(id)` - Minimize
- `restoreQuickTab(id)` - Restore
- `closeQuickTab(id)` - Close
- `clearAllQuickTabs()` - Cleanup
- `waitForQuickTabCount(n)` - Wait for sync

---

## Code Style

### Preferred
```javascript
// ✅ const for immutable
const MAX_RETRIES = 3;

// ✅ async/await
async function fetchData() {
  return await fetch(url);
}

// ✅ Arrow functions
items.map(item => item.value);

// ✅ Template literals
const msg = `Hello ${name}`;

// ✅ Destructuring
const { id, name } = user;
```

### Avoid
```javascript
// ❌ Don't use var
// ❌ Don't use eval or new Function
// ❌ Don't use innerHTML with user input
// ❌ Don't ignore errors (empty catch)
// ❌ Don't use console.log in production
```

---

## Documentation Updates

### MANDATORY Updates

**Update README.md when:**
- Version numbers change
- Features/functionality change
- Settings/configuration change

**Update Agent Files when:**
- Architecture changes
- Build/test/deploy processes change

### Version Synchronization

When version changes X.Y.Z → X.Y.Z+1:
- `manifest.json` version
- `package.json` version
- README header & footer
- `.github/copilot-instructions.md` Project Overview
- Add "What's New" section to README

---

## Bug Reporting

### Automatic Issue Creation (ENABLED)

When user reports bugs:
1. Document in `docs/manual/` or `docs/implementation-summaries/`
2. CREATE GITHUB ISSUES automatically using GitHub MCP
3. DO NOT auto-close issues
4. Include: title, description, root cause, implementation strategy, labels

### Checklist Format

Use `- [ ]` for pending (NOT `- [x]`):
```markdown
✅ CORRECT:
- [ ] Fix RAM usage bug (GitHub issue #123 created)
```

---

## Common Issues

### Race Conditions
```javascript
// ❌ BAD
async function incrementCounter() {
  const { counter } = await browser.storage.sync.get('counter');
  await browser.storage.sync.set({ counter: counter + 1 });
}

// ✅ GOOD - Atomic
async function incrementCounter() {
  return browser.storage.sync.get('counter').then(({ counter = 0 }) =>
    browser.storage.sync.set({ counter: counter + 1 })
  );
}
```

### Memory Leaks
```javascript
// ✅ Cleanup listeners
function setupListener() {
  const listener = handleUpdate;
  browser.tabs.onUpdated.addListener(listener);
  return () => browser.tabs.onUpdated.removeListener(listener);
}
```

### Unhandled Promises
```javascript
// ✅ Handle all rejections
browser.storage.sync.set({ data }).catch(error => {
  console.error('Storage error:', error);
  showUserNotification('Save failed');
});
```

---

## Before Every Commit Checklist

- [ ] **Searched memories before starting** 🧠🔍
- [ ] ESLint used on all modified files ⭐
- [ ] Zero ESLint errors ⭐
- [ ] Context7 used for API implementations ⭐
- [ ] All testing suites run ⭐
- [ ] **Playwright tests run for extension changes** 🎭
- [ ] **Tasks created for multi-step features** 📋
- [ ] **Task status updated** 📋
- [ ] **Completed tasks marked done** 📋
- [ ] **Task data committed** (`.agentic-tools-mcp/tasks/`) 📋
- [ ] **Memory files committed** (`.agentic-tools-mcp/`) 🧠
- [ ] Memory files follow naming: `Category/Title.json` 🧠
- [ ] **Referenced relevant memories in code** 🧠

---

## Before Every PR Checklist

- [ ] All commits linted ⭐
- [ ] **Playwright test suite passes** 🎭
- [ ] Documentation updated
- [ ] **Memory files included in PR** 🧠
- [ ] GitHub MCP used to create PR

---

## Documentation Organization

**Save markdown files to:**
- Bug analysis → `docs/manual/`
- Implementation guides → `docs/manual/`
- Implementation summaries → `docs/implementation-summaries/`
- Changelog updates → **APPEND to `docs/CHANGELOG.md`**

**DO NOT** save to root (except README.md).

---

## Final Notes

**When in doubt:**
1. Prioritize security over convenience
2. Add error handling rather than assuming success
3. Write tests before marking done
4. Document decisions in code comments
5. **ALWAYS commit memory files before finishing** 🧠

**This extension handles user data and browsing history. Security and privacy are paramount.**
