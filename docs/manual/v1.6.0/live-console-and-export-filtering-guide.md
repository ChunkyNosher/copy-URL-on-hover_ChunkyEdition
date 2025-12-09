# Real-Time Console Output & Export Filtering Implementation Guide

## Purpose

This document specifies how to implement granular filtering controls for BOTH:

1. **Live console output** - What you see in the browser's DevTools console in
   real-time
2. **Exported logs** - What gets included in the .txt file when you click
   "Export Console Logs"

The solution addresses the critical issue identified: **Hover and URL Detection
events flood the console, making Quick Tab debugging difficult.**

**KEY DESIGN DECISION:** Use collapsible/dropdown checkbox menus instead of long
lists of checkboxes to save screen space and improve usability.

---

## Problem Analysis

### Current State (From Attached Logs)

Based on the provided log export
`copy-url-extension-logs_v1.6.0.7_2025-11-21T00-53-33.txt`:

**Log volume breakdown:**

- **Hover events**: ~40% of all logs (every mouseover/mouseout)
- **URL Detection events**: ~35% of all logs (multiple attempts per hover)
- **Keyboard events**: ~10% of all logs
- **Quick Tab operations**: ~8% of all logs
- **Other** (storage, errors, notifications): ~7%

**The flood problem:**

```
[Hover] [Start] Mouse entered element
[URL Detection] [Start] Detecting URL for element
[URL Detection] [Hierarchy] Element not direct link...
[URL Detection] [Hierarchy] No more parent elements...
[URL Detection] [Handler] Trying site-specific handler
[URL Detection] [Handler] Site-specific handler returned null
[URL Detection] [Fallback] Trying generic URL finder
[URL Detection] [Failure] No URL found by any method
[URL Detection] [Failure] No URL found
[Hover] [End] Mouse left element
```

**10 log lines for a single failed hover attempt** - repeated hundreds of times.

**User impact:**

- Finding Quick Tab logs requires scrolling through hundreds of hover/detection
  logs
- Console performance degrades with massive log output
- Difficult to focus on specific feature debugging
- Export files are unnecessarily large

---

## Part 1: Dual Filtering System Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    User Action                              │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
    ┌────────────────────┐
    │  Logger (Always    │
    │  Captures All)     │
    └────────┬───────────┘
             │
             ▼
    ┌────────────────────────────────────────────┐
    │  Live Console Filter                       │
    │  (Checks enabledCategoriesLive)            │
    │  - Category enabled? → console.log()       │
    │  - Category disabled? → Silent (no output) │
    └────────┬───────────────────────────────────┘
             │
             ▼
    ┌────────────────────────────────────────────┐
    │  Console Interceptor Buffer                │
    │  (Captures ALL console output)             │
    └────────┬───────────────────────────────────┘
             │
             ▼  (When user clicks Export)
    ┌────────────────────────────────────────────┐
    │  Export Filter                             │
    │  (Checks enabledCategoriesExport)          │
    │  - Category enabled? → Include in export   │
    │  - Category disabled? → Skip               │
    └────────┬───────────────────────────────────┘
             │
             ▼
       Exported .txt File
