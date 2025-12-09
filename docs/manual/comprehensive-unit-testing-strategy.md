# Comprehensive Unit Testing Strategy for Quick Tabs Regression Prevention

**Document Version:** 1.0  
**Target Extension Version:** v1.6.1+  
**Date:** November 23, 2025  
**Purpose:** Address regression of issues #35 and #51 by expanding unit test
coverage to comprehensively validate cross-tab behaviors, solo/mute behaviors,
Quick Tabs Manager behaviors, and all scenarios from
issue-47-revised-scenarios.md

---

## Executive Summary

### Current Problem

Despite existing unit test coverage reported by CodeCov, the extension has
regressed to a state where:

- **Issue #35:** Quick Tabs don't persist across browser tabs
- **Issue #51:** Quick Tab size and position don't update and transfer between
  tabs
- **Issue #47 scenarios:** Many Quick Tab Manager behaviors are not properly
  validated

### Root Cause Analysis

The current unit testing framework primarily tests individual components in
isolation but lacks comprehensive integration testing that validates:

1. **Cross-tab synchronization** via BroadcastChannel
2. **State persistence** across tab switches and browser restarts
3. **Solo/Mute mode** mutual exclusivity and visibility rules
4. **Manager Panel** state synchronization across tabs
5. **Position/size updates** propagating correctly through storage and broadcast
   layers
6. **Container isolation** boundaries

### Testing Strategy Overview

This document outlines a multi-layer testing approach:

1. **Enhanced Unit Tests** - Test individual components with better cross-tab
   simulation
2. **Integration Tests** - Test component interactions (storage → broadcast →
   UI)
3. **Scenario-Based Tests** - Map directly to issue-47-revised-scenarios.md
   behaviors
4. **Cross-Tab Simulation Framework** - Mock infrastructure for testing
   multi-tab behaviors

---

## Section 1: Cross-Tab Synchronization Testing

### 1.1 BroadcastManager Testing Enhancement

**Location:** `tests/unit/managers/BroadcastManager.test.js`

**Current Gap:** BroadcastManager tests likely verify message sending but not
the full cross-tab synchronization lifecycle.

**Required Test Coverage:**

#### Test Suite: Cross-Tab Message Propagation

- **Test:** Broadcasting position change reaches all simulated tabs within 100ms
  - Create multiple mock BroadcastChannel instances representing different tabs
  - Send position update from tab A
  - Verify all other tabs receive the message within latency threshold
  - Validate message payload integrity

- **Test:** Multiple rapid position updates maintain correct order
  - Send 5 position updates in rapid succession from same tab
  - Verify all updates arrive in correct order across all tabs
  - Check for no message loss or duplication

- **Test:** Concurrent updates from different tabs resolve correctly
  - Tab A updates position to (100, 100)
  - Tab B simultaneously updates position to (200, 200)
  - Verify last-write-wins behavior or timestamp-based conflict resolution
  - Ensure no race conditions in state updates

#### Test Suite: BroadcastChannel Error Handling

- **Test:** Handle BroadcastChannel initialization failure gracefully
  - Mock BroadcastChannel constructor to throw error
  - Verify fallback mechanism activates (storage polling or event-based sync)
  - Confirm no crash or undefined behavior

- **Test:** Handle message send failure during tab transition
  - Simulate tab being closed mid-broadcast
  - Verify pending save mechanism captures state before tab closes
  - Confirm no data loss

- **Test:** Handle malformed broadcast messages
  - Send broadcast with missing required fields
  - Send broadcast with incorrect data types
  - Verify defensive parsing and error logging

### 1.2 SyncCoordinator Testing Enhancement

**Location:** `tests/unit/coordinators/SyncCoordinator.test.js`

**Current Gap:** SyncCoordinator orchestrates broadcast and storage
synchronization but tests may not cover all edge cases.

**Required Test Coverage:**

#### Test Suite: Position/Size Sync Lifecycle

- **Test:** Position change triggers broadcast and storage update
  - Create Quick Tab with initial position (100, 100)
  - Update position to (200, 200)
  - Verify BroadcastManager.broadcast called with correct payload
  - Verify StorageManager.save called with updated position
  - Verify StateManager.update called to update in-memory state

- **Test:** Position change in tab A reflects in tab B via broadcast
  - Setup two simulated tabs
  - Tab A updates QT position
  - Verify tab B receives broadcast message
  - Verify tab B's local state updates to match
  - Verify tab B's DOM updates to new position

- **Test:** Emergency save triggers on tab visibility change
  - Create Quick Tab with position (150, 150)
  - Trigger `visibilitychange` event (simulating tab switch)
  - Verify emergency save called immediately
  - Verify position saved to storage before tab becomes hidden

#### Test Suite: State Hydration on Tab Load

- **Test:** New tab loads all Quick Tabs from storage correctly
  - Pre-populate storage with 3 Quick Tabs
  - Initialize QuickTabsManager in new simulated tab context
  - Verify all 3 Quick Tabs restored with correct position, size, solo/mute
    state
  - Verify DOM rendering matches stored state

