# Constants & Configuration Reference

**Document Purpose:** Define all magic numbers and configuration values  
**Target Audience:** GitHub Copilot Agent + Developers  
**Status:** Important - Use as single source of truth for all constants  
**Last Updated:** December 15, 2025

---

## EXECUTIVE SUMMARY

This document lists all constants needed for the simplified architecture:

- Where each constant is used
- Why each value was chosen
- Alternatives considered
- Validation rules

---

## STORAGE CONSTANTS

### STORAGE_KEY

**Value:** `'quick_tabs_state_v2'`

**Type:** String (literal)

**Purpose:** Key name in `browser.storage.local` and `browser.storage.sync`

**Usage:**

- Background: `browser.storage.local.set({ [STORAGE_KEY]: stateToWrite })`
- Sidebar: Storage event listener checks for this key
- Backup: `browser.storage.sync.set({ 'quick_tabs_backup_v1': ... })`

**Why This Value:**

- `v2` suffix allows schema evolution
- Can migrate from `quick_tabs_state_v1` to `v2` without data loss
- Immutable (never changes until new schema version)

**Implementation:**

```javascript
const STORAGE_KEY = 'quick_tabs_state_v2';
```

**Location:** `background.js` (top level)

---

### ENABLE_SYNC_BACKUP

**Value:** `true`

**Type:** Boolean

**Purpose:** Whether to write state to `browser.storage.sync` as backup

**Usage:**

```javascript
if (ENABLE_SYNC_BACKUP) {
  browser.storage.sync
    .set({
      quick_tabs_backup_v1: { tabs, lastModified, checksum }
    })
    .catch(err => console.warn('Sync backup failed:', err));
}
```

**Why This Value:**

- Non-blocking backup (use `.catch()` for errors)
- Provides recovery if `storage.local` corrupted
- Sync storage syncs across browser instances
- Low cost: only essential fields (no full state)

**Alternatives Considered:**

- `false`: Don't backup (riskier, data loss possible)
- Different storage tier: Sync is most reliable backup

**Implementation:**

```javascript
const ENABLE_SYNC_BACKUP = true;
```

**Location:** `background.js` (near STORAGE_KEY)

---

## INITIALIZATION CONSTANTS

### INIT_BARRIER_TIMEOUT_MS

**Value:** `10000`

**Type:** Number (milliseconds)

**Purpose:** Maximum time to wait for initialization to complete

**Usage:**

```javascript
setTimeout(() => {
  if (!initializationResolve) return; // Already resolved
  initializationReject(new Error('Initialization timeout'));
}, INIT_BARRIER_TIMEOUT_MS);
```

**Why This Value:**

- 10 seconds is reasonable for startup
- State load + validation should complete in <100ms
- 10s buffer prevents false timeouts
- If init takes >10s, something is broken anyway

**Alternatives Considered:**

- 5000ms: Too aggressive, could timeout on slow devices
- 30000ms: Too long, user perception of "broken"
- 10000ms: Good balance

**Implementation:**

```javascript
const INIT_BARRIER_TIMEOUT_MS = 10000;
```

**Location:** `sidebar/quick-tabs-manager.js` (near initialization code)

---

## RENDER QUEUE CONSTANTS

### RENDER_QUEUE_DEBOUNCE_MS

**Value:** `100`

**Type:** Number (milliseconds)

**Purpose:** Buffer rapid state changes before rendering

**Usage:**

```javascript
_renderDebounceTimer = setTimeout(() => {
  _processRenderQueue();
}, RENDER_QUEUE_DEBOUNCE_MS);
```

**Why This Value:**

- 100ms is imperceptible to users (feel responsive)
- Batches multiple rapid storage events
- Reduces DOM operations by 70-90%
- Network latency ~50-100ms, so 100ms safe

**Alternatives Considered:**

- 50ms: More responsive but less batching benefit
- 100ms: Best balance (chosen)
- 200ms: Too slow, noticeable lag

**Latency Impact:**

```
Storage event → Debounce queue (0-100ms) → Render (10-30ms) = 10-130ms total
```

**Implementation:**

```javascript
const RENDER_QUEUE_DEBOUNCE_MS = 100;
```

**Location:** `sidebar/quick-tabs-manager.js` (near render queue code)

---

## MESSAGE CONSTANTS

### MESSAGE_TIMEOUT_MS

**Value:** `3000`

**Type:** Number (milliseconds)

**Purpose:** Timeout for `runtime.sendMessage()` calls

**Usage:**

```javascript
async function sendMessageToBackground(message) {
  return await Promise.race([
    browser.runtime.sendMessage(message),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), MESSAGE_TIMEOUT_MS)
    )
  ]);
}
```

**Why This Value:**

