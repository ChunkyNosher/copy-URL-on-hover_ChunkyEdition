# Console Log Export - Feature Documentation

## Overview

The "Export Console Logs" debug feature captures console output from the extension for bug reporting and diagnostics.

## What Gets Captured

### ✅ Successfully Captured

- All `console.log()` calls from extension code
- All `console.error()` calls from extension code
- All `console.warn()` calls from extension code
- All `console.info()` calls from extension code
- All `console.debug()` calls from extension code
- Uncaught exceptions in content scripts
- Unhandled promise rejections
- **Complete stack traces from JavaScript errors**
- **Error causality chains (error.cause)**
- **File/line number information from errors**
- Timestamps for all log entries
- Execution context (content-script, background, popup)

### v1.6.0.7 Enhancements

- **Enhanced Error Serialization**: Error objects are now serialized with ALL properties including non-enumerable ones like `stack`, `fileName`, `lineNumber`, `columnNumber`
- **Global Error Capture**: Uncaught exceptions and unhandled promise rejections are automatically captured
- **Comprehensive Logging**: Added detailed logging for:
  - Hover lifecycle (start/end with duration)
  - URL detection process (all methods attempted)
  - Keyboard shortcut detection and execution
  - Clipboard operations (API selection, fallback attempts)
  - Performance timing for all major operations

## Known Limitations

The export feature **cannot** capture:

### 1. Browser-Generated Errors

Errors created by Firefox internally are not intercepted:

- `browser.runtime.lastError` warnings
- "Could not establish connection" messages when content scripts aren't loaded
- Browser API parameter validation errors

**Why:** These errors are logged by Firefox's internal C++/Rust code directly to the Browser Console and cannot be intercepted by JavaScript.

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
   - Captures extension JavaScript output with enhanced error details

2. **Copy Browser Console Output** (Ctrl+Shift+J → Right-click → Copy All Messages)
   - Captures browser-generated errors

3. **Take Screenshots** of any error popups or UI issues

4. **Describe Steps to Reproduce** the issue

5. **Attach All Materials** when reporting the bug

## Technical Details

### How It Works

The console log export works by:

1. **Console Method Overriding**
   - Overrides JavaScript's global `console.*` methods
   - Intercepts all console calls before they execute
   - Stores messages in a circular buffer (max 5000 entries)

2. **Enhanced Error Serialization**
   - Special handling for Error objects
   - Preserves non-enumerable properties (stack, fileName, lineNumber, columnNumber)
   - Captures error causality chains (error.cause)
   - Serializes nested error objects recursively

3. **Global Error Event Listeners**
   - `window.addEventListener('error')` for uncaught exceptions
   - `window.addEventListener('unhandledrejection')` for unhandled promises
   - Captures errors that don't go through console methods

4. **Output Formatting**
   - Formats as timestamped plain text
   - Includes execution context for each log entry
   - Preserves complete stack traces in output

### Enhanced Logging in v1.6.0.7

The extension now logs:

#### Hover Detection

- Element entered/exited with duration
- Element details (tag, classes, id, text preview)
- URL detection attempts and results
- Detection timing

#### URL Detection Process

- Detection start with element context
- Direct anchor link checks
- Parent element traversal (up to 20 levels)
- Site-specific handler attempts
- Generic handler fallback
- Detection duration and results

#### Keyboard Shortcuts

- Key press detection with modifiers
- Input field detection
- Current hover state
- Shortcut matching attempts
- Handler execution and timing

#### Clipboard Operations

- Copy attempt start with content preview
- API selection (clipboard API vs execCommand)
- Copy operation duration
- Fallback attempts and results
- Success/failure with detailed error info

#### Performance Metrics

- Operation timing for all major actions
- Hover duration tracking
- URL detection speed
- Handler execution time
- Clipboard operation speed

### Why Some Errors Aren't Captured

Browser APIs like `browser.tabs.sendMessage()` log errors **directly to Browser Console** without going through JavaScript's `console` object. These errors are generated by Firefox's internal code and cannot be intercepted by overriding `console.*` methods.

**Example:**

```javascript
// This error is logged by Firefox internals, not JavaScript
browser.tabs.sendMessage(invalidTabId, {});
// Browser Console: "Could not establish connection. Receiving end does not exist."
// Exported logs: ❌ Not captured (browser-generated error)
```

### Workarounds

If you need to capture browser API errors in the export:

```javascript
try {
  await browser.tabs.sendMessage(tabId, message);
} catch (error) {
  console.error('[Browser API Error]', error); // ✅ Now captured with full stack trace
}
```

## Buffer Management

- **Maximum buffer size**: 5000 log entries
- **Overflow behavior**: Oldest entries are automatically removed when buffer is full
- **Memory usage**: Approximately 50-100 bytes per log entry (depending on message size)
- **Clear buffer**: Available via Debug tab in extension popup

## Buffer Statistics

The debug interface shows:

- Total logs captured
- Buffer utilization percentage
- Oldest and newest log timestamps
- Context breakdown (content/background/popup)

## References

### Mozilla Documentation

1. [runtime.lastError - MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/lastError) - Understanding browser-generated errors
2. [Error.prototype.stack - MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/stack) - Non-enumerable error properties
3. [Browser Console - MDN](https://firefox-source-docs.mozilla.org/devtools-user/browser_console/index.html) - Multiple console contexts
4. [GlobalEventHandlers.onerror - MDN](https://developer.mozilla.org/en-US/docs/Web/API/GlobalEventHandlers/onerror) - Global error event handling

---

## Version History

### v1.6.0.7 (Current)

- ✅ Enhanced error serialization preserves stack traces
- ✅ Global error/promise rejection handlers
- ✅ Comprehensive logging for all user actions
- ✅ Performance timing metrics
- ✅ Detailed URL detection logging
- ✅ Enhanced clipboard operation logging
- ✅ Keyboard shortcut lifecycle logging

### v1.6.0.3 (Previous)

- Basic console interception
- Simple error logging
- Buffer management

---

## Conclusion

The console log export feature in v1.6.0.7 provides **comprehensive diagnostic capability** for extension debugging. The enhanced error serialization ensures that stack traces and error details are fully preserved, while the extensive logging coverage captures every significant user action and system operation.

**What's captured**: Everything the extension does in JavaScript  
**What's not captured**: Browser-internal operations and errors  
**Workaround**: Also export Browser Console output for complete diagnostics

These enhancements make the exported logs significantly more useful for debugging user-reported issues.
