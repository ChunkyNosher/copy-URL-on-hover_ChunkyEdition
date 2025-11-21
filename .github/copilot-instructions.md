# GitHub Copilot Instructions for copy-URL-on-hover_ChunkyEdition

## Project Overview

**Type:** Firefox Manifest V2 browser extension  
**Version:** 1.6.0.10  
**Language:** JavaScript (ES6+)  
**Architecture:** Domain-Driven Design with Clean Architecture  
**Purpose:** URL management with Solo/Mute visibility control, complete Firefox Container isolation, and persistent floating panel manager with granular console log filtering

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
   - `git add .agentic-tools-mcp/`

2. **Commit memory files with your code changes:**
   - Include memory files in your final commit
   - Use commit message: "chore: persist agent memory from task"

3. **Push to the PR branch:**
   - Ensure memory files are included in the push

### Memory File Locations

- `.agentic-tools-mcp/` - Agent memories and task management (Agentic-Tools MCP)
  - `memories/` - Individual memory JSON files organized by category
  - `tasks/` - Task and project data files

**Why This Matters:** Your memory files are stored in an ephemeral environment that gets destroyed when your session ends. If you don't commit them to the PR, they will be lost forever.

### Verification Before Finishing

Check that `.agentic-tools/` appears in your commit. If missing, ADD IT NOW.

### Memory Search (ALWAYS DO THIS FIRST) 🔍

**CRITICAL WORKFLOW RULE:**
Before starting ANY task, search memories for relevant context.

**When to Search:**
- Before implementing new features
- Before refactoring existing code
- Before researching topics (check if already researched)
- Before making architectural decisions

**Search Workflow:**

1. **Start every task with memory search:**
```javascript
const relevantMemories = await searchMemories({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  query: "[keywords about task/feature/component]",
  limit: 5,
  threshold: 0.3
});
```

2. **Review results for context:**
- Check if similar work was done before
- Review past architectural decisions
- Look for related research findings
- Find relevant patterns or best practices

3. **Reference memories in implementation:**
```javascript
// Example: Found memory about container isolation pattern
// Apply that pattern to current work
// Credit memory in comments:
// Implementation based on pattern from memory "Container Isolation Architecture"
```

**Search Query Tips:**
- Use specific component names ("state-manager", "container")
- Include action words ("isolation", "tracking", "persistence")
- Try multiple queries with different keywords
- Use category filter when relevant (category: "architecture")

**Memory Search Response Format:**
```javascript
{
  id: string,          // Memory ID for get_memory if need details
  title: string,       // Short descriptive title
  content: string,     // Full memory content
  score: number,       // Relevance score (0-1)
  category: string,    // Optional category
  metadata: object     // Additional context
}
```

---

### Memory Storage Tool Usage

**For Agent Memories (Learnings, Context, Decisions):**

✅ Use `create_memory` tool from agentic-tools MCP

**Required Parameters:**
- `workingDirectory`: Absolute path to project (e.g., `/home/runner/work/copy-URL-on-hover_ChunkyEdition/copy-URL-on-hover_ChunkyEdition`)
- `title`: Short descriptive title (max 50 characters, used for filename)
- `content`: Detailed memory content (no limit)

**Optional Parameters:**
- `category`: Categorization string (e.g., "preferences", "technical", "context")
- `metadata`: Flexible metadata object for additional context

**This is NON-NEGOTIABLE for memory persistence across tasks.**

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
| `verification-notes` | Testing results, verifications | "Feature Already Working" |

**Category Selection Guidelines:**
- Architecture > Technical (if both apply)
- Specific > General (prefer more specific category)
- Use metadata for additional tags

**Example with proper categorization:**
```javascript
await createMemory({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  title: "Container Isolation Architecture Pattern",
  content: "...",
  category: "architecture",  // Primary category
  metadata: {
    components: ["state-manager", "background"],
    relatedIssues: ["#123"],
    importance: "critical"
  }
});
```

