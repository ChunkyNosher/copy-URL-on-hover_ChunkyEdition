# Missing Diagnostic Instrumentation and Event Pipeline Gaps

**Extension Version:** v1.6.3.11-v3 | **Date:** 2025-12-22 | **Scope:** System-wide logging infrastructure, event pipeline visibility, state management observability, and cross-component communication gaps

---

## Executive Summary

The extension lacks comprehensive diagnostic instrumentation across its entire runtime stack, making troubleshooting critical issues nearly impossible. When users report problems ("extension doesn't work", "sidebar won't open", "shortcuts don't trigger"), developers cannot trace execution paths through the system. This diagnostic gap exists at multiple layers: (1) background script event handling has no logging for message reception, validation, or dispatch, (2) content script hover pipeline produces no output, (3) sidebar UI has no feedback about state changes or API calls, (4) cross-component communication (MessageRouter, event bus) lacks visibility into routing decisions, and (5) storage operations don't log success/failure/timing information. Combined with missing error context (what triggered the failure? what was the user doing?), this infrastructure gap prevents effective debugging of both user-reported issues and underlying architecture problems.

## Issues Overview

| Issue | Component | Severity | Root Cause |
|-------|-----------|----------|------------|
| #1: Missing Content Script Event Pipeline Logging | `src/content.js` | High | No logging for URL detection flow, tooltip triggers, or error states |
| #2: Background Script Event Bus Lack of Visibility | `src/background/index.js`, event system | High | No logging for event flow, listener registration, or cross-tab communication |
| #3: Sidebar State Management Lacks Observability | `sidebar/*.js`, state files | High | No logging for state changes, API calls, storage updates |
| #4: MessageRouter Incomplete Request/Response Tracing | `src/background/MessageRouter.js` | High | Routing decisions not visible; handler selection not logged; response paths uncovered |
| #5: Storage Operations Missing Success/Timing Telemetry | Multiple components | Medium | No indication when storage writes succeed/fail; no timing info for performance analysis |
| #6: Error Context Loss in Handler Execution | `src/background/handlers/` | Medium | Errors logged without request context; stack traces lack call chain information |

**Why bundled:** All issues stem from incomplete logging infrastructure rather than logic errors. Fixing requires coordinated addition of structured logging across multiple systems with consistent patterns, prefixes, and context information. Issues interconnect: fixing #1 (content logging) enables debugging hover failures, #2-3 enable debugging UI issues, #4-5 enable debugging state sync problems.

<scope>
**Modify:**
- `src/content.js` (add logging to hover event pipeline)
- `src/background/index.js` (add logging to event registration and dispatch)
- `src/background/MessageRouter.js` (enhance routing decision logging)
- `src/background/handlers/` (add error context logging)
- `sidebar/quick-tabs-manager.js` (add state change logging)
- `src/storage/` or storage abstraction layer (add operation logging)
- Any utility modules that provide logging infrastructure

**Do NOT Modify:**
- `manifest.json`
- Core handler logic (VisibilityHandler, DestroyHandler, etc.)
- UI component render logic (unless adding logging output)
- Test files
- Build/config files
</scope>

---

## Issue #1: Missing Content Script Event Pipeline Logging

### Problem
When hover-to-copy URL feature fails, users cannot provide useful debugging information. Developers cannot determine: was the element hovered? was a link detected? was the URL extracted? why was tooltip not shown? No console output guides troubleshooting.

### Root Cause
**File:** `src/content.js`  
**Location:** Mouse event listeners, URL extraction functions, tooltip creation  
**Issue:** Content script handles critical user interaction (hover) but produces no diagnostic output. No logging when events arrive, which handlers are tried, what validation passes/fails, or whether URL was found. Silent failures give impression of broken functionality. Error thrown during extraction produces stack trace but no context about what element was hovered or what extraction step failed.

### Fix Required
Instrument content script pipeline with structured logging at each stage: (1) log when hover event arrives with element info, (2) log platform detection result, (3) log handler selection, (4) log URL extraction attempts and results, (5) log tooltip creation and display, (6) log any errors with full context (element, handler, extraction point). Use consistent prefixes for filtering: `[CONTENT]`, `[HOVER]`, `[URL_EXTRACT]`, `[TOOLTIP]`. Include element type, URL found (or null), timing information. Enable/disable via configuration flag without code changes.

---

## Issue #2: Background Script Event Bus Lack of Visibility

