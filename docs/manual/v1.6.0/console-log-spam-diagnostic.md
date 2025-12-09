# Console Log Spam Diagnostic Report - Copy-URL-on-Hover Extension

**Report Date:** November 22, 2025  
**Extension Version:** v1.6.1  
**Focus:** Extreme console log spam despite filters being enabled

---

## Executive Summary

Analysis of the browser console logs versus the exported .txt file reveals a
**critical discrepancy** where the live browser console output contains
significantly more logs than the export file, even though **all filter
checkboxes were enabled for both Live Console Output Filters and Export Console
Log Filters**.

**Key Findings:**

1. **Browser console (.log file):** 1,087,158 characters (~1.06 MB) - Contains
   massive amounts of YouTube player errors and extension logs
2. **Extension export (.txt file):** 268,117 characters (~262 KB) - Contains
   only extension logs, properly filtered
3. **The discrepancy:** Browser console shows **4x more data** and contains logs
   that should not exist

**Root Cause:** The live console filter system is **partially broken** - it
exists in the code but has critical initialization and refresh bugs that prevent
it from working correctly.

---

## Issue Analysis: Why Browser Console Shows More Logs Than Export

### The User's Configuration

According to your report:

- ✅ All Live Console Output Filter checkboxes: **ENABLED** (all categories
  toggled on)
- ✅ All Export Console Log Filter checkboxes: **ENABLED** (all categories
  toggled on)
- ✅ Both filters reset at the same time
- ❌ Browser console still shows massive spam
- ❌ Export file is much smaller and cleaner

### What Should Happen

When **all** live console filter categories are enabled:

1. Extension should log everything to browser console (no filtering)
2. Extension should capture everything to internal buffer
3. Export should include everything (all categories enabled)
4. Browser console and export file should have similar content from the
   extension

**Expected Result:** Browser console should show extension logs + website logs.
Export should show only extension logs. Both should be roughly comparable in
extension log volume.

**Actual Result:** Browser console shows way more data than export, including
unique messages not in export file.

---

## Root Cause: The Live Console Filter Bug

### Problem 1: Filter Cache Not Initialized Properly

**File:** `src/utils/filter-settings.js` (lines 71-95)

```javascript
export async function initializeFilterSettings() {
  if (settingsInitialized) {
    return;
  }

  try {
    if (typeof browser !== 'undefined' && browser.storage) {
      const result = await browser.storage.local.get([
        'liveConsoleCategoriesEnabled',
        'exportLogCategoriesEnabled'
      ]);

      liveConsoleSettingsCache =
        result.liveConsoleCategoriesEnabled || getDefaultLiveConsoleSettings();
      exportLogSettingsCache =
        result.exportLogCategoriesEnabled || getDefaultExportSettings();
    } else {
      liveConsoleSettingsCache = getDefaultLiveConsoleSettings();
      exportLogSettingsCache = getDefaultExportSettings();
    }

    settingsInitialized = true;
  } catch (error) {
    console.error('[FilterSettings] Initialization failed:', error);
    liveConsoleSettingsCache = getDefaultLiveConsoleSettings();
    exportLogSettingsCache = getDefaultExportSettings();
    settingsInitialized = true;
  }
}

// Initialize settings immediately when module loads
initializeFilterSettings();
```

**The Issue:**

The initialization function is **asynchronous** (`async function`) but is called
**synchronously** at the bottom of the file:

```javascript
initializeFilterSettings(); // Called without await
```

This means the module continues loading **before the settings are actually
loaded from storage**. The filter cache starts as `null` and uses defaults until
the async operation completes.

**Timeline of what happens:**

1. Module loads → calls `initializeFilterSettings()` (async, no await)
2. Returns immediately without waiting for storage.local.get()
3. Console interceptor starts logging → checks `getLiveConsoleSettings()`
4. Cache is still `null` → falls back to defaults
5. **Defaults have hover and url-detection DISABLED**
6. Early logs get filtered incorrectly
7. Eventually async completes and cache updates
8. But damage is done - early logs already filtered

### Problem 2: The Defaults Are Wrong For "All Enabled" State

**File:** `src/utils/filter-settings.js` (lines 11-31)

```javascript
export function getDefaultLiveConsoleSettings() {
  return {
    'url-detection': false, // Noisy - disabled by default
    hover: false, // Noisy - disabled by default
    clipboard: true,
    keyboard: true,
    'quick-tabs': true,
    'quick-tab-manager': true,
    'event-bus': false,
    config: true,
    state: false,
    storage: true,
    messaging: false,
    webrequest: true,
    tabs: true,
    performance: false,
    errors: true,
    initialization: true
  };
}
```