- **Test:** Container-specific tabs load only relevant Quick Tabs
  - Pre-populate storage with 2 QTs in default container, 2 in Personal
    container
  - Initialize manager in Personal container context
  - Verify only Personal container QTs loaded
  - Verify default container QTs NOT rendered

---

## Section 2: Solo/Mute Behavior Testing

### 2.1 VisibilityHandler Testing Enhancement

**Location:** `tests/unit/handlers/VisibilityHandler.test.js`

**Current Gap:** Solo/Mute mutual exclusivity and visibility rules across tabs
need comprehensive validation.

**Required Test Coverage:**

#### Test Suite: Solo Mode Behavior

- **Test:** Solo mode activates and restricts visibility to one tab
  - Create QT in tab with ID 123
  - Activate solo mode for tab 123
  - Verify QT visible in tab 123
  - Verify QT hidden in tab 456
  - Verify solo button state updated (active/highlighted)

- **Test:** Solo mode broadcasts to all tabs immediately
  - Tab A activates solo mode for QT-1
  - Verify broadcast message sent with action "SOLO_TOGGLE"
  - Verify tab B receives message within 100ms
  - Verify tab B hides QT-1 (if not the solo tab)

- **Test:** Solo mode persists across browser restart
  - Create QT, activate solo for tab 123
  - Save to storage
  - Simulate browser restart (clear in-memory state)
  - Reload from storage
  - Verify solo mode still active for tab 123

#### Test Suite: Mute Mode Behavior

- **Test:** Mute mode activates and hides QT on specific tab only
  - Create QT visible in tab 123 and tab 456
  - Mute QT on tab 456
  - Verify QT hidden in tab 456
  - Verify QT still visible in tab 123
  - Verify mute button state updated

- **Test:** Mute mode broadcasts and syncs across tabs
  - Tab A mutes QT-1 on tab 456
  - Verify broadcast sent
  - Verify all tabs update their visibility rules
  - If current tab is 456, verify QT-1 hidden

- **Test:** Multiple tabs can mute same QT independently
  - Mute QT-1 on tab 123
  - Mute QT-1 on tab 456
  - Verify QT-1 hidden on both tabs
  - Verify QT-1 still visible on tab 789
  - Verify muted tab IDs array contains [123, 456]

#### Test Suite: Solo/Mute Mutual Exclusivity

- **Test:** Activating solo disables mute button
  - Create QT, activate solo
  - Verify mute button disabled (grayed out)
  - Attempt to click mute button
  - Verify no action taken, solo remains active

- **Test:** Activating mute disables solo button
  - Create QT, activate mute
  - Verify solo button disabled
  - Attempt to click solo button
  - Verify no action taken, mute remains active

- **Test:** Deactivating solo re-enables mute button
  - Create QT, activate solo, then deactivate solo
  - Verify mute button re-enabled
  - Click mute button
  - Verify mute activates successfully

- **Test:** Switching from solo to mute clears solo state
  - Create QT, activate solo for tab 123
  - User deactivates solo, then activates mute
  - Verify solo state cleared in storage
  - Verify mute state set correctly
  - Verify mutual exclusivity enforced

### 2.2 VisibilityHandler Edge Cases

#### Test Suite: Tab Closure with Solo/Mute Active

- **Test:** Closing solo tab reverts QT to global mode
  - Create QT, solo to tab 123
  - Simulate tab 123 closing (browser.tabs.onRemoved event)
  - Verify solo mode automatically deactivated
  - Verify QT becomes visible in all tabs

- **Test:** Closing one of multiple muted tabs removes that tab from mute list
  - Create QT, mute on tab 123 and tab 456
  - Simulate tab 123 closing
  - Verify tab 123 removed from muted tabs array
  - Verify tab 456 still in muted tabs array
  - Verify QT still hidden on tab 456

---

## Section 3: Manager Panel Synchronization Testing

### 3.1 PanelManager Testing Enhancement

**Location:** `tests/unit/panel/PanelManager.test.js`

**Current Gap:** Panel Manager state synchronization across tabs and container
grouping need validation.

**Required Test Coverage:**

#### Test Suite: Panel State Sync Across Tabs

- **Test:** Minimizing QT in tab A updates panel in tab B immediately
  - Tab A: minimize QT-1 via toolbar button
  - Verify broadcast sent
  - Tab B: open Manager Panel
  - Verify QT-1 shows yellow 🟡 minimized indicator
  - Verify "Restore" button visible for QT-1

- **Test:** Closing QT in one tab updates panel in all tabs
  - Tab A: close QT-1
  - Tab B and Tab C: have Manager Panel open
  - Verify QT-1 removed from panel in all tabs within 100ms
  - Verify panel shows "No Quick Tabs" if last tab closed

- **Test:** Manager Panel position/size persists across tabs
  - Tab A: open Manager, move to bottom-left, resize to 450×600px
  - Tab A: close Manager
  - Tab B: open Manager
  - Verify Manager appears at bottom-left with 450×600px size
  - Verify position/size persistence uses browser.storage.local

#### Test Suite: Container Grouping in Manager Panel