### Problem
When Quick Tabs Manager doesn't appear after shortcut press, or sidebar fails to open, developers cannot diagnose why. No indication whether: keyboard listener registered? command event fired? handler invoked? response sent? Events disappear into system with zero visibility.

### Root Cause
**File:** `src/background/index.js` or main background script entry point  
**Location:** Event listener registration (`browser.commands.onCommand`, `browser.tabs.onActivated`, etc.), event dispatch code  
**Issue:** Background script registers multiple event listeners but produces no logging when listeners fire. Custom event system (if one exists) doesn't log event emission, listener invocation, or completion. Cross-tab communication (if supported) has no visibility into message flow. Error conditions produce stack traces without context about what triggered the error or what should have happened.

### Fix Required
Log when each event listener is registered during initialization (confirm registration succeeded). Log when each listener is invoked with event context (command name, tab ID, etc.). Log listener completion or errors. Create structured logs with standardized prefixes: `[LISTENER_REG]`, `[LISTENER_INVOKE]`, `[EVENT_COMPLETE]`. Include sufficient context (command name, tab ID, message type) to correlate logs across multiple events. Ensure error logs include what operation was attempted (e.g., "failed to toggle sidebar" not just "toggle failed").

---

## Issue #3: Sidebar State Management Lacks Observability

### Problem
Sidebar settings appear to save (form clears, button stops loading), but subsequent reload shows old settings. Or sidebar shows outdated Quick Tabs list despite tab being recently opened. Users cannot tell if settings actually persisted. Developers cannot diagnose whether storage write succeeded, whether state update was triggered, or whether UI refresh failed.

### Root Cause
**Files:** `sidebar/quick-tabs-manager.js`, `sidebar/settings.js` (or equivalent state files), any React/state management hooks  
**Location:** State update functions, storage write operations, event listeners for state changes  
**Issue:** Sidebar components update state and trigger storage writes but produce no observable output. No logging when state changes, what changed, why change occurred. No indication when storage operations start/complete/fail. No logs correlating UI updates to triggering actions. Error in storage write produces generic error with no context.

### Fix Required
Log all state mutations with before/after values and trigger reason. Log storage write initiation, completion, and any errors. Log state-change listeners firing and what state they observed. Include correlation IDs to link related logs (settings saved → storage write → state updated → UI refresh). Use prefixes: `[STATE_UPDATE]`, `[STORAGE_WRITE]`, `[STATE_LISTEN]`. For storage errors, include operation type (read/write), attempted data, and actual error message. Add state inspection endpoint (developer tool or debug page) showing current state without accessing storage directly.

---

## Issue #4: MessageRouter Incomplete Request/Response Tracing

### Problem
Messages sent to background handler sometimes produce no response. Developers see in MessageRouter validation that message failed, but cannot see: was it missing required fields? was protocol version wrong? was handler not found? did handler execution complete? Response lost or never sent? No trace through request lifecycle.

### Root Cause
**File:** `src/background/MessageRouter.js`  
**Location:** `route()` method, validation helper functions, handler invocation, response sending  
**Issue:** While MessageRouter includes some logging, it lacks comprehensive request/response tracing. Message arrives at router but logs don't show entry point clearly. Validation steps execute but don't log what validation passed/failed at each checkpoint. Handler is selected but no log indicates which handler or why. Handler executes but return value not logged. Response sent but success not confirmed. Gaps in logging create "invisible" failure points.

### Fix Required
Log message arrival with sender and basic structure (tab ID, action, protocol version). Log each validation step outcome (protocol check passed? ownership check passed? command format valid?). Log handler selection decision with handler name. Log handler entry with parameters and exit with return value. Log response serialization and sending with response structure. Use correlation IDs to link all logs for single message. Create hierarchical prefix structure: `[MSG]` for entry, `[MSG:VALIDATE]` for validation, `[MSG:ROUTE]` for routing, `[MSG:EXEC]` for execution, `[MSG:RESPONSE]` for response. Ensure logs provide "follow the yellow brick road" visibility—developer can trace message from sender through router to handler to response.

---

## Issue #5: Storage Operations Missing Success/Timing Telemetry

### Problem
Settings saved but unsure if actually persisted. Quick Tabs list updated but unclear if storage reflects new tabs. Performance sluggish but no indication which operations are slow. Storage operations execute in black box—no feedback on success, failure, or timing.

