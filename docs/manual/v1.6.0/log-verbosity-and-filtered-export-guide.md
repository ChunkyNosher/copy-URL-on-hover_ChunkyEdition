# Log Verbosity Control & Filtered Export Implementation Guide

## Purpose

This document specifies how to implement a two-tier logging system with verbosity control and category-based filtered export for the Copy-URL-on-Hover extension. The system will allow users to:

1. **Toggle between verbose and non-verbose logging modes** (controlling what gets logged)
2. **Export filtered logs by category** (controlling what gets exported)

**CRITICAL DESIGN PRINCIPLE:** The logger ALWAYS captures ALL events regardless of export filter settings. Export filters ONLY control what appears in the exported file, NOT what gets captured.

---

## Part 1: System Architecture Overview

### Two-Layer Filtering System

```
User Action → Logger (Captures Everything) → Verbosity Filter → Console Interceptor Buffer
                                                                          ↓
                                                          Export Filter (Category Selection)
                                                                          ↓
                                                                  Exported Log File
```

**Layer 1: Verbosity Filter** (affects what gets logged to console)

- **Non-Verbose Mode** (Default/Current): Only essential operations logged
- **Verbose Mode** (After implementing enhanced-logging-implementation-guide.md): All detailed diagnostic logs

**Layer 2: Export Filter** (affects what appears in exported file)

- Category-based filtering (URL Detection, Quick Tabs, Clipboard, Keyboard, etc.)
- Always captures everything to buffer
- Filters ONLY during export operation

### Design Rationale

**Why separate verbosity and export filters?**

1. **Performance**: Non-verbose mode reduces console output overhead in production
2. **Debugging flexibility**: Users can enable verbose when troubleshooting specific issues
3. **Export completeness**: Buffer always has full diagnostic data available
4. **User control**: Different users have different needs (developers vs end-users)

---

## Part 2: Verbosity Control Implementation

### 2.1 Configuration Structure

**Where:** `src/core/config.js` - Add to `DEFAULT_CONFIG`

**Add new configuration option:**

```
logVerbosity: 'normal'  // Options: 'normal' or 'verbose'
```

**Configuration schema:**

- `'normal'`: Non-verbose mode (current logging level)
  - Essential operations only
  - Quick Tab CRUD
  - Errors and warnings
  - User-facing actions (copy, open tab)
  - Critical state changes

- `'verbose'`: Verbose mode (enhanced logging from enhanced-logging-implementation-guide.md)
  - Everything from normal mode
  - PLUS all detailed logs:
    - Hover lifecycle with element details
    - URL detection process step-by-step
    - Keyboard shortcut matching
    - Clipboard API details
    - Event bus emissions
    - State management changes
    - Performance timing
    - Platform-specific handler details

### 2.2 Logging Wrapper Functions

**Where:** Create new file `src/utils/logger.js`

**Purpose:** Centralized logging functions that respect verbosity settings

**Core logging functions to create:**

1. **`logNormal(category, action, message, context)`**
   - Always logs (both modes)
   - Used for essential operations
   - Examples: Quick Tab created, URL copied, error occurred

2. **`logVerbose(category, action, message, context)`**
   - Only logs in verbose mode
   - Used for detailed diagnostics
   - Examples: Hover started, URL detection attempt, shortcut matching

3. **`logError(category, action, message, context)`**
   - Always logs (both modes)
   - Uses console.error
   - Critical failures and exceptions

4. **`logWarn(category, action, message, context)`**
   - Always logs (both modes)
   - Uses console.warn
   - Non-critical issues and edge cases

5. **`logPerformance(category, action, message, context)`**
   - Only logs in verbose mode
   - Performance timing and metrics
   - Helps identify slow operations

**Function signature structure:**

```javascript
/**
 * category: String - Log category (see Part 3 for categories)
 * action: String - Action tag ([Start], [Success], [Failure], etc.)
 * message: String - Human-readable description
 * context: Object - Additional context data
 */
logNormal(category, action, message, (context = {}));
```

**Implementation approach:**

- Check current verbosity setting from ConfigManager
- Format log message using standard format: `[Category] [Action] Message`
- Add timestamp to context object
- Call appropriate console method (log, error, warn, info)
- Console interceptor automatically captures output

### 2.3 Verbosity Check Logic

**Core verbosity check function:**

```javascript
function shouldLogVerbose() {
  // Get current config
  const config = ConfigManager.getCurrentConfig();
  return config.logVerbosity === 'verbose';
}
```

**Usage in logging functions:**

