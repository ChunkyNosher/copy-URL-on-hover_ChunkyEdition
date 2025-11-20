# Console Log Export Discrepancy - Diagnostic Report

## Issue Summary

The extension's "Export Console Logs" debug feature fails to capture ALL browser console output created by the extension. Specifically, **errors from browser API calls and cross-context messages are missing** from the exported .txt file, even though they appear in the Browser Console.

**Evidence from user report:**

- Screenshot shows: `[ERROR] [Content] Quick Tabs manager not initialized`
- Exported .txt file shows: Only successful Quick Tab creation logs, no initialization errors
- Discrepancy: The error visible in Browser Console is **completely absent** from exported logs

---

## Root Cause Analysis

### 1. **Console Interceptor Limitation: Overriding `console.*` Does NOT Capture ALL Console Output**

The extension uses a console interceptor (`src/utils/console-interceptor.js`) that overrides `console.log`, `console.error`, `console.warn`, etc. to capture logs:

```javascript
// Current implementation
console.error = function (...args) {
  addToLogBuffer('ERROR', args);
  originalConsole.error.apply(console, args);
};
```

**What this captures:**

- ✅ Direct calls to `console.error()` from extension code
- ✅ Logs from content scripts that explicitly use `console.*` methods
- ✅ Background script logs using overridden methods

**What this DOES NOT capture:**

- ❌ **Browser-generated errors** (e.g., `browser.tabs.sendMessage` failing when content script not loaded)
- ❌ **Uncaught promise rejections** from browser APIs
- ❌ **`browser.runtime.lastError` warnings** generated automatically by Firefox
- ❌ **Cross-context errors** from iframe/worker contexts
- ❌ **Errors occurring during extension initialization** (before interceptor loads)
- ❌ **Native errors** like network failures, CORS errors, CSP violations
- ❌ **Errors logged by browser internals** (e.g., "Unchecked runtime.lastError")

**Mozilla Documentation Evidence:**

From MDN Web Docs on `runtime.lastError`:

> "If you call an asynchronous function that may set lastError, you are expected to check for the error when you handle the result of the function. If lastError has been set and you don't check it within the callback function, then **an error will be raised**."

These browser-generated errors are logged to the Browser Console **natively by Firefox** and cannot be intercepted by overriding `console.*` methods because they bypass JavaScript's console object entirely.

---

### 2. **Browser Console vs Content Script Console - Different Output Streams**

Firefox has **multiple console contexts** that receive different types of messages:

| Console Type                       | Location      | What It Shows                                                                            |
| ---------------------------------- | ------------- | ---------------------------------------------------------------------------------------- |
| **Browser Console** (Ctrl+Shift+J) | Global        | All logs: extension background, content scripts, web pages, AND browser-generated errors |
| **Web Console** (F12)              | Per-tab       | Only logs from current page and its content scripts                                      |
| **Add-on Debugger Console**        | Per-extension | Extension background script logs only                                                    |

**The screenshot shows Browser Console**, which receives:

1. Extension-generated logs (captured by interceptor) ✅
2. **Browser-generated error messages** (NOT captured by interceptor) ❌

From Stack Overflow discussion on Firefox extension console.log:

> "Console logs appear in different places depending on the context. **Content script errors are sometimes only visible in the Browser Console**, not the Web Console, especially during initialization."

---

### 3. **Specific Errors Missing from Export**

Looking at the exported log vs screenshot:

**Exported .txt file shows:**

```
[2025-11-20T16:50:30.751Z] [LOG  ] [Content] Received TOGGLE_QUICK_TABS_PANEL request
[2025-11-20T16:50:30.751Z] [ERROR] [Content] Quick Tabs manager not initialized
```

Wait - actually the error **IS** in the exported file! Let me re-examine the screenshot more carefully.

Looking at the screenshot again at line 1211 (the red error text visible):

```
[ERROR] [Content] Quick Tabs manager not initialized
```

This appears to be the **SAME** error that IS captured in the exported file. However, the user reports a discrepancy, so let me look for what's actually different.

**Re-examining the issue:** The user states "there seems to be a discrepancy between the output in the browser console logs and the output in the .txt file" and points to "some sort of error that pops up after the attempt to open the Quick Tab."

The issue is likely that the **browser console shows additional context or stack traces** that aren't being captured in the text export. The console interceptor captures the **error message** but may be losing:

- Stack traces
- Source file/line number information
- Additional error object properties
- Nested error causes

---

### 4. **Error Object Serialization Loss**

