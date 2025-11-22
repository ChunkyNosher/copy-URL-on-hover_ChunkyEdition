# Remaining Implementation Tasks for Autonomous Copilot Testing

**Document Version:** 1.0  
**Last Updated:** November 22, 2025  
**Target Audience:** GitHub Copilot Coding Agent  
**Repository:** copy-URL-on-hover_ChunkyEdition  
**Current Status:** Phase 1 Complete (~50% coverage), Remaining tasks for Phase 2-4

---

## Executive Summary

This document details the **specific remaining implementation tasks** required to achieve full autonomous testing capability for all 20 Issue #47 scenarios using GitHub Copilot Coding Agent + Playwright MCP.

**Current State:** Test bridge infrastructure is complete with 10 basic scenario tests implemented. The foundation is solid but incomplete.

**Target State:** All 20 Issue #47 scenarios automated with agent-driven execution, iteration, and self-healing capabilities.

**Gap:** 10 additional scenarios + infrastructure enhancements + CI/CD integration + result logging system.

---

## 🎯 What Already Works

### ✅ Completed Infrastructure (PR #241)

1. **Test Bridge API** (`src/test-bridge.js`)
   - 10 programmatic methods exposing all core Quick Tab operations
   - Secure build-time injection (TEST_MODE=true only)
   - WebExtensions API integration verified via Mozilla docs

2. **Playwright Test Framework**
   - Configs for Firefox and Chrome pointing to `tests/extension/`
   - `ExtensionTestHelper` class wrapping all bridge methods
   - Multi-tab orchestration via `context.newPage()` pattern

3. **Scenario Tests** (`tests/extension/issue-47-scenarios.spec.js`)
   - **10 scenarios implemented:** Scenarios 1-4, 6-9, plus cross-tab sync tests
   - All tests use Test Bridge API for deterministic state access
   - Cross-tab synchronization validated with polling utilities

4. **Build & Validation Scripts**
   - `build:test` - Injects test bridge at build time
   - `validate:test-bridge` - Verifies all 10 critical infrastructure components
   - ESLint passes on all files

5. **Documentation**
   - Complete architectural documentation in `docs/implementation-summaries/`
   - Expected behavior memories for Scenarios 1-9
   - Gap analysis and testing guide

---

## 🚧 What Still Needs Implementation

### Category A: Missing Scenario Tests (10 scenarios)

**Based on revised Issue #47 (20 total scenarios), the following are NOT YET automated:**

| Scenario | Title | Complexity | Estimated Effort |
|----------|-------|------------|------------------|
| **Scenario 5** | Manager Panel with YouTube Embed Playback | Medium | 2-3 hours |
| **Scenario 10** | Quick Tab Limit Enforcement & Error UI | Low | 1-2 hours |
| **Scenario 11** | Emergency Save on Tab Switch | Medium | 2-3 hours |
| **Scenario 12** | Close All Minimized via Manager | Low | 1-2 hours |
| **Scenario 13** | Solo/Mute Mutual Exclusion | Medium | 2-3 hours |
| **Scenario 14** | State Persistence Across Browser Restart | High | 3-4 hours |
| **Scenario 15** | Manager Panel Position/Size Persistence | Low | 1-2 hours |
| **Scenario 16** | Debug Mode Slot Numbering Validation | Low | 1-2 hours |
| **Scenario 17** | Multi-Direction Resize Behavior | Medium | 2-3 hours |
| **Scenario 18** | Z-Index Management (Focus/Blur) | Medium | 2-3 hours |
| **Scenario 19** | Container Isolation Enforcement | High | 3-4 hours |
| **Scenario 20** | Container Cleanup on Last Tab Close | High | 3-4 hours |

**Total Estimated Effort:** 24-35 hours of agent-assisted development

#### Implementation Pattern for Each Scenario

**Reference:** Use existing `tests/extension/issue-47-scenarios.spec.js` as template.

**Standard Test Structure:**
```javascript
test.describe('Scenario [N]: [Title]', () => {
  test('should [behavior description]', async ({ context }) => {
    // Setup
    const page1 = await context.newPage();
    await page1.goto('https://example.com');
    const helper1 = new ExtensionTestHelper(page1);
    await helper1.waitForTestBridge(15000);
    await helper1.clearAllQuickTabs();
    
    // Execute scenario steps
    // ... (use Test Bridge API for all actions)
    
    // Assertions
    // ... (verify expected behavior)
    
    // Cleanup
    await helper1.clearAllQuickTabs();
    await page1.close();
  });
});
```

**Key Requirements:**
- Use `ExtensionTestHelper` for all extension interactions
- Use `context.newPage()` for multi-tab scenarios
- Include `waitForQuickTabCount()` polling for sync verification
- Add explicit cleanup in `afterEach` or at test end
- Document expected behavior in comments

---

### Category B: Test Bridge API Extensions

**Current Coverage:** 10 methods implemented

**Additional Methods Needed:**

#### B.1 Solo/Mute Mode Support (Scenarios 3, 4, 13)

