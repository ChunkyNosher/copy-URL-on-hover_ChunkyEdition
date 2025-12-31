/**
 * Order Manager Module
 * Extracted from quick-tabs-manager.js to reduce code complexity
 *
 * Handles:
 * - Tab group ordering persistence
 * - Quick Tab ordering within groups
 * - Order application during renders
 * - Storage persistence for orders
 *
 * @version 1.6.4
 *
 * v1.6.4 - Extracted from quick-tabs-manager.js for code health improvement
 *   - FIX BUG #3: Quick Tab reordering within groups persistence
 *   - FIX BUG #4: Tab group reordering persistence
 */

// ==================== CONSTANTS ====================

/**
 * Storage key for persisting tab group order across sidebar reloads
 * v1.6.4 - FIX BUG #4
 */
const GROUP_ORDER_STORAGE_KEY = 'quickTabsManagerGroupOrder';

/**
 * Storage key for persisting Quick Tab order within groups
 * v1.6.4 - FIX BUG #3
 */
const QUICK_TAB_ORDER_STORAGE_KEY = 'quickTabsManagerQuickTabOrder';

// ==================== STATE ====================

/**
 * User's preferred tab group order
 * v1.6.4 - FIX BUG #4: Persist tab group ordering during re-renders
 * @private
 */
let _userGroupOrder = [];

/**
 * User's preferred Quick Tab order within each group
 * v1.6.4 - FIX BUG #3: Persist Quick Tab ordering within groups
 * Key: originTabId (string), Value: array of quickTabIds in preferred order
 * @private
 */
let _userQuickTabOrderByGroup = {};

// ==================== GROUP ORDER ====================

/**
 * Check if a group order entry is valid (non-empty string after trimming)
 * v1.6.4 - FIX Code Review: Extracted to reduce duplication between save and load
 * @private
 * @param {*} id - Entry to validate
 * @returns {boolean} True if entry is a valid string
 */
function _isValidGroupOrderEntry(id) {
  return typeof id === 'string' && id.trim() !== '';
}

/**
 * Save user's preferred tab group order from current DOM state
 * v1.6.4 - FIX BUG #4: Persist group ordering across re-renders
 * v1.6.4 - FIX BUG #4: Guard against saving empty order during DOM transitions
 * v1.6.4 - FIX Code Review: Filter out undefined/null values from DOM
 * @param {HTMLElement} container - Container with tab groups
 */
function saveUserGroupOrder(container) {
  const groups = container.querySelectorAll('.tab-group');
  // v1.6.4 - FIX Code Review: Filter out undefined/null dataset values
  const newOrder = Array.from(groups)
    .map(g => g.dataset.originTabId)
    .filter(id => id != null);

  // v1.6.4 - FIX BUG #4: Don't save empty order (could happen during DOM transitions)
  if (newOrder.length === 0) {
    console.warn('[Manager] GROUP_ORDER_SAVE_SKIPPED: Empty order detected, preserving previous', {
      previousOrder: _userGroupOrder,
      timestamp: Date.now()
    });
    return;
  }

  // v1.6.4 - FIX BUG #4: Validate all entries are valid strings
  const invalidEntries = newOrder.filter(id => !_isValidGroupOrderEntry(id));
  if (invalidEntries.length > 0) {
    console.warn('[Manager] GROUP_ORDER_SAVE_SKIPPED: Invalid entries detected', {
      invalidEntries,
      newOrder,
      timestamp: Date.now()
    });
    return;
  }

  _userGroupOrder = newOrder;
  console.log('[Manager] GROUP_ORDER_SAVED:', {
    order: _userGroupOrder,
    timestamp: Date.now()
  });

  // v1.6.4 - FIX BUG #4: Persist to storage for sidebar reload persistence
  // Note: This is intentionally fire-and-forget since group order is non-critical
  // and the async function has internal error handling
  _persistGroupOrderToStorage(newOrder);
}

/**
 * Persist group order to storage (async, fire-and-forget)
 * v1.6.4 - FIX BUG #4: Persist tab group order across sidebar reloads
 * Note: Has internal error handling, safe to call without awaiting
 * @private
 * @param {string[]} order - Array of origin tab IDs in user's preferred order
 */
async function _persistGroupOrderToStorage(order) {
  try {
    await browser.storage.local.set({ [GROUP_ORDER_STORAGE_KEY]: order });
    console.log('[Manager] GROUP_ORDER_PERSISTED:', {
      order,
      timestamp: Date.now()
    });
  } catch (err) {
    console.warn('[Manager] GROUP_ORDER_PERSIST_FAILED:', {
      error: err.message,
      order
    });
  }
}

