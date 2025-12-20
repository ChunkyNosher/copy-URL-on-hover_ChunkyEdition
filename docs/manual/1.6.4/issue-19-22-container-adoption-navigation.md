# Copy-URL-on-Hover: Container Adoption & Cross-Domain Navigation Issues

**Extension Version:** v1.6.3.10+  
**Date:** December 20, 2025  
**Report Type:** Quaternary Analysis - Container Context, Adoption Completion, Navigation Scope  

---

## Executive Summary

This report documents four critical architectural issues discovered during comprehensive codebase scanning and Firefox API limitation analysis. These issues directly cause data loss in production scenarios: container switching, tab adoption completion, and cross-domain navigation within Quick Tabs.

The issues represent foundational problems in how the extension tracks tab ownership, manages storage context boundaries, and handles snapshot lifecycle events during page transitions.

**Impact:** Users experience mysteriously disappearing Quick Tabs when switching containers, adopting tabs between windows, or navigating to different domains within the same tab.

---

## Issue 19: Container Context Not Updated During Tab Adoption

**Severity:** HIGH  
**Component:** Tab adoption handler, storage filtering layer  
**Impact Scope:** Cross-container adoption workflows, storage isolation enforcement  

### Problem Description

Firefox's Multi-Account Containers API uses `cookieStoreId` as the storage context boundary. Each container has an isolated storage namespace:

- `firefox-default` (default container)
- `firefox-private` (private browsing)
- `firefox-container-1`, `firefox-container-2`, etc. (named containers)

When a tab is adopted from one container to another, its `cookieStoreId` changes. However, the current adoption implementation does not update the container context metadata for Quick Tabs associated with that tab.

### Manifestation

Consider adoption scenario:

1. User creates Quick Tab QT-1 in **Wikipedia (Container A, default)**
   - Stored with: `originTabId=10`, `containerContext=firefox-default`
2. User drags Wikipedia tab to **Personal Container (Container B)**
   - Tab object `cookieStoreId` changes from `firefox-default` to `firefox-container-personal`
   - Adoption handler runs: updates tab ownership metadata
3. New adoptee tab (Container B context) sends: "I own QT-1 now"
4. Background updates: `ownerTabId=11` (new owner in Container B)
   - But does NOT update: `containerContext` (still references Container A)
5. Content script in Container B queries: "Get Quick Tabs for my tab"
6. Storage filter runs: `originTabId === currentTabId` AND `containerContext === currentContainerContext`
7. Filter fails because: `containerContext=firefox-default` but `currentContainerContext=firefox-container-personal`
8. Quick Tab appears invisible in Container B

### Root Cause

The adoption workflow in `TabLifecycleHandler` updates ownership metadata but not container context. Storage retrieval queries filter on container context to enforce isolation, but adoption doesn't sync the context to the new container.

From MDN documentation on Firefox Containers: "Each container has its own cookie store and data isolation. When tabs move between containers, their storage context changes."

### Why This Breaks Silently

- No error thrown when context mismatch occurs
- Filter simply returns empty results
- Content script interprets empty results as: "no Quick Tabs stored"
- User sees blank Quick Tabs panel in new container
- No indication that data exists but is filtered out

### Related Behavior: Scenario 14 (Containers for Add-on Developers)

From `issue-47-revised.md` Scenario 14: "Verify QTs respect Firefox container boundaries and are isolated by container"

The test explicitly verifies that Quick Tabs created in Container A do NOT appear in Container B for the same domain. This isolation is working correctly through the filter. The problem occurs AFTER adoption: when a tab is moved between containers, the metadata doesn't follow.

### Storage Query Pattern

Content scripts execute queries similar to:

```sql
WHERE originTabId = currentTabId 
  AND containerContext = currentContainerContext
  AND domain = currentDomain
```

Adoption updates `originTabId` but not `containerContext`, causing the query to exclude the snapshots.

---

## Issue 20: Tab Adoption Post-Persistence Hook Exists But Never Called

