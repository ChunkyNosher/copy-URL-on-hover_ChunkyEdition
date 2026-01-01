/**
 * Storage Change Analyzer Module
 * Extracted from quick-tabs-manager.js to reduce code complexity
 *
 * Handles:
 * - Storage change analysis to determine if render is needed
 * - Tab change detection (count, data, metadata)
 * - Suspicious storage drop detection
 * - Change context building and logging
 *
 * @version 1.6.4
 *
 * v1.6.4 - Extracted from quick-tabs-manager.js for code health improvement
 *   - Storage change analysis functions
 *   - Tab change detection helpers
 *   - Logging helpers for storage events
 */

// ==================== CONSTANTS ====================

/**
 * Save ID markers for reconciliation and clearing operations
 * v1.6.4 - Extracted from quick-tabs-manager.js
 */
const SAVEID_RECONCILED = 'reconciled';
const SAVEID_CLEARED = 'cleared';

// ==================== ANALYSIS RESULT BUILDERS ====================

/**
 * Build analysis result for storage change
 * v1.6.3.11-v3 - FIX CodeScene: Extract from _analyzeStorageChange
 * v1.6.3.11-v9 - FIX CodeScene: Use options object to reduce argument count
 * @param {Object} options - Analysis result options
 * @param {boolean} options.requiresRender - Whether render is required
 * @param {boolean} options.hasDataChange - Whether data changed
 * @param {string} options.changeType - Type of change
 * @param {string} options.changeReason - Reason for change
 * @param {string} [options.skipReason] - Reason for skipping (optional)
 * @returns {Object} Analysis result
 */
function buildAnalysisResult(options) {
  return {
    requiresRender: options.requiresRender,
    hasDataChange: options.hasDataChange,
    changeType: options.changeType,
    changeReason: options.changeReason,
    skipReason: options.skipReason ?? null
  };
}

/**
 * Create analysis result for tab count change
 * v1.6.3.11-v9 - FIX CodeScene: Extracted to reduce _analyzeStorageChange complexity
 * @param {number} oldCount - Previous tab count
 * @param {number} newCount - New tab count
 * @returns {Object} Analysis result
 */
function buildTabCountChangeResult(oldCount, newCount) {
  return buildAnalysisResult({
    requiresRender: true,
    hasDataChange: true,
    changeType: 'tab-count',
    changeReason: `Tab count changed: ${oldCount} → ${newCount}`
  });
}

/**
 * Create analysis result for metadata-only change
 * v1.6.3.11-v9 - FIX CodeScene: Extracted to reduce _analyzeStorageChange complexity
 * @param {Object} zIndexChanges - Z-index change details
 * @returns {Object} Analysis result
 */
function buildMetadataOnlyResult(zIndexChanges) {
  return buildAnalysisResult({
    requiresRender: false,
    hasDataChange: false,
    changeType: 'metadata-only',
    changeReason: 'z-index only',
    skipReason: `Only z-index changed: ${JSON.stringify(zIndexChanges)}`
  });
}

/**
 * Create analysis result for data change
 * v1.6.3.11-v9 - FIX CodeScene: Extracted to reduce _analyzeStorageChange complexity
 * @param {Array<string>} dataChangeReasons - Reasons for data change
 * @returns {Object} Analysis result
 */
function buildDataChangeResult(dataChangeReasons) {
  return buildAnalysisResult({
    requiresRender: true,
    hasDataChange: true,
    changeType: 'data',
    changeReason: dataChangeReasons.join('; ')
  });
}

/**
 * Create analysis result for no changes
 * v1.6.3.11-v9 - FIX CodeScene: Extracted to reduce _analyzeStorageChange complexity
 * @returns {Object} Analysis result
 */
function buildNoChangesResult() {
  return buildAnalysisResult({
    requiresRender: false,
    hasDataChange: false,
    changeType: 'none',
    changeReason: 'no changes',
    skipReason: 'No detectable changes between old and new state'
  });
}

// ==================== TAB DATA EXTRACTION ====================

/**
 * Get tabs array from storage value safely
 * v1.6.3.11-v9 - FIX CodeScene: Extracted to reduce _analyzeStorageChange complexity
 * @param {Object} value - Storage value object
 * @returns {Array} Tabs array or empty array
 */
function getTabsFromValue(value) {
  return value?.tabs || [];
}

// ==================== SINGLE TAB CHANGE DETECTION ====================

/**
 * Check a single tab for data changes
 * v1.6.3.7 - FIX Issue #3: Helper to reduce _analyzeStorageChange complexity
 * v1.6.3.11-v3 - FIX CodeScene: Use data-driven approach to reduce complexity
 * @param {Object} oldTab - Previous tab state
 * @param {Object} newTab - New tab state
 * @returns {{ hasDataChange: boolean, reasons: Array<string> }}
 */