---

### Memory Metadata Schema

**Recommended metadata structure for rich context:**

```javascript
await createMemory({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  title: "Container Isolation Architecture Pattern",
  content: "...",
  category: "architecture",
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
});
```

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

#### Agentic-Tools MCP 🧠
- **Purpose:** Agent memories and advanced task management
- **Storage:** `.agentic-tools-mcp/` (directory with individual JSON files)
- **Memory Tools:** `create_memory`, `search_memories`, `get_memory`, `list_memories`, `update_memory`, `delete_memory`
- **Task Tools:** `create_task`, `get_task`, `update_task`, `list_tasks`, `create_project`, `get_project_info`
- **Advanced Tools:** `parse_prd`, `get_next_task_recommendation`, `analyze_task_complexity`, `research_task`
- **CRITICAL:** Commit `.agentic-tools-mcp/` directory to persist all learnings and tasks

**Memory Storage Architecture:**
- Individual JSON files per memory (not single memories.json)
- Organized by category in subdirectories
- File names based on memory titles
- Example: `memories/preferences/User_prefers_concise_responses.json`

---

## Advanced Task Management System 📋

### When to Use Task Management

**Task management is for:**
- Multi-step features requiring planning
- Complex refactors spanning multiple files
- Projects with dependencies between tasks
- Work that spans multiple PR sessions

**Creating a Project Plan:**

1. **Start with project creation:**
```javascript
await createProject({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  name: "Feature Name",
  description: "High-level overview of feature goals"
});
```

2. **Break down into tasks:**
```javascript
await createTask({
  workingDirectory: process.env.GITHUB_WORKSPACE,
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

3. **Create subtasks for task breakdown (unlimited nesting):**
```javascript
await createTask({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  projectId: "[project-id]",
  parentId: "[parent-task-id]",  // Creates subtask
  name: "Subtask name",
  details: "Subtask details",
  priority: 7,
  complexity: 4,
  estimatedHours: 3
  // ... same metadata as parent tasks
});

// Create sub-subtasks (infinite depth!)
await createTask({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  projectId: "[project-id]",
  parentId: "[subtask-id]",  // Creates sub-subtask
  name: "Sub-subtask name",
  // ... supports unlimited nesting!
});
```

4. **Track progress:**
```javascript
// Update task status as you work
await updateTask({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  id: "[task-id]",
  status: "in-progress",
  actualHours: 3  // Track time spent
});

