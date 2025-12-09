# Playwright Testing Migration Instructions for GitHub Copilot Coding Agent

**Target Repository:** copy-URL-on-hover_ChunkyEdition  
**Migration Goal:** Replace broken Xvfb+Chrome testing with playwright-webextext
Firefox testing  
**Expected Outcome:** Functional E2E tests that complete in 2-5 minutes instead
of timing out

---

## Overview

This document provides step-by-step instructions for migrating the Firefox
extension testing infrastructure from a broken Xvfb+Chrome setup to a working
playwright-webextext solution.

### Why This Migration Is Needed

**Current Problems:**

1. Tests attempt to load Firefox extension in Chrome (incompatible APIs)
2. Chrome process hangs waiting for extension that can't load
3. Xvfb adds unnecessary complexity and failure points
4. Tests timeout after waiting indefinitely
5. No meaningful error messages for debugging

**Solution Benefits:**

1. Native Firefox extension support via playwright-webextext
2. True headless mode (no Xvfb required)
3. Proper error handling and timeout protection
4. Tests complete in 2-5 minutes with clear pass/fail results
5. Works autonomously in GitHub Actions CI/CD

---

## Part 1: Install Required Dependencies

### Task 1.1: Update package.json

**File:** `package.json`

**Add to `devDependencies` section:**

```json
{
  "devDependencies": {
    "@playwright/test": "^1.40.0",
    "playwright": "^1.40.0",
    "playwright-webextext": "^1.0.0"
  }
}
```

**Add to `scripts` section:**

```json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:headed": "playwright test --headed",
    "test:e2e:debug": "playwright test --debug",
    "test:all": "npm run test:unit && npm run test:e2e"
  }
}
```

**After modifying, run:**

```bash
npm install
npx playwright install firefox --with-deps
```

---

## Part 2: Create Test Infrastructure

### Task 2.1: Create Directory Structure

**Create these directories:**

```
tests/e2e/
tests/e2e/scenarios/
tests/e2e/fixtures/
tests/e2e/helpers/
```

### Task 2.2: Create Playwright Configuration

**File:** `playwright.config.js` (create in project root)

```javascript
const { defineConfig, devices } = require('@playwright/test');

/**
 * Playwright configuration for Firefox extension testing
 * Uses playwright-webextext for native Firefox extension support
 */
module.exports = defineConfig({
  // Test directory
  testDir: './tests/e2e',

  // Maximum time one test can run
  timeout: 30 * 1000, // 30 seconds per test

  // Test execution settings
  fullyParallel: false, // Run tests sequentially (extensions share state)
  forbidOnly: !!process.env.CI, // Fail CI if test.only() left in code
  retries: process.env.CI ? 2 : 0, // Retry flaky tests in CI
  workers: 1, // Single worker (extension state isolation)

  // Reporter configuration
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['list']
  ],

  // Global test settings
  use: {
    // Base URL for navigation
    baseURL: 'about:blank',

    // Capture trace on first retry
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on failure
    video: 'retain-on-failure',

    // Browser viewport
    viewport: { width: 1920, height: 1080 },

    // Action timeout
    actionTimeout: 10 * 1000 // 10 seconds
  },

  // Projects (browser configurations)
  projects: [
    {
      name: 'firefox-extension',
      use: {
        ...devices['Desktop Firefox'],
        // CRITICAL: Firefox extensions work in true headless mode
        headless: true
      }
    }
  ],

  // Output directories
  outputDir: 'test-results'
});
```

### Task 2.3: Create Extension Test Fixture

**File:** `tests/e2e/fixtures/extension.js` (create new file)

```javascript
import { test as base, firefox } from '@playwright/test';
import { withExtension } from 'playwright-webextext';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Custom test fixture that loads the Firefox extension
 * and provides access to extension-enabled browser context
 */
export const test = base.extend({
  /**
   * Extension-enabled browser context
   * Automatically loads the extension before tests
   */
  extensionContext: async ({}, use) => {
    // Path to built extension
    const extPath = path.join(__dirname, '../../../dist');

    // Verify extension build exists
    const fs = require('fs');
    if (!fs.existsSync(path.join(extPath, 'manifest.json'))) {
      throw new Error(
        `Extension not found at ${extPath}. Run 'npm run build:prod' first.`
      );
    }

    // Create Firefox browser with extension loaded
    const browserTypeWithExt = withExtension(firefox, extPath);

    // Launch browser in TRUE HEADLESS mode (no Xvfb needed!)
    const browser = await browserTypeWithExt.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });

    // Create new context
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 }
    });

    // Provide context to test
    await use(context);

    // Cleanup
    await context.close();
    await browser.close();
  },

  /**
   * Page with extension loaded and Test Bridge ready
   */
  page: async ({ extensionContext }, use) => {
    const page = await extensionContext.newPage();

    // Wait for Test Bridge API to be available
    try {
      await page.waitForFunction(
        () => typeof window.__COPILOT_TEST_BRIDGE__ !== 'undefined',
        { timeout: 5000 }
      );
    } catch (error) {
      throw new Error(
        'Test Bridge API not found. Ensure extension is built with TEST_MODE=true'
      );
    }

    await use(page);
    await page.close();
  }
});

// Re-export expect
export { expect } from '@playwright/test';
```

