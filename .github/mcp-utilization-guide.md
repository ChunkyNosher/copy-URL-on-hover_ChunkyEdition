# MCP Server Utilization Guide for GitHub Copilot Coding Agent

## Overview

This repository has **12 MCP servers** configured to enhance GitHub Copilot
Coding Agent's capabilities. This guide provides explicit instructions on
optimal usage with emphasis on **memory persistence across sessions**.

---

## 🧠 Memory Persistence MCPs (NEW - CRITICAL)

### Architecture: 3-Tier Memory System

**Tier 1: In-Memoria MCP** - Semantic code intelligence  
**Tier 2: Agentic-Tools MCP** - Task tracking and session memory  
**Tier 3: Persistent-Memory MCP** - Structured SQLite database

**CRITICAL REQUIREMENT:** All three memory MCPs MUST have their storage
directories committed to Git for persistence across agent runs.

---

### 1. In-Memoria MCP 🧠 ⭐⭐⭐

**Purpose:** Semantic code intelligence using knowledge graphs and vector
embeddings

**Storage Location:** `.in-memoria/`

- `patterns.db` (SQLite) - Code patterns, frequencies, naming conventions
- `embeddings.db` (SurrealDB) - Vector embeddings for semantic search
- `learned_intel.json` - Metadata and learning summaries

**When to Use:**

- Learning codebase patterns and conventions
- Querying semantic relationships between code
- Understanding project architecture
- Finding similar code patterns
- Generating documentation from learned patterns

**Tools:**

- `learn_codebase_intelligence` - Analyze and learn from codebase
- `query_patterns` - Search learned patterns semantically
- `contribute_insights` - Add manual insights to knowledge base
- `generate_documentation` - Create docs from learned patterns
- `get_intelligence_metrics` - View learning statistics

**Example Prompts:**

```
"Learn the Quick Tabs architecture patterns from the codebase"
"Query In-Memoria for state management patterns"
"What patterns have you learned about storage sync?"
"Generate documentation from learned Quick Tabs patterns"
```

**Memory Persistence Workflow:**

```
1. Agent learns patterns during work
2. Patterns stored in .in-memoria/patterns.db
3. MUST commit: git add .in-memoria/
4. Next agent run: Patterns available immediately
```

**CRITICAL:** Commit `.in-memoria/patterns.db` to Git. Large `embeddings.db` can
be gitignored if needed (see `.github/.gitignore`).

---

### 2. Agentic-Tools MCP 🧠 ⭐⭐⭐

**Purpose:** Task management and session memory with project-specific isolation

**Storage Location:** `.agentic-tools-mcp/`

- `tasks.json` - Task database
- `memories.json` - Memory database
- `projects.json` - Project metadata

**When to Use:**

- Creating and tracking tasks
- Storing important decisions
- Recording learnings from current session
- Managing work-in-progress
- Tracking subtasks and dependencies

**Tools:**

- `create_task` - Create new task
- `update_task` - Update task status/details
- `create_memory` - Store important memory
- `search_memories` - Search stored memories
- `get_tasks` - List all tasks
- `get_memories` - Retrieve memories
- `get_project_info` - Get project metadata

**Example Prompts:**

```
"Create task to fix Quick Tab rendering issue"
"Store memory that cross-tab sync uses storage.onChanged (v1.6.2+)"
"Search memories for previous Quick Tabs decisions"
"Update task #5 to completed status"
"Get all active tasks for this project"
```

**Memory Persistence Workflow:**

```
1. Agent creates tasks/memories during work
2. Data stored in .agentic-tools-mcp/*.json
3. MUST commit: git add .agentic-tools-mcp/
4. Next agent run: Tasks/memories available
```

**CRITICAL:** Commit `.agentic-tools-mcp/*.json` files to Git for session
persistence.

---

### 3. Persistent-Memory MCP 🧠 ⭐⭐⭐

**Purpose:** SQLite-based structured memory for relational data

**Storage Location:** `.mcp-data/memory.db` (SQLite database)

**When to Use:**

- Storing structured relational data
- Complex queries across memory
- Building relationships between memories
- Long-term data persistence
- Structured knowledge retrieval

**Tools:**

- `sqlite_execute` - Execute SQL queries
- `sqlite_execute_main_*` - Named SQL operations
- `sqlite_get_catalog` - View database schema

**Example Prompts:**