- **Test:** Manager Panel groups QTs by container correctly
  - Create QT-1 in default container
  - Create QT-2 in Personal container
  - Open Manager Panel
  - Verify two sections displayed: "Default Container" and "Personal Container"
  - Verify QT-1 under "Default Container"
  - Verify QT-2 under "Personal Container"

- **Test:** Manager Panel only shows relevant containers
  - Create QT-1 in default container
  - Create QT-2 in Work container
  - Current tab is in default container
  - Open Manager Panel
  - Verify both sections visible (can manage all containers)
  - Verify container isolation still enforced for rendering

#### Test Suite: Manager Panel Operations

- **Test:** "Close All" button closes all QTs across all tabs
  - Create QT-1, QT-2, QT-3 across multiple tabs
  - Tab A: open Manager, click "Close All"
  - Verify all QTs closed in tab A
  - Tab B: verify all QTs closed
  - Verify storage cleared of all Quick Tab entries

- **Test:** "Close Minimized" button closes only minimized QTs
  - Create QT-1 (active), QT-2 (minimized), QT-3 (minimized)
  - Open Manager, click "Close Minimized"
  - Verify QT-2 and QT-3 closed
  - Verify QT-1 remains open and visible
  - Verify storage updated to remove QT-2 and QT-3

- **Test:** Restore button in Manager restores minimized QT
  - Minimize QT-1
  - Open Manager Panel in tab B
  - Click "Restore" button for QT-1
  - Verify QT-1 reappears in viewport in tab B
  - Verify indicator changes from yellow 🟡 to green 🟢

---

## Section 4: Position/Size Update Testing

### 4.1 UpdateHandler Testing Enhancement

**Location:** `tests/unit/handlers/UpdateHandler.test.js`

**Current Gap:** Position/size update propagation through storage and broadcast
layers needs comprehensive validation.

**Required Test Coverage:**

#### Test Suite: Position Update Propagation

- **Test:** Drag event triggers handlePositionChange with correct coordinates
  - Create QT at (100, 100)
  - Simulate drag event to (200, 200)
  - Verify handlePositionChange called with id, 200, 200
  - Verify broadcast sent with new position
  - Verify storage NOT updated yet (waiting for drag end)

- **Test:** Drag end triggers handlePositionChangeEnd and storage save
  - Complete drag operation
  - Trigger handlePositionChangeEnd
  - Verify broadcast sent with final position
  - Verify StorageManager.save called with updated position
  - Verify StateManager.update called

- **Test:** Rapid position changes debounce broadcasts correctly
  - Trigger 10 position changes in 100ms
  - Verify broadcasts throttled (not all 10 sent)
  - Verify final position broadcast sent after throttle delay
  - Verify no broadcast message loss

#### Test Suite: Size Update Propagation

- **Test:** Resize event triggers handleSizeChange with correct dimensions
  - Create QT with size 800×600
  - Simulate resize to 900×700
  - Verify handleSizeChange called with id, 900, 700
  - Verify broadcast sent
  - Verify storage NOT updated yet

- **Test:** Resize end triggers handleSizeChangeEnd and storage save
  - Complete resize operation
  - Trigger handleSizeChangeEnd
  - Verify broadcast sent with final size
  - Verify StorageManager.save called
  - Verify StateManager.update called

- **Test:** Minimum size constraints enforced
  - Attempt to resize QT to 50×50 (below minimum)
  - Verify size clamped to minimum (e.g., 400×300)
  - Verify broadcast reflects constrained size
  - Verify storage saves constrained size

#### Test Suite: Cross-Tab Position/Size Sync

- **Test:** Position change in tab A propagates to tab B within 100ms
  - Tab A: drag QT-1 to (300, 300)
  - Verify broadcast sent
  - Tab B: listen for broadcast
  - Verify tab B receives message within 100ms
  - Verify tab B updates QT-1 position to (300, 300)
  - Verify DOM position updated in tab B

- **Test:** Size change in tab B propagates to tab A
  - Tab B: resize QT-1 to 1000×800
  - Verify broadcast sent
  - Tab A: verify QT-1 size updates to 1000×800
  - Verify both in-memory state and DOM updated

- **Test:** Rapid tab switches preserve pending position changes
  - Tab A: start dragging QT-1
  - Mid-drag: switch to tab B (visibilitychange event)
  - Verify emergency save triggers
  - Verify current drag position saved
  - Switch back to tab A
  - Verify QT-1 at saved position

---

## Section 5: State Persistence Testing

### 5.1 StateManager Testing Enhancement

**Location:** `tests/unit/managers/StateManager.test.js`

**Current Gap:** State hydration from storage and persistence across browser
restarts need validation.

**Required Test Coverage:**

#### Test Suite: State Hydration from Storage

- **Test:** hydrate() loads all Quick Tabs from storage correctly
  - Pre-populate browser.storage.sync with 3 QT entries
  - Call StateManager.hydrate()
  - Verify in-memory state contains all 3 QTs
  - Verify each QT has correct position, size, solo/mute state, container ID

- **Test:** hydrate() handles corrupted storage entries gracefully
  - Pre-populate storage with 1 valid QT and 1 corrupted entry
  - Call hydrate()
  - Verify valid QT loaded
  - Verify corrupted entry skipped with error logged
  - Verify extension continues functioning

