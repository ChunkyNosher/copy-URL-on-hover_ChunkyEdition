# Additional Codebase Issues & Missing Diagnostics
**Quick Tabs v1.6.3.10-v8** | **Date:** 2025-12-19 | **Scope:** Functional bugs, lifecycle issues, and architectural problems beyond logging gaps

---

## Executive Summary

Beyond the logging infrastructure gaps documented in the primary diagnostic report, the codebase contains several significant functional issues, race conditions, and architectural problems that cause or contribute to the documented user-facing issues (A–T). These problems fall into three categories:

1. **Snapshot & Adoption Lifecycle Races** - State synchronization failures during minimize/restore and tab adoption cycles
2. **Callback Context Starvation** - Stale closures after restore causing writes of incorrect data
3. **Resource & Quota Management** - Missing checks, unbounded growth, and silent failures
4. **DOM Reference Loss** - Orphaned elements and state divergence during rapid operations

This document catalogs each issue with root cause analysis and required fixes, organized by severity and component.

---

## Section 1: Snapshot Lifecycle Issues (CRITICAL)

### Issue 1.1: Adoption-Induced Snapshot Desynchronization (CRITICAL - Issue #22 derivative)

**Location:** `minimized-manager.js` (line 1563), `window.js`, adoption flow coordination

**Problem:**
When a Quick Tab is adopted to a new tab (originTabId changes from TabA to TabB), the system attempts to update the snapshot's savedOriginTabId. However, there is no synchronization guarantee between:
1. The adoption completing and updating entity.originTabId
2. The minimized-manager snapshot update via updateSnapshotOriginTabId()
3. An in-flight restore operation that has already read the old originTabId from the snapshot
4. UICoordinator's ownership validation during restore

**Scenario (reproduces issue):**
- Quick Tab qt-123 owned by Tab 5, currently minimized (snapshot captured with originTabId=5)
- User opens Tab 5's Quick Tab in Tab 6 (adoption begins)
- Adoption code calls updateSnapshotOriginTabId(qt-123, 6, 5) → snapshot.savedOriginTabId becomes 6
- UICoordinator has already queued restore operation using OLD entity state
- Restore fires, reads snapshot (originTabId=6 is now correct)
- But entity.originTabId might still be 5 if adoption is still in-flight
- Ownership validation in VisibilityHandler._validateCrossTabOwnership() compares:
  - tabWindow.originTabId (might be 5 or 6 depending on timing)
  - this.currentTabId (could be 5 or 6)
  - Result is unpredictable

**Impact:**
- Cross-tab restore operations fail with "Cross-tab operation rejected" error
- Adopted Quick Tabs become stuck minimized and cannot be restored
- User sees broken minimized Quick Tab that never restores despite button clicks

**Root Cause:**
No atomic adoption operation - the originTabId change is split across multiple components (entity, snapshot, event emission) with race windows between each step.

**Required Fix Direction:**
Adoption should be atomic: acquire lock, update entity.originTabId, update snapshot.savedOriginTabId, emit event, release lock. All downstream operations (restore, visibility changes) must wait for adoption lock to release. No operation should proceed if adoption is in-flight for that Quick Tab ID.

---

### Issue 1.2: Snapshot Expiration Race with Slow Restore (CRITICAL - Issue #12 derivative)

**Location:** `minimized-manager.js` (lines 335-365, 399-421)

**Problem:**
The snapshot expiration timeout (1000ms) can expire while a restore operation is in-flight, deleting the snapshot before UICoordinator completes rendering.

**Scenario (reproduces issue):**
- Quick Tab minimized at 12:45:23.100Z, snapshot added to minimizedTabs
- Snapshot expiration scheduled for 12:45:24.100Z (1000ms later)
- Restore initiated at 12:45:23.200Z, snapshot moved to pendingClearSnapshots, isRestoring=true
- UICoordinator begins slow render (network fetch, DOM layout) taking 900ms
- At 12:45:24.100Z, expiration fires:
  - snapshot.isRestoring is checked - returns true
  - Deferred expiration scheduled for 500ms later (12:45:24.600Z)
- UICoordinator still rendering at 12:45:24.550Z
- At 12:45:24.600Z, deferred expiration fires again:
  - snapshot.isRestoring might now be false (cleared after _applyAndVerifySnapshot)
  - Snapshot DELETED from pendingClearSnapshots
