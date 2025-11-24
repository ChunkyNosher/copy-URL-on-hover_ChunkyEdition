# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.x  
**Language:** JavaScript (ES6+)  
**Architecture:** Domain-Driven Design with Clean Architecture  
**Purpose:** URL management with Solo/Mute visibility control, complete Firefox Container isolation, and persistent floating panel manager with granular console log filtering

**Key Features:**
- Solo/Mute tab-specific visibility control
- Firefox Container complete isolation
- Floating Quick Tabs Manager with persistent panel
- Cross-tab sync via BroadcastChannel + browser.storage
- Direct local creation pattern (content renders first, background persists)
- Two-layer sidebar tab system (Settings + Quick Tab Manager)

**Sidebar Architecture (v1.6.1.4+):**
- **Two-Layer Tab System:** Primary tabs (Settings, Quick Tab Manager) + Secondary tabs (Copy URL, Quick Tabs, Appearance, Advanced)
- **Firefox API Limitation:** Only ONE sidebar_action per extension (cannot create separate sidebars)
- **State Persistence:** Tab selections stored in localStorage (sidebarActivePrimaryTab, sidebarActiveSecondaryTab)
- **Keyboard Shortcut:** Alt+Shift+Z opens sidebar and switches to Manager tab
- **Files:** sidebar/settings.html, sidebar/settings.js, background.js, manifest.json

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

## 📏 File Size and Documentation Limits

### Size Limits (ENFORCED)

**Copilot Agent Files:**
- `.github/copilot-instructions.md` - **MAXIMUM 25KB (25,600 bytes)**
- `.github/agents/*.md` - **MAXIMUM 25KB (25,600 bytes) each**

**Documentation Files:**
- Any documentation written by Copilot - **MAXIMUM 20KB (20,480 bytes)**
- Check file size before committing: `wc -c filename.md`

### Documentation Location Rules

**PROHIBITED:**
- ❌ DO NOT write documentation to `docs/manual/` directory
- ❌ DO NOT create new markdown files in root directory (except README.md)

**ALLOWED:**
- ✅ `docs/implementation-summaries/` - Implementation summaries
- ✅ `docs/CHANGELOG.md` - Append changelog entries only
- ✅ In-code comments and JSDoc documentation

**Why:** The `docs/manual/` directory is reserved for user-facing documentation maintained separately.

---

## 🧠 Memory Persistence Instructions (Agentic-Tools MCP)

### CRITICAL: At the end of EVERY task, you MUST:

1. **Stage memory files for commit:**
   ```bash
   git add .agentic-tools-mcp/
   ```

2. **Commit memory files with your code changes:**
   ```bash
   git commit -m "chore: persist agent memory from task"
   ```

3. **Push to the PR branch:**
   - Ensure memory files are included in the push

### Memory File Locations

- `.agentic-tools-mcp/memories/` - Individual memory JSON files organized by category
- `.agentic-tools-mcp/tasks/` - Task and project data files

**Why This Matters:** Your memory files are stored in an ephemeral environment that gets destroyed when your session ends. If you don't commit them to the PR, they will be lost forever.

---

## Memory Workflow (Agentic-Tools MCP)

### 1. ALWAYS Search Memories First 🔍

**CRITICAL WORKFLOW RULE:**
Before starting ANY task, search memories for relevant context.

**When to Search:**
- Before implementing new features
- Before refactoring existing code
- Before researching topics (check if already researched)
- Before making architectural decisions

**Search Workflow:**

```javascript
const relevantMemories = await searchMemories({
  workingDirectory: process.env.GITHUB_WORKSPACE/.agentic-tools-mcp,
  query: "keywords about task/feature/component",
  limit: 5,
  threshold: 0.3,
  category: "architecture"  // Optional filter
});
```

**Check results for:**
- Similar work done before
- Past architectural decisions
- Related research findings
- Relevant patterns or best practices

**Search Query Tips (CRITICAL - search uses simple text matching, NOT semantic):**
- **⚠️ KEEP QUERIES SHORT (1-3 keywords max)** - Long queries return NO results
- **❌ BAD:** "Quick Tabs cross-tab synchronization BroadcastChannel architecture"
- **✅ GOOD:** "cross-tab", "BroadcastChannel", "Quick Tab"
- Run multiple short queries instead of one long query
- Use category filter to narrow results (e.g., `category: "architecture"`)
- Exact token matching required (use "cross-tab" not "cross tab")