### Root Cause
**Files:** Storage abstraction layer (likely `src/storage/`, `src/utils/storage.js`, or inline in handlers)  
**Location:** All `browser.storage.local.get()`, `browser.storage.local.set()`, `browser.storage.local.remove()` calls  
**Issue:** Storage API calls made throughout codebase with no logging. Operations succeed silently or fail without context. No way to distinguish "storage call not yet completed" from "storage call failed" from "storage call succeeded but state not yet updated". Timing information absent—developers cannot identify if slow performance caused by storage operations or other factors.

### Fix Required
Wrap storage operations with logging that includes: (1) operation type (get/set/remove), (2) keys involved, (3) operation start time, (4) operation completion with duration, (5) success/failure status, (6) error details if failure. Create storage operation log with structure like: `[STORAGE] SET settings → 24ms → SUCCESS`. For failed operations, include which keys failed and why (quota exceeded? corruption? API error?). Track aggregate storage performance (total time spent in storage operations per second) to identify if storage is bottleneck. Log warnings if individual operation exceeds 100ms (potential performance issue).

---

## Issue #6: Error Context Loss in Handler Execution

### Problem
Handler throws error with stack trace, but error message lacks context about what handler was doing, what request triggered it, or what should have happened. Stack trace shows `undefined.map is not a function` but not that error occurred while processing tabs array in QuickTabHandler. Developers cannot reproduce error without understanding request that triggered it.

### Root Cause
**Files:** `src/background/handlers/` (all handler files)  
**Location:** Error handling in handler functions  
**Issue:** Handlers execute with try-catch or implicit error propagation, but error handling doesn't augment error object with context. When error bubbles up to MessageRouter or background script, context information lost. Stack trace alone insufficient because issue often involves data state (unexpected array structure, null value, etc.) not visible in stack.

### Fix Required
Catch errors in handlers and augment with context before re-throwing: include request action, handler name, operation being performed, input data structure (not sensitive data, just structure info), and current state if relevant. Format augmented error message as: `Error in QuickTabHandler.loadTabs while processing 15 stored tabs: ${originalError.message}`. Use structured logging for errors: `[ERROR] [QuickTabHandler] loadTabs failed: ${error}` with full context. When error propagates to MessageRouter, log error with request context that triggered it. Ensure error logs include enough information for developer to understand: (1) what handler was executing, (2) what request triggered it, (3) what operation was in progress, (4) what the error was.

---

## Shared Implementation Notes

- All logging should support multiple verbosity levels: ERROR (always on), WARN (issues and important events), INFO (operation flow), DEBUG (detailed diagnostics). Configuration flag should control verbosity without code changes.
- Use consistent timestamp format (ISO 8601) across all logs for correlation.
- Correlation IDs helpful for tracing single user action through multiple components: user presses shortcut → background listener fires → MessageRouter routes → handler executes → response sent → content script receives. All logs for this flow should share correlation ID.
- Sensitive data (full URLs, user settings, personal information) should not be logged. Safe to log: URL domains (not full URLs), operation types, handler names, data structure information (array length, object keys, not values).
- Performance logging should identify slow operations (>100ms for storage, >50ms for message routing) without logging every sub-millisecond operation (verbose but low value).
- Error logs must include original error message plus context; augmentation should be additive not replace original error.
- Logging configuration should persist across reloads; possibly accessible via debug page or configuration file.
- Log lines should be parseable (not just human-readable) to enable log analysis tools: prefix patterns, structured fields, timestamps for correlation.

<acceptance_criteria>
**Issue #1: Content Script Logging**
- [ ] Console shows [HOVER] log when element hovered
- [ ] Console shows [URL_EXTRACT] with extracted URL or null
- [ ] Console shows [TOOLTIP] when tooltip displayed
- [ ] Logs include element tag and extracted URL for successful extractions
- [ ] Error in extraction logged with full context (element, handler attempted)

**Issue #2: Background Event Bus Logging**
- [ ] Console shows [LISTENER_REG] on background script load
- [ ] Console shows [LISTENER_INVOKE] when keyboard shortcut pressed
- [ ] Console shows [LISTENER_INVOKE] when tab activated
- [ ] Each listener invocation includes command/event context
- [ ] Errors in listeners logged with full context

**Issue #3: Sidebar State Logging**
- [ ] Console shows [STATE_UPDATE] when state changes
- [ ] Console shows [STORAGE_WRITE] when settings saved
- [ ] Storage write logs include duration (e.g., "24ms")
- [ ] State change logs show before/after state keys
- [ ] Storage errors logged with operation type and failure reason