/**
 * Load group order from storage on Manager initialization
 * v1.6.4 - FIX BUG #4: Restore tab group order after sidebar reload
 */
async function loadGroupOrderFromStorage() {
  try {
    const result = await browser.storage.local.get(GROUP_ORDER_STORAGE_KEY);
    const savedOrder = result?.[GROUP_ORDER_STORAGE_KEY];

    // Early exit if not a valid array
    if (!Array.isArray(savedOrder) || savedOrder.length === 0) {
      console.log('[Manager] GROUP_ORDER_LOAD_SKIPPED: No saved order or empty', {
        savedOrder,
        timestamp: Date.now()
      });
      return;
    }

    // Validate all entries are strings using shared helper
    const validOrder = savedOrder.filter(_isValidGroupOrderEntry);
    if (validOrder.length === 0) {
      console.log('[Manager] GROUP_ORDER_LOAD_SKIPPED: No valid entries after filter', {
        savedOrder,
        timestamp: Date.now()
      });
      return;
    }

    _userGroupOrder = validOrder;
    console.log('[Manager] GROUP_ORDER_LOADED:', {
      order: _userGroupOrder,
      timestamp: Date.now()
    });
  } catch (err) {
    console.warn('[Manager] GROUP_ORDER_LOAD_FAILED:', {
      error: err.message
    });
  }
}

/**
 * Check if value is a valid integer for group key matching
 * v1.6.4 - FIX Code Health: Extracted to reduce _findMatchingGroupKey complexity
 * @private
 * @param {number} num - Number to check
 * @returns {boolean} True if valid integer
 */
function _isValidIntegerKey(num) {
  return !Number.isNaN(num) && Number.isInteger(num);
}

/**
 * Find matching group key trying multiple formats
 * v1.6.4 - FIX BUG #4: More robust key matching
 * v1.6.4 - FIX Code Health: Extracted helper to reduce complexity
 * @private
 * @param {Map} groups - Groups Map
 * @param {string} tabId - Tab ID from user order (always string from DOM dataset)
 * @returns {*} Matching key or null if not found
 */
function _findMatchingGroupKey(groups, tabId) {
  // Try string version first (from dataset)
  if (groups.has(tabId)) return tabId;

  // Try as integer
  const numericId = Number(tabId);
  if (_isValidIntegerKey(numericId) && groups.has(numericId)) {
    return numericId;
  }

  // Try explicit string conversion of the original value
  const strId = String(tabId);
  if (groups.has(strId)) {
    return strId;
  }

  console.log('[Manager] GROUP_ORDER_KEY_NOT_FOUND:', {
    tabId,
    triedFormats: [tabId, numericId, strId],
    availableKeys: Array.from(groups.keys())
  });

  return null;
}

/**
 * Build ordered groups from user's preferred order
 * v1.6.4 - FIX Code Health: Extracted to reduce _applyUserGroupOrder complexity
 * @private
 * @param {Map} groups - Groups Map
 * @returns {{ orderedGroups: Map, processedKeys: Set }}
 */
function _buildOrderedGroupsFromUserOrder(groups) {
  const orderedGroups = new Map();
  const processedKeys = new Set();

  for (const tabId of _userGroupOrder) {
    const matchedKey = _findMatchingGroupKey(groups, tabId);
    if (matchedKey !== null) {
      orderedGroups.set(matchedKey, groups.get(matchedKey));
      processedKeys.add(String(matchedKey));
    }
  }

  return { orderedGroups, processedKeys };
}

/**
 * Apply user's preferred tab group order to a groups Map
 * v1.6.4 - FIX BUG #4: Maintain group ordering across re-renders
 * v1.6.4 - FIX Code Health: Extracted helper to reduce complexity
 * Groups not in user order are appended at the end
 * @param {Map} groups - Map of originTabId -> group data
 * @returns {Map} New Map with groups in user's preferred order
 */
