/**
 * Schema V2 for Quick Tabs state management
 *
 * All functions are pure - no side effects, use .map(), .filter(), object spread
 * This module provides immutable state transformations for Quick Tabs.
 *
 * NOTE: STORAGE_KEY intentionally uses the same key as existing adapters.
 * The `version` field and `isValidState()` function allow migration detection:
 * - Old format: { containers: {...}, saveId, timestamp } (no version field)
 * - New format: { version: 2, allQuickTabs: [...], managerState: {...} }
 * Migration should check for version field before processing.
 *
 * ## GAP-19 FIX: Version Field Documentation
 *
 * The `version` field is REQUIRED in all state objects for:
 * 1. **Schema Migration Detection** - Identify when state needs migration
 * 2. **Forward Compatibility** - Future schema changes can be detected
 * 3. **Debugging** - Log version mismatches for troubleshooting
 *
 * When reading state, use `validateStateWithDiagnostics()` to get detailed
 * validation info including migration requirements.
 *
 * @module storage/schema-v2
 * @version 1.6.3.8-v13 - GAP-19: Enhanced version field documentation
 */

export const SCHEMA_VERSION = 2;
export const STORAGE_KEY = 'quick_tabs_state_v2';

/**
 * Returns an empty state object with default values
 *
 * @returns {Object} Empty state with schema version and defaults
 */
export function getEmptyState() {
  return {
    version: SCHEMA_VERSION,
    lastModified: Date.now(),
    allQuickTabs: [],
    managerState: {
      position: { x: 20, y: 20 },
      size: { w: 350, h: 500 },
      collapsed: false
    }
  };
}

/**
 * Get Quick Tabs filtered by origin tab ID
 *
 * @param {Object} state - Current state object
 * @param {number} tabId - Origin tab ID to filter by
 * @returns {Array} Array of Quick Tabs belonging to the specified tab
 */
export function getQuickTabsByOriginTabId(state, tabId) {
  if (!state?.allQuickTabs) return [];
  return state.allQuickTabs.filter(qt => qt.originTabId === tabId);
}

/**
 * Find a Quick Tab by its unique ID
 *
 * @param {Object} state - Current state object
 * @param {string} quickTabId - Quick Tab ID to find
 * @returns {Object|null} Quick Tab object or null if not found
 */
export function findQuickTabById(state, quickTabId) {
  if (!state?.allQuickTabs) return null;
  return state.allQuickTabs.find(qt => qt.id === quickTabId) || null;
}

/**
 * Add a new Quick Tab to the state (immutable)
 *
 * @param {Object} state - Current state object
 * @param {Object} quickTab - Quick Tab to add
 * @returns {Object} New state with the Quick Tab added
 */
export function addQuickTab(state, quickTab) {
  const newQuickTab = {
    ...quickTab,
    createdAt: quickTab.createdAt || Date.now()
  };
  return {
    ...state,
    lastModified: Date.now(),
    allQuickTabs: [...state.allQuickTabs, newQuickTab]
  };
}

/**
 * Update an existing Quick Tab (immutable)
 *
 * @param {Object} state - Current state object
 * @param {string} quickTabId - Quick Tab ID to update
 * @param {Object} changes - Properties to update
 * @returns {Object} New state with the Quick Tab updated
 */
export function updateQuickTab(state, quickTabId, changes) {
  return {
    ...state,
    lastModified: Date.now(),
    allQuickTabs: state.allQuickTabs.map(qt => (qt.id === quickTabId ? { ...qt, ...changes } : qt))
  };
}

/**
 * Remove a Quick Tab by ID (immutable)
 *
 * @param {Object} state - Current state object
 * @param {string} quickTabId - Quick Tab ID to remove
 * @returns {Object} New state with the Quick Tab removed
 */
export function removeQuickTab(state, quickTabId) {
  return {
    ...state,
    lastModified: Date.now(),
    allQuickTabs: state.allQuickTabs.filter(qt => qt.id !== quickTabId)
  };
}

/**
 * Remove all Quick Tabs belonging to a specific origin tab (immutable)
 *
 * @param {Object} state - Current state object
 * @param {number} tabId - Origin tab ID whose Quick Tabs should be removed
 * @returns {Object} New state with the Quick Tabs removed
 */