**Severity:** HIGH  
**Component:** `TabLifecycleHandler.triggerPostAdoptionPersistence()` method  
**Impact Scope:** Adoption workflow completion, write queue blocking  

### Problem Description

The codebase contains a method `triggerPostAdoptionPersistence()` in TabLifecycleHandler (lines ~180-215 from scanning). This method is designed to execute after tab adoption completes and unblock the write queue.

However, comprehensive code search across the repository found **zero calls** to this method. It exists but is never invoked.

### Method Purpose

The hook is intended to:

1. Signal to background that adoption is complete
2. Unblock the storage write queue that was locked during adoption
3. Allow pending writes to execute
4. Re-enable normal Quick Tab operations

### Why This Matters

The adoption workflow likely implements pessimistic locking: during adoption, the write queue is blocked to prevent concurrent updates to the Quick Tab metadata. Once adoption completes, the queue should be unblocked.

If the hook is never called:

1. Write queue remains in "locked during adoption" state indefinitely
2. Subsequent Quick Tab operations (position changes, size changes, minimize/restore) are queued but never execute
3. Storage never updates with new operations
4. User performs actions (resizes tab, moves it) but changes don't persist
5. Page reload loses all changes made after adoption

### Evidence of Persistence Problem

From `QuickTabHandler.js` scanning:

- Write queue exists: `_writeQueue` and `_isWriting` variables
- `_enqueueStorageWrite()` checks if queue is locked
- `_processWriteQueue()` processes items sequentially
- But no code found that explicitly signals adoption completion

This suggests adoption runs, updates metadata, but never signals "adoption finished, unblock writes."

### Cascading Failure

1. User adopts Quick Tab to new window/tab
2. Adoption completes, metadata updated
3. User resizes the adopted Quick Tab
4. Position/size change queued (because writes still locked)
5. Page reloads
6. Size/position changes never persisted (were only in queue)
7. Quick Tab appears in original position/size
8. User confused: "I resized it but it reverted"

---

## Issue 21: Cross-Domain Navigation Invalidates originTabId References

**Severity:** HIGH  
**Component:** Content script hydration, originTabId filtering, snapshot metadata  
**Impact Scope:** Page navigation scenarios, snapshot restoration on domain switches  

### Problem Description

Firefox allows users to navigate within the same browser tab to different domains. A tab ID remains constant even when:

- User navigates from `wikipedia.org` to `youtube.com`
- User navigates from `github.com` to `example.com`
- Tab ID stays the same (e.g., tab 5 remains tab 5)

However, Quick Tab snapshots store `originTabId` to enforce tab scoping. The problem: snapshots created on Domain A become inaccessible after navigation to Domain B because the snapshot metadata context is stale.

### Manifestation

Navigation scenario:

1. User on `wikipedia.org` (Tab 5)
2. Creates Quick Tab QT-1 with: `originTabId=5`, `domain=wikipedia.org`
3. Snapshot stored in container storage, scoped to Tab 5
4. User navigates to `youtube.com` in Tab 5
5. Page reloads (or new content script initializes)
6. New content script runs `minimized-manager.restore()`
7. Restore queries: "Get snapshots where `originTabId=5` AND `currentDomain=wikipedia.org`"
8. But `currentDomain` is now `youtube.com`, not `wikipedia.org`
9. Query returns zero results
10. Restore completes with no snapshots loaded
11. User sees blank Quick Tabs panel

### Root Cause

The snapshot metadata includes domain scoping to prevent cross-domain access. However, when a tab navigates to a different domain, the same tab ID now corresponds to a different domain context. The filter becomes stale.

The domain context is implicitly enforced through the `originTabId` in combination with the storage key structure. If snapshots are keyed by `qt-${originTabId}-${timestamp}`, they become inaccessible when the current page domain differs from the original creation domain.

### Evidence from Behavior Specification

From `issue-47-revised.md` Scenario 20: "Cross-Domain Navigation in Same Tab"

