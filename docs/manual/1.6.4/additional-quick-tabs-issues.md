# Quick Tabs Architecture: Cross-Tab Adoption & Ownership Model Issues

**Extension Version:** v1.6.3.10-v7 | **Date:** 2025-12-18 | **Scope:** Adoption
synchronization, cross-tab ownership validation, event payload consistency, and
context lifecycle management

---

## Executive Summary

Deep codebase analysis reveals six additional architectural issues beyond Issues
#1-23, all stemming from incomplete adoption synchronization, inconsistent
cross-tab ownership enforcement, and missing lifecycle management for async
operations. These issues prevent the single-tab ownership model (implemented in
VisibilityHandler) from functioning correctly during adoption flows and when
context is destroyed. Collectively, they create scenarios where Quick Tabs
become orphaned, state diverges between cache and storage, and event payloads
are incomplete when operations cross tab boundaries.

## Issues Overview

| Issue | Component                  | Severity | Root Cause                                        |
| ----- | -------------------------- | -------- | ------------------------------------------------- |
| #24   | Adoption Sync Race         | High     | No storage confirmation before cache update       |
| #25   | Ownership Filter Strategy  | High     | Inconsistent ownership model enforcement          |
| #26   | Focus Z-Index Leakage      | Medium   | Scripting API fallback bypasses validation        |
| #27   | MinimizedManager Lifecycle | High     | Adoption unaware of snapshot state                |
| #28   | Event Payload Validation   | Medium   | Inconsistent validation timing across flows       |
| #29   | Debounce Callback Context  | Critical | No recovery when content script context destroyed |
| #30   | Hydration Adoption Race    | High     | Stale originTabId after tab reload                |

**Why bundled:** All affect adoption flow's ability to maintain atomic state
transitions; share architecture around VisibilityHandler cross-tab validation;
prevent cache/storage convergence after adoption; and compound Issues #16-23 by
introducing new failure modes that occur under specific timing conditions.

<scope>
**Modify:**
- `src/content.js` (adoption message handler, hydration flow)
- `src/features/quick-tabs/handlers/VisibilityHandler.js` (ownership model, event validation, callback context)
- `src/features/quick-tabs/managers/MinimizedManager.js` (snapshot lifecycle hooks)
- `src/background.js` (adoption broadcast handshake)

**Do NOT Modify:**

- `src/features/quick-tabs/handlers/UpdateHandler.js` (out of scope)
- `sidebar/quick-tabs-manager.js` (Manager UI, read-only context)
- Test files (test harness stays unchanged) </scope>

---

## Issue #24: Adoption Synchronization Race Between Storage Write and Cache Update

### Problem

When adoption occurs, originTabId is updated in the internal cache immediately
after broadcast completes, but if the background script's storage write is
delayed, subsequent operations fail the ownership check because cache was
optimistically updated but storage doesn't reflect the change yet. On next tab
reload, the adoption is lost entirely because storage was never committed.

### Root Cause

**File:** `src/background.js`  
**Location:** Adoption broadcast flow (adoptQuickTab handler and
ADOPTIONBROADCASTTOTABS implementation)  
**Issue:** Background broadcasts ADOPTIONCOMPLETED message to content scripts
before verifying storage write succeeded. Content script receives broadcast and
updates cache optimistically, but if storage write fails silently or is delayed,
cache and storage diverge. On next hydration, storage lacks the new originTabId
so adoption reverts to null.

Evidence from existing Issue #21 logs shows adoption broadcasts complete within
milliseconds but storage transactions happen separately and asynchronously. No
handshake mechanism confirms storage persistence before declaring adoption
complete.

### Fix Required

Implement a two-phase adoption commit: (1) write to storage, (2) verify write
succeeded (read back from storage to confirm), (3) ONLY THEN broadcast
ADOPTIONCOMPLETED to content scripts. Content script's cache update becomes a
confirmation operation rather than optimistic. If storage write fails at phase
1, abort broadcast entirely and log failure. Add logging showing "Storage write
confirmed" before broadcast initiation. This ensures originTabId changes are
atomic: either fully committed (storage + cache + broadcast) or fully reverted
(none of the above).

---

## Issue #25: Inconsistent Cross-Tab Ownership Enforcement Model

### Problem