```javascript
function logVerbose(category, action, message, context = {}) {
  // Only log if verbose mode enabled
  if (!shouldLogVerbose()) {
    return;
  }

  // Format and log
  const formattedMessage = `[${category}] [${action}] ${message}`;
  console.log(formattedMessage, {
    ...context,
    timestamp: Date.now()
  });
}
```

### 2.4 Migration Strategy for Existing Logs

**Phase 1: Identify existing log statements**

- All current `console.log()` calls remain as "normal" logs
- They continue working exactly as before

**Phase 2: Replace with wrapper functions**

- Replace `console.log()` with `logNormal()` for essential logs
- Add new `logVerbose()` calls for enhanced logging (from guide)
- Replace `console.error()` with `logError()`
- Replace `console.warn()` with `logWarn()`

**Example migration:**

```javascript
// BEFORE (current code)
console.log('[Quick Tab] Created:', url);

// AFTER (with logging wrapper)
logNormal('Quick Tabs', 'Created', 'Quick Tab created successfully', {
  url: url,
  id: quickTabId,
  position: { left, top }
});
```

**Example new verbose log:**

```javascript
// NEW verbose log (not in current code)
logVerbose('URL Detection', 'Start', 'Starting URL detection for element', {
  domainType: domainType,
  elementTag: element.tagName,
  elementClasses: Array.from(element.classList)
});
```

### 2.5 Settings UI for Verbosity Control

**Where:** Extension popup settings (Debug section)

**Add UI control:**

- Radio button or toggle switch
- Label: "Log Verbosity"
- Options:
  - ○ Normal (Essential logs only)
  - ○ Verbose (Detailed diagnostic logs)
- Default: Normal
- Description text: "Verbose mode logs detailed diagnostic information useful for troubleshooting. May impact performance."

**Settings persistence:**

- Store in `browser.storage.sync` as part of config
- Sync across devices
- Persists across browser restarts

**Dynamic switching:**

- User can toggle verbosity without reloading extension
- New setting takes effect immediately for new logs
- Existing logs in buffer remain unchanged

---

## Part 3: Log Categories Definition

### 3.1 Category Taxonomy

**Define standard log categories aligned with enhanced-logging-implementation-guide.md:**

| Category ID         | Display Name         | Description                           | Examples                                                |
| ------------------- | -------------------- | ------------------------------------- | ------------------------------------------------------- |
| `url-detection`     | URL Detection        | URL finding and handler operations    | Handler matching, selector checks, URL extraction       |
| `hover`             | Hover Events         | Hover lifecycle and element tracking  | Hover start/end, element context, duration              |
| `clipboard`         | Clipboard Operations | Copy URL/text actions and API calls   | Copy attempts, API selection, success/failure           |
| `keyboard`          | Keyboard Shortcuts   | Shortcut detection and execution      | Key events, matching process, handler invocation        |
| `quick-tabs`        | Quick Tab Actions    | Quick Tab CRUD operations             | Create, update, delete, minimize, restore               |
| `quick-tab-manager` | Quick Tab Manager    | Panel operations and interactions     | Toggle panel, list updates, user interactions           |
| `event-bus`         | Event Bus            | Event emissions and handler execution | Event emitted, listeners notified, propagation          |
| `config`            | Configuration        | Settings load/change operations       | Config load, setting changes, validation                |
| `state`             | State Management     | State changes and access              | State updates, batch changes, critical state            |
| `storage`           | Browser Storage      | Storage read/write operations         | Storage get/set, sync events, quota                     |
| `messaging`         | Message Passing      | Inter-script communication            | Background ↔ Content messaging, message routing        |
| `webrequest`        | Web Requests         | WebRequest API operations             | Header modifications, iframe loading, request lifecycle |
| `tabs`              | Tab Management       | Browser tab operations                | Tab created, activated, closed, updated                 |
| `performance`       | Performance          | Timing and metrics                    | Operation duration, slow operations, benchmarks         |
| `errors`            | Errors               | Error handling and exceptions         | Try-catch blocks, global errors, edge cases             |
| `initialization`    | Initialization       | Extension startup and feature init    | Extension load, feature initialization, dependencies    |

**Total: 16 categories**

### 3.2 Category Assignment Guidelines

**When adding new logs, assign appropriate category:**

**URL Detection category:**

- `URLHandlerRegistry.findURL()` operations
- Platform-specific handler execution
- Selector matching and element traversal
- URL extraction and validation

**Hover category:**

- `mouseover` and `mouseout` events
- Element identification
- Hover duration tracking
- Hover state changes

**Clipboard category:**

- `copyToClipboard()` function
- `handleCopyURL()` and `handleCopyText()` functions
- Clipboard API vs execCommand selection
- Copy success/failure

**Keyboard category:**