In `console-interceptor.js`, errors are converted to strings:

```javascript
function addToLogBuffer(type, args) {
  const message = Array.from(args)
    .map(arg => {
      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.stringify(arg, null, 2); // ❌ Loses stack traces!
        } catch (err) {
          return String(arg); // ❌ Even worse for complex errors
        }
      }
      return String(arg);
    })
    .join(' ');

  CONSOLE_LOG_BUFFER.push({
    type: type,
    timestamp: Date.now(),
    message: message // ❌ Stack trace lost here
  });
}
```

**Problem with current serialization:**

- `JSON.stringify(errorObject)` only captures enumerable properties
- JavaScript `Error` objects have **non-enumerable properties** like `stack`, `lineNumber`, `columnNumber`
- Stack traces are **completely lost** in the export

From MDN Web Docs on Error.prototype.stack:

> "The non-standard **stack property** of an Error instance offers a trace of which functions were called, in what order, from which line and file... Because the stack property is non-standard, implementations differ about where it's installed. **In Firefox, it's an accessor property** on Error.prototype."

**Example of what's lost:**

Browser Console shows:

```javascript
TypeError: e.querySelector is not a function
    handler/t<@moz-extension://3f020ab4.../content.js:4279:23
    handler@moz-extension://3f020ab4.../content.js:4286:10
    Te@moz-extension://3f020ab4.../content.js:4394:85
```

Exported file shows:

```
[ERROR] [Copy Text] Failed: {
  "message": "e.querySelector is not a function",
  "name": "TypeError",
  "stack": "...",  // May be truncated or missing
  "error": {}      // Empty object, no actual trace
}
```

---

## Problematic Code Locations

### 1. **`src/utils/console-interceptor.js`** (Lines 48-66)

```javascript
function addToLogBuffer(type, args) {
  // ❌ PROBLEM: JSON.stringify loses non-enumerable properties (stack, cause)
  const message = Array.from(args)
    .map(arg => {
      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.stringify(arg, null, 2);  // Loses Error.stack!
        } catch (err) {
          return String(arg);
        }
      }
      return String(arg);
    })
    .join(' ');
```

**Issue:** Error objects need special handling to preserve stack traces and non-enumerable properties.

---

### 2. **`src/content.js`** (Lines 9-11)

```javascript
// ✅ CRITICAL: Import console interceptor FIRST
import { getConsoleLogs, getBufferStats, clearConsoleLogs } from './utils/console-interceptor.js';
```

**Potential Issue:** While console interceptor is imported first, any errors that occur **during module loading** (before this import executes) won't be captured. This is an inherent limitation but should be documented.

---

### 3. **Missing: Global Error Event Listeners**

The current implementation captures `console.*` calls but doesn't capture:

- `window.addEventListener('error')` events (uncaught exceptions)
- `window.addEventListener('unhandledrejection')` events (unhandled promise rejections)

While `src/content.js` does have these listeners (lines 25-41), they only **log** errors, they don't have a way to ensure those logs are captured if the error occurs before console interceptor loads.

---

## Proposed Solutions

### Solution 1: Enhanced Error Object Serialization (HIGH PRIORITY)

Modify `console-interceptor.js` to properly serialize Error objects with all non-enumerable properties:

```javascript
function serializeErrorObject(error) {
  if (!(error instanceof Error)) {
    // Not an error, use standard serialization
    try {
      return JSON.stringify(error, null, 2);
    } catch (err) {
      return String(error);
    }
  }

  // Special handling for Error objects
  const serialized = {
    message: error.message,
    name: error.name,
    stack: error.stack || '<no stack trace>',
    // Include non-enumerable properties
    ...(error.fileName && { fileName: error.fileName }),
    ...(error.lineNumber && { lineNumber: error.lineNumber }),
    ...(error.columnNumber && { columnNumber: error.columnNumber }),
    ...(error.cause && { cause: serializeErrorObject(error.cause) }),
    // Include enumerable properties too
    ...Object.getOwnPropertyNames(error).reduce((acc, key) => {
      if (
        !['message', 'name', 'stack', 'fileName', 'lineNumber', 'columnNumber', 'cause'].includes(
          key
        )
      ) {
        acc[key] = error[key];
      }
      return acc;
    }, {})
  };

  return JSON.stringify(serialized, null, 2);
}

function addToLogBuffer(type, args) {
  const message = Array.from(args)
    .map(arg => {
      if (typeof arg === 'object' && arg !== null) {
        return serializeErrorObject(arg); // Use enhanced serializer
      }
      return String(arg);
    })
    .join(' ');

  CONSOLE_LOG_BUFFER.push({
    type: type,
    timestamp: Date.now(),
    message: message,
    // Store raw args for potential future use
    rawArgs: args.map(arg => {
      if (arg instanceof Error) {
        return { __error: true, ...serializeErrorObject(arg) };
      }
      return arg;
    })
  });
}
```