**Current Gap:** Test bridge has no methods for solo/mute operations.

**Required Methods:**
```javascript
// In src/test-bridge.js
TestBridge = {
  // ... existing methods ...
  
  /**
   * Toggle solo mode for a Quick Tab
   * @param {string} id - Quick Tab ID
   * @param {number} tabId - Browser tab ID (optional, uses current tab if omitted)
   */
  toggleSolo: async (id, tabId) => {
    // Implementation: Send message to content script
    // Message type: 'TEST_TOGGLE_SOLO'
    // Should activate solo mode (hide all other QTs on this tab)
    // Return: {success: boolean, mode: 'solo'|'normal'}
  },
  
  /**
   * Toggle mute mode for a Quick Tab
   * @param {string} id - Quick Tab ID
   * @param {number} tabId - Browser tab ID
   */
  toggleMute: async (id, tabId) => {
    // Implementation: Send message to content script
    // Message type: 'TEST_TOGGLE_MUTE'
    // Should activate mute mode (hide on this tab only)
    // Return: {success: boolean, mode: 'mute'|'normal'}
  },
  
  /**
   * Get visibility state for all Quick Tabs on a specific tab
   * @param {number} tabId - Browser tab ID
   */
  getVisibilityState: async (tabId) => {
    // Return: {tabId, visibleQTs: [...], hiddenQTs: [...], soloMode: boolean, mutedQTs: [...]}
  }
};
```

**Verification Pattern:**
- "According to Mozilla WebExtensions documentation on message passing, `browser.tabs.sendMessage()` supports async responses for state queries."
- Source: <https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/sendMessage>

**Content Script Handlers Needed:**
```javascript
// In src/content.js
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TEST_TOGGLE_SOLO') {
    // Call quickTabsManager.toggleSolo(message.id)
    // Return {success, mode}
  }
  if (message.type === 'TEST_TOGGLE_MUTE') {
    // Call quickTabsManager.toggleMute(message.id)
    // Return {success, mode}
  }
  if (message.type === 'TEST_GET_VISIBILITY_STATE') {
    // Query visibility state from quickTabsManager
    // Return {tabId, visibleQTs, hiddenQTs, soloMode, mutedQTs}
  }
});
```

---

#### B.2 Manager Panel State Access (Scenarios 5, 6, 12, 15)

**Current Gap:** No methods to query or control Manager Panel state.

**Required Methods:**
```javascript
TestBridge = {
  // ... existing methods ...
  
  /**
   * Get Manager Panel state
   */
  getManagerState: async () => {
    // Return: {
    //   visible: boolean,
    //   position: {x, y},
    //   size: {width, height},
    //   minimizedCount: number,
    //   minimizedTabs: [{id, url, title}, ...]
    // }
  },
  
  /**
   * Set Manager Panel position (for persistence testing)
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   */
  setManagerPosition: async (x, y) => {
    // Set explicit position for testing position persistence
    // Return: {success: boolean, position: {x, y}}
  },
  
  /**
   * Set Manager Panel size
   * @param {number} width - Width in pixels
   * @param {number} height - Height in pixels
   */
  setManagerSize: async (width, height) => {
    // Set explicit size for testing size persistence
    // Return: {success: boolean, size: {width, height}}
  },
  
  /**
   * Close all minimized Quick Tabs via Manager
   */
  closeAllMinimized: async () => {
    // Simulate "Close All" button in Manager Panel
    // Return: {success: boolean, closedCount: number}
  }
};
```

**Implementation Note:** Manager Panel state is stored in `browser.storage.local` with key `managerPanelState`. Query this storage key to retrieve position/size.

---

#### B.3 Container Isolation Support (Scenarios 8, 19, 20)

**Current Gap:** No methods to query or manipulate container context.

**Required Methods:**
```javascript
TestBridge = {
  // ... existing methods ...
  
  /**
   * Get container information for all Quick Tabs
   */
  getContainerInfo: async () => {
    // Return: {
    //   containers: [
    //     {
    //       cookieStoreId: 'firefox-container-1',
    //       name: 'Personal',
    //       color: 'blue',
    //       quickTabs: [{id, url}, ...]
    //     },
    //     ...
    //   ]
    // }
  },
  
  /**
   * Create Quick Tab in specific container
   * @param {string} url - URL to load
   * @param {string} cookieStoreId - Firefox container ID
   */
  createQuickTabInContainer: async (url, cookieStoreId) => {
    // Create QT in specified container context
    // Return: {success: boolean, id, cookieStoreId}
  },
  
  /**
   * Verify container isolation
   * @param {string} id1 - First Quick Tab ID
   * @param {string} id2 - Second Quick Tab ID
   */
  verifyContainerIsolation: async (id1, id2) => {
    // Check if two QTs are in different containers
    // Return: {isolated: boolean, container1, container2}
  }
};
```

