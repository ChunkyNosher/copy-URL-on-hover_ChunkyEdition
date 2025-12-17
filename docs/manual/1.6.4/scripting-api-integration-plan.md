# Scripting API Integration Enhancement Plan

**Quick Tabs & Copy-URL-on-Hover Extension**  
**Extension Version:** v1.6.3.10-v4 (Post-Copilot Diagnostic Fixes)  
**Date:** December 17, 2025  
**Analysis Period:** Post-fix assessment of remaining architectural gaps

---

## Executive Summary

While Copilot's recent diagnostic fixes (v1.6.3.10-v1 through v1.6.3.10-v4)
successfully addressed 15 of 16 operational issues through enhanced validation,
logging, and port lifecycle management, the fixes operate within the existing
messaging-based architecture. The `browser.scripting` API offers complementary
architectural improvements that address remaining root limitations: atomicity
gaps, Firefox timeout edge cases, message round-trip overhead, and tab-boundary
state leakage.

This report identifies three critical areas where Scripting API integration
would provide robust, long-term enhancements beyond current operational fixes.

| Enhancement              | Current Implementation  | Scripting API Alternative | Priority | Benefit                       |
| ------------------------ | ----------------------- | ------------------------- | -------- | ----------------------------- |
| Atomic Operations        | Multi-step messaging    | Single function injection | High     | True all-or-nothing execution |
| Firefox Timeout Recovery | 15s keepalive margin    | No port dependency        | High     | Eliminates edge cases         |
| Per-Tab State Isolation  | Filtered via validation | Native context isolation  | Medium   | Architectural simplification  |

**Why Bundled:** All three enhancements affect Quick Tabs state coordination,
share messaging architecture context, and can be implemented through unified
Scripting API adoption strategy without conflicts.

---

## Issues Overview

| Enhancement # | Component                         | Category         | Current Gap                                      | Root Cause                                                       |
| ------------- | --------------------------------- | ---------------- | ------------------------------------------------ | ---------------------------------------------------------------- |
| 1             | VisibilityHandler, RestoreHandler | Atomicity        | Multi-step operations lack atomic guarantee      | Messaging split validation + operation into separate round-trips |
| 2             | UICoordinator, background.js      | Timeout Recovery | Firefox 30s timeout still possible on edge cases | Port lifecycle requires live background connection               |
| 3             | All handlers                      | State Isolation  | Per-tab state crosses boundaries via messaging   | Filtering applied, but not architecturally enforced              |

---

## Enhancement 1: Atomic Operations via Scripting Injection

### Problem

Quick Tabs operations (minimize, restore, focus, delete) are currently split
across messaging layers: validation in content script → message to background →
operation → broadcast back. This multi-step pattern creates potential failure
points where operations may partially complete or timeout mid-execution.

### Root Cause

File: `src/features/quick-tabs/handlers/VisibilityHandler.js`  
Location: `handleMinimize`, `handleRestore`, `handleFocus`, `handleSoloToggle`
methods  
Issue: Each operation sends message, waits for background validation, then waits
for broadcast confirmation. No guarantee of atomic completion. If port closes or
times out between steps, state can become inconsistent.

### Fix Required

Consolidate operation logic into single injected functions that execute
atomically in content script context. This moves validation + operation +
persistence into a single execution frame where all-or-nothing semantics are
guaranteed. No pseudo-code; Copilot should determine optimal organization of
injected functions for each operation type (minimize, restore, focus) while
maintaining existing error handling and logging patterns.

---

## Enhancement 2: Firefox 30-Second Timeout Recovery

### Problem

While Copilot's fix improved keepalive from 25s → 15s (10s margin before 30s
timeout), edge cases remain where long-running operations (>5s) could exceed the
30s background script lifetime in Firefox. Current mitigation: 15s keepalive +
retry logic. Still possible timeout if multiple queued operations execute
sequentially.

### Root Cause

File: `background.js`  
Location: Port lifecycle management (lines ~300-400), keepalive heartbeat logic
(lines ~500-550)  
Issue: Messaging-based recovery depends on background script staying alive.
Firefox's Event Page model terminates background after 30s of inactivity. Even
with keepalive, very long operations queue could exhaust the window.

### Fix Required