- `keydown` event handling
- Shortcut matching logic
- Handler execution
- Input field detection

**Quick Tabs category:**

- `createQuickTab()`, `updateQuickTab()`, `deleteQuickTab()`
- Quick Tab positioning calculations
- Quick Tab state changes (minimize, restore, pin, solo, mute)
- Quick Tab data structure operations

**Quick Tab Manager category:**

- Panel toggle operations
- Panel visibility changes
- Quick Tab list rendering
- User interactions within panel

**Event Bus category:**

- `EventBus.emit()` calls
- Listener registration/unregistration
- Event propagation
- Listener execution and errors

**Config category:**

- `ConfigManager.load()` operations
- Setting value changes
- Configuration validation
- Default vs loaded values

**State category:**

- `StateManager.set()` and `setState()`
- State access (`get()`)
- Critical state changes
- State audit trail

**Storage category:**

- `browser.storage.sync.get()`/`set()`
- `browser.storage.session` operations
- Storage change events
- Storage quota management

**Messaging category:**

- `browser.runtime.sendMessage()`
- `browser.tabs.sendMessage()`
- Message routing in background
- Message handler execution

**Web Request category:**

- `browser.webRequest.onBeforeRequest`
- `browser.webRequest.onHeadersReceived`
- `browser.webRequest.onCompleted`
- `browser.webRequest.onErrorOccurred`

**Tabs category:**

- `browser.tabs.onCreated`
- `browser.tabs.onActivated`
- `browser.tabs.onRemoved`
- `browser.tabs.onUpdated`

**Performance category:**

- Operation timing (start/end)
- Duration calculations
- Slow operation detection
- Performance benchmarks

**Errors category:**

- try-catch blocks
- Global error handler
- Unhandled promise rejections
- Edge case handling

**Initialization category:**

- Extension startup sequence
- Feature module initialization
- Dependency loading
- Initialization errors

### 3.3 Category Metadata Structure

**Where:** `src/utils/logger.js`

**Define category metadata for UI rendering:**

```javascript
const LOG_CATEGORIES = {
  'url-detection': {
    id: 'url-detection',
    displayName: 'URL Detection',
    description: 'URL finding and handler operations',
    icon: '🔍',
    defaultEnabled: true
  },
  hover: {
    id: 'hover',
    displayName: 'Hover Events',
    description: 'Hover lifecycle and element tracking',
    icon: '👆',
    defaultEnabled: true
  },
  clipboard: {
    id: 'clipboard',
    displayName: 'Clipboard Operations',
    description: 'Copy URL/text actions',
    icon: '📋',
    defaultEnabled: true
  }
  // ... continue for all 16 categories
};
```

**Category metadata fields:**

- `id`: Unique identifier (used in code)
- `displayName`: User-friendly name (shown in UI)
- `description`: Brief explanation (tooltip/help text)
- `icon`: Emoji icon (visual identification)
- `defaultEnabled`: Whether enabled by default in export filter

---

## Part 4: Export Filter Implementation

### 4.1 Filter Storage Structure

**Where:** `browser.storage.local` (session-specific, not synced)

**Storage key:** `logExportFilters`

**Data structure:**

```javascript
{
  logExportFilters: {
    'url-detection': true,
    'hover': true,
    'clipboard': true,
    'keyboard': true,
    'quick-tabs': true,
    'quick-tab-manager': true,
    'event-bus': false,
    'config': false,
    'state': false,
    'storage': true,
    'messaging': false,
    'webrequest': true,
    'tabs': true,
    'performance': false,
    'errors': true,
    'initialization': true
  }
}
```

**Defaults:**

- User-facing actions: enabled (clipboard, keyboard, quick-tabs, tabs)
- System operations: disabled (event-bus, state, messaging, performance)
- Critical diagnostics: enabled (errors, initialization, webrequest)
- URL/hover: enabled (core functionality)

### 4.2 Filter UI Implementation

**Where:** Extension popup Debug tab

**UI Layout:**