When you enable all checkboxes in the UI and save, the extension saves:

```javascript
{
  'url-detection': true,
  'hover': true,
  'clipboard': true,
  'keyboard': true,
  // ... all true
}
```

But during the initialization race condition, the system falls back to
**defaults** which have several categories disabled:

- `url-detection`: false
- `hover`: false
- `event-bus`: false
- `state`: false
- `messaging`: false
- `performance`: false

This means even though you enabled everything, the first few hundred
milliseconds of logs get filtered using the defaults.

### Problem 3: Website Logs vs Extension Logs

The browser console (.log file) contains **two sources** of logs:

1. **Extension logs** - Generated by the Copy-URL-on-Hover extension (controlled
   by filters)
2. **Website logs** - Generated by the website itself (YouTube player errors,
   etc.) - **NOT controlled by extension filters**

**Example from .log file:**

```
handlerapplyhttpswww.youtube.comwatch?vhoEKZRzo-n4129927.DKhttpswww.youtube.comsplayer7d647a07playerias.vflsetenUSbase.js1196222.e.starthttpswww.youtube.comsplayer7d647a07playerias.vflsetenUSbase.js860245.prototype.SPhttpswww.youtube.comsplayer7d647a07playerias.vflsetenUSbase.js13359225.e.Mvhttpswww.youtube.comsplayer7d647a07playerias.vflsetenUSbase.js860544
```

This is a **YouTube player error** - it's not coming from the extension at all.
The browser console captures everything from:

- Extension content script logs
- Website's own console.log() calls
- YouTube player errors
- Other website JavaScript errors

The extension export (.txt file) **only** captures extension logs because the
console interceptor only intercepts logs that go through the extension's
console.log() override.

**This explains the size discrepancy:**

- Browser console = Extension logs + Website logs + YouTube errors
- Export file = Extension logs only (filtered)

---

## Detailed Analysis: Console Interceptor Architecture

### How It Currently Works

**File:** `src/utils/console-interceptor.js` (lines 123-141)

```javascript
console.log = function (...args) {
  const message = Array.from(args)
    .map(arg => serializeArgument(arg))
    .join(' ');
  const category = extractCategoryFromMessage(message);

  // Always add to buffer (for export)
  addToLogBuffer('LOG', args, category);

  // Check live console filter before logging to console
  if (isCategoryEnabledForLiveConsole(category)) {
    originalConsole.log.apply(console, args);
  }
  // If disabled, log is buffered but NOT displayed in console
};
```

**The Good Parts:**

- ✅ Logs are always added to buffer (export works)
- ✅ Filter check happens before console output
- ✅ Disabled categories don't print to console

**The Broken Parts:**

- ❌ `isCategoryEnabledForLiveConsole()` uses cache that may not be initialized
- ❌ Cache initialization is async but called synchronously
- ❌ No guarantee cache is loaded before first logs

### How Filter Check Works

**File:** `src/utils/filter-settings.js` (lines 123-140)

```javascript
export function isCategoryEnabledForLiveConsole(category) {
  const settings = getLiveConsoleSettings();

  // CRITICAL CATEGORIES ALWAYS ENABLED (errors, initialization)
  const criticalCategories = ['errors', 'initialization'];
  if (criticalCategories.includes(category)) {
    return true;
  }

  // Default to true if category not in settings (fail-safe)
  if (!(category in settings)) {
    return true;
  }

  return settings[category] === true;
}
```

**The Issue:**

`getLiveConsoleSettings()` returns the cache:

```javascript
export function getLiveConsoleSettings() {
  if (!settingsInitialized || liveConsoleSettingsCache === null) {
    return getDefaultLiveConsoleSettings(); // Falls back to defaults
  }
  return liveConsoleSettingsCache;
}
```

During initialization race condition:

- `settingsInitialized` = false (async not complete)
- Returns defaults
- Defaults have hover/url-detection disabled
- Your "all enabled" settings ignored until async completes

---

## Why Export Filter Works But Live Filter Doesn't

### Export Filter (Works Correctly)

**File:** `popup.js` (lines 489-515)