**Multi-Query Pattern:** Search "sync", "BroadcastChannel", "Quick Tab" separately, combine results.

---

### 2. Create Memories for Learnings

**For Agent Memories (Learnings, Context, Decisions):**

✅ Use `create_memory` tool from agentic-tools MCP

**Required Parameters:**
- `workingDirectory`: Absolute path to project (e.g., `/home/runner/work/copy-URL-on-hover_ChunkyEdition/copy-URL-on-hover_ChunkyEdition`)
- `title`: Short descriptive title (max 50 characters, used for filename)
- `content`: Detailed memory content (no limit)

**Optional Parameters:**
- `category`: Categorization string
- `metadata`: Flexible metadata object for additional context

**Example:**
```javascript
await createMemory({
  workingDirectory: process.env.GITHUB_WORKSPACE/.agentic-tools-mcp,
  title: "Container Isolation Architecture Pattern",
  content: "This extension uses cookieStoreId for complete Firefox container isolation. Key implementation: Always query tabs with cookieStoreId filter to maintain separation between containers. State manager tracks per-container data.",
  category: "architecture",
  metadata: {
    components: ["state-manager.js", "background.js"],
    relatedIssues: ["#123"],
    importance: "critical",
    tags: ["container", "isolation", "state-management"],
    implementedDate: "2025-11-21",
    confidence: 0.9
  }
});
```

---

### Memory Schema Validation

**CRITICAL: Memory files MUST follow this exact schema to prevent search errors:**

All memory JSON files require these fields:
- `id` (string) - Unique identifier
- `title` (string) - Short descriptive title
- `details` (string) - **NOT** `content` - Full memory content
- `category` (string) - Category classification
- `dateCreated` (ISO date string) - Creation timestamp
- `dateUpdated` (ISO date string) - Last update timestamp
- `metadata` (object, optional) - Additional context

**Common Error:** Using `content` field instead of `details` causes search_memories to fail with:
```
Error: Cannot read properties of undefined (reading 'toLowerCase')
```

**Validation Commands:**
```bash
# Check for missing required fields
find .agentic-tools-mcp/memories -name "*.json" -exec sh -c 'jq -e ".title and .details and .category" "$1" > /dev/null || echo "Missing fields: $1"' _ {} \;

# Check for incorrect 'content' field (should be 'details')
find .agentic-tools-mcp/memories -name "*.json" -exec sh -c 'jq -e ".content" "$1" > /dev/null 2>&1 && echo "Wrong schema: $1"' _ {} \;
```

**Note:** The agentic-tools MCP `create_memory` tool uses the parameter name `content` but stores it as `details` in the JSON file. This is correct behavior - do not manually create memory files with `content` field.

---

### Memory Categorization Standards

**Use consistent categories for efficient retrieval:**

| Category | Use For | Examples |
|----------|---------|----------|
| `architecture` | Design patterns, system architecture | "Container Isolation Pattern" |
| `technical` | Implementation details, API usage | "CookieStoreId API Usage" |
| `best-practices` | Standards, conventions, patterns | "ESLint Configuration Standards" |
| `preferences` | User preferences, style guides | "Code Style Preferences" |
| `research` | Research findings, external resources | "WebExtension Performance Research" |
| `troubleshooting` | Known issues, solutions, fixes | "Container State Race Condition Fix" |
| `project-context` | Repo structure, build config | "Repository Structure" |

**Category Selection Guidelines:**
- Architecture > Technical (if both apply)
- Specific > General (prefer more specific category)
- Use metadata for additional tags

---

### Memory Metadata Schema

**Recommended metadata structure for rich context:**

```javascript
metadata: {
  // Component references
  components: ["state-manager.js", "background.js"],
  
  // Related files
  relatedFiles: [
    "src/state-manager.js",
    "src/background.js"
  ],
  
  // Related issues/PRs
  relatedIssues: ["#123"],
  relatedPRs: ["#456"],
  
  // Importance level
  importance: "critical",  // critical | high | medium | low
  
  // Tags for additional context
  tags: ["container", "isolation", "state-management"],
  
  // Source of information
  source: "implementation",  // implementation | research | documentation | conversation
  
  // Date context
  implementedDate: "2025-11-21",
  lastVerified: "2025-11-21",
  
  // Confidence level
  confidence: 0.9  // 0-1 scale
}
```

---

## 📋 Task Management System (Agentic-Tools MCP)

### When to Use Task Management

