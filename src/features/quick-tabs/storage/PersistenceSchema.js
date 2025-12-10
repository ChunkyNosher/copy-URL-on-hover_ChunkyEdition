/**
 * PersistenceSchema - Selective Persistence for Non-Critical Data
 * v1.6.4.15 - Phase 3B Optimization #3: Define persistent vs transient fields
 *
 * Purpose: Reduce storage operations by 30-40% by only persisting critical fields
 * and rebuilding derived/transient data on load.
 *
 * Features:
 * - Define schema for persistent fields (id, url, position, size, minimized, etc.)
 * - Define transient fields (displayTitle, computedStyles, uiState)
 * - Extract persistent subset for storage writes
 * - Reconstruct full state with computed fields on load
 *
 * Architecture:
 * - Persistent fields are essential for Quick Tab restoration
 * - Transient fields can be recomputed from persistent fields or context
 * - Schema is versioned for future migration support
 *
 * Expected Impact: 30-40% reduction in storage payload size
 *
 * @module PersistenceSchema
 */

// Schema version for migration support
const SCHEMA_VERSION = 1;

// Debug flag
const DEBUG_SCHEMA = false;

/**
 * Persistent field definitions
 * These fields MUST be saved to storage for Quick Tab restoration
 *
 * @constant {Object}
 */
const PERSISTENT_FIELDS = {
  // Identity
  id: { type: 'string', required: true, description: 'Unique Quick Tab identifier' },
  url: { type: 'string', required: true, description: 'URL of the Quick Tab content' },

  // Position
  left: { type: 'number', required: true, default: 0, description: 'Left position in pixels' },
  top: { type: 'number', required: true, default: 0, description: 'Top position in pixels' },

  // Size
  width: { type: 'number', required: true, default: 400, description: 'Width in pixels' },
  height: { type: 'number', required: true, default: 300, description: 'Height in pixels' },

  // State
  minimized: { type: 'boolean', required: true, default: false, description: 'Minimized state' },
  zIndex: { type: 'number', required: false, default: 2147483000, description: 'Z-index layer' },

  // Persistence type
  permanent: {
    type: 'boolean',
    required: false,
    default: true,
    description: 'Whether tab persists across sessions'
  },

  // Ownership
  originTabId: {
    type: 'number',
    required: false,
    default: null,
    description: 'Browser tab ID that owns this Quick Tab'
  },

  // Visibility arrays
  soloedOnTabs: {
    type: 'array',
    required: false,
    default: [],
    description: 'Tab IDs where this is soloed'
  },
  mutedOnTabs: {
    type: 'array',
    required: false,
    default: [],
    description: 'Tab IDs where this is muted'
  },

  // Metadata
  title: { type: 'string', required: false, default: '', description: 'Tab title for display' },
  orphaned: {
    type: 'boolean',
    required: false,
    default: false,
    description: 'Whether origin tab no longer exists'
  }
};

/**
 * Transient field definitions
 * These fields are NOT saved to storage - they are computed/derived
 *
 * @constant {Object}
 */
const TRANSIENT_FIELDS = {
  // Display
  displayTitle: {
    type: 'string',
    compute: tab => tab.title || _extractTitleFromUrl(tab.url),
    description: 'Computed display title'
  },
  favicon: {
    type: 'string',
    compute: tab => _extractFaviconUrl(tab.url),
    description: 'Computed favicon URL'
  },

  // UI State
  isActive: {
    type: 'boolean',
    compute: () => false,
    description: 'Whether tab is currently focused'
  },
  isDragging: {
    type: 'boolean',
    compute: () => false,
    description: 'Whether tab is being dragged'
  },
  isResizing: {
    type: 'boolean',
    compute: () => false,
    description: 'Whether tab is being resized'
  },
  isRendered: {
    type: 'boolean',
    compute: () => false,
    description: 'Whether DOM element exists'
  },

  // Computed styles
  computedLeft: {
    type: 'number',
    compute: tab => tab.left || 0,
    description: 'Computed CSS left value'
  },
  computedTop: {
    type: 'number',
    compute: tab => tab.top || 0,
    description: 'Computed CSS top value'
  },
  computedWidth: {
    type: 'number',
    compute: tab => tab.width || 400,
    description: 'Computed CSS width value'
  },
  computedHeight: {
    type: 'number',
    compute: tab => tab.height || 300,
    description: 'Computed CSS height value'
  },

  // Runtime references (never persisted)
  container: {
    type: 'object',
    compute: () => null,
    description: 'DOM container reference'
  },
  iframe: {
    type: 'object',
    compute: () => null,
    description: 'Iframe element reference'
  },
  dragController: {
    type: 'object',
    compute: () => null,
    description: 'Drag controller instance'
  },
  resizeController: {
    type: 'object',
    compute: () => null,
    description: 'Resize controller instance'
  }
};