Implement fallback pattern: if messaging fails (port dead, no response), fall
back to direct scripting injection that doesn't require background script. This
requires detecting when background is unresponsive and switching strategies.
Scripting API injections execute independently without background dependency,
providing safety net for timeout scenarios. Maintain current messaging as fast
path, Scripting API as recovery path.

---

## Enhancement 3: Per-Tab State Isolation Architecture

### Problem

Current implementation applies per-tab state filtering via validation helpers
(`_isOwnedByCurrentTab()`, `_filterOwnedTabs()`), but this is enforced
operationally rather than architecturally. State still crosses tab boundaries
through messaging and shared storage. A malformed message or edge case in
validation could still leak state across tabs.

### Root Cause

File: Multiple handlers (`VisibilityHandler.js`, `DestroyHandler.js`,
`RestoreHandler.js`, `UpdateHandler.js`)  
Location: Ownership validation helpers throughout, storage access patterns  
Issue: Validation is defensive layering. Architecturally, tabs share storage and
messaging channels. Scripting API naturally isolates execution to specific tab
context, making isolation inherent rather than enforced.

### Fix Required

Migrate critical state operations to Scripting API where each tab injection runs
in isolated context with its own state scope. This moves from "validate
ownership" to "run in tab-specific context." Eliminates need for some validation
boilerplate. Container-specific context becomes natural parameter injection
rather than background tracking.

---

## Implementation Constraints & Scope

### Modify Files

- `src/features/quick-tabs/handlers/VisibilityHandler.js` – Add scripting-based
  operation functions, fallback logic
- `background.js` – Add Scripting API injection layer, fallback detection
- `src/content.js` – Add scripting result handling, state update patterns
- `src/features/quick-tabs/handlers/RestoreHandler.js` – Adapt hydration for
  isolated context

### Do NOT Modify

- `manifest.json` – Keep static content_scripts; scripting is supplementary
- `src/storage/*` – Storage API remains unchanged; Scripting handles state
  coordination
- `sidebar/quick-tabs-manager.js` – UI layer unchanged; works with
  Scripting-injected state
- Test infrastructure – Existing tests remain valid; new Scripting-based
  operations tested alongside

### Why These Boundaries

Current fixes added validation layers without restructuring messaging. Scripting
API additions should complement, not replace, this work. Content script still
loads at manifest level; Scripting API supplements with atomic operations.
Storage API unchanged; Scripting API just provides cleaner state coordination.

---

## Shared Architecture Guidance

### Atomicity Implementation Pattern

Operations injected via Scripting should execute single-shot: retrieve state →
validate → operate → update → return result. No partial success. If any step
fails, Promise rejects with diagnostic error. Distinguish from current messaging
which can fail silently.

### Fallback Strategy

