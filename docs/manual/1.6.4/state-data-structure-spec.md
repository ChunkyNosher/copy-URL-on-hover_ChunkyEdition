# State Data Structure Specification

**Document Purpose:** Define exact schema and validation rules for Quick Tab state objects  
**Target Audience:** GitHub Copilot Agent + Developers  
**Status:** Critical - Use as reference for state management implementation  
**Last Updated:** December 15, 2025

---

## EXECUTIVE SUMMARY

This document defines the complete data structure for Quick Tab state, including:
- Exact field names, types, and constraints
- Validation rules for each field
- Example values for testing
- Serialization/deserialization requirements
- Storage schema version management

### Key Principles
- **Single Source of Truth:** Background script's `globalQuickTabState` is authoritative
- **Type Safety:** Strict validation on all state reads/writes
- **Backward Compatibility:** Schema versioning allows future evolution
- **Deterministic:** Same input always produces same checksum

---

## GLOBAL STATE OBJECT (Background Script)

### Structure Definition

```javascript
const globalQuickTabState = {
  // Metadata
  version: 2,                    // Schema version (allows future evolution)
  lastModified: 1702000010000,   // Timestamp of last change (milliseconds)
  isInitialized: false,          // Guard against partial reads during init
  
  // Core data
  tabs: [
    {
      // Unique identifier
      id: 'qt-1702000000000-abc123',     // Format: 'qt-{timestamp}-{randomId}'
      
      // Quick Tab content
      url: 'https://example.com/page',   // Full URL from origin tab
      title: 'Page Title',               // Title of the page
      favicon: 'data:image/png;base64,...', // Base64 encoded favicon (optional)
      
      // Origin information
      originTabId: 42,                   // Browser tab ID that created this
      originWindowId: 1,                 // Browser window ID (for cross-window support)
      
      // UI state
      position: {
        left: 100,                       // X position in pixels (0+)
        top: 200                        // Y position in pixels (0+)
      },
      size: {
        width: 800,                      // Width in pixels (100+)
        height: 600                      // Height in pixels (100+)
      },
      minimized: false,                  // Whether Quick Tab is minimized
      
      // Tracking
      creationTime: 1702000000000,       // When Quick Tab was created
      lastModified: 1702000010000,       // When Quick Tab was last changed
      
      // Optional metadata
      zIndex: 1000,                      // Stacking order (for overlapping windows)
      containerColor: '#FF5733'          // User-defined color (optional)
    },
    // ... more tabs (0 to 100+)
  ]
};

// Persistence metadata (written to storage.local)
const persistedState = {
  tabs: [...],                   // Array of Quick Tab objects
  lastModified: 1702000010000,   // Timestamp
  writeSequence: 42,             // Incrementing sequence counter
  revision: 1702000010001,       // Monotonically increasing revision
  checksum: 'v1:5:a1b2c3d4'      // State integrity hash
};
```

### Field Specifications

#### `globalQuickTabState.version`
- **Type:** `number` (integer)
- **Range:** 1-9 (single digit for simplicity)
- **Current:** 2
- **Purpose:** Allow schema evolution without data loss
- **Validation:** Must equal 2 (current version)
- **Example:** `2`

#### `globalQuickTabState.lastModified`
- **Type:** `number` (milliseconds since epoch)
- **Range:** 1000000000000 to current timestamp
- **Purpose:** Track when entire state was last changed
- **Validation:** Must be valid timestamp (< current time + 5s buffer)
- **Update:** Set to `Date.now()` whenever ANY tab changes
- **Example:** `1702000010000`

#### `globalQuickTabState.isInitialized`
- **Type:** `boolean`
- **Values:** `true` or `false`
- **Purpose:** Guard against partial state reads during initialization
- **Validation:** Must be explicitly set to `true` only after full load from storage
- **Update:** Set to `true` in background after state validation completes
- **Example:** `true`

#### `globalQuickTabState.tabs`
- **Type:** `array` of Quick Tab objects
- **Min length:** 0
- **Max length:** 100+ (no hard limit, but 50-100 typical max)
- **Purpose:** Store all Quick Tab objects
- **Validation:** Each item must be valid Quick Tab object
- **Update:** Add/remove/modify items when user creates/closes/updates Quick Tabs
- **Example:** `[{ id: 'qt-...', url: 'https://...', ... }, ...]`

