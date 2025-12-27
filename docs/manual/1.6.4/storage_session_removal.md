# Browser Storage Session: Complete Removal & Migration to Local Storage

**Extension Version:** v1.6.3.10-v9 | **Date:** 2025-12-27 | **Scope:** Remove all browser.storage.session references and replace with browser.storage.local while preserving non-persistent behavior

---

## Executive Summary

The extension uses `browser.storage.session` API across three critical files (SessionStorageAdapter, SyncStorageAdapter, and state-manager.js). This API causes failures on Firefox versions < 115 and in Manifest v2 contexts where the API is unavailable. The migration requires replacing all 16 instances with `browser.storage.local` while implementing explicit cleanup on browser startup to simulate session-only persistence (tabs cleared on restart, but survive page reloads). Three distinct root causes require coordinated fixes across the storage adapter layer and state manager.

## Issues Overview

| Issue | Component | Severity | Root Cause |
|-------|-----------|----------|--------------|
| #1: SessionStorageAdapter uses session API | Storage Layer | Critical | 4 direct API calls + 2 logging updates needed |
| #2: SyncStorageAdapter uses session API | Storage Layer | Critical | 5 direct API calls + 3 logging/comment updates needed |
| #3: State manager has session feature detection | State Manager | High | Conditional logic prevents load path on incompatible Firefox |

**Why bundled:** All affect Quick Tab persistence; share storage architecture; require coordinated startup cleanup mechanism to maintain non-persistent behavior; can be fixed in single PR.

<scope>
**Modify:**
- `src/storage/SessionStorageAdapter.js` (save, _loadRawState, _saveRawState, constructor)
- `src/storage/SyncStorageAdapter.js` (save, load, _loadRawState, _saveRawState, clear, constructor)
- `state-manager.js` (hasSessionStorage check, _persistToSession, _loadFromSession, load method)
- `src/background.js` or startup entry point (add explicit cleanup on extension load)

**Do NOT Modify:**
- `src/features/quick-tabs/handlers/` (message handling layer works correctly)
- `manifest.json` (version targeting is correct)
- Data serialization logic or format version tracking
</scope>

---

## Issue #1: SessionStorageAdapter Depends on Unavailable API

### Problem
SessionStorageAdapter directly calls `browser.storage.session.set()` and `browser.storage.session.get()` which don't exist on Firefox < 115 or in Manifest v2. Tabs fail to load because storage layer crashes immediately.

### Root Cause
**File:** `src/storage/SessionStorageAdapter.js`  
**Locations:**
- `save()` method (line ~75): `browser.storage.session.set(stateToSave)`
- `_loadRawState()` method (line ~154): `browser.storage.session.get(this.STORAGE_KEY)`
- `_saveRawState()` method (line ~191): `browser.storage.session.set({...})`
- Constructor logging (line ~54): Claims data is "cleared on browser close"

**Issue:** Uses session API directly without fallback. When API unavailable, entire storage layer fails silently or throws undefined errors.