- UICoordinator's clearSnapshot() call finds nothing to clear
- Orphaned DOM elements created
- User sees duplicate window or frozen window

**Impact:**
- Duplicate Quick Tab windows rendered on screen
- Frozen/unresponsive Quick Tabs after restore
- Memory leak of orphaned DOM elements
- Cascading errors in subsequent operations

**Root Cause:**
The isRestoring flag is cleared too early (after _applyAndVerifySnapshot, not after full UICoordinator render). Deferred expiration uses a hardcoded 500ms wait that is not guaranteed to outlast typical UI render cycles.

**Required Fix Direction:**
The isRestoring flag should remain true until UICoordinator explicitly calls clearSnapshot(). The expiration logic should be removed from MinimizedManager entirely - instead, only UICoordinator (via clearSnapshot) should remove snapshots. A separate watchdog timer (much longer, e.g., 5000ms) can clean up orphaned snapshots if UICoordinator crashes.

---

### Issue 1.3: Restore Lock Duration Insufficient for Concurrent Adopts (HIGH - Issue #22 derivative)

**Location:** `minimized-manager.js` (line 130, RESTORE_LOCK_DURATION_MS = 500)

**Problem:**
When restore() is called, it sets _restoreInProgress.add(id) with a 500ms timeout. During that 500ms window, if adoption attempts to happen, the adoption code cannot proceed because of potential race conditions. However, 500ms is often insufficient for the full restore pipeline (lock acquisition → snapshot application → UICoordinator render → clearSnapshot call).

**Scenario:**
- Restore initiated at T=0ms
- Lock set until T=500ms
- UICoordinator slow render: T=0 to T=600ms
- At T=500ms, lock is released but restore is still in-flight
- Adoption attempt at T=520ms sees lock is released, proceeds
- Snapshot.isRestoring=false at T=620ms when UICoordinator tries to clear
- Adoption writes entity.originTabId=6
- UICoordinator's stored snapshot still has originTabId=5
- State is now inconsistent

**Impact:**
- Adoption can race with restore operations
- Entity and snapshot originTabId values diverge
- Subsequent operations use stale originTabId values

**Root Cause:**
The lock duration is a constant that doesn't account for actual operation latency. Restore operations should hold the lock until they explicitly release it (after UICoordinator confirms render), not based on time.

**Required Fix Direction:**
Replace time-based lock with explicit unlock mechanism. Restore should acquire lock at entry, release it only after restore callback completes and UICoordinator calls clearSnapshot(). Adoption operations should check _restoreInProgress Set and wait/fail gracefully if restore is in-flight.

---

## Section 2: Callback Context & Closure Starvation (HIGH)

### Issue 2.1: Position/Size Callbacks Not Re-Wired After Restore (HIGH - Issue #3 derivative)

**Location:** `VisibilityHandler.js` (lines 1197-1212), `window.js` (render method callbacks)

**Problem:**
When a Quick Tab is restored from minimized state, VisibilityHandler._rewireCallbacksAfterRestore() only re-wires onMinimize and onFocus callbacks. The position and size callbacks (onPositionChange, onPositionChangeEnd, onSizeChange, onSizeChangeEnd) still reference stale closures from initial window construction.

**Scenario:**
- Quick Tab created at T=0 with onPositionChange capturing handler reference at construction
- Quick Tab minimized at T=100 (DOM removed, but callbacks still hold stale closures)
- Quick Tab restored at T=200
- User drags Quick Tab at T=220
- DragController calls onPositionChange with stale handler closure
- Stale closure references old state variables, writes incorrect position to storage
- UICoordinator receives stale position from storage, renders at wrong location

**Impact:**
- Position/size data written to storage is incorrect after restore
- Subsequent hydrations show Quick Tab at wrong location
- Cross-tab sync (if enabled in future) would propagate wrong positions
- Visual state diverges from persisted state

**Root Cause:**
Callback re-wiring was implemented partially - only covering the most obvious callbacks (minimize/focus), missing the less visible but equally important position/size callbacks.