```

**Two independent filter systems:**

1. **Live Console Filter** (affects browser console in real-time)
   - Applied BEFORE logging to console
   - Categories disabled = no console.log() call = no browser overhead
   - Reduces console noise and improves performance
   - Controlled by `enabledCategoriesLive` settings

2. **Export Filter** (affects exported .txt file only)
   - Applied DURING export operation
   - Buffer ALWAYS captures all console output (whatever made it through live
     filter)
   - Categories disabled = excluded from export file
   - Allows exporting subset of what was logged
   - Controlled by `enabledCategoriesExport` settings

**Why two separate filters?**

- User might want to see Quick Tabs in console but export ALL categories for
  comprehensive debugging
- Or disable noisy Hover/URL Detection in console but still export them for
  analysis
- Independent control = maximum flexibility

---

## Part 2: UI Design - Collapsible Checkbox Groups

### Why Dropdown/Collapsible Design?

**Problem with long checkbox lists:**

- 16 categories × 2 filters = 32 checkboxes
- Takes up massive screen space in popup
- Overwhelming visual clutter
- Difficult to scan and find specific categories

**Solution: Accordion/collapsible groups**

- Categories organized into logical groups
- Groups collapsed by default
- Click/tap to expand group
- Compact, scannable interface

### UI Layout Specification

**Location:** Extension popup → Advanced tab (new) or Debug tab

**Structure:**

```
┌─────────────────────────────────────────────┐
│ Debug Settings                              │
├─────────────────────────────────────────────┤
│                                             │
│ Live Console Output Filters:                │
│ Control what appears in browser console     │
│                                             │
│ ▼ User Actions (6 categories)     [...]    │  ← Collapsed by default
│                                             │
│ ▶ System Operations (7 categories) [...]   │  ← Collapsed
│                                             │
│ ▶ Diagnostics (3 categories)       [...]   │  ← Collapsed
│                                             │
│ ───────────────────────────────────────────│
│                                             │
│ Export Log Filters:                         │
│ Control what gets included in .txt export   │
│                                             │
│ ▼ User Actions (6 categories)     [...]    │  ← Collapsed by default
│                                             │
│ ▶ System Operations (7 categories) [...]   │  ← Collapsed
│                                             │
│ ▶ Diagnostics (3 categories)       [...]   │  ← Collapsed
│                                             │
│ ───────────────────────────────────────────│
│                                             │
│ [Save Filter Settings]                      │
│                                             │
│ ───────────────────────────────────────────│
│                                             │
│ [📥 Export Console Logs]                    │
│                                             │
└─────────────────────────────────────────────┘
```

**When User Actions group is expanded:**

```
┌─────────────────────────────────────────────┐
│ ▼ User Actions (6 categories)     [↑][↓][×]│  ← Expand/Collapse controls
│   ☑ 🔍 URL Detection                        │
│   ☑ 👆 Hover Events                         │
│   ☑ 📋 Clipboard Operations                 │
│   ☑ ⌨️  Keyboard Shortcuts                  │
│   ☑ 🪟 Quick Tab Actions                    │
│   ☑ 📊 Quick Tab Manager                    │
└─────────────────────────────────────────────┘
```

**Group controls (in header):**

- **[↑]** - Select All in this group
- **[↓]** - Deselect All in this group
- **[×]** - Close/collapse group

### Category Groups

**Same 3 groups as before, used for BOTH filters:**

**User Actions:** (Most frequently logged)

- 🔍 URL Detection
- 👆 Hover Events
- 📋 Clipboard Operations
- ⌨️ Keyboard Shortcuts
- 🪟 Quick Tab Actions
- 📊 Quick Tab Manager

**System Operations:** (Internal operations)

- 📡 Event Bus
- ⚙️ Configuration
- 💾 State Management
- 💿 Browser Storage
- 💬 Message Passing
- 🌐 Web Requests
- 📑 Tab Management

**Diagnostics:** (Errors and performance)

- ⏱️ Performance
- ❌ Errors
- 🚀 Initialization

---

## Part 3: Live Console Filter Implementation

### 3.1 Storage Structure

**Where:** `browser.storage.local`

**Storage keys:**

```javascript
{
  liveConsoleCategoriesEnabled: {
    'url-detection': false,      // DISABLED - too noisy
    'hover': false,               // DISABLED - too noisy
    'clipboard': true,
    'keyboard': true,
    'quick-tabs': true,
    'quick-tab-manager': true,
    'event-bus': false,
    'config': true,
    'state': false,
    'storage': true,
    'messaging': false,
    'webrequest': true,
    'tabs': true,
    'performance': false,
    'errors': true,
    'initialization': true
  },

  exportLogCategoriesEnabled: {
    'url-detection': true,        // Export ALL by default
    'hover': true,
    'clipboard': true,
    'keyboard': true,
    'quick-tabs': true,
    'quick-tab-manager': true,
    'event-bus': true,
    'config': true,
    'state': true,
    'storage': true,
    'messaging': true,
    'webrequest': true,
    'tabs': true,
    'performance': true,
    'errors': true,
    'initialization': true
  }
}
```

**Default philosophy:**

- **Live Console**: Disable noisy categories (Hover, URL Detection) by default
- **Export**: Enable ALL categories by default (comprehensive debugging)

### 3.2 Logging Wrapper Integration

**Where:** `src/utils/logger.js`

**Current logging wrappers need modification:**

```javascript
// BEFORE (from previous guide)
export function logVerbose(category, action, message, context = {}) {
  if (!shouldLogVerbose()) {
    return; // Skip in normal mode
  }

  const categoryName = getCategoryDisplayName(category);
  const formattedMessage = `[${categoryName}] [${action}] ${message}`;

  console.log(formattedMessage, {
    ...context,
    _logCategory: category,
    _logAction: action,
    timestamp: Date.now()
  });
}

// AFTER (with live console filtering)
export function logVerbose(category, action, message, context = {}) {
  // Check verbosity mode first
  if (!shouldLogVerbose()) {
    return;
  }

  // NEW: Check if category enabled for live console output
  if (!isCategoryEnabledForLiveConsole(category)) {
    return; // Silent - don't log to console
  }

  const categoryName = getCategoryDisplayName(category);
  const formattedMessage = `[${categoryName}] [${action}] ${message}`;

  console.log(formattedMessage, {
    ...context,
    _logCategory: category,
    _logAction: action,
    timestamp: Date.now()
  });
}
```

**New filter check function:**

```javascript
/**
 * Check if category should be logged to live console
 * @param {string} category - Category ID (e.g., 'url-detection')
 * @returns {boolean} - True if should log, false if should skip
 */
function isCategoryEnabledForLiveConsole(category) {
  // Get live console filter settings from storage
  const settings = getLiveConsoleSettings();

  // Default to true if category not in settings (fail-safe)
  if (!(category in settings)) {
    return true;
  }

  return settings[category] === true;
}