```
┌─────────────────────────────────────────────┐
│ Debug Settings                              │
├─────────────────────────────────────────────┤
│                                             │
│ Log Verbosity:                              │
│ ○ Normal (Essential logs only)              │
│ ⦿ Verbose (Detailed diagnostic logs)        │
│                                             │
│ ───────────────────────────────────────────│
│                                             │
│ Export Log Filters:                         │
│ Select which categories to include in       │
│ exported logs:                              │
│                                             │
│ ┌─────────────────────────────────────────┐│
│ │ ☑ Select All  ☐ Deselect All           ││
│ └─────────────────────────────────────────┘│
│                                             │
│ User Actions:                               │
│ ☑ 🔍 URL Detection                          │
│ ☑ 👆 Hover Events                           │
│ ☑ 📋 Clipboard Operations                   │
│ ☑ ⌨️  Keyboard Shortcuts                    │
│ ☑ 🪟 Quick Tab Actions                      │
│ ☑ 📊 Quick Tab Manager                      │
│                                             │
│ System Operations:                          │
│ ☐ 📡 Event Bus                              │
│ ☐ ⚙️  Configuration                         │
│ ☐ 💾 State Management                       │
│ ☑ 💿 Browser Storage                        │
│ ☐ 💬 Message Passing                        │
│ ☑ 🌐 Web Requests                           │
│ ☑ 📑 Tab Management                         │
│                                             │
│ Diagnostics:                                │
│ ☐ ⏱️  Performance                           │
│ ☑ ❌ Errors                                 │
│ ☑ 🚀 Initialization                         │
│                                             │
│ [Save Filter Preferences]                   │
│                                             │
│ ───────────────────────────────────────────│
│                                             │
│ [📥 Export Console Logs]                    │
│                                             │
└─────────────────────────────────────────────┘
```

**UI Components:**

1. **Select All / Deselect All buttons**
   - Quickly toggle all checkboxes
   - Convenient for "export everything" or "export nothing"

2. **Grouped checkboxes**
   - Organized by category type (User Actions, System Operations, Diagnostics)
   - Visual hierarchy with icons
   - Tooltips showing category descriptions

3. **Save button**
   - Persists filter preferences to storage
   - Applies to future exports
   - Visual feedback on save success

4. **Export button**
   - Applies current filter settings
   - Shows count of filtered vs total logs
   - Downloads filtered log file

### 4.3 Category Detection in Logs

**How to identify log category from captured log entry:**

**Approach 1: Prefix parsing** (Recommended)

- All logs use format: `[Category] [Action] Message`
- Parse first bracketed text as category identifier
- Map display name to category ID

**Example:**

```javascript
const logMessage = '[URL Detection] [Start] Detecting URL for element';
const categoryMatch = logMessage.match(/^\[([^\]]+)\]/);
const categoryDisplayName = categoryMatch[1]; // "URL Detection"
const categoryId = getCategoryIdFromDisplayName(categoryDisplayName); // "url-detection"
```

**Approach 2: Metadata tagging** (Alternative)

- Logging wrapper functions add category metadata to context object
- Console interceptor preserves metadata
- Export filter reads metadata directly

**Example:**

```javascript
// In logger.js
function logNormal(category, action, message, context = {}) {
  const enrichedContext = {
    ...context,
    _logCategory: category, // Add metadata
    _logAction: action,
    timestamp: Date.now()
  };

  console.log(`[${getCategoryDisplayName(category)}] [${action}] ${message}`, enrichedContext);
}
```

**Recommendation:** Use Approach 1 (prefix parsing) for simplicity and backward compatibility with existing logs.

### 4.4 Export Filtering Logic

**Where:** Enhance existing log export handler in popup

**Current flow:**

```
User clicks Export → Get all logs from buffer → Download as .txt
```

**New flow:**

```
User clicks Export → Get all logs from buffer → Apply category filters → Download filtered .txt
```

**Filtering algorithm:**

```javascript
function filterLogsByCategory(allLogs, enabledCategories) {
  return allLogs.filter(logEntry => {
    // Extract category from log message
    const category = extractCategoryFromLog(logEntry);

    // Check if category is enabled in filter
    return enabledCategories[category] === true;
  });
}

function extractCategoryFromLog(logEntry) {
  // Parse log message for category
  const message = logEntry.message || '';

  // Match pattern: [Category Display Name]
  const match = message.match(/^\[([^\]]+)\]/);

  if (!match) {
    // No category found - include by default (backwards compatibility)
    return 'uncategorized';
  }

  const displayName = match[1];

  // Map display name to category ID
  return getCategoryIdFromDisplayName(displayName);
}

function getCategoryIdFromDisplayName(displayName) {
  // Normalize: remove extra spaces, lowercase
  const normalized = displayName.trim().toLowerCase();

  // Map display names to IDs
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
    initialization: 'initialization'
  };

  return mapping[normalized] || 'uncategorized';
}
```

**Handling uncategorized logs:**

- Logs without recognizable category are marked as 'uncategorized'
- Uncategorized logs are ALWAYS exported (fail-safe)
- Prevents losing important logs due to parsing failures

### 4.5 Export File Metadata

**Add metadata header to exported log file:**