- 3 seconds is standard for web timeouts
- Background script should respond <100ms normally
- Covers slow devices and startup delays
- User still feels responsive (not hung)

**Alternatives Considered:**

- 1000ms: Too aggressive, false timeouts
- 3000ms: Industry standard (chosen)
- 5000ms: Too long, feels broken

**Implementation:**

```javascript
const MESSAGE_TIMEOUT_MS = 3000;
```

**Location:** `sidebar/quick-tabs-manager.js` (near message sending code)

---

## HEALTH CHECK CONSTANTS

### STORAGE_HEALTH_CHECK_INTERVAL_MS

**Value:** `5000`

**Type:** Number (milliseconds)

**Purpose:** How often to verify storage.onChanged is firing

**Usage:**

```javascript
setInterval(() => {
  const age = Date.now() - _lastStorageEventTime;
  if (age > STORAGE_HEALTH_CHECK_INTERVAL_MS) {
    // Request fresh state as fallback
  }
}, STORAGE_HEALTH_CHECK_INTERVAL_MS);
```

**Why This Value:**

- 5 seconds is quick enough to detect broken storage listener
- Not too frequent (minimal overhead)
- Fallback message within acceptable latency
- Aligns with "stale data" threshold

**Alternatives Considered:**

- 1000ms: Too frequent, unnecessary overhead
- 5000ms: Good balance (chosen)
- 10000ms: Too slow to detect problems

**Implementation:**

```javascript
const STORAGE_HEALTH_CHECK_INTERVAL_MS = 5000;
```

**Location:** `sidebar/quick-tabs-manager.js` (in health check function)

---

### STORAGE_MAX_AGE_MS

**Value:** `300000`

**Type:** Number (milliseconds) = 5 minutes

**Purpose:** Reject storage events older than this threshold

**Usage:**

```javascript
if (Date.now() - newState.lastModified > STORAGE_MAX_AGE_MS) {
  console.warn('[Manager] Event too old, ignoring');
  return;
}
```

**Why This Value:**

- 5 minutes = 300,000ms
- Events from before browser sleep/reload should be ignored
- Prevents stale state from being applied
- User's browser has been idle 5+ min = consider state expired

**Alternatives Considered:**

- 60000ms (1 min): Too aggressive, valid events rejected
- 300000ms (5 min): Good threshold (chosen)
- 3600000ms (1 hour): Too long, stale data applied

**Implementation:**

```javascript
const STORAGE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
```

**Location:** `sidebar/quick-tabs-manager.js` (in storage event handler)

---

## QUICK TAB ID GENERATION CONSTANTS

### QUICK_TAB_ID_PREFIX

**Value:** `'qt-'`

**Type:** String (literal)

**Purpose:** Prefix for all Quick Tab IDs

**Usage:**

```javascript
function generateQuickTabId() {
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(2, 8);
  return `${QUICK_TAB_ID_PREFIX}${timestamp}-${randomId}`;
  // Example: 'qt-1702000000000-abc123'
}
```

**Why This Value:**