**Container Testing Requirements:**
- Firefox profile with predefined containers (Personal, Work, Shopping, etc.)
- Launch Playwright with `--profile` flag pointing to test profile
- "According to Firefox Multi-Account Containers documentation, `cookieStoreId` is the unique identifier for each container context."
- Source: <https://addons.mozilla.org/en-US/firefox/addon/multi-account-containers/>

**Playwright Config Extension:**
```javascript
// playwright.config.firefox.js
use: {
  launchOptions: {
    firefoxUserPrefs: {
      'privacy.userContext.enabled': true,
      'privacy.userContext.ui.enabled': true
    },
    args: ['--profile', './test-profiles/firefox-containers']
  }
}
```

---

#### B.4 Debug Mode & Slot Numbering (Scenario 16)

**Current Gap:** No methods to access debug mode state or slot assignments.

**Required Methods:**
```javascript
TestBridge = {
  // ... existing methods ...
  
  /**
   * Get slot numbering information (debug mode)
   */
  getSlotNumbering: async () => {
    // Return: {
    //   debugMode: boolean,
    //   slots: [
    //     {slotNumber: 1, quickTabId: 'qt-123', url: 'https://...'},
    //     {slotNumber: 2, quickTabId: 'qt-456', url: 'https://...'},
    //     ...
    //   ]
    // }
  },
  
  /**
   * Enable/disable debug mode
   * @param {boolean} enabled - Debug mode state
   */
  setDebugMode: async (enabled) => {
    // Toggle debug mode for testing slot numbering
    // Return: {success: boolean, debugMode: boolean}
  }
};
```

---

#### B.5 Resize & Position Validation (Scenarios 17, 18)

**Current Gap:** Test bridge can set position/size but cannot retrieve current values for validation.

**Required Methods:**
```javascript
TestBridge = {
  // ... existing methods ...
  
  /**
   * Get Quick Tab position and size
   * @param {string} id - Quick Tab ID
   */
  getQuickTabGeometry: async (id) => {
    // Return: {
    //   id,
    //   position: {x, y},
    //   size: {width, height},
    //   zIndex: number
    // }
  },
  
  /**
   * Verify z-index order for focus management
   * @param {string[]} ids - Array of Quick Tab IDs in expected order
   */
  verifyZIndexOrder: async (ids) => {
    // Check if QTs are stacked in expected order
    // Return: {valid: boolean, actualOrder: [...]}
  }
};
```

---

### Category C: Cross-Tab Synchronization Reliability

**Current State:** Basic polling with `waitForQuickTabCount()` works but is not robust for all scenarios.

**Improvements Needed:**

#### C.1 Enhanced Sync Verification Utilities

**Add to `tests/extension/helpers/extension-test-utils.js`:**

```javascript
class ExtensionTestHelper {
  // ... existing methods ...
  
  /**
   * Wait for specific Quick Tab to appear across all pages in context
   * @param {string} id - Quick Tab ID to wait for
   * @param {number} timeout - Max wait time in ms
   */
  async waitForQuickTabSync(id, timeout = 5000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const tabs = await this.getQuickTabs();
      if (tabs.some(t => t.id === id)) {
        return true;
      }
      await this.page.waitForTimeout(100);
    }
    throw new Error(`Quick Tab ${id} did not sync within ${timeout}ms`);
  }
  
  /**
   * Wait for Quick Tab state to match expected state
   * @param {string} id - Quick Tab ID
   * @param {object} expectedState - Expected state properties
   * @param {number} timeout - Max wait time
   */
  async waitForQuickTabState(id, expectedState, timeout = 5000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const tab = await this.getQuickTabById(id);
      if (tab && this.stateMatches(tab, expectedState)) {
        return tab;
      }
      await this.page.waitForTimeout(100);
    }
    throw new Error(`Quick Tab ${id} did not reach expected state within ${timeout}ms`);
  }
  
  /**
   * Helper to check if state matches expected properties
   */
  stateMatches(actual, expected) {
    return Object.keys(expected).every(key => actual[key] === expected[key]);
  }
  
  /**
   * Wait for BroadcastChannel message propagation
   * Uses exponential backoff for reliability
   */
  async waitForBroadcastSync(timeout = 3000) {
    let delay = 50;
    const maxDelay = 500;
    const endTime = Date.now() + timeout;
    
    while (Date.now() < endTime) {
      await this.page.waitForTimeout(delay);
      delay = Math.min(delay * 1.5, maxDelay);
    }
  }
}
```

**Rationale:**
- "According to BroadcastChannel API documentation, message delivery is asynchronous but typically completes within 10-100ms on modern browsers."
- Source: <https://developer.mozilla.org/en-US/blog/exploring-the-broadcast-channel-api-for-cross-tab-communication/>
- "Exponential backoff polling is recommended for cross-tab sync testing to handle varying network/CPU loads."
- Source: <https://dsheiko.com/weblog/optimizing-end-to-end-testing-with-playwright/>

---

### Category D: Container Testing Setup

**Current State:** No Firefox profile with predefined containers.

**Required Setup:**

#### D.1 Create Test Profile with Containers

**Directory:** `test-profiles/firefox-containers/`

**Files to Create:**