```
===================================
Copy-URL-on-Hover Extension Logs
Exported: 2025-11-20 15:45:32
Extension Version: v1.6.0.3
Log Verbosity: Verbose
===================================

EXPORT FILTERS APPLIED:
✓ URL Detection
✓ Hover Events
✓ Clipboard Operations
✓ Keyboard Shortcuts
✓ Quick Tab Actions
✓ Quick Tab Manager
✗ Event Bus
✗ Configuration
✗ State Management
✓ Browser Storage
✗ Message Passing
✓ Web Requests
✓ Tab Management
✗ Performance
✓ Errors
✓ Initialization

Total logs captured: 1,247
Logs in export: 834 (66.9%)
Logs filtered out: 413 (33.1%)

===================================
BEGIN LOGS
===================================

[2025-11-20T20:45:15.234Z] [Quick Tabs] [Create] Quick Tab created successfully { url: "...", id: "..." }
[2025-11-20T20:45:15.456Z] [URL Detection] [Start] Detecting URL for element { domainType: "twitter", ... }
...
```

**Metadata benefits:**

- User knows what filters were applied
- Can identify if important categories were excluded
- Helps troubleshoot incomplete exports
- Shows verbosity mode at time of export
- Timestamp for version correlation

---

## Part 5: Implementation Specifications

### 5.1 File Structure

**New files to create:**

1. **`src/utils/logger.js`**
   - Logging wrapper functions
   - Verbosity check logic
   - Category definitions
   - Category metadata

2. **`src/ui/components/LogFilterSettings.js`** (or in popup)
   - Filter settings UI component
   - Checkbox group rendering
   - Filter save/load logic

**Files to modify:**

1. **`src/core/config.js`**
   - Add `logVerbosity` to DEFAULT_CONFIG
   - Add getter for current verbosity mode

2. **`src/utils/console-interceptor.js`**
   - No changes needed (continues capturing all logs)

3. **`popup.js` (or equivalent popup script)**
   - Add filter UI rendering
   - Add export filtering logic
   - Add metadata generation

4. **Throughout codebase**
   - Replace console.log with logging wrappers
   - Add verbose logs per enhanced-logging-implementation-guide.md

### 5.2 Logging Wrapper Implementation Details

**Core logger structure:**

```javascript
// src/utils/logger.js

import { ConfigManager } from '../core/config.js';

// Category definitions
const LOG_CATEGORIES = {
  'url-detection': {
    id: 'url-detection',
    displayName: 'URL Detection',
    description: 'URL finding and handler operations',
    icon: '🔍',
    defaultEnabled: true
  }
  // ... all 16 categories
};

// Get category display name from ID
function getCategoryDisplayName(categoryId) {
  return LOG_CATEGORIES[categoryId]?.displayName || categoryId;
}

// Get category ID from display name
function getCategoryIdFromDisplayName(displayName) {
  const normalized = displayName.trim().toLowerCase();
  const mapping = {
    /* ... see 4.4 ... */
  };
  return mapping[normalized] || 'uncategorized';
}

// Check if verbose logging is enabled
function shouldLogVerbose() {
  const config = ConfigManager.getCurrentConfig();
  return config.logVerbosity === 'verbose';
}

// Normal logging (always logs)
export function logNormal(category, action, message, context = {}) {
  const categoryName = getCategoryDisplayName(category);
  const formattedMessage = `[${categoryName}] [${action}] ${message}`;

  console.log(formattedMessage, {
    ...context,
    _logCategory: category,
    _logAction: action,
    timestamp: Date.now()
  });
}

// Verbose logging (only in verbose mode)
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

// Error logging (always logs)
export function logError(category, action, message, context = {}) {
  const categoryName = getCategoryDisplayName(category);
  const formattedMessage = `[${categoryName}] [${action}] ${message}`;

  console.error(formattedMessage, {
    ...context,
    _logCategory: category,
    _logAction: action,
    timestamp: Date.now()
  });
}

// Warning logging (always logs)
export function logWarn(category, action, message, context = {}) {
  const categoryName = getCategoryDisplayName(category);
  const formattedMessage = `[${categoryName}] [${action}] ${message}`;

  console.warn(formattedMessage, {
    ...context,
    _logCategory: category,
    _logAction: action,
    timestamp: Date.now()
  });
}

// Performance logging (only in verbose mode)
export function logPerformance(category, action, message, context = {}) {
  if (!shouldLogVerbose()) {
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

// Export category definitions for UI
export { LOG_CATEGORIES };
```

### 5.3 Filter UI Implementation Details

**Filter settings component structure:**