---

## QUICK TAB OBJECT SPECIFICATION

### Individual Tab Structure

Each item in `globalQuickTabState.tabs` must conform to:

```javascript
{
  // Required fields (must always be present)
  id: 'qt-1702000000000-abc123',
  url: 'https://example.com/page',
  originTabId: 42,
  position: { left: 100, top: 200 },
  size: { width: 800, height: 600 },
  minimized: false,
  creationTime: 1702000000000,
  lastModified: 1702000010000,
  
  // Optional fields (may be null/undefined)
  title: 'Page Title',
  favicon: 'data:image/png;base64,...',
  originWindowId: 1,
  zIndex: 1000,
  containerColor: '#FF5733'
}
```

### Field Specifications

#### `id`
- **Type:** `string`
- **Format:** `qt-{timestamp}-{randomId}`
  - `qt-`: Prefix (literal)
  - `{timestamp}`: 13-digit millisecond timestamp (when created)
  - `-`: Separator
  - `{randomId}`: 6 random alphanumeric characters (a-z0-9)
- **Example:** `qt-1702000000000-abc123`
- **Validation Rules:**
  - Must start with `qt-`
  - Must contain exactly 2 hyphens
  - Must be globally unique (no duplicates in tabs array)
  - Must be immutable (never changes after creation)
- **Generation:**
  ```javascript
  function generateQuickTabId() {
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);
    return `qt-${timestamp}-${randomId}`;
  }
  ```

#### `url`
- **Type:** `string`
- **Format:** Valid HTTP/HTTPS URL
- **Examples:**
  - `https://example.com`
  - `https://example.com/path?query=value#anchor`
  - `http://localhost:8000/app`
- **Validation Rules:**
  - Must start with `http://` or `https://`
  - Must be URL-encodable
  - Must not exceed 2048 characters
  - Empty string not allowed
- **Update:** Immutable after creation
- **Special Cases:**
  - `about:blank` is valid (empty tab)
  - `data:` URLs may be supported (for HTML quick tabs)

#### `title`
- **Type:** `string` or `null`/`undefined`
- **Max length:** 255 characters
- **Examples:**
  - `"Page Title"`
  - `"Gmail - Inbox"`
  - `null` (if not available)
- **Validation Rules:**
  - May be empty string (falsy)
  - No special character restrictions
  - Trimmed of leading/trailing whitespace
- **Update:** Can be updated without changing `lastModified` of Quick Tab (minor change)
- **Derivation:** From `<title>` tag of the URL's HTML page

#### `favicon`
- **Type:** `string` (base64 encoded) or `null`/`undefined`
- **Format:** `data:image/png;base64,{base64data}` or `data:image/jpeg;base64,{base64data}`
- **Max length:** 50,000 characters (~37KB binary)
- **Examples:**
  - `"data:image/png;base64,iVBORw0KGgoAAAANS..."`
  - `null` (if no favicon available)
- **Validation Rules:**
  - Must start with `data:image/` if present
  - Supported formats: `png`, `jpeg`, `webp`, `gif`
  - If size > 50KB, truncate or omit
- **Update:** Can be updated independently of other fields
- **Derivation:** From `<link rel="icon">` of the page

#### `originTabId`
- **Type:** `number` (integer)
- **Range:** 1 to 2147483647 (32-bit signed integer)
- **Examples:** `42`, `1`, `999`
- **Validation Rules:**
  - Must be positive integer
  - Must reference actual browser tab (validated via `browser.tabs.get()`)
  - Can become invalid if origin tab closes
- **Update:** Immutable after creation
- **Special Case:** If origin tab closes, Quick Tab becomes "orphaned" (still kept but marked as orphaned)

#### `originWindowId`
- **Type:** `number` (integer) or `null`
- **Range:** 1 to 2147483647
- **Examples:** `1`, `42`, `null`
- **Purpose:** Track which browser window created the Quick Tab
- **Validation Rules:**
  - May be null if window ID not available
  - If present, must match origin tab's window