VisibilityHandler uses an inclusive ownership model where each tab's
quickTabsMap may contain Quick Tabs from multiple tabs, and every operation
validates cross-tab ownership. This means stale Quick Tabs from closed tabs
remain in the map indefinitely. If Tab A closes but its Quick Tabs are still in
Tab B's quickTabsMap with outdated originTabId values, operations fail the
ownership check but aren't cleaned up, creating "zombie" entries that waste
memory and cause spurious error logs.

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `_validateCrossTabOwnership()` (lines ~355-375) and hydration flow
in `content.js`  
**Issue:** Ownership validation only rejects operations; it doesn't remove
invalid entries from the map. The `_filterOwnedTabs()` function (lines ~1460)
filters before storage persist, but filtering only prevents writing incorrect
data—it doesn't clean up the map itself during runtime. This creates asymmetry:
the map accumulates all Quick Tabs from all tabs encountered, but only persists
those owned by current tab.

**Design Problem:** Using an "inclusive with validation" model means N content
script contexts all share knowledge of all Quick Tabs but must constantly
validate on every operation. This is error-prone compared to an "exclusive
ownership" model where each tab's context manages ONLY Quick Tabs it created.

### Fix Required

Change ownership enforcement to exclusive model: (1) during hydration, only load
Quick Tabs with `originTabId === currentTabId` into quickTabsMap, (2) skip
loading cross-tab Quick Tabs entirely, (3) add cleanup logic when adoption
broadcasts arrive—if a Quick Tab's originTabId is received but doesn't match
current tab, remove it from map if it exists, (4) when receiving adoption
broadcasts for Quick Tabs owned by OTHER tabs, ignore them entirely. This
requires modifying hydration in `content.js` to filter by originTabId at load
time, not just at persist time. End result: each tab's VisibilityHandler manages
only its own Quick Tabs, eliminating zombie entries and spurious validation
failures.

---

## Issue #26: Focus Operation Z-Index Leakage via Scripting API Fallback

### Problem

VisibilityHandler.handleFocus() validates cross-tab ownership (line ~1115)
before updating z-index, but when Manager uses the Scripting API fallback to
invoke focus (mentioned at line 49), the bypass path doesn't include ownership
validation. This allows z-index counter pollution where Tab B's z-index counter
increments for Quick Tabs owned by Tab A, causing z-index collisions and
rendering issues.

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `handleFocus()` (lines ~1090-1165)  
**Issue:** Focus validates ownership at line ~1115, but this assumes handleFocus
is called through normal message dispatch. If background.js uses
`browser.scripting.executeScript()` as fallback (mentioned at line 49), it may
bypass the normal message handler routing and call VisibilityHandler methods
directly. Direct method invocation skips message handler validation.
Additionally, z-index is stored in a reference object
(`this.currentZIndex.value`) that's shared at the tab context level. If two tabs
both call focus handlers, each increments their own counter, but if cross-tab
focus somehow executes, it pollutes the owning tab's counter.

### Fix Required

Ensure all VisibilityHandler method invocations (including through Scripting API
fallback) go through validated code paths. Add ownership validation guard at the
very start of `handleFocus()` before any state modification occurs. Verify
z-index increment only happens for owned Quick Tabs. If Scripting API must call
handlers directly, ensure those direct calls still perform ownership checks.
Document that all Manager-initiated focus operations must go through normal
message dispatch, not direct scripting execution, or if they must use scripting,
they must re-validate ownership in the target content script before invoking
VisibilityHandler methods.

---

## Issue #27: MinimizedManager Snapshot Lifecycle Unaware of Adoption Changes

### Problem

MinimizedManager stores snapshots by Quick Tab ID. When adoption changes a Quick
Tab's originTabId, the snapshot keying doesn't update. If a Quick Tab is
minimized before adoption (storing snapshot under null-context), then adoption
sets originTabId, later restore attempts fail because restore looks for snapshot
under the new originTabId but it was stored under the old one. Snapshots become
orphaned when adoption completes.

### Root Cause

**File:** `src/features/quick-tabs/managers/MinimizedManager.js` and adoption
handler in `content.js`  
**Location:** Adoption completion handler that broadcasts
ADOPTIONCACHEUPDATECOMPLETE  
**Issue:** MinimizedManager has no integration point for adoption events. When
adoption completes and VisibilityHandler updates quickTabsMap, there's no
corresponding snapshot validation or re-keying in MinimizedManager. The adoption
handler updates originTabId on the tabWindow entity (which MinimizedManager has
a reference to), but MinimizedManager's internal snapshot dictionary is keyed by
ID only, not by (ID + originTabId). If adoption occurred after minimize, the
snapshot lives in storage but its lookup key changed.