### Task 2.4: Create Test Helper Utilities

**File:** `tests/e2e/helpers/quick-tabs.js` (create new file)

```javascript
/**
 * Helper utilities for Quick Tabs testing
 */

/**
 * Create a Quick Tab via Test Bridge API
 * @param {Page} page - Playwright page object
 * @param {string} url - URL to load in Quick Tab
 * @returns {Promise<number>} - Slot number of created Quick Tab
 */
export async function createQuickTab(page, url) {
  const slotNumber = await page.evaluate(urlToLoad => {
    return window.__COPILOT_TEST_BRIDGE__.createQuickTab(urlToLoad);
  }, url);

  // Wait for creation to complete
  await page.waitForTimeout(100);

  return slotNumber;
}

/**
 * Get all Quick Tabs from current page
 * @param {Page} page - Playwright page object
 * @returns {Promise<Array>} - Array of Quick Tab objects
 */
export async function getQuickTabs(page) {
  return await page.evaluate(() => {
    return window.__COPILOT_TEST_BRIDGE__.getQuickTabs();
  });
}

/**
 * Get specific Quick Tab by slot number
 * @param {Page} page - Playwright page object
 * @param {number} slotNumber - Slot number to retrieve
 * @returns {Promise<Object|null>} - Quick Tab object or null
 */
export async function getQuickTab(page, slotNumber) {
  const quickTabs = await getQuickTabs(page);
  return quickTabs.find(qt => qt.slotNumber === slotNumber) || null;
}

/**
 * Update Quick Tab position/size
 * @param {Page} page - Playwright page object
 * @param {number} slotNumber - Slot number to update
 * @param {Object} updates - Updates object { position?, size? }
 */
export async function updateQuickTab(page, slotNumber, updates) {
  await page.evaluate(
    ({ slot, data }) => {
      return window.__COPILOT_TEST_BRIDGE__.updateQuickTab(slot, data);
    },
    { slot: slotNumber, data: updates }
  );

  // Wait for update to propagate
  await page.waitForTimeout(100);
}

/**
 * Close Quick Tab
 * @param {Page} page - Playwright page object
 * @param {number} slotNumber - Slot number to close
 */
export async function closeQuickTab(page, slotNumber) {
  await page.evaluate(slot => {
    return window.__COPILOT_TEST_BRIDGE__.closeQuickTab(slot);
  }, slotNumber);

  await page.waitForTimeout(100);
}

/**
 * Set Quick Tab to Solo mode
 * @param {Page} page - Playwright page object
 * @param {number} slotNumber - Slot number
 * @param {number} tabId - Tab ID to solo on
 */
export async function setSoloMode(page, slotNumber, tabId) {
  await page.evaluate(
    ({ slot, tab }) => {
      return window.__COPILOT_TEST_BRIDGE__.setSoloMode(slot, tab);
    },
    { slot: slotNumber, tab: tabId }
  );

  await page.waitForTimeout(100);
}

/**
 * Set Quick Tab to Mute mode
 * @param {Page} page - Playwright page object
 * @param {number} slotNumber - Slot number
 * @param {number} tabId - Tab ID to mute on
 */
export async function setMuteMode(page, slotNumber, tabId) {
  await page.evaluate(
    ({ slot, tab }) => {
      return window.__COPILOT_TEST_BRIDGE__.setMuteMode(slot, tab);
    },
    { slot: slotNumber, tab: tabId }
  );

  await page.waitForTimeout(100);
}

/**
 * Verify Quick Tab visibility on current page
 * @param {Page} page - Playwright page object
 * @param {number} slotNumber - Slot number
 * @returns {Promise<boolean>} - True if visible
 */
export async function isQuickTabVisible(page, slotNumber) {
  return await page.evaluate(slot => {
    return window.__COPILOT_TEST_BRIDGE__.getQuickTabVisibility(slot);
  }, slotNumber);
}

/**
 * Wait for cross-tab sync to complete
 * @param {Page} page - Playwright page object
 * @param {number} ms - Milliseconds to wait (default: 200ms)
 */
export async function waitForSync(page, ms = 200) {
  await page.waitForTimeout(ms);
}
```