**Required Fix Direction:**
The _rewireCallbacksAfterRestore() call in VisibilityHandler should pass all callbacks (position, size, solo, mute) to tabWindow.rewireCallbacks(). The DragController and ResizeController should be queried for their callback references and passed through as fresh callbacks that capture current handler context.

---

### Issue 2.2: UpdateHandler Position/Size Callbacks Use Stale UpdateHandler Context (HIGH - Issue #3 derivative)

**Location:** `handlers/UpdateHandler.js` (construction), `window.js` (callback wiring)

**Problem:**
When UpdateHandler is instantiated, it wires position and size callbacks that close over the UpdateHandler instance's state. After a page reload or restore cycle, if UpdateHandler is reconstructed, the old callbacks still reference the old UpdateHandler instance. If these callbacks fire, they update stale state.

**Scenario:**
- Page loads, UpdateHandler created (instance A)
- Callbacks wired to capture instance A's state
- User drags Quick Tab
- Callback fires → UpdateHandler_A.handlePositionChange() → writes to storage
- Page reloads (navigation)
- UpdateHandler destroyed, new UpdateHandler created (instance B)
- Old Quick Tab windows still have callbacks referencing instance A
- User drags Quick Tab again
- Callback fires → UpdateHandler_A.handlePositionChange() (old instance) → writes to OLD state
- Instance B never learns of the position change

**Impact:**
- Position changes after page reload are lost
- Storage gets written with out-of-date state
- Next hydration loads wrong positions

**Root Cause:**
No mechanism to invalidate or update callbacks when handlers are reconstructed. Callbacks are not tied to handler lifecycle.

**Required Fix Direction:**
Callbacks should be re-wired whenever handlers are reconstructed. Alternatively, callbacks should be stateless functions that always fetch current handler reference from a registry, rather than closing over instance references.

---

## Section 3: Resource & Quota Management Issues (CRITICAL)

### Issue 3.1: No Quota Check Before Storage Write (CRITICAL - Issue M)

**Location:** `VisibilityHandler.js` (lines 1460-1481, _persistToStorage), `storage-utils.js` (persistStateToStorage)

**Problem:**
When VisibilityHandler writes state to storage via _persistToStorage(), it never checks browser.storage.local quota before attempting the write. If quota is exhausted, the write fails silently after a timeout, leaving state unsaved.

**Scenario:**
- User has accumulated 9.8MB of Quick Tabs state
- Browser quota for storage is 10MB
- User minimizes a new Quick Tab
- VisibilityHandler queues persist
- _executeDebouncedPersistCallback calls _persistToStorage()
- persistStateToStorage() attempts browser.storage.local.set()
- QuotaExceededError thrown → caught in error handler → logged but not surfaced
- Storage write fails
- State is out-of-sync with UI (Quick Tab shows as minimized but storage still has minimized=false)
- Next reload: Quick Tab is visible again instead of minimized

**Impact:**
- User loses state changes without notification
- Minimize/restore/focus operations are lost
- State corruption accumulates over time
- Silent failures make debugging extremely difficult

**Root Cause:**
No proactive quota estimation before writes. The code assumes storage always succeeds until it doesn't, then has no fallback.

**Required Fix Direction:**
Before any write, call navigator.storage.estimate() to check available quota. If available space < estimated state size + buffer (e.g., 20% margin), reject the write with explicit error logging. Notify user via console.error about quota exhaustion. Optionally implement fallback to IndexedDB or in-memory state if local storage fails.

---

### Issue 3.2: Z-Index Counter Unbounded Growth (MEDIUM)

**Location:** `VisibilityHandler.js` (lines 66-67, currentZIndex management), `handleFocus` method

**Problem:**
The currentZIndex counter is incremented on every focus operation but never reset or capped. Over a long-running session with many minimize/restore cycles and focus operations, the z-index value grows without bound.

**Scenario:**
- Session starts, currentZIndex.value = QUICK_TAB_BASE_Z_INDEX (e.g., 10000)
- 1000 focus operations later: currentZIndex.value = 11000
- 100,000 operations later: currentZIndex.value = 110000
- Eventually: currentZIndex.value exceeds JavaScript MAX_SAFE_INTEGER or causes CSS z-index limits
- Browser may not render correctly with invalid z-index values