- **Update:** Immutable after creation
- **Optional:** Can be omitted from state (derived from originTabId)

#### `position.left`
- **Type:** `number` (non-negative integer or float)
- **Range:** 0 to 65535
- **Units:** CSS pixels
- **Examples:** `0`, `100.5`, `1024`
- **Validation Rules:**
  - Must be >= 0
  - May be floating point (for sub-pixel positioning)
  - No maximum enforced (large values allowed)
- **Update:** Changed when user drags Quick Tab
- **Initial Value:** Randomized on creation (to avoid overlap)

#### `position.top`
- **Type:** `number` (non-negative integer or float)
- **Range:** 0 to 65535
- **Units:** CSS pixels
- **Examples:** `0`, `200.5`, `768`
- **Validation Rules:**
  - Must be >= 0
  - May be floating point
  - No maximum enforced
- **Update:** Changed when user drags Quick Tab vertically
- **Initial Value:** Randomized on creation

#### `size.width`
- **Type:** `number` (positive integer or float)
- **Range:** 200 to 3000
- **Units:** CSS pixels
- **Examples:** `800`, `640.5`, `1920`
- **Validation Rules:**
  - Must be > 0
  - Minimum recommended: 200px
  - Maximum recommended: 3000px
- **Update:** Changed when user resizes Quick Tab
- **Initial Value:** Default 800px

#### `size.height`
- **Type:** `number` (positive integer or float)
- **Range:** 200 to 2000
- **Units:** CSS pixels
- **Examples:** `600`, `480.5`, `1080`
- **Validation Rules:**
  - Must be > 0
  - Minimum recommended: 200px
  - Maximum recommended: 2000px
- **Update:** Changed when user resizes Quick Tab
- **Initial Value:** Default 600px

#### `minimized`
- **Type:** `boolean`
- **Values:** `true` (hidden/minimized) or `false` (visible/maximized)
- **Examples:** `true`, `false`
- **Validation Rules:**
  - Must be strictly boolean (not truthy/falsy)
- **Update:** Changed when user clicks minimize/maximize button
- **Initial Value:** `false` (all new Quick Tabs start maximized)

#### `creationTime`
- **Type:** `number` (milliseconds since epoch)
- **Range:** Valid timestamp
- **Examples:** `1702000000000`
- **Validation Rules:**
  - Must be valid timestamp (>= 1000000000000)
  - Must be <= current time
  - Must be immutable
- **Set:** Exactly once when Quick Tab is created
- **Purpose:** Track age of Quick Tab for diagnostics and cleanup

#### `lastModified`
- **Type:** `number` (milliseconds since epoch)
- **Range:** Valid timestamp
- **Examples:** `1702000010000`
- **Validation Rules:**
  - Must be valid timestamp
  - Must be >= creationTime
  - Must be <= global state's lastModified
- **Update:** Set to `Date.now()` whenever any Quick Tab property changes
- **Purpose:** Detect stale/orphaned Quick Tabs

#### `zIndex` (Optional)
- **Type:** `number` (integer)
- **Range:** 1 to 999999
- **Examples:** `1000`, `100`, `50`
- **Validation Rules:**
  - Must be positive integer
  - Larger values = on top
- **Update:** Changed when user reorders Quick Tabs (click to bring to front)
- **Initial Value:** Current max zIndex + 1
- **Optional:** May be omitted (default to creation order)

#### `containerColor` (Optional)
- **Type:** `string` (hex color) or `null`
- **Format:** `#RRGGBB`
- **Examples:** `#FF5733`, `#000000`, `#FFFFFF`
- **Validation Rules:**
  - Must be 7-character hex string if present
  - Case-insensitive (normalize to uppercase)
  - Must be valid CSS color
- **Update:** Changed when user picks color from palette
- **Optional:** May be null or omitted (default color)

---

## SIDEBAR LOCAL STATE

The sidebar maintains a subset of state for rendering:

```javascript
const sidebarLocalState = {
  tabs: [...],                    // Copy of globalQuickTabState.tabs
  lastModified: 1702000010000,    // Timestamp from background
  revisionReceived: 0,            // Highest revision seen so far
  writeSequence: 0,               // Sequence number from background
  lastRenderedRevision: 0         // Highest revision rendered to DOM
};
```