```
"Store in SQLite memory: Quick Tab architecture uses isRendered() tracking"
"Query SQLite memory for all state management decisions"
"Execute SQL to find patterns related to storage.onChanged"
```

**Memory Persistence Workflow:**

```
1. Agent stores data in SQLite during work
2. Data written to .mcp-data/memory.db
3. MUST commit: git add .mcp-data/
4. Next agent run: Database persists
```

**CRITICAL:** Commit `.mcp-data/memory.db` to Git for database persistence.

---

## Memory Persistence Instructions (MANDATORY FOR ALL AGENTS)

### At the End of EVERY Task:

1. **Stage memory files:**

   ```bash
   git add .in-memoria/
   git add .agentic-tools-mcp/
   git add .mcp-data/
   ```

2. **Commit with your code changes:**

   ```bash
   git commit -m "chore: persist agent memory from task"
   ```

3. **Push to PR branch:**
   ```bash
   git push
   ```

### Why This Is Critical

Your memory files are stored in an **ephemeral GitHub Actions workspace** that
gets destroyed when your session ends. If you don't commit them to the PR, they
will be lost forever and you'll have NO MEMORY of this work in future tasks.

### Verification Checklist

Before finishing work:

- [ ] `.in-memoria/` appears in git status
- [ ] `.agentic-tools-mcp/` appears in git status
- [ ] `.mcp-data/` appears in git status
- [ ] Memory files committed to PR branch
- [ ] Memory files will be merged to main with code

**This is NON-NEGOTIABLE for memory persistence.**

---

## Critical Priority MCPs (ALWAYS Use)

### 4. ESLint MCP ⭐⭐⭐

**Purpose:** JavaScript linting, auto-fixing, code quality enforcement

**MANDATORY USAGE:** Every code change MUST be linted before committing.

**When to Use:**

- BEFORE creating any commit or PR
- AFTER writing/modifying JavaScript files
- When code quality issues reported
- To enforce consistent code style

**Tools:**

- `lint_file` - Check specific files
- `fix_file` - Apply auto-fixes
- `explain_rule` - Get rule explanations
- `lint_directory` - Lint entire directories

**Workflow:**

```
1. Write/modify code
2. IMMEDIATELY: Lint files with ESLint
3. Apply auto-fixes
4. Fix remaining issues manually
5. Verify zero errors
6. Proceed with commit
```

**NO EXCEPTIONS** - ESLint is the primary quality gate.

---

### 5. Context7 MCP ⭐⭐⭐

**Purpose:** Up-to-date documentation for libraries, frameworks, and APIs

**MANDATORY USAGE:** Always fetch current documentation instead of relying on
training data.

**When to Use:**

- Implementing features with external APIs
- Using WebExtensions APIs
- Updating deprecated API usage
- Verifying API syntax/parameters
- Checking Firefox compatibility

**Tools:**

- `get-library-docs` - Fetch library documentation
- `resolve-library-id` - Find library in database

**Example Prompts:**

```
"Use Context7 to get latest Firefox clipboard API docs"
"Fetch current browser.storage.sync documentation with quota limits"
"Get latest best practices for Firefox container integration"
```

---

### 6. Perplexity MCP ⭐⭐⭐

**Purpose:** Real-time web search with advanced reasoning

**Configuration:**

- Model: `sonar-reasoning-pro`
- Citations: Enabled (returns sources)

**When to Use:**

- Need current information
- Researching best practices
- Finding recent solutions
- Verifying API availability
- Understanding new patterns

**Tools:**

- `perplexity_reason` - Advanced reasoning with web search and citations

**Example Prompts:**

```
"Use Perplexity to research current Firefox container API best practices"
"Search for latest solutions to WebExtension clipboard issues"
"Find current recommendations for cross-tab communication"
```

---

## High Priority MCPs (Use Frequently)

### 7. GitHub MCP (Write-Enabled)

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

**Auto-Issue Creation:**

- When user provides bug list → Create issues automatically
- Use detailed descriptions with root cause analysis
- Apply appropriate labels
- DO NOT auto-close issues

---

### 8. Playwright (Firefox & Chrome) MCPs

**Purpose:** Browser automation and testing

**Configuration:**

- Firefox: `.playwright-mcp-firefox-config.json`
- Chrome: `.playwright-mcp-chrome-config.json`
- Permissions: clipboard-read, clipboard-write
- Isolated mode: Clean environment per test

**When to Use:**