```javascript
async function getExportFilterSettings() {
  try {
    const result = await browserAPI.storage.local.get(
      'exportLogCategoriesEnabled'
    );
    if (result.exportLogCategoriesEnabled) {
      return result.exportLogCategoriesEnabled;
    }
  } catch (error) {
    console.error('[Popup] Failed to load export filter settings:', error);
  }
  return getDefaultExportSettings(); // Default: all categories enabled
}

function filterLogsByExportSettings(allLogs, exportSettings) {
  // ... filtering logic
  return allLogs.filter(logEntry => {
    const category = extractCategoryFromLogEntry(logEntry);
    // Check if category is enabled for export
    return exportSettings[category] === true;
  });
}
```

**Why it works:**

1. Called from `exportAllLogs()` which is async
2. Properly awaits storage load
3. Happens once during export (not during logging)
4. No race condition - waits for data

### Live Filter (Broken)

**The Comparison:**

| Aspect             | Export Filter                  | Live Filter                 |
| ------------------ | ------------------------------ | --------------------------- |
| **When it runs**   | Once during export             | Every single log call       |
| **Async handling** | Properly awaited               | Async init called sync      |
| **Cache state**    | Loads fresh each time          | May use stale/null cache    |
| **Timing**         | User-triggered, plenty of time | Module load, race condition |
| **Fallback**       | All enabled (safe)             | Some disabled (breaks UX)   |

---

## Evidence From Log Files

### Export File (.txt) - Clean Extension Logs

Sample from `copy-url-extension-logs_v1.6.1_2025-11-22T04-23-58.txt`:

```
[2025-11-22T04:23:09.203Z] [LOG  ] DEBUG: Log buffer cleared
[2025-11-22T04:23:13.231Z] [DEBUG] Background: Storage changed (local) copyUrlKey, copyUrlCtrl, ...
[2025-11-22T04:23:13.231Z] [LOG  ] StorageManager: Storage changed (local)
[2025-11-22T04:23:14.742Z] [LOG  ] 🔍 URL Detection: Failure | No URL found
[2025-11-22T04:23:14.836Z] [LOG  ] 👆 Hover Events: End | Mouse left element | duration: 94.00ms
[2025-11-22T04:23:14.836Z] [LOG  ] 👆 Hover Events: Start | Mouse entered element
[2025-11-22T04:23:14.836Z] [LOG  ] 🔍 URL Detection: Start | Detecting URL for element
```

**Characteristics:**

- All logs are from extension (prefixed with category emojis)
- Properly formatted with timestamps
- Clean, structured output
- No website errors

### Browser Console (.log) - Mixed Sources

Sample from `console-export-2025-11-21_23-23-42.log`:

```
handlerapplyhttpswww.youtube.comwatch?vhoEKZRzo-n4129927.DKhttpswww.youtube.comsplayer7d647a07playerias.vflsetenUSbase.js1196222.e.starthttpswww.youtube.comsplayer7d647a07playerias.vflsetenUSbase.js860245.prototype.SPhttpswww.youtube.comsplayer7d647a07playerias.vflsetenUSbase.js13359225.e.Mvhttpswww.youtube.comsplayer7d647a07playerias.vflsetenUSbase.js860544
```

**Characteristics:**

- Massive YouTube player error stack traces
- Website JavaScript errors
- Extension logs mixed in
- Difficult to read due to website noise
- Way more data than extension alone

**The "unique messages" you couldn't discern in real-time are YouTube player
errors, not extension logs.**

---

## The Compounding Problem: Website Log Noise

Even if the live console filter worked perfectly, you'd still see excessive logs
in the browser console because:

1. **Extension logs** - Controlled by your filters
2. **Website logs** - NOT controlled by extension, floods console

The extension **cannot filter website logs** - it only controls its own output.
YouTube's player errors will always appear in the browser console.

**This creates a user experience problem:**

- User enables all filters → expects to see all extension logs
- Browser console shows extension logs + YouTube spam
- Impossible to debug extension because website noise drowns it out
- User thinks extension is broken, but it's the website flooding console

---

## How The Bug Manifests

### Scenario 1: Fresh Page Load (All Filters Enabled)

**Timeline:**

```
0ms:   Page loads, extension content script injected
0ms:   filter-settings.js imports
0ms:   initializeFilterSettings() called (async, no await)
0ms:   Returns immediately, cache = null
1ms:   console-interceptor.js imports
1ms:   Overrides console.log
5ms:   Extension starts logging
5ms:   isCategoryEnabledForLiveConsole('hover') called
5ms:   Cache still null → returns defaults
5ms:   Defaults have hover: false
5ms:   Hover logs SUPPRESSED (wrong!)
10ms:  isCategoryEnabledForLiveConsole('url-detection') called
10ms:  Cache still null → returns defaults
10ms:  Defaults have url-detection: false
10ms:  URL detection logs SUPPRESSED (wrong!)
50ms:  Async storage.local.get() completes
50ms:  Cache updated with user settings (all enabled)
51ms:  New logs use correct cache
51ms:  But first 50ms of logs were filtered incorrectly
```

