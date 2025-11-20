# Enhanced Logging Implementation Guide for GitHub Copilot

## Purpose

This document provides detailed specifications for implementing comprehensive logging throughout the Copy-URL-on-Hover extension to improve debugging capabilities. The goal is to capture ALL significant user actions, extension operations, and state changes beyond just Quick Tab operations.

**TARGET:** Enable complete diagnostic capability for debugging user-reported issues by logging every meaningful action the extension performs.

---

## Current Logging Scope (What's Already Captured)

Based on analysis of the current codebase (`src/content.js`, `background.js`, `src/utils/console-interceptor.js`):

### ✅ Already Logged Well

- Extension initialization sequence
- Quick Tab CRUD operations (create, update, delete, minimize, restore)
- Quick Tab state synchronization across tabs
- Storage operations (browser.storage.sync read/write)
- Message passing between background and content scripts
- WebRequest header modifications (X-Frame-Options, CSP, CORP removal)
- Tab lifecycle events (activated, closed, updated)
- Global error handlers and unhandled promise rejections

### ⚠️ Partially Logged (Needs Enhancement)

- URL detection (only implicit - no explicit logging when URL is found/not found)
- Clipboard operations (only success/failure notifications - no detailed logging)
- Hover events (state changes logged but not the hover lifecycle itself)
- Keyboard shortcuts (no logging when shortcuts are triggered)
- Settings changes (storage events logged but not what settings changed)

### ❌ Not Logged (Major Gaps)

- URL detection attempts and results for each platform
- Hover start/end events with element details
- Keyboard shortcut detection and execution
- Clipboard API interactions with success/failure reasons
- Event bus emissions and handlers
- DOM element identification process
- Copy text vs copy URL decision logic
- Quick Tab positioning calculations
- Quick Tab Manager panel operations
- Settings validation and migration
- Feature initialization success/failure

---

## Part 1: URL Detection & Hover Events Logging

### Overview

The extension uses `URLHandlerRegistry` to detect URLs from different platforms (Twitter, Reddit, LinkedIn, etc.). Currently, URL detection happens silently - we need detailed logging of WHAT was detected, WHERE, and HOW.

### Current Location

- `src/content.js` - `setupHoverDetection()` function (lines ~366-391)
- `src/features/url-handlers/index.js` - `URLHandlerRegistry.findURL()`
- `src/features/url-handlers/generic.js` - `getLinkText()`

### What to Add

#### 1.1 Hover Lifecycle Logging

**Where:** `setupHoverDetection()` function in `src/content.js`

**Add logging for:**

- **Hover start**: When mouse enters an element
  - Element type (tag name, classes, id)
  - Element text content (truncated to 100 chars)
  - Element position (getBoundingClientRect coordinates)
  - Parent element context
  - Detected domain type (twitter, reddit, generic, etc.)
  - Timestamp

- **Hover end**: When mouse leaves an element
  - Duration of hover (time between mouseover and mouseout)
  - Whether URL was detected during hover
  - Whether any action was taken (copy, Quick Tab, etc.)

**Implementation approach:**

- Track hover start time in a variable
- Log both `mouseover` and `mouseout` events with context
- Calculate and log hover duration on mouseout
- Include all relevant element information for debugging

#### 1.2 URL Detection Process Logging

**Where:** `URLHandlerRegistry.findURL()` method

**Add logging for:**

- **Detection attempt started**:
  - Domain type being used for detection
  - Element being examined
  - Available URL handlers for this domain

- **Handler matching process**:
  - Which handler is being tried
  - Handler's selector pattern
  - Whether selector matched
  - Result of handler execution

- **Detection result**:
  - Success/failure status
  - URL found (if successful)
  - Reason for failure (if unsuccessful):
    - No handler for domain
    - Selector didn't match
    - Element missing expected attributes
    - Handler returned null
  - Fallback attempts (if generic handler used after platform-specific failed)

- **Element hierarchy traversal**:
  - If searching up DOM tree for URL
  - How many parent levels traversed
  - Element at each level
  - Why each level failed/succeeded

**Implementation approach:**

- Log at the START of `findURL()` with element and domain context
- Log each handler attempt with selector and match result
- Log final result with success/failure reason
- For failures, log diagnostic info about why URL couldn't be found
- Include element outerHTML (sanitized, truncated) for debugging