/**
 * Get live console filter settings (cached for performance)
 */
let liveConsoleSettingsCache = null;

function getLiveConsoleSettings() {
  // Return cached settings if available
  if (liveConsoleSettingsCache !== null) {
    return liveConsoleSettingsCache;
  }

  // Load from storage synchronously (using cached ConfigManager)
  // This assumes ConfigManager.getCurrentConfig() is synchronous
  const config = ConfigManager.getCurrentConfig();

  if (config.liveConsoleCategoriesEnabled) {
    liveConsoleSettingsCache = config.liveConsoleCategoriesEnabled;
  } else {
    // Use defaults if not set
    liveConsoleSettingsCache = getDefaultLiveConsoleSettings();
  }

  return liveConsoleSettingsCache;
}

/**
 * Clear cache when settings change
 */
export function refreshLiveConsoleSettings() {
  liveConsoleSettingsCache = null;
}

/**
 * Default live console filter settings
 */
function getDefaultLiveConsoleSettings() {
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

**Apply to ALL logging functions:**

Modify `logNormal()`, `logVerbose()`, `logError()`, `logWarn()`,
`logPerformance()` to include category check:

```javascript
export function logNormal(category, action, message, context = {}) {
  // NEW: Check live console filter
  if (!isCategoryEnabledForLiveConsole(category)) {
    return;
  }

  const categoryName = getCategoryDisplayName(category);
  const formattedMessage = `[${categoryName}] [${action}] ${message}`;

  console.log(formattedMessage, {
    ...context,
    _logCategory: category,
    _logAction: action,
    timestamp: Date.now()
  });
}

export function logError(category, action, message, context = {}) {
  // NEW: Check live console filter
  if (!isCategoryEnabledForLiveConsole(category)) {
    return;
  }

  // Errors always use console.error
  const categoryName = getCategoryDisplayName(category);
  const formattedMessage = `[${categoryName}] [${action}] ${message}`;

  console.error(formattedMessage, {
    ...context,
    _logCategory: category,
    _logAction: action,
    timestamp: Date.now()
  });
}

// ... same for logWarn, logPerformance
```

### 3.3 Dynamic Settings Changes

**When user changes live console filter settings:**

1. Settings saved to `browser.storage.local`
2. Cache cleared: `refreshLiveConsoleSettings()`
3. New logs respect new settings immediately
4. Existing console logs remain (can't remove them)
5. User can clear console manually if desired

**Implementation:**

```javascript
// In popup settings script
async function saveLiveConsoleFilters() {
  const filters = getLiveConsoleFilterState(); // Read from UI

  await browser.storage.local.set({
    liveConsoleCategoriesEnabled: filters
  });

  // Notify content scripts to refresh cache
  const tabs = await browser.tabs.query({});
  tabs.forEach(tab => {
    browser.tabs
      .sendMessage(tab.id, {
        action: 'REFRESH_LIVE_CONSOLE_FILTERS'
      })
      .catch(() => {
        // Tab might not have content script
      });
  });

  showSaveConfirmation('Live console filters updated');
}
```

**In content script message listener:**

```javascript
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'REFRESH_LIVE_CONSOLE_FILTERS') {
    refreshLiveConsoleSettings();
    console.log('[Copy-URL-on-Hover] Live console filters refreshed');
    sendResponse({ success: true });
  }
});
```

---

## Part 4: Export Filter Implementation

### 4.1 Storage Structure

**Already covered in Part 3.1** - `exportLogCategoriesEnabled` object

**Default: ALL categories enabled for export**

### 4.2 Export Filtering Logic

**Where:** Popup export handler

**Current export flow:**

```
Click Export → Get all logs → Download .txt
```

**New export flow:**

```
Click Export → Get all logs → Apply export category filters → Download filtered .txt
```

**Filtering function:**

```javascript
/**
 * Filter logs by export category settings
 * @param {Array} allLogs - All captured console logs
 * @param {Object} enabledCategories - Export filter settings
 * @returns {Array} - Filtered logs
 */
function filterLogsByExportCategories(allLogs, enabledCategories) {
  return allLogs.filter(logEntry => {
    // Extract category from log message
    const category = extractCategoryFromLog(logEntry);

    // Always include uncategorized logs (fail-safe)
    if (category === 'uncategorized') {
      return true;
    }

    // Check if category is enabled for export
    return enabledCategories[category] === true;
  });
}

/**
 * Extract category ID from log entry
 * Parses [Category Display Name] from log message
 */
function extractCategoryFromLog(logEntry) {
  const message = logEntry.message || '';

  // Match pattern: [Category Display Name] [Action] Message
  const match = message.match(/^\[([^\]]+)\]/);

  if (!match) {
    return 'uncategorized';
  }

  const displayName = match[1];

  // Map display name to category ID
  return getCategoryIdFromDisplayName(displayName);
}

/**
 * Map display name to category ID
 * Same function from log-verbosity-and-filtered-export-guide.md
 */
function getCategoryIdFromDisplayName(displayName) {
  const normalized = displayName.trim().toLowerCase();

  const mapping = {
    'url detection': 'url-detection',
    hover: 'hover',
    'hover events': 'hover',
    clipboard: 'clipboard',
    'clipboard operations': 'clipboard',
    keyboard: 'keyboard',
    'keyboard shortcuts': 'keyboard',
    'quick tabs': 'quick-tabs',
    'quick tab actions': 'quick-tabs',
    'quick tab manager': 'quick-tab-manager',
    'event bus': 'event-bus',
    config: 'config',
    configuration: 'config',
    state: 'state',
    'state management': 'state',
    storage: 'storage',
    'browser storage': 'storage',
    messaging: 'messaging',
    'message passing': 'messaging',
    webrequest: 'webrequest',
    'web requests': 'webrequest',
    tabs: 'tabs',
    'tab management': 'tabs',
    performance: 'performance',
    errors: 'errors',
    initialization: 'initialization',
    debug: 'quick-tabs', // Map [DEBUG] tags to appropriate category
    quicktabsmanager: 'quick-tab-manager',
    createhandler: 'quick-tabs',
    quicktabwindow: 'quick-tabs',
    broadcastmanager: 'quick-tabs',
    notificationmanager: 'clipboard',
    tooltip: 'clipboard'
  };

  return mapping[normalized] || 'uncategorized';
}
```

**Enhanced export function:**

```javascript
async function exportFilteredLogs() {
  try {
    // Get all captured logs from console interceptor
    const allLogs = await getAllLogsFromExtension();

    // Get export filter settings
    const exportFilters = await browser.storage.local.get(
      'exportLogCategoriesEnabled'
    );
    const enabledCategories =
      exportFilters.exportLogCategoriesEnabled || getAllCategoriesEnabled();

    // Apply export filters
    const filteredLogs = filterLogsByExportCategories(
      allLogs,
      enabledCategories
    );

    // Generate metadata showing what was filtered
    const metadata = generateExportMetadata(
      allLogs.length,
      filteredLogs.length,
      enabledCategories
    );

    // Format for export
    const exportContent = formatLogsForExport(metadata, filteredLogs);

    // Download file
    downloadLogsFile(exportContent);

    // Show success message
    showExportSuccess(filteredLogs.length, allLogs.length);
  } catch (error) {
    console.error('[Export] Failed to export logs:', error);
    showExportError(error.message);
  }
}

function showExportSuccess(exportedCount, totalCount) {
  const percentage = ((exportedCount / totalCount) * 100).toFixed(1);
  alert(
    `Exported ${exportedCount.toLocaleString()} of ${totalCount.toLocaleString()} logs (${percentage}%)`
  );
}
```

### 4.3 Export Metadata Enhancement

**Add filter summary to export file header:**

```
===================================
Copy-URL-on-Hover Extension Logs
Exported: 2025-11-21 01:15:45
Extension Version: 1.6.0.7
===================================

LIVE CONSOLE FILTERS (what was logged):
✗ URL Detection (disabled in console)
✗ Hover Events (disabled in console)
✓ Clipboard Operations
✓ Keyboard Shortcuts
✓ Quick Tab Actions
✓ Quick Tab Manager
✗ Event Bus (disabled in console)
✓ Configuration
✗ State Management (disabled in console)
✓ Browser Storage
✗ Message Passing (disabled in console)
✓ Web Requests
✓ Tab Management
✗ Performance (disabled in console)
✓ Errors
✓ Initialization

EXPORT FILTERS (applied to this file):
✓ URL Detection (included)
✓ Hover Events (included)
✓ Clipboard Operations
✓ Keyboard Shortcuts
✓ Quick Tab Actions
✓ Quick Tab Manager
✗ Event Bus (excluded from export)
✓ Configuration
✗ State Management (excluded from export)
✓ Browser Storage
✗ Message Passing (excluded from export)
✓ Web Requests
✓ Tab Management
✗ Performance (excluded from export)
✓ Errors
✓ Initialization

NOTE: URL Detection and Hover Events logs are NOT present
because they were disabled in live console at log time.
To capture these logs, enable them in Live Console Filters.

Total logs captured: 234
Logs in export: 234 (100.0%)
(No logs filtered out - all captured logs included)

===================================
BEGIN LOGS
===================================
```

**Key insight for users:** Export filter can only work with what was captured.
If Hover was disabled in live console, those logs don't exist to export.

---

## Part 5: Collapsible UI Implementation

### 5.1 HTML Structure

**Use accordion/collapsible pattern with checkboxes:**

```html
<!-- Live Console Filters Section -->
<div class="filter-section">
  <h3>Live Console Output Filters</h3>
  <p class="filter-description">
    Control what appears in browser console in real-time
  </p>

  <!-- User Actions Group -->
  <div class="filter-group">
    <input type="checkbox" id="live-group-user-actions" class="group-toggle" />
    <label for="live-group-user-actions" class="group-header">
      <span class="group-icon">▶</span>
      <span class="group-title">User Actions</span>
      <span class="group-count">(6 categories)</span>
      <div class="group-actions">
        <button class="group-btn" data-action="select-all">↑</button>
        <button class="group-btn" data-action="deselect-all">↓</button>
      </div>
    </label>

    <div class="group-content">
      <label class="category-label">
        <input
          type="checkbox"
          class="category-checkbox"
          data-category="url-detection"
          data-filter="live"
        />
        <span class="category-icon">🔍</span>
        <span class="category-name">URL Detection</span>
      </label>

      <label class="category-label">
        <input
          type="checkbox"
          class="category-checkbox"
          data-category="hover"
          data-filter="live"
        />
        <span class="category-icon">👆</span>
        <span class="category-name">Hover Events</span>
      </label>

      <label class="category-label">
        <input
          type="checkbox"
          class="category-checkbox"
          data-category="clipboard"
          data-filter="live"
        />
        <span class="category-icon">📋</span>
        <span class="category-name">Clipboard Operations</span>
      </label>

      <label class="category-label">
        <input
          type="checkbox"
          class="category-checkbox"
          data-category="keyboard"
          data-filter="live"
        />
        <span class="category-icon">⌨️</span>
        <span class="category-name">Keyboard Shortcuts</span>
      </label>

      <label class="category-label">
        <input
          type="checkbox"
          class="category-checkbox"
          data-category="quick-tabs"
          data-filter="live"
        />
        <span class="category-icon">🪟</span>
        <span class="category-name">Quick Tab Actions</span>
      </label>

      <label class="category-label">
        <input
          type="checkbox"
          class="category-checkbox"
          data-category="quick-tab-manager"
          data-filter="live"
        />
        <span class="category-icon">📊</span>
        <span class="category-name">Quick Tab Manager</span>
      </label>
    </div>
  </div>

  <!-- System Operations Group -->
  <div class="filter-group">
    <input type="checkbox" id="live-group-system-ops" class="group-toggle" />
    <label for="live-group-system-ops" class="group-header">
      <span class="group-icon">▶</span>
      <span class="group-title">System Operations</span>
      <span class="group-count">(7 categories)</span>
      <div class="group-actions">
        <button class="group-btn" data-action="select-all">↑</button>
        <button class="group-btn" data-action="deselect-all">↓</button>
      </div>
    </label>

    <div class="group-content">
      <!-- 7 category checkboxes here -->
    </div>
  </div>

  <!-- Diagnostics Group -->
  <div class="filter-group">
    <input type="checkbox" id="live-group-diagnostics" class="group-toggle" />
    <label for="live-group-diagnostics" class="group-header">
      <span class="group-icon">▶</span>
      <span class="group-title">Diagnostics</span>
      <span class="group-count">(3 categories)</span>
      <div class="group-actions">
        <button class="group-btn" data-action="select-all">↑</button>
        <button class="group-btn" data-action="deselect-all">↓</button>
      </div>
    </label>

    <div class="group-content">
      <!-- 3 category checkboxes here -->
    </div>
  </div>
</div>

<hr />

<!-- Export Filters Section (same structure) -->
<div class="filter-section">
  <h3>Export Log Filters</h3>
  <p class="filter-description">Control what gets included in .txt export</p>

  <!-- Same 3 groups, but with data-filter="export" -->
</div>

<div class="filter-actions">
  <button id="save-filter-settings" class="btn-primary">
    Save Filter Settings
  </button>
  <button id="reset-filters-live" class="btn-secondary">
    Reset Live Filters
  </button>
  <button id="reset-filters-export" class="btn-secondary">
    Reset Export Filters
  </button>
</div>

<hr />

<button id="export-logs-btn" class="btn-export">📥 Export Console Logs</button>
```

### 5.2 CSS Styling

**Collapsible accordion behavior:**

```css
/* Filter Section */
.filter-section {
  margin-bottom: 24px;
}

.filter-description {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-bottom: 12px;
}

/* Filter Group */
.filter-group {
  margin-bottom: 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-base);
  overflow: hidden;
}

/* Hide the toggle checkbox */
.group-toggle {
  display: none;
}

/* Group Header (clickable) */
.group-header {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  background-color: var(--color-secondary);
  cursor: pointer;
  user-select: none;
  transition: background-color 0.2s;
}

.group-header:hover {
  background-color: var(--color-secondary-hover);
}

.group-icon {
  width: 16px;
  margin-right: 8px;
  transition: transform 0.2s;
}

/* Rotate icon when expanded */
.group-toggle:checked ~ .group-header .group-icon {
  transform: rotate(90deg);
}

.group-title {
  font-weight: var(--font-weight-semibold);
  flex: 1;
}

.group-count {
  font-size: 11px;
  color: var(--color-text-secondary);
  margin-right: 8px;
}

.group-actions {
  display: flex;
  gap: 4px;
}

.group-btn {
  width: 24px;
  height: 24px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background-color: transparent;
  color: var(--color-text);
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.group-btn:hover {
  background-color: var(--color-secondary-hover);
}

/* Group Content (collapsible) */
.group-content {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.3s ease-out;
  background-color: var(--color-surface);
}

/* Expand when toggle is checked */
.group-toggle:checked ~ .group-content {
  max-height: 500px; /* Large enough for content */
  padding: 8px 12px;
}

/* Category Checkboxes */
.category-label {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: background-color 0.2s;
}

.category-label:hover {
  background-color: var(--color-secondary);
}

.category-checkbox {
  margin-right: 8px;
}

.category-icon {
  width: 20px;
  margin-right: 8px;
  font-size: 16px;
}

.category-name {
  flex: 1;
  font-size: 13px;
}

/* Filter Actions */
.filter-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.btn-export {
  width: 100%;
  padding: 12px;
  font-size: 16px;
}
```

### 5.3 JavaScript Implementation

**Collapsible group handling:**

```javascript
// Initialize collapsible groups
function initCollapsibleGroups() {
  // Handle group toggle
  document.querySelectorAll('.group-toggle').forEach(toggle => {
    toggle.addEventListener('change', e => {
      // Collapsing/expanding is handled by CSS
      // Could add animation or analytics here
    });
  });

  // Handle group action buttons (Select All / Deselect All)
  document.querySelectorAll('.group-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation(); // Prevent triggering group toggle

      const action = btn.dataset.action;
      const groupContent = btn
        .closest('.filter-group')
        .querySelector('.group-content');
      const checkboxes = groupContent.querySelectorAll('.category-checkbox');

      if (action === 'select-all') {
        checkboxes.forEach(cb => (cb.checked = true));
      } else if (action === 'deselect-all') {
        checkboxes.forEach(cb => (cb.checked = false));
      }
    });
  });
}

// Load filter settings from storage
async function loadFilterSettings() {
  const result = await browser.storage.local.get([
    'liveConsoleCategoriesEnabled',
    'exportLogCategoriesEnabled'
  ]);

  const liveSettings =
    result.liveConsoleCategoriesEnabled || getDefaultLiveConsoleSettings();
  const exportSettings =
    result.exportLogCategoriesEnabled || getDefaultExportSettings();

  // Apply to checkboxes
  document
    .querySelectorAll('.category-checkbox[data-filter="live"]')
    .forEach(cb => {
      const category = cb.dataset.category;
      cb.checked = liveSettings[category] === true;
    });

  document
    .querySelectorAll('.category-checkbox[data-filter="export"]')
    .forEach(cb => {
      const category = cb.dataset.category;
      cb.checked = exportSettings[category] === true;
    });
}

// Save filter settings to storage
async function saveFilterSettings() {
  const liveSettings = {};
  const exportSettings = {};

  // Read live filter checkboxes
  document
    .querySelectorAll('.category-checkbox[data-filter="live"]')
    .forEach(cb => {
      liveSettings[cb.dataset.category] = cb.checked;
    });

  // Read export filter checkboxes
  document
    .querySelectorAll('.category-checkbox[data-filter="export"]')
    .forEach(cb => {
      exportSettings[cb.dataset.category] = cb.checked;
    });

  // Save to storage
  await browser.storage.local.set({
    liveConsoleCategoriesEnabled: liveSettings,
    exportLogCategoriesEnabled: exportSettings
  });

  // Notify content scripts to refresh live filter cache
  await refreshLiveConsoleFiltersInAllTabs();

  showSaveConfirmation();
}

async function refreshLiveConsoleFiltersInAllTabs() {
  const tabs = await browser.tabs.query({});

  for (const tab of tabs) {
    try {
      await browser.tabs.sendMessage(tab.id, {
        action: 'REFRESH_LIVE_CONSOLE_FILTERS'
      });
    } catch (error) {
      // Tab might not have content script loaded
    }
  }
}

// Reset filters to defaults
async function resetLiveFilters() {
  const defaults = getDefaultLiveConsoleSettings();

  document
    .querySelectorAll('.category-checkbox[data-filter="live"]')
    .forEach(cb => {
      cb.checked = defaults[cb.dataset.category] === true;
    });
}

async function resetExportFilters() {
  const defaults = getDefaultExportSettings();

  document
    .querySelectorAll('.category-checkbox[data-filter="export"]')
    .forEach(cb => {
      cb.checked = defaults[cb.dataset.category] === true;
    });
}

// Initialize on popup load
document.addEventListener('DOMContentLoaded', async () => {
  initCollapsibleGroups();
  await loadFilterSettings();

  document
    .getElementById('save-filter-settings')
    .addEventListener('click', saveFilterSettings);
  document
    .getElementById('reset-filters-live')
    .addEventListener('click', resetLiveFilters);
  document
    .getElementById('reset-filters-export')
    .addEventListener('click', resetExportFilters);
  document
    .getElementById('export-logs-btn')
    .addEventListener('click', exportFilteredLogs);
});
```

---

## Part 6: User Workflows

### 6.1 Debugging Quick Tabs (Main Use Case)

**Problem:** Hover/URL Detection logs flood console, hiding Quick Tab logs

**Solution:**

1. Open extension popup → Advanced/Debug tab
2. Expand "User Actions" group in **Live Console Filters**
3. **Uncheck** "🔍 URL Detection"
4. **Uncheck** "👆 Hover Events"
5. Click "Save Filter Settings"
6. Console now shows ONLY:
   - Quick Tab actions
   - Keyboard shortcuts
   - Clipboard operations
   - System operations
   - Errors
7. Much cleaner debugging experience!

**Export considerations:**

- Export filters still have Hover/URL Detection enabled
- If user wants comprehensive export: keep export filters at defaults
- If user wants focused Quick Tab export: disable Hover/URL Detection in export
  filters too

### 6.2 Comprehensive Debugging (All Events)

**Scenario:** Developer wants to see EVERYTHING for deep debugging

**Steps:**

1. Expand all groups in **Live Console Filters**
2. Click "Select All" (↑) button in each group header
3. Save settings
4. Console now shows all categories
5. Use browser console's built-in filter if needed

### 6.3 Clean Console + Comprehensive Export

**Scenario:** User wants clean console during use, but comprehensive export for
bug reports

**Steps:**

1. **Live Console Filters**: Disable noisy categories (Hover, URL Detection,
   Performance, State)
2. **Export Filters**: Enable ALL categories
3. Save settings
4. Console remains clean during use
5. When exporting for bug report: full diagnostic data available

**Note:** Export will only include what was logged. If Hover was disabled in
live console, those logs don't exist to export.

**Workaround:** If comprehensive export needed, temporarily enable all live
filters, reproduce issue, then export.

### 6.4 Export Focused Subset

**Scenario:** Exporting logs to developer, want to hide sensitive categories

**Steps:**

1. Keep live filters as desired
2. In **Export Filters**:
   - Disable "💬 Message Passing" (might contain URLs)
   - Disable "💿 Browser Storage" (might contain data)
   - Disable "⚙️ Configuration" (user settings privacy)
3. Save and export
4. Exported file excludes sensitive categories

---

## Part 7: Performance Considerations

### 7.1 Live Console Filter Performance Impact

**Disabling categories improves performance:**

**Before (all categories enabled):**

- Every mousemove: 10+ console.log() calls (Hover + URL Detection)
- 100 mousemoves = 1000+ console operations
- Console becomes sluggish

**After (Hover/URL Detection disabled):**

- Mousemoves: 0 console operations
- Only actual user actions logged (keyboard, clicks, Quick Tabs)
- Console stays responsive

**Memory impact:**

- Console has limited buffer (browser-dependent)
- Fewer logs = more history retained
- Less garbage collection overhead

### 7.2 Export Filter Performance

**Minimal impact:**

- Filtering happens once during export operation
- Processing 1000 logs: ~50ms
- Processing 10000 logs: ~200ms
- Negligible compared to file download time

### 7.3 Settings Cache Performance

**Live filter checks are cached:**

- First load: read from storage
- Subsequent logs: read from memory cache
- Negligible overhead per log statement

**Cache invalidation:**

- Only when user saves new settings
- Propagated via message passing
- No polling or constant re-reads

---

## Part 8: Migration & Backwards Compatibility

### 8.1 Existing Logs

**Existing code with console.log():**

- Still works (console interceptor captures)
- Not filtered by live console filter (bypass mechanism)
- Included in export

**Migration path:**

1. Replace console.log() with logNormal/logVerbose wrappers
2. Assign appropriate category
3. Logs now respect filter settings

### 8.2 Default Behavior

**For new users (fresh install):**

- Live console: Noisy categories disabled (Hover, URL Detection)
- Export: All categories enabled
- Clean console experience out of box

**For existing users (upgrade):**

- Check if settings exist in storage
- If not: use defaults above
- If yes: preserve user's choices
- No breaking changes

---

## Part 9: Testing & Validation

### 9.1 Testing Checklist

**Live Console Filtering:**

- [ ] Disable Hover in live filter → No hover logs in console
- [ ] Enable Hover in live filter → Hover logs appear in console
- [ ] Change setting without reload → New logs respect new setting
- [ ] Multiple tabs → Settings apply to all tabs after save

**Export Filtering:**

- [ ] Disable category in export filter → Category excluded from .txt
- [ ] Enable category in export filter → Category included in .txt
- [ ] Export metadata shows correct filter state
- [ ] Uncategorized logs always exported
- [ ] Count summary accurate (filtered vs total)

**Collapsible UI:**

- [ ] Groups collapsed by default
- [ ] Click to expand/collapse works
- [ ] Select All button checks all in group
- [ ] Deselect All button unchecks all in group
- [ ] Checkboxes persist after collapse/expand
- [ ] Save button persists all settings

**Edge Cases:**

- [ ] Empty log buffer exports cleanly
- [ ] All categories disabled → Still exports uncategorized
- [ ] Malformed log messages don't break filtering
- [ ] Settings survive browser restart
- [ ] Settings survive extension reload

### 9.2 User Acceptance Testing

**Scenario: Debug Quick Tabs**

1. User complains: "Console too noisy, can't find Quick Tab logs"
2. Disable Hover + URL Detection in live filters
3. Console now clean, Quick Tab logs visible
4. ✓ Success

**Scenario: Bug Report Export**

1. User reproduces bug with all categories enabled
2. Export logs with all categories in export filter
3. Developer receives comprehensive diagnostic file
4. ✓ Success

**Scenario: Privacy-Conscious Export**

1. User wants to share logs but hide URLs
2. Disable relevant categories in export filter only
3. Export excludes sensitive data
4. ✓ Success

---

## Part 10: Documentation Requirements

### 10.1 User Documentation (README)

**Add section: "Debug Console Filtering"**

**Live Console Filters:**

Control what appears in your browser's DevTools console in real-time:

- **Why use this?** Hover and URL Detection events can flood the console with
  hundreds of logs, making it difficult to find Quick Tab or error logs.

- **Recommended settings for debugging Quick Tabs:**
  - ✗ Disable "URL Detection"
  - ✗ Disable "Hover Events"
  - ✓ Enable everything else

- **How to configure:**
  1. Click extension icon → Advanced/Debug tab
  2. Find "Live Console Output Filters"
  3. Expand category groups
  4. Check/uncheck categories
  5. Click "Save Filter Settings"
  6. Changes apply immediately to new logs

**Export Log Filters:**

Control what gets included in the exported .txt file:

- **Default:** All categories enabled (comprehensive debugging)
- **Use case:** Export focused subset for specific issue analysis
- **Note:** Export can only include logs that were actually logged. If a
  category was disabled in Live Console Filters, those logs don't exist to
  export.

**Tips:**

- Use Live Filters to keep console clean during normal use
- Use Export Filters to control what goes in bug reports
- Reset buttons restore recommended defaults

### 10.2 Developer Documentation

**Add to `docs/logging-system.md`:**

**Live Console Filtering:**

The logging system supports real-time filtering of console output to reduce
noise:

- Implemented in `src/utils/logger.js`
- Category check before console.log() call
- Settings cached for performance
- Cache invalidated on settings change

**How it works:**

```javascript
logVerbose('url-detection', 'Start', 'Detecting URL', context);
  ↓
isCategoryEnabledForLiveConsole('url-detection')
  ↓
  false → return (no console output)
  true → console.log(...)
```

**Adding new categories:**

1. Add to LOG_CATEGORIES in logger.js
2. Add to default settings in getDefaultLiveConsoleSettings()
3. Add checkbox to popup UI
4. Document in user guide

**Performance:**

- Filter check is O(1) dictionary lookup
- Settings cached in memory
- Minimal overhead per log statement

---

## Part 11: Implementation Priority

### Phase 1: Core Filtering (Week 1)

1. Implement live console filter check in logger.js
2. Add liveConsoleCategoriesEnabled storage
3. Implement cache and refresh mechanism
4. Test with Hover/URL Detection disabled

### Phase 2: Export Enhancement (Week 1)

1. Implement export filter logic
2. Enhance export metadata with filter summary
3. Add category detection improvements
4. Test export with various filter combinations

### Phase 3: UI Implementation (Week 2)

1. Create collapsible group HTML structure
2. Implement CSS styling
3. Add JavaScript for collapse/expand
4. Implement Select All / Deselect All
5. Wire up save/load functions

### Phase 4: Integration & Testing (Week 2)

1. Connect UI to storage
2. Implement message passing for filter refresh
3. Add reset buttons
4. Comprehensive testing
5. User acceptance testing

### Phase 5: Documentation & Polish (Week 3)

1. Write user documentation
2. Update developer docs
3. Add tooltips to UI
4. Performance validation
5. Final bug fixes

---

## Conclusion

This implementation provides granular, independent control over both live
console output and exported logs using space-efficient collapsible checkbox
groups.

**Key Benefits:**

1. **Solves the flooding problem:** Disable noisy Hover/URL Detection in console
2. **Maintains debugging capability:** Export can still include all categories
   (if they were logged)
3. **Independent control:** Live vs Export filters serve different purposes
4. **Space-efficient UI:** Collapsible groups vs long checkbox lists
5. **Performance optimized:** Filter checks before console.log() = less overhead
6. **Flexible workflows:** Clean console + comprehensive export, or focused
   debugging

**Critical Design Decisions:**

- **Two separate filters** for live console vs export (maximum flexibility)
- **Collapsible groups** instead of long lists (better UX)
- **Category check before logging** (performance optimization)
- **Export can only filter what exists** (educate users about this limitation)
- **Sensible defaults** (disable noisy categories in live, enable all in export)

**Expected User Outcomes:**

- Developers can debug Quick Tabs without console noise
- Clean console during development
- Comprehensive exports for bug reports
- Privacy-conscious exports when sharing
- Improved console performance
- Better debugging experience overall