function checkSingleTabDataChanges(oldTab, newTab) {
  const reasons = [];
  const tabId = newTab.id;

  // Data-driven change checks
  const checks = [
    {
      cond: oldTab.originTabId !== newTab.originTabId,
      msg: `originTabId changed for ${tabId}: ${oldTab.originTabId} → ${newTab.originTabId}`
    },
    { cond: oldTab.minimized !== newTab.minimized, msg: `minimized changed for ${tabId}` },
    {
      cond: oldTab.left !== newTab.left || oldTab.top !== newTab.top,
      msg: `position changed for ${tabId}`
    },
    {
      cond: oldTab.width !== newTab.width || oldTab.height !== newTab.height,
      msg: `size changed for ${tabId}`
    },
    {
      cond: oldTab.title !== newTab.title || oldTab.url !== newTab.url,
      msg: `title/url changed for ${tabId}`
    }
  ];

  checks.forEach(check => {
    if (check.cond) reasons.push(check.msg);
  });

  return { hasDataChange: reasons.length > 0, reasons };
}

// ==================== TAB CHANGE ANALYSIS ====================

/**
 * Check all tabs for data and metadata changes
 * v1.6.3.7 - FIX Issue #3: Helper to reduce _analyzeStorageChange complexity
 * @param {Array} oldTabs - Previous tabs array
 * @param {Array} newTabs - New tabs array
 * @returns {{ hasDataChange: boolean, hasMetadataOnlyChange: boolean, zIndexChanges: Array, dataChangeReasons: Array }}
 */
function checkTabChanges(oldTabs, newTabs) {
  const oldTabMap = new Map(oldTabs.map(t => [t.id, t]));

  let hasDataChange = false;
  let hasMetadataOnlyChange = false;
  const zIndexChanges = [];
  const dataChangeReasons = [];

  for (const newTab of newTabs) {
    const oldTab = oldTabMap.get(newTab.id);

    if (!oldTab) {
      // New tab ID - requires render
      hasDataChange = true;
      dataChangeReasons.push(`New tab: ${newTab.id}`);
      continue;
    }

    // Check for data changes
    const dataResult = checkSingleTabDataChanges(oldTab, newTab);
    if (dataResult.hasDataChange) {
      hasDataChange = true;
      dataChangeReasons.push(...dataResult.reasons);
    }

    // Check for metadata-only changes (z-index)
    if (oldTab.zIndex !== newTab.zIndex) {
      hasMetadataOnlyChange = true;
      zIndexChanges.push({ id: newTab.id, old: oldTab.zIndex, new: newTab.zIndex });
    }
  }

  return {
    hasDataChange,
    hasMetadataOnlyChange,
    zIndexChanges,
    dataChangeReasons
  };
}

/**
 * Determine the appropriate result based on change analysis
 * v1.6.3.11-v9 - FIX CodeScene: Extracted to reduce _analyzeStorageChange complexity
 * @param {Object} changeResults - Results from checkTabChanges
 * @returns {Object} Analysis result
 */
function buildResultFromChangeAnalysis(changeResults) {
  // If only z-index changed, skip render
  if (!changeResults.hasDataChange && changeResults.hasMetadataOnlyChange) {
    return buildMetadataOnlyResult(changeResults.zIndexChanges);
  }

  // If there are data changes, render is required
  if (changeResults.hasDataChange) {
    return buildDataChangeResult(changeResults.dataChangeReasons);
  }

  // No changes detected
  return buildNoChangesResult();
}

/**
 * Analyze storage change to determine if renderUI() is needed
 * v1.6.3.7 - FIX Issue #3: Differential update detection
 * v1.6.3.11-v3 - FIX CodeScene: Reduce complexity by extracting result builder
 * v1.6.3.11-v9 - FIX CodeScene: Reduce complexity by extracting result factories and change analysis
 * @param {Object} oldValue - Previous storage value
 * @param {Object} newValue - New storage value
 * @returns {{ requiresRender: boolean, hasDataChange: boolean, changeType: string, changeReason: string, skipReason: string }}
 */
function analyzeStorageChange(oldValue, newValue) {
  const oldTabs = getTabsFromValue(oldValue);
  const newTabs = getTabsFromValue(newValue);

  // Tab count change always requires render
  if (oldTabs.length !== newTabs.length) {
    return buildTabCountChangeResult(oldTabs.length, newTabs.length);
  }

  // Check for structural changes and determine result
  const changeResults = checkTabChanges(oldTabs, newTabs);
  return buildResultFromChangeAnalysis(changeResults);
}

// ==================== POSITION/SIZE CHANGE DETECTION ====================

