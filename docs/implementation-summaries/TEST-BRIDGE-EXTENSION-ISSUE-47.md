# Test Bridge Extension for Issue #47 Autonomous Testing

**Date:** 2025-11-22  
**Version:** 1.6.0.3+  
**Related Issue:** #47  
**Files Modified:**

- `src/test-bridge.js` (+376 lines)
- `src/content.js` (+637 lines)

## Overview

Extended the Test Bridge API with 15 new methods to enable autonomous testing of
all 20 Issue #47 scenarios via Playwright MCP. These methods provide
programmatic access to Solo/Mute functionality, Manager Panel state, Container
Isolation, Debug Mode, and Geometry/Z-Index verification.

## New Test Bridge Methods

### 1. Solo/Mute Methods (Scenarios 3, 4, 13)

#### `toggleSolo(id, tabId)`

- **Purpose:** Toggle solo mode for a Quick Tab on a specific browser tab
- **Parameters:**
  - `id` (string): Quick Tab ID
  - `tabId` (number): Browser tab ID to solo on
- **Returns:**
  `{success, data: {id, tabId, isNowSoloed, soloedOnTabs, mutedOnTabs}}`
- **Implementation:** Calls `domainTab.toggleSolo(tabId)` and broadcasts change
- **Scenarios:** 3, 13

#### `toggleMute(id, tabId)`

- **Purpose:** Toggle mute mode for a Quick Tab on a specific browser tab
- **Parameters:**
  - `id` (string): Quick Tab ID
  - `tabId` (number): Browser tab ID to mute on
- **Returns:**
  `{success, data: {id, tabId, isNowMuted, soloedOnTabs, mutedOnTabs}}`
- **Implementation:** Calls `domainTab.toggleMute(tabId)` and broadcasts change
- **Scenarios:** 4, 13

#### `getVisibilityState(tabId)`

- **Purpose:** Get visibility state for all Quick Tabs on a specific browser tab
- **Parameters:**
  - `tabId` (number): Browser tab ID to check visibility for
- **Returns:** `{success, data: {tabId, visible[], hidden[], quickTabs{}}}`
- **Implementation:** Iterates all Quick Tabs and checks
  `domainTab.shouldBeVisible(tabId)`
- **Scenarios:** 3, 4, 13

### 2. Manager Panel Methods (Scenarios 5, 6, 12, 15)

#### `getManagerState()`

- **Purpose:** Get current Manager Panel state
- **Returns:**
  `{success, data: {visible, position{left, top}, size{width, height}, minimizedTabs[], minimizedCount}}`
- **Implementation:** Reads `panelManager.stateManager.panelState` and filters
  minimized tabs
- **Scenarios:** 5, 6, 12, 15

#### `setManagerPosition(x, y)`

- **Purpose:** Set Manager Panel position (for testing UI behavior)
- **Parameters:**
  - `x` (number): X coordinate
  - `y` (number): Y coordinate
- **Returns:** `{success, data: {x, y}}`
- **Implementation:** Updates `panel.style.left/top` and
  `stateManager.panelState`
- **Scenarios:** 12, 15

#### `setManagerSize(width, height)`

- **Purpose:** Set Manager Panel size (for testing UI behavior)
- **Parameters:**
  - `width` (number): Panel width
  - `height` (number): Panel height
- **Returns:** `{success, data: {width, height}}`
- **Implementation:** Updates `panel.style.width/height` and
  `stateManager.panelState`
- **Scenarios:** 12, 15

#### `closeAllMinimized()`

- **Purpose:** Close all minimized Quick Tabs at once
- **Returns:** `{success, data: {count, closedIds[]}}`
- **Implementation:** Filters tabs where `domainTab.isMinimized`, closes each
- **Scenarios:** 5, 6

### 3. Container Isolation Methods (Scenarios 8, 19, 20)

#### `getContainerInfo()`

- **Purpose:** Get all Quick Tabs grouped by container
- **Returns:** `{success, data: {currentContainer, containers{}}}`
- **Implementation:** Groups tabs by `domainTab.cookieStoreId`
- **Scenarios:** 8, 19, 20

#### `createQuickTabInContainer(url, cookieStoreId)`

- **Purpose:** Create a Quick Tab in a specific Firefox container
- **Parameters:**
  - `url` (string): URL to load
  - `cookieStoreId` (string): Container cookie store ID (e.g.,
    'firefox-container-1')
- **Returns:** `{success, data: {url, cookieStoreId}}`
- **Implementation:** Calls `quickTabsManager.createQuickTab()` with explicit
  `cookieStoreId`
- **Scenarios:** 8, 19, 20

#### `verifyContainerIsolation(id1, id2)`

- **Purpose:** Verify two Quick Tabs are in different containers
- **Parameters:**
  - `id1` (string): First Quick Tab ID
  - `id2` (string): Second Quick Tab ID