- **Test:** hydrate() deduplicates duplicate entries
  - Pre-populate storage with duplicate QT entries (same ID)
  - Call hydrate()
  - Verify only one QT instance in state
  - Verify most recent entry used (based on timestamp)

#### Test Suite: State Persistence to Storage

- **Test:** add() saves new Quick Tab to storage immediately
  - Create new QT with StateManager.add()
  - Verify browser.storage.sync.set called
  - Verify storage key format correct: `qt_${containerId}_${id}`
  - Verify all QT properties serialized correctly

- **Test:** update() saves changes to storage
  - Create QT, then update position
  - Call StateManager.update()
  - Verify storage updated with new position
  - Verify no other properties changed

- **Test:** remove() deletes from storage
  - Create QT, then delete
  - Call StateManager.remove()
  - Verify browser.storage.sync.remove called with correct key
  - Verify in-memory state cleared

#### Test Suite: Browser Restart Persistence

- **Test:** QT state persists across simulated browser restart
  - Create 2 QTs with specific positions, sizes, solo states
  - Save to storage
  - Clear in-memory state (simulate restart)
  - Re-initialize StateManager
  - Call hydrate()
  - Verify all QTs restored with exact same state

- **Test:** Container-specific QTs persist across restart
  - Create QT-1 in default container, QT-2 in Personal container
  - Save to storage
  - Simulate restart
  - Hydrate in default container context
  - Verify only QT-1 loaded
  - Hydrate in Personal container context
  - Verify only QT-2 loaded

---

## Section 6: Container Isolation Testing

### 6.1 Container Boundary Enforcement

**Location:** `tests/unit/coordinators/SyncCoordinator.test.js` and new
`tests/unit/containers/ContainerIsolation.test.js`

**Current Gap:** Container isolation boundaries need validation to ensure QTs
don't leak across containers.

**Required Test Coverage:**

#### Test Suite: Container Context Detection

- **Test:** detectContainerContext() correctly identifies current container
  - Mock browser.tabs.query to return cookieStoreId "firefox-container-1"
  - Call detectContainerContext()
  - Verify returned container ID is "firefox-container-1"

- **Test:** detectContainerContext() falls back to default on error
  - Mock browser.tabs.query to throw error
  - Call detectContainerContext()
  - Verify returned container ID is "firefox-default"

#### Test Suite: Container Isolation Enforcement

- **Test:** QT in container A not visible in container B
  - Create QT-1 in default container (firefox-default)
  - Switch to Personal container (firefox-container-1)
  - Initialize QuickTabsManager
  - Verify QT-1 NOT rendered in Personal container
  - Verify tabs.get('QT-1') returns undefined

- **Test:** Storage keys include container ID
  - Create QT in container "firefox-container-1"
  - Verify storage key is `qt_firefox-container-1_${id}`
  - Create QT in default container
  - Verify storage key is `qt_firefox-default_${id}`

- **Test:** Broadcast messages respect container boundaries
  - QT-1 in default container
  - QT-2 in Personal container
  - Update QT-1 position
  - Verify broadcast only affects QTs in same container
  - Verify QT-2 unchanged

#### Test Suite: Manager Panel Container Grouping

- **Test:** Manager Panel displays all containers but enforces isolation
  - Create QT-1 in default, QT-2 in Personal, QT-3 in Work
  - Open Manager Panel in default container tab
  - Verify all 3 sections visible
  - Verify QT-1, QT-2, QT-3 all listed
  - Verify clicking "Restore" on QT-2 does nothing (wrong container)

- **Test:** Container cleanup on all tabs closed
  - Create QT-1 and QT-2 in Personal container
  - Open 2 tabs in Personal container
  - Close both tabs
  - Wait for cleanup
  - Re-open Personal container tab
  - Verify QT-1 and QT-2 removed from storage (cleanup successful)

---

## Section 7: Scenario-Based Integration Tests

### 7.1 Scenario 1: Basic Quick Tab Creation & Cross-Tab Sync

**Location:** New file
`tests/integration/scenario-01-basic-cross-tab-sync.test.js`

**Test Coverage:**

```javascript
describe('Scenario 1: Basic Quick Tab Creation & Cross-Tab Sync', () => {
  test('QT persists across tabs with same position/size', async () => {
    // Setup: Simulate two browser tabs
    const tabA = await createSimulatedTab('https://wikipedia.org');
    const tabB = await createSimulatedTab('https://youtube.com');

    // Step 1: Create QT in tab A
    const qt = await tabA.createQuickTab({ url: 'https://example.com' });
    expect(qt).toBeDefined();
    expect(qt.position).toEqual({ left: 100, top: 100 }); // Default position

    // Step 2: Switch to tab B
    await switchToTab(tabB);
    await wait(200); // Allow broadcast time

    // Step 3: Verify QT appears in tab B with same position
    const qtInTabB = await tabB.getQuickTab(qt.id);
    expect(qtInTabB).toBeDefined();
    expect(qtInTabB.position).toEqual({ left: 100, top: 100 });

    // Step 4: Move QT in tab B
    await tabB.updateQuickTabPosition(qt.id, 500, 400);

    // Step 5: Switch to tab A
    await switchToTab(tabA);
    await wait(200);

    // Step 6: Verify position synced to tab A
    const qtInTabA = await tabA.getQuickTab(qt.id);
    expect(qtInTabA.position).toEqual({ left: 500, top: 400 });
  });
});
```