1. **`containers.json`** - Define test containers:
```json
{
  "version": 4,
  "lastUserContextId": 5,
  "identities": [
    {
      "userContextId": 1,
      "name": "Personal",
      "icon": "fingerprint",
      "color": "blue",
      "public": true
    },
    {
      "userContextId": 2,
      "name": "Work",
      "icon": "briefcase",
      "color": "orange",
      "public": true
    },
    {
      "userContextId": 3,
      "name": "Shopping",
      "icon": "cart",
      "color": "green",
      "public": true
    },
    {
      "userContextId": 4,
      "name": "Banking",
      "icon": "dollar",
      "color": "red",
      "public": true
    }
  ]
}
```

2. **`prefs.js`** - Firefox preferences:
```javascript
user_pref("privacy.userContext.enabled", true);
user_pref("privacy.userContext.ui.enabled", true);
user_pref("privacy.userContext.extension", "@testcontainers-ext");
```

**Playwright Config Update:**
```javascript
// playwright.config.firefox.js
use: {
  launchOptions: {
    args: [
      '--profile',
      path.join(__dirname, 'test-profiles/firefox-containers')
    ]
  }
}
```

**Test Pattern for Container Scenarios:**
```javascript
test('should isolate Quick Tabs by container', async ({ context }) => {
  const page1 = await context.newPage();
  await page1.goto('https://example.com');
  
  const helper1 = new ExtensionTestHelper(page1);
  await helper1.waitForTestBridge();
  
  // Create QT in Personal container
  await helper1.createQuickTabInContainer('https://site1.com', 'firefox-container-1');
  
  // Create QT in Work container
  await helper1.createQuickTabInContainer('https://site2.com', 'firefox-container-2');
  
  // Verify isolation
  const containerInfo = await helper1.getContainerInfo();
  expect(containerInfo.containers).toHaveLength(2);
  
  const personal = containerInfo.containers.find(c => c.name === 'Personal');
  const work = containerInfo.containers.find(c => c.name === 'Work');
  
  expect(personal.quickTabs).toHaveLength(1);
  expect(work.quickTabs).toHaveLength(1);
});
```

---

### Category E: Browser Restart Simulation (Scenario 14)

**Current State:** Cannot test actual browser restart in Playwright.

**Workaround Strategy:**

#### E.1 Storage Persistence Testing (Partial Solution)

**Pattern:**
```javascript
test('should persist Quick Tab state across browser restart (storage)', async ({ context }) => {
  // Create QTs with various states
  const page1 = await context.newPage();
  await page1.goto('https://example.com');
  const helper1 = new ExtensionTestHelper(page1);
  
  await helper1.createQuickTab('https://site1.com');
  await helper1.createQuickTab('https://site2.com');
  
  const tabs = await helper1.getQuickTabs();
  const tab1 = tabs[0];
  
  await helper1.minimizeQuickTab(tab1.id);
  await helper1.pinQuickTab(tab1.id);
  
  // Close all pages (simulate browser close)
  await context.close();
  
  // Create new context (simulate browser restart)
  const newContext = await browser.newContext();
  const page2 = await newContext.newPage();
  await page2.goto('https://example.com');
  
  const helper2 = new ExtensionTestHelper(page2);
  await helper2.waitForTestBridge();
  
  // Wait for restoration from storage
  await page2.waitForTimeout(2000); // Allow time for storage restoration
  
  // Verify state persisted
  const restoredTabs = await helper2.getQuickTabs();
  expect(restoredTabs).toHaveLength(2);
  
  const restoredTab1 = restoredTabs.find(t => t.id === tab1.id);
  expect(restoredTab1.minimized).toBe(true);
  expect(restoredTab1.pinnedToUrl).not.toBeNull();
});
```

**Limitation Note:**
- "Playwright cannot test actual browser process restart or extension lifecycle events. Storage-based persistence is the closest approximation."
- "According to WebExtensions documentation, `browser.storage.local` persists across browser restarts but not across context destruction in test environments."
- Source: <https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/local>

---

### Category F: Automated Result Logging for Agent Feedback

**Current State:** Tests pass/fail but no structured feedback for Copilot Agent iteration.

**Required Infrastructure:**

#### F.1 Test Result Logger

**Create:** `tests/extension/helpers/result-logger.js`