export function removeQuickTabsByOriginTabId(state, tabId) {
  return {
    ...state,
    lastModified: Date.now(),
    allQuickTabs: state.allQuickTabs.filter(qt => qt.originTabId !== tabId)
  };
}

/**
 * Update the manager state (position, size, collapsed) (immutable)
 *
 * @param {Object} state - Current state object
 * @param {Object} changes - Manager state properties to update
 * @returns {Object} New state with manager state updated
 */
export function updateManagerState(state, changes) {
  return {
    ...state,
    lastModified: Date.now(),
    managerState: {
      ...state.managerState,
      ...changes
    }
  };
}

/**
 * Get all minimized Quick Tabs
 *
 * @param {Object} state - Current state object
 * @returns {Array} Array of minimized Quick Tabs
 */
export function getMinimizedQuickTabs(state) {
  if (!state?.allQuickTabs) return [];
  return state.allQuickTabs.filter(qt => qt.minimized === true);
}

/**
 * Get all active (non-minimized) Quick Tabs
 *
 * @param {Object} state - Current state object
 * @returns {Array} Array of active Quick Tabs
 */
export function getActiveQuickTabs(state) {
  if (!state?.allQuickTabs) return [];
  return state.allQuickTabs.filter(qt => !qt.minimized);
}

/**
 * Clear all Quick Tabs from the state (immutable)
 *
 * @param {Object} state - Current state object
 * @returns {Object} New state with all Quick Tabs removed
 */
export function clearAllQuickTabs(state) {
  return {
    ...state,
    lastModified: Date.now(),
    allQuickTabs: []
  };
}

/**
 * Validate that a state object conforms to the V2 schema
 *
 * @param {Object} state - State object to validate
 * @returns {boolean} True if valid, false otherwise
 */
export function isValidState(state) {
  return (
    state !== null &&
    typeof state === 'object' &&
    state.version === SCHEMA_VERSION &&
    Array.isArray(state.allQuickTabs) &&
    typeof state.managerState === 'object'
  );
}

/**
 * Validate state and log warnings for version mismatches
 *
 * GAP-19 FIX: This function validates state and provides diagnostic
 * logging when the version field is missing or doesn't match the
 * current schema version. This helps identify migration issues.
 *
 * @param {Object} state - State object to validate
 * @returns {{isValid: boolean, needsMigration: boolean, warnings: string[]}} Validation result with diagnostics
 */
export function validateStateWithDiagnostics(state) {
  const warnings = [];
  let needsMigration = false;

  if (!state || typeof state !== 'object') {
    return { isValid: false, needsMigration: false, warnings: ['State is null or not an object'] };
  }

  // GAP-19: Check version field
  if (!('version' in state)) {
    warnings.push('Missing version field - state may be from legacy format');
    needsMigration = true;
  } else if (state.version !== SCHEMA_VERSION) {
    warnings.push(`Version mismatch: expected ${SCHEMA_VERSION}, got ${state.version}`);
    needsMigration = true;
  }

  // Check required fields
  if (!Array.isArray(state.allQuickTabs)) {
    warnings.push('Missing or invalid allQuickTabs array');
  }

  if (typeof state.managerState !== 'object') {
    warnings.push('Missing or invalid managerState object');
  }

  // State is valid if there are no warnings (avoids redundant isValidState() call)
  const isValid = warnings.length === 0;

  // Log warnings if any
  if (warnings.length > 0) {
    console.warn('[Schema-V2] State validation warnings:', {
      isValid,
      needsMigration,
      warnings,
      stateVersion: state.version,
      expectedVersion: SCHEMA_VERSION
    });
  }

  return { isValid, needsMigration, warnings };
}

/**
 * Validate that a Quick Tab object has required fields
 *
 * @param {Object} qt - Quick Tab object to validate
 * @returns {boolean} True if valid, false otherwise
 */
export function isValidQuickTab(qt) {
  return (
    qt !== null &&
    typeof qt === 'object' &&
    typeof qt.id !== 'undefined' &&
    typeof qt.originTabId === 'number' &&
    typeof qt.url === 'string'
  );
}