---

## Part 3: Implement Example Test Scenarios

### Task 3.1: Create Scenario 1 Test

**File:** `tests/e2e/scenarios/scenario-01-basic-creation.spec.js` (create new
file)

```javascript
import { test, expect } from '../fixtures/extension.js';
import {
  createQuickTab,
  getQuickTabs,
  updateQuickTab,
  waitForSync
} from '../helpers/quick-tabs.js';

/**
 * Scenario 1: Basic Quick Tab Creation & Cross-Tab Sync
 *
 * Tests:
 * 1. Quick Tab creation
 * 2. Quick Tab persistence across tabs
 * 3. Position/size synchronization
 */
test.describe('Scenario 1: Basic Quick Tab Creation & Cross-Tab Sync', () => {
  test('should create Quick Tab and sync across tabs', async ({
    extensionContext
  }) => {
    // Step 1: Open WP 1 (Wikipedia Tab 1)
    const page1 = await extensionContext.newPage();
    await page1.goto('https://en.wikipedia.org/wiki/Main_Page');

    // Wait for Test Bridge
    await page1.waitForFunction(
      () => typeof window.__COPILOT_TEST_BRIDGE__ !== 'undefined'
    );

    // Step 2: Open WP QT 1 (create Quick Tab)
    const slotNumber = await createQuickTab(page1, 'https://example.com');
    expect(slotNumber).toBe(1);

    // Step 3: Verify QT 1 appears in WP 1
    const quickTabs = await getQuickTabs(page1);
    expect(quickTabs).toHaveLength(1);
    expect(quickTabs[0].slotNumber).toBe(1);

    const originalPosition = quickTabs[0].position;
    const originalSize = quickTabs[0].size;

    // Step 4: Open YT 1 (YouTube Tab 1)
    const page2 = await extensionContext.newPage();
    await page2.goto('https://www.youtube.com');

    await page2.waitForFunction(
      () => typeof window.__COPILOT_TEST_BRIDGE__ !== 'undefined'
    );

    // Step 5: Verify QT 1 appears in YT 1 at same position/size
    await waitForSync(page2);

    const quickTabsYT = await getQuickTabs(page2);
    expect(quickTabsYT).toHaveLength(1);
    expect(quickTabsYT[0].position.x).toBe(originalPosition.x);
    expect(quickTabsYT[0].position.y).toBe(originalPosition.y);
    expect(quickTabsYT[0].size.width).toBe(originalSize.width);
    expect(quickTabsYT[0].size.height).toBe(originalSize.height);

    // Step 6: Move/resize QT 1 in YT 1
    const newPosition = {
      x: 100,
      y: 200
    };
    const newSize = {
      width: 500,
      height: 400
    };

    await updateQuickTab(page2, 1, {
      position: newPosition,
      size: newSize
    });

    // Step 7: Switch back to WP 1, verify sync
    await waitForSync(page1);

    const quickTabsWPUpdated = await getQuickTabs(page1);
    expect(quickTabsWPUpdated[0].position.x).toBe(newPosition.x);
    expect(quickTabsWPUpdated[0].position.y).toBe(newPosition.y);
    expect(quickTabsWPUpdated[0].size.width).toBe(newSize.width);
    expect(quickTabsWPUpdated[0].size.height).toBe(newSize.height);

    // Cleanup
    await page1.close();
    await page2.close();
  });
});
```

### Task 3.2: Create Scenario 2 Test

**File:** `tests/e2e/scenarios/scenario-02-multiple-quicktabs.spec.js` (create
new file)