### Fix Required

Add adoption lifecycle hook in adoption completion handler: after originTabId is
confirmed, check if MinimizedManager has a snapshot for this Quick Tab ID. If
found, verify the snapshot is still valid given the new originTabId context, or
reconstruct the lookup key. Alternatively, change MinimizedManager's snapshot
keying strategy from `quickTabId` to composite key `originTabId + quickTabId`,
making snapshots naturally survive originTabId updates. Document that adoption
must notify MinimizedManager of any Quick Tabs being adopted so snapshots are
properly reconciled.

---

## Issue #28: Event Payload Validation Inconsistency Across Operation Flows

### Problem

VisibilityHandler validates event payloads in some code paths (restore flow via
`_validateEventPayload()`) but not in others (minimize flow). When a Quick Tab
is minimized and state:updated event is emitted, there's no validation that
required fields (id, url) are present. If tabWindow lacks a url property, the
event propagates with incomplete payload, causing downstream handlers to fail
silently.

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** Minimize flow (lines ~663-678) vs. restore flow (lines
~1026-1034)  
**Issue:** Minimize calls `_createQuickTabData()` and emits state:updated
directly without calling `_validateEventPayload()`. Restore flow does validate
(line ~1034). This inconsistency means some operations emit incomplete payloads
while others validate. If a tabWindow object is corrupted or doesn't have url
property set, minimize event emission won't catch it, but restore would.

### Fix Required

Add validation to minimize flow before emitting state:updated event, matching
the pattern used in restore flow. Call `_validateEventPayload()` after creating
quickTabData in minimize handler. If validation fails, log error and don't emit
event, or emit with fallback placeholder values for required fields. Ensure all
operations that emit state:updated (minimize, restore, focus) follow the same
validation pattern. Document that quickTabData must always include id and url
fields, or event emission fails with clear error message.

---

## Issue #29: Debounce Callback Context Destroyed Without Recovery Mechanism

### Problem

When content script context is destroyed (tab closed, extension reloaded) before
a debounced persist callback fires (200ms delay), the timer fires in a dead
context. `_executeDebouncedPersistCallback()` attempts storage operations on a
context with no storage API access, silently failing. The minimized state is
never persisted, so Quick Tab resurrects as non-minimized on next load.

### Root Cause

**File:** `src/features/quick-tabs/handlers/VisibilityHandler.js`  
**Location:** `_executeDebouncedPersistCallback()` (lines ~1310-1365)  
**Issue:** Debounce timer is set for 200ms, but there's no context lifecycle
check before executing persist. If a user minimizes a Quick Tab and immediately
closes the tab, the timer fires in a destroyed context. The call to
`_persistToStorage()` (line ~1325) will fail silently because
`getBrowserStorageAPI()` returns null when storage API is unavailable. The error
is logged but there's no recovery—the operation simply doesn't happen. Next
hydration has no record of the minimize, so Quick Tab is restored to
pre-minimize state.

### Fix Required