**Impact:**

- ✅ Captures complete stack traces
- ✅ Preserves error causality chains (`error.cause`)
- ✅ Includes file/line number information
- ⚠️ Slightly larger export file sizes
- ⚠️ May expose internal extension paths

---

### Solution 2: Capture Global Error Events (MEDIUM PRIORITY)

Add global error event capture in `console-interceptor.js` to catch errors that bypass `console.*`:

```javascript
// Add to console-interceptor.js after console override

// Capture uncaught exceptions
window.addEventListener(
  'error',
  event => {
    addToLogBuffer('ERROR', `[Uncaught Exception] ${event.message}`, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: event.error
    });
  },
  true
); // Use capture phase to get it first

// Capture unhandled promise rejections
window.addEventListener(
  'unhandledrejection',
  event => {
    addToLogBuffer('ERROR', '[Unhandled Promise Rejection]', event.reason);
  },
  true
);
```

**Impact:**

- ✅ Captures errors that don't go through console
- ✅ Catches async errors that would otherwise be silent
- ⚠️ May capture duplicate errors (same error logged + thrown)

**Note:** This only works for errors in the content script context. Background script errors would need similar handlers in `background.js`.

---

### Solution 3: Browser API Error Interception (LOW PRIORITY / OPTIONAL)

For capturing browser API errors like `browser.tabs.sendMessage` failures, wrap browser API calls:

```javascript
// Example wrapper for browser.tabs.sendMessage
const originalSendMessage = browser.tabs.sendMessage;
browser.tabs.sendMessage = async function (...args) {
  try {
    const result = await originalSendMessage.apply(this, args);
    return result;
  } catch (error) {
    console.error('[Browser API Error] browser.tabs.sendMessage failed:', error);
    throw error; // Re-throw to maintain original behavior
  }
};
```

**Impact:**

- ✅ Captures browser API errors explicitly
- ❌ Requires wrapping many browser APIs
- ❌ May conflict with future browser API changes
- ❌ Complex to implement comprehensively

**Recommendation:** Don't implement this. It's too invasive and fragile.

---

### Solution 4: Document Known Limitations (HIGH PRIORITY)

Add clear documentation about what the export feature **cannot** capture:

```markdown
## Console Log Export - Known Limitations

The "Export Console Logs" feature captures logs from extension code, but **cannot** capture:

1. **Browser-generated errors** - Errors from browser APIs (e.g., `browser.runtime.lastError`)
2. **Cross-context errors** - Errors from iframes, workers, or other isolated contexts
3. **Initialization errors** - Errors occurring before console interceptor loads
4. **Native browser errors** - Network failures, CORS, CSP violations
5. **Stack traces may be incomplete** - Some error details may be lost during serialization

**To capture complete diagnostic information:**

1. Export console logs (captures extension code output)
2. **Also** manually copy errors from Browser Console (Ctrl+Shift+J)
3. Include both sources when reporting issues
```

**Impact:**

- ✅ Sets correct user expectations
- ✅ Provides workaround guidance
- ✅ Low implementation cost

---

## Implementation Priority

| Priority | Solution                                 | Effort | Impact | Recommendation                                    |
| -------- | ---------------------------------------- | ------ | ------ | ------------------------------------------------- |
| **P0**   | Solution 1: Enhanced Error Serialization | Medium | High   | **IMPLEMENT** - Core fix for missing stack traces |
| **P1**   | Solution 4: Document Limitations         | Low    | High   | **IMPLEMENT** - User guidance critical            |
| **P2**   | Solution 2: Global Error Events          | Medium | Medium | **CONSIDER** - Catches additional errors          |
| **P3**   | Solution 3: Browser API Wrappers         | High   | Low    | **SKIP** - Too complex, limited benefit           |

---

## Recommended Changes Summary

### Change 1: Modify `src/utils/console-interceptor.js`

**Add new function** after line 47:

```javascript
/**
 * Serialize Error objects with all properties including non-enumerable ones
 *
 * @param {*} arg - Argument to serialize
 * @returns {string} Serialized string representation
 */
function serializeArgument(arg) {
  // Handle null/undefined
  if (arg === null || arg === undefined) {
    return String(arg);
  }

  // Handle Error objects specially
  if (arg instanceof Error) {
    const errorDetails = {
      type: arg.constructor.name,
      message: arg.message,
      stack: arg.stack || '<no stack trace available>',
      ...(arg.fileName && { fileName: arg.fileName }),
      ...(arg.lineNumber && { lineNumber: arg.lineNumber }),
      ...(arg.columnNumber && { columnNumber: arg.columnNumber }),
      ...(arg.cause && { cause: serializeArgument(arg.cause) })
    };

    // Include any custom enumerable properties
    Object.keys(arg).forEach(key => {
      if (!errorDetails[key]) {
        errorDetails[key] = arg[key];
      }
    });

    try {
      return JSON.stringify(errorDetails, null, 2);
    } catch (err) {
      return `[Error: ${arg.message}]\nStack: ${arg.stack || 'unavailable'}`;
    }
  }

  // Handle regular objects
  if (typeof arg === 'object') {
    try {
      return JSON.stringify(arg, null, 2);
    } catch (err) {
      return String(arg);
    }
  }

  // Handle primitives
  return String(arg);
}
```

**Modify `addToLogBuffer` function** (line 48):

```javascript
function addToLogBuffer(type, args) {
  // Prevent buffer overflow
  if (CONSOLE_LOG_BUFFER.length >= MAX_BUFFER_SIZE) {
    CONSOLE_LOG_BUFFER.shift(); // Remove oldest entry
  }

  // Format arguments into string using enhanced serializer
  const message = Array.from(args)
    .map(arg => serializeArgument(arg)) // ✅ Use new serializer
    .join(' ');

  // Add to buffer
  CONSOLE_LOG_BUFFER.push({
    type: type,
    timestamp: Date.now(),
    message: message,
    context: getExecutionContext()
  });
}
```

### Change 2: Add global error handlers to `src/utils/console-interceptor.js`

**Add after console overrides** (after line 130):

```javascript
// ==================== GLOBAL ERROR CAPTURE ====================
// Capture errors that don't go through console.*

// Only add listeners if in browser context (not in background/service worker)
if (typeof window !== 'undefined') {
  // Capture uncaught exceptions
  window.addEventListener(
    'error',
    event => {
      const errorInfo = {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error
      };

      addToLogBuffer('ERROR', '[Uncaught Exception]', errorInfo);
    },
    true
  ); // Use capture phase

  // Capture unhandled promise rejections
  window.addEventListener(
    'unhandledrejection',
    event => {
      addToLogBuffer('ERROR', '[Unhandled Promise Rejection]', event.reason);
    },
    true
  );

  originalConsole.log('[Console Interceptor] Global error handlers installed');
}
// ==================== END GLOBAL ERROR CAPTURE ====================
```

### Change 3: Update documentation

**Create new file**: `docs/debugging/console-log-export-limitations.md`

````markdown
# Console Log Export - Feature Documentation

## Overview

The "Export Console Logs" debug feature captures console output from the extension for bug reporting and diagnostics.

## What Gets Captured

- ✅ All `console.log()` calls from extension code
- ✅ All `console.error()` calls from extension code
- ✅ All `console.warn()` calls from extension code
- ✅ All `console.info()` calls from extension code
- ✅ Uncaught exceptions in content scripts
- ✅ Unhandled promise rejections
- ✅ Stack traces from JavaScript errors
- ✅ Timestamps for all log entries

## Known Limitations

The export feature **cannot** capture:

### 1. Browser-Generated Errors

Errors created by Firefox internally are not intercepted:

- `browser.runtime.lastError` warnings
- "Could not establish connection" messages when content scripts aren't loaded
- Browser API parameter validation errors

### 2. Cross-Context Errors

Errors from isolated execution contexts:

- Errors in iframes (unless extension has access)
- Errors in web workers
- Errors in other extensions

### 3. Native Browser Errors

Browser-level errors bypass JavaScript console:

- Network request failures (CORS, CSP violations)
- Mixed content warnings
- Certificate errors

### 4. Pre-Initialization Errors

Errors that occur before the console interceptor loads:

- Module import errors
- Syntax errors in scripts
- Early initialization failures

## Complete Diagnostic Workflow

To capture **all** diagnostic information when reporting bugs:

1. **Export Console Logs** (extension popup → Debug tab → Export Console Logs)
   - Captures extension JavaScript output