```javascript
import { test, expect } from '../fixtures/extension.js';
import {
  createQuickTab,
  getQuickTabs,
  updateQuickTab,
  waitForSync
} from '../helpers/quick-tabs.js';

/**
 * Scenario 2: Multiple Quick Tabs with Cross-Tab Sync
 */
test.describe('Scenario 2: Multiple Quick Tabs', () => {
  test('should handle multiple Quick Tabs with independent states', async ({
    extensionContext
  }) => {
    // Step 1: Open WP 1
    const page1 = await extensionContext.newPage();
    await page1.goto('https://en.wikipedia.org/wiki/Main_Page');
    await page1.waitForFunction(() => window.__COPILOT_TEST_BRIDGE__);

    // Step 2: Open WP QT 1
    await createQuickTab(page1, 'https://example.com');

    // Step 3: Open YT 1
    const page2 = await extensionContext.newPage();
    await page2.goto('https://www.youtube.com');
    await page2.waitForFunction(() => window.__COPILOT_TEST_BRIDGE__);

    await waitForSync(page2);

    // Step 4: Open YT QT 2 in YT 1
    await createQuickTab(page2, 'https://github.com');

    // Step 5: Verify both QTs in YT 1
    const quickTabsYT = await getQuickTabs(page2);
    expect(quickTabsYT).toHaveLength(2);
    expect(quickTabsYT[0].slotNumber).toBe(1);
    expect(quickTabsYT[1].slotNumber).toBe(2);

    // Step 6: Switch to WP 1, verify both QTs synced
    await waitForSync(page1);

    const quickTabsWP = await getQuickTabs(page1);
    expect(quickTabsWP).toHaveLength(2);

    // Step 7: Move QT 1 to top-left, QT 2 to bottom-right
    await updateQuickTab(page1, 1, {
      position: { x: 20, y: 20 }
    });

    await updateQuickTab(page1, 2, {
      position: { x: 1400, y: 660 }
    });

    // Step 8: Switch to YT 1, verify positions synced
    await waitForSync(page2);

    const quickTabsYTUpdated = await getQuickTabs(page2);
    expect(quickTabsYTUpdated[0].position.x).toBe(20);
    expect(quickTabsYTUpdated[0].position.y).toBe(20);
    expect(quickTabsYTUpdated[1].position.x).toBe(1400);
    expect(quickTabsYTUpdated[1].position.y).toBe(660);

    // Cleanup
    await page1.close();
    await page2.close();
  });
});
```

### Task 3.3: Create Scenario 3 Test

**File:** `tests/e2e/scenarios/scenario-03-solo-mode.spec.js` (create new file)

```javascript
import { test, expect } from '../fixtures/extension.js';
import {
  createQuickTab,
  setSoloMode,
  isQuickTabVisible,
  waitForSync
} from '../helpers/quick-tabs.js';

/**
 * Scenario 3: Solo Mode (Pin to Specific Tab)
 */
test.describe('Scenario 3: Solo Mode', () => {
  test('should show Quick Tab only on designated tab', async ({
    extensionContext
  }) => {
    // Step 1: Open WP 1
    const page1 = await extensionContext.newPage();
    await page1.goto('https://en.wikipedia.org/wiki/Main_Page');
    await page1.waitForFunction(() => window.__COPILOT_TEST_BRIDGE__);

    // Step 2: Open WP QT 1
    await createQuickTab(page1, 'https://example.com');

    // Get tab ID for page1
    const tabId1 = await page1.evaluate(() => {
      return browser.tabs.getCurrent().then(tab => tab.id);
    });

    // Step 3: Solo QT 1 (pin to WP 1)
    await setSoloMode(page1, 1, tabId1);

    // Step 4: Verify QT 1 visible only in WP 1
    const isVisible1 = await isQuickTabVisible(page1, 1);
    expect(isVisible1).toBe(true);

    // Step 5: Open YT 1
    const page2 = await extensionContext.newPage();
    await page2.goto('https://www.youtube.com');
    await page2.waitForFunction(() => window.__COPILOT_TEST_BRIDGE__);

    await waitForSync(page2);

    // Step 6: Verify QT 1 does NOT appear in YT 1
    const isVisible2 = await isQuickTabVisible(page2, 1);
    expect(isVisible2).toBe(false);

    // Step 7: Open GH 1
    const page3 = await extensionContext.newPage();
    await page3.goto('https://github.com');
    await page3.waitForFunction(() => window.__COPILOT_TEST_BRIDGE__);

    await waitForSync(page3);

    // Step 8: Verify QT 1 does NOT appear in GH 1
    const isVisible3 = await isQuickTabVisible(page3, 1);
    expect(isVisible3).toBe(false);

    // Step 9: Switch back to WP 1, verify still visible
    const isVisibleReturn = await isQuickTabVisible(page1, 1);
    expect(isVisibleReturn).toBe(true);

    // Cleanup
    await page1.close();
    await page2.close();
    await page3.close();
  });
});
```

**Note:** Continue implementing remaining scenarios (4-20) from
`docs/manual/v1.6.0/issue-47-revised-scenarios.md` using the same pattern.

---

## Part 4: Implement Test Bridge API

### Task 4.1: Create Test Bridge Class

**File:** `src/features/quick-tabs/test-bridge/TestBridge.js` (create new file)