> "2. Navigate to different domain in same tab
>    - Action: Navigate to YouTube in WP 1 (type URL directly in address bar)
>    - Expected: Page changes to YouTube, QT 1 remains visible
>
> 3. Note QT 1 visibility during navigation
>    - Action: Observe if QT 1 persists or momentarily disappears
>    - Expected: QT 1 may disappear briefly during page reload (cross-domain navigation)"

The test scenario acknowledges that QT may "disappear briefly" but expects it to reappear after the page fully loads. If hydration doesn't account for domain change, the QT disappears and never reappears.

### TTL Interaction

Quick Tabs have a 5-second TTL (time-to-live). If:

1. User navigates to new domain
2. New content script initializes (takes ~50-200ms)
3. Restore queries for snapshots
4. Query fails due to domain mismatch
5. Restore returns empty
6. Meanwhile, the 5-second TTL clock ticks
7. By the time user realizes tabs are gone, TTL may have expired
8. Snapshots permanently deleted

### Why This Breaks Silently

- No error logged when domain context mismatch prevents restore
- Restore simply returns empty array
- Content script assumes "no snapshots stored for this tab"
- No indication that snapshots exist but are filtered out
- User sees empty panel and assumes data was never saved

---

## Issue 22: Message Response Format Not Validated in All Handlers

**Severity:** HIGH  
**Component:** MessageRouter response handling, QuickTabHandler message handlers  
**Impact Scope:** Cross-component communication, silent failures  

### Problem Description

The QuickTabHandler implements multiple message handlers for different commands. Each handler returns a response, but response formats are inconsistent across handlers. MessageRouter dispatches messages and returns responses without validating that responses match expected schema.

### Manifestation

Response format inconsistency examples:

| Handler | Response Format | Content Script Expectation |
|---------|-----------------|---------------------------|
| handleGetCurrentTabId | `{ currentTabId: 123 }` | Expects `{ success: true, data: { tabId: 123 } }` |
| handleGetQuickTabsState | `{ tabs: [...], success: true }` | Expects `{ data: { tabs: [...] } }` |
| handleError (on failure) | `{ error: "message" }` | Expects `{ success: false, error: {...} }` |
| Timeout case | `undefined` or `null` | Expects some response object |

Content script code likely follows pattern:

```
const response = await sendMessage({ command: 'GET_CURRENT_TAB_ID' });
const tabId = response.currentTabId; // Works with handler A
const tabs = response.data.tabs;    // Fails with handler A, works with handler B
```

### Root Cause

When multiple handlers evolved, each was implemented independently with its own response style. No schema validation layer enforces consistency. MessageRouter simply passes responses through without transformation or validation.

### Failure Modes

**Mode 1: Type Mismatch**

Handler returns: `{ currentTabId: 123 }`

Content script expects: `response.data.tabId`

Result: `response.data` is `undefined`, accessing `.tabId` throws error or produces `undefined`, subsequent code fails silently.

**Mode 2: Success Flag Missing**

Handler returns: `{ tabs: [...] }`

Content script checks: `if (!response.success) { throwError(); }`

Result: `response.success` is `undefined`, which is falsy, throws error incorrectly.

**Mode 3: Error Object Mismatch**

Handler returns: `{ error: "Not initialized" }`

Content script expects: `response.error.code`

Result: `response.error` is string, not object, accessing `.code` produces `undefined`.

### Why This Causes Silent Failures

- No exception thrown immediately
- Subsequent code receives `undefined` or wrong type
- Logic continues with wrong assumptions
- Wrong operations execute invisibly
- State becomes inconsistent
- User behavior appears broken without clear cause

### Validation Gap

There is no layer that enforces:

- All handlers return objects (not primitives)
- All success responses include `{ success: true, data: {...} }`
- All error responses include `{ success: false, error: {...}, code: string }`
- Command exists in allowlist
- Response matches schema for that command

### Related to Issue 15

Issue 15 documented that `GET_CURRENT_TAB_ID` returns inconsistent formats depending on initialization state. Issue 22 generalizes this problem: all handlers lack response validation.