/**
 * Extract title from URL (fallback for missing title)
 * @private
 * @param {string} url - URL to extract title from
 * @returns {string} Extracted title
 */
function _extractTitleFromUrl(url) {
  if (!url) return 'Quick Tab';

  try {
    const urlObj = new URL(url);
    // Use hostname as title fallback
    return urlObj.hostname || 'Quick Tab';
  } catch (_err) {
    // Return URL segment if parsing fails
    const parts = url.split('/');
    return parts[parts.length - 1] || 'Quick Tab';
  }
}

/**
 * Extract favicon URL from page URL
 * @private
 * @param {string} url - Page URL
 * @returns {string} Favicon URL
 */
function _extractFaviconUrl(url) {
  if (!url) return '';

  try {
    const urlObj = new URL(url);
    return `${urlObj.origin}/favicon.ico`;
  } catch (_err) {
    return '';
  }
}

/**
 * Log schema operation if debug is enabled
 * @private
 * @param {string} operation - Operation name
 * @param {Object} details - Operation details
 */
function _logOperation(operation, details = {}) {
  if (!DEBUG_SCHEMA) return;
  console.log(`[PersistenceSchema] ${operation}:`, {
    ...details,
    timestamp: Date.now()
  });
}

/**
 * Get list of all persistent field names
 *
 * @returns {string[]} Array of persistent field names
 */
export function getPersistentFieldNames() {
  return Object.keys(PERSISTENT_FIELDS);
}

/**
 * Get list of all transient field names
 *
 * @returns {string[]} Array of transient field names
 */
export function getTransientFieldNames() {
  return Object.keys(TRANSIENT_FIELDS);
}

/**
 * Check if a field is persistent
 *
 * @param {string} fieldName - Field name to check
 * @returns {boolean} True if field should be persisted
 */
export function isPersistentField(fieldName) {
  return fieldName in PERSISTENT_FIELDS;
}

/**
 * Check if a field is transient
 *
 * @param {string} fieldName - Field name to check
 * @returns {boolean} True if field is transient (not persisted)
 */
export function isTransientField(fieldName) {
  return fieldName in TRANSIENT_FIELDS;
}

/**
 * Get the default value for a persistent field
 *
 * @param {string} fieldName - Field name
 * @returns {*} Default value for the field
 */
export function getFieldDefault(fieldName) {
  const field = PERSISTENT_FIELDS[fieldName];
  return field ? field.default : undefined;
}

/**
 * Validate a field value against its schema definition
 *
 * @param {string} fieldName - Field name
 * @param {*} value - Value to validate
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateField(fieldName, value) {
  const field = PERSISTENT_FIELDS[fieldName];
  if (!field) {
    return { valid: true }; // Unknown fields pass validation
  }

  // Check required fields
  if (field.required && (value === undefined || value === null)) {
    return { valid: false, reason: `Required field '${fieldName}' is missing` };
  }

  // Type checking
  if (value !== undefined && value !== null) {
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (actualType !== field.type) {
      return {
        valid: false,
        reason: `Field '${fieldName}' expected ${field.type}, got ${actualType}`
      };
    }
  }

  return { valid: true };
}

/**
 * Get value for a single persistent field
 * @private
 * @param {Object} tab - Tab object
 * @param {string} key - Field key
 * @returns {{ hasValue: boolean, value: * }}
 */