```javascript
/**
 * Test Bridge API for Playwright E2E Testing
 * Exposes internal extension state for programmatic testing
 * Only active when TEST_MODE environment variable is set
 */

class TestBridge {
  constructor(quickTabsManager) {
    this.manager = quickTabsManager;

    // Only expose in test mode
    if (process.env.TEST_MODE === 'true') {
      window.__COPILOT_TEST_BRIDGE__ = this;
      console.log('[TestBridge] API exposed for testing');
    }
  }

  /**
   * Create a new Quick Tab
   * @param {string} url - URL to load
   * @returns {Promise<number>} - Slot number of created Quick Tab
   */
  async createQuickTab(url) {
    const quickTab = await this.manager.createQuickTab({ url });
    return quickTab.slotNumber;
  }

  /**
   * Get all Quick Tabs
   * @returns {Array<Object>} - Array of Quick Tab objects
   */
  getQuickTabs() {
    return this.manager.getAllQuickTabs().map(qt => ({
      slotNumber: qt.slotNumber,
      url: qt.url,
      position: { ...qt.position },
      size: { ...qt.size },
      minimized: qt.minimized,
      soloMode: qt.soloMode,
      muteMode: qt.muteMode
    }));
  }

  /**
   * Update Quick Tab properties
   * @param {number} slotNumber - Slot number
   * @param {Object} updates - Updates object
   */
  async updateQuickTab(slotNumber, updates) {
    await this.manager.updateQuickTab(slotNumber, updates);
  }

  /**
   * Close Quick Tab
   * @param {number} slotNumber - Slot number to close
   */
  async closeQuickTab(slotNumber) {
    await this.manager.closeQuickTab(slotNumber);
  }

  /**
   * Set Solo mode
   * @param {number} slotNumber - Slot number
   * @param {number} tabId - Tab ID to solo on
   */
  async setSoloMode(slotNumber, tabId) {
    await this.manager.setSoloMode(slotNumber, tabId);
  }

  /**
   * Set Mute mode
   * @param {number} slotNumber - Slot number
   * @param {number} tabId - Tab ID to mute on
   */
  async setMuteMode(slotNumber, tabId) {
    await this.manager.setMuteMode(slotNumber, tabId);
  }

  /**
   * Get Quick Tab visibility status
   * @param {number} slotNumber - Slot number
   * @returns {boolean} - True if visible on current tab
   */
  getQuickTabVisibility(slotNumber) {
    const qt = this.manager.getQuickTab(slotNumber);
    if (!qt) return false;

    return this.manager.isQuickTabVisible(qt);
  }

  /**
   * Get current tab ID
   * @returns {Promise<number>} - Current tab ID
   */
  async getCurrentTabId() {
    const tab = await browser.tabs.getCurrent();
    return tab.id;
  }

  /**
   * Close all Quick Tabs
   */
  async closeAllQuickTabs() {
    await this.manager.closeAll();
  }

  /**
   * Minimize Quick Tab
   * @param {number} slotNumber - Slot number to minimize
   */
  async minimizeQuickTab(slotNumber) {
    await this.manager.minimizeQuickTab(slotNumber);
  }

  /**
   * Restore minimized Quick Tab
   * @param {number} slotNumber - Slot number to restore
   */
  async restoreQuickTab(slotNumber) {
    await this.manager.restoreQuickTab(slotNumber);
  }

  /**
   * Open Manager Panel
   */
  async openManager() {
    await this.manager.openManagerPanel();
  }

  /**
   * Close Manager Panel
   */
  async closeManager() {
    await this.manager.closeManagerPanel();
  }

  /**
   * Get Manager Panel state
   * @returns {Object} - Manager state object
   */
  getManagerState() {
    return this.manager.getManagerState();
  }

  /**
   * Get storage state (for debugging)
   * @returns {Promise<Object>} - Storage state
   */
  async getStorageState() {
    return await this.manager.getStorageState();
  }
}

export default TestBridge;
```

### Task 4.2: Initialize Test Bridge in Quick Tabs Manager

**File:** `src/features/quick-tabs/index.js`

**Add this import at the top:**

```javascript
import TestBridge from './test-bridge/TestBridge.js';
```

**Add this AFTER QuickTabsManager initialization (find where `quickTabsManager`
is created):**

```javascript
// Existing code:
const quickTabsManager =
  new QuickTabsManager(/* ... existing parameters ... */);

// ADD THIS:
// Initialize Test Bridge in test mode
if (process.env.TEST_MODE === 'true') {
  new TestBridge(quickTabsManager);
  console.log('[Quick Tabs] Test Bridge initialized');
}
```

### Task 4.3: Configure Webpack to Inject TEST_MODE

**File:** `webpack.config.js`

**Find the `plugins` array and add:**

