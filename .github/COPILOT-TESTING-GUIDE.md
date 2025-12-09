# GitHub Copilot Autonomous Testing Guide

**Extension**: Copy URL on Hover - ChunkyEdition  
**Version**: 1.6.3  
**Testing System**: Test Bridge Pattern with Playwright MCP  
**Coverage**: ~80% autonomous testing capability

---

## What Copilot CAN Test

### ✅ UI Interactions

- **Click events**: Button clicks, link clicks, form submissions
- **Hover events**: Mouse hover detection, tooltip triggers
- **Drag & Drop**: Quick Tab dragging, resizing
- **Keyboard input**: Text input, form filling (page-level only)

### ✅ Programmatic Feature Triggering

- **Quick Tab creation**: Via Test Bridge (bypasses "Q" keyboard shortcut)
- **Quick Tab minimize/restore**: Programmatic state changes
- **Quick Tab pin/unpin**: Visibility control testing
- **Quick Tab close**: Cleanup and deletion testing

### ✅ State Verification

- **Storage checks**: Verify Quick Tabs in browser.storage.local
- **Cross-tab sync**: Verify storage.onChanged syncing (v1.6.2+)
- **Global visibility**: All Quick Tabs visible everywhere (v1.6.3+)
- **State persistence**: Verify data survives page reloads

### ✅ Cross-Tab Testing

- **Multiple pages**: `context.newPage()` for new tabs
- **Synchronization**: Verify Quick Tabs appear across tabs via
  storage.onChanged
- **Solo/Mute**: Verify visibility control with soloedOnTabs/mutedOnTabs arrays

### ✅ Visual Testing

- **Screenshots**: Capture UI state at any point
- **Video recording**: Playwright test recordings
- **Snapshot comparisons**: Visual regression testing

---

## What Copilot CANNOT Test

### ❌ Keyboard Shortcuts (Browser Extension Commands)

**Limitation**: `manifest.json` commands like "Q" key or "Ctrl+Alt+Z" cannot be
triggered programmatically in CI environments.

**Why**: Browser extension commands are intercepted at browser level before
Playwright can access them. This is a W3C WebExtensions API design limitation,
not a bug.

**Workaround**: Test Bridge pattern - programmatic triggering of the same
functionality without keyboard shortcuts.

**Manual Testing Required**:

- Pressing "Q" to create Quick Tab
- Pressing "Ctrl+Alt+Z" to toggle Quick Tabs Manager panel

### ❌ Browser Chrome Interactions

**Cannot test**:

- Extension icon clicks in browser toolbar
- Context menu entries
- Browser-level notifications (some)

### ❌ OS-Level Events

**Cannot test**:

- System notifications (outside browser)
- Some clipboard operations (OS-dependent)
- File system dialogs

---

## Test Bridge Usage Examples

### Basic Quick Tab Creation

```javascript
// In Playwright test
const { test, expect } = require('@playwright/test');
const { ExtensionTestHelper } = require('./helpers/extension-test-utils');

test('create Quick Tab programmatically', async ({ page }) => {
  const helper = new ExtensionTestHelper(page);

  // Navigate to test page
  await page.goto('https://example.com');

  // Wait for test bridge to be available
  const bridgeAvailable = await helper.waitForTestBridge();
  expect(bridgeAvailable).toBe(true);

  // Create Quick Tab (bypasses "Q" keyboard shortcut)
  await helper.createQuickTab('https://github.com', {
    title: 'GitHub',
    minimized: false
  });

  // Verify Quick Tab was created
  const quickTabs = await helper.getQuickTabs();
  expect(quickTabs).toHaveLength(1);
  expect(quickTabs[0].url).toBe('https://github.com');
});
```

### Cross-Tab Verification

```javascript
test('Quick Tab persists across tabs', async ({ context }) => {
  // Create first page
  const page1 = await context.newPage();
  await page1.goto('https://example.com');

  const helper1 = new ExtensionTestHelper(page1);
  await helper1.waitForTestBridge();

  // Create Quick Tab on page 1
  await helper1.createQuickTab('https://wikipedia.org');

  // Create second page (new tab)
  const page2 = await context.newPage();
  await page2.goto('https://example.com/page2');

  const helper2 = new ExtensionTestHelper(page2);
  await helper2.waitForTestBridge();

  // Verify Quick Tab appears on page 2
  const quickTabs = await helper2.getQuickTabs();
  expect(quickTabs).toHaveLength(1);
  expect(quickTabs[0].url).toBe('https://wikipedia.org');
});
```

### Cleanup Pattern