function _getPersistentFieldValue(tab, key) {
  if (key in tab) {
    return { hasValue: true, value: tab[key] };
  }
  const defaultVal = getFieldDefault(key);
  if (defaultVal !== undefined) {
    return { hasValue: true, value: defaultVal };
  }
  return { hasValue: false, value: undefined };
}

/**
 * Extract only persistent fields from a Quick Tab object
 * This is used before writing to storage
 *
 * @param {Object} tab - Full Quick Tab object
 * @returns {Object} Object containing only persistent fields
 */
export function extractPersistentFields(tab) {
  if (!tab || typeof tab !== 'object') {
    return {};
  }

  const persistent = {};
  const persistentKeys = getPersistentFieldNames();

  for (const key of persistentKeys) {
    const result = _getPersistentFieldValue(tab, key);
    if (result.hasValue) {
      persistent[key] = result.value;
    }
  }

  _logOperation('EXTRACT_PERSISTENT', {
    inputKeys: Object.keys(tab).length,
    outputKeys: Object.keys(persistent).length,
    tabId: tab.id
  });

  return persistent;
}

/**
 * Extract only persistent fields from an array of Quick Tabs
 *
 * @param {Object[]} tabs - Array of Quick Tab objects
 * @returns {Object[]} Array with only persistent fields
 */
export function extractPersistentTabsArray(tabs) {
  if (!Array.isArray(tabs)) {
    return [];
  }

  return tabs.map(extractPersistentFields);
}

/**
 * Compute transient fields for a Quick Tab
 * This is used after loading from storage
 *
 * @param {Object} persistentTab - Tab with only persistent fields
 * @returns {Object} Object with computed transient fields
 */
export function computeTransientFields(persistentTab) {
  if (!persistentTab || typeof persistentTab !== 'object') {
    return {};
  }

  const transient = {};

  for (const [key, definition] of Object.entries(TRANSIENT_FIELDS)) {
    if (typeof definition.compute === 'function') {
      transient[key] = definition.compute(persistentTab);
    }
  }

  _logOperation('COMPUTE_TRANSIENT', {
    tabId: persistentTab.id,
    computedFields: Object.keys(transient).length
  });

  return transient;
}

/**
 * Reconstruct full Quick Tab object from persistent data
 * Merges persistent fields with computed transient fields
 *
 * @param {Object} persistentTab - Tab with only persistent fields
 * @returns {Object} Full Quick Tab object with all fields
 */
export function reconstructFullTab(persistentTab) {
  if (!persistentTab || typeof persistentTab !== 'object') {
    return null;
  }

  // Start with persistent fields
  const fullTab = { ...persistentTab };

  // Add defaults for missing persistent fields
  for (const [key, definition] of Object.entries(PERSISTENT_FIELDS)) {
    if (!(key in fullTab) && definition.default !== undefined) {
      fullTab[key] = definition.default;
    }
  }

  // Add computed transient fields
  const transient = computeTransientFields(fullTab);
  Object.assign(fullTab, transient);

  _logOperation('RECONSTRUCT_FULL', {
    tabId: fullTab.id,
    totalFields: Object.keys(fullTab).length
  });

  return fullTab;
}

/**
 * Reconstruct full state from persistent storage data
 *
 * @param {Object} persistentState - State with only persistent fields
 * @returns {Object} Full state with computed fields
 */
export function reconstructFullState(persistentState) {
  if (!persistentState || !Array.isArray(persistentState.tabs)) {
    return { tabs: [], saveId: null, timestamp: 0 };
  }

  const fullTabs = persistentState.tabs.map(reconstructFullTab).filter(Boolean);

  return {
    tabs: fullTabs,
    saveId: persistentState.saveId,
    timestamp: persistentState.timestamp || Date.now()
  };
}

/**
 * Prepare state for storage by extracting only persistent fields
 *
 * @param {Object} state - Full state object
 * @returns {Object} State with only persistent fields
 */