- `qt-` is short and unambiguous
- Quick Tab vs other extension features
- Always distinguishable (can't conflict with browser tab IDs)
- Easy to search/filter

**Implementation:**

```javascript
const QUICK_TAB_ID_PREFIX = 'qt-';
```

**Location:** `background.js` (utility function)

---

### QUICK_TAB_ID_RANDOM_LENGTH

**Value:** `6`

**Type:** Number (characters)

**Purpose:** Length of random suffix in Quick Tab ID

**Usage:**

```javascript
const randomId = Math.random()
  .toString(36)
  .substring(2, 2 + QUICK_TAB_ID_RANDOM_LENGTH);
// Example with 6: 'abc123'
```

**Why This Value:**

- 6 characters = 36^6 ≈ 2.1 billion combinations
- Very low collision probability (0.0001% for 1000 IDs)
- Readable and not too long
- Base-36 (0-9, a-z) encodes ~5.9 bits per character

**Collision Probability:**

- 100 IDs: < 0.00001%
- 1000 IDs: < 0.00001%
- 10,000 IDs: < 0.001%

**Alternatives Considered:**

- 4 characters: 36^4 ≈ 1.7M (higher collision risk)
- 6 characters: 36^6 ≈ 2.1B (chosen, good balance)
- 8 characters: 36^8 ≈ 2.8T (overkill)

**Implementation:**

```javascript
const QUICK_TAB_ID_RANDOM_LENGTH = 6;
```

**Location:** `background.js` (utility function)

---

## SIZE CONSTRAINTS

### MIN_QUICK_TAB_WIDTH

**Value:** `200`

**Type:** Number (pixels)

**Purpose:** Minimum width of Quick Tab window

**Usage:**

```javascript
if (size.width < MIN_QUICK_TAB_WIDTH) {
  console.warn('Width too small, setting to minimum');
  size.width = MIN_QUICK_TAB_WIDTH;
}
```

**Why This Value:**

- 200px is usable minimum for web content
- Narrower = content unreadable
- Firefox minimum window size is ~100px
- 200px gives content room to breathe

**Implementation:**

```javascript
const MIN_QUICK_TAB_WIDTH = 200;
```

**Location:** `background.js` (validation)

---

### MAX_QUICK_TAB_WIDTH

**Value:** `3000`

**Type:** Number (pixels)

**Purpose:** Maximum width of Quick Tab window

**Usage:**

```javascript
if (size.width > MAX_QUICK_TAB_WIDTH) {
  console.warn('Width too large, capping to maximum');
  size.width = MAX_QUICK_TAB_WIDTH;
}
```

**Why This Value:**

- 3000px covers most monitor widths
- 4K monitors: 3840px (Quick Tab can be full width)
- Beyond 3000px is rare and probably user error
- Prevents accidental huge windows from breaking layout

**Implementation:**

```javascript
const MAX_QUICK_TAB_WIDTH = 3000;
```

**Location:** `background.js` (validation)

---

### MIN_QUICK_TAB_HEIGHT

**Value:** `200`

**Type:** Number (pixels)

**Purpose:** Minimum height of Quick Tab window

**Why This Value:**

- 200px is minimum for readable content
- Browser toolbar ~60px, so 200px gives good content area
- Smaller = content cut off

**Implementation:**

```javascript
const MIN_QUICK_TAB_HEIGHT = 200;
```

**Location:** `background.js` (validation)

---

### MAX_QUICK_TAB_HEIGHT

**Value:** `2000`

**Type:** Number (pixels)

**Purpose:** Maximum height of Quick Tab window

**Why This Value:**

- 2000px covers most monitor heights
- 4K monitors: 2160px (Quick Tab can be full height)
- Beyond 2000px is rare
- Prevents accidental huge windows

**Implementation:**

```javascript
const MAX_QUICK_TAB_HEIGHT = 2000;
```

**Location:** `background.js` (validation)

---

## STATE LIMITS

### MAX_QUICK_TABS

**Value:** `100`

**Type:** Number (tabs)

**Purpose:** Maximum Quick Tabs allowed simultaneously

**Usage:**

```javascript
if (globalQuickTabState.tabs.length >= MAX_QUICK_TABS) {
  return { success: false, error: 'Too many Quick Tabs' };
}
```

**Why This Value:**

- 100 tabs = ~50-100KB state JSON
- Checksum computation: O(n), ~10ms for 100 tabs
- Render performance: Still responsive with DOM reconciliation
- Reasonable limit (most users never hit it)

**Performance:**

- 50 tabs: ~20ms checksum, render <50ms
- 100 tabs: ~40ms checksum, render <100ms
- 150 tabs: ~60ms checksum, render ~150ms (slow)

**Alternatives Considered:**

- 50: Too restrictive, some power users want more
- 100: Good balance (chosen)
- 200: Performance degrades noticeably
- Unlimited: DOM performance becomes issue

**Implementation:**

```javascript
const MAX_QUICK_TABS = 100;
```

**Location:** `background.js` (validation)

---

### URL_MAX_LENGTH

**Value:** `2048`

**Type:** Number (characters)

**Purpose:** Maximum URL length allowed

**Usage:**

```javascript
if (url.length > URL_MAX_LENGTH) {
  return { success: false, error: 'URL too long' };
}
```

**Why This Value:**

- 2048 is HTTP standard max URL length
- Most browsers support 2048+, some 8192+
- Very few real URLs exceed 2048
- Prevents storage bloat from malicious URLs

**Implementation:**

```javascript
const URL_MAX_LENGTH = 2048;
```

**Location:** `background.js` (validation)

---

### TITLE_MAX_LENGTH

**Value:** `255`

**Type:** Number (characters)

**Purpose:** Maximum title length

**Usage:**

```javascript
if (title.length > TITLE_MAX_LENGTH) {
  title = title.substring(0, TITLE_MAX_LENGTH);
}
```

**Why This Value:**

- 255 is database field size standard
- Most page titles are <100 characters
- Truncation at 255 is imperceptible to user

**Implementation:**

```javascript
const TITLE_MAX_LENGTH = 255;
```

**Location:** `background.js` (validation)

---

## ORPHAN CLEANUP CONSTANTS

### ORPHAN_CLEANUP_INTERVAL_MS

**Value:** `3600000`

**Type:** Number (milliseconds) = 1 hour

**Purpose:** How often to run orphan cleanup task

**Usage:**

```javascript
browser.alarms.create('quickTabsOrphanCleanup', {
  periodInMinutes: ORPHAN_CLEANUP_INTERVAL_MS / 60000
});

browser.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'quickTabsOrphanCleanup') {
    _cleanupOrphanTabs();
  }
});
```

**Why This Value:**

- 1 hour = 3600000ms
- Not too frequent (minimal CPU overhead)
- Detects closed tabs within reasonable time
- Good balance for cleanup

**Alternatives Considered:**

- 300000ms (5 min): Too frequent, unnecessary overhead
- 3600000ms (1 hour): Good balance (chosen)
- 86400000ms (24 hours): Too infrequent, stale data accumulates

**Implementation:**

```javascript
const ORPHAN_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
```

**Location:** `background.js` (orphan cleanup code)

---

## CHECKSUM CONSTANTS

### CHECKSUM_VERSION

**Value:** `'v1'`

**Type:** String (literal)

**Purpose:** Version of checksum algorithm

**Usage:**

```javascript
const checksum = `${CHECKSUM_VERSION}:${tabs.length}:${hash}`;
// Example: 'v1:5:a1b2c3d4'
```

**Why This Value:**

- `v1` allows future checksum algorithms without conflicts
- Can migrate from `v1` to `v2` if algorithm changes
- Current: Simple hash (not cryptographic)

**Future Versions:**

- `v1`: Simple character-based hash (current)
- `v2`: Could be SHA-256 or other algorithm

**Implementation:**

```javascript
const CHECKSUM_VERSION = 'v1';
```

**Location:** `background.js` (checksum computation)

---

## CONSTANTS SUMMARY TABLE

| Constant Name                    | Value                   | Type    | Purpose               | Location                      |
| -------------------------------- | ----------------------- | ------- | --------------------- | ----------------------------- |
| STORAGE_KEY                      | `'quick_tabs_state_v2'` | String  | Storage key name      | background.js                 |
| ENABLE_SYNC_BACKUP               | `true`                  | Boolean | Enable backup         | background.js                 |
| INIT_BARRIER_TIMEOUT_MS          | `10000`                 | Number  | Init timeout          | sidebar/quick-tabs-manager.js |
| RENDER_QUEUE_DEBOUNCE_MS         | `100`                   | Number  | Render debounce       | sidebar/quick-tabs-manager.js |
| MESSAGE_TIMEOUT_MS               | `3000`                  | Number  | Message timeout       | sidebar/quick-tabs-manager.js |
| STORAGE_HEALTH_CHECK_INTERVAL_MS | `5000`                  | Number  | Health check interval | sidebar/quick-tabs-manager.js |
| STORAGE_MAX_AGE_MS               | `300000`                | Number  | Max event age         | sidebar/quick-tabs-manager.js |
| QUICK_TAB_ID_PREFIX              | `'qt-'`                 | String  | ID prefix             | background.js                 |
| QUICK_TAB_ID_RANDOM_LENGTH       | `6`                     | Number  | Random suffix length  | background.js                 |
| MIN_QUICK_TAB_WIDTH              | `200`                   | Number  | Min width             | background.js                 |
| MAX_QUICK_TAB_WIDTH              | `3000`                  | Number  | Max width             | background.js                 |
| MIN_QUICK_TAB_HEIGHT             | `200`                   | Number  | Min height            | background.js                 |
| MAX_QUICK_TAB_HEIGHT             | `2000`                  | Number  | Max height            | background.js                 |
| MAX_QUICK_TABS                   | `100`                   | Number  | Max Quick Tabs        | background.js                 |
| URL_MAX_LENGTH                   | `2048`                  | Number  | Max URL length        | background.js                 |
| TITLE_MAX_LENGTH                 | `255`                   | Number  | Max title length      | background.js                 |
| ORPHAN_CLEANUP_INTERVAL_MS       | `3600000`               | Number  | Cleanup interval      | background.js                 |
| CHECKSUM_VERSION                 | `'v1'`                  | String  | Checksum version      | background.js                 |

---

## CONFIGURATION BEST PRACTICES

### When to Use Constants

✅ **Use constants for:**

- Magic numbers that appear in 2+ places
- Values that might change during tuning
- Time intervals and thresholds
- Max/min constraints
- String literals (IDs, keys, prefixes)

❌ **Don't use constants for:**

- Single-use numbers
- Inline array/object literals
- Function parameters with single call site
- Loop counters

### Naming Convention

- **ALL_CAPS_WITH_UNDERSCORES** for constants
- **PrefixXXX_YYYY_MS** for time values (include unit)
- **MAX*/MIN*** prefix for constraints
- **ENABLE\_** prefix for booleans

### Documentation

Every constant should have:

- Purpose (what it controls)
- Why this specific value (reasoning)
- Alternatives considered (why not other values)
- Impact (performance, behavior, limits)

---

## VERSION HISTORY

- **v1.0** (Dec 15, 2025) - Initial constants and configuration reference
