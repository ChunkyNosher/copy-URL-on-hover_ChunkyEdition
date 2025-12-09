# Critical Architecture Flaw: Firefox Sidebar Cannot Access Content Script State

**Document Version:** 2.0  
**Extension Version:** v1.6.3  
**Date:** November 27, 2025  
**Issue:** Quick Tab Manager sidebar displays no Quick Tabs despite them being
opened  
**Root Cause:** Firefox WebExtension context isolation prevents sidebar from
accessing content script memory

---

## Executive Summary

**CRITICAL DISCOVERY:** The Quick Tab Manager sidebar
(`sidebar/quick-tabs-manager.js`) and the page-injected Quick Tab system
(`src/features/quick-tabs/`) exist in **completely isolated JavaScript execution
contexts**. They **CANNOT share memory, objects, or event buses**.

### The Fundamental Problem

1. **Quick Tabs** are created and managed by content scripts running in page
   context
2. **Quick Tab Manager sidebar** runs in extension page context (separate
   process/scope)
3. **Firefox WebExtension security model prevents direct communication between
   these contexts**
4. The codebase was architecturally designed assuming they share
   memory/EventBus - **they do not**

### Current (Broken) Architecture

```
┌─────────────────────────────────────────────────┐
│         PAGE CONTEXT (Content Script)           │
│                                                  │
│  ┌────────────────────────────────────┐         │
│  │   QuickTabsManager                 │         │
│  │   - StateManager (in-memory Map)   │         │
│  │   - EventBus (state:added events)  │         │
│  │   - QuickTab DOM elements          │         │
│  └────────────────────────────────────┘         │
│                                                  │
│  EventBus.emit('state:added') ────────X         │  ❌ Event never leaves this context
│                                                  │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│      EXTENSION CONTEXT (Sidebar)                │
│                                                  │
│  ┌────────────────────────────────────┐         │
│  │   sidebar/quick-tabs-manager.js    │         │
│  │   - Reads browser.storage.sync     │         │  ❌ WRONG storage location (should be .local)
│  │   - Polls storage every 2 seconds  │         │
│  │   - No access to page EventBus     │         │  ❌ Cannot receive state:added events
│  │   - No access to StateManager Map  │         │  ❌ Cannot query in-memory state
│  └────────────────────────────────────┘         │
│                                                  │
└─────────────────────────────────────────────────┘
```

**Result:** Sidebar never sees Quick Tabs because it's looking in the wrong
place with the wrong communication method.

---

## Detailed Problem Analysis

### Problem #1: Sidebar Uses Wrong Storage Location

**File:** `sidebar/quick-tabs-manager.js` lines 106-118

```javascript
/**
 * Load Quick Tabs state from browser.storage.sync
 */
async function loadQuickTabsState() {
  try {
    const result = await browser.storage.sync.get(STATE_KEY); // ❌ WRONG!

    if (result && result[STATE_KEY]) {
      quickTabsState = result[STATE_KEY];
    } else {
      quickTabsState = {};
    }

    console.log('Loaded Quick Tabs state:', quickTabsState);
  } catch (err) {
    console.error('Error loading Quick Tabs state:', err);
  }
}
```

**Why This Fails:**

- Quick Tabs store state in `browser.storage.local` since v1.6.0.12 (migration
  to avoid quota limits)
- Sidebar reads from `browser.storage.sync` which is **empty**
- No error thrown, sidebar just sees `{}`
- Extension logs confirm: "Loaded Quick Tabs state: {}" repeated every 2 seconds

**Evidence from Logs:**

```
LOG DEBUG PanelContentManager Storage changed from another tab - updating content
```

This proves the page-context panel detects storage changes, but sidebar never
receives them because it's reading the wrong storage area.

---

### Problem #2: Sidebar Cannot Access Content Script EventBus

**File:** `sidebar/quick-tabs-manager.js` - No event listener setup