**Impact:**
- Very long sessions could experience rendering issues
- Z-index values become unpredictable/invalid
- Potential for z-index collisions if cycling through values

**Root Cause:**
No mechanism to reset counter or enforce bounds. Counter is treated as an infinite monotonic counter.

**Required Fix Direction:**
Implement z-index recycling: when counter exceeds a threshold (e.g., currentZIndex.value > 100000), scan all Quick Tab windows and renormalize their z-indices relative to each other. Reset counter to base value + rank offset. This keeps z-indices in a reasonable range while preserving stacking order.

---

### Issue 3.3: Active Timer IDs Set Never Cleared on Instance Destruction (MEMORY LEAK - HIGH)

**Location:** `VisibilityHandler.js` (lines 78-81, _activeTimerIds), no cleanup in destructor

**Problem:**
The _activeTimerIds Set accumulates timer IDs over the lifetime of a VisibilityHandler instance. If VisibilityHandler is destroyed and recreated (e.g., on page reload in a SPA), the old Set is never cleared, leading to memory accumulation.

**Scenario:**
- Page load 1: VisibilityHandler created with _activeTimerIds Set
- 500 debounced persist operations trigger timer creation/cancellation
- _activeTimerIds contains ~500 stale IDs (even though they were deleted from Map)
- Page reload (SPA navigation)
- Old VisibilityHandler garbage collected but _activeTimerIds Set persists in closure
- Page load 2: New VisibilityHandler created with fresh _activeTimerIds Set
- Old Set with 500 IDs is now orphaned memory
- This repeats with every SPA navigation

**Impact:**
- Memory leak accumulates over long SPA sessions
- Eventually could cause performance degradation or OOM crashes

**Root Cause:**
Sets are populated but never pruned or cleared. No destructor or cleanup method exists.

**Required Fix Direction:**
Add a destroy() or cleanup() method to VisibilityHandler that clears all Set references. Call this method when VisibilityHandler is being discarded. Alternatively, automatically prune _activeTimerIds Set when size exceeds threshold (e.g., prune oldest 100 entries when size > 1000).

---

## Section 4: DOM Reference Loss & Orphaning (HIGH)

### Issue 4.1: Fallback DOM Query Finds Wrong Element During Rapid Minimize (HIGH)

**Location:** `VisibilityHandler.js` (lines 905-910, _removeContainerFromDOM), `window.js` (element creation with data-quicktab-id attribute)

**Problem:**
In _removeContainerFromDOM(), if the container reference is lost (due to stale pointer or garbage collection), the code attempts a fallback DOM query using data-quicktab-id attribute. However, if multiple minimize operations are queued and executing in rapid succession, the fallback query might find and remove the WRONG instance's container (a different Quick Tab with similar but not identical ID pattern).

**Scenario:**
- Quick Tab qt-123-abc is minimized
- minimize() queued, sets isMinimizing=true
- Quick Tab qt-123-def is minimized  
- minimize() queued, sets isMinimizing=true
- First minimize executes: _removeContainerFromDOM() → container reference lost
- Fallback query: document.querySelector('.quick-tab-window[data-quicktab-id="qt-123-abc"]')
- Query returns qt-123-def's container (both match prefix "qt-123")
- qt-123-def's container removed incorrectly
- qt-123-abc's container NOT removed
- State is now corrupted

**Impact:**
- Wrong Quick Tab windows removed from DOM
- Orphaned windows left on page
- Remaining windows have stale Map entries but no container
- Render cycles fail

**Root Cause:**
The fallback DOM query is not precise enough. Multiple Quick Tab IDs could match the same selector if using substring matching or if ID generation has collisions.

**Required Fix Direction:**
The data-quicktab-id attribute value should be used for exact matching. The querySelector should use exact match or CSS.escape for precision. Better yet, avoid losing container references in the first place by not nullifying the reference until after removal is confirmed.

---

### Issue 4.2: Container Null After Minimize, But Map Entry Retained (HIGH - Issue #5 derivative)

**Location:** `VisibilityHandler.js` (lines 920-925, minimize operation), `window.js` (minimize removes container)