---

## Cross-Issue Dependencies & Cascade Effects

### Adoption Workflow Failure Chain

1. User adopts Quick Tab (Issue 20: hook not called)
2. Write queue locks, never unlocks
3. Position/size changes queued, never persist
4. User navigates to new domain in adopted tab (Issue 21: domain mismatch)
5. Hydration fails due to context mismatch
6. Quick Tab appears invisible
7. Content script queries handler for state (Issue 22: response format mismatch)
8. Response type mismatches expectations
9. Content script crashes silently
10. Sidebar never updates
11. User sees completely broken state

### Container Adoption Compounding

1. User drags tab between containers (Issue 19: context not updated)
2. Adoption completes but metadata stale
3. New container queries for Quick Tabs
4. Filter excludes them due to container mismatch
5. Empty results interpreted as "no data"
6. If containers also mean domain change, Issue 21 compounds
7. Multiple filters now fail
8. Complete data loss

### Message Response Issues Everywhere

- Issue 15: GET_CURRENT_TAB_ID inconsistent (Issue 22 generalization)
- Issue 16: Port handlers may receive wrong response format
- Issue 17: Restore queries receive malformed responses
- Issue 18: Invalid commands not validated, responses undefined

---

## Missing Instrumentation: Adoption & Navigation Logging

### Critical Logging Gaps for Issue 19-22

**Container Context Logging (Issue 19)**

Current state: No logs when adoption occurs or when container context checked.

Operators cannot see:
- What container tab was in before adoption
- What container tab moved to
- Whether container metadata was updated
- Why storage queries are failing

Required logs would show:
- Adoption initiated: `[ADOPTION] Adopting tab from container ${oldContainer} to ${newContainer}`
- Container update: `[ADOPTION_CONTAINER] Metadata updated: ${oldContainer} → ${newContainer}`
- Query failure visibility: `[CONTAINER_FILTER] Query excluded ${count} snapshots due to container mismatch`

**Adoption Completion Logging (Issue 20)**

Current state: No logs showing whether post-persistence hook executed.

Operators cannot see:
- If adoption actually completed
- Whether write queue was unblocked
- How many writes are pending
- If adoption is stuck in locked state

Required logs would show:
- Adoption start: `[ADOPTION_START] Adoption initiated: ${oldTabId} → ${newTabId}`
- Hook execution: `[ADOPTION_COMPLETE] Post-persistence hook triggered, write queue unblocked`
- Queue status: `[WRITE_QUEUE] ${pendingCount} operations now executable`

**Navigation Context Logging (Issue 21)**

Current state: No logs showing domain context or hydration scope checks.

Operators cannot see:
- What domain page navigated to
- Whether hydration attempted
- Why hydration failed
- What snapshots became inaccessible

Required logs would show:
- Navigation detected: `[NAVIGATION] Domain changed: ${oldDomain} → ${newDomain}`
- Hydration attempted: `[HYDRATION_DOMAIN_CHECK] Current domain ${currentDomain} vs snapshot context ${snapshotDomain}`
- Filter results: `[HYDRATION_FILTER] ${totalSnapshots} snapshots, ${visibleCount} visible, ${filteredCount} filtered by domain`

**Response Format Logging (Issue 22)**

Current state: No logs showing response format validation or mismatches.

Operators cannot see:
- What response format received
- Whether format matched expectation
- If validation failed
- What error resulted

Required logs would show:
- Response received: `[MSG_RESPONSE] Command ${command} received response format: ${responseType}`
- Validation: `[MSG_VALIDATE] Expected schema has fields ${expectedFields}, got ${actualFields}`
- Mismatch: `[MSG_SCHEMA_MISMATCH] Field ${field} expected type ${expectedType}, got ${actualType}`

---

## API Limitations Enabling These Issues

### Firefox Containers API Limitation

From Mozilla Hacks "Containers for Add-on Developers":