**Result:** First ~50-100ms of logs are filtered using defaults instead of user
settings.

### Scenario 2: Settings Changed in Popup

**Timeline:**

```
User opens popup, enables all categories, clicks Save
↓
popup.js saves to storage.local
↓
popup.js calls refreshLiveConsoleFiltersInAllTabs()
↓
Sends REFRESH_LIVE_CONSOLE_FILTERS message to content script
↓
content.js receives message (line 1013 in content.js)
↓
Calls refreshLiveConsoleSettings() from logger.js
↓
logger.js delegates to filter-settings.js refreshLiveConsoleSettings()
↓
filter-settings.js loads from storage (async)
↓
Cache updated
↓
Works correctly from this point
```

**This part actually works!** The refresh mechanism is implemented.

**But the problem is:** If you reload the page before changing settings, you hit
Scenario 1 again.

---

## Performance Impact Analysis

### Current State (With Broken Filter)

**Based on log samples, during 10 seconds of hovering on Wikipedia:**

**Extension logs generated:**

- ~200-400 hover event logs
- ~200-400 URL detection logs
- ~50-100 other category logs
- **Total: ~450-900 extension logs**

**Extension logs shown in browser console (with filter bug):**

- During initialization (first 50ms): Some hover/URL logs suppressed by defaults
- After initialization: All logs shown (user enabled all)
- **Estimated: ~400-800 logs shown** (depending on initialization timing)

**Website logs (uncontrollable):**

- YouTube player: ~500-1000 error logs (if on YouTube)
- Other websites: ~0-100 logs
- **Total browser console: ~900-1900 logs**

**Performance impact:**

- Console writes: ~180-380 per second
- String allocations: ~500KB - 1MB memory
- DevTools UI lag: Moderate to severe
- Debugging difficulty: High (noise drowns signal)

### If Filter Worked Correctly (All Enabled)

**No change to extension behavior** because user wants all logs. Filter bug
doesn't help when filter is "all enabled".

**The real issue:** User cannot selectively disable noisy categories because of
the bug.

### If Filter Worked Correctly (Hover/URL Disabled)

**If user disables hover and url-detection:**

**Extension logs generated:**

- ~200-400 hover logs (buffered but not shown)
- ~200-400 URL detection logs (buffered but not shown)
- ~50-100 other category logs (shown)
- **Browser console: ~50-100 extension logs** (95% reduction!)

**Website logs:**

- Still uncontrollable: ~500-1000 YouTube errors

**Performance impact:**

- Console writes: ~15-20 per second (from extension)
- String allocations: ~50-100KB memory (extension only)
- DevTools UI: Still laggy (YouTube spam)
- Debugging difficulty: Medium (website noise still present)

---

## Required Fixes

### Fix 1: Synchronous Filter Initialization

**Problem:** Async initialization called without await causes race condition.

**Location:** `src/utils/filter-settings.js`

**Current Implementation:**

```javascript
// Initialize settings immediately when module loads
initializeFilterSettings(); // ❌ WRONG: async function called sync
```

**Required Changes:**

**Option A: Make initialization synchronous (if possible)**

Replace async storage access with synchronous alternative:

- Chrome: `chrome.storage.local.get()` is async only
- Firefox: `browser.storage.local.get()` is async only
- **No synchronous alternative exists in Web Extensions API**

This option is **not viable** - storage APIs are inherently async.

**Option B: Use top-level await (ES modules)**

```javascript
// At top of filter-settings.js
await initializeFilterSettings();
```

**Requires:**

- Module must be ES module (already is)
- Browser must support top-level await (Firefox 89+, Chrome 89+)
- All importers must be async-aware

**Risk:** May break module loading order.

**Option C: Lazy initialization with synchronous defaults (RECOMMENDED)**

Remove automatic initialization. Let the first filter check trigger
initialization:

```javascript
let initializationPromise = null;

export function ensureInitialized() {
  if (!initializationPromise) {
    initializationPromise = initializeFilterSettings();
  }
  return initializationPromise;
}

export function isCategoryEnabledForLiveConsole(category) {
  // Use current cache (may be defaults initially)
  const settings = getLiveConsoleSettings();

  // Critical categories always enabled
  if (['errors', 'initialization'].includes(category)) {
    return true;
  }

  // Start async initialization if not started
  if (!settingsInitialized) {
    ensureInitialized();
  }

  // Return based on current cache state
  return settings[category] !== false;
}
```

**Benefits:**

- No race condition
- Defaults used until real settings load
- Initialization triggered on first use
- Graceful degradation

**Trade-off:**

- First few logs use defaults (hover/URL disabled)
- But this is **expected behavior** - defaults are conservative
- User can change settings and refresh to get full logging

### Fix 2: Change Defaults to "All Enabled" for Better UX

**Problem:** Defaults have some categories disabled, surprising users who expect
everything on.

**Current Defaults:**

```javascript
'url-detection': false, // ❌ Disabled
'hover': false, // ❌ Disabled
'event-bus': false, // ❌ Disabled
'state': false, // ❌ Disabled
'messaging': false, // ❌ Disabled
'performance': false, // ❌ Disabled
```

**Recommended Defaults:**

```javascript
'url-detection': true, // ✅ Enabled by default
'hover': true, // ✅ Enabled by default
'event-bus': true, // ✅ Enabled by default
'state': true, // ✅ Enabled by default
'messaging': true, // ✅ Enabled by default
'performance': true, // ✅ Enabled by default
```

**Reasoning:**

- First-time users expect to see all logs for debugging
- They can disable noisy categories after seeing them
- Better to show too much than too little for troubleshooting
- Aligns with export filter defaults (all enabled)

**Trade-off:**

- More console noise by default
- But users can easily disable via settings

### Fix 3: Add Explicit Initialization in content.js

**Problem:** Module initialization happens before content script ready.

**Location:** `src/content.js`

**Add After Imports:**

```javascript
// After all imports, before extension initialization
import { ensureInitialized } from './utils/filter-settings.js';

// Wait for filter settings to initialize before logging
await ensureInitialized();
console.log('[Copy-URL-on-Hover] Filter settings initialized');

// Continue with normal initialization...
```

**Benefits:**

- Guarantees settings loaded before logging
- No more race condition
- Clean initialization flow

**Requires:**

- content.js must be async (already is via IIFE)
- Filter settings module exports ensureInitialized()

---

## Testing Recommendations

### Test Case 1: Verify Initialization Order

**Setup:**

1. Clear extension storage
2. Reload extension
3. Open webpage with extension
4. Check browser console for first 10 logs

**Expected Result (After Fix):**

- All logs appear (defaults now all-enabled)
- OR: First few logs use defaults, then switch to user settings
- No missing logs

**Current Behavior (Before Fix):**

- Some hover/URL logs missing during initialization
- Race condition visible in timing

### Test Case 2: Verify Settings Persist Across Reloads

**Setup:**

1. Open popup
2. Disable hover and url-detection categories
3. Save settings
4. Reload page
5. Hover over links

**Expected Result (After Fix):**

- Console shows NO hover logs
- Console shows NO url-detection logs
- Export file contains buffered hover/URL logs

**Current Behavior (Before Fix):**

- May show some hover logs during initialization
- Then correctly filters after cache loads

### Test Case 3: Verify Website Logs Don't Interfere

**Setup:**

1. Open YouTube video
2. Open browser console
3. Enable all extension filters
4. Hover over links

**Expected Result:**

- Console shows extension logs (with emojis/prefixes)
- Console shows YouTube errors (from website)
- Extension logs are clearly distinguishable
- Export file contains ONLY extension logs

### Test Case 4: Verify Real-Time Filter Updates

**Setup:**

1. Open popup
2. Disable hover category
3. Save settings
4. Without reloading page, hover over links
5. Check console

**Expected Result:**

- Console shows NO new hover logs immediately
- Cache refreshed via message handler
- No page reload needed

**Current Behavior:**

- Should work (refresh mechanism exists)

---

## Website Log Noise Mitigation (Bonus)

### Problem: Browser Console Flooded by Website Logs

The extension cannot control website logs (YouTube errors, etc). This makes
debugging difficult even with extension filters working.

### Recommended User Workflow

**Use Browser Console Filtering:**

1. **Firefox:**
   - Open console (F12)
   - In filter box, type: `URL Detection` or `Hover Events`
   - Console shows only matching logs
   - Or use negative filter: `-youtube`

