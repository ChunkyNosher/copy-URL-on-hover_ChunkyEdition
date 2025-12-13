# Playwright E2E Testing Infrastructure: Comprehensive Guide

**Document Version:** 1.0  
**Date:** December 13, 2025  
**Scope:** Playwright end-to-end testing for Quick Tabs Extension v1.6.3.8  
**Target:** Browser extension E2E testing, cross-tab scenarios, and container isolation validation

---

## Table of Contents

1. [Current Playwright Setup Assessment](#current-playwright-setup-assessment)
2. [Firefox Extension Testing Strategy](#firefox-extension-testing-strategy)
3. [Cross-Tab Testing Infrastructure](#cross-tab-testing-infrastructure)
4. [Container Isolation Testing](#container-isolation-testing)
5. [Scenario-to-E2E Mapping](#scenario-to-e2e-mapping)
6. [E2E Test Organization](#e2e-test-organization)
7. [Playwright Configuration](#playwright-configuration)
8. [Test Utilities for E2E](#test-utilities-for-e2e)
9. [Debugging & Troubleshooting](#debugging--troubleshooting)
10. [Implementation Roadmap](#implementation-roadmap)

---

## Current Playwright Setup Assessment

### Existing Infrastructure

✅ **Configuration Files Present:**
- `.playwright-mcp-firefox-config.json` - Firefox extension config
- `.playwright-mcp-chrome-config.json` - Chrome extension config
- `playwright.config.firefox.js` - Firefox test configuration (referenced)
- `playwright.config.chrome.js` - Chrome test configuration (referenced)

✅ **Package.json Scripts Defined:**
```json
"test:extension": "playwright test --config=playwright.config.firefox.js",
"test:extension:chrome": "playwright test --config=playwright.config.chrome.js --project=chromium-extension",
"test:extension:firefox": "playwright test --config=playwright.config.firefox.js --project=firefox-extension",
"test:extension:debug": "playwright test --config=playwright.config.firefox.js --debug",
"test:extension:ui": "playwright test --config=playwright.config.firefox.js --ui",
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui",
"test:e2e:headed": "playwright test --headed",
"test:e2e:debug": "playwright test --debug"
```

✅ **Dependencies Installed:**
- `@playwright/test@1.57.0` - Latest stable
- `@playwright/mcp@0.0.47` - MCP integration for extensions

❌ **Critical Gap: Test Files Missing**
- `tests/e2e/` directory exists but appears empty
- `tests/extension/` directory exists but appears empty
- No actual E2E test implementations

---

## Firefox Extension Testing Strategy

### Challenge: Firefox Container Support

Firefox Multi-Account Containers are not extensions running in the extension context. They're a separate Firefox feature that isolates cookies, site data, and tracking data. This means:

**Architecture:**
- Extension context: Your extension (`moz-extension://UUID/*`)
- Container context: Browser-level isolation (no special API for extensions)
- Separation: Containers are completely isolated at browser level

**Testing Implication:**
When testing container isolation:
1. Quick Tabs created in Container 1 must NOT appear when switching to Container 2
2. Storage per container is handled by Firefox transparently
3. Extension must respect Firefox container boundaries automatically
4. No special container API calls needed in extension code

---

### Setup: Building Extension for Testing

**Process:**

1. **Build Test Extension**
   ```bash
   npm run build:test
   ```
   This enables TEST_MODE and injects test-bridge.js

2. **Extension Output Location**
   - Firefox: `dist/manifest.json` + all assets
   - Requires zip packaging for `.xpi` format

3. **Playwright Configuration**

   The `.playwright-mcp-firefox-config.json` should specify:
   ```json
   {
     "browserName": "firefox",
     "firefoxProfile": "./profiles/testing",
     "args": ["-profile", "./profiles/testing"]
   }
   ```

**Critical Configuration Detail:**
Firefox needs a profile directory for containers to work. Playwright MCP should manage this.

---

### Key Assertions for Firefox Extension Testing

**1. Extension Window Accessibility**
```javascript
// Extension background pages
const extensionPageURL = await context.pages()[0].evaluate(() => 
  window.location.href
);
// Should be moz-extension://UUID/... 
expect(extensionPageURL).toMatch(/^moz-extension:\/\/[\w-]+\//);
```

**2. Cross-Tab Message Passing**
```javascript
// Quick Tabs must communicate through port API
// Messages should flow:
// Content Script (Tab A) → Background → Content Script (Tab B)
```

**3. Storage Isolation by Container**
```javascript
// When tab is in Container 1, Quick Tabs visible
// When same domain in Container 2, Quick Tabs NOT visible
```

---

## Cross-Tab Testing Infrastructure

### Challenge: Playwright Cross-Tab Limitations

**Official Limitation:**
> "Playwright does not support cross-page interactions directly. Each page is isolated."

**Our Workaround:**
Since Quick Tabs communicate via `browser.runtime.port`, we can:
1. Create multiple pages (simulating multiple tabs)
2. Let them communicate through the shared background script
3. Verify state synchronization

**Implementation Pattern:**

```javascript
async function createMultiTabTestContext() {
  const browser = await firefox.launch();
  const context = await browser.newContext();
  
  // These pages represent different browser tabs
  const tab1 = await context.newPage();
  const tab2 = await context.newPage();
  
  // Both tabs load the same domain (or different domains)
  await tab1.goto('https://example.com/page1');
  await tab2.goto('https://example.com/page2');
  
  // Background script is shared between all pages
  // Communication happens through browser.runtime
  
  return { tab1, tab2, context, browser };
}
```

---

### Cross-Tab Communication Testing

**Test Pattern:**

```javascript
test('Quick Tab created in Tab 1 not visible in Tab 2', async () => {
  const { tab1, tab2 } = await createMultiTabTestContext();
  
  // Step 1: Create Quick Tab in Tab 1
  await tab1.evaluate(() => {
    window.__COPILOT_TEST_BRIDGE__.createQuickTab({
      url: 'https://example.com',
      position: { x: 100, y: 100 }
    });
  });
  
  // Verify created in Tab 1
  await expect(tab1.locator('[data-testid="quick-tab"]'))
    .toBeVisible();
  
  // Step 2: Switch to Tab 2
  // Verify NOT visible
  const quickTabsInTab2 = await tab2.locator('[data-testid="quick-tab"]')
    .count();
  expect(quickTabsInTab2).toBe(0);
});
```

---

### Hydration Testing (Scenario 11)

**Scenario:**
Quick Tab persists after page reload (hydration filtered by originTabId)

**Implementation:**

```javascript
test('Scenario 11: Hydration filters by originTabId', async () => {
  const { tab1, tab2 } = await createMultiTabTestContext();
  
  // Tab 1 creates Quick Tab
  await tab1.evaluate(() => {
    window.__COPILOT_TEST_BRIDGE__.createQuickTab({
      url: 'https://example.com'
    });
  });
  
  // Verify visible in Tab 1
  await expect(tab1.locator('[data-testid="quick-tab"]'))
    .toBeVisible();
  
  // Reload Tab 1 (triggers hydration)
  await tab1.reload();
  
  // Verify Quick Tab restores (hydration with originTabId filter)
  await expect(tab1.locator('[data-testid="quick-tab"]'))
    .toBeVisible();
  
  // Verify NOT in Tab 2 (hydration filtered correctly)
  const count = await tab2.locator('[data-testid="quick-tab"]').count();
  expect(count).toBe(0);
});
```

---

## Container Isolation Testing

### Setup: Firefox Container Profiles

Firefox containers require profile management. Playwright needs profiles with containers pre-configured.

**Profile Setup Script:**
```javascript
// tests/e2e/helpers/create-container-profiles.js
// Creates Firefox profiles with containers:
// - Default (no container)
// - Personal
// - Work
// - Banking
// - Shopping
```

---

### Container Testing Pattern

**Challenge:** 
Firefox containers are transparent. Extension gets no API notification of container switch. Storage is automatically isolated per-container.

**Testing Strategy:**

```javascript
test('Scenario 14: Container Isolation', async ({ firefox }) => {
  // Create two separate browser instances (simulating different containers)
  const browser1 = await firefox.launch();
  const context1 = await browser1.newContext({
    // Firefox container identification
    // This varies based on how containers are configured
  });
  const page1 = await context1.newPage();
  
  const browser2 = await firefox.launch();
  const context2 = await browser2.newContext({
    // Different container
  });
  const page2 = await context2.newPage();
  
  await page1.goto('https://example.com');
  await page2.goto('https://example.com');
  
  // Create Quick Tab in Container 1
  await page1.evaluate(() => {
    window.__COPILOT_TEST_BRIDGE__.createQuickTab({});
  });
  
  // Verify NOT visible in Container 2
  // (Storage is isolated per-container by Firefox)
  const qtsInContext2 = await page2.evaluate(() => {
    return window.__COPILOT_TEST_BRIDGE__.getQuickTabsInCurrentTab().length;
  });
  
  expect(qtsInContext2).toBe(0);
});
```

---

## Scenario-to-E2E Mapping

Map all 21 Comprehensive Behavior Scenarios to E2E tests:

### Scenario 1: Basic Quick Tab Creation & Tab Isolation
**File:** `tests/e2e/scenarios/01-tab-isolation.spec.js`
**What to Test:**
- Quick Tab created in Tab 1 (WP 1)
- Switch to Tab 2 (YT 1)
- Verify Quick Tab NOT visible in Tab 2
- Manager shows correct grouping

---

### Scenario 2: Multiple Quick Tabs in Single Tab (No Cross-Tab Sync)
**File:** `tests/e2e/scenarios/02-multiple-tabs-no-sync.spec.js`
**What to Test:**
- Create 2 Quick Tabs in WP 1
- Open YT 1
- Verify neither Quick Tab visible in YT 1
- Return to WP 1, both still there

---

### Scenario 3: Position/Size Persistence Within Single Tab
**File:** `tests/e2e/scenarios/03-position-size-persistence.spec.js`
**What to Test:**
- Create Quick Tab at (100, 100)
- Drag to (300, 200), resize to 600×400
- Reload page (Ctrl+Shift+R)
- Verify restores at (300, 200) with 600×400 size
- Open other tab, position not synced

---

### Scenario 4: Quick Tabs Manager - Display Grouped by Origin Tab
**File:** `tests/e2e/scenarios/04-manager-grouping.spec.js`
**What to Test:**
- Create QT 1 & 2 in WP 1
- Create QT 3 in YT 1
- Open Manager
- Verify grouping: "Wikipedia Tab 1" (QT 1, 2), "YouTube Tab 1" (QT 3)
- Navigate to GH 1
- Manager still shows all tabs grouped

---

### Scenario 5: Minimize Quick Tab in Single Tab
**File:** `tests/e2e/scenarios/05-minimize-restore.spec.js`
**What to Test:**
- Create Quick Tab in WP 1
- Click minimize button
- Quick Tab disappears from viewport
- Open Manager, shows yellow 🟡 indicator
- Click restore, reappears
- Other tabs unaffected

---

### Scenario 6: Close Single Quick Tab
**File:** `tests/e2e/scenarios/06-close-single-tab.spec.js`
**What to Test:**
- Create QT 1 & 2 in WP 1
- Close QT 1
- QT 1 removed from viewport
- QT 2 still visible
- Manager shows only QT 2

---

### Scenario 7: Close All Quick Tabs via Manager
**File:** `tests/e2e/scenarios/07-close-all.spec.js`
**What to Test:**
- Create Quick Tabs across multiple tabs
- Open Manager
- Click "Close All"
- All Quick Tabs close in all tabs
- Manager shows "No Quick Tabs"

---

### Scenario 8: Close All Minimized Quick Tabs via Manager
**File:** `tests/e2e/scenarios/08-close-minimized.spec.js`
**What to Test:**
- Create and minimize some Quick Tabs
- Keep others visible
- Click "Close Minimized"
- Only minimized ones close
- Visible ones remain

---

### Scenario 9: Quick Tab Limit Enforcement Per Tab
**File:** `tests/e2e/scenarios/09-limit-enforcement.spec.js`
**What to Test:**
- Set max Quick Tabs to 2 in settings
- Create 2 in WP 1
- Try to create 3rd
- Notification appears: "Maximum Quick Tabs limit reached (2/2)"
- 3rd NOT created
- Open YT 1, create 2 there (limit per-tab)
- Total 4 Quick Tabs in Manager

---

### Scenario 10: Quick Tab Persistence Across Browser Restart
**File:** `tests/e2e/scenarios/10-persistence-restart.spec.js`
**What to Test:**
- Create Quick Tab at (200, 300), size 700×500
- Create minimized Quick Tab in another tab
- Close browser completely
- Reopen, navigate to original tab
- Quick Tab restores at (200, 300), size 700×500
- Verify minimized state persisted

---

### Scenario 11: Hydration on Page Reload (originTabId Filtering)
**File:** `tests/e2e/scenarios/11-hydration-filtering.spec.js`
**What to Test:**
- WP 1 creates Quick Tab
- YT 1 open, no Quick Tabs visible
- Reload WP 1
- Quick Tab restores (hydration filtered by originTabId)
- YT 1 still has no Quick Tabs

---

### Scenario 12: Tab Closure and State Management
**File:** `tests/e2e/scenarios/12-tab-closure.spec.js`
**What to Test:**
- Create Quick Tabs in WP 1, YT 1, GH 1
- Manager shows all three
- Close YT 1 tab
- Manager updates, shows only WP 1 and GH 1
- WP 1 & GH 1 unaffected

---

### Scenario 13: Position/Size Changes Don't Affect Other Tabs
**File:** `tests/e2e/scenarios/13-position-per-tab.spec.js`
**What to Test:**
- WP 1 create QT 1 at (100, 100)
- YT 1 create QT 2 at (200, 200)
- Move QT 1 to (500, 500)
- Switch to YT 1
- QT 2 still at (200, 200) (no sync from WP 1)

---

### Scenario 14: Container Isolation (Firefox Multi-Account Container)
**File:** `tests/e2e/scenarios/14-container-isolation.spec.js`
**What to Test:**
- WP in FX 1 (default) create QT 1
- WP in FX 2 (Personal) create QT 2
- Manager in FX 1 shows only QT 1
- Manager in FX 2 shows only QT 2
- QT 1 not visible in FX 2

---

### Scenario 15: Multiple Quick Tabs with Dragging & Layering
**File:** `tests/e2e/scenarios/15-dragging-layering.spec.js`
**What to Test:**
- Create QT 1, 2, 3
- QT 3 on top (created last)
- Click QT 1, moves to front
- Drag QT 1 independently
- Verify z-index layering

---

### Scenario 16: Manager Panel Position Persistence
**File:** `tests/e2e/scenarios/16-manager-position.spec.js`
**What to Test:**
- Open Manager at default position
- Move to bottom-left, resize to 450×600
- Switch to another tab (Manager stays open)
- Close and reopen Manager
- Reappears at bottom-left, 450×600

---

### Scenario 17: Rapid Tab Switching with Quick Tab State
**File:** `tests/e2e/scenarios/17-rapid-switching.spec.js`
**What to Test:**
- Create Quick Tabs in multiple tabs
- Start dragging QT in WP 1
- Rapidly switch tabs within 100ms
- Switch back to WP 1
- Quick Tab position saved correctly (emergency save mechanism)

---

### Scenario 18: Quick Tab Visibility Across Container Context
**File:** `tests/e2e/scenarios/18-container-context.spec.js`
**What to Test:**
- GH in FX 1 create QT 1
- GH in FX 2 create QT 2
- Manager in FX 1 shows separate "GitHub Tab" section with only QT 1
- Manager in FX 2 shows separate "GitHub Tab" section with only QT 2

---

### Scenario 19: Minimize and Restore Cycle in One Tab
**File:** `tests/e2e/scenarios/19-minimize-restore-cycle.spec.js`
**What to Test:**
- Create Quick Tab
- Minimize (disappears)
- Restore (reappears)
- Minimize-restore rapidly
- Final state correct

---

### Scenario 20: Cross-Domain Navigation in Same Tab
**File:** `tests/e2e/scenarios/20-cross-domain-nav.spec.js`
**What to Test:**
- WP 1 create Quick Tab at (100, 100)
- Navigate to YouTube in same tab
- Quick Tab remains visible during navigation
- After YouTube loads, Quick Tab restored at (100, 100)

---

### Scenario 21: Memory and Storage Impact of Multiple Quick Tabs
**File:** `tests/e2e/scenarios/21-memory-storage.spec.js`
**What to Test:**
- Create 10 Quick Tabs
- Manager shows all 10
- Monitor memory usage (should be reasonable)
- Check storage size (should be <1MB)
- Close 5 Quick Tabs
- Storage size decreases
- Performance remains acceptable

---

## E2E Test Organization

### Directory Structure

```
tests/e2e/
├── scenarios/                          # 21 scenario test files
│   ├── 01-tab-isolation.spec.js        # ✅ Create
│   ├── 02-multiple-tabs-no-sync.spec.js
│   ├── 03-position-size-persistence.spec.js
│   ├── 04-manager-grouping.spec.js
│   ├── 05-minimize-restore.spec.js
│   ├── 06-close-single-tab.spec.js
│   ├── 07-close-all.spec.js
│   ├── 08-close-minimized.spec.js
│   ├── 09-limit-enforcement.spec.js
│   ├── 10-persistence-restart.spec.js
│   ├── 11-hydration-filtering.spec.js
│   ├── 12-tab-closure.spec.js
│   ├── 13-position-per-tab.spec.js
│   ├── 14-container-isolation.spec.js
│   ├── 15-dragging-layering.spec.js
│   ├── 16-manager-position.spec.js
│   ├── 17-rapid-switching.spec.js
│   ├── 18-container-context.spec.js
│   ├── 19-minimize-restore-cycle.spec.js
│   ├── 20-cross-domain-nav.spec.js
│   └── 21-memory-storage.spec.js
│
├── helpers/                            # E2E test utilities
│   ├── multi-tab-fixture.js            # Create multi-tab test context
│   ├── container-profiles.js           # Firefox container setup
│   ├── assertion-helpers.js            # Common assertions
│   ├── event-tracking.js               # Track extension events
│   └── performance-monitor.js          # Monitor memory/storage
│
├── fixtures/                           # Test data
│   ├── quick-tabs.fixture.js           # Test Quick Tab data
│   ├── domains.fixture.js              # Test domains
│   └── scenarios.fixture.js            # Scenario-specific data
│
└── config/
    ├── firefox-containers.json         # Container definitions
    └── test-settings.json              # Test configuration
```

---

## Playwright Configuration

### Firefox Extension Config

**File:** `playwright.config.firefox.js`

```javascript
// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.js',
  
  // Run tests in parallel
  fullyParallel: true,
  
  // Fail on console errors
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  // Firefox project for extension testing
  projects: [
    {
      name: 'firefox-extension',
      use: {
        ...devices['Desktop Firefox'],
        // Extension testing specific options
        headless: false,  // Extensions don't work in headless
        launchArgs: [
          // Allow extension installation
          '-new-instance'
        ],
      },
    },
  ],

  webServer: {
    // If needed, start a test server
    command: 'npm run build:test',
    url: 'about:blank',
    reuseExistingServer: !process.env.CI,
  },
});
```

---

### Multi-Tab Fixture

**File:** `tests/e2e/helpers/multi-tab-fixture.js`

```javascript
import { test as base, expect } from '@playwright/test';

export const multiTabTest = base.extend({
  // Custom fixture: multiTab context with multiple pages
  multiTab: async ({ context }, use) => {
    // Create multiple pages representing different tabs
    const tab1 = await context.newPage();
    const tab2 = await context.newPage();
    const tab3 = await context.newPage();
    
    await use({ tab1, tab2, tab3, context });
    
    // Cleanup
    await tab1.close();
    await tab2.close();
    await tab3.close();
  },
});

export const expect = base.expect;
```

**Usage in Tests:**
```javascript
import { multiTabTest as test } from './helpers/multi-tab-fixture.js';

test('multi-tab scenario', async ({ multiTab }) => {
  const { tab1, tab2, tab3 } = multiTab;
  // test code
});
```

---

## Test Utilities for E2E

### Event Tracking Helper

**File:** `tests/e2e/helpers/event-tracking.js`

Track extension lifecycle events:
- Quick Tab creation
- Quick Tab destruction
- Manager open/close
- Storage changes
- Port connections/disconnections

```javascript
export class EventTracker {
  constructor(page) {
    this.page = page;
    this.events = [];
  }
  
  async startTracking() {
    await this.page.evaluate(() => {
      window.__eventLog = [];
      
      // Hook into test bridge for events
      const originalCreate = window.__COPILOT_TEST_BRIDGE__.createQuickTab;
      window.__COPILOT_TEST_BRIDGE__.createQuickTab = async (...args) => {
        window.__eventLog.push({ event: 'create', args, time: Date.now() });
        return originalCreate.apply(this, args);
      };
    });
  }
  
  getEvents() {
    return this.page.evaluate(() => window.__eventLog);
  }
}
```

---

### Assertion Helpers

**File:** `tests/e2e/helpers/assertion-helpers.js`

```javascript
export async function assertQuickTabVisible(page, testId) {
  await expect(page.locator(`[data-testid="${testId}"]`))
    .toBeVisible();
}

export async function assertQuickTabNotVisible(page, testId) {
  await expect(page.locator(`[data-testid="${testId}"]`))
    .not.toBeVisible();
}

export async function assertManagerShowing(page, groupName, qtCount) {
  const group = page.locator(`[data-testid="manager-group-${groupName}"]`);
  await expect(group).toBeVisible();
  
  const items = page.locator(`[data-testid="manager-group-${groupName}"] [data-testid="quick-tab-item"]`);
  await expect(items).toHaveCount(qtCount);
}

export async function assertQuickTabPosition(page, testId, expectedX, expectedY) {
  const element = page.locator(`[data-testid="${testId}"]`);
  const boundingBox = await element.boundingBox();
  
  expect(Math.abs(boundingBox.x - expectedX)).toBeLessThan(5);
  expect(Math.abs(boundingBox.y - expectedY)).toBeLessThan(5);
}
```

---

### Performance Monitor

**File:** `tests/e2e/helpers/performance-monitor.js`

Monitor extension performance during E2E tests:

```javascript
export class PerformanceMonitor {
  constructor(page) {
    this.page = page;
  }
  
  async getMemoryUsage() {
    return await this.page.evaluate(() => {
      if (performance.memory) {
        return {
          usedJSHeapSize: performance.memory.usedJSHeapSize,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
          jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
        };
      }
      return null;
    });
  }
  
  async getStorageUsage() {
    return await this.page.evaluate(async () => {
      if (navigator.storage && navigator.storage.estimate) {
        return await navigator.storage.estimate();
      }
      return null;
    });
  }
  
  async assertMemoryReasonable(maxMB) {
    const memory = await this.getMemoryUsage();
    const usedMB = memory.usedJSHeapSize / (1024 * 1024);
    expect(usedMB).toBeLessThan(maxMB);
  }
}
```

---

## Debugging & Troubleshooting

### Common Issues

**1. Extension Not Loading**

**Symptom:**
```
Error: Protocol error (Target.attachToTarget): Unknown session id
```

**Cause:**
Extension didn't build properly or TEST_MODE not enabled

**Fix:**
```bash
npm run clean
npm run build:test
npm run test:extension:debug  # Run with --debug flag
```

---

**2. Cross-Tab Communication Not Working**

**Symptom:**
Quick Tabs created in one tab appear in another tab

**Cause:**
originTabId filtering not working in storage layer

**Debug:**
```javascript
test.only('debug cross-tab', async ({ tab1, tab2 }) => {
  // Check storage in each tab
  const storage1 = await tab1.evaluate(() => {
    return browser.storage.local.get();
  });
  
  const storage2 = await tab2.evaluate(() => {
    return browser.storage.local.get();
  });
  
  console.log('Tab 1 Storage:', storage1);
  console.log('Tab 2 Storage:', storage2);
  // Verify originTabId filtering
});
```

---

**3. Container Tests Failing**

**Symptom:**
Container-specific tests pass locally but fail in CI

**Cause:**
Firefox containers not pre-configured in CI environment

**Fix:**
Create container profile in CI setup or use separate browser instances

---

### Debug Commands

**1. UI Mode (Step Through Tests)**
```bash
npm run test:extension:ui
# Opens Playwright Inspector
# Allows stepping through test execution
```

**2. Headed Mode (See Browser)**
```bash
npm run test:extension:debug --headed
# Shows browser during test execution
# Allows manual inspection
```

**3. Specific Test**
```bash
npx playwright test tests/e2e/scenarios/01-tab-isolation.spec.js --debug
```

**4. Generate Trace for Debugging**
```javascript
test('scenario with trace', async ({ page }) => {
  await page.context().tracing.start({ screenshots: true, snapshots: true });
  // test code
  await page.context().tracing.stop({ path: 'trace.zip' });
});

// View trace: npx playwright show-trace trace.zip
```

---

## Implementation Roadmap

### Phase 1: Test Infrastructure (Week 1)

**Create Essential Files:**
1. ✅ `tests/e2e/helpers/multi-tab-fixture.js`
2. ✅ `tests/e2e/helpers/event-tracking.js`
3. ✅ `tests/e2e/helpers/assertion-helpers.js`
4. ✅ `tests/e2e/helpers/performance-monitor.js`

**Setup Playwright Configuration:**
1. ✅ Verify `.playwright-mcp-firefox-config.json`
2. ✅ Create/update `playwright.config.firefox.js`
3. ✅ Create/update `playwright.config.chrome.js`
4. ✅ Configure container profiles for Firefox

**Expected Effort:** 6-8 hours

---

### Phase 2: Core Scenarios (Week 2)

**Implement Scenarios 1-7:**
1. ✅ Tab Isolation (Scenario 1)
2. ✅ Multiple Tabs No Sync (Scenario 2)
3. ✅ Position/Size Persistence (Scenario 3)
4. ✅ Manager Grouping (Scenario 4)
5. ✅ Minimize/Restore (Scenario 5)
6. ✅ Close Single Tab (Scenario 6)
7. ✅ Close All (Scenario 7)

**Expected Effort:** 14-18 hours

---

### Phase 3: Advanced Scenarios (Week 3)

**Implement Scenarios 8-14:**
1. ✅ Close Minimized (Scenario 8)
2. ✅ Limit Enforcement (Scenario 9)
3. ✅ Persistence Restart (Scenario 10)
4. ✅ Hydration Filtering (Scenario 11)
5. ✅ Tab Closure (Scenario 12)
6. ✅ Position Per-Tab (Scenario 13)
7. ✅ Container Isolation (Scenario 14)

**Expected Effort:** 18-24 hours

---

### Phase 4: Complex Scenarios (Week 4)

**Implement Scenarios 15-21:**
1. ✅ Dragging/Layering (Scenario 15)
2. ✅ Manager Position (Scenario 16)
3. ✅ Rapid Switching (Scenario 17)
4. ✅ Container Context (Scenario 18)
5. ✅ Minimize/Restore Cycle (Scenario 19)
6. ✅ Cross-Domain Nav (Scenario 20)
7. ✅ Memory/Storage Impact (Scenario 21)

**Expected Effort:** 18-24 hours

---

### Phase 5: CI/CD Integration (Week 5)

**Setup Continuous Testing:**
1. ✅ GitHub Actions workflow for E2E tests
2. ✅ Docker container for Firefox with containers support
3. ✅ Test result reporting
4. ✅ Screenshot/trace artifact collection on failure
5. ✅ Performance benchmarking

**Expected Effort:** 12-16 hours

---

## Key Differences: Jest vs. Playwright E2E

| Aspect | Jest Unit/Integration | Playwright E2E |
|--------|----------------------|----------------|
| **Speed** | <5 seconds for 100 tests | 30+ seconds per test |
| **Isolation** | Perfect (mocks) | Real browser state |
| **Coverage** | Branches, functions, lines | User workflows |
| **What Tests** | Logic, functions, components | Full application behavior |
| **Debugging** | Console logs, debugger | Inspector UI, traces |
| **Cross-Tab** | Mocked via helpers | Real port communication |
| **Storage** | Mocked in setup | Real browser storage |
| **Extensions** | Test bridge APIs | Full extension runtime |

---

## Success Criteria

E2E testing is complete when:

✅ All 21 scenarios have passing E2E tests  
✅ Cross-tab communication verified in real browser  
✅ Container isolation tested and passing  
✅ Performance acceptable (<50ms per operation)  
✅ CI/CD pipeline runs E2E tests on every PR  
✅ Trace artifacts captured for failed tests  
✅ Test execution time <10 minutes total  

---

## Conclusion

Playwright E2E tests validate the extension works correctly in real Firefox browsers with actual:
- Port communication
- Storage persistence
- Cross-tab synchronization
- Container isolation
- State restoration

Combined with Jest unit tests, Playwright E2E tests provide complete confidence in the Quick Tabs extension.

**Total Estimated Effort for E2E Testing:** 70-90 hours (2-3 weeks at full-time)