**Task management is for:**
- Multi-step features requiring planning
- Complex refactors spanning multiple files
- Projects with dependencies between tasks
- Work that spans multiple PR sessions

### Creating a Project Plan

**1. Start with project creation:**
```javascript
await createProject({
  workingDirectory: process.env.GITHUB_WORKSPACE/.agentic-tools-mcp,
  name: "Feature Name",
  description: "High-level overview of feature goals"
});
```

**2. Break down into tasks:**
```javascript
await createTask({
  workingDirectory: process.env.GITHUB_WORKSPACE/.agentic-tools-mcp,
  projectId: "[project-id]",
  name: "Task name",
  details: "Detailed task description",
  priority: 8,        // 1-10 (10 = highest)
  complexity: 6,      // 1-10 (10 = most complex)
  status: "pending",  // pending | in-progress | blocked | done
  tags: ["refactor", "architecture"],
  estimatedHours: 8
});
```

**3. Create subtasks for task breakdown (unlimited nesting):**
```javascript
await createTask({
  workingDirectory: process.env.GITHUB_WORKSPACE/.agentic-tools-mcp,
  projectId: "[project-id]",
  parentId: "[parent-task-id]",  // Creates subtask
  name: "Subtask name",
  details: "Subtask details",
  priority: 7,
  complexity: 4,
  estimatedHours: 3
});

// Create sub-subtasks (infinite depth!)
await createTask({
  workingDirectory: process.env.GITHUB_WORKSPACE/.agentic-tools-mcp,
  projectId: "[project-id]",
  parentId: "[subtask-id]",  // Creates sub-subtask
  name: "Sub-subtask name"
  // ... supports unlimited nesting!
});
```

**4. Track progress:**
```javascript
// Update task status as you work
await updateTask({
  workingDirectory: process.env.GITHUB_WORKSPACE/.agentic-tools-mcp,
  id: "[task-id]",
  status: "in-progress",
  actualHours: 3
});

// Mark complete
await updateTask({
  workingDirectory: process.env.GITHUB_WORKSPACE/.agentic-tools-mcp,
  id: "[task-id]",
  status: "done",
  completed: true,
  actualHours: 8
});
```

**Task Dependencies:**
```javascript
await createTask({
  workingDirectory: process.env.GITHUB_WORKSPACE/.agentic-tools-mcp,
  projectId: "[project-id]",
  name: "Write integration tests",
  dependsOn: ["[implementation-task-id]"],  // Can't start until implementation done
  priority: 7,
  complexity: 4
});
```

**Workflow Integration:**
- Create tasks at start of complex features
- Update status as you work through PR
- Mark tasks complete before final commit
- Commit `.agentic-tools-mcp/tasks/` with code changes

---

## 🤖 AI Agent Advanced Tools (Agentic-Tools MCP)

### Intelligent Task Recommendations

Get AI-powered task prioritization based on dependencies, priority, and complexity:

```javascript
const recommendation = await getNextTaskRecommendation({
  workingDirectory: process.env.GITHUB_WORKSPACE/.agentic-tools-mcp,
  projectId: "[project-id]"
});
// Returns optimal next task to work on
```

**Benefits:**
- Autonomous task selection (no human guidance needed)
- Never works on blocked tasks
- Balances high-value, achievable work
- Reduces decision paralysis

---

### Automatic Task Complexity Analysis

Identify overly complex tasks and get automatic breakdown suggestions:

```javascript
const analysis = await analyzeTaskComplexity({
  workingDirectory: process.env.GITHUB_WORKSPACE/.agentic-tools-mcp,
  taskId: "[task-id]",
  complexityThreshold: 7
});
// If complexity > threshold, returns suggested subtasks
```

**Benefits:**
- Prevents overwhelming tasks
- Improves task completion rate
- Better progress tracking
- Reduces cognitive load

---

### PRD Parsing Automation

Parse Product Requirements Documents into structured task breakdowns automatically:

```javascript
const prdContent = `
## Feature: Enhanced Console Log Filtering

### Requirements
1. Add granular log level filtering (HIGH PRIORITY)
   - Filter by: error, warn, info, debug
   - Per-tab filtering persistence
   - Estimated: 8 hours

2. Export filtered logs (MEDIUM PRIORITY)
   - CSV export functionality
   - JSON export with metadata
   - Estimated: 6 hours
`;

await parsePRD({
  workingDirectory: process.env.GITHUB_WORKSPACE/.agentic-tools-mcp,
  projectId: "[project-id]",
  prdContent: prdContent
});
// Result: Complete project created with tasks, subtasks, priorities, estimates
```