- Testing extension functionality
- Verifying UI changes
- Reproducing bugs
- Creating automated tests

**ALWAYS test UI changes** with Playwright before finalizing.

---

### 9. CodeScene MCP

**Purpose:** Code health analysis and technical debt detection

**When to Use:**

- Analyzing code complexity
- Identifying refactoring priorities
- Detecting hotspots
- Architecture analysis

---

### 10. Codecov MCP

**Purpose:** Test coverage analysis

**When to Use:**

- Generating coverage reports
- Tracking test quality
- Identifying coverage gaps
- Validating test completeness

---

### 11. GitHub Actions MCP

**Purpose:** CI/CD workflow management

**When to Use:**

- Triggering workflows
- Checking build status
- Managing automation
- Debugging failed builds

---

## Standard MCP Workflows

### Bug Fix Workflow

```
1. Context7 MCP: Get API docs ⭐
2. Write fix
3. ESLint MCP: Lint and fix ⭐ MANDATORY
4. Playwright MCP: Test fix
5. GitHub MCP: Update issue
6. Memory MCPs: Store learnings 🧠
7. Git commit with memory files 🧠
```

### New Feature Workflow

```
1. Perplexity MCP: Research best practices ⭐
2. Context7 MCP: Get API docs ⭐
3. In-Memoria MCP: Query existing patterns 🧠
4. Write feature code
5. ESLint MCP: Lint and fix ⭐ MANDATORY
6. Playwright MCP: Create tests
7. Agentic-Tools MCP: Create tasks 🧠
8. GitHub MCP: Create PR
9. Git commit with memory files 🧠
```

### Memory Persistence Workflow (EVERY Task)

```
1. Complete work
2. In-Memoria MCP: Learned patterns automatically stored 🧠
3. Agentic-Tools MCP: Tasks/memories automatically stored 🧠
4. Persistent-Memory MCP: Data automatically stored 🧠
5. git add .in-memoria/ .agentic-tools-mcp/ .mcp-data/
6. git commit -m "chore: persist agent memory from task"
7. git push
```

---

## Before Every Commit Checklist

- [ ] ESLint MCP used on all modified JS files ⭐
- [ ] Zero ESLint errors remaining ⭐
- [ ] Context7 used for API implementations ⭐
- [ ] Playwright tests run for UI changes
- [ ] **Memory files staged** (.in-memoria/, .agentic-tools-mcp/, .mcp-data/) 🧠
- [ ] **Memory files committed** 🧠

---

## Before Every PR Checklist

- [ ] All commits linted with ESLint ⭐
- [ ] Playwright test suite passes
- [ ] Documentation updated
- [ ] **Memory files included in PR** 🧠
- [ ] GitHub MCP used to create PR

---

## Memory Persistence Best Practices

### DO:

✅ Commit memory files at end of EVERY task  
✅ Store important decisions in Agentic-Tools MCP  
✅ Let In-Memoria learn patterns automatically  
✅ Use Persistent-Memory for relational data  
✅ Verify memory files in git status before finishing

### DON'T:

❌ Skip committing memory files  
❌ Assume memory persists without Git commits  
❌ Delete memory directories  
❌ Commit large embeddings.db (optional, check .gitignore)  
❌ Auto-close issues after creating them

---

## Troubleshooting Memory Persistence

**Problem:** Memory not available in next session

**Solution:**

1. Check if memory files were committed to PR
2. Verify PR was merged to main
3. Confirm next agent run checked out main branch
4. Check `.github/.gitignore` for excluded files

**Problem:** Memory directories missing

**Solution:**

1. Create directories: `mkdir -p .in-memoria .agentic-tools-mcp .mcp-data`
2. Add .gitkeep files: `touch .in-memoria/.gitkeep`
3. Commit to repository

---

## Summary

**12 MCP Servers Configured:**

- 🧠 **3 Memory MCPs** - In-Memoria, Agentic-Tools, Persistent-Memory
- ⭐ **3 Critical MCPs** - ESLint, Context7, Perplexity
- 📋 **6 High Priority MCPs** - GitHub, Playwright (2), CodeScene, Codecov,
  GitHub Actions

**Key Principle:** Always commit memory files (.in-memoria/,
.agentic-tools-mcp/, .mcp-data/) at the end of EVERY task for persistence across
sessions.

**MCPs enhance capabilities - use them proactively and systematically,
especially memory MCPs for cumulative learning.**