Add context availability check at the start of
`_executeDebouncedPersistCallback()`. Before attempting persist, verify that
storage API is available. If not available, log specific error ("Context
destroyed before persist callback executed") and attempt to recover: if there's
a pending operation tracked, mark it as failed and notify any interested
listeners. Alternatively, use shorter debounce delay (50-100ms) to reduce
probability of context destruction during wait. Consider persisting immediately
on minimize/restore rather than debouncing, reserving debounce only for rapid
focus operations which are less critical. Document that very rapid tab closure
may lose minimized state due to async persist timing.

---

## Issue #30: Stale originTabId After Hydration Following Adoption

### Problem

When a Quick Tab is created in Tab A, adopted in Tab B (originTabId set to B),
then Tab A is reloaded, Tab A hydrates from storage with originTabId pointing to
Tab B. Tab A's VisibilityHandler rejects all operations on this Quick Tab
because ownership check fails (originTabId = TabB.id, currentTabId = TabA.id).
The Quick Tab becomes unusable in Tab A even though it was created there
originally.

### Root Cause

**File:** `src/content.js`  
**Location:** Hydration flow that loads Quick Tabs from storage  
**Issue:** During hydration, content script reads all Quick Tabs from storage
and reconstructs them in quickTabsMap. Each loaded Quick Tab retains whatever
originTabId was last written to storage. If adoption changed originTabId from
null (or TabA) to TabB, and Tab A hydrates after adoption, it loads the Quick
Tab with `originTabId = TabB`, which fails ownership validation in Tab A's
VisibilityHandler. The hydration process doesn't detect or correct stale
originTabId values.

**Root Mechanism:** This violates the assumption that hydration loads Quick Tabs
relevant to current tab. The issue manifests as: Quick Tab created in Tab A →
adopted to Tab B → Tab A reloads → Tab A sees Quick Tab it originally created
but can't operate on it because storage says it belongs to Tab B.

### Fix Required

During hydration, after loading Quick Tabs from storage, validate originTabId
against currentTabId. If originTabId is set but doesn't match currentTabId, and
the Quick Tab was loaded for hydration (not cross-tab sync), correct the
originTabId to currentTabId. Add logging: "Corrected stale originTabId during
hydration: was TabB.id, now currentTabId". Alternatively, use exclusive
ownership model from Issue #25: during hydration, skip loading Quick Tabs where
`originTabId !== currentTabId` entirely, treating them as owned by other tabs.
Prevent adoption from changing originTabId of Quick Tabs already loaded in other
tabs by implementing adoption handshake (Issue #24) that validates target tab
identity before adopting.

---

## Shared Implementation Notes

- **Adoption Atomicity (Issues #24, #30):** All adoption-related fixes require
  ensuring originTabId changes are committed atomically: storage write →
  verification → broadcast → cache update. Breaking this sequence causes
  divergence.

- **Ownership Model Consistency (Issues #25, #26):** Transition from
  inclusive-with-validation to exclusive-ownership model eliminates zombie
  entries and spurious rejections. All ownership checks should occur at map load
  time (hydration), not repeatedly at operation time.

- **Snapshot Lifecycle (Issue #27):** MinimizedManager must be adoption-aware.
  When originTabId changes, snapshots must be validated or re-keyed. Consider
  composite key strategy (originTabId + quickTabId).

- **Validation Consistency (Issue #28):** All event emissions follow same
  validation pattern. Use `_validateEventPayload()` before emitting. Fail fast
  with clear error messages rather than emitting incomplete payloads.

- **Context Lifecycle (Issue #29):** Async operations scheduled with delays
  (timers) must check context availability before execution. Consider shorter
  delays or immediate persist for critical operations.

- **Hydration Correctness (Issue #30):** Hydration must detect and correct stale
  ownership markers. Use current tab ID as authoritative source during load, not
  stored values from potentially-stale adoption.

<acceptance_criteria> **Issue #24: Adoption Storage Handshake**

- [ ] Adoption writes to storage, reads back to verify success before
      broadcasting
- [ ] If storage write fails, adoption broadcast does not occur
- [ ] Logs show "Storage write confirmed" before any broadcast messages
- [ ] After adoption broadcast, cache and storage state match for originTabId

**Issue #25: Exclusive Ownership Model**

- [ ] Hydration loads only Quick Tabs with originTabId matching currentTabId
- [ ] Cross-tab Quick Tabs are skipped during hydration (not added to map)
- [ ] No zombie entries remain in quickTabsMap from closed tabs
- [ ] Ownership validation is removed from operation hot paths (only used during
      hydration)

**Issue #26: Focus Z-Index Validation**

- [ ] Focus operation validates cross-tab ownership before any state change
- [ ] Z-index counter only increments for owned Quick Tabs
- [ ] Scripting API fallback paths still enforce ownership validation
- [ ] No z-index leakage between tabs

**Issue #27: MinimizedManager Adoption Sync**

- [ ] Adoption handler checks MinimizedManager for existing snapshots
- [ ] Snapshots survive originTabId changes (composite key or re-keying)
- [ ] Restore finds snapshot after adoption completes
- [ ] Logs show "Snapshot reconciled" or "Snapshot found" post-adoption

**Issue #28: Event Payload Validation**

- [ ] All state:updated events validated before emission
- [ ] Minimize and restore flows use identical validation pattern
- [ ] Incomplete payloads are rejected with clear error log
- [ ] Manual test: trigger minimize/restore → all events include id and url
      fields

**Issue #29: Debounce Context Lifecycle**

- [ ] Debounce callback checks context availability before persist
- [ ] If context destroyed, callback logs specific error ("Context destroyed")
- [ ] No silent failures in persist operations
- [ ] Manual test: minimize Quick Tab, close tab immediately → no crash, error
      logged

**Issue #30: Hydration Staleness Detection**

- [ ] Hydration detects stale originTabId (doesn't match currentTabId)
- [ ] Stale originTabId is corrected to currentTabId during load
- [ ] Logs show "Corrected stale originTabId" when correction occurs
- [ ] After tab reload following adoption, Quick Tab is usable in original tab

**All Issues:**

- [ ] All existing tests pass
- [ ] No new console errors or warnings in adoption flow
- [ ] Manual test: adopt Quick Tab, reload original tab, verify state preserved
- [ ] Manual test: minimize, adopt, restore across multiple tabs → snapshots
      correct </acceptance_criteria>

## Supporting Context

<details>
<summary>Issue #24: Adoption Race Condition Timeline</summary>

**Sequence that causes divergence:**

1. T+0ms: Background initiates adoption, calls storage.local.set() (async, no
   await)
2. T+1ms: Background immediately broadcasts ADOPTIONCOMPLETED to content scripts
3. T+2ms: Content script receives broadcast, updates quickTabsMap cache with new
   originTabId
4. T+150ms: Storage.local.set() completes in background
5. T+200ms: User closes tab
6. T+300ms: Storage transaction completes successfully
7. **Result:** Cache had originTabId but storage write never completed before
   tab closed

**Correct sequence:**

1. T+0ms: Background calls storage.local.set() with await
2. T+100ms: Storage write completes, background verifies by reading back
3. T+101ms: Background broadcasts ADOPTIONCOMPLETED
4. T+102ms: Content script receives broadcast, updates cache (now redundant
   confirmation)
5. **Result:** Storage committed before any cache updates
</details>

<details>
<summary>Issue #25: Ownership Model Trade-offs</summary>

**Inclusive Model (Current):**

- Pro: Simple broadcast mechanism, all tabs receive all Quick Tabs
- Con: Each tab must validate every operation, zombie entries persist, cache
  diverges from ownership reality

**Exclusive Model (Proposed):**

- Pro: Each tab manages only its Quick Tabs, no validation overhead, memory
  efficient
- Con: Requires filtering during hydration, adoption must target specific tabs

**Recommendation:** Exclusive model eliminates most Issues #16-30 by preventing
mismatched ownership from occurring in the first place.

</details>

<details>
<summary>Issue #29: Context Destruction Scenarios</summary>

**When context is destroyed:**

- Tab closed by user
- Extension reloaded (all content scripts destroyed)
- Tab navigated to new URL (content script may reload)
- Extension disabled/enabled

**Recovery Strategy:**

- Persist immediately (no debounce) for minimize/restore operations
- Debounce only for focus and resize (non-critical for state)
- Add pre-flight check: `if (!getBrowserStorageAPI()) return;` before persist
  attempt
- Log "Context destroyed" specifically to help diagnose this scenario
</details>

<details>
<summary>Issue #30: Adoption Broadcast Edge Case</summary>

The adoption flow is intended to allow ownership transfer of previously-created
Quick Tabs from one tab to another. However, the implementation assumes the
original tab won't be reloaded after adoption. If original tab reloads:

1. Original tab hydrates from storage
2. Storage contains originTabId pointing to adopting tab
3. Original tab's VisibilityHandler rejects operations (ownership mismatch)
4. Quick Tab is effectively "stuck" in storage but unusable in original tab

**Solution:** Detect this during hydration and correct originTabId to current
tab. Document that adoption is one-way transfer, and original tab shouldn't
attempt to operate on adopted Quick Tabs after reload.

</details>

---

**Priority:** High (Issues #24-27, #30), Critical (Issue #29), Medium (Issue
#28) | **Target:** Coordinated with Issues #1-23 fixes | **Estimated
Complexity:** Medium-High | **Est. Token Budget for Implementation:**
5,000-8,000 tokens combined with #1-23 fixes