**Problem:**
When minimize() is called, it removes the DOM container and sets this.container = null in the QuickTabWindow instance. However, the Quick Tab ID still exists in the quickTabsMap. This creates a state where:
- quickTabsMap.has(id) returns true
- quickTabsMap.get(id).container is null
- quickTabsMap.get(id).rendered is false
- But VisibilityHandler logic checks quickTabsMap.has(id) to determine if tab is "valid"

If any code relies on checking only the Map existence (not the container/rendered state), it will operate on a stale window instance.

**Scenario:**
- Quick Tab qt-123 is minimized
- minimize() removes container, sets rendered=false
- Some error handling code checks: if (quickTabsMap.has(id)) { use_it }
- Code receives quickTabsMap.get(id) with null container
- Code attempts operations on null container → null pointer errors

**Impact:**
- Potential null pointer exceptions
- State queries return inconsistent results (Map says exists, but instance says not rendered)

**Root Cause:**
The system doesn't clearly distinguish between "Tab Exists in Memory" (Map check) and "Tab Has Active DOM" (rendered check). Operations should use both checks, but some only use the Map check.

**Required Fix Direction:**
Add an isActive() or isValidForOperation() method to QuickTabWindow that checks both Map presence AND rendered state. All operations should use this method instead of just checking quickTabsMap.has(id). Or, remove the tab from the Map when minimizing, add it back when restoring.

---

## Section 5: Concurrency & Race Conditions (HIGH)

### Issue 5.1: Solo/Mute Toggle Not Atomic (HIGH - Issue #21 derivative)

**Location:** `VisibilityHandler.js` (lines 152-166, _handleVisibilityToggle), `window.js` (toggleSolo/toggleMute)

**Problem:**
When toggleSolo() or toggleMute() is called, the operation is not atomic:
1. Mutate entity.soloedOnTabs or entity.mutedOnTabs
2. Call updateButton()
3. Call onSolo() or onMute() callbacks

If any step fails or throws, the state is partially updated. Also, no ownership validation happens before mutation.

**Scenario:**
- Cross-tab attack (malicious code) calls VisibilityHandler.handleSoloToggle(qt-123, [99], 'evil')
- No ownership check - qt-123 might be owned by different tab
- solo array mutated: entity.soloedOnTabs = [99]
- onSolo callback fires with wrong ownership context
- Quick Tab visibility rules violated - now soloed to wrong tab

**Impact:**
- Cross-tab visibility leaks (Quick Tab visible on wrong tab)
- Visibility state becomes inconsistent
- User sees Quick Tab in unexpected places

**Root Cause:**
No ownership validation before mutation, no atomicity guarantee.

**Required Fix Direction:**
Both handleSoloToggle() and handleMuteToggle() should validate ownership using _validateCrossTabOwnership() at entry. The entire mutation + callback sequence should be wrapped in a transaction or at least guarded by a lock to prevent partial updates.

---

### Issue 5.2: Drag Controller Callbacks Fire After Window Destroyed (MEDIUM)

**Location:** `window.js` (lines 1105-1116, minimize), `DragController.js` (event handlers)

**Problem:**
In minimize(), the dragController.destroy() is called, but if a drag is currently in-flight (user is actively dragging), the drag-end event handler might fire after destruction. This stale handler will attempt to call callbacks on a destroyed window instance.

**Scenario:**
- User starts dragging Quick Tab at T=100ms
- User closes Quick Tab at T=120ms (while drag is in-flight)
- minimize() called → dragController.destroy()
- Drag-end event fires at T=125ms (from browser event queue)
- Stale handler callback executed → attempts to call onPositionChangeEnd
- onPositionChangeEnd references destroyed window or stale state

**Impact:**
- Potential errors or unexpected writes after destruction
- State corruption from stale callbacks

**Root Cause:**
Event handlers are not cancelled synchronously - the browser's event queue might still have pending events that fire after destroy().

**Required Fix Direction:**
Before calling destroy() on controllers, set a destroyed flag on the window instance. In all callbacks, check the destroyed flag and early-return if true. Or use a signal/AbortController to cancel all pending operations when destroy() is called.

---

## Section 6: Iframe & Content Initialization Issues (MEDIUM)

### Issue 6.1: YouTube Pause Command Not Validated for Success (MEDIUM)

**Location:** `window.js` (lines 850-863, _pauseYouTubeViaPostMessage)

