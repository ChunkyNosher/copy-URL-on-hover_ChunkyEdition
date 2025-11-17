# GitHub Actions Workflow Files for Code Quality Tools - Updated with DeepSource

## Purpose

This document provides complete, copy-paste-ready GitHub Actions workflow files
for all code quality and review tools, **now optimized with DeepSource instead
of SonarCloud**. Each workflow is explained with comments showing how it works
and integrates with GitHub Copilot Agent.

**What Changed:**

- ✅ **Added:** DeepSource integration guide (no workflow needed - it's a GitHub
  App)
- ✅ **Enhanced:** `.deepsource.toml` configuration for your repository
- ❌ **Removed:** SonarCloud (redundant with DeepSource, higher false positives)
- ✅ **Kept:** ESLint, Prettier, CodeQL, Jest+Codecov, WebExt workflows

---

## Table of Contents

1. [Main Code Quality Workflow (Combined)](#main-workflow)
2. [CodeQL Security Analysis](#codeql-workflow)
3. [Test Coverage with Jest + Codecov](#test-coverage-workflow)
4. [Web Extension Validation](#webext-workflow)
5. [Auto-Format on PR (Optional)](#auto-format-workflow)
6. [DeepSource Setup (No Workflow Needed)](#deepsource-setup)
7. [How These Workflows Work Together](#how-workflows-work)

---

## 1. Main Code Quality Workflow (Combined) {#main-workflow}

**File:** `.github/workflows/code-quality.yml`

This workflow runs multiple checks in parallel for fast feedback.

```yaml
name: Code Quality Checks

# WHEN THIS RUNS:
# - On every push to main or develop branch
# - On every pull request to main or develop
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

# WHAT IT DOES:
# Runs 4 parallel jobs: lint, format check, build, and web-ext validation
# GitHub Copilot reads results from all jobs to inform its PR reviews
# DeepSource runs separately on its own infrastructure (no workflow needed)

jobs:
  # JOB 1: ESLint - Check JavaScript quality
  lint:
    name: ESLint Check
    runs-on: ubuntu-latest

    steps:
      # Step 1: Get the code
      - name: Checkout repository
        uses: actions/checkout@v4

      # Step 2: Set up Node.js environment
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm' # Cache npm packages for faster runs

      # Step 3: Install dependencies from package.json
      - name: Install dependencies
        run: npm ci # ci is faster and more reliable than install

      # Step 4: Run ESLint
      - name: Run ESLint
        run: npm run lint
        # If this fails, GitHub Copilot will see the errors and suggest fixes

      # Step 5: Generate ESLint report for annotations
      - name: Generate ESLint report
        if: always() # Run even if linting failed
        run: |
          npx eslint . --format json --output-file eslint-report.json || true

      # Step 6: Upload ESLint results for Copilot to read
      - name: Annotate code with ESLint results
        if: always()
        uses: ataylorme/eslint-annotate-action@v2
        with:
          repo-token: ${{ secrets.GITHUB_TOKEN }}
          report-json: 'eslint-report.json'
        # This creates inline annotations on your PR that Copilot can see

  # JOB 2: Prettier - Check code formatting
  format-check:
    name: Prettier Format Check
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      # Check if code is formatted correctly
      - name: Check Prettier formatting
        run: npm run format:check
        # If this fails, files need formatting
        # Copilot will suggest running "npm run format" to fix

      # Show which files need formatting if check fails
      - name: Show unformatted files
        if: failure()
        run: |
          echo "::error::The following files need formatting:"
          npx prettier --list-different .

  # JOB 3: Build - Ensure extension compiles
  build:
    name: Build Extension
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      # Build the extension
      - name: Build production bundle
        run: npm run build:prod
        # If this fails, there's a syntax or build error

      # Validate the built manifest.json
      - name: Validate manifest.json
        run: |
          node -e "
          const manifest = require('./dist/manifest.json');
          console.log('✓ Manifest version:', manifest.version);
          console.log('✓ Manifest V3:', manifest.manifest_version === 3);
          if (manifest.manifest_version !== 3) {
            console.error('ERROR: Not using Manifest V3');
            process.exit(1);
          }
          console.log('✓ Manifest validation passed');
          "

      # Check for required permissions
      - name: Validate permissions
        run: |
          node -e "
          const manifest = require('./dist/manifest.json');
          const required = ['storage', 'tabs', 'webRequest', 'webRequestBlocking'];
          const missing = required.filter(p => !manifest.permissions.includes(p));
          if (missing.length > 0) {
            console.error('ERROR: Missing required permissions:', missing);
            process.exit(1);
          }
          console.log('✓ All required permissions present');
          "

      # Save built files for other jobs or download
      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: extension-build
          path: dist/
          retention-days: 7 # Keep for 7 days

  # JOB 4: Web Extension Linter
  web-ext-lint:
    name: Firefox Extension Validator
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'

      # Install Mozilla's web-ext tool
      - name: Install web-ext
        run: npm install --global web-ext

      # Validate extension structure and manifest
      - name: Lint extension with web-ext
        run: |
          web-ext lint \
            --source-dir=. \
            --ignore-files="*.md" "node_modules/**" "dist/**" ".github/**" \
            --pretty \
            --output=text
        # This checks for Firefox-specific issues
        # Copilot uses these results to catch browser extension mistakes

# RESULT:
# All 4 jobs must pass for the PR to be mergeable
# GitHub Copilot reads all failures and suggests fixes in its review
# DeepSource analyzes separately and posts its own findings
```

**How Copilot + DeepSource Use This:**

- Copilot sees when ESLint fails and reads the specific errors
- DeepSource also runs ESLint (via `.deepsource.toml`) with additional checks
- If DeepSource finds issues ESLint missed, Copilot reads those too
- Result: Comprehensive coverage with minimal false positives

---

## 2. CodeQL Security Analysis {#codeql-workflow}

**File:** `.github/workflows/codeql-analysis.yml`

CodeQL finds security vulnerabilities that ESLint and DeepSource miss.

```yaml
name: 'CodeQL Security Analysis'

# WHEN THIS RUNS:
# - On every push to main branch
# - On every pull request
# - Weekly on Monday at 6am (to catch new vulnerability patterns)
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 6 * * 1' # Every Monday at 6am UTC

# WHAT IT DOES:
# Scans JavaScript code for security vulnerabilities, logic bugs, and unsafe patterns
# GitHub Copilot natively integrates with CodeQL results
# DeepSource also has security checks but CodeQL is more comprehensive

jobs:
  analyze:
    name: CodeQL Analysis
    runs-on: ubuntu-latest

    # REQUIRED: Security permissions to write results
    permissions:
      security-events: write
      contents: read
      pull-requests: read

    strategy:
      fail-fast: false
      matrix:
        language: ['javascript']

    steps:
      # Step 1: Get the code
      - name: Checkout repository
        uses: actions/checkout@v4

      # Step 2: Initialize CodeQL
      - name: Initialize CodeQL
        uses: github/codeql-action/init@v3
        with:
          languages: ${{ matrix.language }}
          # Use extended security queries for browser extensions
          queries: security-extended,security-and-quality

      # Step 3: Build code (autobuild for JavaScript)
      - name: Autobuild
        uses: github/codeql-action/autobuild@v3

      # Step 4: Run CodeQL analysis
      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@v3
        with:
          category: '/language:${{matrix.language}}'
        # This uploads results to GitHub Security tab
        # Copilot Code Review automatically reads these results
# RESULT:
# - Security alerts appear in GitHub Security tab
# - Copilot sees vulnerabilities and explains them in PR reviews
# - DeepSource may flag the same issues - Copilot deduplicates
# - Copilot suggests secure alternatives

# EXAMPLE COPILOT + DEEPSOURCE INTEGRATION:
# If CodeQL finds: "SQL Injection vulnerability on line 45"
# And DeepSource flags: "Unsanitized user input"
# Copilot review combines both:
#   "Both CodeQL and DeepSource detected a SQL injection risk.
#   Your code concatenates user input directly into SQL.
#   Use parameterized queries: db.query('SELECT * FROM users WHERE id = ?', [userId])
#   [Implement suggestion] ← Click to auto-fix"
```

**How Copilot Uses This:**

- Copilot **natively runs** CodeQL on your PR changes
- It sees HIGH/CRITICAL security findings immediately
- It explains vulnerabilities in plain English
- DeepSource provides additional context on surrounding code quality

---

## 3. Test Coverage with Jest + Codecov {#test-coverage-workflow}

**File:** `.github/workflows/test-coverage.yml`

Runs tests and tracks code coverage. DeepSource also analyzes coverage from this
data.

```yaml
name: Test Coverage

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    name: Run Tests with Coverage
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      # Run Jest tests with coverage enabled
      - name: Run tests with coverage
        run: npm run test:coverage
        # This generates coverage/lcov.info file
        # Both Codecov AND DeepSource will read this file

      # Upload coverage to Codecov
      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v4
        with:
          token: ${{ secrets.CODECOV_TOKEN }} # Not needed for public repos
          files: ./coverage/lcov.info
          flags: javascript
          name: codecov-umbrella
          fail_ci_if_error: true
        # Codecov comments on PR with coverage changes

      # Upload coverage report as artifact
      - name: Upload coverage report
        uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: coverage/
          retention-days: 7

      # IMPORTANT: DeepSource automatically reads coverage/lcov.info
      # No additional upload step needed - it detects the file automatically
# HOW COPILOT + DEEPSOURCE USE THIS:
# 1. Codecov posts PR comment: "Coverage decreased by 2.3%"
# 2. DeepSource analyzes which specific lines aren't covered
# 3. Copilot reads both sources and combines insights:
#    "Coverage dropped in state-manager.js lines 45-67.
#    These lines handle container isolation logic and are critical.
#    DeepSource analysis shows they're also complex (CC=12).
#    Suggested tests: [generates test cases]"
```

**Enhanced Coverage Analysis:**

- Codecov: Shows overall trends
- DeepSource: Shows which uncovered lines are highest risk
- Copilot: Suggests specific tests based on both tools

---

## 4. Web Extension Validation {#webext-workflow}

**File:** `.github/workflows/webext-lint.yml`

Firefox-specific extension validation.

```yaml
name: Web Extension Validation

on:
  pull_request:
    branches: [main]

jobs:
  validate:
    name: Validate Firefox Extension
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'

      # Install Mozilla's web-ext tool globally
      - name: Install web-ext
        run: npm install --global web-ext

      # Lint the extension
      - name: Lint extension source
        run: |
          web-ext lint \
            --source-dir=. \
            --ignore-files="*.md" "node_modules/**" "dist/**" ".github/**" \
            --warnings-as-errors \
            --pretty \
            --output=text
        # Checks:
        # - Manifest structure and permissions
        # - Deprecated API usage
        # - Firefox compatibility issues

      # Build and validate
      - name: Build extension
        run: |
          npm ci
          npm run build:prod

      - name: Validate built extension
        run: |
          web-ext lint --source-dir=dist/ --warnings-as-errors

      # Test loading in Firefox (optional)
      - name: Test extension loads
        run: |
          # Run web-ext run in headless mode to verify it loads
          timeout 30s web-ext run \
            --source-dir=dist/ \
            --firefox=firefox \
            --firefox-profile=temp-profile \
            --no-reload \
            || true

# HOW COPILOT + DEEPSOURCE USE THIS:
# - web-ext finds Firefox-specific issues
# - DeepSource finds general JavaScript issues
# - Copilot combines both for comprehensive browser extension review
# - Example: web-ext warns about deprecated API + DeepSource suggests modern alternative
```

---

## 5. Auto-Format on PR (Optional) {#auto-format-workflow}

**File:** `.github/workflows/auto-format.yml`

Automatically formats code with Prettier. DeepSource also has autofix but this
runs faster.

```yaml
name: Auto-Format Code

on:
  pull_request:
    branches: [main, develop]

# Important: This needs write permissions
permissions:
  contents: write

jobs:
  format:
    name: Auto-Format with Prettier
    runs-on: ubuntu-latest

    steps:
      # Check out with the PR branch
      - name: Checkout PR branch
        uses: actions/checkout@v4
        with:
          ref: ${{ github.head_ref }} # The PR branch
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      # Run Prettier to format all files
      - name: Run Prettier
        run: npm run format

      # Commit and push changes if any
      - name: Commit formatting changes
        uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: 'style: auto-format code with Prettier [skip ci]'
          commit_user_name: 'github-actions[bot]'
          commit_user_email: 'github-actions[bot]@users.noreply.github.com'
        # The [skip ci] prevents infinite loop of formatting runs
# NOTE: DeepSource also has Autofix™ AI that can fix style + logic issues
# This Prettier workflow is faster for formatting-only changes
# DeepSource Autofix handles more complex issues like refactoring

# HOW THEY WORK TOGETHER:
# 1. Prettier (this workflow): Fixes formatting in <1 minute
# 2. DeepSource Autofix AI: Creates separate PR for logic/quality issues
# 3. Copilot: Reviews both sets of changes and suggests improvements
```

---

## 6. DeepSource Setup (No Workflow Needed!) {#deepsource-setup}

**DeepSource runs on its own infrastructure - no GitHub Actions workflow
required.**

### Step 1: Activate DeepSource

**Your repository already has `.deepsource.toml` configured!** Just activate it:

1. Go to https://deepsource.io/
2. Sign in with GitHub
3. Click "Add repository"
4. Select `copy-URL-on-hover_ChunkyEdition`
5. DeepSource reads your existing `.deepsource.toml`
6. Done! It now analyzes every push/PR automatically

### Step 2: Enhanced `.deepsource.toml` Configuration

**Update your existing `.deepsource.toml` file:**

```toml
version = 1

# JavaScript/TypeScript Analyzer
[[analyzers]]
name = "javascript"
enabled = true

  [analyzers.meta]
  # Specify environments for accurate analysis
  environment = ["nodejs", "browser"]

  # Browser extension-specific settings
  plugins = ["webextensions"]

  # Style configuration
  style_guide = "airbnb"  # Or "standard", "google"

  # Dialect for modern JavaScript
  dialect = "typescript"  # Handles both JS and TS

# Test Coverage Analyzer
# Reads coverage/lcov.info from Jest automatically
[[analyzers]]
name = "test-coverage"
enabled = true

  [analyzers.meta]
  # Require 80% coverage on new code
  coverage_threshold = 80

# Prettier Transformer (auto-formats code)
[[transformers]]
name = "prettier"
enabled = true

  [transformers.meta]
  # Point to your Prettier config
  config_file = ".prettierrc.js"

# Secret Scanner (detects hardcoded secrets)
[[analyzers]]
name = "secrets"
enabled = true

# Additional Analyzers (optional but recommended)

# Docker files (if you have Dockerfile)
# [[analyzers]]
# name = "docker"
# enabled = true

# Shell scripts (if you have .sh files)
# [[analyzers]]
# name = "shell"
# enabled = true
```

**What This Configuration Does:**

1. **JavaScript Analyzer:**
   - Finds bugs, anti-patterns, security issues
   - Browser extension API validation
   - Modern JavaScript best practices

2. **Test Coverage:**
   - Tracks coverage % over time
   - Flags coverage decreases
   - Highlights uncovered critical code

3. **Prettier Transformer:**
   - Auto-formats code in DeepSource UI
   - Can create auto-fix PRs

4. **Secrets Scanner:**
   - Detects API keys, passwords, tokens
   - Prevents credential leaks

### Step 3: Enable Autofix™ AI (2025 Feature)

**This is DeepSource's killer feature - AI-powered automatic fixes:**

1. Go to DeepSource dashboard for your repo
2. Navigate to **Settings** → **Autofix™**
3. Select **"Autofix™ AI"** mode (recommended)
4. Configure preferences:
   - ✅ Create PRs automatically
   - ✅ Auto-merge if tests pass (optional)
   - ✅ Notify on Slack/Email (optional)

**What Autofix™ AI Does:**

- Analyzes issues with full context (not just the line)
- Generates fixes using LLMs
- Creates pull requests with explanations
- ~90-100% fix accuracy (vs 30% with old rule-based system)

**Example Autofix PR:**

```
Title: "[DeepSource] Fix: Remove unused variable and improve error handling"

DeepSource found 2 issues in background.js:
1. Unused variable `userId` on line 45
2. Missing error handling in async function

Changes made:
- Removed unused variable
- Added try/catch with proper error logging
- Updated function signature for clarity

This fix improves code maintainability and prevents potential runtime errors.
```

### Step 4: Configure Integration Settings

**In DeepSource dashboard:**

1. **Pull Requests:**
   - ✅ Comment on pull requests
   - ✅ Set status checks (pass/fail)
   - ✅ Block merge on critical issues
   - ⚠️ Coverage decrease threshold: 1%

2. **Notifications:**
   - ✅ Email on critical issues
   - ⚙️ Slack webhook (optional): `https://hooks.slack.com/...`
   - ⚙️ Discord webhook (optional)

3. **Issue Tracking:**
   - ✅ Ignore false positives
   - ✅ Suppress third-party code issues
   - ✅ Exclude patterns: `node_modules/`, `dist/`, `*.min.js`

### How DeepSource Comments on PRs

**DeepSource posts detailed comments like:**

```
🤖 DeepSource Analysis

Overall Status: ✅ 2 issues resolved, ⚠️ 1 new issue

New Issues:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ JS-0116: Async function missing error handler

File: background.js:127
Category: Bug risk
Severity: Medium

async function saveState(state) {
  await browser.storage.sync.set({ state });  // No try/catch
}

Why this matters:
If storage.sync fails (quota exceeded, permission denied),
the error will be silently swallowed, leading to data loss.

Recommended fix:
async function saveState(state) {
  try {
    await browser.storage.sync.set({ state });
  } catch (error) {
    console.error('Failed to save state:', error);
    throw new Error('Storage operation failed');
  }
}

[View in DeepSource] [Autofix this issue]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Coverage: 78.2% (+0.3%)
Technical Debt: 2h 15m (-30m)
```

### Integration with GitHub Copilot

**How Copilot Uses DeepSource:**

1. **Copilot reads DeepSource comments** on PRs
2. **Combines with its own analysis:**
   - CodeQL: Security vulnerabilities
   - ESLint: Code quality
   - DeepSource: Comprehensive analysis + context
3. **Avoids duplication:**
   - If DeepSource already flagged an issue, Copilot doesn't repeat it
   - Instead, Copilot adds additional context or alternative solutions
4. **Leverages Autofix:**
   - If DeepSource creates an autofix PR, Copilot reviews that PR too
   - Suggests improvements to the fix if needed

**Example Combined Review:**

```
🤖 GitHub Copilot Code Review

I've analyzed your changes along with DeepSource findings:

⚠️ Issue 1: Async error handling (also flagged by DeepSource)
DeepSource correctly identified missing error handling in saveState().
I agree with their suggestion, but also recommend:
- Add user-facing error message
- Retry logic for transient failures
- Telemetry for debugging

Suggested implementation:
[Shows enhanced fix with retry logic]

✅ Issue 2: Improved type safety (unique to Copilot)
Consider adding JSDoc types for better IDE support:
/**
 * @param {Object} state - Application state
 * @param {string} state.url - Current URL
 * @returns {Promise<void>}
 */

DeepSource coverage report looks good (+0.3%). Nice work! 🎉
```

---

## 7. How These Workflows Work Together {#how-workflows-work}

### Complete Analysis Flow

```
Developer pushes to PR
         ↓
┌─────────────────────────────────────────────────────────┐
│  GitHub Actions (Parallel Execution)                    │
├─────────────────────────────────────────────────────────┤
│  1. code-quality.yml                                    │
│     ├─ ESLint (JS quality)                              │
│     ├─ Prettier (formatting)                            │
│     ├─ Build (compilation)                              │
│     └─ web-ext (Firefox validation)                     │
│                                                          │
│  2. codeql-analysis.yml                                 │
│     └─ Security vulnerabilities                         │
│                                                          │
│  3. test-coverage.yml                                   │
│     └─ Jest + coverage report                           │
│                                                          │
│  4. auto-format.yml (if enabled)                        │
│     └─ Prettier auto-fix                                │
└─────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────┐
│  DeepSource (Runs on DeepSource Infrastructure)         │
├─────────────────────────────────────────────────────────┤
│  - JavaScript analysis (bugs, anti-patterns)            │
│  - Test coverage analysis (reads lcov.info)             │
│  - Security scanning (secrets, vulnerabilities)         │
│  - Code complexity metrics                              │
│  - Technical debt calculation                           │
│  - Autofix™ AI generates fixes                          │
└─────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────┐
│  External AI Tools                                      │
├─────────────────────────────────────────────────────────┤
│  - CodeRabbit: Initial AI review                        │
│  - Qodo: PR description generation                      │
│  - Codecov: Coverage report comment                     │
└─────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────┐
│  GitHub Copilot Code Review (Synthesis)                 │
├─────────────────────────────────────────────────────────┤
│  Reads ALL results:                                     │
│  ✓ ESLint errors                                        │
│  ✓ CodeQL security findings                             │
│  ✓ DeepSource comprehensive analysis                    │
│  ✓ Codecov coverage changes                             │
│  ✓ Build failures                                       │
│  ✓ Web-ext compatibility issues                         │
│  ✓ CodeRabbit/Qodo comments                             │
│                                                          │
│  Combines with:                                         │
│  • Full codebase context (not just diff)                │
│  • Custom instructions from .github/copilot-...md       │
│  • Best practices and patterns                          │
│                                                          │
│  Posts comprehensive review:                            │
│  - Prioritized issues (critical → minor)                │
│  - Context-aware explanations                           │
│  - Concrete fix suggestions                             │
│  - [Implement suggestion] buttons                       │
└─────────────────────────────────────────────────────────┘
         ↓
Developer Actions:
  1. Click [Implement suggestion] for Copilot fixes
  2. Click [Autofix this issue] for DeepSource fixes
  3. Or manually fix based on guidance
         ↓
Push fixes → All checks re-run → Merge when green ✅
```

### Tool Specialization

Each tool has a specific role:

| Tool           | Specialization                                | Speed     | False Positives |
| -------------- | --------------------------------------------- | --------- | --------------- |
| **ESLint**     | JS quality, common mistakes                   | Fast      | Very Low        |
| **Prettier**   | Code formatting only                          | Very Fast | None            |
| **CodeQL**     | Security vulnerabilities                      | Medium    | Very Low        |
| **Jest**       | Test execution                                | Fast      | N/A             |
| **Codecov**    | Coverage tracking                             | Fast      | None            |
| **web-ext**    | Firefox compatibility                         | Fast      | Low             |
| **DeepSource** | Comprehensive (bugs, quality, security, debt) | Fast      | <5%             |
| **CodeRabbit** | AI review, explanations                       | Medium    | Medium          |
| **Copilot**    | Synthesis + AI reasoning                      | Medium    | Low             |

**Key Insight:** DeepSource provides the comprehensive analysis layer that
catches issues ESLint misses, while maintaining low false positives (<5%).

---

## Configuration Files Summary

**Files you need to create/update:**

```
repository/
├── .github/
│   ├── workflows/
│   │   ├── code-quality.yml          ← Create (main checks)
│   │   ├── codeql-analysis.yml       ← Create (security)
│   │   ├── test-coverage.yml         ← Create (tests + coverage)
│   │   ├── webext-lint.yml           ← Create (Firefox validation)
│   │   └── auto-format.yml           ← Create (optional auto-fix)
│   └── copilot-instructions.md       ← Create (Copilot guidance)
├── .deepsource.toml                  ← UPDATE (already exists!)
├── .eslintrc.js                      ← Create (ESLint config)
├── .prettierrc.js                    ← Create (Prettier config)
├── jest.config.js                    ← Create (Jest config)
└── package.json                      ← Update (add scripts)
```

---

## Secrets Required

**Add these in Repository Settings → Secrets and Variables → Actions:**

- `CODECOV_TOKEN` - From https://codecov.io/ (optional for public repos)
- `GITHUB_TOKEN` - Automatically provided (no setup needed)

**No secrets needed for:**

- DeepSource (uses GitHub App authentication)
- CodeRabbit (uses GitHub App)
- Qodo (uses GitHub App)

---

## Package.json Scripts

**Ensure these scripts exist in your `package.json`:**

```json
{
  "scripts": {
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "jest",
    "test:coverage": "jest --coverage",
    "build": "npm run clean && rollup -c && npm run copy-assets",
    "build:prod": "npm run clean && rollup -c --environment BUILD:production && npm run copy-assets",
    "clean": "rm -rf dist && mkdir -p dist",
    "copy-assets": "cp background.js popup.html popup.js options_page.html options_page.js state-manager.js manifest.json dist/ && cp -r icons sidebar dist/"
  }
}
```

---

## Quick Start Checklist

**For GitHub Copilot Agent to implement:**

1. ✅ Create all workflow files in `.github/workflows/`
2. ✅ Update `.deepsource.toml` with enhanced configuration
3. ✅ Create `.eslintrc.js`, `.prettierrc.js`, `jest.config.js`
4. ✅ Add required scripts to `package.json`
5. ✅ Install dependencies: `npm install --save-dev eslint prettier jest`
6. ✅ Enable GitHub Advanced Security for CodeQL
7. ✅ Activate DeepSource at https://deepsource.io/
8. ✅ Enable Autofix™ AI in DeepSource settings
9. ✅ Create `.github/copilot-instructions.md`
10. ✅ Set up branch protection rules requiring all checks
11. ✅ Push to trigger first workflow run
12. ✅ Verify DeepSource posts first analysis

---

## Troubleshooting

**DeepSource not commenting on PRs:**

- Check DeepSource dashboard: Is the repo activated?
- Go to Settings → Integrations → GitHub
- Verify "Comment on pull requests" is enabled
- Check `.deepsource.toml` syntax with https://validate.deepsource.io/

**ESLint failing with too many errors:**

- Start with warnings only: Change rules from `'error'` to `'warn'`
- Fix gradually over multiple PRs
- Use `// eslint-disable-next-line rule-name` for exceptions

**CodeQL not finding issues:**

- Check languages array includes `'javascript'`
- Verify `permissions: security-events: write` is set
- Enable "Code scanning" in repository security settings

**Coverage not uploading to DeepSource:**

- Ensure `coverage/lcov.info` is generated by Jest
- Check DeepSource → Settings → Test Coverage is enabled
- Verify `.deepsource.toml` has `test-coverage` analyzer

**Workflows taking too long:**

- Enable npm caching: `cache: 'npm'` in setup-node steps
- Run jobs in parallel (they already are by default)
- Use `npm ci` instead of `npm install`

---

**Document Version:** 2.0  
**Last Updated:** November 12, 2025  
**Changes:** Added DeepSource integration, removed SonarCloud  
**For:** GitHub Copilot Agent Implementation  
**Repository:** copy-URL-on-hover_ChunkyEdition