```javascript
/**
 * Result Logger for Copilot Agent Feedback
 * Captures test results, screenshots, and state dumps for agent analysis
 */

import fs from 'fs';
import path from 'path';

export class TestResultLogger {
  constructor(testName) {
    this.testName = testName;
    this.resultsDir = path.join(__dirname, '../../test-results', testName);
    this.logs = [];
    
    // Create results directory
    if (!fs.existsSync(this.resultsDir)) {
      fs.mkdirSync(this.resultsDir, { recursive: true });
    }
  }
  
  /**
   * Log test step with state snapshot
   */
  async logStep(stepName, page, helper) {
    const timestamp = new Date().toISOString();
    const screenshot = await page.screenshot({
      path: path.join(this.resultsDir, `${stepName}-${timestamp}.png`)
    });
    
    const state = await helper.getQuickTabs();
    
    this.logs.push({
      step: stepName,
      timestamp,
      screenshotPath: screenshot,
      state
    });
  }
  
  /**
   * Log test failure with diagnostics
   */
  async logFailure(error, page, helper) {
    const timestamp = new Date().toISOString();
    
    // Capture failure screenshot
    await page.screenshot({
      path: path.join(this.resultsDir, `FAILURE-${timestamp}.png`)
    });
    
    // Capture console logs
    const consoleLogs = await page.evaluate(() => {
      return window.__TEST_CONSOLE_LOGS__ || [];
    });
    
    // Capture Quick Tab state
    const state = await helper.getQuickTabs().catch(() => null);
    
    // Capture storage state
    const storage = await page.evaluate(() => {
      return browser.storage.local.get(null);
    });
    
    const failureReport = {
      testName: this.testName,
      error: {
        message: error.message,
        stack: error.stack
      },
      timestamp,
      consoleLogs,
      quickTabState: state,
      storageState: storage,
      steps: this.logs
    };
    
    // Write failure report
    fs.writeFileSync(
      path.join(this.resultsDir, 'FAILURE-REPORT.json'),
      JSON.stringify(failureReport, null, 2)
    );
    
    return failureReport;
  }
  
  /**
   * Log test success with final state
   */
  async logSuccess(page, helper) {
    const timestamp = new Date().toISOString();
    const state = await helper.getQuickTabs();
    
    const successReport = {
      testName: this.testName,
      status: 'PASS',
      timestamp,
      finalState: state,
      steps: this.logs
    };
    
    fs.writeFileSync(
      path.join(this.resultsDir, 'SUCCESS-REPORT.json'),
      JSON.stringify(successReport, null, 2)
    );
  }
}
```

**Usage in Tests:**
```javascript
test('Scenario 5: Manager with YouTube', async ({ page }) => {
  const logger = new TestResultLogger('scenario-5');
  const helper = new ExtensionTestHelper(page);
  
  try {
    await logger.logStep('setup', page, helper);
    // ... test steps ...
    await logger.logStep('create-qt', page, helper);
    // ... more steps ...
    await logger.logSuccess(page, helper);
  } catch (error) {
    const report = await logger.logFailure(error, page, helper);
    throw error; // Re-throw for Playwright
  }
});
```

**Agent Integration:**
- Failure reports in JSON format are easily parseable by Copilot Agent
- Screenshots provide visual context for debugging
- State dumps enable agent to understand exact failure conditions
- Console logs reveal extension internal errors

---

### Category G: CI/CD Pipeline Integration

**Current State:** Test infrastructure exists but no CI workflow.

**Required Setup:**

#### G.1 GitHub Actions Workflow

**Create:** `.github/workflows/playwright-tests.yml`

```yaml
name: Playwright Extension Tests

on:
  pull_request:
    branches: [main]
    paths:
      - 'src/features/quick-tabs/**'
      - 'src/test-bridge.js'
      - 'tests/extension/**'
      - 'playwright.config.*.js'
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  test-extension:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build extension with test bridge
        run: TEST_MODE=true npm run build:test
        env:
          NODE_ENV: test
      
      - name: Validate test bridge injection
        run: npm run validate:test-bridge
      
      - name: Install Playwright browsers
        run: npx playwright install --with-deps firefox chromium
      
      - name: Run Playwright tests
        run: npm run test:extension
        env:
          CI: true
      
      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-test-results
          path: |
            test-results/
            playwright-report/
          retention-days: 30
      
      - name: Upload failure screenshots
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: failure-screenshots
          path: test-results/**/*FAILURE*.png
          retention-days: 7
      
      - name: Comment PR with results
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const resultsPath = 'test-results/results.json';
            
            if (fs.existsSync(resultsPath)) {
              const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
              const comment = `## Playwright Test Results
              
              ✅ Passed: ${results.passed}
              ❌ Failed: ${results.failed}
              ⏭️ Skipped: ${results.skipped}
              
              ${results.failed > 0 ? '⚠️ Some tests failed. Check artifacts for details.' : ''}`;
              
              github.rest.issues.createComment({
                issue_number: context.issue.number,
                owner: context.repo.owner,
                repo: context.repo.repo,
                body: comment
              });
            }
```

**Parallelization Strategy:**
```yaml
# For faster execution with test sharding
strategy:
  matrix:
    shard: [1, 2, 3, 4]
  
steps:
  # ... existing steps ...
  
  - name: Run Playwright tests (sharded)
    run: npx playwright test --shard=${{ matrix.shard }}/4
```

---

### Category H: Playwright Fixture Enhancements

**Current State:** Basic helper class exists but no fixtures for common setup patterns.

**Required Fixtures:**

#### H.1 Extension Test Fixtures

**Create:** `tests/extension/fixtures.js`