```javascript
test('cleanup Quick Tabs after test', async ({ page }) => {
  const helper = new ExtensionTestHelper(page);
  await page.goto('https://example.com');
  await helper.waitForTestBridge();

  // Your test code here
  await helper.createQuickTab('https://test.com');

  // Cleanup
  await helper.clearAllQuickTabs();

  // Verify cleanup
  const quickTabs = await helper.getQuickTabs();
  expect(quickTabs).toHaveLength(0);
});
```

---

## Test Utilities API Reference

### ExtensionTestHelper Class

#### Constructor

```javascript
new ExtensionTestHelper(page);
```

- **page**: Playwright `Page` object

#### Core Methods

##### `waitForTestBridge(timeoutMs = 10000)`

Wait for test bridge to be available in the page.

- **Returns**: `Promise<boolean>` - True if available, false if timeout
- **Usage**: Always call after page load, before other test bridge methods

##### `createQuickTab(url, options = {})`

Create a Quick Tab programmatically (bypasses "Q" keyboard shortcut).

- **url**: `string` - URL to load in Quick Tab
- **options**: `Object` - Configuration options
  - `title`: `string` - Quick Tab title (optional)
  - `minimized`: `boolean` - Start minimized (optional)
  - `pinnedToUrl`: `string` - Pin to specific tab URL (optional)
- **Returns**: `Promise<Object>` - Created Quick Tab data

##### `getQuickTabs()`

Get all Quick Tabs from storage.

- **Returns**: `Promise<Array<Object>>` - Array of Quick Tab objects

##### `getQuickTabById(id)`

Get specific Quick Tab by ID.

- **id**: `string` - Quick Tab ID
- **Returns**: `Promise<Object|null>` - Quick Tab object or null

##### `minimizeQuickTab(id)`

Minimize a Quick Tab programmatically.

- **id**: `string` - Quick Tab ID
- **Returns**: `Promise<Object>` - Operation result

##### `restoreQuickTab(id)`

Restore a minimized Quick Tab.

- **id**: `string` - Quick Tab ID
- **Returns**: `Promise<Object>` - Operation result

##### `pinQuickTab(id)`

Pin a Quick Tab to current tab URL.

- **id**: `string` - Quick Tab ID
- **Returns**: `Promise<Object>` - Operation result

##### `unpinQuickTab(id)`

Unpin a Quick Tab.

- **id**: `string` - Quick Tab ID
- **Returns**: `Promise<Object>` - Operation result

##### `closeById(id)`

Close a specific Quick Tab by ID.

- **id**: `string` - Quick Tab ID
- **Returns**: `void` (synchronous operation)

> **Note:** `closeQuickTab(id)` does NOT exist - use `closeById(id)` instead.

##### `closeAll()`

Close all Quick Tabs.

- **Returns**: `void` (synchronous operation)

##### `waitForQuickTabCount(count, timeout = 5000)`

Wait for Quick Tab count to reach expected value (polling utility).

- **count**: `number` - Expected count
- **timeout**: `number` - Timeout in milliseconds (default: 5000)
- **Returns**: `Promise<boolean>` - True if count reached, false if timeout

##### `clearAllQuickTabs()`

Clear all Quick Tabs (test cleanup utility).

- **Returns**: `Promise<Object>` - Operation result with count

##### `takeScreenshot(name)`

Take a screenshot of the current page.

- **name**: `string` - Screenshot filename (without extension)
- **Returns**: `Promise<void>`
- **Saves to**: `test-results/screenshots/{name}-{timestamp}.png`

##### `verifyQuickTabBehavior(scenario)`

Verify Quick Tab behavior for specific scenario.

- **scenario**: `string` - Scenario name:
  - `'basic-creation'`
  - `'cross-tab-persistence'`
  - `'pinning'`
  - `'minimization'`
  - `'multiple-quick-tabs'`
- **Returns**: `Promise<Object>` - Verification result with `passed`, `message`,
  `data`

---

## Troubleshooting Guide

### Test Bridge Not Available

**Symptom**: `waitForTestBridge()` returns false or times out.

**Checks**:

1. Verify `TEST_MODE=true` environment variable is set
2. Check test bridge was injected into `dist/background.js`
3. Verify `test-bridge.js` is in `manifest.json` `web_accessible_resources`
4. Check browser console for test bridge load messages

**Solution**:

```bash
# In GitHub Actions workflow
echo "TEST_MODE=true" >> $GITHUB_ENV
```

### Extension Not Loading

**Symptom**: Extension doesn't appear in browser, features don't work.

**Checks**:

1. Verify build completed successfully
2. Check `dist/` directory contains all files
3. Verify manifest.json paths are correct
4. Check Firefox/Chrome profile configuration

**Solution**:

```bash
npm run build
# Verify dist/ directory
ls -la dist/
```

### Cross-Tab Tests Failing

**Symptom**: Quick Tabs don't appear in new tabs or synchronization fails.

**Checks**:

1. Add synchronization delays between tab creation and verification
2. Use `waitForQuickTabCount()` instead of immediate checks
3. Verify storage.onChanged is firing (check browser console)

**Solution**:

```javascript
// Add delay after creating new tab
await page2.waitForTimeout(1000);
// Or use polling
await helper2.waitForQuickTabCount(1, 5000);
```

### Playwright Timeout Errors

**Symptom**: Tests timeout before completing.

**Checks**:

1. Extension may be slow to initialize
2. Network requests may be delayed
3. Browser may be slow in CI environment

**Solution**:

```javascript
// Increase timeout for specific operations
test.setTimeout(60000); // 60 seconds

// Or for specific calls
await helper.waitForTestBridge(20000); // 20 seconds
```

---

## Running Tests

### GitHub Actions (Automatic)

Tests run automatically on:

- Code changes pushed to PR branches
- Manual workflow dispatch
- On schedule (if configured)

**View Results**:

- Go to Actions tab in GitHub repository
- Select workflow run
- View test results and screenshots in artifacts

### Local Testing

#### Option 1: Using npm scripts

```bash
# Run extension tests (all browsers)
npm run test:extension

# Run Chrome extension tests only
npm run test:extension:chrome

# Run Firefox extension tests only
npm run test:extension:firefox

# Run with debug mode
npm run test:extension:debug

# Run with UI mode
npm run test:extension:ui

# View test report
npm run test:extension:report
```

#### Option 2: Using Playwright directly

```bash
# Run specific test file
npx playwright test tests/extension/quick-tabs-issue-47.spec.js

# Run with headed browser (see what's happening)
npx playwright test --headed

# Run with debugging
npx playwright test --debug

# Run single test by name
npx playwright test -g "create Quick Tab programmatically"
```

### Test Results Location

- **Screenshots**: `test-results/screenshots/`
- **Videos**: `test-results/videos/`
- **Trace files**: `test-results/traces/`
- **HTML report**: `playwright-report/index.html`

---

## Best Practices

### 1. Always Wait for Test Bridge

```javascript
// ❌ BAD
await helper.createQuickTab('https://example.com');

// ✅ GOOD
await helper.waitForTestBridge();
await helper.createQuickTab('https://example.com');
```

### 2. Clean Up After Tests

```javascript
// Use beforeEach and afterEach hooks
test.beforeEach(async ({ page }) => {
  const helper = new ExtensionTestHelper(page);
  await page.goto('https://example.com');
  await helper.waitForTestBridge();
  await helper.clearAllQuickTabs(); // Start clean
});

test.afterEach(async ({ page }) => {
  const helper = new ExtensionTestHelper(page);
  await helper.clearAllQuickTabs(); // Clean up
});
```

### 3. Use Polling for Async Operations

```javascript
// ❌ BAD - Immediate check
const tabs = await helper.getQuickTabs();
expect(tabs).toHaveLength(1);

// ✅ GOOD - Wait for expected state
const countReached = await helper.waitForQuickTabCount(1);
expect(countReached).toBe(true);
```

### 4. Take Screenshots for Debugging

```javascript
// Take screenshot on failure
test('my test', async ({ page }) => {
  const helper = new ExtensionTestHelper(page);

  try {
    // Test code
  } catch (error) {
    await helper.takeScreenshot('test-failure');
    throw error;
  }
});
```

### 5. Test in Both Firefox and Chrome

```javascript
// Use Playwright projects
// playwright.config.js
module.exports = {
  projects: [
    {
      name: 'chromium-extension',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'firefox-extension',
      use: { ...devices['Desktop Firefox'] }
    }
  ]
};
```

---

## References

- [Implementation Guide](../docs/manual/v1.6.0/copilot-testing-implementation.md)
- [Playwright Documentation](https://playwright.dev/)
- [Playwright MCP](https://github.com/microsoft/playwright-mcp)
- [WebExtensions API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions)
- [Issue #47 - Quick Tabs Behaviors](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition/issues/47)

---

**Last Updated**: November 21, 2025  
**Version**: 1.0.0  
**Test Coverage**: ~80% autonomous, 20% manual (keyboard shortcuts only)