/**
 * Check if position has changed between tabs
 * @param {Object} oldTab - Previous tab state
 * @param {Object} newTab - New tab state
 * @returns {boolean} True if position changed
 */
function hasPositionDiff(oldTab, newTab) {
  if (!newTab.position || !oldTab.position) return false;
  return newTab.position.x !== oldTab.position.x || newTab.position.y !== oldTab.position.y;
}

/**
 * Check if size has changed between tabs
 * @param {Object} oldTab - Previous tab state
 * @param {Object} newTab - New tab state
 * @returns {boolean} True if size changed
 */
function hasSizeDiff(oldTab, newTab) {
  if (!newTab.size || !oldTab.size) return false;
  return newTab.size.width !== oldTab.size.width || newTab.size.height !== oldTab.size.height;
}

/**
 * Identify tabs that have position or size changes
 * v1.6.3.12-v7 - Refactored to reduce bumpy road complexity
 * @param {Array} oldTabs - Previous tab array
 * @param {Array} newTabs - New tab array
 * @returns {{ positionChanged: Array, sizeChanged: Array }}
 */
function identifyChangedTabs(oldTabs, newTabs) {
  const oldTabMap = new Map(oldTabs.map(t => [t.id, t]));
  const positionChanged = [];
  const sizeChanged = [];

  for (const newTab of newTabs) {
    const oldTab = oldTabMap.get(newTab.id);
    if (!oldTab) continue;

    if (hasPositionDiff(oldTab, newTab)) {
      positionChanged.push(newTab.id);
    }

    if (hasSizeDiff(oldTab, newTab)) {
      sizeChanged.push(newTab.id);
    }
  }

  return { positionChanged, sizeChanged };
}

// ==================== SUSPICIOUS DROP DETECTION ====================

/**
 * Check if this is a single tab deletion (legitimate)
 * @param {number} oldTabCount - Previous tab count
 * @param {number} newTabCount - New tab count
 * @returns {boolean} True if single tab deletion
 */
function isSingleTabDeletion(oldTabCount, newTabCount) {
  return oldTabCount === 1 && newTabCount === 0;
}

/**
 * Check if this is an explicit clear operation
 * @param {Object} newValue - New storage value
 * @returns {boolean} True if explicit clear
 */
function isExplicitClearOperation(newValue) {
  if (!newValue) return true;
  const saveId = newValue.saveId || '';
  return saveId.includes(SAVEID_RECONCILED) || saveId.includes(SAVEID_CLEARED);
}

/**
 * Check if storage change is a suspicious drop (potential corruption)
 * v1.6.3.5-v2 - FIX Report 2 Issue #6: Better heuristics for corruption detection
 * v1.6.3.5-v11 - FIX Issue #6: Recognize single-tab deletions as legitimate (N→0 where N=1)
 *   A drop to 0 is only suspicious if:
 *   - More than 1 tab existed before (sudden multi-tab wipe)
 *   - It's not an explicit clear operation (reconciled/cleared saveId)
 * @param {number} oldTabCount - Previous tab count
 * @param {number} newTabCount - New tab count
 * @param {Object} newValue - New storage value
 * @returns {boolean} True if suspicious
 */
function isSuspiciousStorageDrop(oldTabCount, newTabCount, newValue) {
  // Single tab deletion (1→0) is always legitimate - user closed last Quick Tab
  if (isSingleTabDeletion(oldTabCount, newTabCount)) {
    console.log('[Manager] Single tab deletion detected (1→0) - legitimate operation');
    return false;
  }

  // Multi-tab drop to 0 is suspicious unless explicitly cleared
  const isMultiTabDrop = oldTabCount > 1 && newTabCount === 0;
  return isMultiTabDrop && !isExplicitClearOperation(newValue);
}

// ==================== CONTEXT BUILDING ====================

/**
 * Build context object for storage change handling
 * v1.6.3.12-v7 - Extracted to reduce _handleStorageChange complexity
 * v1.6.4-v2 - Added null safety for currentBrowserTabId comparison
 * @param {Object} change - Storage change object
 * @param {number|null} currentBrowserTabId - Current browser tab ID for source comparison
 * @returns {Object} Context with parsed values
 */
function buildStorageChangeContext(change, currentBrowserTabId) {
  const newValue = change.newValue;
  const oldValue = change.oldValue;
  const oldTabCount = oldValue?.tabs?.length ?? 0;
  const newTabCount = newValue?.tabs?.length ?? 0;
  const sourceTabId = newValue?.writingTabId;
  const sourceInstanceId = newValue?.writingInstanceId;
  // v1.6.4-v2: Safe comparison - if currentBrowserTabId is null, never match
  const isFromCurrentTab = currentBrowserTabId !== null && sourceTabId === currentBrowserTabId;

  return {
    newValue,
    oldValue,
    oldTabCount,
    newTabCount,
    sourceTabId,
    sourceInstanceId,
    isFromCurrentTab
  };
}