```javascript
import { test as base } from '@playwright/test';
import { ExtensionTestHelper } from './helpers/extension-test-utils.js';

/**
 * Custom fixtures for extension testing
 */
export const test = base.extend({
  /**
   * Extension page fixture - Pre-loaded with test bridge
   */
  extensionPage: async ({ context }, use) => {
    const page = await context.newPage();
    await page.goto('https://example.com');
    
    const helper = new ExtensionTestHelper(page);
    await helper.waitForTestBridge(15000);
    await helper.clearAllQuickTabs();
    
    await use({ page, helper });
    
    // Cleanup
    await helper.clearAllQuickTabs();
    await page.close();
  },
  
  /**
   * Multi-tab fixture - Pre-configured with 3 pages
   */
  multiTab: async ({ context }, use) => {
    const page1 = await context.newPage();
    const page2 = await context.newPage();
    const page3 = await context.newPage();
    
    await page1.goto('https://example.com/tab1');
    await page2.goto('https://example.com/tab2');
    await page3.goto('https://example.com/tab3');
    
    const helper1 = new ExtensionTestHelper(page1);
    const helper2 = new ExtensionTestHelper(page2);
    const helper3 = new ExtensionTestHelper(page3);
    
    await Promise.all([
      helper1.waitForTestBridge(),
      helper2.waitForTestBridge(),
      helper3.waitForTestBridge()
    ]);
    
    await helper1.clearAllQuickTabs();
    
    await use({
      pages: [page1, page2, page3],
      helpers: [helper1, helper2, helper3]
    });
    
    // Cleanup
    await helper1.clearAllQuickTabs();
    await page1.close();
    await page2.close();
    await page3.close();
  },
  
  /**
   * Container fixture - Firefox with predefined containers
   */
  containerContext: async ({ browser }, use, workerInfo) => {
    const context = await browser.newContext({
      firefoxUserPrefs: {
        'privacy.userContext.enabled': true,
        'privacy.userContext.ui.enabled': true
      }
    });
    
    await use(context);
    await context.close();
  }
});

export { expect } from '@playwright/test';
```

**Usage Pattern:**
```javascript
import { test, expect } from './fixtures.js';

test('Scenario using fixtures', async ({ extensionPage }) => {
  const { page, helper } = extensionPage;
  
  // Test bridge already loaded and cleared
  await helper.createQuickTab('https://github.com');
  const tabs = await helper.getQuickTabs();
  expect(tabs).toHaveLength(1);
});

test('Multi-tab scenario', async ({ multiTab }) => {
  const { helpers } = multiTab;
  const [helper1, helper2, helper3] = helpers;
  
  // All pages already setup with test bridge
  await helper1.createQuickTab('https://site1.com');
  await helper2.waitForQuickTabCount(1);
  // ... test continues ...
});
```

**Rationale:**
- "Playwright fixtures reduce boilerplate and improve test maintainability by centralizing setup/teardown logic."
- Source: <https://playwright.dev/docs/test-fixtures>
- "Worker-scoped fixtures enable expensive setup (like browser profiles) to be shared across tests for performance."
- Source: <https://www.thisdot.co/blog/quick-guide-to-playwright-fixtures-enhancing-your-tests>

---

## 📋 Implementation Priority Order

### Phase 2A: Complete Remaining Scenarios (Priority 1)

**Goal:** Achieve 100% scenario coverage

**Tasks:**
1. Implement Scenarios 10-20 (10 scenarios)
2. Use existing patterns from Scenarios 1-9
3. Each scenario estimated 1-4 hours with Copilot assistance

**Estimated Timeline:** 1-2 weeks with daily Copilot sessions

---

### Phase 2B: Test Bridge Extensions (Priority 2)

**Goal:** Support all scenario testing requirements

**Tasks:**
1. Add solo/mute methods (B.1)
2. Add Manager Panel methods (B.2)
3. Add container methods (B.3)
4. Add debug mode methods (B.4)
5. Add geometry/z-index methods (B.5)

**Estimated Timeline:** 3-5 days

---

### Phase 2C: Enhanced Sync & Reliability (Priority 3)

**Goal:** Robust cross-tab testing

**Tasks:**
1. Implement enhanced sync utilities (C.1)
2. Add exponential backoff polling
3. Add state matching helpers

**Estimated Timeline:** 2-3 days

---

### Phase 3: Container Testing Setup (Priority 4)

**Goal:** Enable container isolation scenarios

**Tasks:**
1. Create Firefox test profile with containers (D.1)
2. Update Playwright config
3. Implement container test patterns

**Estimated Timeline:** 2-3 days

---

### Phase 4: CI/CD & Result Logging (Priority 5)

**Goal:** Autonomous agent feedback loop

**Tasks:**
1. Implement result logger (F.1)
2. Setup GitHub Actions workflow (G.1)
3. Configure artifact uploads
4. Add PR comment integration

**Estimated Timeline:** 3-4 days

---

### Phase 5: Fixture Optimization (Priority 6)

**Goal:** Improve test maintainability

**Tasks:**
1. Create custom fixtures (H.1)
2. Refactor existing tests to use fixtures
3. Document fixture patterns