### Field Specifications

#### `sidebarLocalState.tabs`
- **Type:** `array` of Quick Tab objects (deep copy)
- **Purpose:** Local cache to render without querying background
- **Update:** Updated from storage.onChanged events
- **Validation:** Same rules as `globalQuickTabState.tabs`

#### `sidebarLocalState.lastModified`
- **Type:** `number` (timestamp)
- **Purpose:** Track when state was last updated
- **Update:** Set from storage event

#### `sidebarLocalState.revisionReceived`
- **Type:** `number` (integer)
- **Range:** 0 to infinite
- **Purpose:** Deduplicate storage events by revision number
- **Validation Rule:** Reject any event with `revision <= revisionReceived`
- **Update:** Set when processing storage.onChanged event
- **Example:** Last received was 1702000010001, next must be >= 1702000010002

#### `sidebarLocalState.writeSequence`
- **Type:** `number` (integer)
- **Range:** 0 to infinite
- **Purpose:** Track operation sequence for ordering
- **Update:** Set from operation acknowledgment messages
- **Example:** `42`

#### `sidebarLocalState.lastRenderedRevision`
- **Type:** `number` (integer)
- **Range:** 0 to infinite
- **Purpose:** Prevent rendering same revision twice
- **Validation Rule:** Don't render if `revision === lastRenderedRevision`
- **Update:** Set after successful render
- **Example:** `1702000010001`

---

## PERSISTENT STORAGE SCHEMA

### Key in `browser.storage.local`

```javascript
{
  'quick_tabs_state_v2': {
    tabs: [...],                 // Array of Quick Tab objects
    lastModified: 1702000010000, // Timestamp
    writeSequence: 42,           // Sequence counter
    revision: 1702000010001,     // Monotonic revision
    checksum: 'v1:5:a1b2c3d4'    // Integrity hash
  }
}
```

#### Storage Key Name
- **Key:** `quick_tabs_state_v2`
- **Rationale:** `v2` suffix allows schema evolution
- **Immutable:** Key name never changes (until new schema version)

#### `checksum` Field
- **Type:** `string`
- **Format:** `v{version}:{tabCount}:{hash}`
  - `v1`: Checksum version (for future compatibility)
  - `tabCount`: Number of tabs (quick sanity check)
  - `hash`: 8-character hex hash of all tabs
- **Example:** `v1:5:a1b2c3d4`
- **Generation:**
  ```javascript
  function _computeStateChecksum(tabs) {
    const signatures = tabs
      .map(t => `${t.id}|${t.position.left}|${t.position.top}|${t.size.width}|${t.size.height}|${t.minimized ? 1 : 0}`)
      .sort()
      .join('||');
    
    let hash = 0;
    for (let i = 0; i < signatures.length; i++) {
      const char = signatures.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    
    return `v1:${tabs.length}:${Math.abs(hash).toString(16).padStart(8, '0')}`;
  }
  ```
- **Validation:** Compare computed checksum with stored checksum
- **Purpose:** Detect corruption during storage I/O

#### `revision` Field
- **Type:** `number` (integer)
- **Range:** Monotonically increasing
- **Initialization:** `Date.now()` at first write
- **Increment:** By 1 for each subsequent write
- **Example:** `1702000010000`, `1702000010001`, `1702000010002`
- **Validation Rule:** 
  - Each write increments by 1
  - Sidebar rejects events with `revision <= lastRevision`
- **Purpose:** Deduplicate out-of-order storage.onChanged events

---

## VALIDATION RULES SUMMARY

### Quick Tab Object Validation