**Additional Scenario Tests to Add:**

- Scenario 2: Multiple Quick Tabs with Cross-Tab Sync
- Scenario 3: Solo Mode (Pin to Specific Tab)
- Scenario 4: Mute Mode (Hide on Specific Tab)
- Scenario 5: Manager Panel - Minimize/Restore
- Scenario 6: Cross-Tab Manager Sync
- Scenario 7: Position/Size Persistence
- Scenario 8: Container-Aware Grouping
- Scenario 10: Quick Tab Limit Enforcement
- Scenario 11: Emergency Position/Size Save
- Scenario 14: State Persistence Across Browser Restart

### 7.2 Cross-Tab Simulation Framework

**Location:** New file `tests/helpers/cross-tab-simulator.js`

**Required Utilities:**

```javascript
/**
 * Creates a simulated browser tab context with isolated storage and broadcast channel
 */
export async function createSimulatedTab(url, containerId = 'firefox-default') {
  // Returns object with:
  // - tabId
  // - containerId
  // - storage (isolated mock)
  // - broadcastChannel (mock)
  // - quickTabsManager (initialized instance)
  // - DOM (isolated JSDOM instance)
}

/**
 * Switches focus between simulated tabs
 */
export async function switchToTab(tab) {
  // Triggers visibilitychange event on previous tab
  // Sets new tab as active
  // Triggers focus events
}

/**
 * Simulates broadcast message propagation between tabs
 */
export async function propagateBroadcast(sourceTab, message) {
  // Sends message from sourceTab's broadcast channel
  // Delivers to all other active tabs
  // Respects container boundaries
}

/**
 * Creates multi-tab test scenario
 */
export async function createMultiTabScenario(urls) {
  // Creates multiple tabs
  // Sets up broadcast channel connections
  // Returns array of tab contexts
}
```

---

## Section 8: Testing Infrastructure Improvements

### 8.1 Mock Enhancement Requirements

#### Enhanced BroadcastChannel Mock

**Location:** `tests/__mocks__/BroadcastChannel.js` or inline in test setup

**Required Features:**

- Simulate message delivery delay (0-100ms)
- Support multiple channel instances (cross-tab simulation)
- Track all sent messages for assertions
- Allow injection of message delivery failures

#### Enhanced Storage Mock

**Location:** `tests/__mocks__/browser-storage.js`

**Required Features:**

- Simulate storage quota limits
- Simulate storage write failures
- Support multiple storage areas (sync, local)
- Track all storage operations for debugging

#### Container Context Mock

**Location:** `tests/__mocks__/browser-tabs.js`

**Required Features:**

- Mock tab creation with specific container IDs
- Mock tab query operations
- Simulate tab closure events
- Support container-specific tab tracking

### 8.2 Test Fixtures

**Location:** `tests/fixtures/quick-tabs-state.js`

**Required Fixtures:**

- Default Quick Tab state (position, size, all default values)
- Quick Tab with solo mode active
- Quick Tab with mute mode active for specific tabs
- Multiple Quick Tabs across different containers
- Corrupted storage entries for error handling tests

### 8.3 Test Utilities

**Location:** `tests/helpers/quick-tabs-test-utils.js`

**Required Utilities:**

- `waitForBroadcast(expectedAction, timeout)` - Wait for specific broadcast
  message
- `waitForStorageSave(key, timeout)` - Wait for storage operation to complete
- `assertQuickTabState(qt, expectedState)` - Deep equality check for QT state
- `createQuickTabWithDefaults(overrides)` - Factory for QT test instances
- `simulateRapidUpdates(qt, updates)` - Simulate rapid position/size changes

---

## Section 9: Coverage Gaps Analysis

### 9.1 Current Coverage vs Required Coverage

| Component           | Current Coverage | Required Coverage | Priority     |
| ------------------- | ---------------- | ----------------- | ------------ |
| BroadcastManager    | ~70%             | 95%+              | **CRITICAL** |
| SyncCoordinator     | ~60%             | 95%+              | **CRITICAL** |
| StateManager        | ~80%             | 95%+              | HIGH         |
| StorageManager      | ~85%             | 95%+              | HIGH         |
| VisibilityHandler   | ~65%             | 95%+              | **CRITICAL** |
| UpdateHandler       | ~55%             | 95%+              | **CRITICAL** |
| CreateHandler       | ~75%             | 90%+              | MEDIUM       |
| DestroyHandler      | ~70%             | 90%+              | MEDIUM       |
| PanelManager        | ~50%             | 90%+              | HIGH         |
| Container Isolation | ~40%             | 95%+              | **CRITICAL** |

### 9.2 Specific Lines/Branches Requiring Coverage

**BroadcastManager:**