```javascript
// In popup script

import { LOG_CATEGORIES } from '../src/utils/logger.js';

// Load filter preferences from storage
async function loadFilterPreferences() {
  const result = await browser.storage.local.get('logExportFilters');

  if (result.logExportFilters) {
    return result.logExportFilters;
  }

  // Return defaults if not saved
  const defaults = {};
  for (const [id, meta] of Object.entries(LOG_CATEGORIES)) {
    defaults[id] = meta.defaultEnabled;
  }
  return defaults;
}

// Save filter preferences to storage
async function saveFilterPreferences(filters) {
  await browser.storage.local.set({ logExportFilters: filters });
}

// Render filter checkboxes
function renderFilterCheckboxes() {
  const container = document.getElementById('log-filter-container');

  // Group categories
  const userActions = [
    'url-detection',
    'hover',
    'clipboard',
    'keyboard',
    'quick-tabs',
    'quick-tab-manager'
  ];
  const systemOps = ['event-bus', 'config', 'state', 'storage', 'messaging', 'webrequest', 'tabs'];
  const diagnostics = ['performance', 'errors', 'initialization'];

  // Render each group
  renderGroup(container, 'User Actions', userActions);
  renderGroup(container, 'System Operations', systemOps);
  renderGroup(container, 'Diagnostics', diagnostics);
}

function renderGroup(container, groupName, categoryIds) {
  const groupDiv = document.createElement('div');
  groupDiv.className = 'filter-group';

  const groupTitle = document.createElement('h4');
  groupTitle.textContent = groupName;
  groupDiv.appendChild(groupTitle);

  categoryIds.forEach(id => {
    const meta = LOG_CATEGORIES[id];
    const checkbox = createCheckbox(id, meta);
    groupDiv.appendChild(checkbox);
  });

  container.appendChild(groupDiv);
}

function createCheckbox(categoryId, metadata) {
  const label = document.createElement('label');
  label.className = 'filter-checkbox-label';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = `filter-${categoryId}`;
  checkbox.value = categoryId;
  checkbox.className = 'filter-checkbox';

  const icon = document.createElement('span');
  icon.textContent = metadata.icon;
  icon.className = 'filter-icon';

  const text = document.createElement('span');
  text.textContent = metadata.displayName;
  text.className = 'filter-text';
  text.title = metadata.description;

  label.appendChild(checkbox);
  label.appendChild(icon);
  label.appendChild(text);

  return label;
}

// Select/Deselect all
function selectAllFilters() {
  document.querySelectorAll('.filter-checkbox').forEach(cb => {
    cb.checked = true;
  });
}

function deselectAllFilters() {
  document.querySelectorAll('.filter-checkbox').forEach(cb => {
    cb.checked = false;
  });
}

// Get current filter state from UI
function getCurrentFilterState() {
  const filters = {};
  document.querySelectorAll('.filter-checkbox').forEach(cb => {
    filters[cb.value] = cb.checked;
  });
  return filters;
}

// Apply saved filters to UI
async function applyFiltersToUI() {
  const savedFilters = await loadFilterPreferences();

  for (const [categoryId, enabled] of Object.entries(savedFilters)) {
    const checkbox = document.getElementById(`filter-${categoryId}`);
    if (checkbox) {
      checkbox.checked = enabled;
    }
  }
}

// Initialize filter UI
async function initFilterUI() {
  renderFilterCheckboxes();
  await applyFiltersToUI();

  // Attach event listeners
  document.getElementById('select-all-filters').addEventListener('click', selectAllFilters);
  document.getElementById('deselect-all-filters').addEventListener('click', deselectAllFilters);
  document.getElementById('save-filter-prefs').addEventListener('click', async () => {
    const filters = getCurrentFilterState();
    await saveFilterPreferences(filters);
    showSaveConfirmation();
  });
}
```

### 5.4 Export Logic Implementation Details

**Enhanced export function:**