**Problem:**
When minimizing a YouTube Quick Tab, the code sends a postMessage pause command to the iframe, but never validates that the command was received or executed. The iframe might be:
- In a different origin (postMessage succeeds, but recipient ignores it)
- Not yet fully loaded (postMessage succeeds, but no listener)
- Not actually a YouTube iframe (postMessage fails silently)

The code assumes pause always succeeds.

**Scenario:**
- User minimizes YouTube Quick Tab mid-video
- postMessage pause sent (appears to succeed)
- But video is cross-origin embedded, or not fully initialized
- Video continues playing in background
- User hears audio but sees no window
- User thinks Quick Tab didn't minimize

**Impact:**
- Audio continues playing from "hidden" Quick Tab
- User confusion about whether minimize worked
- Unexpected audio bleed

**Root Cause:**
No confirmation of pause success. No fallback if pause fails.

**Required Fix Direction:**
Send a pause command, then after a short delay (e.g., 500ms), attempt to query the video's paused state via postMessage. If query fails or reports video is still playing, log a warning. Alternatively, rely on browser-native mechanisms (iframe sandbox restrictions or CSS visibility) to pause media instead of trying to control it via postMessage.

---

### Issue 6.2: Sandbox Attribute Allows Unsafe Escalations (MEDIUM)

**Location:** `window.js` (line 761, iframe sandbox attribute)

**Problem:**
The iframe is created with sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox". The allow-popups-to-escape-sandbox token allows untrusted content to open new windows/tabs outside the sandbox, which could be exploited for phishing or malware.

**Scenario:**
- Malicious webpage embedded in Quick Tab (user navigated to phishing site)
- Page executes code to open window.open() with spoofed URL
- Because sandbox allows popups-to-escape, new window opens outside sandbox
- Window appears to be from trusted domain but is actually controlled by attacker
- User credentials/data stolen

**Impact:**
- Malicious content can launch phishing attacks
- Security vulnerability for users who click untrusted links in Quick Tabs

**Root Cause:**
Sandbox restrictions not carefully evaluated. allow-popups-to-escape-sandbox is necessary for some use cases but adds security risk.

**Required Fix Direction:**
Re-evaluate sandbox requirements. Remove allow-popups-to-escape-sandbox if possible. If popups are needed, use a controlled popup handler that validates the destination URL before allowing the popup. Alternatively, educate users about the security implications of embedding untrusted content in Quick Tabs.

---

## Section 7: Initialization & Hydration Flow Issues (HIGH)

### Issue 7.1: TitleBar Minimize Callback Bypasses VisibilityHandler Validation (HIGH)

**Location:** `window.js` (lines 725-750, TitlebarBuilder callbacks), `VisibilityHandler.js` (handleMinimize with ownership validation)

**Problem:**
When the user clicks the minimize button in the titlebar, the callback is:
```
onMinimize: () => this.minimize()
```

This directly calls window.js's minimize() method, which does NOT go through VisibilityHandler.handleMinimize(). This means the ownership validation in handleMinimize() is bypassed, allowing cross-tab minimize operations to succeed.

**Scenario:**
- Quick Tab qt-123 owned by Tab 5
- User opens Quick Tab in Tab 6
- Tab 6's titlebar minimize button clicked
- Callback calls this.minimize() directly (QuickTabWindow instance)
- minimize() executes without ownership check
- VisibilityHandler never involved
- Quick Tab minimized from wrong tab
- State is now inconsistent

**Impact:**
- Ownership rules violated
- Cross-tab operations succeed when they should be rejected
- State corruption

**Root Cause:**
The minimize button callback calls the window method directly instead of routing through VisibilityHandler.

**Required Fix Direction:**
The titlebar callback should not call this.minimize() directly. Instead, it should emit an event or call a handler that routes through VisibilityHandler.handleMinimize() with proper ownership validation. The minimize() method should be the low-level DOM operation only, not the public API.

---

### Issue 7.2: No Validation That IFrame Source Is Loaded Before Operations (MEDIUM)

**Location:** `window.js` (line 758, iframe creation), `setupIframeLoadHandler` method

**Problem:**
The iframe is appended to the DOM with a src attribute, but the code doesn't wait for the iframe to load before considering the window "rendered". If code attempts to access iframe.contentDocument or send postMessage before iframe is loaded, the operations fail silently or throw errors.