- Error handling paths when BroadcastChannel.postMessage fails
- Message parsing with malformed payloads
- Channel closure and recreation logic

**SyncCoordinator:**

- Race condition handling when multiple tabs send updates simultaneously
- Emergency save trigger paths (visibilitychange, beforeunload)
- State reconciliation when storage and broadcast states diverge

**VisibilityHandler:**

- Solo mode activation/deactivation cross-tab propagation
- Mute mode with multiple tabs in muted tabs array
- Mutual exclusivity enforcement in all code paths
- Tab closure cleanup for solo/mute state

**UpdateHandler:**

- Throttling/debouncing logic for rapid updates
- Position constraint enforcement (viewport boundaries)
- Size constraint enforcement (min/max dimensions)
- Concurrent updates from multiple tabs

**PanelManager:**

- Container grouping logic
- Panel position/size persistence
- Cross-tab panel state synchronization
- Button click handlers (Close All, Close Minimized, Restore)

---

## Section 10: Implementation Roadmap

### Phase 1: Infrastructure (Week 1)

**Priority:** CRITICAL **Deliverables:**

1. Enhanced mock implementations (BroadcastChannel, Storage, Tabs)
2. Cross-tab simulation framework
3. Test fixtures and utilities
4. Update jest.config.cjs with new test paths

**Success Criteria:**

- Can simulate 3+ tabs in single test
- Can simulate broadcast propagation between tabs
- Can simulate container-specific contexts

### Phase 2: Critical Path Testing (Week 2)

**Priority:** CRITICAL **Deliverables:**

1. BroadcastManager cross-tab tests (Section 1.1)
2. SyncCoordinator position/size sync tests (Section 1.2)
3. VisibilityHandler solo/mute tests (Section 2.1-2.2)
4. UpdateHandler propagation tests (Section 4.1)

**Success Criteria:**

- Issues #35 and #51 specific test coverage in place
- All critical path tests passing
- Coverage increase to 85%+ on critical components

### Phase 3: State & Persistence Testing (Week 3)

**Priority:** HIGH **Deliverables:**

1. StateManager persistence tests (Section 5.1)
2. Container isolation tests (Section 6.1)
3. Browser restart simulation tests

**Success Criteria:**

- State persistence across browser restart validated
- Container isolation fully tested
- Coverage increase to 90%+ on state management

### Phase 4: Integration & Scenario Tests (Week 4)

**Priority:** HIGH **Deliverables:**

1. Scenario-based integration tests (Section 7.1)
2. Manager Panel synchronization tests (Section 3.1)
3. All 20 scenarios from issue-47-revised-scenarios.md covered

**Success Criteria:**

- All scenarios have corresponding integration tests
- End-to-end cross-tab behaviors validated
- Coverage target of 95%+ achieved on all components

### Phase 5: Edge Cases & Error Handling (Week 5)

**Priority:** MEDIUM **Deliverables:**

1. Error handling tests for all components
2. Edge case tests (rapid updates, concurrent operations)
3. Stress tests (many tabs, many QTs)

**Success Criteria:**

- All error paths covered
- No untested edge cases remain
- Stress tests passing

---

## Section 11: Test Execution Strategy

### 11.1 Test Organization

**Hierarchy:**

```
tests/
├── unit/                          # Component-level unit tests
│   ├── managers/
│   │   ├── BroadcastManager.test.js
│   │   ├── StateManager.test.js
│   │   ├── StorageManager.test.js
│   │   └── EventManager.test.js
│   ├── handlers/
│   │   ├── VisibilityHandler.test.js
│   │   ├── UpdateHandler.test.js
│   │   ├── CreateHandler.test.js
│   │   └── DestroyHandler.test.js
│   ├── coordinators/
│   │   ├── SyncCoordinator.test.js
│   │   └── UICoordinator.test.js
│   └── containers/
│       └── ContainerIsolation.test.js    # NEW
│
├── integration/                   # Multi-component integration tests
│   ├── scenario-01-basic-cross-tab-sync.test.js    # NEW
│   ├── scenario-02-multiple-qts.test.js            # NEW
│   ├── scenario-03-solo-mode.test.js               # NEW
│   ├── scenario-04-mute-mode.test.js               # NEW
│   ├── scenario-05-manager-minimize.test.js        # NEW
│   └── ...                        # All 20 scenarios
│
├── helpers/
│   ├── cross-tab-simulator.js     # NEW - Cross-tab simulation framework
│   ├── quick-tabs-test-utils.js   # NEW - Common test utilities
│   └── ...
│
├── fixtures/
│   ├── quick-tabs-state.js        # NEW - Test data fixtures
│   └── ...
│
└── __mocks__/
    ├── BroadcastChannel.js         # ENHANCED
    ├── browser-storage.js          # ENHANCED
    └── browser-tabs.js             # ENHANCED
```

### 11.2 Test Execution Commands

**Run all new cross-tab tests:**

```bash
npm test -- --testPathPattern="cross-tab"
```

**Run scenario-based integration tests:**

```bash
npm test -- --testPathPattern="integration/scenario"
```

**Run critical path tests only:**