#### 1.3 Platform-Specific Handler Logging

**Where:** Individual handler files (`src/features/url-handlers/*.js`)

**Add logging for:**

- **Twitter handler** (`twitter.js`):
  - Tweet card detected vs single tweet
  - Profile link vs tweet link
  - Shortened URL vs full URL
  - Media URL handling

- **Reddit handler** (`reddit.js`):
  - Post title link vs comments link
  - Old Reddit vs new Reddit detection
  - Subreddit link vs post link
  - External link vs Reddit link

- **LinkedIn handler** (`linkedin.js`):
  - Post URL vs profile URL
  - Company page vs personal profile
  - Feed post vs dedicated post page

- **Generic handler** (`generic.js`):
  - Anchor tag found
  - Href attribute present
  - Protocol validation (http/https)
  - Relative vs absolute URL handling

**Implementation approach:**

- At the start of each handler, log which specific handler is running
- Log the selector it's looking for
- Log what it found (or didn't find)
- For complex handlers, log intermediate steps
- Log the final URL returned (or why null was returned)

---

## Part 2: Clipboard Operations Logging

### Overview

The extension copies URLs and text to clipboard. Currently only shows notifications on success/failure. Need detailed logging of clipboard API interactions.

### Current Location

- `src/core/browser-api.js` - `copyToClipboard()` function
- `src/content.js` - `handleCopyURL()` and `handleCopyText()` functions (lines ~449-508)

### What to Add

#### 2.1 Clipboard API Interaction Logging

**Where:** `copyToClipboard()` function in `src/core/browser-api.js`

**Add logging for:**

- **Copy attempt started**:
  - What is being copied (URL vs text)
  - Content length
  - Content preview (first 100 chars)
  - Clipboard API available?
  - execCommand fallback available?
  - Timestamp

- **API selection**:
  - Which method is being used (navigator.clipboard vs execCommand)
  - Reason for selection
  - Browser/environment capabilities

- **Copy operation result**:
  - Success/failure status
  - Time taken (milliseconds)
  - Error details (if failed):
    - Error name
    - Error message
    - Error stack
    - Permission denied?
    - User agent context
  - Method used (clipboard API, execCommand, fallback)

- **Fallback attempts**:
  - When primary method fails
  - Which fallback is being tried
  - Success/failure of fallback
  - Final result after all attempts

**Implementation approach:**

- Wrap clipboard operations in try-catch with detailed logging
- Log before attempt, during attempt, and after result
- Time the operation for performance tracking
- For failures, capture and log complete error context
- Log which specific API/method succeeded

#### 2.2 Copy Action Context Logging

**Where:** `handleCopyURL()` and `handleCopyText()` in `src/content.js`

**Add logging for:**

- **Copy URL action**:
  - URL being copied
  - Where URL came from (hover detection, Quick Tab, other)
  - Current page URL (for context)
  - Element that triggered copy (if applicable)
  - Keyboard shortcut used (if triggered by shortcut)

- **Copy text action**:
  - Text being copied
  - Text length
  - Element the text came from
  - Method used to extract text (`getLinkText()` result)
  - Any text truncation/processing applied

- **User intent detection**:
  - Was this triggered by keyboard shortcut? (which one?)
  - Was this triggered by Quick Tab action?
  - Was this triggered by notification click?
  - Was this triggered by Quick Tab Manager panel?

**Implementation approach:**

- Log at the START of each copy handler function
- Include all context about what triggered the copy
- Log the decision process (copy URL vs copy text)
- Log validation results (empty text check in handleCopyText)
- Reference the keyboard shortcut configuration used

---

## Part 3: Keyboard Shortcuts & User Input Logging

### Overview

The extension has multiple keyboard shortcuts but doesn't log when they're detected or executed. Need comprehensive shortcut lifecycle logging.

### Current Location

- `src/content.js` - `setupKeyboardShortcuts()` and `handleKeyboardShortcut()` functions (lines ~393-448)
- `src/core/config.js` - Keyboard shortcut configurations

### What to Add

#### 3.1 Keyboard Event Detection Logging

**Where:** `handleKeyboardShortcut()` function in `src/content.js`

**Add logging for:**

- **Key event detected**:
  - Key pressed
  - Modifier keys (Ctrl, Alt, Shift)
  - Event target (element that had focus)
  - Event target tag name and type
  - Is target an input field? (isInputField check result)
  - Page URL context

- **Shortcut matching process**:
  - Which shortcuts are being checked
  - Configuration for each shortcut:
    - Key combination
    - Prerequisites (needsLink, needsElement)
  - Match attempt result for each shortcut
  - Why each shortcut didn't match (if not matched):
    - Wrong key
    - Wrong modifiers
    - Missing hovered link
    - Missing hovered element
    - In input field (ignored)

- **Shortcut execution**:
  - Which shortcut matched
  - Handler function being called
  - Arguments passed to handler
  - Execution timestamp

**Implementation approach:**

- Log ALL keydown events (with filtering for common keys)
- Log the shortcut matching table-driven process
- For each SHORTCUT_HANDLERS entry, log the match attempt
- Log why a shortcut was/wasn't triggered
- Include current hover state in logs

#### 3.2 Shortcut Handler Execution Logging

**Where:** Individual handler functions (`handleCopyURL`, `handleCopyText`, `handleCreateQuickTab`, `handleOpenInNewTab`)

**Add logging for:**

- **Handler invocation**:
  - Which handler is executing
  - Arguments received
  - Execution start timestamp

- **Handler logic**:
  - Decision points within handler
  - Validation checks (URL present? Element present? Text not empty?)
  - Any data transformations

- **Handler result**:
  - Success/failure
  - Time taken
  - What was accomplished
  - Any errors encountered

**Implementation approach:**

- Add entry/exit logging to each handler
- Log each significant step within handler
- Log all validations and their results
- Time handler execution
- Connect handler logs to originating keyboard event

#### 3.3 Input Field Detection Logging

**Where:** `isInputField()` function in `src/content.js`

**Add logging for:**

- When input field check is performed
- Element being checked
- Check results:
  - Is INPUT tag?
  - Is TEXTAREA tag?
  - Is contentEditable?
  - Has contenteditable="true" ancestor?
- Why keyboard shortcut was ignored (if in input field)

**Implementation approach:**

- Log when `isInputField()` is called
- Log element context being checked
- Log which condition matched (or none)
- Connect to keyboard event that triggered check

---

## Part 4: Quick Tab Manager Panel Operations Logging

### Overview

The Quick Tab Manager panel can be toggled and interacted with, but currently has minimal logging around these operations.

### Current Location

- `src/content.js` - `_handleQuickTabsPanelToggle()` function (lines ~624-660)
- Background: `background.js` - keyboard command listener (lines ~1240-1244)
- Quick Tabs manager panel (specific file not analyzed but referenced)

### What to Add

#### 4.1 Panel Toggle Logging

**Where:** `_handleQuickTabsPanelToggle()` function and keyboard command listener

**Add logging for:**

- **Toggle request received**:
  - Source (keyboard shortcut vs message from background)
  - Current panel state (if determinable)
  - Quick Tabs manager initialized?
  - Panel manager available?

- **Toggle execution**:
  - Panel state before toggle (visible/hidden)
  - Panel state after toggle (visible/hidden)
  - Any animations or transitions applied
  - Time taken to toggle

- **Toggle failures**:
  - Manager not initialized
  - Panel manager not available
  - DOM element not found
  - Permission errors
  - Any other failures with context

**Implementation approach:**

- Log at start of toggle request
- Log availability checks (manager, panel manager)
- Log actual toggle operation
- Log final state after toggle
- Capture and log any errors with full context

#### 4.2 Panel Interaction Logging

**Where:** Quick Tab Manager panel implementation

**Add logging for:**

- **Panel display**:
  - When panel becomes visible
  - Number of Quick Tabs displayed
  - Panel position/size
  - Container context

- **Quick Tab list updates**:
  - When Quick Tab list is refreshed
  - Number of items added/removed
  - Sort order applied
  - Filter state (if any filtering)

- **User interactions with panel**:
  - Quick Tab clicked (which one?)
  - Quick Tab closed from panel
  - Quick Tab minimized/restored from panel
  - Panel dragged/resized (if implemented)
  - Focus/unfocus events

**Implementation approach:**

- Add logging to panel visibility change handlers
- Log when Quick Tab list is rendered/updated
- Add click handlers with logging for each Quick Tab item
- Log panel lifecycle: show → interact → hide
- Track which Quick Tabs are visible in panel

---

## Part 5: Event Bus & Feature Communication Logging

### Overview

The extension uses an EventBus for inter-feature communication. Currently EventBus has a debug mode but it's not integrated with the log export system.

### Current Location

- `src/core/events.js` - `EventBus` class
- Various features emit and listen to events

### What to Add

#### 5.1 Event Emission Logging

**Where:** `EventBus.emit()` method in `src/core/events.js`

**Add logging for:**

- **Event emitted**:
  - Event name/type
  - Event data payload
  - Source feature (if identifiable)
  - Number of listeners subscribed
  - Timestamp

- **Event propagation**:
  - Which listeners are being notified
  - Order of listener execution
  - Any errors during listener execution
  - Time taken for each listener

- **Event completion**:
  - Total listeners notified
  - Total time for all listeners
  - Any listeners that threw errors
  - Event fully processed

**Implementation approach:**

- Enhance EventBus debug mode to log to console interceptor
- Log each event emission with full context
- Track listener execution with timing
- Catch and log listener errors without breaking event chain
- Provide event audit trail

#### 5.2 Event Listener Registration Logging

**Where:** `EventBus.on()` and `EventBus.off()` methods

**Add logging for:**

- **Listener registered**:
  - Event type
  - Listener function name (if available)
  - Feature/module registering listener
  - Total listeners for this event type after registration

- **Listener unregistered**:
  - Event type
  - Listener being removed
  - Reason for removal (if provided)
  - Remaining listeners for this event type

**Implementation approach:**

- Log when listeners are added/removed
- Track listener count per event type
- Log listener identity (function name if available)
- Help diagnose missing/duplicate listeners

#### 5.3 Event Type Logging

**Where:** Throughout codebase where events are used

**Add logging for these specific events:**

- **HOVER_START**: Element hovered, URL detected
- **HOVER_END**: Hover ended, duration
- **URL_COPIED**: What URL, from where
- **TEXT_COPIED**: What text, from where
- **QUICK_TAB_REQUESTED**: URL, position calculations
- **LINK_OPENED**: URL, new tab behavior
- **CONFIG_LOADED**: Configuration values loaded
- **SETTINGS_UPDATED**: Which settings changed

**Implementation approach:**

- Ensure every event emission has data payload logged
- Log event source (which feature/component emitted)
- Log event timing (when emitted relative to user action)
- Track event chains (one event triggering another)

---

## Part 6: Configuration & Settings Logging

### Overview

Extension settings can change at runtime and affect behavior. Need detailed logging of configuration state and changes.

### Current Location

- `src/core/config.js` - `ConfigManager` class
- `background.js` - storage change listener (lines ~1154-1187)

### What to Add

#### 6.1 Configuration Load Logging

**Where:** `ConfigManager.load()` method in `src/core/config.js`

**Add logging for:**

- **Load started**:
  - Loading from browser.storage.sync
  - Loading from browser.storage.local
  - Loading defaults

- **Load process**:
  - What was retrieved from storage
  - Storage keys found
  - Storage keys missing (using defaults)
  - Any migration applied

- **Load result**:
  - Final configuration object
  - Which settings are non-default
  - Any validation errors
  - Time taken to load

**Implementation approach:**

- Log at start of load operation
- Log what comes back from storage
- Log default vs loaded values
- Log final merged configuration
- Log any errors or missing values

#### 6.2 Settings Change Logging

**Where:** Storage change listener in `background.js` and config change handlers

**Add logging for:**

- **Setting changed**:
  - Which setting key
  - Old value
  - New value
  - Change source (user via popup, sync from another device, migration)

- **Change propagation**:
  - Which tabs are being notified
  - Which features are being notified
  - Any re-initialization triggered
  - Any errors during propagation

- **Setting validation**:
  - Is new value valid?
  - Any sanitization applied
  - Any constraints enforced
  - Validation result

**Implementation approach:**

- Enhance storage.onChanged listener with detailed logging
- Log BEFORE and AFTER values with comparison
- Track which settings changed together (batch changes)
- Log impact of setting changes (what features reacted)

#### 6.3 Feature Initialization Configuration Logging

**Where:** Feature initialization functions throughout codebase

**Add logging for:**

- **Config values used by feature**:
  - Which configuration keys accessed
  - Values retrieved
  - Defaults used if config missing

- **Feature configuration impact**:
  - How configuration affects feature behavior
  - Conditional features (enabled/disabled based on config)
  - Feature initialization skipped due to config

**Implementation approach:**

- Log at feature initialization which config values are read
- Log how config values influence feature setup
- Log any config-based conditional logic outcomes

---

## Part 7: State Management Logging

### Overview

The extension maintains state via `StateManager`. Need to log state changes for debugging state-related issues.

### Current Location

- `src/core/state.js` - `StateManager` class
- Various features interact with state

### What to Add

#### 7.1 State Changes Logging

**Where:** `StateManager.set()` and `StateManager.setState()` methods

**Add logging for:**

- **State update**:
  - Key being updated
  - Old value
  - New value
  - Source of change (which feature/function)
  - Timestamp

- **Batch state updates**:
  - Multiple keys updated together
  - Before snapshot
  - After snapshot
  - Which keys changed

- **State access**:
  - When `get()` is called
  - Key being accessed
  - Value returned
  - Source of access (which feature)

**Implementation approach:**

- Add logging to set/get methods
- Track call stack to identify source
- Log state deltas (what actually changed)
- Provide state audit trail

#### 7.2 Critical State Logging

**Add specific logging for these state keys:**

- `currentHoveredLink`: When set/cleared, what URL
- `currentHoveredElement`: When set/cleared, what element
- `lastMouseX` / `lastMouseY`: When updated (throttle logging)
- `quickTabZIndex`: When z-index changes, why
- Any custom state added by features

**Implementation approach:**

- Identify "hot" state keys that change frequently
- Log changes with context
- For frequently-changing state (mouse position), throttle logs
- Correlate state changes with user actions

---

## Part 8: Error Handling & Edge Cases Logging

### Overview

Need comprehensive error logging beyond the global handlers already in place.

### Current Location

- Global error handlers in `src/content.js` (lines ~32-48)
- Try-catch blocks throughout codebase

### What to Add

#### 8.1 Specific Error Context Logging

**Where:** Throughout codebase in try-catch blocks

**Add logging for:**

- **Error occurrence**:
  - Error name and message
  - Error stack trace
  - Function/feature where error occurred
  - Operation being performed when error occurred
  - Relevant state/context at time of error

- **Error recovery**:
  - How error was handled
  - Fallback executed (if any)
  - Impact on user (error shown? operation failed silently?)
  - Whether error is recoverable

- **Error patterns**:
  - Repeated errors (same error multiple times)
  - Error chains (one error causing another)
  - Cascading failures

**Implementation approach:**

- Enhance existing try-catch blocks with context logging
- Log not just error, but what was being attempted
- Log recovery actions taken
- Track error frequency for pattern detection

#### 8.2 Edge Case Logging

**Add logging for these edge cases:**

- Element not found in DOM when expected
- URL extraction returned empty string
- Clipboard operation timed out
- Message passing to non-existent tab
- Storage quota exceeded
- Quick Tab positioning calculated negative values
- Configuration missing required keys
- Feature initialization partial success
- Race conditions detected

**Implementation approach:**

- Identify edge cases in code (existing checks)
- Add detailed logging when edge case is encountered
- Log why edge case occurred and how it was handled
- Track edge case frequency

---

## Part 9: Performance & Timing Logging

### Overview

Need timing information for performance analysis and debugging slow operations.

### Current Location

- Limited timing currently implemented

### What to Add

#### 9.1 Operation Timing Logging

**Where:** Throughout codebase for key operations

**Add logging for:**

- **Extension initialization**: Total time, per-feature time
- **URL detection**: Time to find URL for each handler
- **Clipboard operations**: Time to complete copy
- **Quick Tab creation**: Time from request to display
- **Message passing**: Round-trip time for messages
- **Storage operations**: Read/write operation time
- **Event propagation**: Time for all listeners to execute

**Implementation approach:**

- Use performance.now() for high-resolution timing
- Log start/end timestamps
- Calculate and log duration
- Track slow operations (> threshold)
- Provide performance baseline data

#### 9.2 Performance Metrics Logging

**Where:** Key performance-sensitive areas

**Add logging for:**

- Hover detection latency (time from mouseover to URL detected)
- Keyboard shortcut response time (time from keydown to action executed)
- Quick Tab render time (time from data to visible iframe)
- Panel open/close animation duration
- Event bus dispatch overhead

**Implementation approach:**

- Measure and log key performance indicators
- Track performance over time (slow degradation?)
- Log performance anomalies (operation took 10x longer than usual)
- Provide data for performance optimization

---

## Part 10: Implementation Specifications

### Logging Format Standards

All new logging should follow these standards for consistency:

#### Log Message Format

```javascript
console.log('[Feature] [Action] Description', {
  contextKey1: value1,
  contextKey2: value2,
  timestamp: Date.now()
});
```

**Examples:**

```javascript
console.log('[URL Detection] [Start] Detecting URL for element', {
  domainType: 'twitter',
  elementTag: 'div',
  elementClasses: ['tweet', 'card'],
  timestamp: Date.now()
});

console.log('[URL Detection] [Success] URL found', {
  url: 'https://twitter.com/user/status/123',
  handler: 'TwitterHandler',
  duration: 5,
  timestamp: Date.now()
});

console.log('[URL Detection] [Failure] No URL found', {
  reason: 'No matching selector',
  handler: 'TwitterHandler',
  elementHTML: '<div class="post">...</div>',
  timestamp: Date.now()
});
```

#### Feature Prefixes

Use consistent prefixes for categorization:

- `[URL Detection]` - All URL finding operations
- `[Hover]` - Hover lifecycle events
- `[Clipboard]` - Clipboard API operations
- `[Keyboard]` - Keyboard shortcut detection
- `[Quick Tab Manager]` - Panel operations
- `[Event Bus]` - Event system operations
- `[Config]` - Configuration loading/changes
- `[State]` - State management operations
- `[Performance]` - Timing and performance metrics

#### Action Tags

Use consistent action tags:

- `[Start]` - Operation beginning
- `[Success]` - Operation succeeded
- `[Failure]` - Operation failed
- `[Complete]` - Operation finished (neutral)
- `[Update]` - State or value changed
- `[Emit]` - Event emitted
- `[Receive]` - Event received
- `[Execute]` - Handler/function executing

#### Context Objects

Always provide context object with relevant data:

- Include timestamp
- Include operation-specific data
- Include duration for timed operations
- Include error details for failures
- Keep object keys consistent across similar operations

### Integration with Console Interceptor

The console interceptor (`src/utils/console-interceptor.js`) already captures all console.log/error/warn calls. New logging will automatically be captured for export.

**No changes needed to console interceptor**. Just ensure all new logs use console.log/error/warn/info methods.

### Log Verbosity Control

Consider adding log level control to configuration:

- **DEBUG**: Everything (current proposal)
- **INFO**: Important operations only
- **WARN**: Warnings and errors only
- **ERROR**: Errors only

This allows users to reduce log noise if needed while still having debug capability.

### Testing Logging

After implementation, verify:

1. All new logs appear in extension export
2. Log format is consistent
3. Context objects contain useful data
4. No performance impact from logging
5. No circular reference errors in logged objects
6. Timestamps are accurate
7. Logs are searchable/filterable

---

## Part 11: Priority Implementation Order

Implement logging enhancements in this priority order for maximum diagnostic value:

### Priority 1: User Action Logging (Immediate Impact)

1. Keyboard shortcut detection and execution
2. Clipboard operations with failure reasons
3. Hover lifecycle with element context
4. URL detection process with success/failure reasons

**Why first:** These directly trace user actions and are most frequently involved in bug reports.

### Priority 2: Feature State Logging (High Diagnostic Value)

1. Quick Tab Manager panel operations
2. State management changes
3. Event bus emissions and handlers
4. Configuration load and changes

**Why second:** Critical for understanding feature state during issues.

### Priority 3: System Operations Logging (Complete Picture)

1. Performance and timing metrics
2. Error context and edge cases
3. Platform-specific handler details
4. Background service worker operations

**Why third:** Provides complete diagnostic picture and performance insights.

---

## Part 12: Specific Code Locations for Implementation

### File-by-File Implementation Guide

#### `src/content.js` (Primary content script)

**Lines to enhance:**

- Lines 366-391: `setupHoverDetection()` - Add hover lifecycle logging
- Lines 393-448: Keyboard shortcut handling - Add shortcut detection logging
- Lines 449-477: `handleCopyURL()` - Add copy URL action context
- Lines 479-508: `handleCopyText()` - Add copy text action context
- Lines 510-576: `handleCreateQuickTab()` - Add Quick Tab creation context
- Lines 624-660: `_handleQuickTabsPanelToggle()` - Add panel toggle logging

**Add new logging wrappers:**

- Hover event wrappers with element context
- Keyboard event wrappers with shortcut matching details
- Copy action wrappers with clipboard API details

#### `src/core/browser-api.js` (Browser API wrappers)

**Enhance:**

- `copyToClipboard()` function - Add detailed clipboard API logging
- `sendMessageToBackground()` function - Add message passing logging with timing

#### `src/core/events.js` (Event bus)

**Enhance:**

- `EventBus.emit()` - Add event emission logging
- `EventBus.on()` / `EventBus.off()` - Add listener registration logging
- Integrate debug mode with console interceptor

#### `src/core/config.js` (Configuration management)

**Enhance:**

- `ConfigManager.load()` - Add configuration load logging
- Add logging for default vs loaded value comparisons

#### `src/core/state.js` (State management)

**Enhance:**

- `StateManager.set()` / `setState()` - Add state change logging
- `StateManager.get()` - Add state access logging (optional, may be too verbose)

#### `src/features/url-handlers/index.js` (URL detection)

**Enhance:**

- `URLHandlerRegistry.findURL()` - Add detection process logging
- Add handler matching attempt logging

#### `src/features/url-handlers/*.js` (Platform handlers)

**Enhance each handler:**

- Add entry/exit logging
- Add selector matching result logging
- Add URL extraction success/failure logging

#### `background.js` (Background service worker)

**Already has good logging, enhance:**

- Lines 680-729: WebRequest listeners - Add more detailed outcome logging
- Lines 1154-1187: Storage change listener - Add setting change details
- Message handlers - Add execution timing

---

## Part 13: Testing & Validation Checklist

After implementing enhanced logging, validate:

### Functional Testing

- [ ] All user actions generate corresponding logs
- [ ] Hover detection logs element and URL details
- [ ] Keyboard shortcuts log key combinations and execution
- [ ] Clipboard operations log API used and results
- [ ] Quick Tab operations log all state changes
- [ ] Settings changes log old and new values
- [ ] Event emissions log event type and data payload

### Export Testing

- [ ] All new logs appear in exported log file
- [ ] Log timestamps are accurate and sequential
- [ ] Log format is consistent across all features
- [ ] Context objects are complete and useful
- [ ] No circular reference errors in logs
- [ ] Log file size is reasonable (no excessive logging)

### Performance Testing

- [ ] Logging doesn't impact user experience
- [ ] No performance degradation from verbose logging
- [ ] Memory usage remains stable
- [ ] Console interceptor buffer doesn't overflow
- [ ] No dropped logs during high activity

### Debugging Validation

- [ ] Can trace complete user action from log sequence
- [ ] Can identify failure points from log context
- [ ] Can reproduce issues using log information
- [ ] Can distinguish between similar operations by context
- [ ] Can filter logs by feature/action for analysis

---

## Conclusion

This guide provides comprehensive specifications for implementing enhanced logging throughout the Copy-URL-on-Hover extension. The focus is on capturing EVERY significant user action, extension operation, and state change to enable complete diagnostic capability.

**Key Principles:**

1. **Log user actions explicitly** - Don't infer from side effects
2. **Log decision points** - Capture why code took a specific path
3. **Log failures with context** - Include everything needed to reproduce
4. **Log timing information** - Performance data aids debugging
5. **Use consistent format** - Makes logs searchable and parseable
6. **Include relevant context** - Element details, URLs, state values
7. **Integrate with existing system** - Console interceptor captures all

**Implementation Notes:**

- NO EXACT CODE CHANGES provided - this is specification only
- Focus on WHAT to log and WHERE to add logging
- Provide enough detail for GitHub Copilot Agent to implement
- Maintain existing logging framework and console interceptor
- Ensure all logs are captured by existing export mechanism

**Expected Outcome:**
After implementation, the extension's log export should provide a complete audit trail of all extension operations, enabling developers to diagnose any user-reported issue by examining the exported logs.