**Issue #4: MessageRouter Request/Response Tracing**
- [ ] Console shows [MSG] when message arrives at router
- [ ] Console shows [MSG:VALIDATE] for each validation step
- [ ] Console shows [MSG:ROUTE] with selected handler name
- [ ] Console shows [MSG:EXEC] with handler execution result
- [ ] Console shows [MSG:RESPONSE] with response structure
- [ ] Developer can trace complete request lifecycle from logs alone

**Issue #5: Storage Operation Telemetry**
- [ ] Console shows [STORAGE] for get/set/remove operations
- [ ] Storage logs include operation type and keys involved
- [ ] Storage logs include duration (e.g., "12ms")
- [ ] Storage logs indicate success/failure
- [ ] Failed storage operations logged with error reason

**Issue #6: Handler Error Context**
- [ ] Errors logged with handler name and operation
- [ ] Error logs include request action that triggered it
- [ ] Error logs include data structure info (not sensitive values)
- [ ] Stack traces preserved but augmented with context
- [ ] Error in handler easily traceable to MessageRouter request

**All Issues:**
- [ ] Logging configuration accessible (dev flag or settings)
- [ ] Logs disable without code changes
- [ ] Logs support INFO, WARN, ERROR verbosity levels
- [ ] No sensitive data in logs (URLs, settings values, personal info)
- [ ] Performance logging identifies operations >100ms storage, >50ms routing
- [ ] Correlation IDs enable tracing single action through multiple components
- [ ] Manual test: enable logging → press shortcut → sidebar opens → trace logs show complete flow
- [ ] Manual test: enable logging → hover over YouTube video → console shows [HOVER], [URL_EXTRACT], [TOOLTIP]
</acceptance_criteria>

## Supporting Context

<details>
<summary>Logging Infrastructure Pattern Reference</summary>

Recommended logging pattern using structured prefixes enables console filtering and parsing:

`[COMPONENT:OPERATION] Context description: ${value}`

Examples:
- `[CONTENT:HOVER] Element hovered: DIV.video-container`
- `[STORAGE:WRITE] Saving 5 tabs → 12ms → SUCCESS`
- `[MSG:VALIDATE] Protocol v2.0 accepted`
- `[ERROR] [QuickTabHandler:loadTabs] Failed to parse stored tabs: ${error}`

Benefits of structured format: (1) Console filter for specific component (`filter: "[CONTENT"` shows only content script logs), (2) Parse-friendly for log analysis tools, (3) Consistent across entire codebase, (4) Timestamp and correlation IDs easily added by wrapper function.

</details>

<details>
<summary>Error Context Augmentation Strategy</summary>

When error occurs in handler, augment before logging/re-throwing:

```
Handler executes operation → Error occurs
→ Catch error and create context object:
   - handler: "QuickTabHandler"
   - operation: "loadTabs"
   - action: message.action
   - dataStructure: { tabsCount: 15, hasError: false }
   - originalError: error
→ Log with context: "[ERROR] [QuickTabHandler:loadTabs] Failed to parse ${tabsCount} tabs: ${error.message}"
→ Re-throw or respond with error including context
```

This ensures every error has: (1) what handler, (2) what operation, (3) what request triggered it, (4) what state was involved.

</details>

<details>
<summary>Correlation ID Usage Pattern</summary>

For multi-component flows, generate correlation ID at entry point:

`User presses Ctrl+Alt+Z → Browser generates unique ID (UUID or timestamp) → Background script listener logs with ID → MessageRouter logs with ID → Handler logs with ID → Response sent with ID in metadata → Content script receives and logs with ID`

Later, developer can grep logs for specific ID and see complete flow. Correlation ID should persist through entire request lifecycle but not leak across separate user actions.

</details>

<details>
<summary>Performance Logging Thresholds</summary>

Different operations have different acceptable performance baselines:

- Storage operations: >100ms indicates potential issue (storage likely blocking)
- Message routing: >50ms indicates potential validation overhead
- URL extraction: >20ms indicates potential handler performance issue
- Tooltip display: >30ms indicates potential rendering issue

When operation exceeds threshold, log warning: `[WARN] [STORAGE:WRITE] Slow operation: 234ms for 5 keys`

This helps identify performance regressions without logging every operation.

</details>

---

**Priority:** High (Issues #1-4), Medium (Issues #5-6) | **Target:** Implement #1-3 in single PR, #4-6 in follow-up | **Estimated Complexity:** Medium (mostly additive logging, not logic changes) | **Dependencies:** No dependencies between issues; can be parallelized