export function prepareStateForStorage(state) {
  if (!state || !Array.isArray(state.tabs)) {
    return { tabs: [], saveId: state?.saveId, timestamp: Date.now() };
  }

  const persistentTabs = extractPersistentTabsArray(state.tabs);

  const result = {
    tabs: persistentTabs,
    saveId: state.saveId,
    timestamp: state.timestamp || Date.now()
  };

  _logOperation('PREPARE_FOR_STORAGE', {
    inputTabCount: state.tabs.length,
    outputTabCount: persistentTabs.length
  });

  return result;
}

/**
 * Calculate storage size reduction from using schema
 *
 * @param {Object} fullState - Full state object
 * @returns {{ fullSize: number, persistentSize: number, reduction: number, percentSaved: string }}
 */
export function calculateSizeReduction(fullState) {
  if (!fullState) {
    return { fullSize: 0, persistentSize: 0, reduction: 0, percentSaved: '0%' };
  }

  const fullSize = JSON.stringify(fullState).length;
  const persistentState = prepareStateForStorage(fullState);
  const persistentSize = JSON.stringify(persistentState).length;
  const reduction = fullSize - persistentSize;
  const percentSaved = fullSize > 0 ? ((reduction / fullSize) * 100).toFixed(1) + '%' : '0%';

  return {
    fullSize,
    persistentSize,
    reduction,
    percentSaved
  };
}

/**
 * Validate a Quick Tab object against the schema
 *
 * @param {Object} tab - Quick Tab object to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateTab(tab) {
  const errors = [];

  if (!tab || typeof tab !== 'object') {
    return { valid: false, errors: ['Tab is not an object'] };
  }

  // Validate each persistent field
  for (const fieldName of getPersistentFieldNames()) {
    const result = validateField(fieldName, tab[fieldName]);
    if (!result.valid) {
      errors.push(result.reason);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate entire state object against schema
 *
 * @param {Object} state - State object to validate
 * @returns {{ valid: boolean, errors: string[], invalidTabs: string[] }}
 */
export function validateState(state) {
  const errors = [];
  const invalidTabs = [];

  if (!state || typeof state !== 'object') {
    return { valid: false, errors: ['State is not an object'], invalidTabs: [] };
  }

  if (!Array.isArray(state.tabs)) {
    return { valid: false, errors: ['State.tabs is not an array'], invalidTabs: [] };
  }

  // Validate each tab
  for (const tab of state.tabs) {
    const result = validateTab(tab);
    if (!result.valid) {
      invalidTabs.push(tab.id || 'unknown');
      errors.push(...result.errors.map(e => `Tab ${tab.id || 'unknown'}: ${e}`));
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    invalidTabs
  };
}

/**
 * Get schema metadata for documentation/debugging
 *
 * @returns {Object} Schema metadata
 */
export function getSchemaMetadata() {
  return {
    version: SCHEMA_VERSION,
    persistentFields: Object.keys(PERSISTENT_FIELDS).map(name => ({
      name,
      ...PERSISTENT_FIELDS[name]
    })),
    transientFields: Object.keys(TRANSIENT_FIELDS).map(name => ({
      name,
      type: TRANSIENT_FIELDS[name].type,
      description: TRANSIENT_FIELDS[name].description
    })),
    persistentCount: Object.keys(PERSISTENT_FIELDS).length,
    transientCount: Object.keys(TRANSIENT_FIELDS).length
  };
}

// Export default object with all methods
export default {
  // Schema version
  SCHEMA_VERSION,

  // Field queries
  getPersistentFieldNames,
  getTransientFieldNames,
  isPersistentField,
  isTransientField,
  getFieldDefault,
  validateField,

  // Extraction and reconstruction
  extractPersistentFields,
  extractPersistentTabsArray,
  computeTransientFields,
  reconstructFullTab,
  reconstructFullState,
  prepareStateForStorage,

  // Validation
  validateTab,
  validateState,

  // Utilities
  calculateSizeReduction,
  getSchemaMetadata
};