```bash
npm test -- --testPathPattern="(BroadcastManager|SyncCoordinator|VisibilityHandler|UpdateHandler)"
```

**Run with coverage report:**

```bash
npm run test:coverage -- --testPathPattern="unit"
```

**Watch mode for specific component:**

```bash
npm run test:watch:unit -- --testPathPattern="VisibilityHandler"
```

### 11.3 Continuous Integration

**Add to `.github/workflows/test.yml`:**

```yaml
- name: Run Critical Path Tests
  run:
    npm test --
    --testPathPattern="(BroadcastManager|SyncCoordinator|VisibilityHandler|UpdateHandler)"
    --coverage

- name: Run Integration Tests
  run: npm test -- --testPathPattern="integration" --coverage

- name: Check Coverage Thresholds
  run: |
    npm run test:coverage -- --coverageThreshold='{
      "global": {
        "branches": 85,
        "functions": 90,
        "lines": 90,
        "statements": 90
      }
    }'
```

---

## Section 12: Success Metrics

### 12.1 Quantitative Metrics

**Coverage Targets:**

- **Overall Extension Coverage:** 85%+ (up from current ~70%)
- **Critical Components Coverage:** 95%+
  - BroadcastManager: 95%+
  - SyncCoordinator: 95%+
  - VisibilityHandler: 95%+
  - UpdateHandler: 95%+
  - StateManager: 95%+
  - Container Isolation: 95%+

**Test Count Targets:**

- **Unit Tests:** 150+ (from current ~80)
- **Integration Tests:** 30+ (from current ~5)
- **Scenario-Based Tests:** 20 (mapping to all issue-47 scenarios)

### 12.2 Qualitative Metrics

**Regression Prevention:**

- [ ] Issue #35 specific test cases prevent recurrence
- [ ] Issue #51 specific test cases prevent recurrence
- [ ] All 20 scenarios from issue-47-revised-scenarios.md have tests
- [ ] Cross-tab synchronization validated in all code paths

**Test Maintainability:**

- [ ] Test utilities reduce code duplication
- [ ] Fixtures provide consistent test data
- [ ] Cross-tab simulator enables complex scenarios
- [ ] Tests are self-documenting and clear

**Development Velocity:**

- [ ] Tests catch regressions before merge
- [ ] Test failures provide actionable debugging info
- [ ] Test execution time remains under 5 minutes for full suite

---

## Section 13: Key Implementation Notes

### 13.1 Critical Testing Principles

1. **Broadcast Latency Awareness**
   - Always add 100-200ms wait after triggering actions that require broadcast
   - Use `waitForBroadcast()` utility instead of fixed `setTimeout`
   - Test both immediate response (broadcast sent) and eventual consistency
     (broadcast received)

2. **Container Isolation Enforcement**
   - Every test that creates QTs should specify container context explicitly
   - Verify container boundaries in cross-tab tests
   - Mock container IDs consistently (`firefox-default`, `firefox-container-1`,
     etc.)

3. **State Immutability**
   - Never mutate shared state between tests
   - Use `beforeEach` to reset all mocks and state
   - Isolate storage mocks per test or test suite

4. **Async Timing**
   - Use `async/await` consistently throughout tests
   - Use `flush-promises` or `waitFor` utilities for async state updates
   - Avoid fixed `setTimeout` - use condition-based waiting

### 13.2 Common Pitfalls to Avoid

**Pitfall 1: Testing Implementation Instead of Behavior**

- ❌ Bad: `expect(broadcastManager.postMessage).toHaveBeenCalledWith({...})`
- ✅ Good:
  `expect(await tabB.getQuickTab(id).position).toEqual({left: 200, top: 200})`

**Pitfall 2: Not Simulating Cross-Tab Context**

- ❌ Bad: Test updates position in same manager instance
- ✅ Good: Test updates position in tab A, verify visible in tab B with separate
  manager instance

**Pitfall 3: Ignoring Storage Latency**

- ❌ Bad: `manager.updatePosition(); expect(storage.save).toHaveBeenCalled()`
- ✅ Good:
  `await manager.updatePosition(); await waitForStorageSave(); expect(...)`

**Pitfall 4: Not Testing Solo/Mute Mutual Exclusivity**

- ❌ Bad: Test solo mode activation in isolation
- ✅ Good: Test solo activates, then verify mute button disabled, then attempt
  mute click, verify no change

### 13.3 Debugging Failed Tests

**When cross-tab tests fail:**

1. Check broadcast message propagation using `console.log` in mock
   BroadcastChannel
2. Verify tab contexts are properly isolated (separate storage, DOM)
3. Check timing - add more wait time if broadcast hasn't propagated
4. Verify container IDs match between tabs

**When state persistence tests fail:**

1. Log storage contents before and after operations
2. Check storage key format matches expected pattern
3. Verify hydration logic correctly parses stored data
4. Check for race conditions between save operations

---

## Section 14: Documentation & Maintenance

### 14.1 Test Documentation Standards

**Every test file should include:**