> "`cookieStoreId` is the storage boundary. Each container has isolated storage. When tabs move between containers, their storage context changes."

**Problem:** The API changes `cookieStoreId` automatically when tab moves to new container. Extension must explicitly track and update metadata that depends on container context.

### Firefox Navigation Model

From MDN WebExtensions Content Scripts:

> "Content scripts are injected on page load. Same tab ID persists across multiple domains."

**Problem:** Tab ID constant but domain context changes. Extension must track both `tabId` AND `domain` for snapshot scoping.

### Message Delivery No Schema Enforcement

From MDN Runtime Messages:

> "No schema validation occurs. Handlers must ensure response format. One-off messages get single response."

**Problem:** No automatic validation of response shape. Each handler must implement its own schema, but currently they don't.

---

## Fix Requirements Summary

### Issue 19: Container Context Update During Adoption

The adoption workflow must:
- Detect container change during adoption
- Update snapshot metadata with new `cookieStoreId` context
- Reindex snapshots to new container storage location
- Validate snapshots accessible in new container after adoption

### Issue 20: Post-Adoption Persistence Hook Wiring

The adoption handler must:
- Call `triggerPostAdoptionPersistence()` after metadata updated
- Block writes only during metadata update, not after
- Log hook execution for visibility
- Verify write queue unblocked before returning

### Issue 21: Cross-Domain Navigation Scope Handling

The hydration layer must:
- Detect domain change on page load
- Update snapshot context metadata for new domain
- Clear or revalidate snapshot TTL on domain change
- Filter snapshots by current domain, not stored domain

### Issue 22: Response Format Validation Layer

The MessageRouter must:
- Define response schema for each command
- Validate responses before returning to content scripts
- Log schema violations for debugging
- Normalize responses to consistent format

---

## Connection to Previous Issues

These four issues build upon and extend earlier documented issues:

- **Issue 8** (Handler registration timing): Issues 19-22 worsen if handlers not ready
- **Issue 14** (Message handlers undefined): Issue 22 occurs even when handlers exist
- **Issue 15** (Inconsistent response format): Issue 22 is generalized version
- **Issue 16** (Port lifecycle): Issues 19-22 affect port message responses
- **Issue 17** (Snapshot restoration assumption): Issues 19 & 21 cause restoration to fail
- **Issue 18** (No validation): Issue 22 is validation gap

---

## Recommended Priority

Fix in this order:

1. **Issue 20 (Post-adoption hook)**: Unblocks writes immediately, fixes adoption workflows
2. **Issue 22 (Response validation)**: Enables visibility into all message failures
3. **Issue 19 (Container context)**: Fixes multi-container workflows
4. **Issue 21 (Navigation scope)**: Fixes cross-domain navigation workflows

Issues 20 and 22 are prerequisite for debugging issues 19 and 21.

---

## Notes for Copilot Agent

**Why These Issues Were Missed:**

1. **Issue 19**: Container context not visibly referenced in adoption code; assumption that `originTabId` alone suffices
2. **Issue 20**: Hook exists but never invoked; requires call site search across entire codebase
3. **Issue 21**: Assumes domain scoping not needed; doesn't account for single-tab multi-domain navigation
4. **Issue 22**: Schema validation considered optional; each handler evolved independently

**Testing Strategy:**

- Issue 19: Test adoption across containers, verify snapshots accessible in new container
- Issue 20: Monitor write queue state before/after adoption, verify hook execution
- Issue 21: Navigate same tab to different domain, verify snapshots restored
- Issue 22: Mock malformed responses, verify handling doesn't crash

**Implementation Complexity:**

- Issue 20: ~30 minutes (add method call)
- Issue 22: ~2-3 hours (schema layer + validation)
- Issue 19: ~3-4 hours (container metadata tracking)
- Issue 21: ~4-5 hours (domain context management)

---

**End of Report**

**Document Status:** Complete scanning and analysis phase  
**Ready for:** Implementation phase  
**Next Action:** Copilot Agent implementation of fixes