The sidebar has **NO CODE** to listen for `state:added`, `state:updated`, or
`state:deleted` events from the content script's EventBus.

**Why This Fails:**

- Content script emits events via `StateManager` (line 51-55 in
  StateManager.js):
  ```javascript
  this.eventBus?.emit('state:added', { quickTab });
  ```
- These events fire in **page JavaScript context**
- Sidebar runs in **extension page context** (isolated environment)
- Firefox **does NOT allow** EventBus events to cross context boundaries
- MDN Documentation confirms: _"Content scripts and extension pages do not share
  scope or memory. They must use explicit messaging APIs."_

**Missing Communication Bridge:**

```
Content Script EventBus → ??? → Sidebar
                         (No bridge exists!)
```

---

### Problem #3: Sidebar Polls Storage Instead of Listening for Events

**File:** `sidebar/quick-tabs-manager.js` lines 30-35

```javascript
// Auto-refresh every 2 seconds
setInterval(async () => {
  await loadQuickTabsState();
  renderUI();
}, 2000);
```

**Why This Is Insufficient:**

1. **Reads wrong storage** (`storage.sync` instead of `storage.local`)
2. **2-second delay** means UI is always stale
3. **No real-time updates** - even if storage location were correct
4. **Wastes resources** - polling when event-driven approach should be used

**What SHOULD Happen:**

- Content script writes to `storage.local`
- Sidebar listens to `browser.storage.onChanged` for `storage.local` changes
- Sidebar updates UI immediately when storage changes

**Current Implementation of storage.onChanged:**

```javascript
// Listen for storage changes to auto-update
browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes[STATE_KEY]) {
    // ❌ Listening to WRONG area!
    loadQuickTabsState().then(() => {
      renderUI();
    });
  }
});
```

Should be:

```javascript
if (areaName === 'local' && changes[STATE_KEY]) {  // ✅ Correct area
```

---

### Problem #4: Page-Context Panel vs Sidebar Confusion

**Critical Architectural Misunderstanding:**

There are **TWO separate Quick Tab Managers** in the codebase:

#### Manager #1: Page-Context Floating Panel (WORKS)

- **Location:** `src/features/quick-tabs/panel/PanelContentManager.js`
- **Context:** Runs in page as injected content script
- **Access:** Has direct access to `QuickTabsManager`, `StateManager`,
  `EventBus`
- **Communication:** Shares memory with Quick Tabs (same JS context)
- **Status:** ✅ Functions correctly, updates in real-time

#### Manager #2: Sidebar Manager (BROKEN)

- **Location:** `sidebar/quick-tabs-manager.js`
- **Context:** Runs in extension page context (isolated from page)
- **Access:** NO access to page memory, EventBus, or StateManager
- **Communication:** Must use storage or message passing APIs
- **Status:** ❌ Completely broken, never displays Quick Tabs

**The logs you provided show PanelContentManager working correctly** - but
that's the wrong manager. The sidebar manager is the one failing.

---

### Problem #5: Content Script Never Writes to Storage

**Critical Missing Functionality:**

Looking at `StateManager.js`, the in-memory state manager **ONLY emits
events** - it **NEVER writes to browser.storage**:

```javascript
// StateManager.js line 51-55
add(quickTab) {
  // ... validation ...
  this.quickTabs.set(quickTab.id, quickTab);  // ✅ Updates in-memory Map

  this.eventBus?.emit('state:added', { quickTab });  // ✅ Emits event (page context only)

  // ❌ NO call to browser.storage.local.set()!
  console.log(`[StateManager] Added Quick Tab: ${quickTab.id}`);
}
```

**Why This Breaks Cross-Context Communication:**

1. Content script creates Quick Tab
2. StateManager updates in-memory Map
3. StateManager emits `state:added` event
4. Event reaches PanelContentManager (same context) ✅
5. Event NEVER reaches sidebar (different context) ❌
6. **No storage write happens** ❌
7. Sidebar polling finds empty storage ❌

