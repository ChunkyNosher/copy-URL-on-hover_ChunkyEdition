/**
 * Validation Utility Module
 * Extracted from quick-tabs-manager.js to reduce code complexity
 *
 * Handles:
 * - URL validation
 * - Tab data validation
 * - Host info validation
 * - State validation
 *
 * @version 1.6.4.11
 */

/**
 * Check if a URL is valid for Quick Tab
 * @param {string} url - URL to validate
 * @returns {boolean} True if valid
 */
export function isValidTabUrl(url) {
  return url && url !== 'undefined' && !String(url).includes('/undefined');
}

/**
 * Filter invalid tabs from state
 * v1.6.4.0 - FIX Issue C: Added comprehensive hydration logging
 *   - Logs HYDRATION_STARTED with initial tab count
 *   - Logs HYDRATION_VALIDATION for each tab (valid/blocked)
 *   - Logs HYDRATION_BLOCKED_TABS summary if any blocked
 *   - Logs HYDRATION_COMPLETE with final counts
 *   - IMPORTANT: Does NOT filter orphaned tabs (originTabId null) - they are kept for adoption UI
 * @param {Object} state - State object to filter
 */
export function filterInvalidTabs(state) {
  if (!state.tabs || !Array.isArray(state.tabs)) return;

  const originalCount = state.tabs.length;

  // v1.6.4.0 - FIX Issue C: HYDRATION_STARTED logging
  console.log('[Manager] HYDRATION_STARTED:', {
    tabsFromStorage: originalCount,
    tabIds: state.tabs.map(t => t.id),
    timestamp: Date.now()
  });

  const validTabs = [];
  const blockedTabs = [];
  const blockedReasons = new Set();

  for (const tab of state.tabs) {
    _processTabForHydration(tab, validTabs, blockedTabs, blockedReasons);
  }

  // v1.6.4.0 - FIX Issue C: HYDRATION_BLOCKED_TABS summary
  if (blockedTabs.length > 0) {
    console.warn('[Manager] HYDRATION_BLOCKED_TABS:', {
      count: blockedTabs.length,
      reasons: [...blockedReasons],
      blockedIds: blockedTabs.map(b => b.tab.id)
    });
  }

  // Update state with valid tabs only
  state.tabs = validTabs;

  // Count orphaned tabs in the valid set
  const orphanedCount = validTabs.filter(t => _isOrphanedTab(t)).length;
  const healthyCount = validTabs.length - orphanedCount;

  // v1.6.4.0 - FIX Issue C: HYDRATION_COMPLETE logging
  console.log('[Manager] HYDRATION_COMPLETE:', {
    originalCount,
    resultingCount: validTabs.length,
    healthyTabs: healthyCount,
    orphanedTabs: orphanedCount,
    blockedTabs: blockedTabs.length,
    delta: validTabs.length - originalCount,
    timestamp: Date.now()
  });
}

/**
 * Process a single tab for hydration - extracted to reduce nesting depth
 * v1.6.4.0 - FIX Issue C: Extracted to comply with max-depth rule
 * @private
 * @param {Object} tab - Tab to process
 * @param {Array} validTabs - Array to add valid tabs to
 * @param {Array} blockedTabs - Array to add blocked tabs to
 * @param {Set} blockedReasons - Set to track block reasons
 */
function _processTabForHydration(tab, validTabs, blockedTabs, blockedReasons) {
  const validationResult = _validateTabForHydration(tab);

  if (!validationResult.valid) {
    blockedTabs.push({ tab, reason: validationResult.reason });
    blockedReasons.add(validationResult.reason);
    console.warn('[Manager] HYDRATION_VALIDATION:', {
      tabId: tab.id,
      status: 'blocked',
      reason: validationResult.reason,
      url: tab.url?.substring(0, 50)
    });
    return;
  }

  validTabs.push(tab);
  _logValidTabHydration(tab);
}

/**
 * Log hydration status for a valid tab
 * v1.6.4.0 - FIX Issue C: Extracted to reduce nesting depth
 * @private
 * @param {Object} tab - Valid tab
 */
function _logValidTabHydration(tab) {
  if (_isOrphanedTab(tab)) {
    console.log('[Manager] HYDRATION_KEPT_FOR_RECOVERY:', {
      tabId: tab.id,
      originTabId: tab.originTabId,
      reason: 'originTabId is null/invalid - can be adopted'
    });
  } else {
    console.log('[Manager] HYDRATION_VALIDATION:', {
      tabId: tab.id,
      status: 'valid',
      originTabId: tab.originTabId
    });
  }
}

/**
 * Validate a tab for hydration
 * v1.6.4.0 - FIX Issue C: Extracted validation logic with detailed results
 * @private
 * @param {Object} tab - Tab to validate
 * @returns {{ valid: boolean, reason?: string }}
 */
function _validateTabForHydration(tab) {
  // Check for invalid URL - this is the only thing we filter out
  if (!isValidTabUrl(tab.url)) {
    return { valid: false, reason: 'invalid_url' };
  }

  // IMPORTANT: We do NOT filter orphaned tabs (originTabId null/undefined)
  // They are kept in state for the adoption UI to display
  // The groupQuickTabsByOriginTab() function will group them into 'orphaned' group

  return { valid: true };
}

/**
 * Check if a tab is orphaned (no valid originTabId)
 * v1.6.4.0 - FIX Issue C: Helper for hydration logging
 * @private
 * @param {Object} tab - Tab to check
 * @returns {boolean} True if orphaned
 */