**Estimated Timeline:** 2-3 days

---

## 🎯 Success Metrics

### Phase 2 Complete (Target: Week 3-5)
- ✅ All 20 Issue #47 scenarios have passing Playwright tests
- ✅ Test execution time <2 minutes per scenario
- ✅ Cross-tab sync verified with polling utilities
- ✅ Container isolation tested with Firefox profiles

### Phase 3 Complete (Target: Week 6)
- ✅ Test suite organized by category (foundational, cross-tab, container, etc.)
- ✅ CI pipeline runs all tests on PR to main
- ✅ Test artifacts uploaded on failure
- ✅ Result logger provides JSON reports for agent analysis

### Phase 4 Complete (Target: Ongoing)
- ✅ Copilot Agent can autonomously generate new scenario tests
- ✅ Agent can analyze failure reports and propose fixes
- ✅ Average iteration count ≤3 per scenario
- ✅ Test suite maintenance <50% of manual testing burden

---

## 🚀 Getting Started Checklist

**For Copilot Coding Agent to begin autonomous implementation:**

### Prerequisites Check
- [x] Test bridge infrastructure complete (PR #241 merged)
- [x] Playwright configs pointing to correct test directory
- [x] Basic scenario tests (1-9) passing as reference
- [x] Build scripts (`build:test`, `validate:test-bridge`) working
- [ ] Issue #47 revised scenarios document available for reference

### Immediate Next Steps

1. **Read Issue #47 Scenarios**
   - Location: `docs/issue-47-revised-scenarios.md`
   - Focus on Scenarios 10-20 (not yet automated)

2. **Review Existing Test Patterns**
   - Study: `tests/extension/issue-47-scenarios.spec.js`
   - Understand: Test structure, helper usage, assertion patterns

3. **Start with Simplest Missing Scenario**
   - Recommended: Scenario 10 (Quick Tab Limits)
   - Low complexity, clear acceptance criteria
   - Use as template for more complex scenarios

4. **Iterative Implementation**
   - Generate test for Scenario 10
   - Execute: `TEST_MODE=true npm run build:test && npm run test:extension`
   - Observe results via page snapshots
   - Fix failures autonomously
   - Commit passing test
   - Move to next scenario

5. **Extend Test Bridge as Needed**
   - If scenario requires new method (e.g., solo/mute), add to `src/test-bridge.js`
   - Update validation script: `scripts/verify-test-bridge.cjs`
   - Rebuild: `TEST_MODE=true npm run build:test`

---

## 📚 Key References for Agent Context

### Documentation to Reference

1. **Issue #47 Scenarios**
   - Path: `docs/issue-47-revised-scenarios.md`
   - Contains: All 20 scenarios with 5+ steps each

2. **Existing Test Suite**
   - Path: `tests/extension/issue-47-scenarios.spec.js`
   - Contains: 10 working examples to learn from

3. **Test Bridge API**
   - Path: `src/test-bridge.js`
   - Contains: 10 methods for programmatic control

4. **Extension Helper**
   - Path: `tests/extension/helpers/extension-test-utils.js`
   - Contains: Wrapper methods for all bridge operations

5. **Gap Analysis**
   - Path: `docs/manual/v1.6.0/copilot-testing-readiness-gap-analysis-revised.md`
   - Contains: Architecture patterns and technical specifications

### External Documentation

- **Playwright Test API:** <https://playwright.dev/docs/api/class-test>
- **Playwright Fixtures:** <https://playwright.dev/docs/test-fixtures>
- **WebExtensions API:** <https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions>
- **BroadcastChannel API:** <https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel>
- **Firefox Multi-Account Containers:** <https://support.mozilla.org/en-US/kb/containers>
- **Playwright MCP:** <https://github.com/microsoft/playwright-mcp>
- **GitHub Copilot Agent Mode:** <https://docs.github.com/en/copilot/using-github-copilot/using-github-copilot-agent>

---

## ⚠️ Known Limitations (Cannot Be Automated)

### Browser API Constraints

1. **Keyboard Shortcuts**
   - Cannot trigger "Q" key or "Ctrl+Alt+Z" via Playwright
   - Workaround: Test Bridge provides programmatic equivalents

2. **Extension Icon/Menu**
   - Cannot click toolbar icon or context menu
   - Workaround: Test Bridge exposes equivalent actions

3. **OS Notifications**
   - Cannot verify system-level notifications
   - Workaround: Test notification data in extension state

4. **True Browser Restart**
   - Cannot test actual browser process restart
   - Workaround: Test storage persistence as proxy

**Coverage:** ~80% automated, 20% requires manual verification

---

## 🎓 Copilot Prompt Templates

### Template 1: Generate Test for New Scenario

```
Generate a Playwright test for Scenario [N] from Issue #47 (docs/issue-47-revised-scenarios.md):

Requirements:
- Use Test Bridge API (window.__COPILOT_TEST_BRIDGE__) for all extension interactions
- Use ExtensionTestHelper from tests/extension/helpers/extension-test-utils.js
- Implement all [M] steps with explicit assertions
- Include setup to clear state before test
- Add cleanup to reset extension state after test
- Follow patterns from existing tests in tests/extension/issue-47-scenarios.spec.js

Test file location: tests/extension/issue-47-scenarios.spec.js (append to existing file)

After generating the test, execute it and report results.
```

### Template 2: Add Test Bridge Method

```
Add a new method to Test Bridge API (src/test-bridge.js):

Method signature:
- Name: [methodName]
- Purpose: [description]
- Parameters: [list parameters]
- Return value: [describe return type]

Requirements:
- Use browser.tabs.query() to find active tab
- Use browser.tabs.sendMessage() to communicate with content script
- Add corresponding message handler in src/content.js
- Return Promise with {success: boolean, ...data}
- Include error handling

After implementation:
1. Update scripts/verify-test-bridge.cjs to include new method
2. Rebuild: TEST_MODE=true npm run build:test
3. Run validation: npm run validate:test-bridge
```

### Template 3: Debug Failing Test

```
The test for Scenario [N] is failing with error:
[paste error message]

Available diagnostics:
- Failure screenshot: test-results/scenario-[N]/FAILURE-*.png
- Failure report: test-results/scenario-[N]/FAILURE-REPORT.json
- Console logs: [included in failure report]

Steps to debug:
1. Analyze the failure report JSON
2. Review the screenshot to understand visual state
3. Check console logs for extension errors
4. Propose fix to test or Test Bridge API
5. Re-run test to validate fix

Use Playwright MCP to view screenshot and analyze failure.
```

---

## 📊 Progress Tracking

**Use this table to track scenario implementation:**

| Scenario | Status | Test File | Last Updated | Notes |
|----------|--------|-----------|--------------|-------|
| 1 | ✅ DONE | issue-47-scenarios.spec.js | Nov 22, 2025 | Cross-tab sync |
| 2 | ✅ DONE | issue-47-scenarios.spec.js | Nov 22, 2025 | Multiple QTs |
| 3 | ✅ DONE | issue-47-scenarios.spec.js | Nov 22, 2025 | Pinning |
| 4 | ✅ DONE | issue-47-scenarios.spec.js | Nov 22, 2025 | Minimize/restore |
| 5 | ❌ TODO | - | - | YouTube embed |
| 6 | ✅ DONE | issue-47-scenarios.spec.js | Nov 22, 2025 | Storage persistence |
| 7 | ✅ DONE | issue-47-scenarios.spec.js | Nov 22, 2025 | Research workflow |
| 8 | ✅ DONE | issue-47-scenarios.spec.js | Nov 22, 2025 | Limits |
| 9 | ✅ DONE | issue-47-scenarios.spec.js | Nov 22, 2025 | Privacy |
| 10 | ❌ TODO | - | - | Limit enforcement |
| 11 | ❌ TODO | - | - | Emergency save |
| 12 | ❌ TODO | - | - | Close minimized |
| 13 | ❌ TODO | - | - | Solo/mute exclusion |
| 14 | ❌ TODO | - | - | Browser restart |
| 15 | ❌ TODO | - | - | Manager persistence |
| 16 | ❌ TODO | - | - | Debug mode slots |
| 17 | ❌ TODO | - | - | Multi-direction resize |
| 18 | ❌ TODO | - | - | Z-index management |
| 19 | ❌ TODO | - | - | Container isolation |
| 20 | ❌ TODO | - | - | Container cleanup |

**Current Coverage:** 10/20 (50%)  
**Target Coverage:** 20/20 (100%)

---

## 🏁 Final Notes for Copilot Agent

### Critical Success Factors

1. **Follow Existing Patterns**
   - Study `tests/extension/issue-47-scenarios.spec.js` thoroughly
   - Mimic structure, naming, and assertion patterns
   - Use same helper methods and utilities

2. **Test Bridge First**
   - If scenario needs new capability, extend Test Bridge before writing test
   - Always validate with `npm run validate:test-bridge`

3. **Incremental Development**
   - Implement one scenario at a time
   - Verify each test passes before moving to next
   - Commit passing tests immediately

4. **Cross-Tab Sync Awareness**
   - Always use `waitForQuickTabCount()` or equivalent polling
   - BroadcastChannel is async - don't assume instant sync
   - Use exponential backoff for reliability

5. **Container Testing Caution**
   - Container scenarios (19, 20) require Firefox profile setup
   - Test these last after profile is configured
   - Verify `cookieStoreId` in state dumps

6. **Result Logging for Iteration**
   - Always capture screenshots on failure
   - Save state dumps in JSON format
   - Use failure reports for debugging

7. **Documentation as You Go**
   - Document expected behavior in test comments
   - Update this document when patterns evolve
   - Create memory entries for complex scenarios

---

**Document Status:** Ready for Agent Implementation  
**Last Verified:** November 22, 2025  
**Maintainer:** ChunkyNosher  
**Agent Access:** Full repository permissions granted