```javascript
const webpack = require('webpack');

module.exports = {
  // ... existing configuration ...

  plugins: [
    // ... existing plugins ...

    // ADD THIS:
    new webpack.DefinePlugin({
      'process.env.TEST_MODE': JSON.stringify(process.env.TEST_MODE || 'false')
    })
  ]
};
```

---

## Part 5: Update GitHub Actions Workflows

### Task 5.1: Archive Old Broken Workflow

**File:** `.github/workflows/playwright-extension-tests.yml`

**Action:** Rename this file to
`.github/workflows/playwright-extension-tests.yml.OLD`

**Add this comment at the top of the renamed file:**

```yaml
# DEPRECATED: This workflow is replaced by e2e-extension-tests.yml
# Kept for reference only. Do not use.
#
# Issues with this workflow:
# - Attempts to load Firefox extension in Chrome (incompatible)
# - Uses unnecessary Xvfb overhead
# - Tests hang and timeout
# - No proper error handling
```

### Task 5.2: Create New E2E Testing Workflow

**File:** `.github/workflows/e2e-extension-tests.yml` (create new file)

```yaml
name: 'E2E Extension Tests'

on:
  workflow_dispatch:
    inputs:
      test_scenario:
        description: 'Specific test to run (optional, runs all if empty)'
        required: false
        type: string
  pull_request:
    branches: [main, develop]
    paths:
      - 'src/**'
      - 'tests/e2e/**'
      - 'dist/**'
      - 'manifest.json'
      - 'playwright.config.js'
  push:
    branches: [main]

jobs:
  test-firefox-extension:
    name: 'Test Firefox Extension with Playwright'
    runs-on: ubuntu-latest

    steps:
      # ============================================
      # Step 1: Checkout Code
      # ============================================
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      # ============================================
      # Step 2: Setup Node.js
      # ============================================
      - name: Setup Node.js 22
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      # ============================================
      # Step 3: Install Dependencies
      # ============================================
      - name: Install dependencies
        run: npm ci

      # ============================================
      # Step 4: Install Playwright with Firefox
      # NO XVFB NEEDED - Firefox extensions work in true headless!
      # ============================================
      - name: Install Playwright browsers
        run: npx playwright install firefox --with-deps

      # ============================================
      # Step 5: Build Extension with Test Mode
      # ============================================
      - name: Build extension (production with test mode)
        run: npm run build:prod
        env:
          TEST_MODE: true

      # ============================================
      # Step 6: Validate Build Output
      # ============================================
      - name: Validate build output
        run: |
          echo "Validating build output..."

          if [ ! -f dist/manifest.json ]; then
            echo "❌ ERROR: dist/manifest.json not found!"
            exit 1
          fi

          if [ ! -f dist/content.js ]; then
            echo "❌ ERROR: dist/content.js not found!"
            exit 1
          fi

          if [ ! -f dist/background.js ]; then
            echo "❌ ERROR: dist/background.js not found!"
            exit 1
          fi

          echo "✅ All required files present in dist/"

      # ============================================
      # Step 7: Run Playwright E2E Tests
      # TRUE HEADLESS MODE - No Xvfb, no DISPLAY variable needed
      # ============================================
      - name: Run Playwright tests
        run: |
          if [ -n "${{ github.event.inputs.test_scenario }}" ]; then
            echo "Running specific test: ${{ github.event.inputs.test_scenario }}"
            npx playwright test --grep "${{ github.event.inputs.test_scenario }}"
          else
            echo "Running all E2E tests"
            npx playwright test
          fi
        env:
          CI: true

      # ============================================
      # Step 8: Upload Test Results (Always)
      # ============================================
      - name: Upload Playwright report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7

      # ============================================
      # Step 9: Upload Test Artifacts on Failure
      # ============================================
      - name: Upload test artifacts
        uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: test-failures
          path: |
            test-results/
            playwright-report/
          retention-days: 7

      # ============================================
      # Step 10: Comment PR with Results
      # ============================================
      - name: Comment PR with test results
        if: github.event_name == 'pull_request' && always()
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const resultsPath = 'test-results/results.json';

            if (!fs.existsSync(resultsPath)) {
              console.log('No results file found');
              return;
            }

            const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
            const { stats } = results;

            const body = `## 🧪 E2E Test Results

            - **Total Tests:** ${stats.expected + stats.unexpected + stats.flaky + stats.skipped}
            - **Passed:** ✅ ${stats.expected}
            - **Failed:** ❌ ${stats.unexpected}
            - **Flaky:** ⚠️ ${stats.flaky}
            - **Skipped:** ⏭️ ${stats.skipped}
            - **Duration:** ${(stats.duration / 1000).toFixed(2)}s

            [View full report](https://github.com/${{ github.repository }}/actions/runs/${{ github.run_id }})
            `;

            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: body
            });
```

### Task 5.3: Update copilot-setup-steps.yml

**File:** `.github/workflows/copilot-setup-steps.yml`

**Find and REMOVE these sections entirely:**

1. **Remove Xvfb installation:**

```yaml
# DELETE THIS SECTION:
- name: Install Xvfb
  run: sudo apt-get update && sudo apt-get install -y xvfb
```

2. **Remove Chrome launch with Xvfb:**

```yaml
# DELETE THIS ENTIRE SECTION:
- name: Launch Chrome with extension
  run: |
    echo "Starting Chrome with extension loaded via Xvfb..."

    pkill -f chrome || true

    EXTENSION_PATH=$(pwd)/dist
    echo "Extension path: $EXTENSION_PATH"

    export DISPLAY=:99
    Xvfb :99 -screen 0 1920x1080x24 &
    sleep 2
    echo "✓ Xvfb started on display :99"

    google-chrome \
      --load-extension="$EXTENSION_PATH" \
      --disable-extensions-except="$EXTENSION_PATH" \
      --no-first-run \
      --no-default-browser-check \
      --no-sandbox \
      --disable-dev-shm-usage \
      --disable-gpu \
      --remote-debugging-port=9222 \
      --user-data-dir=$(mktemp -d) \
      --display=:99 \
      about:blank &

    sleep 5

    if pgrep -f chrome > /dev/null; then
      echo "✓ Chrome started successfully with extension"
    else
      echo "✗ Failed to start Chrome"
      exit 1
    fi
```

3. **Remove extension ID retrieval:**

```yaml
# DELETE THIS SECTION:
- name: Get extension ID
  id: get_extension_id
  run: |
    EXTENSION_ID=$(curl -s http://localhost:9222/json | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
    echo "extension_id=$EXTENSION_ID" >> $GITHUB_OUTPUT
    echo "✓ Extension ID: $EXTENSION_ID"
```

4. **Remove Chrome-specific Playwright config creation:**

```yaml
# DELETE THIS SECTION:
- name: Run Playwright tests with extension
  run: |
    echo "Running Playwright tests..."
    echo "Test scenario: ${{ github.event.inputs.test_scenario }}"

    cat > playwright.config.extension.js << 'EOF'
    const { defineConfig, devices } = require('@playwright/test');

    module.exports = defineConfig({
      testDir: './tests/extension',
      fullyParallel: false,
      forbidOnly: !!process.env.CI,
      retries: process.env.CI ? 2 : 0,
      workers: 1,
      reporter: 'html',
      use: {
        baseURL: 'http://localhost:9222',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
      },
      projects: [
        {
          name: 'chromium-extension',
          use: { 
            ...devices['Desktop Chrome'],
            connectOptions: {
              wsEndpoint: 'ws://localhost:9222/devtools/browser'
            }
          },
        },
      ],
    });
    EOF

    npx playwright test --config=playwright.config.extension.js || true
```

**REPLACE the removed sections with this simple code:**

```yaml
# ============================================
# Install Playwright with Firefox
# ============================================
- name: Install Playwright browsers
  run: npx playwright install firefox --with-deps

# ============================================
# Build Extension with Test Mode
# ============================================
- name: Build extension for testing
  run: npm run build:prod
  env:
    TEST_MODE: true

# ============================================
# Run E2E Tests (TRUE HEADLESS - No Xvfb!)
# ============================================
- name: Run extension E2E tests
  run: npx playwright test
  env:
    CI: true
```

**Important:** Do NOT modify the `timeout-minutes` setting in
copilot-setup-steps.yml. That controls how long the Copilot coding agent works
on the entire prompt, not just tests.

---

## Part 6: Verification and Testing

### Task 6.1: Local Verification Steps

**Run these commands locally to verify the setup:**

```bash
# 1. Install dependencies
npm install

# 2. Install Playwright Firefox
npx playwright install firefox --with-deps

# 3. Build extension with test mode
TEST_MODE=true npm run build:prod

# 4. Verify Test Bridge is included
grep -r "__COPILOT_TEST_BRIDGE__" dist/

# 5. Run single test to verify
npx playwright test scenario-01 --headed

# 6. Run all tests
npx playwright test

# 7. View test report
npx playwright show-report
```

**Expected successful output:**

```
Running 3 tests using 1 worker

  ✓ scenario-01-basic-creation.spec.js › should create Quick Tab and sync across tabs (5.2s)
  ✓ scenario-02-multiple-quicktabs.spec.js › should handle multiple Quick Tabs (6.8s)
  ✓ scenario-03-solo-mode.spec.js › should show Quick Tab only on designated tab (7.1s)

  3 passed (19.1s)
```

### Task 6.2: CI/CD Verification

After pushing changes to GitHub:

1. Go to GitHub repository → Actions tab
2. Find "E2E Extension Tests" workflow
3. Click "Run workflow" to trigger manually
4. Verify workflow completes successfully in 2-5 minutes
5. Check artifacts for test reports

**Expected CI/CD results:**

- ✅ Workflow starts immediately (no hanging)
- ✅ Firefox downloads in ~30 seconds
- ✅ Extension builds successfully
- ✅ Tests run and complete in 2-5 minutes
- ✅ Clear pass/fail results in artifacts
- ✅ No timeout errors

---

## Summary of Changes

### Files to CREATE:

1. `playwright.config.js` (project root)
2. `tests/e2e/fixtures/extension.js`
3. `tests/e2e/helpers/quick-tabs.js`
4. `tests/e2e/scenarios/scenario-01-basic-creation.spec.js`
5. `tests/e2e/scenarios/scenario-02-multiple-quicktabs.spec.js`
6. `tests/e2e/scenarios/scenario-03-solo-mode.spec.js`
7. `src/features/quick-tabs/test-bridge/TestBridge.js`
8. `.github/workflows/e2e-extension-tests.yml`

### Files to MODIFY:

1. `package.json` - Add dependencies and scripts
2. `webpack.config.js` - Add TEST_MODE injection
3. `src/features/quick-tabs/index.js` - Initialize Test Bridge
4. `.github/workflows/copilot-setup-steps.yml` - Simplify testing section

### Files to RENAME:

1. `.github/workflows/playwright-extension-tests.yml` →
   `.github/workflows/playwright-extension-tests.yml.OLD`

### Sections to DELETE from copilot-setup-steps.yml:

1. Xvfb installation steps
2. Chrome launch with Xvfb steps
3. Extension ID retrieval steps
4. Chrome-specific Playwright config creation

### Key Technology Changes:

- **Removed:** Chrome, Xvfb, remote debugging protocol
- **Added:** playwright-webextext, Firefox headless support, Test Bridge API
- **Result:** True headless testing that works in CI/CD

---

## Expected Outcomes

### Before Migration:

- ❌ Tests hang after 60 minutes
- ❌ Chrome can't load Firefox extension
- ❌ Xvfb adds complexity and failure points
- ❌ No meaningful error messages
- ❌ Copilot coding agent can't complete testing tasks

### After Migration:

- ✅ Tests complete in 2-5 minutes
- ✅ Native Firefox extension support
- ✅ True headless mode (no Xvfb)
- ✅ Clear pass/fail results
- ✅ Proper error messages for debugging
- ✅ Copilot coding agent can autonomously run tests
- ✅ Works reliably in CI/CD environment

---

## Additional Notes for Implementation

### Test Bridge API Flexibility

The Test Bridge API can be extended with additional methods as needed. Common
additions:

```javascript
// Add to TestBridge.js if needed:

/**
 * Get Quick Tab count
 */
getQuickTabCount() {
  return this.manager.getAllQuickTabs().length;
}

/**
 * Check if Quick Tab is minimized
 */
isQuickTabMinimized(slotNumber) {
  const qt = this.manager.getQuickTab(slotNumber);
  return qt ? qt.minimized : false;
}

/**
 * Get Manager Panel visibility
 */
isManagerOpen() {
  return this.manager.isManagerPanelOpen();
}
```

### Implementing Remaining Scenarios

Continue implementing scenarios 4-20 from
`docs/manual/v1.6.0/issue-47-revised-scenarios.md` by:

1. Creating new files: `tests/e2e/scenarios/scenario-0X-description.spec.js`
2. Following the same pattern as scenarios 1-3
3. Using helper functions from `tests/e2e/helpers/quick-tabs.js`
4. Adding new helper functions as needed for specific scenario requirements

### Debugging Test Failures

If tests fail, use these commands:

```bash
# Run with UI mode for visual debugging
npx playwright test --ui

# Run with headed mode to see browser
npx playwright test --headed

# Run with debug mode for step-by-step execution
npx playwright test --debug

# Run specific test file
npx playwright test scenario-01

# Run tests matching pattern
npx playwright test --grep "Solo Mode"
```

---

**End of Instructions**

This document provides complete instructions for migrating from the broken
Xvfb+Chrome testing setup to a working playwright-webextext Firefox solution.
All file paths, code snippets, and configurations are ready to implement.