```javascript
// In popup script

async function exportFilteredLogs() {
  // Get all logs from buffer
  const allLogs = await getAllLogsFromExtension();

  // Get current filter settings
  const filters = getCurrentFilterState();

  // Apply filters
  const filteredLogs = filterLogsByCategory(allLogs, filters);

  // Generate metadata
  const metadata = generateExportMetadata(allLogs.length, filteredLogs.length, filters);

  // Format export content
  const exportContent = formatLogsForExport(metadata, filteredLogs);

  // Download file
  downloadLogsFile(exportContent);
}

function filterLogsByCategory(allLogs, enabledCategories) {
  return allLogs.filter(logEntry => {
    const category = extractCategoryFromLog(logEntry);

    // Always include uncategorized logs
    if (category === 'uncategorized') {
      return true;
    }

    // Check if category is enabled
    return enabledCategories[category] === true;
  });
}

function generateExportMetadata(totalCount, exportCount, filters) {
  const now = new Date();
  const timestamp = now.toISOString().replace('T', ' ').substring(0, 19);

  // Get extension version
  const manifest = browser.runtime.getManifest();
  const version = manifest.version;

  // Get verbosity mode
  const config = ConfigManager.getCurrentConfig();
  const verbosity = config.logVerbosity === 'verbose' ? 'Verbose' : 'Normal';

  // Format filter list
  const filterList = Object.entries(filters)
    .map(([id, enabled]) => {
      const meta = LOG_CATEGORIES[id];
      const symbol = enabled ? '✓' : '✗';
      return `${symbol} ${meta.displayName}`;
    })
    .join('\n');

  const percentage = ((exportCount / totalCount) * 100).toFixed(1);
  const filteredOut = totalCount - exportCount;
  const filteredPercentage = ((filteredOut / totalCount) * 100).toFixed(1);

  return `===================================
Copy-URL-on-Hover Extension Logs
Exported: ${timestamp}
Extension Version: ${version}
Log Verbosity: ${verbosity}
===================================

EXPORT FILTERS APPLIED:
${filterList}

Total logs captured: ${totalCount.toLocaleString()}
Logs in export: ${exportCount.toLocaleString()} (${percentage}%)
Logs filtered out: ${filteredOut.toLocaleString()} (${filteredPercentage}%)

===================================
BEGIN LOGS
===================================

`;
}

function formatLogsForExport(metadata, logs) {
  const logLines = logs
    .map(entry => {
      const timestamp = new Date(entry.timestamp).toISOString();
      return `[${timestamp}] ${entry.message}`;
    })
    .join('\n');

  return metadata + logLines;
}
```

---

## Part 6: User Experience Flow

### 6.1 First-Time User Experience

**Default state:**

- Log verbosity: Normal (non-verbose)
- Export filters: Default categories enabled (see 4.1)

**User sees:**

- Minimal console output (essential operations only)
- Export includes user-facing actions + critical diagnostics
- Clean, performant logging experience

### 6.2 Troubleshooting User Experience

**User encounters issue:**

1. Opens extension popup → Debug tab
2. Enables "Verbose" logging
3. Reproduces issue
4. Clicks "Export Console Logs"
5. Gets comprehensive diagnostic file
6. Attaches to bug report

**Developer receives:**

- Complete diagnostic trail
- All detailed logs captured
- Full context for debugging

### 6.3 Advanced User Experience

**Power user wants specific category:**

1. Opens Debug tab
2. Deselects all filters
3. Selects only "URL Detection" category
4. Exports logs
5. Gets focused diagnostic file for URL issues

**Benefits:**

- Smaller file size
- Easier to analyze (signal vs noise)
- Targeted troubleshooting

### 6.4 Settings Persistence

**Verbosity setting:**

- Stored in `browser.storage.sync`
- Syncs across devices
- Persists across browser restarts
- Applies to new browser sessions

**Export filter preferences:**

- Stored in `browser.storage.local`
- Device-specific (not synced)
- Persists across browser restarts
- Remembered between exports

---

## Part 7: Performance Considerations

### 7.1 Verbosity Mode Performance

**Normal mode (non-verbose):**

- Minimal logging overhead
- Essential operations only
- ~10-20 log statements per user action
- Negligible performance impact

**Verbose mode:**

- Significant logging overhead
- All diagnostic details
- ~50-100 log statements per user action
- May impact performance on slow devices

**Mitigation strategies:**

1. **Warn users about verbose mode overhead** in UI
2. **Auto-disable verbose mode** after 15 minutes of inactivity
3. **Throttle high-frequency logs** (mouse position, performance metrics)
4. **Lazy evaluation** of expensive context objects

### 7.2 Export Filter Performance

**No impact on runtime performance:**

- Filtering happens ONLY during export
- Buffer captures everything always
- No runtime overhead from filter settings

**Export operation performance:**

- Filtering 1000 logs: ~10ms
- Filtering 10000 logs: ~50ms
- Negligible compared to file download time

### 7.3 Memory Considerations

**Buffer size:**

- Console interceptor has fixed buffer size (2000 entries)
- Oldest logs rotated out when buffer full
- No memory leak regardless of verbosity

**Verbose mode memory impact:**

- More frequent buffer rotation (due to more logs)
- Context objects may be larger
- Still bounded by buffer size

---

## Part 8: Testing & Validation

### 8.1 Functional Testing Checklist

**Verbosity control:**

- [ ] Normal mode logs only essential operations
- [ ] Verbose mode logs all diagnostic details
- [ ] Switching modes works without reload
- [ ] Setting persists across browser restarts
- [ ] Setting syncs across devices