function applyUserGroupOrder(groups) {
  if (!_userGroupOrder || _userGroupOrder.length === 0) {
    console.log('[Manager] GROUP_ORDER_SKIPPED: No user order set');
    return groups;
  }

  console.log('[Manager] GROUP_ORDER_APPLYING:', {
    userOrder: _userGroupOrder,
    groupKeys: Array.from(groups.keys()),
    groupKeyTypes: Array.from(groups.keys()).map(k => typeof k)
  });

  const { orderedGroups, processedKeys } = _buildOrderedGroupsFromUserOrder(groups);

  // Append any groups not in user's order (new groups)
  for (const [key, value] of groups) {
    if (!processedKeys.has(String(key))) {
      orderedGroups.set(key, value);
    }
  }

  console.log('[Manager] GROUP_ORDER_APPLIED:', {
    userOrder: _userGroupOrder,
    resultOrder: Array.from(orderedGroups.keys()),
    inputGroupCount: groups.size,
    outputGroupCount: orderedGroups.size,
    timestamp: Date.now()
  });

  return orderedGroups;
}

// ==================== QUICK TAB ORDER WITHIN GROUPS ====================

/**
 * Save user's preferred Quick Tab order within a group from current DOM state
 * v1.6.4 - FIX BUG #3: Persist Quick Tab ordering within groups across re-renders
 * @param {string} originTabId - Origin tab ID for the group
 * @param {HTMLElement} groupElement - Group element containing Quick Tab items
 */
function saveUserQuickTabOrder(originTabId, groupElement) {
  const content = groupElement.querySelector('.tab-group-content');
  if (!content) {
    console.warn('[Manager] QUICK_TAB_ORDER_SAVE_SKIPPED: No content element', { originTabId });
    return;
  }

  const items = content.querySelectorAll('.quick-tab-item');
  const newOrder = Array.from(items)
    .map(item => item.dataset.tabId)
    // v1.6.4 - Check existence first before calling trim() to avoid potential crash
    .filter(id => id !== null && id !== undefined && String(id).trim() !== '');

  // Don't save empty order (could happen during DOM transitions)
  if (newOrder.length === 0) {
    console.warn('[Manager] QUICK_TAB_ORDER_SAVE_SKIPPED: Empty order detected', {
      originTabId,
      previousOrder: _userQuickTabOrderByGroup[originTabId] || [],
      timestamp: Date.now()
    });
    return;
  }

  _userQuickTabOrderByGroup[originTabId] = newOrder;
  console.log('[Manager] QUICK_TAB_ORDER_SAVED:', {
    originTabId,
    order: newOrder,
    timestamp: Date.now()
  });

  // Persist to storage (fire-and-forget)
  _persistQuickTabOrderToStorage();
}

/**
 * Persist Quick Tab order to storage (async, fire-and-forget)
 * v1.6.4 - FIX BUG #3: Persist Quick Tab order across sidebar reloads
 * @private
 */
async function _persistQuickTabOrderToStorage() {
  try {
    await browser.storage.local.set({ [QUICK_TAB_ORDER_STORAGE_KEY]: _userQuickTabOrderByGroup });
    console.log('[Manager] QUICK_TAB_ORDER_PERSISTED:', {
      groupCount: Object.keys(_userQuickTabOrderByGroup).length,
      timestamp: Date.now()
    });
  } catch (err) {
    console.warn('[Manager] QUICK_TAB_ORDER_PERSIST_FAILED:', {
      error: err.message
    });
  }
}

/**
 * Validate if saved order is a valid non-array object
 * v1.6.4 - FIX Code Health: Extracted to simplify _loadQuickTabOrderFromStorage
 * @private
 * @param {*} savedOrder - Saved order value from storage
 * @returns {boolean} True if valid order object
 */
function _isValidOrderObject(savedOrder) {
  return (
    savedOrder !== null &&
    savedOrder !== undefined &&
    typeof savedOrder === 'object' &&
    !Array.isArray(savedOrder)
  );
}

/**
 * Load Quick Tab order from storage on Manager initialization
 * v1.6.4 - FIX BUG #3: Restore Quick Tab order after sidebar reload
 */
async function loadQuickTabOrderFromStorage() {
  try {
    const result = await browser.storage.local.get(QUICK_TAB_ORDER_STORAGE_KEY);
    const savedOrder = result?.[QUICK_TAB_ORDER_STORAGE_KEY];

    if (!_isValidOrderObject(savedOrder)) {
      console.log('[Manager] QUICK_TAB_ORDER_LOAD_SKIPPED: No saved order or invalid format', {
        savedOrder,
        timestamp: Date.now()
      });
      return;
    }

    _userQuickTabOrderByGroup = savedOrder;
    console.log('[Manager] QUICK_TAB_ORDER_LOADED:', {
      groupCount: Object.keys(_userQuickTabOrderByGroup).length,
      groups: Object.keys(_userQuickTabOrderByGroup),
      timestamp: Date.now()
    });
  } catch (err) {
    console.warn('[Manager] QUICK_TAB_ORDER_LOAD_FAILED:', { error: err.message });
  }
}