**Scenario:**
- Quick Tab created with src="https://example.com"
- render() called → iframe appended with src
- User attempts to interact with Quick Tab content before iframe finishes loading
- Content access fails
- postMessage to iframe fails (no listener yet)

**Impact:**
- Content operations fail silently
- Cross-origin communication doesn't work until iframe fully loads
- User sees unresponsive Quick Tab initially

**Root Cause:**
No onload event wait before declaring window "rendered". The render() method returns immediately after appendChild, even though content loading is async.

**Required Fix Direction:**
Add a load event listener to the iframe. Only set rendered=true and fire onReady callback after iframe load event fires. Or, defer render completion until iframe load event. This ensures content is actually ready before the window is marked as rendered.

---

## Section 8: State Machine & Flag Management (MEDIUM)

### Issue 8.1: isMinimizing/isRestoring Flags Can Race With Other Operations (MEDIUM)

**Location:** `VisibilityHandler.js` (lines 952-964, callback suppression timing), `window.js` (isMinimizing/isRestoring flags)

**Problem:**
The isMinimizing and isRestoring flags are set to true at operation start and cleared after a short delay (CALLBACK_SUPPRESSION_DELAY_MS = 50ms). However, this is not atomic:
1. isMinimizing = true
2. DOM operation (remove container)
3. 50ms delay scheduled to clear isMinimizing = false
4. During this 50ms window, if a callback fires, it's suppressed
5. But if the callback fires at 45ms (before clear), it might NOT be suppressed if the flag isn't checked

The flag is checked on callback entry, but callbacks are async and might fire at any time.

**Scenario:**
- minimize() called → isMinimizing = true
- Container removed from DOM
- Callback scheduled to clear flag at T=50ms
- At T=45ms, drag-end event fires (from previous drag)
- Callback checks: if (tabWindow.isMinimizing) - flag is still true (not cleared yet)
- Callback suppressed (good)
- At T=50ms, flag cleared
- At T=55ms, another resize-end event fires
- Callback checks: if (tabWindow.isMinimizing) - flag is false now (cleared)
- Callback executes → attempts to update destroyed window

**Impact:**
- Suppression mechanism is not reliable
- Callbacks can race with operation completion

**Root Cause:**
Time-based clearing is not precise. 50ms is arbitrary and depends on system load.

**Required Fix Direction:**
Replace flag-based suppression with operation ID-based suppression. When operation starts, generate unique operation ID, store in _initiatedOperations Set. When operation completes, remove from Set. Callbacks check if their operation ID is in the Set. This is event-driven rather than time-based and much more reliable.

---

## Section 9: Cross-Component Synchronization (MEDIUM)

### Issue 9.1: No Synchronization Between Adoption and Restore Operations (HIGH - Issue #22)

**Location:** Adoption flow (background.js or manager), restore flow (VisibilityHandler.handleRestore)

**Problem:**
There is no explicit synchronization between adoption operations and restore operations. If adoption completes while a restore is queued, the restore might use stale originTabId values.

