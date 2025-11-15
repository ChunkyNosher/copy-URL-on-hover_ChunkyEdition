# Export Console Logs Button Implementation Guide
**copy-URL-on-hover Extension v1.5.9**

**Issue:** Export Logs button missing from Advanced tab in popup settings  
**Repository:** ChunkyNosher/copy-URL-on-hover_ChunkyEdition  
**Date:** November 15, 2025, 12:25 AM EST

---

## Table of Contents

1. [Current Implementation Status](#current-implementation-status)
2. [Critical Issue: Context Separation](#critical-issue-context-separation)
3. [Complete Implementation Steps](#complete-implementation-steps)
4. [Code Validation & Fixes](#code-validation--fixes)
5. [Testing Checklist](#testing-checklist)

---

## Current Implementation Status

### ✅ What's Already Implemented (v1.5.9)

**File: `src/utils/debug.js`**
- ✅ `LOG_BUFFER` array to store logs (max 5000 entries)
- ✅ `addToBuffer()` function to capture all log types
- ✅ `exportLogs()` function with dual download methods
- ✅ `formatLogsAsText()` for log file formatting
- ✅ `generateLogFilename()` with version + timestamp
- ✅ All debug, error, warn, info functions enhanced with buffering

**File: `background.js`**
- ✅ `BACKGROUND_LOG_BUFFER` array (max 2000 entries)
- ✅ Console method overrides to capture background logs
- ✅ `GET_BACKGROUND_LOGS` message handler (line ~115-118)

**File: `manifest.json`**
- ✅ `downloads` permission added

### ❌ What's Missing

**File: `popup.html`**
- ❌ Export Logs button in Advanced tab
- ❌ Button styling/layout

**File: `popup.js`**
- ❌ Import statement for `exportLogs()` function
- ❌ Event listener for export button
- ❌ Error handling for export failures

---

## Critical Issue: Context Separation

### Understanding Firefox Extension Contexts

According to MDN documentation[171][187]:

**Three Separate Execution Contexts:**

1. **Content Scripts** (`src/content.js` → compiled to `content.js`)
   - Runs in webpage context
   - Has access to page DOM
   - Has access to `browser` API
   - **CANNOT** use `browser.downloads` API[144]

2. **Popup Scripts** (`popup.js`)
   - Runs in popup window context
   - Has access to `browser` API
   - **CAN** use `browser.downloads` API[143][185]
   - **CANNOT** directly import from content script modules

3. **Background Scripts** (`background.js`)
   - Runs in persistent background context
   - Has full access to `browser` API
   - **CAN** use `browser.downloads` API

### The Problem with Current Implementation

The `exportLogs()` function is defined in `src/utils/debug.js`, which gets compiled into `content.js`. However:

**❌ WRONG:** `popup.js` trying to import from content script:
```javascript
// This will NOT work - different contexts!
import { exportLogs } from './src/utils/debug.js';
```

**✅ CORRECT:** Implement export logic directly in `popup.js` or use message passing to background script.

---

## Complete Implementation Steps

### Solution Architecture

We'll implement the export functionality **directly in `popup.js`** since:
- Popup has access to `browser.downloads` API[143]
- Popup can request logs from both content scripts and background via messaging[170]
- No module import issues

### Step 1: Add Export Button to `popup.html`

**File:** `popup.html`

**Location:** Inside the `<div id="advanced" class="tab-content">` section, add the button AFTER the "Clear Quick Tab Storage" section and BEFORE the info-box.

**Add this HTML:**

```html
<!-- Tab 4: Advanced -->
<div id="advanced" class="tab-content">
  <div class="setting-group">
    <label>Extension Menu Size:</label>
    <select
      id="menuSize"
      style="
        width: 100%;
        padding: 8px 10px;
        background: #3a3a3a;
        border: 1px solid #4a4a4a;
        color: #e0e0e0;
        border-radius: 4px;
        font-size: 12px;
      "
    >
      <option value="small">Small (20% smaller)</option>
      <option value="medium">Medium (Default)</option>
      <option value="large">Large (20% larger)</option>
    </select>
  </div>

  <div class="setting-group">
    <label>Quick Tab Position Update Rate (Hz):</label>
    <input type="text" id="quickTabUpdateRate" placeholder="360" value="360" />
    <small style="display: block; margin-top: 4px; color: #888; font-size: 11px">
      Higher values (e.g., 360) provide smoother dragging on high refresh rate monitors.
      Lower values use less CPU.
    </small>
  </div>

  <div class="setting-group">
    <div class="checkbox-group">
      <input type="checkbox" id="showNotification" checked />
      <label for="showNotification">Show Copy Notifications</label>
    </div>
  </div>

  <div class="setting-group">
    <div class="checkbox-group">
      <input type="checkbox" id="debugMode" />
      <label for="debugMode">Enable debug mode (console logs)</label>
    </div>
  </div>

  <!-- EXISTING: Clear Quick Tab Storage button -->
  <div class="setting-group">
    <button
      id="clearStorageBtn"
      style="
        width: 100%;
        padding: 10px;
        background: #d32f2f;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
      "
    >
      🗑️ Clear Quick Tab Storage
    </button>
    <small style="display: block; margin-top: 4px; color: #888; font-size: 11px">
      This will clear all saved Quick Tab positions and state from browser storage. Use this
      if Quick Tabs are behaving unexpectedly.
    </small>
  </div>

  <!-- NEW: Export Console Logs button -->
  <div class="setting-group">
    <button
      id="exportLogsBtn"
      style="
        width: 100%;
        padding: 10px;
        background: #2196F3;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.2s ease;
      "
    >
      📥 Export Console Logs
    </button>
    <small style="display: block; margin-top: 4px; color: #888; font-size: 11px">
      Download all extension console logs as a .txt file for debugging or support.
      File includes version number and timestamp.
    </small>
  </div>

  <div class="info-box">
    <strong>Debug Mode:</strong> When enabled, detailed logs will appear in the browser
    console (F12). Useful for troubleshooting.
  </div>
</div>
```

**Additional CSS (add to `<style>` section):**

```css
/* Export Logs button hover state */
#exportLogsBtn:hover {
  background: #1976D2;
}

#exportLogsBtn:active {
  background: #1565C0;
}

#exportLogsBtn:disabled {
  background: #666;
  cursor: not-allowed;
  opacity: 0.6;
}

/* Success state for export button */
#exportLogsBtn.success {
  background: #4CAF50 !important;
}

/* Error state for export button */
#exportLogsBtn.error {
  background: #f44336 !important;
}
```

---

### Step 2: Implement Export Logic in `popup.js`

**File:** `popup.js`

**Add these helper functions at the top of the file (after the browser API shim):**

```javascript
// ==================== LOG EXPORT FUNCTIONS ====================

/**
 * Request logs from background script
 * @returns {Promise<Array>} Array of log entries
 */
async function getBackgroundLogs() {
  try {
    const response = await browser.runtime.sendMessage({
      action: 'GET_BACKGROUND_LOGS'
    });
    return response && response.logs ? response.logs : [];
  } catch (error) {
    console.warn('[Popup] Could not retrieve background logs:', error);
    return [];
  }
}

/**
 * Request logs from active content script
 * @returns {Promise<Array>} Array of log entries
 */
async function getContentScriptLogs() {
  try {
    // Get active tab
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) {
      console.warn('[Popup] No active tab found');
      return [];
    }

    const activeTab = tabs[0];

    // Request logs from content script
    const response = await browser.tabs.sendMessage(activeTab.id, {
      action: 'GET_CONTENT_LOGS'
    });

    return response && response.logs ? response.logs : [];
  } catch (error) {
    console.warn('[Popup] Could not retrieve content script logs:', error);
    return [];
  }
}

/**
 * Format logs as plain text
 * @param {Array} logs - Array of log entries
 * @param {string} version - Extension version
 * @returns {string} Formatted log text
 */
function formatLogsAsText(logs, version) {
  const now = new Date();
  const header = [
    '='.repeat(80),
    'Copy URL on Hover - Extension Console Logs',
    '='.repeat(80),
    '',
    `Version: ${version}`,
    `Export Date: ${now.toISOString()}`,
    `Export Date (Local): ${now.toLocaleString()}`,
    `Total Logs: ${logs.length}`,
    '',
    '='.repeat(80),
    ''
  ].join('\n');

  const logLines = logs.map(entry => {
    const date = new Date(entry.timestamp);
    const timestamp = date.toISOString();
    return `[${timestamp}] [${entry.type.padEnd(5)}] ${entry.message}`;
  });

  const footer = ['', '='.repeat(80), 'End of Logs', '='.repeat(80)].join('\n');

  return header + logLines.join('\n') + footer;
}

/**
 * Generate filename for log export
 * @param {string} version - Extension version
 * @returns {string} Filename with version and timestamp
 */
function generateLogFilename(version) {
  const now = new Date();
  // ISO 8601 format with hyphens instead of colons for filename compatibility
  const timestamp = now.toISOString().replace(/:/g, '-').split('.')[0];
  return `copy-url-extension-logs_v${version}_${timestamp}.txt`;
}

/**
 * Export all logs as downloadable .txt file
 * @param {string} version - Extension version
 * @returns {Promise<void>}
 */
async function exportAllLogs(version) {
  try {
    console.log('[Popup] Starting log export...');

    // Collect logs from all sources
    const backgroundLogs = await getBackgroundLogs();
    const contentLogs = await getContentScriptLogs();

    console.log(`[Popup] Collected ${backgroundLogs.length} background logs`);
    console.log(`[Popup] Collected ${contentLogs.length} content logs`);

    // Merge all logs
    const allLogs = [...backgroundLogs, ...contentLogs];

    // Sort by timestamp
    allLogs.sort((a, b) => a.timestamp - b.timestamp);

    console.log(`[Popup] Total logs to export: ${allLogs.length}`);

    // Handle empty logs case
    if (allLogs.length === 0) {
      console.warn('[Popup] No logs to export');
      throw new Error('No logs found. Try enabling debug mode and using the extension first.');
    }

    // Format logs
    const logText = formatLogsAsText(allLogs, version);

    // Generate filename
    const filename = generateLogFilename(version);

    console.log(`[Popup] Exporting to: ${filename}`);

    // Create blob
    const blob = new Blob([logText], { type: 'text/plain;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);

    // Download via browser.downloads API (popup has access to this)
    await browser.downloads.download({
      url: blobUrl,
      filename: filename,
      saveAs: true // Prompt user for save location
    });

    console.log('[Popup] Export successful via browser.downloads API');

    // Clean up blob URL after short delay
    setTimeout(() => {
      URL.revokeObjectURL(blobUrl);
      console.log('[Popup] Cleaned up blob URL');
    }, 1000);
  } catch (error) {
    console.error('[Popup] Export failed:', error);
    throw error;
  }
}

// ==================== END LOG EXPORT FUNCTIONS ====================
```

**Add event listener in `DOMContentLoaded` section:**

Find the `document.addEventListener('DOMContentLoaded', function () {` section and add this code BEFORE the closing `});`:

```javascript
  // ==================== EXPORT LOGS BUTTON ====================
  // Export logs button event listener
  const exportLogsBtn = document.getElementById('exportLogsBtn');
  if (exportLogsBtn) {
    exportLogsBtn.addEventListener('click', async () => {
      const originalText = exportLogsBtn.textContent;
      const originalBg = exportLogsBtn.style.backgroundColor;

      try {
        // Disable button during export
        exportLogsBtn.disabled = true;
        exportLogsBtn.textContent = '⏳ Exporting...';

        // Get version from manifest
        const manifest = browser.runtime.getManifest();
        const version = manifest.version;

        // Export all logs
        await exportAllLogs(version);

        // Show success feedback
        exportLogsBtn.textContent = '✓ Logs Exported!';
        exportLogsBtn.classList.add('success');

        // Reset after 2 seconds
        setTimeout(() => {
          exportLogsBtn.textContent = originalText;
          exportLogsBtn.style.backgroundColor = originalBg;
          exportLogsBtn.classList.remove('success');
          exportLogsBtn.disabled = false;
        }, 2000);
      } catch (error) {
        // Show error feedback
        exportLogsBtn.textContent = '✗ Export Failed';
        exportLogsBtn.classList.add('error');

        // Show error message in status
        showStatus(`Export failed: ${error.message}`, false);

        // Reset after 3 seconds
        setTimeout(() => {
          exportLogsBtn.textContent = originalText;
          exportLogsBtn.style.backgroundColor = originalBg;
          exportLogsBtn.classList.remove('error');
          exportLogsBtn.disabled = false;
        }, 3000);
      }
    });
  }
  // ==================== END EXPORT LOGS BUTTON ====================
```

---

### Step 3: Add Message Handler to Content Script

**File:** `src/content.js`

The content script needs to respond to `GET_CONTENT_LOGS` messages from the popup.

**Add this code near the initialization section (after imports, before `initExtension()`):**

```javascript
// ==================== LOG EXPORT MESSAGE HANDLER ====================
// Import getLogBuffer from debug utils
import { getLogBuffer } from './utils/debug.js';

// Listen for log export requests from popup
if (typeof browser !== 'undefined' && browser.runtime) {
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'GET_CONTENT_LOGS') {
      console.log('[Content] Received GET_CONTENT_LOGS request');
      try {
        const logs = getLogBuffer();
        console.log(`[Content] Sending ${logs.length} logs to popup`);
        sendResponse({ logs: logs });
      } catch (error) {
        console.error('[Content] Error getting log buffer:', error);
        sendResponse({ logs: [], error: error.message });
      }
      return true; // Keep message channel open for async response
    }
    
    // ... existing message handlers
  });
}
// ==================== END LOG EXPORT MESSAGE HANDLER ====================
```

**⚠️ IMPORTANT:** If content.js already has a `browser.runtime.onMessage.addListener`, add the `GET_CONTENT_LOGS` handler inside the existing listener instead of creating a new one.

---

## Code Validation & Fixes

### Issue 1: `exportLogs()` in debug.js Won't Work from Popup ❌

**Problem:** The current `exportLogs()` function in `src/utils/debug.js` uses:
```javascript
const link = document.createElement('a');
document.body.appendChild(link);
```

**Why it fails:** 
- When called from popup context, `document.body` refers to popup's body
- The Blob URL download via `<a>` tag method works in popup
- BUT the function tries to get logs from content script context, which doesn't work cross-context

**Fix:** Don't import `exportLogs()` from debug.js. Use the implementation in Step 2 above which properly handles context separation.

---

### Issue 2: Background Log Handler Already Exists ✅

**File:** `background.js` (lines ~115-118)

**Current implementation:**
```javascript
// Handle log export requests from popup
if (message.action === 'GET_BACKGROUND_LOGS') {
  sendResponse({ logs: [...BACKGROUND_LOG_BUFFER] });
  return true;
}
```

**Status:** ✅ This is correct and already implemented. No changes needed.

---

### Issue 3: Content Script Message Handler Missing ❌

**File:** `src/content.js`

**Current state:** No `GET_CONTENT_LOGS` handler exists.

**Fix:** Implement Step 3 above to add the handler.

---

### Issue 4: Import Statement in content.js

**File:** `src/content.js`

The file already imports from `./utils/debug.js`:
```javascript
import { debug, enableDebug } from './utils/debug.js';
```

**Update to:**
```javascript
import { debug, enableDebug, getLogBuffer } from './utils/debug.js';
```

This adds `getLogBuffer` to the imports for use in the message handler.

---

## Testing Checklist

### Test 1: Verify Export Button Appears

**Steps:**
1. Load extension in Firefox
2. Click extension icon to open popup
3. Navigate to "Advanced" tab

**Expected:**
- ✅ Blue "📥 Export Console Logs" button visible
- ✅ Button positioned below "Clear Quick Tab Storage" button
- ✅ Helper text explaining the feature is visible

**Screenshot reference:** Button should appear in the Advanced tab as shown in the attached image.

---

### Test 2: Verify Button Functionality

**Steps:**
1. Use extension normally (hover links, create Quick Tabs, etc.)
2. Open popup → Advanced tab
3. Click "📥 Export Console Logs" button

**Expected:**
- ✅ Button changes to "⏳ Exporting..."
- ✅ Button becomes disabled during export
- ✅ Firefox download dialog appears
- ✅ File downloads with correct name format: `copy-url-extension-logs_v1.5.9_2025-11-15T00-25-30.txt`
- ✅ Button changes to "✓ Logs Exported!" with green background
- ✅ Button resets to original state after 2 seconds

---

### Test 3: Verify Log File Contents

**Steps:**
1. Export logs
2. Open downloaded `.txt` file

**Expected file structure:**
```
================================================================================
Copy URL on Hover - Extension Console Logs
================================================================================

Version: 1.5.9
Export Date: 2025-11-15T05:25:30.456Z
Export Date (Local): 11/15/2025, 12:25:30 AM
Total Logs: 127

================================================================================

[2025-11-15T05:22:15.123Z] [DEBUG] Script loaded! @ 2025-11-15T05:22:15.123Z
[2025-11-15T05:22:15.145Z] [DEBUG] Debug marker set successfully
[2025-11-15T05:22:15.167Z] [DEBUG] ✓ Imported: config.js
[2025-11-15T05:22:15.189Z] [DEBUG] ✓ Imported: state.js
...
[2025-11-15T05:24:30.234Z] [DEBUG] Creating Quick Tab for: https://example.com
[2025-11-15T05:24:30.267Z] [INFO ] Quick Tab created successfully
...

================================================================================
End of Logs
================================================================================
```

**Verify:**
- ✅ Header includes correct version (1.5.9)
- ✅ Export timestamp is accurate
- ✅ Total log count matches actual logs
- ✅ Logs sorted chronologically
- ✅ Both background and content script logs present
- ✅ All log types (DEBUG, ERROR, WARN, INFO) present

---

### Test 4: Error Handling

**Scenario 1: No logs available**

**Steps:**
1. Fresh Firefox profile with extension installed
2. Open popup immediately
3. Click Export Logs button

**Expected:**
- ✅ Button shows "✗ Export Failed"
- ✅ Error message in status: "Export failed: No logs found..."
- ✅ Button resets after 3 seconds
- ✅ Console shows warning about no logs

**Scenario 2: Content script not loaded**

**Steps:**
1. Open popup on restricted page (e.g., about:config)
2. Click Export Logs button

**Expected:**
- ✅ Export still succeeds with background logs only
- ✅ Console shows warning about content script logs unavailable
- ✅ File contains background logs

**Scenario 3: Downloads permission revoked**

**Steps:**
1. Remove `downloads` permission from manifest temporarily
2. Try to export logs

**Expected:**
- ✅ Export fails gracefully
- ✅ Error shown to user
- ✅ Console shows clear error message

---

### Test 5: Cross-Context Log Collection

**Steps:**
1. Enable debug mode in Advanced settings
2. Perform various actions:
   - Hover over links
   - Create 2-3 Quick Tabs
   - Minimize a Quick Tab
   - Restore a Quick Tab
   - Close a Quick Tab
3. Switch between tabs
4. Export logs

**Expected:**
- ✅ Logs from content script actions (hover, Quick Tab creation)
- ✅ Logs from background script (storage sync, broadcast messages)
- ✅ All logs merged and sorted chronologically
- ✅ Timestamp accuracy (no future dates, no duplicates)

---

### Test 6: Filename Format Validation

**Expected format:**
```
copy-url-extension-logs_v1.5.9_2025-11-15T00-25-30.txt
```

**Validation checklist:**
- ✅ Prefix: `copy-url-extension-logs_`
- ✅ Version: `v1.5.9` (matches manifest.json)
- ✅ Underscore separator: `_`
- ✅ Timestamp: ISO 8601 format with hyphens replacing colons
- ✅ Extension: `.txt`
- ✅ No invalid filename characters (/, :, *, ?, ", <, >, |)

---

## Advanced Debugging

### Console Debugging

**Open Browser Console (Ctrl+Shift+J) to debug:**

**When clicking Export button:**
```
[Popup] Starting log export...
[Popup] Collected 45 background logs
[Popup] Collected 82 content logs
[Popup] Total logs to export: 127
[Popup] Exporting to: copy-url-extension-logs_v1.5.9_2025-11-15T00-25-30.txt
[Popup] Export successful via browser.downloads API
[Popup] Cleaned up blob URL
```

**If errors occur:**
```
[Popup] Could not retrieve content script logs: Error: Could not establish connection
[Popup] Export failed: Error: No logs found...
```

### Fallback Method (if browser.downloads fails)

If `browser.downloads.download()` fails for any reason, you can add a fallback using the Blob URL + `<a>` tag method:

**Add to `exportAllLogs()` function after the try block:**

```javascript
  } catch (downloadError) {
    console.warn('[Popup] browser.downloads failed, trying fallback:', downloadError);

    // Fallback: Blob URL + <a> download
    try {
      const blob = new Blob([logText], { type: 'text/plain;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);

      // Create temporary download link
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      link.style.display = 'none';

      // Append to popup body
      document.body.appendChild(link);

      // Trigger download
      link.click();

      // Cleanup
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl);
      }, 100);

      console.log('[Popup] Export successful via Blob URL fallback');
    } catch (fallbackError) {
      console.error('[Popup] Fallback export also failed:', fallbackError);
      throw new Error('Download failed: ' + fallbackError.message);
    }
  }
```

---

## Summary of Changes

### Files Modified

| File | Changes | Lines Added |
|------|---------|-------------|
| `popup.html` | Add Export Logs button + CSS | ~45 lines |
| `popup.js` | Add export functions + event listener | ~150 lines |
| `src/content.js` | Add GET_CONTENT_LOGS handler | ~20 lines |

### Existing Files (No Changes Needed)

| File | Status | Reason |
|------|--------|--------|
| `src/utils/debug.js` | ✅ Complete | All log buffering functions already implemented |
| `background.js` | ✅ Complete | GET_BACKGROUND_LOGS handler already exists |
| `manifest.json` | ✅ Complete | Downloads permission already added |

---

## Implementation Priority

1. **HIGH** (10 min) - Add export button to `popup.html`
2. **CRITICAL** (30 min) - Add export functions to `popup.js`
3. **HIGH** (10 min) - Add message handler to `src/content.js`
4. **MEDIUM** (5 min) - Test end-to-end functionality

**Total estimated time: 55 minutes**

---

## Why This Architecture Works

### Context-Aware Design

**Popup Context (popup.js):**
- ✅ Has access to `browser.downloads` API[143][185]
- ✅ Can send messages to background script[170]
- ✅ Can send messages to content scripts[184]
- ✅ Can access `browser.runtime.getManifest()`[173]

**Message Passing Flow:**
```
User clicks button in popup.js
    ↓
popup.js sends GET_BACKGROUND_LOGS to background.js
    ↓
background.js responds with BACKGROUND_LOG_BUFFER
    ↓
popup.js sends GET_CONTENT_LOGS to active tab's content.js
    ↓
content.js responds with LOG_BUFFER (from debug.js)
    ↓
popup.js merges, sorts, formats all logs
    ↓
popup.js creates Blob and triggers browser.downloads
    ↓
User saves file
```

This architecture respects Firefox's security model where:
- Content scripts cannot access `downloads` API[144]
- Popup scripts CAN access `downloads` API[143]
- Cross-context communication happens via `browser.runtime.sendMessage()`[170][184]

---

## Additional Notes

### Future Enhancements (Optional)

**1. Add Log Filtering UI**

Add checkboxes in popup to filter log types before export:
```html
<div class="setting-group">
  <label>Log Types to Export:</label>
  <div class="checkbox-inline-group">
    <div class="checkbox-group">
      <input type="checkbox" id="exportDebug" checked />
      <label for="exportDebug">DEBUG</label>
    </div>
    <div class="checkbox-group">
      <input type="checkbox" id="exportError" checked />
      <label for="exportError">ERROR</label>
    </div>
    <div class="checkbox-group">
      <input type="checkbox" id="exportWarn" checked />
      <label for="exportWarn">WARN</label>
    </div>
    <div class="checkbox-group">
      <input type="checkbox" id="exportInfo" checked />
      <label for="exportInfo">INFO</label>
    </div>
  </div>
</div>
```

**2. Add Log Count Display**

Show log count before exporting:
```javascript
const logCount = backgroundLogs.length + contentLogs.length;
exportLogsBtn.textContent = `📥 Export Logs (${logCount})`;
```

**3. Auto-Export on Critical Errors**

Automatically export logs when critical errors occur (implement in debug.js).

---

## References

**Firefox Extension APIs:**
- [MDN: browser.downloads.download()][140][143]
- [MDN: downloads API][143][185]
- [MDN: Content Scripts][146]
- [MDN: runtime.sendMessage()][170][184]

**Context Separation:**
- [Stack Overflow: Firefox popup accessing content][171]
- [Stack Overflow: downloads API not in content scripts][144]
- [DEV: Chrome extension context separation][187]

**Implementation Examples:**
- [Calling content script from popup][170]
- [Popup to background messaging][184]

---

**END OF IMPLEMENTATION GUIDE**

This document provides complete, production-ready code for adding the Export Console Logs button to the Advanced tab of your extension's popup settings menu in v1.5.9.