**Expected Flow:**

```javascript
add(quickTab) {
  this.quickTabs.set(quickTab.id, quickTab);
  this.eventBus?.emit('state:added', { quickTab });

  // ✅ MUST persist to storage for cross-context sync
  await this.persistToStorage();
}
```

---

## Evidence from Extension Logs

Analyzing the provided log file
(`copy-url-extension-logs_v1.6.3_2025-11-28T03-23-58.txt`):

```
2025-11-28T03:23:45.093Z LOG EventManager Tab visible - triggering state refresh
2025-11-28T03:23:46.619Z LOG VisibilityHandler Bringing to front qt-1764300180379-0r3dfj6g1
2025-11-28T03:23:46.700Z LOG DestroyHandler Handling destroy for qt-1764300180379-0r3dfj6g1
2025-11-28T03:23:47.416Z LOG VisibilityHandler Bringing to front qt-1764300179595-soeg2mb5a
2025-11-28T03:23:47.503Z LOG DestroyHandler Handling destroy for qt-1764300179595-soeg2mb5a
```

**What This Shows:**

- Quick Tabs ARE being created (IDs like `qt-1764300179595-soeg2mb5a`)
- VisibilityHandler and DestroyHandler are functioning
- State events ARE firing in content script context
- BUT: No logs from sidebar manager show it receiving these updates

**Missing Logs:**

- No "Loaded Quick Tabs state: <data>" with actual Quick Tab objects
- No "Loaded Quick Tabs state:" showing container format or unified format
- Only empty state: "Loaded Quick Tabs state: {}"

---

## Mozilla Documentation Evidence

### MDN: Content Scripts Isolation

> _"Content scripts run in a separate execution context from page scripts and
> from other parts of the extension... They do not have direct access to
> JavaScript objects from the page or extension pages."_  
> — [MDN Web Docs: Content Scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts)

### MDN: Sidebar Actions

> _"Sidebar panels do not have access to the DOM of the web page in the active
> tab. They run in their own process and their own context."_  
> — [MDN Web Docs: Sidebar Actions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/user_interface/Sidebars)

### MDN: Cross-Context Communication

