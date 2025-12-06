# Quick Tab Minimize/Restore Failure Bug Report

**Extension Version:** v1.6.3.6-v5  
**Date:** 2025-12-06  
**Severity:** Critical  
**Status:** Minimized Quick Tab does not render when restored while Manager is open

---

## Executive Summary

When a Quick Tab is minimized and then restored while the Quick Tab Manager is open, the minimized Quick Tab fails to render despite the indicator correctly toggling from yellow to green. The root cause is that the `originTabId` field—critical for cross-tab synchronization validation—is lost during the minimize/restore cycle. When `UICoordinator` attempts to render the restored Quick Tab, its CROSS-TAB BLOCKED validation rejects the operation because `originTabId` is `null` or `undefined`, preventing DOM re-creation. The extension's logging does not capture this validation failure or the missing field, obscuring the issue.

---

## Scope

**Modify:**
- `src/features/quick-tabs/handlers/VisibilityHandler.ts` - minimize/restore lifecycle and snapshot handling
- `src/features/quick-tabs/managers/MinimizedManager.ts` - snapshot creation and restoration data preservation
- `src/ui/UICoordinator.ts` - logging around CROSS-TAB BLOCKED validation and entity state
- `src/features/quick-tabs/storage/QuickTabsStorage.ts` - storage persistence and retrieval

**Do NOT Modify:**
- Content scripts
- Manifest configuration
- Background service worker primary logic (context-dependent)

---

## Issue: Minimized Quick Tab Cannot Be Restored

### Problem

User minimizes a Quick Tab via the UI button or Manager Panel button (indicator turns yellow ✓). While Manager is open, user clicks the restore button repeatedly. The indicator toggles yellow↔green correctly, but **the Quick Tab DOM never reappears on screen**. The Quick Tab remains invisible despite state indicating it should be visible.

### Root Cause

**File:** `src/features/quick-tabs/managers/MinimizedManager.ts`  
**Location:** `createSnapshot()` method and restoration flow  
**Issue:** When `MinimizedManager.createSnapshot()` is called during minimize, it saves only the Quick Tab's **position and size data** to the snapshot. The `originTabId` field—which is required by `UICoordinator` for CROSS-TAB BLOCKED validation—is **not included in the snapshot**. During restore, when the snapshot is applied and `UICoordinator.applySnapshotForRestore()` reconstructs the entity state, the `originTabId` field remains `null` or `undefined`.

**File:** `src/ui/UICoordinator.ts`  
**Location:** Entity validation check (CROSS-TAB BLOCKED warning in logs)  
**Issue:** When `UICoordinator.update()` receives the storage change event indicating minimize should be restored (`minimized: false`), it validates the Quick Tab entity before rendering. The validation checks that `originTabId` exists and is non-null. Since the field is missing from the restored entity, the CROSS-TAB BLOCKED check **silently rejects the render operation**. No container is created, no DOM element appears.

**Result:** Storage state says `minimized: false` and the indicator updates to green, but the DOM is never re-created because validation failed before rendering was attempted.

### Bugged Behaviors Observed

1. **Indicator updates but UI doesn't:** Minimize state in storage toggles correctly (yellow↔green), but Quick Tab container never re-renders on restore.

2. **Repeated rejections:** Each restore attempt triggers the same CROSS-TAB BLOCKED validation failure. No retry mechanism or fallback exists.

3. **Silent failure:** No user-facing error message. No console error visible to user. The operation fails silently at validation layer.

4. **Orphaned snapshot:** When restore fails, the snapshot stored in `MinimizedManager` is not cleared. Subsequent restore attempts continue to apply the same incomplete snapshot.

5. **Rendered flag mismatch:** The Quick Tab entity's `rendered: false` flag persists even though storage says `minimized: false`. State becomes inconsistent—storage and entity entity disagree on visibility.

6. **No re-wiring of controllers:** When render fails, `DragController` and `ResizeController` callbacks are never re-attached. Even if DOM appeared later, interaction would not work.

---

## Missing Logging

The following logging actions are absent from the codebase, making this bug difficult to diagnose:

### 1. MinimizedManager Snapshot Logging

**Missing:** When `createSnapshot()` executes during minimize, no log shows:
- What fields are being captured in the snapshot
- Whether `originTabId` is intentionally excluded or accidentally missing
- Comparison of entity state before/after snapshot creation

**Impact:** User cannot verify if snapshot is complete or if field loss is expected.

### 2. UICoordinator Validation Logging

**Missing:** When `UICoordinator` performs CROSS-TAB BLOCKED validation, no log shows:
- Which field failed validation and its current value
- Whether validation passed or failed before attempting render
- State of `originTabId` field before/after restoration

**Impact:** Critical validation failure is silent. No record of rejection exists in logs.

### 3. Restore Attempt Logging

**Missing:** When `VisibilityHandler.executeRestore()` is called, no log shows:
- Current state of the entity's `originTabId` before calling `tabWindow.restore()`
- Whether `tabWindow.restore()` successfully restored `originTabId`
- Whether callbacks (onMinimize, onFocus) were properly re-wired

**Impact:** Entire restore process is invisible to logging system. Only storage changes appear.

### 4. Storage Write Verification Logging

**Missing:** When state transitions from minimized→restored, no log shows:
- Whether `browser.storage.local.set()` was actually called (not just state mutation)
- Payload being written to storage (which fields are included)
- Confirmation that storage write completed before UI update

**Impact:** Cannot verify if storage layer received the minimize state change. Storage.onChanged event fires, but source cannot be traced.

### 5. Entity Reconstruction Logging

**Missing:** When `UICoordinator.applySnapshotForRestore()` applies the snapshot, no log shows:
- Fields being copied from snapshot into entity
- Which fields are missing and need fallback sources
- Whether `originTabId` was explicitly looked up from backup storage