Maintain messaging as primary path (faster, doesn't require tab context). If
messaging fails (port dead, timeout), catch error and retry via Scripting API.
Scripting injection cost (~2-4ms) acceptable for fallback. First success wins;
no retry cascading.

### Container Context Injection

Background maintains tab → container mapping (already implemented in
v1.6.3.10-v4). When injecting via Scripting, pass container as function
argument. Injected code marks state with container scope, naturally preventing
cross-container leakage.

### Error Handling Consistency

Scripting API rejects with exceptions. Translate to same error structure as
current messaging to maintain logging and retry logic. DiagnosticLogger already
captures structured errors; extend to log Scripting injection failures
identically.

---

## Acceptance Criteria

### Enhancement 1: Atomic Operations

- `handleMinimize` via Scripting executes atomically: validation + state
  update + event emit in single injection
- No timeout/retry retry on messaging failure triggers fallback to Scripting
- All existing tests pass without modification
- Manual test: Perform minimize, reload page, verify state persisted (atomicity
  verified)

### Enhancement 2: Timeout Recovery

- Scripting fallback detects messaging failure within 2s timeout
- Subsequent operations via Scripting API succeed when background is dead
- Background restarts: messaging fast path resumes automatically
- Manual test: Kill background (Firefox about:debugging), perform operation,
  verify Scripting handles it

### Enhancement 3: State Isolation

- Each tab's Scripting injection has isolated state context
- No state leakage detected in cross-tab isolation tests
- Container boundaries enforced by context injection, not validation layer
- Manual test: Two tabs with same URL, create QT in one tab, verify not visible
  in other

---

## Supporting Context

<details>
<summary>MDN Scripting API Compatibility</summary>

Firefox supports `browser.scripting` API as of Firefox 102+. Chrome supports
`chrome.scripting` (MV3 only). Current extension targets both browsers via
WebExtensions compatibility layer. Scripting API available cross-browser; no
version gaps.

Key differences: Firefox allows partial results when permissions missing; Chrome
blocks entirely. Error handling must account for Firefox partial-success
scenarios.

</details>

<details>
<summary>Messaging vs. Scripting Performance Profile</summary>

Current messaging: ~6-9ms per operation (Copilot's v1.6.3.10-v2 optimization).

Scripting injection: ~2-4ms direct execution (no round-trip). Fallback path
slower acceptable for recovery scenarios. Hybrid approach combines messaging
speed (primary) + Scripting reliability (fallback).

Storage writes: ~50-200ms regardless of messaging vs. Scripting (storage API is
bottleneck, not coordination).

</details>

<details>
<summary>Port Lifecycle Root Cause</summary>

Firefox Event Page model (used when Event Pages selected in manifest):
Background script unloads after 30s with no active connections. Keepalive
heartbeat extends this by resetting timer, but queued operations can exceed
window.

Chrome Service Worker model: Longer lifetime (typically persists) but same
potential timeout under extreme load.

Scripting API avoids this: Injection happens synchronously in content script
(which persists), returns result immediately. No background dependence for
execution.

</details>

<details>
<summary>Current Validation Helpers (Operational Safeguards)</summary>

- `VisibilityHandler._isOwnedByCurrentTab()` checks originTabId === currentTabId
- `VisibilityHandler._validateCrossTabOwnership()` logs rejections
- `DestroyHandler._isOwnedByCurrentTab()` prevents cross-tab deletion
- `RestoreHandler._filterOwnedTabs()` filters hydration by originTabId

These work well operationally but are defensive: external validation applied to
potentially-tainted data. Scripting API approach: inject into specific tab,
state isolation becomes inherent.

</details>

---

## Priority & Complexity

| Enhancement           | Priority | Complexity | Target Delivery     |
| --------------------- | -------- | ---------- | ------------------- |
| Atomic Operations (1) | High     | Medium     | Phase 2 (next PR)   |
| Timeout Recovery (2)  | High     | Low        | Phase 2 (same PR)   |
| State Isolation (3)   | Medium   | Medium     | Phase 3 (future PR) |

**Dependency Chain:** Timeout Recovery depends on Atomic Operations (both need
Scripting injection layer). State Isolation independent but benefits from
infrastructure built in phases 1-2.

---

## Estimated Implementation Scope

- **Lines Changed:** ~400-600 lines added (new injection functions, fallback
  logic)
- **Files Affected:** 4 core files (VisibilityHandler, DestroyHandler,
  background, content)
- **Test Coverage:** New test cases for Scripting fallback scenarios, isolation
  verification
- **Breaking Changes:** None (Scripting API additions are additive, messaging
  primary path unchanged)

---

## Success Metrics

1. **Atomicity:** Zero partial-state bugs after Scripting implementation (vs.
   current baseline with potential timeout issues)
2. **Timeout Recovery:** 100% operation success rate even when background dies
   (vs. current edge case failures)
3. **State Isolation:** Cross-tab state leakage rate: 0% (monitor for
   regressions)
4. **Performance:** Messaging path unchanged (<10ms latency); fallback path
   slower but acceptable for recovery
5. **Compatibility:** All tests pass on Chrome + Firefox; no new console errors

---

## Next Steps

1. **Phase 1:** Implement atomic operation helper for single handler (e.g.,
   `handleMinimize`); validate pattern works
2. **Phase 2:** Extend to all handlers; add timeout fallback detection
3. **Phase 3:** Evaluate full state isolation migration (may become separate
   major refactor)

---

**Report Prepared By:** Scripting API Architecture Analysis  
**Repository:** ChunkyNosher/copy-URL-on-hover_ChunkyEdition  
**Current Branch:** copilot/fix-diagnostic-report-issues-again  
**Analysis Date:** December 17, 2025