function _isOrphanedTab(tab) {
  // Orphaned = originTabId is null, undefined, or not a positive integer
  if (tab.originTabId === null || tab.originTabId === undefined) {
    return true;
  }
  const numericId = Number(tab.originTabId);
  return isNaN(numericId) || !Number.isInteger(numericId) || numericId <= 0;
}

/**
 * Validate Quick Tab host info has required fields
 * @param {Object} hostInfo - Host info object
 * @returns {boolean} True if valid
 */
export function isValidQuickTabHostInfo(hostInfo) {
  if (!hostInfo) return false;

  // Must have a valid hostTabId
  if (hostInfo.hostTabId === null || hostInfo.hostTabId === undefined) {
    return false;
  }

  // hostTabId should be a positive number
  if (typeof hostInfo.hostTabId !== 'number' || hostInfo.hostTabId < 0) {
    return false;
  }

  return true;
}

/**
 * Check if tab should be processed based on current browser tab context
 * @param {Object} tab - Quick Tab data
 * @param {number|null} currentBrowserTabId - Current browser tab ID
 * @returns {boolean} True if tab should be processed
 */
export function shouldProcessTab(tab, currentBrowserTabId) {
  // If no current tab ID, process all tabs
  if (currentBrowserTabId === null || currentBrowserTabId === undefined) {
    return true;
  }

  // If tab has no originTabId, it's orphaned - process it
  if (tab.originTabId === null || tab.originTabId === undefined) {
    return true;
  }

  // Only process tabs belonging to current browser tab
  return tab.originTabId === currentBrowserTabId;
}

/**
 * Validate tab ID is a valid number
 * @param {*} tabId - Tab ID to validate
 * @returns {boolean} True if valid
 */
export function isValidTabId(tabId) {
  return typeof tabId === 'number' && tabId >= 0 && !isNaN(tabId);
}

/**
 * Validate Quick Tab ID format
 * @param {string} quickTabId - Quick Tab ID to validate
 * @returns {boolean} True if valid
 */
export function isValidQuickTabId(quickTabId) {
  return typeof quickTabId === 'string' && quickTabId.length > 0;
}

/**
 * Validate storage state structure
 * @param {Object} state - State object to validate
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateStorageState(state) {
  if (!state) {
    return { valid: true }; // Empty state is valid
  }

  if (typeof state !== 'object') {
    return { valid: false, error: 'State is not an object' };
  }

  // Check for unified format
  if (state.tabs !== undefined && !Array.isArray(state.tabs)) {
    return { valid: false, error: 'State.tabs is not an array' };
  }

  return { valid: true };
}

/**
 * Check if a numeric pair is valid
 * @private
 * @param {*} a - First value
 * @param {*} b - Second value
 * @returns {boolean} True if both are valid numbers
 */
function _isValidNumericPair(a, b) {
  return typeof a === 'number' && typeof b === 'number' && !isNaN(a) && !isNaN(b);
}

/**
 * Check if position data is valid
 * @param {Object} tab - Tab object with position data
 * @returns {boolean} True if position is valid
 */
export function hasValidPosition(tab) {
  // Check flat format first
  if (_isValidNumericPair(tab.left, tab.top)) {
    return true;
  }

  // Check nested format
  if (!tab.position) return false;
  const left = tab.position.left ?? tab.position.x;
  const top = tab.position.top ?? tab.position.y;
  return _isValidNumericPair(left, top);
}

/**
 * Check if size data is valid
 * @param {Object} tab - Tab object with size data
 * @returns {boolean} True if size is valid
 */
export function hasValidSize(tab) {
  // Check flat format
  if (typeof tab.width === 'number' && typeof tab.height === 'number') {
    return tab.width > 0 && tab.height > 0;
  }

  // Check nested format
  if (tab.size) {
    return (
      typeof tab.size.width === 'number' &&
      typeof tab.size.height === 'number' &&
      tab.size.width > 0 &&
      tab.size.height > 0
    );
  }

  return false;
}

/**
 * Get position value from flat or nested format
 * @param {Object} tab - Quick Tab data
 * @param {string} flatKey - Key for flat format (e.g., 'width')
 * @param {string} nestedKey - Key for nested format (e.g., 'size')
 * @param {string} prop - Property name (e.g., 'width')
 * @returns {number|undefined} The value or undefined
 */
export function getValue(tab, flatKey, nestedKey, prop) {
  return tab[flatKey] ?? tab[nestedKey]?.[prop];
}

/**
 * Format size and position string for tab metadata
 * @param {Object} tab - Quick Tab data
 * @returns {string|null} Formatted size/position string or null
 */
export function formatSizePosition(tab) {
  const width = getValue(tab, 'width', 'size', 'width');
  const height = getValue(tab, 'height', 'size', 'height');

  if (!width || !height) {
    return null;
  }

  let sizeStr = `${Math.round(width)}×${Math.round(height)}`;

  const left = getValue(tab, 'left', 'position', 'left');
  const top = getValue(tab, 'top', 'position', 'top');

  // Only show position if both values exist
  if (left != null && top != null) {
    sizeStr += ` at (${Math.round(left)}, ${Math.round(top)})`;
  }

  return sizeStr;
}

/**
 * Validate collapse state object
 * @param {Object} collapseState - Collapse state object
 * @returns {Object} Valid collapse state (empty object if invalid)
 */
export function validateCollapseState(collapseState) {
  if (!collapseState || typeof collapseState !== 'object' || Array.isArray(collapseState)) {
    return {};
  }
  return collapseState;
}