/**
 * Check if saved order is valid for applying
 * v1.6.4 - FIX Code Health: Extracted to reduce _applyUserQuickTabOrder complexity
 * @private
 * @param {*} savedOrder - Saved order array
 * @returns {boolean} True if valid non-empty array
 */
function _isValidSavedOrder(savedOrder) {
  return Array.isArray(savedOrder) && savedOrder.length > 0;
}

/**
 * Build ordered tabs from saved order
 * v1.6.4 - FIX Code Health: Extracted to reduce _applyUserQuickTabOrder complexity
 * @private
 * @param {Array} savedOrder - User's saved order
 * @param {Map} tabsById - Map of quickTabId -> quickTab object
 * @returns {{ orderedTabs: Array, processedIds: Set }}
 */
function _buildOrderedTabsFromSavedOrder(savedOrder, tabsById) {
  const orderedTabs = [];
  const processedIds = new Set();

  for (const quickTabId of savedOrder) {
    const tab = tabsById.get(quickTabId);
    if (tab && !processedIds.has(quickTabId)) {
      orderedTabs.push(tab);
      processedIds.add(quickTabId);
    }
  }

  return { orderedTabs, processedIds };
}

/**
 * Apply user's preferred Quick Tab order within a group
 * v1.6.4 - FIX BUG #3: Maintain Quick Tab ordering within groups across re-renders
 * v1.6.4 - FIX Code Health: Extracted helpers to reduce complexity (cc=9 -> cc=4)
 * @param {Array} quickTabs - Array of Quick Tab objects
 * @param {string|number} originTabId - Origin tab ID for the group
 * @returns {Array} Quick Tabs in user's preferred order
 */
function applyUserQuickTabOrder(quickTabs, originTabId) {
  const tabIdStr = String(originTabId);
  const savedOrder = _userQuickTabOrderByGroup[tabIdStr];

  if (!_isValidSavedOrder(savedOrder)) {
    return quickTabs;
  }

  const tabsById = new Map(quickTabs.map(qt => [qt.id, qt]));
  const { orderedTabs, processedIds } = _buildOrderedTabsFromSavedOrder(savedOrder, tabsById);

  // Append any Quick Tabs not in user's order (new Quick Tabs)
  for (const qt of quickTabs) {
    if (!processedIds.has(qt.id)) {
      orderedTabs.push(qt);
    }
  }

  console.log('[Manager] QUICK_TAB_ORDER_APPLIED:', {
    originTabId: tabIdStr,
    savedOrder,
    inputCount: quickTabs.length,
    outputCount: orderedTabs.length,
    inputIds: quickTabs.map(qt => qt.id),
    outputIds: orderedTabs.map(qt => qt.id)
  });

  return orderedTabs;
}

// ==================== STATE ACCESS ====================

/**
 * Get current user group order (for testing/debugging)
 * @returns {string[]} Current group order
 */
function getUserGroupOrder() {
  return [..._userGroupOrder];
}

/**
 * Get current Quick Tab order by group (for testing/debugging)
 * @returns {Object} Current Quick Tab order by group
 */
function getUserQuickTabOrderByGroup() {
  return { ..._userQuickTabOrderByGroup };
}

/**
 * Clear all order state (for testing)
 */
function clearOrderState() {
  _userGroupOrder = [];
  _userQuickTabOrderByGroup = {};
}

// ==================== EXPORTS ====================

export {
  // Constants
  GROUP_ORDER_STORAGE_KEY,
  QUICK_TAB_ORDER_STORAGE_KEY,

  // Group order
  saveUserGroupOrder,
  loadGroupOrderFromStorage,
  applyUserGroupOrder,

  // Quick Tab order
  saveUserQuickTabOrder,
  loadQuickTabOrderFromStorage,
  applyUserQuickTabOrder,

  // State access (for testing/debugging)
  getUserGroupOrder,
  getUserQuickTabOrderByGroup,
  clearOrderState,

  // Internal helpers exported for testing
  _isValidGroupOrderEntry,
  _isValidOrderObject,
  _isValidSavedOrder,
  _findMatchingGroupKey,
  _isValidIntegerKey
};