- **Returns:** `{success, data: {id1, id2, container1, container2, isIsolated}}`
- **Implementation:** Compares `domainTab.cookieStoreId` for both tabs
- **Scenarios:** 8, 19, 20

### 4. Debug Mode Methods (Scenario 16)

#### `getSlotNumbering()`

- **Purpose:** Get slot numbering information for minimized Quick Tabs
- **Returns:** `{success, data: {slots[{slotNumber, isOccupied, quickTabId}]}}`
- **Implementation:** Reads `minimizedManager.slots` array
- **Scenarios:** 16

#### `setDebugMode(enabled)`

- **Purpose:** Enable or disable debug mode
- **Parameters:**
  - `enabled` (boolean): True to enable, false to disable
- **Returns:** `{success, data: {enabled}}`
- **Implementation:** Saves to `browser.storage.local.debugMode`
- **Scenarios:** 16

### 5. Geometry/Z-Index Methods (Scenarios 17, 18)

#### `getQuickTabGeometry(id)`

- **Purpose:** Get Quick Tab position, size, and z-index
- **Parameters:**
  - `id` (string): Quick Tab ID
- **Returns:**
  `{success, data: {id, position{left, top}, size{width, height}, zIndex}}`
- **Implementation:** Reads from `element.getBoundingClientRect()` and computed
  styles
- **Scenarios:** 17, 18

#### `verifyZIndexOrder(ids)`

- **Purpose:** Verify z-index stacking order (front to back)
- **Parameters:**
  - `ids` (Array<string>): Quick Tab IDs in expected order (highest z-index
    first)
- **Returns:** `{success, data: {ids, zIndexData[], isCorrectOrder}}`
- **Implementation:** Gets z-index for each tab, verifies descending order
- **Scenarios:** 17, 18

## Message Handler Implementation

All handlers follow the existing pattern in `content.js`:

```javascript
// eslint-disable-next-line max-depth
if (message.type === 'TEST_TOGGLE_SOLO') {
  console.log('[Test Bridge Handler] TEST_TOGGLE_SOLO:', message.data);
  (async () => {
    try {
      if (!quickTabsManager) {
        throw new Error('QuickTabsManager not initialized');
      }

      const { id, tabId } = message.data;
      const tab = quickTabsManager.tabs.get(id);

      if (!tab) {
        throw new Error(`Quick Tab not found: ${id}`);
      }

      // Get the domain model
      const domainTab = tab.domainTab;
      if (!domainTab) {
        throw new Error(`Domain model not found for Quick Tab: ${id}`);
      }

      // Toggle solo on the domain model
      const isNowSoloed = domainTab.toggleSolo(tabId);

      // Update in storage
      await quickTabsManager.storage.saveQuickTab(domainTab);

      // Broadcast to other tabs
      if (quickTabsManager.broadcast) {
        quickTabsManager.broadcast.broadcastMessage('SOLO_CHANGED', {
          id,
          tabId,
          isNowSoloed,
          soloedOnTabs: domainTab.visibility.soloedOnTabs
        });
      }

      sendResponse({
        success: true,
        message: isNowSoloed ? 'Solo enabled' : 'Solo disabled',
        data: {
          id,
          tabId,
          isNowSoloed,
          soloedOnTabs: domainTab.visibility.soloedOnTabs,
          mutedOnTabs: domainTab.visibility.mutedOnTabs
        }
      });
    } catch (error) {
      console.error('[Test Bridge Handler] TEST_TOGGLE_SOLO error:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();
  return true;
}
```

## Scenario Coverage Mapping

| Scenario                        | Test Bridge Methods                                                         | Coverage |
| ------------------------------- | --------------------------------------------------------------------------- | -------- |
| 3. Solo/Mute mutual exclusivity | `toggleSolo`, `toggleMute`, `getVisibilityState`                            | ✅ Full  |
| 4. Solo/Mute cross-tab sync     | `toggleSolo`, `toggleMute`, `getVisibilityState`                            | ✅ Full  |
| 5. Manager panel minimized list | `getManagerState`, `minimizeQuickTab`, `closeAllMinimized`                  | ✅ Full  |
| 6. Manager panel close all      | `getManagerState`, `closeAllMinimized`                                      | ✅ Full  |
| 8. Container isolation          | `getContainerInfo`, `createQuickTabInContainer`, `verifyContainerIsolation` | ✅ Full  |
| 12. Manager panel position      | `getManagerState`, `setManagerPosition`                                     | ✅ Full  |
| 13. Solo/Mute persistence       | `toggleSolo`, `toggleMute`, `getVisibilityState`                            | ✅ Full  |
| 15. Manager panel resize        | `getManagerState`, `setManagerSize`                                         | ✅ Full  |
| 16. Debug mode slot numbering   | `getSlotNumbering`, `setDebugMode`                                          | ✅ Full  |
| 17. Drag/resize geometry        | `getQuickTabGeometry`                                                       | ✅ Full  |
| 18. Z-index stacking            | `verifyZIndexOrder`, `getQuickTabGeometry`                                  | ✅ Full  |
| 19. Container-grouped manager   | `getContainerInfo`, `getManagerState`                                       | ✅ Full  |
| 20. Cross-container isolation   | `getContainerInfo`, `verifyContainerIsolation`                              | ✅ Full  |