**Benefits:**
- Instant task breakdown from requirements (90% time saved)
- Consistent task structure
- Dependencies auto-detected from context

**PRD Format Tips:**
- Use clear headings for sections
- Mark priorities (HIGH/MEDIUM/LOW)
- Include time estimates
- List dependencies explicitly

---

### Task Progress Inference

Analyze codebase to detect task completion from code evidence:

```javascript
const progress = await inferTaskProgress({
  workingDirectory: process.env.GITHUB_WORKSPACE/.agentic-tools-mcp,
  projectId: "[project-id]",
  autoUpdateTasks: false,
  confidenceThreshold: 0.7
});
// Returns suggested status, confidence, evidence, recommendations
```

**Benefits:**
- Automatic progress tracking
- Accurate completion detection
- Prevents forgotten status updates
- Evidence-based reporting

---

### Research-Enhanced Memory System

Perform comprehensive web research with automatic memory storage:

```javascript
// 1. Generate intelligent research queries
const queries = await generateResearchQueries({
  workingDirectory: process.env.GITHUB_WORKSPACE/.agentic-tools-mcp,
  taskId: "[task-id]",
  queryTypes: ["implementation", "best_practices", "examples"]
});

// 2. Use Perplexity MCP for research
const results = await perplexity_reason({
  messages: [
    { role: "system", content: "You are a research assistant." },
    { role: "user", content: queries[0] }
  ]
});

// 3. Store findings as memories
await createMemory({
  workingDirectory: process.env.GITHUB_WORKSPACE/.agentic-tools-mcp,
  title: "Research: Topic",
  content: results.content,
  category: "research",
  metadata: {
    relatedTask: "[task-id]"
  }
});
```

**Benefits:**
- Copilot performs autonomous research
- Research findings persistent
- Context-aware implementation
- Reusable knowledge

---

## MCP Server Utilization (10 Servers Configured)

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
- **CRITICAL LIMITATION:** Perplexity CANNOT directly read repository files. You MUST paste file contents into your Perplexity prompt if you need it to analyze code/documents.

### High Priority MCPs (Use Frequently)

**GitHub MCP** - Create/update issues & PRs, add comments, trigger workflows  
**CodeScene MCP** ⭐ - Code health analysis alongside ESLint, detect technical debt hotspots  
**Codecov MCP** ⭐ - Test coverage verification at end of tasks  
**GitHub Actions MCP** - CI/CD workflow management

**Note:** Playwright testing infrastructure is currently broken. Use Jest unit tests for validation.

---

## ⚠️ Playwright Testing - Currently Broken

The Playwright MCP testing infrastructure is currently non-functional and should NOT be used.

**Use Instead: Jest Unit Tests**

**Run Tests:**
```bash
npm test                    # All unit tests
npm run test:unit           # Unit tests only
npm run test:integration    # Integration tests only
npm run test:coverage       # With coverage report
```

**Testing Infrastructure:**
- **Unit Tests**: `tests/unit/` - Component-level tests with mocks
- **Integration Tests**: `tests/integration/` - Cross-component integration tests  
- **Test Helpers**: `tests/helpers/` - Cross-tab simulator and utilities
  - `cross-tab-simulator.js` - Simulates multiple browser tabs
  - `quick-tabs-test-utils.js` - Common test utilities
- **Test Fixtures**: `tests/fixtures/` - Reusable test data

**What Unit Tests Cover:**
✅ Cross-tab synchronization via BroadcastChannel  
✅ State persistence via browser.storage  
✅ Container isolation enforcement  
✅ Solo/Mute visibility logic  
✅ Position/size update propagation  
✅ Error handling and edge cases

**What Requires Manual Testing:**
❌ Keyboard shortcuts ("Q" key, "Ctrl+Alt+Z")  
❌ Extension toolbar icon clicks  
❌ Actual browser tab interactions  
❌ Real Firefox container switching

---

## Standard MCP Workflows

### Bug Fix Workflow
```
1. Search memories 🧠 | 2. Run unit tests BEFORE (npm test) ✅
3. Context7: Get docs ⭐ | 4. Perplexity: Research + verify solution ⭐
5. Write fix | 6. Context7: Double-check ⭐ | 7. Perplexity: Check alternatives ⭐
8. ESLint + CodeScene ⭐ | 9. Run unit tests AFTER ✅
10. Run all tests + Codecov ⭐ | 11. Create memory 🧠 | 12. Commit 🧠
```