```javascript
function validateQuickTab(tab) {
  const errors = [];
  
  // Required fields
  if (!tab.id || typeof tab.id !== 'string' || !tab.id.startsWith('qt-')) {
    errors.push('Invalid id: must be string starting with "qt-"');
  }
  
  if (!tab.url || typeof tab.url !== 'string' || !tab.url.startsWith('http')) {
    errors.push('Invalid url: must be http/https URL');
  }
  
  if (typeof tab.originTabId !== 'number' || tab.originTabId < 1) {
    errors.push('Invalid originTabId: must be positive number');
  }
  
  if (!tab.position || typeof tab.position.left !== 'number' || tab.position.left < 0) {
    errors.push('Invalid position.left: must be non-negative number');
  }
  
  if (!tab.position || typeof tab.position.top !== 'number' || tab.position.top < 0) {
    errors.push('Invalid position.top: must be non-negative number');
  }
  
  if (!tab.size || typeof tab.size.width !== 'number' || tab.size.width <= 0) {
    errors.push('Invalid size.width: must be positive number');
  }
  
  if (!tab.size || typeof tab.size.height !== 'number' || tab.size.height <= 0) {
    errors.push('Invalid size.height: must be positive number');
  }
  
  if (typeof tab.minimized !== 'boolean') {
    errors.push('Invalid minimized: must be boolean');
  }
  
  if (typeof tab.creationTime !== 'number' || tab.creationTime < 1000000000000) {
    errors.push('Invalid creationTime: must be valid timestamp');
  }
  
  if (typeof tab.lastModified !== 'number' || tab.lastModified < tab.creationTime) {
    errors.push('Invalid lastModified: must be >= creationTime');
  }
  
  // Optional fields
  if (tab.title !== undefined && tab.title !== null && typeof tab.title !== 'string') {
    errors.push('Invalid title: must be string or null');
  }
  
  if (tab.favicon !== undefined && tab.favicon !== null && !tab.favicon.startsWith('data:image/')) {
    errors.push('Invalid favicon: must be data URI or null');
  }
  
  if (tab.containerColor !== undefined && tab.containerColor !== null && !/^#[0-9A-F]{6}$/i.test(tab.containerColor)) {
    errors.push('Invalid containerColor: must be hex color or null');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}
```

### State Object Validation

```javascript
function validateGlobalState(state) {
  const errors = [];
  
  if (typeof state.version !== 'number' || state.version !== 2) {
    errors.push('Invalid version: must be 2');
  }
  
  if (typeof state.lastModified !== 'number' || state.lastModified < 1000000000000) {
    errors.push('Invalid lastModified: must be valid timestamp');
  }
  
  if (typeof state.isInitialized !== 'boolean') {
    errors.push('Invalid isInitialized: must be boolean');
  }
  
  if (!Array.isArray(state.tabs)) {
    errors.push('Invalid tabs: must be array');
  }
  
  if (state.tabs.length > 1000) {
    errors.push('Invalid tabs: array too large (max 1000)');
  }
  
  // Validate each tab
  state.tabs.forEach((tab, index) => {
    const validation = validateQuickTab(tab);
    if (!validation.isValid) {
      errors.push(`Tab ${index}: ${validation.errors.join('; ')}`);
    }
  });
  
  // Check for duplicate IDs
  const ids = new Set();
  state.tabs.forEach(tab => {
    if (ids.has(tab.id)) {
      errors.push(`Duplicate tab id: ${tab.id}`);
    }
    ids.add(tab.id);
  });
  
  return {
    isValid: errors.length === 0,
    errors
  };
}
```

---

## SERIALIZATION/DESERIALIZATION

### Serialization (State → Storage)

```javascript
async function serializeStateToStorage(state) {
  // Validate before serialization
  const validation = validateGlobalState(state);
  if (!validation.isValid) {
    throw new Error(`Invalid state: ${validation.errors.join(', ')}`);
  }
  
  // Create storage object
  const toStore = {
    tabs: state.tabs,
    lastModified: state.lastModified,
    writeSequence: _storageWriteSequence,
    revision: _storageRevision,
    checksum: _computeStateChecksum(state.tabs)
  };
  
  // Write to storage
  await browser.storage.local.set({
    'quick_tabs_state_v2': toStore
  });
  
  return toStore;
}
```

### Deserialization (Storage → State)