// Mark complete
await updateTask({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  id: "[task-id]",
  status: "done",
  completed: true,
  actualHours: 8
});
```

**Task Dependencies:**
```javascript
await createTask({
  workingDirectory: process.env.GITHUB_WORKSPACE,
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

## AI Agent Advanced Tools 🤖

### Intelligent Task Recommendations

Get AI-powered task prioritization based on dependencies, priority, and complexity:

```javascript
// At start of work session
const recommendation = await getNextTaskRecommendation({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  projectId: "[project-id]"
});

// Returns optimal next task to work on:
// - Respects dependencies (no blocked tasks)
// - Weighs priority vs complexity
// - Provides reasoning for recommendation
```

**Why use this:**
✅ Autonomous task selection (no human guidance needed)  
✅ Never works on blocked tasks  
✅ Balances high-value, achievable work  
✅ Reduces decision paralysis

---

### Automatic Task Complexity Analysis

Identify overly complex tasks and get automatic breakdown suggestions:

```javascript
// Check if current task is too complex
const analysis = await analyzeTaskComplexity({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  taskId: "[task-id]",
  complexityThreshold: 7  // Tasks above this trigger breakdown suggestions
});

// If complexity > threshold, returns suggested subtasks
// Can automatically create subtasks with autoCreateSubtasks: true
```

**Why use this:**
✅ Prevents overwhelming tasks  
✅ Improves task completion rate  
✅ Better progress tracking  
✅ Reduces cognitive load

---

### PRD Parsing Automation

Parse Product Requirements Documents into structured task breakdowns automatically:

```javascript
// User provides PRD in issue or doc
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

// Copilot parses PRD and creates complete task structure
await parsePRD({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  projectId: "[project-id]",
  prdContent: prdContent
});

// Result: Complete project created with tasks, subtasks, priorities, estimates
```

**Why use this:**
✅ Instant task breakdown from requirements  
✅ Consistent task structure  
✅ Time saved on project planning (90% reduction)  
✅ Dependencies auto-detected from context

**PRD Format Tips:**
- Use clear headings for sections
- Mark priorities (HIGH/MEDIUM/LOW)
- Include time estimates
- List dependencies explicitly

---

### Task Progress Inference

Analyze codebase to detect task completion from code evidence:

```javascript
// Copilot analyzes codebase after making changes
const progress = await inferTaskProgress({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  projectId: "[project-id]",
  autoUpdateTasks: false,  // Set true to auto-update status
  confidenceThreshold: 0.7  // Min confidence for auto-update
});

// Returns:
// - suggestedStatus for each task
// - confidence scores
// - evidence (files created, tests added, docs updated)
// - recommendations

// Can automatically update task status if confidence > threshold
```

**Why use this:**
✅ Automatic progress tracking  
✅ Accurate completion detection  
✅ Prevents forgotten status updates  
✅ Evidence-based reporting

---

### Research-Enhanced Memory System

Perform comprehensive web research with automatic memory storage:

```javascript
// 1. Generate intelligent research queries
const queries = await generateResearchQueries({
  workingDirectory: process.env.GITHUB_WORKSPACE,
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
  workingDirectory: process.env.GITHUB_WORKSPACE,
  title: "Research: [Topic]",
  content: results.content,
  category: "research",
  metadata: {
    sources: results.citations || [],
    researchDate: new Date().toISOString(),
    relatedTask: "[task-id]"
  }
});
```

**Why use this:**
✅ Copilot performs autonomous research  
✅ Research findings persistent  
✅ Context-aware implementation  
✅ Reusable knowledge (search once, reference forever)

---

## Complete Workflow Examples 📚

### Example 1: Complex Feature with Full Task Management

**Scenario:** Implementing "Enhanced Console Log Filtering" feature

**Step 1: Search existing memories**
```javascript
const memories = await searchMemories({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  query: "console log filtering implementation",
  limit: 5
});
// Check if similar feature was implemented before
```

**Step 2: Create project and tasks from PRD**
```javascript
// Parse PRD to create structured project
await parsePRD({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  prdContent: `
## Feature: Enhanced Console Log Filtering

### Requirements
1. Add log level filtering (HIGH PRIORITY)
   - Filter by: error, warn, info, debug
   - Estimated: 8 hours

2. Add export functionality (MEDIUM PRIORITY)
   - CSV and JSON export
   - Estimated: 6 hours
  `
});

// OR manually create project and tasks
const project = await createProject({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  name: "Enhanced Console Log Filtering",
  description: "Add granular log filtering with export capabilities"
});

const task1 = await createTask({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  projectId: project.id,
  name: "Implement log level filtering",
  details: "Add UI for filtering by error/warn/info/debug",
  priority: 9,
  complexity: 6,
  status: "pending",
  tags: ["ui", "filtering"],
  estimatedHours: 8
});
```

**Step 3: Get next task recommendation**
```javascript
const recommendation = await getNextTaskRecommendation({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  projectId: project.id
});
// Work on recommended task
```

**Step 4: Research if needed**
```javascript
const queries = await generateResearchQueries({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  taskId: task1.id,
  queryTypes: ["implementation", "best_practices"]
});

// Use Perplexity MCP for research
const research = await perplexity_reason({
  messages: [
    { role: "system", content: "Research console filtering patterns." },
    { role: "user", content: queries[0] }
  ]
});

// Store findings as memory
await createMemory({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  title: "Console Filtering Patterns Research",
  content: research.content,
  category: "research",
  metadata: {
    relatedTask: task1.id
  }
});
```

**Step 5: Implement and track progress**
```javascript
// Update task status
await updateTask({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  id: task1.id,
  status: "in-progress",
  actualHours: 2
});

// [Implement feature code]
// Use Context7 for API docs, ESLint for linting

// Mark complete
await updateTask({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  id: task1.id,
  status: "done",
  completed: true,
  actualHours: 7
});
```

**Step 6: Create architectural memory**
```javascript
await createMemory({
  workingDirectory: process.env.GITHUB_WORKSPACE,
  title: "Console Log Filtering Architecture",
  content: "Filter implementation uses event delegation with data attributes for efficient DOM updates. Filter state stored per-tab using browser.storage.local with cookieStoreId keys.",
  category: "architecture",
  metadata: {
    components: ["console-filter.js"],
    importance: "high",
    implementedDate: new Date().toISOString()
  }
});
```

**Step 7: Commit everything**
```bash
git add .agentic-tools-mcp/
git add src/
git commit -m "feat: implement enhanced console log filtering

- Added granular log level filtering UI
- Implemented per-tab filter persistence
- Created architectural documentation

Tasks completed: #task-123
Memories created: Console Log Filtering Architecture"
```

---

## Standard MCP Workflows

### Bug Fix Workflow (Simple)
```
1. Search memories for similar bugs 🧠🔍
2. Context7 MCP: Get API docs ⭐
3. Write fix
4. ESLint MCP: Lint and fix ⭐ MANDATORY
5. Playwright MCP: Test fix
6. GitHub MCP: Update issue
7. Create memory with fix details 🧠
8. Commit memory files 🧠
```

### New Feature Workflow (With Task Management)
```
1. Search memories for related features 🧠🔍
2. Create project and tasks 📋
3. Get task recommendation 📋
4. Perplexity MCP: Research best practices ⭐
5. Context7 MCP: Get API docs ⭐
6. Update task to in-progress 📋
7. Write feature code
8. ESLint MCP: Lint and fix ⭐ MANDATORY
9. Playwright MCP: Create tests
10. Mark task as done 📋
11. Create architectural memory 🧠
12. GitHub MCP: Create PR
13. Commit memory and task files 🧠📋
```

### Memory Persistence Workflow (EVERY Task)
```
1. Complete work
2. git add .agentic-tools-mcp/ 
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

## Playwright MCP Autonomous Testing 🎭

### Overview

The extension includes a **Test Bridge Pattern** for autonomous testing with Playwright MCP, enabling ~80% test coverage without manual intervention.

**Key Documents:**
- **Testing Guide**: `.github/COPILOT-TESTING-GUIDE.md` - Complete testing documentation
- **Implementation Spec**: `docs/manual/v1.6.0/copilot-testing-implementation.md`

### What You CAN Test Autonomously

✅ **Quick Tab Operations** (bypassing keyboard shortcuts):
- Create Quick Tabs via Test Bridge (no "Q" key needed)
- Minimize/restore programmatically
- Pin/unpin behavior
- Close and cleanup

✅ **State Management**:
- Storage verification (browser.storage.local)
- Cross-tab synchronization (BroadcastChannel)
- Container isolation (cookieStoreId)

✅ **UI Interactions**:
- Click, hover, drag, resize
- Form inputs, screenshots
- Multi-tab testing

### What You CANNOT Test

❌ **Keyboard Shortcuts**: `manifest.json` commands ("Q" key, "Ctrl+Alt+Z") - browser API limitation  
❌ **Extension Icon**: Toolbar icon clicks  
❌ **OS-Level Events**: System notifications, some clipboard ops

**These require manual testing.**

### Quick Start

**1. Use ExtensionTestHelper:**
```javascript
import { ExtensionTestHelper } from './tests/extension/helpers/extension-test-utils.js';

test('create Quick Tab', async ({ page }) => {
  const helper = new ExtensionTestHelper(page);
  await page.goto('https://example.com');
  
  // Wait for test bridge
  const ready = await helper.waitForTestBridge();
  expect(ready).toBe(true);
  
  // Create Quick Tab (bypasses "Q" key!)
  await helper.createQuickTab('https://github.com');
  
  // Verify
  const tabs = await helper.getQuickTabs();
  expect(tabs).toHaveLength(1);
});
```

**2. Run Tests:**
```bash
# All extension tests
npm run test:extension

# With UI (see what's happening)
npm run test:extension:ui

# Debug mode
npm run test:extension:debug
```

**3. Test Bridge API:**

All methods available via `helper.*`:
- `createQuickTab(url, options)` - Create Quick Tab
- `getQuickTabs()` - Get all Quick Tabs
- `minimizeQuickTab(id)` - Minimize
- `restoreQuickTab(id)` - Restore
- `pinQuickTab(id)` - Pin to tab
- `unpinQuickTab(id)` - Unpin
- `closeQuickTab(id)` - Close
- `clearAllQuickTabs()` - Cleanup
- `waitForQuickTabCount(n)` - Wait for sync
- `takeScreenshot(name)` - Capture screenshot

### Testing Workflow

**When to Test:**
- Before committing UI changes
- After implementing Quick Tab features
- When fixing bugs related to state management
- Before creating PRs

**Test Pattern:**
```javascript
test.beforeEach(async ({ page }) => {
  helper = new ExtensionTestHelper(page);
  await page.goto('https://example.com');
  await helper.waitForTestBridge();
  await helper.clearAllQuickTabs(); // Start clean
});

test.afterEach(async () => {
  await helper.clearAllQuickTabs(); // Cleanup
});
```

**Best Practices:**
1. **Always wait for test bridge** before using it
2. **Clean up before and after** each test
3. **Use polling** for async operations (`waitForQuickTabCount`)
4. **Take screenshots** on failures for debugging
5. **Test in both Firefox and Chrome** when possible

### Troubleshooting

**Test Bridge Not Available:**
- Check TEST_MODE=true in environment
- Verify extension loaded in browser
- Check browser console for errors

**Tests Timing Out:**
- Increase timeout: `test.setTimeout(60000)`
- Use `waitForQuickTabCount()` instead of immediate checks
- Add delays between tab operations

**See `.github/COPILOT-TESTING-GUIDE.md` for complete documentation.**

---

## Before Every Commit Checklist

- [ ] **Searched memories before starting work** 🧠🔍
- [ ] ESLint MCP used on all modified JS files ⭐
- [ ] Zero ESLint errors remaining ⭐
- [ ] Context7 used for API implementations ⭐
- [ ] Run all testing suites and make sure that the extension packages correctly ⭐
- [ ] **Playwright MCP tests run for extension changes** 🎭 (`npm run test:extension`)
- [ ] **Test Bridge verified for Quick Tab features** 🎭
- [ ] **Tasks created for multi-step features** 📋
- [ ] **Task status updated to reflect current progress** 📋
- [ ] **Completed tasks marked as "done"** 📋
- [ ] **Task data committed** (`.agentic-tools-mcp/tasks/`) 📋
- [ ] **Memory files committed** (.agentic-tools-mcp/) 🧠
- [ ] Verified `.agentic-tools-mcp/memories/` contains individual JSON files 🧠
- [ ] Memory files follow naming convention: `Category/Title.json` 🧠
- [ ] **Referenced relevant memories in implementation** 🧠


## Before Every PR Checklist

- [ ] All commits linted with ESLint ⭐
- [ ] **Playwright MCP test suite passes** 🎭 (`npm run test:extension`)
- [ ] **Extension tests cover new Quick Tab features** 🎭
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