**Impact:** State reconstruction is a black box. Field loss during this step goes undetected.

### 6. Render Attempt Logging

**Missing:** When `QuickTabWindow.render()` is called (or attempted to be called), no log shows:
- Pre-render state of entity (is it valid, does it have originTabId)
- Whether render was skipped due to validation failure
- Container attachment success/failure with entity state at that moment

**Impact:** Silent render skip cannot be distinguished from actual render execution.

---

## Acceptance Criteria

**Minimum Requirements:**
- Minimized Quick Tab successfully renders when restore button is clicked
- Indicator changes from yellow to green AND Quick Tab appears on screen
- Restore works while Manager is open
- Restore works when performed multiple times consecutively

**Logging Requirements:**
- Minimize operation logs: Quick Tab ID, snapshot fields being saved, originTabId status
- Restore operation logs: validation checks, originTabId lookup, render attempt status
- CROSS-TAB BLOCKED rejection logs: field name, value, entity state at validation time
- Storage write logging: confirm storage.local.set called with complete payload

**State Requirements:**
- After restore, Quick Tab entity has valid originTabId matching creation context
- Snapshot includes all fields necessary for complete entity reconstruction
- After restore, DragController and ResizeController callbacks are re-attached and functional

**Testing Scenarios:**
- Minimize Quick Tab → Manager open → click restore button once → Quick Tab appears
- Minimize → Manager open → rapid restore clicks (5x) → Quick Tab appears on first or all attempts
- Minimize QT1 on Tab1, Minimize QT2 on Tab2 → Manager open → restore both sequentially → both appear
- Minimize → close Manager → reopen Manager → restore → Quick Tab appears

---

## Supporting Context

### Browser API Behavior

According to MDN documentation for [`browser.storage.onChanged`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/onChanged), the event fires **only when** `storageArea.set()`, `storageArea.remove()`, or `storageArea.clear()` executes. Local state mutations without storage writes do not trigger the event. This means:

- If `VisibilityHandler.executeRestore()` only mutates entity state without calling `storage.local.set()`, the Manager's storage listener never receives update
- Storage.onChanged event is the primary signal for Manager to update UI
- Field loss during restore may occur silently because no logging captures the storage write payload

### Cross-Tab Synchronization Context

The `originTabId` field is required because Quick Tabs must know which tab they belong to for:
- Solo mode (show only on specific tab)
- Mute mode (show on all except specific tab)
- Container isolation (prevent tabs in different containers from sharing Quick Tabs)
- Cross-tab messaging (ensure Quick Tabs sync correctly across tab boundaries)

When `originTabId` is null, the extension cannot determine tab context and rejects rendering as safety measure.

### MinimizedManager Snapshot Architecture

`MinimizedManager` snapshots are designed to preserve Quick Tab positioning when minimized. However, current implementation focuses narrowly on **dimensions only** (left, top, width, height). Reconstruction assumes other fields remain unchanged or can be inferred. This assumption breaks when critical fields like `originTabId` are not backed up.

---

## Detailed Evidence

<details>
<summary>Log Evidence: Minimize and Restore Sequence</summary>

**Timestamp 2025-12-06T20:37:09.927Z - WARN CROSS-TAB BLOCKED Rejection:**
```
[WARN] UICoordinator[Tab 14] CROSS-TAB BLOCKED: Quick Tab has null/undefined originTabId - REJECTED
```

**Timestamp 2025-12-06T20:37:16.562Z - QuickTabWindow.minimize() Success:**
```
[LOG] [QuickTabWindow][minimize] No container or fallback DOM element found
[LOG] [QuickTabWindow][minimize] Container reference nullified
[LOG] [QuickTabWindow][minimize] EXIT (DOM removed): minimized: true, rendered: false
```

**Key Gap:** MinimizedManager.createSnapshot() logs show only position/size saved. No field inventory. No originTabId mention.

**Key Gap:** VisibilityHandler.executeRestore() logs show state change but no entity field verification after snapshot application.

</details>

<details>
<summary>Architecture Context: Storage and UICoordinator</summary>

The extension architecture uses `browser.storage.local` as the source of truth for Quick Tab state. When state changes:

1. Handler (e.g., `VisibilityHandler`) mutates entity and/or calls `storage.local.set()`
2. Storage.onChanged event fires in background and all content scripts
3. `UICoordinator` receives event and calls `update()` with new state
4. `UICoordinator` validates entity before rendering

For minimize/restore:
- Minimize: state written to storage with `minimized: true`
- Restore: state written to storage with `minimized: false`
- UICoordinator sees `minimized: false` and should restore DOM

However, if entity lacks `originTabId` after snapshot restoration, UICoordinator validation fails before render is even attempted. The state change signal is received, but the entity is invalid for rendering.

</details>

---

## Why This Is a Long-Term Issue

This bug was likely introduced when:
- MinimizedManager snapshot logic was added without including all required fields
- CROSS-TAB BLOCKED validation was added to prevent invalid renders
- Restore flow wasn't updated to verify field completeness after snapshot application
- Logging was not added to capture validation rejections and entity state mismatches

The combination of incomplete snapshot + strict validation + missing logging created a scenario where state appears correct (indicator green) but entity is invalid (missing originTabId), and no logs explain why render was skipped.

---

## Priority

**Critical** - Core feature (minimize/restore) is non-functional while Manager Panel is open, which is the exact scenario where users rely on this feature.

---

## Estimated Complexity

**Medium** - Requires:
- Snapshot field audit to include originTabId
- Restore flow validation to confirm field presence
- Logging additions at 4-5 key points
- Potential fallback lookup if originTabId cannot be recovered from snapshot