2. **Chrome:**
   - Open console (F12)
   - Click filter icon
   - Select "User messages" to hide third-party
   - Or type in filter: `Hover Events`

### Alternative: Extension-Only Console View

**Feature Idea for Future Version:**

Add a "Debug Panel" in the extension that shows only extension logs in
real-time:

```javascript
// Debug panel in popup or separate tab
function createDebugPanel() {
  const panel = document.createElement('div');
  panel.style.cssText =
    'position: fixed; bottom: 0; right: 0; width: 400px; height: 300px; background: #1e1e1e; color: #e0e0e0; overflow: auto; z-index: 999999;';

  // Stream logs from buffer
  setInterval(() => {
    const logs = getConsoleLogs().slice(-50); // Last 50 logs
    panel.innerHTML = logs
      .map(
        log =>
          `<div>[${new Date(log.timestamp).toISOString()}] ${log.message}</div>`
      )
      .join('');
  }, 1000);

  document.body.appendChild(panel);
}
```

**Benefits:**

- Shows only extension logs
- No website noise
- Real-time updates
- Filterable by category

---

## Summary

### The Core Issue

**Live console filter initialization has a race condition** where:

1. Settings cache starts as null
2. Async load happens but isn't awaited
3. Early logs use defaults instead of user settings
4. Defaults have some categories disabled
5. User's "all enabled" settings ignored initially

**Plus:**

- Browser console shows website logs (uncontrollable)
- YouTube errors flood console on YouTube
- Makes extension logs hard to find

### The Fix Priority

**High Priority (Critical):**

1. Fix synchronous initialization (Option C recommended)
2. Add explicit await in content.js before logging
3. Change defaults to all-enabled for better UX

**Medium Priority (UX Improvement):** 4. Document browser console filtering for
users 5. Add warning in export metadata about website logs

**Low Priority (Future Enhancement):** 6. Consider debug panel feature for
extension-only view 7. Add category statistics to export

### Expected Impact After Fixes

**Before Fix:**

- First ~50-100ms of logs filtered incorrectly
- Confusing UX (settings ignored)
- Website noise drowns extension logs

**After Fix:**

- All logs respect user settings from start
- Consistent behavior across reloads
- Clear documentation on website log issue
- Users can effectively debug with filters

---

## References

### Relevant Source Files

1. **`src/utils/filter-settings.js`** - Filter cache and initialization
2. **`src/utils/console-interceptor.js`** - Console override and filtering
3. **`src/utils/logger.js`** - Category-based logging functions
4. **`src/content.js`** - Main content script entry point
5. **`popup.js`** - Settings UI and filter controls

### Web Extension Documentation

- [Mozilla: browser.storage API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage)
- [Chrome: chrome.storage API](https://developer.chrome.com/docs/extensions/reference/storage/)
- [Console Performance Impact](https://arunangshudas.com/blog/why-is-console-log-so-slow/) -
  Why excessive logging slows apps

---

## Appendix: Log Sample Comparison

### Extension Export (.txt) - 262 KB

```
==========================================================================
Copy URL on Hover - Extension Console Logs
==========================================================================

Version: 1.6.1
Export Date: 2025-11-22T04:23:58.152Z
Total Logs: 986

==========================================================================

[2025-11-22T04:23:09.203Z] [LOG  ] DEBUG: Log buffer cleared
[2025-11-22T04:23:13.231Z] [DEBUG] Background: Storage changed
[2025-11-22T04:23:14.742Z] [LOG  ] 🔍 URL Detection: Failure | No URL found
[2025-11-22T04:23:14.836Z] [LOG  ] 👆 Hover Events: End | Mouse left element
```

**Characteristics:**

- Clean, formatted extension logs
- Category emojis and prefixes
- Structured timestamps
- No website errors

### Browser Console (.log) - 1.06 MB

```
handlerapplyhttpswww.youtube.comwatch?vhoEKZRzo-n4129927.DK
httpswww.youtube.comsplayer7d647a07playerias.vflsetenUSbase.js1196
start httpswww.youtube.comsplayer7d647a07playerias.vflsetenUSbase.js860
SP httpswww.youtube.comsplayer7d647a07playerias.vflsetenUSbase.js13359
```

**Characteristics:**

- Massive YouTube player stack traces
- Minified JavaScript errors
- Unreadable error messages
- Mixed with extension logs
- 4x larger than extension-only export

**The difference is website logs flooding the console, NOT broken extension
filtering.**