```javascript
async function deserializeStateFromStorage() {
  const result = await browser.storage.local.get('quick_tabs_state_v2');
  const stored = result['quick_tabs_state_v2'];
  
  if (!stored) {
    console.warn('[Background] No stored state, starting with empty');
    return null;
  }
  
  // Validate structure
  if (!Array.isArray(stored.tabs)) {
    throw new Error('Stored state missing tabs array');
  }
  
  // Validate each tab
  const validation = validateGlobalState({
    version: 2,
    lastModified: stored.lastModified,
    isInitialized: true,
    tabs: stored.tabs
  });
  
  if (!validation.isValid) {
    throw new Error(`Invalid stored state: ${validation.errors.join(', ')}`);
  }
  
  // Validate checksum
  const expectedChecksum = _computeStateChecksum(stored.tabs);
  if (stored.checksum && stored.checksum !== expectedChecksum) {
    throw new Error('Checksum mismatch - storage may be corrupted');
  }
  
  return stored;
}
```

---

## TESTING DATA

### Valid Quick Tab Example

```javascript
const validTab = {
  id: 'qt-1702000000000-abc123',
  url: 'https://github.com/user/repo',
  title: 'GitHub Repository',
  favicon: 'data:image/png;base64,iVBORw0KGgo...',
  originTabId: 42,
  originWindowId: 1,
  position: { left: 100, top: 200 },
  size: { width: 800, height: 600 },
  minimized: false,
  creationTime: 1702000000000,
  lastModified: 1702000010000,
  zIndex: 1000,
  containerColor: '#FF5733'
};
```

### Invalid Quick Tab Examples

```javascript
// Missing required field
const invalid1 = {
  id: 'qt-1702000000000-abc123',
  // missing url
  originTabId: 42
};

// Wrong type
const invalid2 = {
  id: 'qt-1702000000000-abc123',
  url: 'https://example.com',
  originTabId: '42',  // Should be number
  position: { left: 100, top: 200 },
  size: { width: 800, height: 600 },
  minimized: false,
  creationTime: 1702000000000,
  lastModified: 1702000010000
};

// Invalid position
const invalid3 = {
  id: 'qt-1702000000000-abc123',
  url: 'https://example.com',
  originTabId: 42,
  position: { left: -100, top: 200 },  // Negative not allowed
  size: { width: 800, height: 600 },
  minimized: false,
  creationTime: 1702000000000,
  lastModified: 1702000010000
};
```

### Valid Global State Example

```javascript
const validState = {
  version: 2,
  lastModified: 1702000010000,
  isInitialized: true,
  tabs: [
    {
      id: 'qt-1702000000000-abc123',
      url: 'https://github.com',
      originTabId: 1,
      position: { left: 100, top: 200 },
      size: { width: 800, height: 600 },
      minimized: false,
      creationTime: 1702000000000,
      lastModified: 1702000010000
    },
    {
      id: 'qt-1702000001000-def456',
      url: 'https://google.com',
      originTabId: 2,
      position: { left: 950, top: 200 },
      size: { width: 800, height: 600 },
      minimized: false,
      creationTime: 1702000001000,
      lastModified: 1702000010000
    }
  ]
};
```

---

## EDGE CASES & SPECIAL HANDLING

### Orphaned Quick Tabs
- **Definition:** Quick Tab whose `originTabId` no longer exists
- **Detection:** Background checks during cleanup via `browser.tabs.get(originTabId)`
- **Handling:** Keep in state but mark in sidebar (show "orphaned" indicator)
- **Cleanup:** Can be deleted after 24 hours without interaction

### Empty State
- **When:** No Quick Tabs exist
- **Valid:** `{ version: 2, tabs: [], lastModified: now, isInitialized: true }`
- **Display:** Sidebar shows "No Quick Tabs" message
- **Rendering:** DOM should be empty

### Very Large State (100+ tabs)
- **Performance:** Checksum computation is O(n)
- **Serialization:** JSON.stringify might take 50-100ms
- **Storage Write:** IndexedDB write takes ~30-50ms
- **Expected:** Latency still within 200ms window

### Concurrent Modifications
- **Race Condition:** Two tabs create Quick Tab simultaneously
- **Prevention:** Both write different IDs (timestamp + random)
- **Merging:** Background script uses last-write-wins for storage conflicts
- **Sidebar:** storage.onChanged fires for final state anyway

---

## VERSION HISTORY

- **v1.0** (Dec 15, 2025) - Initial specification for schema v2