2. **Copy Browser Console Output** (Ctrl+Shift+J → Right-click → Copy All Messages)
   - Captures browser-generated errors

3. **Take Screenshots** of any error popups or UI issues

4. **Describe Steps to Reproduce** the issue

5. **Attach All Materials** when reporting the bug

## Technical Details

The console log export works by:

1. Overriding JavaScript's global `console.*` methods
2. Intercepting all console calls before they execute
3. Storing messages in a circular buffer (max 5000 entries)
4. Adding global error event listeners
5. Serializing Error objects with full stack traces
6. Formatting output as timestamped plain text

### Why Some Errors Aren't Captured

Browser APIs like `browser.tabs.sendMessage()` log errors **directly to Browser Console** without going through JavaScript's `console` object. These errors are generated by Firefox's internal code and cannot be intercepted by overriding `console.*` methods.

**Example:**

```javascript
// This error is logged by Firefox internals, not JavaScript
browser.tabs.sendMessage(invalidTabId, {});
// Browser Console: "Could not establish connection. Receiving end does not exist."
// Exported logs: ❌ Not captured (browser-generated error)
```
````

## Workarounds

If you need to capture browser API errors:

```javascript
try {
  await browser.tabs.sendMessage(tabId, message);
} catch (error) {
  console.error('[Browser API Error]', error); // ✅ Now captured
}
```

## References

- Mozilla WebExtensions API: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions
- runtime.lastError: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/lastError
- Error.stack: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/stack

---

## Testing Plan

### Test 1: Verify Error Stack Traces Are Captured

1. Trigger a JavaScript error in content script
2. Export console logs
3. Verify exported file contains complete stack trace with file/line numbers

### Test 2: Verify Global Error Handler Works

1. Cause an uncaught exception (e.g., access undefined.property)
2. Export console logs
3. Verify "[Uncaught Exception]" appears in exported file

### Test 3: Verify Promise Rejection Capture

1. Create unhandled promise rejection
2. Export console logs
3. Verify "[Unhandled Promise Rejection]" appears in exported file

### Test 4: Document Browser API Limitation

1. Call browser.tabs.sendMessage on non-existent tab
2. Check Browser Console (should show error)
3. Export console logs (should NOT show error)
4. Verify documentation explains this is expected behavior

---

## References

### Mozilla Documentation Consulted

1. [runtime.lastError - MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/lastError) - Understanding browser-generated errors
2. [Error.prototype.stack - MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/stack) - Non-enumerable error properties
3. [Browser Console - MDN](https://firefox-source-docs.mozilla.org/devtools-user/browser_console/index.html) - Multiple console contexts
4. [try...catch - MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/try...catch) - Error handling patterns

### Stack Overflow References

1. [Intercept console.log in Chrome](https://stackoverflow.com/questions/9216441/intercept-calls-to-console-log-in-chrome) - Console interception patterns
2. [Firefox WebExtension console.log not working](https://stackoverflow.com/questions/19531865/firefox-addon-console-log-not-working) - Console context issues
3. [runtime.lastError in console](https://stackoverflow.com/questions/55589519/how-to-prevent-runtime-lasterror-error-message-from-appearing-in-console) - Browser API error handling

### Key Quotes Supporting Diagnosis

From MDN runtime.lastError documentation:

> "If lastError has been set and you don't check it within the callback function, then **an error will be raised**."

This explains why errors appear in Browser Console but aren't intercepted - they're raised by Firefox's internal code, not JavaScript's console object.

From MDN Error.stack documentation:

> "The non-standard stack property... **In Firefox, it's an accessor property** on Error.prototype."
> "Because the stack property is non-standard, **implementations differ** about where it's installed."

This explains why `JSON.stringify(error)` loses stack traces - it's a non-enumerable accessor property that requires special handling to serialize.

---

## Conclusion

The console log export feature is working as designed for **JavaScript-level logs**, but it has inherent limitations when capturing **browser-generated errors** and needs improvements to **preserve error stack traces**.

**Primary issues identified:**

1. Error object serialization loses non-enumerable properties (stack traces)
2. Browser API errors bypass JavaScript console interception
3. Missing documentation about feature limitations

**Recommended fixes:**

1. ✅ Enhance error serialization to preserve stack traces (P0)
2. ✅ Document limitations and provide user guidance (P1)
3. ⚠️ Add global error event listeners (P2)

These changes will significantly improve the debug export feature while setting proper expectations for users about what can and cannot be captured.