### Fix Required
Replace all three API calls with `browser.storage.local` equivalents. Update logging messages to reflect new storage type. Change constructor message to explain that cleanup is now explicit and occurs on extension startup (see Issue #3 for cleanup mechanism).

---

## Issue #2: SyncStorageAdapter Also Depends on Session API

### Problem
SyncStorageAdapter (canonical adapter) calls `browser.storage.session.set()`, `browser.storage.session.get()`, and `browser.storage.session.remove()` directly. This makes Quick Tab persistence impossible on incompatible Firefox versions.

### Root Cause
**File:** `src/storage/SyncStorageAdapter.js`  
**Locations:**
- `save()` method (line ~132): `browser.storage.session.set(stateToSave)`
- `_loadRawState()` method (line ~349): `browser.storage.session.get(this.STORAGE_KEY)`
- `_saveRawState()` method (line ~391): `browser.storage.session.set({...})`
- `clear()` method (line ~274): `browser.storage.session.remove(this.STORAGE_KEY)`
- Constructor logging (line ~45): Claims data is "cleared on browser restart"
- Internal comments (lines ~69, ~268): Reference session storage behavior

**Issue:** Same as Issue #1 but affects canonical adapter. Additionally stores versioning and migration logic that must survive replacement.

### Fix Required
Replace four API calls with `browser.storage.local` equivalents. Update five logging/comment messages to reflect new storage type. Maintain format version tracking and container migration logic—these survive the API replacement unchanged. Constructor message should reference explicit startup cleanup mechanism.

---

## Issue #3: State Manager Assumes Session Storage Always Available

### Problem
StateManager checks `hasSessionStorage` at construction and conditionally calls `_persistToSession()` and `_loadFromSession()`. On Firefox < 115, this feature detection fails, preventing the "fast cache" behavior. More importantly, the load method attempts to prioritize session data over sync storage, which creates unpredictable behavior during migration.

### Root Cause
**File:** `state-manager.js`  
**Locations:**
- Constructor (line ~34): `typeof browser.storage.session !== 'undefined'` check
- `_persistToSession()` method (line ~83): Conditional persistence with fallback
- `_loadFromSession()` method (line ~226): Conditional load from session first
- `load()` method (line ~148): Loads from session before sync storage

**Issue:** Feature detection creates branching code paths. When session API unavailable, `_persistToSession()` becomes no-op but `_loadFromSession()` returns null, forcing fallback to sync storage. This loads old data from sync, potentially preventing fresh session state on startup. Also, dual-layer storage (sync + session) complicates the mental model after migration.

### Fix Required
Remove or repurpose `hasSessionStorage` feature detection. Decide: should dual-layer storage be maintained (local + sync), or simplified to local-only? Current recommendation: simplify to local-only since Quick Tabs are session-scoped. Remove `_persistToSession()` entirely or convert to tracking mechanism. Simplify `_loadFromSession()` to just load from local storage, or remove if local-only approach taken. Update `load()` method to remove session-first prioritization—load directly from local storage, do NOT fall back to sync storage (prevents stale data from appearing after browser restart).

---

## Shared Implementation Context

### Non-Persistent Behavior Requirement
After migration, Quick Tabs must survive page reload and tab switch (during browser session) but NOT survive browser restart. Three approaches to maintain this:

**Recommended: Explicit Cleanup on Startup (simplest, most explicit)**
- On extension load (background script init or first content script load), call `browser.storage.local.remove(['quick_tabs_state_v2'])`
- Execute once per browser session using flag: `browser.storage.local.get('_sessionCleared')` check
- Log: "Quick Tabs cleared on startup (session-scoped behavior)"

**Alternative: Timestamp-based Detection (more complex)**
- Store browser session ID alongside Quick Tabs
- On load, compare stored session ID with current session
- Clear if mismatch detected
- Requires browser session ID source (e.g., `chrome.runtime.id` or timestamp-derived)

**Alternative: Unload Handler (unreliable)**
- Listen for browser close event
- Call storage.local.remove() before unload
- Fallback to startup cleanup for safety

**Use Approach 1 (Explicit Cleanup).** It's deterministic, testable, and doesn't require browser-specific APIs.

### Format Compatibility
Both SessionStorageAdapter and SyncStorageAdapter track `formatVersion` field in stored state. This ensures backward compatibility with old container-format data. The format version logic is unchanged by API migration—only the underlying storage calls change from session to local.

### Error Handling
All error handling code (try-catch blocks, error logging) remains unchanged. Only API calls and success-path logging change.

### Storage Quota Considerations
`browser.storage.local` has 10 MB quota per extension. Session storage (when available) has higher quota. Monitor quota after migration: if Quick Tabs frequently fill storage, implement automatic cleanup of oldest tabs.

---

## Logging Changes Required

All logging messages currently reference "session storage" must be updated to reference "local storage" or "session-scoped storage" to avoid confusion. Specifically:

- "Saved to session storage" → "Saved to local storage (session-scoped)"
- "Cleared from session storage" → "Cleared from local storage on startup"
- "Load from session storage" → "Load from local storage"
- "Session storage failed" → "Storage persistence failed"
- Constructor: "session-scoped, cleared on browser restart" → "session-scoped with explicit startup cleanup, data clears on browser restart"

---

<acceptance_criteria>
**Issue #1 (SessionStorageAdapter):**
- [ ] All three `browser.storage.session` calls replaced with `browser.storage.local`
- [ ] Logging messages updated to reference local storage
- [ ] Constructor message explains explicit startup cleanup
- [ ] No breaking changes to public API or return values

**Issue #2 (SyncStorageAdapter):**
- [ ] All four `browser.storage.session` calls replaced with `browser.storage.local`
- [ ] Format version tracking still functions correctly
- [ ] Container-to-unified migration still works
- [ ] All logging and comment messages updated
- [ ] Constructor message explains non-persistent behavior mechanism
- [ ] Race condition prevention (saveId tracking) unchanged

**Issue #3 (State Manager):**
- [ ] `hasSessionStorage` feature detection removed or repurposed
- [ ] Dual-layer storage logic simplified (either local-only or local+sync with clear priority)
- [ ] `load()` method does NOT fall back to sync storage after session storage unavailable
- [ ] All conditional logic for unavailable session API removed
- [ ] Logging updated to reflect simplified load path

**Startup Cleanup (All Issues):**
- [ ] Background script or service worker calls `browser.storage.local.remove(['quick_tabs_state_v2'])` on extension load
- [ ] Cleanup executes exactly once per browser session (protected by flag)
- [ ] Cleanup logs: "Quick Tabs cleared on startup (session-scoped behavior)"
- [ ] Manual test: Create Quick Tab → reload page → still present; close browser → reopen → gone

**Integration Tests:**
- [ ] SessionStorageAdapter save/load cycle works
- [ ] SyncStorageAdapter migration from old format still works
- [ ] StateManager loads correctly without session API
- [ ] Manager UI syncs state updates correctly
- [ ] No console errors or warnings
- [ ] All existing tests pass
</acceptance_criteria>

---

## Supporting Context

<details>
<summary>Current Session API Usage Breakdown</summary>

**SessionStorageAdapter (6 instances total):**
1. `save()`: session.set() - line 75
2. `save()` error logging - line 82 (message update only)
3. `_loadRawState()`: session.get() - line 154
4. `_loadRawState()` error logging - line 170 (message update only)
5. `_saveRawState()`: session.set() - line 191
6. Constructor logging - line 54 (message update only)

**SyncStorageAdapter (8 instances total):**
1. `save()`: session.set() - line 132
2. `save()` error logging - line 142 (message update only)
3. `_loadRawState()`: session.get() - line 349
4. `_loadRawState()` error logging - line 365 (message update only)
5. `_saveRawState()`: session.set() - line 391
6. `clear()`: session.remove() - line 274
7. `clear()` logging - line 275 (message update only)
8. Constructor logging - line 45 + comments at lines 69, 268

**state-manager.js (2 instances with conditional logic):**
1. Feature detection: `hasSessionStorage` - line 34
2. `_persistToSession()` conditional call - line 83
3. `_loadFromSession()` conditional logic - line 226
4. `load()` method prioritizes session - line 148

Total: 16 touchpoints (8 API calls, 8 logging/comment updates)
</details>

<details>
<summary>Why browser.storage.session Fails</summary>

Per [MDN WebExtensions API documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/session), `browser.storage.session` is only available in Firefox 115+. Additionally, per the [Manifest v2 documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json), some APIs behave differently in Manifest v2 vs v3.

The error logs show `e.storage.session is undefined`, indicating:
- Extension running on Firefox < 115, OR
- Extension running in Manifest v2 context where session API is not available

Current code attempts to use session API without checking availability first, causing immediate failure when API doesn't exist.
</details>

<details>
<summary>Migration Testing Checklist</summary>

**Basic Functionality:**
- [ ] Open page with Quick Tab placeholder
- [ ] Click "Create Quick Tab" → tab appears with persistence
- [ ] Reload page → Quick Tab still present
- [ ] Switch to different tab → return to original → Quick Tab still present

**Browser Restart:**
- [ ] Close browser completely (not just last tab)
- [ ] Reopen browser
- [ ] Verify Quick Tabs are gone (session cleanup worked)
- [ ] Create new Quick Tab → verify it persists during session

**Manager Sync:**
- [ ] Create Quick Tab → Manager shows it immediately
- [ ] Resize Quick Tab → Manager updates size display
- [ ] Minimize Quick Tab → Manager shows minimized indicator
- [ ] Drag Quick Tab → position updates in Manager
- [ ] All operations complete without console errors

**Error Paths:**
- [ ] Simulate storage write failure (via DevTools or by filling storage)
- [ ] Verify error is logged appropriately
- [ ] Verify extension doesn't crash
- [ ] Verify graceful degradation

**Backward Compatibility:**
- [ ] Old session storage data (if any exists) loads correctly
- [ ] Container-format data still migrates to unified format
- [ ] Format version tracking prevents re-migration
</details>

<details>
<summary>Architecture: Dual-Layer Storage Decision</summary>

Current code maintains two storage layers:
- **sync storage**: Persistent across devices, slower writes
- **session storage**: Fast, session-scoped, clears on browser close

After migration, `state-manager.js` must choose:

**Option A (Recommended): Local-Only**
- Remove `_persistToSession()` entirely
- Remove `_loadFromSession()` entirely
- Use only `browser.storage.local` for Quick Tab state
- Implement startup cleanup for non-persistent behavior
- Simpler code, single storage source of truth
- Downside: No sync across devices (but Quick Tabs are inherently local)

**Option B: Local + Sync Hybrid**
- Keep sync storage as secondary backup
- Use local storage for fast session operations
- Don't fall back to sync storage on startup (prevents stale data appearing)
- More complex code but provides additional safety
- Downside: Dual-layer complexity for marginal benefit

**Recommendation: Choose Option A.** Quick Tabs are inherently local to a tab, not designed for cross-device sync. Simplifying to local-only reduces complexity and eliminates confusion around which storage layer is authoritative.
</details>

---

## Implementation Strategy

1. **Phase 1 (Adapters):** Replace API calls in SessionStorageAdapter and SyncStorageAdapter. Update logging and comments. Test storage read/write cycle independently.

2. **Phase 2 (State Manager):** Simplify state manager to local-only (Option A). Remove session-specific logic and feature detection. Update load method.

3. **Phase 3 (Startup Cleanup):** Add explicit cleanup handler in background script or service worker. Execute on extension load with flag protection (once per session).

4. **Phase 4 (Integration Testing):** Test full cycle from tab creation through browser restart. Verify Manager syncs correctly. Test error paths.

---

**Priority:** Critical (blocks Firefox < 115 support) | **Target:** Single PR | **Estimated Complexity:** Medium (API calls are straightforward, decision on dual-layer storage adds complexity)