// ==================== LOGGING HELPERS ====================

/**
 * Log storage change event with comprehensive details
 * Issue #8: Unified logStorageEvent() format for sequence analysis
 * v1.6.3.12-v7 - Extracted to reduce _handleStorageChange complexity
 * v1.6.3.6-v11 - FIX Issue #8: Unified storage event logging format
 * @param {Object} context - Storage change context
 * @param {number|null} currentBrowserTabId - Current browser tab ID
 */
function logStorageChangeEvent(context, currentBrowserTabId) {
  // Issue #8: Determine what changed (added/removed tab IDs)
  const oldIds = new Set((context.oldValue?.tabs || []).map(t => t.id));
  const newIds = new Set((context.newValue?.tabs || []).map(t => t.id));
  const addedIds = [...newIds].filter(id => !oldIds.has(id));
  const removedIds = [...oldIds].filter(id => !newIds.has(id));

  // Issue #8: Unified format for storage event logging
  console.log(
    `[Manager] STORAGE_CHANGED: tabs ${context.oldTabCount}→${context.newTabCount} (delta: ${context.newTabCount - context.oldTabCount}), saveId: '${context.newValue?.saveId || 'none'}', source: tab-${context.sourceTabId || 'unknown'}`,
    {
      changes: {
        added: addedIds,
        removed: removedIds
      },
      oldTabCount: context.oldTabCount,
      newTabCount: context.newTabCount,
      delta: context.newTabCount - context.oldTabCount,
      saveId: context.newValue?.saveId,
      transactionId: context.newValue?.transactionId,
      writingTabId: context.sourceTabId,
      writingInstanceId: context.sourceInstanceId,
      isFromCurrentTab: context.isFromCurrentTab,
      currentBrowserTabId,
      timestamp: context.newValue?.timestamp,
      processedAt: Date.now()
    }
  );
}

/**
 * Log tab ID changes (added/removed)
 * v1.6.3.12-v7 - Extracted to reduce _handleStorageChange complexity
 * @param {Object} context - Storage change context
 */
function logTabIdChanges(context) {
  const oldIds = new Set((context.oldValue?.tabs || []).map(t => t.id));
  const newIds = new Set((context.newValue?.tabs || []).map(t => t.id));
  const addedIds = [...newIds].filter(id => !oldIds.has(id));
  const removedIds = [...oldIds].filter(id => !newIds.has(id));

  if (addedIds.length > 0 || removedIds.length > 0) {
    console.log('[Manager] storage.onChanged tab changes:', {
      addedIds,
      removedIds,
      addedCount: addedIds.length,
      removedCount: removedIds.length
    });
  }
}

/**
 * Log position/size changes for tabs
 * v1.6.3.12-v7 - Extracted to reduce _handleStorageChange complexity
 * @param {Object} context - Storage change context
 */
function logPositionSizeChanges(context) {
  if (!context.newValue?.tabs || !context.oldValue?.tabs) {
    return;
  }

  const changedTabs = identifyChangedTabs(context.oldValue.tabs, context.newValue.tabs);
  const hasChanges = changedTabs.positionChanged.length > 0 || changedTabs.sizeChanged.length > 0;

  if (hasChanges) {
    console.log('[Manager] 📐 POSITION_SIZE_UPDATE_RECEIVED:', {
      positionChangedIds: changedTabs.positionChanged,
      sizeChangedIds: changedTabs.sizeChanged,
      sourceTabId: context.sourceTabId,
      isFromCurrentTab: context.isFromCurrentTab
    });
  }
}

// ==================== EXPORTS ====================

export {
  // Constants
  SAVEID_RECONCILED,
  SAVEID_CLEARED,

  // Analysis result builders
  buildAnalysisResult,
  buildTabCountChangeResult,
  buildMetadataOnlyResult,
  buildDataChangeResult,
  buildNoChangesResult,

  // Tab data extraction
  getTabsFromValue,

  // Single tab change detection
  checkSingleTabDataChanges,

  // Tab change analysis
  checkTabChanges,
  buildResultFromChangeAnalysis,
  analyzeStorageChange,

  // Position/size change detection
  hasPositionDiff,
  hasSizeDiff,
  identifyChangedTabs,

  // Suspicious drop detection
  isSingleTabDeletion,
  isExplicitClearOperation,
  isSuspiciousStorageDrop,

  // Context building
  buildStorageChangeContext,

  // Logging helpers
  logStorageChangeEvent,
  logTabIdChanges,
  logPositionSizeChanges
};