**Export filtering:**

- [ ] All categories render in UI
- [ ] Checkboxes toggle correctly
- [ ] Select All / Deselect All work
- [ ] Filter preferences save correctly
- [ ] Filter preferences load on popup open
- [ ] Exported file respects filter settings
- [ ] Metadata header is accurate
- [ ] Uncategorized logs always exported

**Category detection:**

- [ ] All log formats parse correctly
- [ ] Category mapping is accurate
- [ ] Unknown categories marked as uncategorized
- [ ] Backward compatibility with old logs

### 8.2 Performance Testing

- [ ] Verbose mode doesn't freeze browser
- [ ] Normal mode has no noticeable overhead
- [ ] Export filtering completes in <1 second
- [ ] Memory usage stays within bounds
- [ ] No performance degradation over time

### 8.3 Edge Case Testing

- [ ] Empty log buffer exports correctly
- [ ] Buffer overflow handled gracefully
- [ ] All filters disabled still exports uncategorized
- [ ] Malformed log messages don't break export
- [ ] Very large context objects don't break export
- [ ] Special characters in logs export correctly

---

## Part 9: Documentation Requirements

### 9.1 User Documentation

**Add to README.md:**

**Section: "Debug Features"**

**Log Verbosity Modes:**

- **Normal Mode** (Default): Logs essential operations only. Minimal overhead, suitable for daily use.
- **Verbose Mode**: Logs detailed diagnostic information. Useful for troubleshooting issues. May impact performance.

**To enable Verbose mode:**

1. Click extension icon
2. Go to Debug tab
3. Select "Verbose" under Log Verbosity
4. Reproduce issue
5. Export logs
6. Switch back to "Normal" for daily use

**Export Filters:**

You can choose which categories of logs to include in exports:

- **User Actions**: URL Detection, Hover Events, Clipboard, Keyboard, Quick Tabs
- **System Operations**: Event Bus, Configuration, State, Storage, Messaging, Web Requests, Tabs
- **Diagnostics**: Performance, Errors, Initialization

**To customize export filters:**

1. Go to Debug tab
2. Check/uncheck categories
3. Click "Save Filter Preferences"
4. Export logs with your preferences applied

**Note:** The extension always captures ALL logs regardless of filter settings. Filters only affect what appears in the exported file.

### 9.2 Developer Documentation

**Add to `docs/` folder:**

**File: `docs/logging-system.md`**

**Content:**

- Logging wrapper API reference
- Category taxonomy
- Verbosity mode guidelines
- When to use logNormal vs logVerbose
- Performance best practices
- Adding new categories

---

## Part 10: Implementation Priority

### Phase 1: Core Infrastructure (Week 1)

1. Create `src/utils/logger.js` with wrapper functions
2. Define LOG_CATEGORIES metadata
3. Add `logVerbosity` to config
4. Implement verbosity check logic

### Phase 2: UI Implementation (Week 1-2)

1. Add verbosity toggle to popup settings
2. Create filter checkbox UI
3. Implement filter save/load
4. Add Select All / Deselect All

### Phase 3: Export Enhancement (Week 2)

1. Implement category detection
2. Implement filtering logic
3. Add metadata generation
4. Test export with various filter combinations

### Phase 4: Migration (Week 3)

1. Replace console.log with logNormal in critical paths
2. Add logVerbose calls per enhanced-logging-implementation-guide.md
3. Test verbosity modes
4. Validate category assignments

### Phase 5: Testing & Documentation (Week 3-4)

1. Comprehensive testing per Part 8
2. Update user documentation
3. Update developer documentation
4. Performance validation

---

## Conclusion

This implementation guide provides comprehensive specifications for a two-tier logging system with verbosity control and category-based filtered export.

**Key Features:**

1. **Verbosity Control**: Normal vs Verbose modes
2. **Category-Based Filtering**: 16 distinct log categories
3. **Always-Capturing Buffer**: Logs everything regardless of filters
4. **Flexible Export**: User-controlled category selection
5. **Performance-Conscious**: Minimal overhead in normal mode
6. **Backward Compatible**: Existing logs continue working

**Design Principles:**

- Logger captures everything always
- Verbosity controls what gets logged
- Export filters control what gets exported
- User has complete control
- Performance optimized for daily use
- Verbose mode for troubleshooting

**Expected Outcome:**
After implementation, users will have:

- Fine-grained control over logging detail level
- Ability to export only relevant log categories
- Complete diagnostic capability when needed
- Minimal performance impact during normal use
- Better signal-to-noise ratio in exported logs