### Feature Workflow
```
1. Search memories 🧠 | 2. Create tasks 📋 | 3. Run unit tests baseline ✅
4. Perplexity: Research ⭐ | 5. Context7: Get docs ⭐ | 6. Update task 📋
7. Write code | 8. Context7: Verify ⭐ | 9. Perplexity: Alternatives ⭐
10. ESLint + CodeScene ⭐ | 11. Run unit tests for feature ✅
12. Run all tests + Codecov ⭐ | 13. Mark done 📋 | 14. Memory 🧠 | 15. Commit 🧠📋
```

---

## Browser Extension Specific Rules

### Message Passing Security

**ALWAYS validate sender:**
```javascript
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
async function saveState(state) {
  try {
    const stateSize = new Blob([JSON.stringify(state)]).size;
    if (stateSize > 100 * 1024) {
      throw new Error(`State too large: ${stateSize} bytes`);
    }
    await browser.storage.sync.set({ state });
  } catch (error) {
    console.error('Storage error:', error);
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

**Update README.md when:**
- Version numbers change
- Features or functionality change
- User interface or UX changes
- Settings or configuration change

**README must stay under 10KB**

**Update Agent Files when:**
- Architecture changes (patterns, structure)
- Build/test/deploy processes change
- Repository structure changes

### Version Synchronization

When version changes from X.Y.Z to X.Y.Z+1:
- Update `manifest.json` version
- Update `package.json` version
- Update README header & footer
- Update `.github/copilot-instructions.md` (Project Overview)

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

---

## Before Every Commit Checklist

### Pre-Implementation
- [ ] **Searched memories before starting work** 🧠🔍
- [ ] **Referenced relevant memories in implementation** 🧠
- [ ] **Run unit tests to establish baseline BEFORE changes** ✅

### During Implementation
- [ ] **Context7 MCP: Verified API usage with current docs** ⭐
- [ ] **Perplexity MCP: Double-checked solution approach (paste code if analyzing files)** ⭐
- [ ] **Perplexity MCP: Verified no better alternative exists** ⭐

### Code Quality
- [ ] **ESLint MCP: Linted all modified JS files** ⭐
- [ ] **CodeScene MCP: Checked code health and technical debt** ⭐
- [ ] Zero ESLint errors remaining ⭐

### Testing
- [ ] **Run all unit tests: `npm test`** ✅
- [ ] **Run tests with coverage: `npm run test:coverage`** ✅
- [ ] **Codecov MCP: Verified test coverage is adequate** ⭐
- [ ] **All tests passing (no failures)** ✅

### Task & Memory Management
- [ ] **Tasks created for multi-step features** 📋
- [ ] **Task status updated to reflect progress** 📋
- [ ] **Completed tasks marked as "done"** 📋
- [ ] **Task data committed** (`.agentic-tools-mcp/tasks/`) 📋
- [ ] **Memory files committed** (`.agentic-tools-mcp/`) 🧠
- [ ] Verified `.agentic-tools-mcp/memories/` contains individual JSON files 🧠

### Documentation & Size Limits
- [ ] **Copilot instruction files under 25KB** 📏
- [ ] **Documentation files under 20KB** 📏
- [ ] **No documentation in docs/manual/** 📏

---

## Before Every PR Checklist

- [ ] **All commits linted with ESLint MCP** ⭐
- [ ] **CodeScene MCP verified code health** ⭐
- [ ] **All unit tests pass (`npm test`)** ✅
- [ ] **Unit tests cover new features** ✅
- [ ] **Test coverage adequate (`npm run test:coverage`)** ⭐
- [ ] **Codecov MCP verified adequate test coverage** ⭐
- [ ] Documentation updated (README, agent files if applicable)
- [ ] **Documentation files under 20KB** 📏
- [ ] **No documentation written to docs/manual/** 📏
- [ ] **Memory files included in PR** 🧠
- [ ] GitHub MCP used to create PR

---

## Documentation Organization

**ALLOWED locations for Copilot-written documentation:**
- Implementation summaries → `docs/implementation-summaries/` (max 20KB each)
- Changelog updates → **APPEND to `docs/CHANGELOG.md`**
- In-code comments and JSDoc documentation

**PROHIBITED:**
- ❌ DO NOT write to `docs/manual/` (reserved for user-facing docs)
- ❌ DO NOT create new markdown files in root directory (except README.md)
- ❌ DO NOT create documentation larger than 20KB

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