**Additional scenarios covered by existing methods:**

- 1, 2, 7, 9, 10, 11, 14 (existing Test Bridge methods)

## Usage Example

```javascript
// Access test bridge
const testBridge = window.__COPILOT_TEST_BRIDGE__;

// Test Solo/Mute functionality (Scenario 3)
const tab1 = await testBridge.createQuickTab('https://example.com');
const tabId = 123; // Browser tab ID

// Toggle solo
const soloResult = await testBridge.toggleSolo(tab1.data.id, tabId);
console.log('Solo enabled:', soloResult.data.isNowSoloed); // true

// Check visibility
const visibility = await testBridge.getVisibilityState(tabId);
console.log('Visible tabs:', visibility.data.visible); // [tab1.data.id]

// Toggle mute (should clear solo)
const muteResult = await testBridge.toggleMute(tab1.data.id, tabId);
console.log('Mute enabled:', muteResult.data.isNowMuted); // true
console.log('Solo cleared:', muteResult.data.soloedOnTabs); // []

// Test Container Isolation (Scenario 8)
const containerInfo = await testBridge.getContainerInfo();
console.log('Containers:', containerInfo.data.containers);

const tab2 = await testBridge.createQuickTabInContainer(
  'https://github.com',
  'firefox-container-1'
);

const isolation = await testBridge.verifyContainerIsolation(
  tab1.data.id,
  tab2.data.id
);
console.log('Isolated:', isolation.data.isIsolated); // true

// Test Manager Panel (Scenario 12)
const managerState = await testBridge.getManagerState();
console.log('Manager visible:', managerState.data.visible);
console.log('Manager position:', managerState.data.position);

await testBridge.setManagerPosition(100, 200);
const newState = await testBridge.getManagerState();
console.log('New position:', newState.data.position); // {left: 100, top: 200}
```

## Implementation Notes

1. **Error Handling:** All handlers use try/catch and return
   `{success: false, error: message}` on failure
2. **Async Support:** Handlers use `(async () => { ... })()` pattern with
   `return true` for async responses
3. **Domain Model:** Solo/Mute operations work on `domainTab` (domain layer),
   not UI layer
4. **Broadcast:** Solo/Mute changes are broadcast to other tabs via
   BroadcastChannel
5. **Storage:** State changes are persisted via
   `quickTabsManager.storage.saveQuickTab()`
6. **Container Isolation:** All operations respect Firefox container boundaries
   via `cookieStoreId`

## Testing Strategy

**Playwright MCP Test Pattern:**

```javascript
test('Solo/Mute mutual exclusivity', async ({ page }) => {
  const helper = new ExtensionTestHelper(page);
  await page.goto('https://example.com');
  await helper.waitForTestBridge();

  // Create Quick Tab
  const tab = await helper.createQuickTab('https://github.com');
  const tabId = await page.evaluate(() => browser.tabs.getCurrent().id);

  // Enable solo
  const soloResult = await page.evaluate(
    async (id, tid) => window.__COPILOT_TEST_BRIDGE__.toggleSolo(id, tid),
    tab.id,
    tabId
  );
  expect(soloResult.data.isNowSoloed).toBe(true);

  // Enable mute (should disable solo)
  const muteResult = await page.evaluate(
    async (id, tid) => window.__COPILOT_TEST_BRIDGE__.toggleMute(id, tid),
    tab.id,
    tabId
  );
  expect(muteResult.data.isNowMuted).toBe(true);
  expect(muteResult.data.soloedOnTabs).toHaveLength(0); // Solo cleared
});
```

## ESLint Compliance

All new code includes:

- `// eslint-disable-next-line max-depth` for nested handlers (existing pattern)
- Proper error handling
- Console logging for debugging
- JSDoc comments in test-bridge.js

Pre-existing ESLint warnings (complexity, max-lines-per-function) are not from
this change.

## File Size Limits

- `test-bridge.js`: 9,866 bytes (under 25KB limit)
- This document: ~10KB (under 20KB limit)

## Next Steps

1. ✅ Test Bridge extension complete
2. ⏭️ Write Playwright tests using new methods
3. ⏭️ Validate all 20 scenarios work autonomously
4. ⏭️ Document test patterns in testing guide

## References

- Issue #47: 20 Quick Tab testing scenarios
- `.github/COPILOT-TESTING-GUIDE.md`: Autonomous testing documentation
- `tests/extension/helpers/extension-test-utils.js`: Test helper utilities