**Scenario (detailed):**
- Quick Tab qt-123 owned by Tab 5, minimized
- Adoption triggered: qt-123 to be adopted to Tab 6
- Adoption lock acquired, entity.originTabId updated to 6
- snapshot.savedOriginTabId updated to 6
- Adoption lock released
- Meanwhile, restore operation queued (initiated before adoption)
- Restore executes: reads snapshot (originTabId=6, correct)
- But VisibilityHandler._validateCrossTabOwnership() compares:
  - tabWindow.originTabId = 6 (updated by adoption)
  - this.currentTabId = 5 (we're in Tab 5 content script)
  - Result: REJECTED - "Cross-tab operation"
- Restore fails with misleading error message
- Quick Tab stays minimized

**Impact:**
- Adoption invalidates pending restore operations
- User sees minimized Quick Tab that won't restore
- Error message is confusing (says cross-tab but Tab ownership changed legitimately)

**Root Cause:**
No coordination between adoption and restore. Restore doesn't know that adoption happened and doesn't adjust its validation.

**Required Fix Direction:**
When adoption occurs, any pending restore operations for that Quick Tab should be cancelled and re-queued. Or, restore should be deferred until adoption completes. Alternatively, restore should check if the Quick Tab's ownership changed since restore was queued and adjust validation accordingly.

---

## Section 10: Error Handling & Recovery Gaps (MEDIUM)

### Issue 10.1: No Timeout on PersistToStorage Promise (CRITICAL - Issue M derivative)

**Location:** `VisibilityHandler.js` (lines 1460-1481, _persistToStorage)

**Problem:**
The _executeDebouncedPersistCallback calls await persistStateToStorage() with no timeout. If the storage API hangs (network timeout, browser freeze, storage API bug), the await will block indefinitely, preventing any further debounced persists from executing.

**Scenario:**
- User performs many actions: minimize, focus, etc.
- Each action queues a debounced persist
- persistStateToStorage() is called but hangs (network timeout or browser issue)
- Callback is stuck in await indefinitely
- The debounce timer never completes
- All subsequent persists are queued but never execute
- State is never saved for actions after the hang
- User loses all state after hang

**Impact:**
- Permanent data loss if storage API hangs
- No recovery mechanism
- State is out-of-sync forever

**Root Cause:**
Promise is awaited without timeout or AbortSignal.

**Required Fix Direction:**
Wrap persistStateToStorage() in Promise.race([persistStateToStorage(), timeoutPromise(5000)]). If persist takes > 5 seconds, reject and mark storage as unavailable. Implement fallback storage (IndexedDB or in-memory with warning).

---

## Section 11: Dead Code & Unused Patterns (MEDIUM)

### Issue 11.1: Transaction Pattern Not Integrated Into Flow (MEDIUM - Issue V)

**Location:** `map-transaction-manager.js` (TransactionManager class)

**Problem:**
The TransactionManager class exists with begin(), commit(), and rollback() methods, but it's never actually used in the codebase. No code calls these methods. The transaction pattern was designed to enable rollback on storage failure, but it's dead code.

**Impact:**
- Code bloat (200+ lines of unused code)
- Maintenance burden
- Potential confusion (looks like transactions are supported when they're not)

**Root Cause:**
Transaction pattern was implemented but never integrated into the actual storage write flow.

**Required Fix Direction:**
Either integrate transactions into _persistToStorage() flow (wrap write in begin/commit/rollback), or remove the TransactionManager class entirely if transactions are not needed. If removing, also check for any references in imports/exports.

---

## Section 12: Summary of Interdependencies

These issues are not isolated - they form chains of failure:

- **Chain 1 (Lifecycle):** Adoption races → Snapshot desync → Restore fails → User sees broken state
- **Chain 2 (Callbacks):** Restore completes → Callbacks stale → Position writes wrong data → Next hydration shows wrong position
- **Chain 3 (Persistence):** Fast operations → Debounce triggers persist → Persist hangs → State never saved → User loses data
- **Chain 4 (DOM):** Rapid minimize → Container ref lost → Fallback query finds wrong element → Wrong tab removed → Orphaned windows

Fixing any one chain requires addressing multiple issues in sequence. The most critical dependencies are:
1. Adoption atomicity must be fixed before restore can be reliable
2. Callback re-wiring must complete before positions persist correctly
3. Quota checking must happen before any write attempt
4. Timeout on persist is essential for recovery from hangs

---

## Implementation Recommendations

### Priority 1 (P0) - Must Fix First
- Issue 3.1: Add quota check before writes (blocks all data loss prevention)
- Issue 10.1: Add timeout to persistStateToStorage (blocks reliability)
- Issue 1.2: Remove time-based snapshot expiration (blocks race condition)

### Priority 2 (P1) - Fix Before Release
- Issue 1.1: Atomic adoption operation with lock
- Issue 2.1: Complete callback re-wiring for position/size
- Issue 5.1: Ownership validation for solo/mute toggle

### Priority 3 (P2) - Fix In Next Sprint
- Issue 4.1: Precise DOM query matching
- Issue 7.1: Route minimize through VisibilityHandler
- Issue 9.1: Synchronize adoption with restore

### Priority 4 (P3) - Technical Debt Cleanup
- Issue 3.2: Z-index recycling
- Issue 3.3: Memory leak cleanup on instance destruction
- Issue 11.1: Remove or integrate transaction pattern