```javascript
/**
 * Component: [Component Name]
 * Purpose: [Brief description of what component does]
 *
 * Test Coverage:
 * - [Behavior 1]
 * - [Behavior 2]
 * - [Edge case 1]
 *
 * Related Issue: #[issue number]
 * Related Scenario: [Scenario number from issue-47-revised-scenarios.md]
 */
```

**Every test suite should include:**

```javascript
describe('Component - Specific Behavior', () => {
  /**
   * Prerequisites:
   * - [Setup requirement 1]
   * - [Setup requirement 2]
   *
   * Validates:
   * - [Expected outcome 1]
   * - [Expected outcome 2]
   */
  test('should [specific behavior]', async () => {
    // Arrange
    // Act
    // Assert
  });
});
```

### 14.2 Test Maintenance Schedule

**Weekly:**

- Review failed CI test runs
- Update tests for any behavior changes
- Refactor duplicated test code into utilities

**Monthly:**

- Review coverage reports for gaps
- Update fixtures with new edge cases
- Optimize slow-running tests

**Per Release:**

- Add scenario-based tests for new features
- Deprecate tests for removed features
- Update test documentation

### 14.3 Contributing Guidelines for Tests

**When adding new Quick Tab features:**

1. Write scenario-based integration test first (TDD approach)
2. Add unit tests for new components/methods
3. Update cross-tab simulation tests if feature involves synchronization
4. Update coverage thresholds in jest.config.cjs
5. Document new test utilities in README

**When fixing bugs:**

1. Write regression test reproducing the bug
2. Verify test fails with current code
3. Fix bug
4. Verify test passes
5. Add test to CI regression suite

---

## Appendix A: Test Bridge Usage

The extension already has a Test Bridge API (`window.__COPILOT_TEST_BRIDGE__`)
that can be used for programmatic testing in E2E tests. Unit tests should mock
components directly, but integration tests can leverage the Test Bridge.

**Example Test Bridge Usage:**

```javascript
// Create Quick Tab programmatically
await page.evaluate(async () => {
  const bridge = window.__COPILOT_TEST_BRIDGE__;
  await bridge.createQuickTab({
    url: 'https://example.com',
    left: 100,
    top: 100
  });
});

// Get all Quick Tabs
const tabs = await page.evaluate(async () => {
  const bridge = window.__COPILOT_TEST_BRIDGE__;
  return await bridge.getQuickTabs();
});
```

**Integration tests should use Test Bridge when:**

- Testing full lifecycle (create → update → close)
- Testing cross-tab synchronization with real DOM
- Validating container isolation with real browser.tabs API

**Unit tests should NOT use Test Bridge:**

- Test components in isolation
- Mock dependencies
- Focus on single responsibility

---

## Appendix B: References

**Related Issues:**

- [Issue #35: Quick Tabs don't persist across tabs](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition/issues/35)
- [Issue #51: Quick Tabs' Size and Position are Unable to Update and Transfer Over Between Tabs](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition/issues/51)
- [Issue #47: Quick Tabs – Comprehensive Behavior Scenarios](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition/issues/47)

**Related Documentation:**

- [issue-47-revised-scenarios.md](./issue-47-revised-scenarios.md) - All 20
  behavior scenarios
- [TESTING-SUMMARY-ISSUE-47.md](./TESTING-SUMMARY-ISSUE-47.md) - Previous
  testing summary

**Codebase Locations:**

- Quick Tabs Manager: `src/features/quick-tabs/index.js`
- BroadcastManager: `src/features/quick-tabs/managers/BroadcastManager.js`
- SyncCoordinator: `src/features/quick-tabs/coordinators/SyncCoordinator.js`
- VisibilityHandler: `src/features/quick-tabs/handlers/VisibilityHandler.js`
- UpdateHandler: `src/features/quick-tabs/handlers/UpdateHandler.js`

---

## Conclusion

This comprehensive testing strategy addresses the root causes of issues #35 and
#51 by:

1. **Validating cross-tab synchronization** through enhanced BroadcastManager
   and SyncCoordinator tests
2. **Ensuring state persistence** through StateManager and StorageManager tests
3. **Verifying solo/mute behaviors** through VisibilityHandler tests with mutual
   exclusivity validation
4. **Confirming position/size updates** through UpdateHandler tests with
   cross-tab propagation
5. **Enforcing container isolation** through dedicated container boundary tests
6. **Covering all scenarios** from issue-47-revised-scenarios.md with
   integration tests

**Implementation of this strategy will:**

- Increase overall coverage from ~70% to 85%+
- Achieve 95%+ coverage on critical components
- Add 70+ new tests (150+ total unit tests, 30+ integration tests)
- Establish cross-tab simulation framework for future testing
- Prevent regression of issues #35, #51, and related cross-tab synchronization
  bugs

**Next Steps:**

1. Review and approve this testing strategy
2. Begin Phase 1 (Infrastructure) implementation
3. Implement tests in priority order (CRITICAL → HIGH → MEDIUM)
4. Monitor coverage metrics weekly
5. Iterate based on test failures and gaps discovered

---

**Document Prepared By:** AI Assistant (Perplexity)  
**Review Required By:** ChunkyNosher  
**Target Completion Date:** 5 weeks from approval  
**Document Status:** DRAFT - Pending Review