> _"To communicate between content scripts and extension pages (popup, sidebar,
> options), you must use:_  
> _1. `browser.runtime.sendMessage()` / `onMessage`_  
> _2. `browser.storage` with `onChanged` listeners"_  
> — [MDN Web Docs: Messaging](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts#communicating_with_background_scripts)

---

## Complete List of Bugs to Fix

### Bug #1: Sidebar Reads Wrong Storage Location

**File:** `sidebar/quick-tabs-manager.js` line 107  
**Current:** `browser.storage.sync.get(STATE_KEY)`  
**Fix:** `browser.storage.local.get(STATE_KEY)`

**Scope:** Change all 6 occurrences of `storage.sync` to `storage.local`:

- Line 107: `loadQuickTabsState()` - read operation
- Line 229: `storage.onChanged.addListener` - listener filter
- Line 248: `closeMinimizedTabs()` - read before write
- Line 273: `closeMinimizedTabs()` - write operation
- Line 290: `closeAllTabs()` - remove operation

---

### Bug #2: StateManager Never Persists to Storage

**File:** `src/features/quick-tabs/managers/StateManager.js`  
**Missing:** Storage persistence in `add()`, `update()`, `delete()`, `clear()`

**Add New Method:**

```javascript
/**
 * Persist current state to browser.storage.local
 * Writes unified format for v1.6.2.2+ compatibility
 */
async persistToStorage() {
  try {
    const tabs = this.getAll().map(qt => qt.toStorageFormat());

    const state = {
      tabs: tabs,
      timestamp: Date.now(),
      saveId: this._generateSaveId()
    };

    await browser.storage.local.set({
      quick_tabs_state_v2: state
    });

    console.log(`[StateManager] Persisted ${tabs.length} Quick Tabs to storage`);
  } catch (err) {
    console.error('[StateManager] Failed to persist to storage:', err);
  }
}

_generateSaveId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
```

**Call From:**

- `add()` after line 55: `await this.persistToStorage();`
- `update()` after line 79: `await this.persistToStorage();`
- `delete()` after line 93: `await this.persistToStorage();`
- `clear()` after line 204: `await this.persistToStorage();`

---

### Bug #3: QuickTab Domain Entity Missing Storage Format Method

**File:** `src/domain/QuickTab.js` (likely location)  
**Missing:** `toStorageFormat()` method referenced in Bug #2 fix

**Add Method:**

```javascript
/**
 * Convert QuickTab to storage format for persistence
 * Compatible with v1.6.2.2+ unified format
 * @returns {Object} Storage-compatible representation
 */
toStorageFormat() {
  return {
    id: this.id,
    url: this.url,
    title: this.title,
    activeTabId: this.sourceTabId,
    minimized: this.visibility?.minimized ?? false,
    soloedOnTabs: this.visibility?.soloedOnTabs ?? [],
    mutedOnTabs: this.visibility?.mutedOnTabs ?? [],
    width: this.size?.width ?? 400,
    height: this.size?.height ?? 300,
    left: this.position?.left ?? 100,
    top: this.position?.top ?? 100,
    slot: this.slot ?? null,
    timestamp: Date.now()
  };
}
```

---

### Bug #4: Sidebar Tries to Send Messages to Content Scripts

**File:** `sidebar/quick-tabs-manager.js` lines 310-350

**Problem:** Sidebar uses `browser.tabs.sendMessage()` to send actions like:

- `MINIMIZE_QUICK_TAB`
- `RESTORE_QUICK_TAB`
- `CLOSE_QUICK_TAB`

**Why This MIGHT Fail:**

- Content scripts may not have message handlers for these actions
- Need to verify `src/content.js` has handlers registered

**Investigation Required:** Search `src/content.js` for:

```javascript
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'MINIMIZE_QUICK_TAB') {
    // Handler code
  }
});
```

If handlers missing, content script will silently ignore messages.

---

### Bug #5: Sidebar Uses Deprecated Container Format

**File:** `sidebar/quick-tabs-manager.js` lines 160-210

**Problem:** `renderUI()` expects old container-based storage format:

```javascript
Object.keys(quickTabsState).forEach(cookieStoreId => {
  const containerState = quickTabsState[cookieStoreId];
  // ...
});
```

**Reality:** Since v1.6.2.2, storage uses unified format:

```javascript
{
  tabs: [ /* array of Quick Tab objects */ ],
  timestamp: 1234567890,
  saveId: "abc123"
}
```

**Fix Required:** Replace container iteration with unified format handling:

```javascript
function renderUI() {
  // Handle unified format (v1.6.2.2+)
  const state = quickTabsState;

  if (!state || !state.tabs || !Array.isArray(state.tabs)) {
    // No Quick Tabs or invalid format
    totalTabsEl.textContent = '0 Quick Tabs';
    containersList.style.display = 'none';
    emptyState.style.display = 'flex';
    return;
  }

  const allTabs = state.tabs;
  const totalTabs = allTabs.length;

  // Update stats
  totalTabsEl.textContent = `${totalTabs} Quick Tab${totalTabs !== 1 ? 's' : ''}`;

  // ... rest of rendering logic using allTabs array
}
```

---

### Bug #6: No Automatic Storage Hydration on Page Load

**Problem:** When user opens a new tab/page, content script does NOT check
storage for existing Quick Tabs.

**Expected Behavior:**

1. Content script initializes QuickTabsManager
2. QuickTabsManager reads `browser.storage.local`
3. If Quick Tabs exist in storage, recreate DOM elements
4. Apply visibility rules (solo/mute/minimized)

**Current Behavior:**

- QuickTabsManager initializes with empty state
- User must manually trigger state refresh
- Quick Tabs "lost" on page reload

**Fix Location:** `src/features/quick-tabs/index.js` (QuickTabsManager
constructor or init)

**Add Hydration:**

```javascript
async init() {
  // ... existing initialization ...

  // Hydrate from storage
  await this.hydrateFromStorage();
}

async hydrateFromStorage() {
  try {
    const result = await browser.storage.local.get('quick_tabs_state_v2');

    if (!result || !result.quick_tabs_state_v2) {
      console.log('[QuickTabsManager] No stored state to hydrate');
      return;
    }

    const state = result.quick_tabs_state_v2;

    if (state.tabs && Array.isArray(state.tabs)) {
      console.log(`[QuickTabsManager] Hydrating ${state.tabs.length} Quick Tabs from storage`);

      for (const tabData of state.tabs) {
        // Reconstruct QuickTab and UI
        await this.createFromStorageData(tabData);
      }

      this.eventBus?.emit('state:hydrated', { count: state.tabs.length });
    }
  } catch (err) {
    console.error('[QuickTabsManager] Hydration failed:', err);
  }
}
```

---

## Architecture Redesign Proposal

### Current (Broken) Flow

```
User Creates Quick Tab
        ↓
QuickTabsManager (content script)
        ↓
StateManager.add()
        ↓
Update in-memory Map ✅
        ↓
Emit state:added event ✅
        ↓
PanelContentManager receives event ✅  (same context)
        ↓
❌ NO storage write
        ↓
Sidebar polls storage.sync every 2s ❌ (wrong location, finds nothing)
```

### Proposed (Working) Flow

```
User Creates Quick Tab
        ↓
QuickTabsManager (content script)
        ↓
StateManager.add()
        ↓
Update in-memory Map ✅
        ↓
Emit state:added event ✅
        ↓
Write to browser.storage.local ✅ (NEW)
        ↓
────────────────────────────────────────────
        ↓ storage.onChanged fires
        ↓
Sidebar storage.onChanged listener ✅
        ↓
Read from storage.local ✅
        ↓
Parse unified format ✅
        ↓
Render UI with Quick Tabs ✅
```

---

## Implementation Checklist

### Phase 1: Fix Storage Location (Immediate)

- [ ] Change `sidebar/quick-tabs-manager.js` line 107: `storage.sync` →
      `storage.local`
- [ ] Change `sidebar/quick-tabs-manager.js` line 229: listener filter to
      `'local'`
- [ ] Change all 4 storage operations in sidebar to use `storage.local`
- [ ] Test: Sidebar should now see storage changes (but still no data because
      nothing writes)

### Phase 2: Add Storage Persistence (Critical)

- [ ] Add `persistToStorage()` method to `StateManager.js`
- [ ] Add `toStorageFormat()` method to `QuickTab.js` domain entity
- [ ] Call `persistToStorage()` from `add()`, `update()`, `delete()`, `clear()`
- [ ] Test: Storage writes should appear in browser DevTools → Storage → Local
      Storage

### Phase 3: Fix Sidebar Format Handling (High Priority)

- [ ] Refactor `sidebar/quick-tabs-manager.js` `renderUI()` to handle unified
      format
- [ ] Remove container-based iteration logic
- [ ] Parse `state.tabs` array directly
- [ ] Test: Sidebar should display Quick Tabs after storage write

### Phase 4: Add Storage Hydration (High Priority)

- [ ] Add `hydrateFromStorage()` to `QuickTabsManager`
- [ ] Call during initialization
- [ ] Recreate Quick Tab DOM elements from storage data
- [ ] Test: Quick Tabs persist across page reload

### Phase 5: Verify Message Handlers (Medium Priority)

- [ ] Search `src/content.js` for message handlers
- [ ] Verify `MINIMIZE_QUICK_TAB`, `RESTORE_QUICK_TAB`, `CLOSE_QUICK_TAB`
      handlers exist
- [ ] If missing, implement handlers that call QuickTabsManager methods
- [ ] Test: Sidebar buttons should trigger actions in content script

### Phase 6: Remove Polling (Low Priority - Optimization)

- [ ] Remove 2-second `setInterval` from sidebar
- [ ] Rely entirely on `storage.onChanged` for updates
- [ ] Add manual refresh button for user-triggered updates
- [ ] Test: Sidebar updates immediately on storage change (no 2s delay)

---

## Testing Strategy

### Test Case 1: Basic Storage Write/Read

**Setup:** Extension loaded, no Quick Tabs open

**Procedure:**

1. Open browser DevTools → Storage → Extension Storage → Local Storage
2. Open a Quick Tab using extension shortcut
3. Immediately check DevTools storage

**Expected Result:**

- Key `quick_tabs_state_v2` appears in Local Storage
- Value contains `{ tabs: [{...}], timestamp: ..., saveId: "..." }`
- `tabs` array has 1 object with Quick Tab data

**Pass Criteria:**

- Storage write happens within 100ms of Quick Tab creation
- Storage format is unified v1.6.2.2+ format (not container format)

---

### Test Case 2: Sidebar Displays Quick Tabs

**Setup:** Extension loaded with fixes from Phase 1-3

**Procedure:**

1. Open Quick Tab on page
2. Wait 200ms for storage write
3. Open sidebar (Alt+Shift+S)
4. Observe sidebar UI

**Expected Result:**

- Sidebar shows "1 Quick Tab"
- Quick Tab item appears with:
  - Favicon or placeholder icon
  - Page title
  - Active status (green indicator)
  - Minimize and Close buttons

**Pass Criteria:**

- Quick Tab visible in sidebar within 500ms of creation
- No "No Quick Tabs" empty state message

---

### Test Case 3: Quick Tabs Persist Across Page Reload

**Setup:** Quick Tab open on page, storage hydration implemented

**Procedure:**

1. Create 2 Quick Tabs on page
2. Verify both appear in sidebar
3. Press F5 to reload page
4. Wait for page load + content script initialization

**Expected Result:**

- Both Quick Tabs reappear in DOM after reload
- Sidebar continues showing 2 Quick Tabs
- Quick Tab positions/sizes preserved
- Minimized state preserved

**Pass Criteria:**

- No Quick Tabs lost on reload
- DOM elements recreated with same IDs
- Storage remains unchanged after reload

---

### Test Case 4: Sidebar Buttons Control Quick Tabs

**Setup:** Quick Tab visible on page, sidebar open

**Procedure:**

1. Click "Minimize" button in sidebar for Quick Tab
2. Observe page viewport and sidebar UI
3. Click "Restore" button in sidebar
4. Observe page viewport and sidebar UI

**Expected Result:**

- Minimize: Quick Tab shrinks to compact state, sidebar shows yellow indicator
- Restore: Quick Tab expands to full size, sidebar shows green indicator
- Changes happen immediately (<100ms)

**Pass Criteria:**

- Sidebar actions trigger content script handlers
- UI updates in both sidebar and page
- No console errors

---

### Test Case 5: Close All Clears Storage

**Setup:** Multiple Quick Tabs open

**Procedure:**

1. Create 3 Quick Tabs
2. Verify all 3 in sidebar
3. Click "Close All" button in sidebar
4. Check DevTools storage

**Expected Result:**

- All 3 Quick Tabs disappear from page
- Sidebar shows "No Quick Tabs" empty state
- Storage shows: `{ tabs: [], timestamp: ..., saveId: "..." }`

**Pass Criteria:**

- DOM elements removed from page
- Storage cleared (empty tabs array)
- Sidebar updates to empty state

---

## Firefox WebExtension API References

### Storage API (Correct Usage)

```javascript
// ✅ Write to local storage
await browser.storage.local.set({ key: value });

// ✅ Read from local storage
const result = await browser.storage.local.get('key');

// ✅ Listen for local storage changes
browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.key) {
    console.log('Key changed:', changes.key.newValue);
  }
});
```

### Messaging API (Cross-Context)

```javascript
// ✅ Sidebar → Content Script
// In sidebar:
await browser.tabs.sendMessage(tabId, { action: 'DO_SOMETHING' });

// In content script:
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'DO_SOMETHING') {
    // Handle action
    sendResponse({ success: true });
  }
  return true; // Keep channel open for async response
});
```

### Storage Quota Limits

- **storage.sync:** 100 KB total, 8 KB per item
- **storage.local:** ~5 MB (Firefox), ~10 MB (Chrome) - varies by browser
- **Why migration happened:** Quick Tabs data exceeded sync quota limits

---

## Known Limitations (Platform)

### Limitation #1: No Shared Memory Between Contexts

**Impact:** Sidebar cannot directly access `StateManager` Map or EventBus  
**Mitigation:** Must use storage or message passing for all communication  
**Documentation:** [MDN - Content Scripts][65]

### Limitation #2: storage.onChanged Doesn't Fire in Origin Tab

**Impact:** Content script making storage change won't receive its own
`onChanged` event  
**Mitigation:** Content script must update its own state directly (already does
via StateManager)  
**Code Location:** Already handled correctly in content script

### Limitation #3: Sidebar Cannot Access Page DOM

**Impact:** Sidebar cannot query for `.quick-tab-window` elements in page  
**Mitigation:** Must rely on storage or query active tab via messaging API  
**Documentation:** [MDN - Sidebar Actions][62]

---

## Summary of Required Changes

| File                                               | Changes                                               | Lines                            | Priority     |
| -------------------------------------------------- | ----------------------------------------------------- | -------------------------------- | ------------ |
| `sidebar/quick-tabs-manager.js`                    | Change `storage.sync` → `storage.local` (6 locations) | 107, 229, 248, 273, 290, 310-350 | **CRITICAL** |
| `sidebar/quick-tabs-manager.js`                    | Refactor `renderUI()` for unified format              | 122-210                          | **HIGH**     |
| `src/features/quick-tabs/managers/StateManager.js` | Add `persistToStorage()` method                       | New method ~30 lines             | **CRITICAL** |
| `src/features/quick-tabs/managers/StateManager.js` | Call `persistToStorage()` from CRUD methods           | 4 call sites                     | **CRITICAL** |
| `src/domain/QuickTab.js`                           | Add `toStorageFormat()` method                        | New method ~20 lines             | **CRITICAL** |
| `src/features/quick-tabs/index.js`                 | Add `hydrateFromStorage()` method                     | New method ~40 lines             | **HIGH**     |
| `src/content.js`                                   | Verify message handlers exist                         | Investigation                    | **MEDIUM**   |

**Total Estimated Changes:** ~150 lines of new code, ~30 lines modified  
**Complexity:** Medium (storage API, format handling, async/await)  
**Risk:** Low (changes isolated to specific modules, no breaking changes to
existing functionality)

---

## Conclusion

The Quick Tab Manager sidebar is fundamentally broken due to **architectural
assumptions that violate Firefox WebExtension security model**. The fix
requires:

1. **Change storage location:** `storage.sync` → `storage.local`
2. **Add storage persistence:** StateManager must write to storage on every
   state change
3. **Fix format handling:** Sidebar must parse unified format instead of
   container format
4. **Add hydration:** Content script must restore Quick Tabs from storage on
   page load

**None of these changes are complex** - they're straightforward storage API
calls and format parsing. The difficulty was in **identifying the root cause** -
which is that sidebar and content script cannot share memory/EventBus.

**Estimated Implementation Time:** 4-6 hours for experienced developer  
**Testing Time:** 2-3 hours to validate all scenarios  
**Total Time:** 6-9 hours to fully resolve issue

---

**Document End** | Version 2.0 | Generated: 2025-11-27 22:31 EST
