/**
 * Render Manager Module
 * Extracted from quick-tabs-manager.js to reduce code complexity
 *
 * Handles:
 * - Render scheduling and debouncing
 * - UI element creation for tab groups and Quick Tab items
 * - State hash computation for render deduplication
 * - Empty state handling
 * - Group ordering and sorting
 *
 * @version 1.6.4
 *
 * v1.6.4 - Extracted from quick-tabs-manager.js for code health improvement
 *   - scheduleRender and debounce logic
 *   - State hash computation
 *   - UI element creation helpers
 *   - Render performance logging
 */

// ==================== IMPORTS ====================
import {
  computeStateHash,
  extractTabsFromState,
  isTabMinimizedHelper as isMinimized
} from '../utils/render-helpers.js';

// ==================== CONSTANTS ====================

/**
 * Render debounce delay in milliseconds
 * v1.6.4 - Extracted from quick-tabs-manager.js
 */
const RENDER_DEBOUNCE_MS = 100;

/**
 * Maximum wait time for sliding-window debounce
 * v1.6.4 - Extracted from quick-tabs-manager.js
 */
const RENDER_DEBOUNCE_MAX_WAIT_MS = 300;

/**
 * Maximum consecutive re-renders allowed
 * v1.6.4 - Extracted from quick-tabs-manager.js
 */
const MAX_CONSECUTIVE_RERENDERS = 3;

// ==================== STATE ====================

/**
 * Render debounce timer
 * @private
 */
let _renderDebounceTimer = null;

/**
 * Last rendered state hash for deduplication
 * @private
 */
let _lastRenderedHash = 0;
let _lastRenderedStateHash = 0;

/**
 * Pending render flag
 * @private
 */
let _pendingRender = false;

/**
 * Sliding-window debounce tracking
 * @private
 */
let _debounceStartTimestamp = 0;
let _debounceExtensionCount = 0;

/**
 * Render lock state
 * @private
 */
let _isRenderInProgress = false;
let _pendingRerenderRequested = false;
let _consecutiveRerenderCount = 0;

/**
 * State version tracking
 * @private
 */
let _stateVersion = 0;
let _stateVersionAtSchedule = 0;
let _lastRenderedStateVersion = 0;

/**
 * External callbacks for Manager integration
 * @private
 */
let _externalCallbacks = {
  getQuickTabsState: null,
  getAllQuickTabsFromPort: null,
  getLastLocalUpdateTime: null,
  renderUI: null
};

/**
 * External state references
 * @private
 */
let _containersList = null;
let _emptyState = null;

// ==================== INITIALIZATION ====================

/**
 * Initialize the RenderManager with external callbacks
 * v1.6.4 - REQUIRED: Must be called before using render functions
 * @param {Object} callbacks - External callbacks
 * @param {Function} callbacks.getQuickTabsState - Get current quickTabsState
 * @param {Function} callbacks.getAllQuickTabsFromPort - Get Quick Tabs from port
 * @param {Function} callbacks.getLastLocalUpdateTime - Get last update time
 * @param {Function} callbacks.renderUI - Actual renderUI function
 * @param {Object} domElements - DOM element references
 * @param {HTMLElement} domElements.containersList - Containers list element
 * @param {HTMLElement} domElements.emptyState - Empty state element
 */
function initialize(callbacks, domElements = {}) {
  _externalCallbacks = { ...callbacks };
  _containersList = domElements.containersList || null;
  _emptyState = domElements.emptyState || null;

  console.log('[RenderManager] Initialized with callbacks', {
    timestamp: Date.now(),
    callbacksProvided: Object.keys(callbacks).filter(k => !!callbacks[k]),
    hasDomElements: !!_containersList
  });
}

// ==================== STATE VERSION ====================

/**
 * Increment state version for external state changes
 * v1.6.4 - Called when state is updated from external sources
 * @param {string} source - Source of state update for logging
 */
function incrementStateVersion(source) {
  _stateVersion++;
  console.log('[RenderManager] STATE_VERSION_INCREMENT:', {
    newVersion: _stateVersion,
    source,
    timestamp: Date.now()
  });
}

/**
 * Get current state version
 * @returns {number} Current state version
 */
function getStateVersion() {
  return _stateVersion;
}

/**
 * Get last rendered state version
 * @returns {number} Last rendered state version
 */
function getLastRenderedStateVersion() {
  return _lastRenderedStateVersion;
}

// ==================== HASH COMPUTATION ====================

/**
 * Compute state hash for render deduplication
 * v1.6.4 - Delegates to render-helpers
 * @param {Object} state - Quick Tabs state
 * @returns {number} Hash value
 */
function computeHash(state) {
  return computeStateHash(state);
}

/**
 * Get last rendered hash
 * @returns {number} Last rendered hash
 */
function getLastRenderedHash() {
  return _lastRenderedStateHash;
}

/**
 * Update last rendered hash after render
 * @param {number} hash - New hash value
 */
function updateLastRenderedHash(hash) {
  _lastRenderedHash = hash;
  _lastRenderedStateHash = hash;
}

// ==================== LOGGING HELPERS ====================

/**
 * Log hash computation for render scheduling
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @private
 */
function _logHashComputation(scheduleTimestamp, source, currentHash, state) {
  console.log('[RenderManager] DEBOUNCE_HASH_COMPUTED:', {
    timestamp: scheduleTimestamp,
    source,
    hashValue: currentHash,
    previousHash: _lastRenderedStateHash,
    hashChanged: currentHash !== _lastRenderedStateHash,
    stateTabCount: state?.tabs?.length || 0
  });
}

/**
 * Log when render is skipped due to hash match
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @private
 */
function _logRenderSkipped(scheduleTimestamp, source, currentHash, correlationId) {
  console.log('[RenderManager] RENDER_DEDUPLICATION: hash unchanged', {
    source,
    hash: currentHash,
    correlationId: correlationId || null
  });
  console.log('[RenderManager] DEBOUNCE_SKIPPED_HASH_MATCH:', {
    timestamp: scheduleTimestamp,
    source,
    correlationId: correlationId || null,
    hash: currentHash
  });
}

/**
 * Build state summary for logging
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @private
 */
function _buildStateSummary(tabs) {
  return {
    totalTabs: tabs.length,
    minimizedTabs: tabs.filter(t => isMinimized(t)).length
  };
}

/**
 * Log render scheduled box header
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @private
 */
function _logRenderScheduledBox(source, tabCount, minimizedCount, correlationId) {
  console.log('[RenderManager] ┌─────────────────────────────────────────────────────────');
  console.log('[RenderManager] │ RENDER_SCHEDULED');
  console.log('[RenderManager] │ Source:', source);
  console.log('[RenderManager] │ TabCount:', tabCount, '(minimized:', minimizedCount + ')');
  console.log('[RenderManager] │ CorrelationId:', correlationId || 'none');
  console.log('[RenderManager] └─────────────────────────────────────────────────────────');
}

/**
 * Log debounce scheduled event
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @private
 */
function _logDebounceScheduled(scheduleTimestamp, source, correlationId) {
  console.log('[RenderManager] DEBOUNCE_SCHEDULED:', {
    timestamp: scheduleTimestamp,
    source,
    correlationId: correlationId || null,
    debounceId: `render-${scheduleTimestamp}`,
    delayMs: RENDER_DEBOUNCE_MS,
    reason: 'hash_changed'
  });
}

/**
 * Log render scheduled structured event
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @private
 */
function _logRenderScheduledStructured(context) {
  const { source, currentHash, tabCount, minimizedCount, correlationId } = context;
  console.log('[RenderManager] RENDER_SCHEDULED:', {
    source,
    correlationId: correlationId || null,
    newHash: currentHash,
    previousHash: _lastRenderedStateHash,
    tabCount,
    minimizedCount,
    timestamp: Date.now()
  });
}

/**
 * Log complete render scheduled event
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @private
 */
function _logRenderScheduled(scheduleTimestamp, source, currentHash, correlationId, tabs) {
  const summary = _buildStateSummary(tabs);
  _logRenderScheduledBox(source, summary.totalTabs, summary.minimizedTabs, correlationId);
  _logDebounceScheduled(scheduleTimestamp, source, correlationId);
  _logRenderScheduledStructured({
    source,
    currentHash,
    tabCount: summary.totalTabs,
    minimizedCount: summary.minimizedTabs,
    correlationId
  });
}

// ==================== RENDER SCHEDULING ====================

/**
 * Schedule UI render with deduplication
 * v1.6.4 - Main render scheduling function
 * @param {string} [source='unknown'] - Source of render request
 * @param {string} [correlationId=null] - Correlation ID for async tracing
 */
function scheduleRender(source = 'unknown', correlationId = null) {
  const quickTabsState = _externalCallbacks.getQuickTabsState?.() ?? {};
  const scheduleTimestamp = Date.now();
  const currentHash = computeStateHash(quickTabsState);

  _logHashComputation(scheduleTimestamp, source, currentHash, quickTabsState);

  // Check both hash AND state version
  const hashUnchanged = currentHash === _lastRenderedStateHash;
  const versionUnchanged = _stateVersion === _lastRenderedStateVersion;

  if (hashUnchanged && versionUnchanged) {
    _logRenderSkipped(scheduleTimestamp, source, currentHash, correlationId);
    return;
  }

  // Log why render is proceeding
  if (!hashUnchanged) {
    console.log('[RenderManager] RENDER_SCHEDULED: Hash changed', {
      timestamp: scheduleTimestamp,
      source,
      previousHash: _lastRenderedStateHash,
      currentHash
    });
  } else if (!versionUnchanged) {
    console.log('[RenderManager] RENDER_SCHEDULED: State version changed (hash same)', {
      timestamp: scheduleTimestamp,
      source,
      previousVersion: _lastRenderedStateVersion,
      currentVersion: _stateVersion,
      reason: 'Forcing re-render for UI state refresh'
    });
  }

  // Capture state version at schedule time
  _stateVersionAtSchedule = _stateVersion;

  const tabs = quickTabsState?.tabs || [];
  _logRenderScheduled(scheduleTimestamp, source, currentHash, correlationId, tabs);

  // Use requestAnimationFrame for DOM mutation batching
  requestAnimationFrame(() => {
    // Check if state changed since scheduling
    if (_stateVersion !== _stateVersionAtSchedule) {
      console.log('[RenderManager] RENDER_STATE_DRIFT:', {
        scheduledVersion: _stateVersionAtSchedule,
        currentVersion: _stateVersion,
        versionDrift: _stateVersion - _stateVersionAtSchedule,
        source,
        note: 'State changed between schedule and render - rendering latest state'
      });
    }

    if (_externalCallbacks.renderUI) {
      _externalCallbacks.renderUI();
    }
  });
}

/**
 * Force immediate render (bypasses debounce)
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @param {string} reason - Reason for forcing render
 */
function forceImmediateRender(reason) {
  console.log('[RenderManager] FORCE_IMMEDIATE_RENDER:', {
    reason,
    timestamp: Date.now(),
    previousPendingRender: _pendingRender,
    previousDebounceTimer: !!_renderDebounceTimer
  });

  _pendingRender = false;
  if (_renderDebounceTimer) {
    clearTimeout(_renderDebounceTimer);
    _renderDebounceTimer = null;
  }
  _debounceStartTimestamp = 0;
  _debounceExtensionCount = 0;

  requestAnimationFrame(() => {
    if (_externalCallbacks.renderUI) {
      _externalCallbacks.renderUI();
    }
  });
}

/**
 * Force render when max debounce wait time reached
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @param {number} totalWaitTime - Total time waited since debounce started
 */
function forceRenderOnMaxWait(totalWaitTime) {
  console.log('[RenderManager] RENDER_DEBOUNCE_MAX_REACHED:', {
    totalWaitMs: totalWaitTime,
    extensions: _debounceExtensionCount,
    maxWaitMs: RENDER_DEBOUNCE_MAX_WAIT_MS
  });

  if (_renderDebounceTimer) {
    clearTimeout(_renderDebounceTimer);
    _renderDebounceTimer = null;
  }
  _debounceStartTimestamp = 0;
  _debounceExtensionCount = 0;
  _pendingRender = false;

  requestAnimationFrame(() => {
    if (_externalCallbacks.renderUI) {
      _externalCallbacks.renderUI();
    }
  });
}

// ==================== RENDER LOCK ====================

/**
 * Check if render is in progress
 * @returns {boolean} True if render is in progress
 */
function isRenderInProgress() {
  return _isRenderInProgress;
}

/**
 * Set render in progress state
 * @param {boolean} inProgress - Whether render is in progress
 */
function setRenderInProgress(inProgress) {
  _isRenderInProgress = inProgress;
}

/**
 * Check if re-render was requested during render
 * @returns {boolean} True if re-render requested
 */
function isPendingRerenderRequested() {
  return _pendingRerenderRequested;
}

/**
 * Set pending re-render flag
 * @param {boolean} requested - Whether re-render is requested
 */
function setPendingRerenderRequested(requested) {
  _pendingRerenderRequested = requested;
}

/**
 * Handle pending re-render after render completes
 * v1.6.4 - Extracted from quick-tabs-manager.js
 */
function handlePendingRerender() {
  if (!_pendingRerenderRequested) {
    return;
  }

  _pendingRerenderRequested = false;
  _consecutiveRerenderCount++;

  if (_consecutiveRerenderCount > MAX_CONSECUTIVE_RERENDERS) {
    console.warn('[RenderManager] RERENDER_LIMIT_REACHED:', {
      timestamp: Date.now(),
      consecutiveRerenderCount: _consecutiveRerenderCount,
      maxAllowed: MAX_CONSECUTIVE_RERENDERS
    });
    _consecutiveRerenderCount = 0;
    return;
  }

  console.log('[RenderManager] RERENDER: Re-rendering due to pending request', {
    timestamp: Date.now(),
    consecutiveRerenderCount: _consecutiveRerenderCount
  });

  if (_externalCallbacks.renderUI) {
    _externalCallbacks.renderUI();
  }
}

/**
 * Reset consecutive re-render count
 */
function resetConsecutiveRerenderCount() {
  _consecutiveRerenderCount = 0;
}

/**
 * Mark last rendered state version
 */
function markLastRenderedStateVersion() {
  _lastRenderedStateVersion = _stateVersion;
}

// ==================== DATA EXTRACTION ====================

/**
 * Get all Quick Tabs for render from port data or storage fallback
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @returns {{ allTabs: Array, latestTimestamp: number, source: string }}
 */
function getAllQuickTabsForRender() {
  const portData = _externalCallbacks.getAllQuickTabsFromPort?.() ?? [];
  const quickTabsState = _externalCallbacks.getQuickTabsState?.() ?? {};
  const lastLocalUpdateTime = _externalCallbacks.getLastLocalUpdateTime?.() ?? Date.now();

  if (portData?.length) {
    console.log('[RenderManager] RENDER_DATA_SOURCE: Using port data (cross-tab)', {
      portTabCount: portData.length,
      storageTabCount: quickTabsState?.tabs?.length ?? 0
    });
    return {
      allTabs: portData,
      latestTimestamp: lastLocalUpdateTime,
      source: 'port'
    };
  }

  const { allTabs, latestTimestamp } = extractTabsFromState(quickTabsState);
  console.log('[RenderManager] RENDER_DATA_SOURCE: Using storage fallback', {
    portTabCount: portData?.length ?? 0,
    storageTabCount: allTabs.length
  });
  return { allTabs, latestTimestamp, source: 'storage' };
}

// ==================== UI STATE ====================

/**
 * Show empty state UI
 * v1.6.4 - Extracted from quick-tabs-manager.js
 */
function showEmptyState() {
  if (_containersList) {
    _containersList.style.display = 'none';
  }
  if (_emptyState) {
    _emptyState.style.display = 'flex';
  }
  console.log('[RenderManager] UI showing empty state (0 tabs)');
}

/**
 * Show content state UI
 * v1.6.4 - Extracted from quick-tabs-manager.js
 */
function showContentState() {
  if (_containersList) {
    _containersList.style.display = 'block';
  }
  if (_emptyState) {
    _emptyState.style.display = 'none';
  }
}

// ==================== RENDER LOGGING ====================

/**
 * Log render start with comprehensive details
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @param {Array} allTabs - All tabs to render
 * @param {number} inMemoryCacheCount - In-memory cache count
 */
function logRenderStart(allTabs, inMemoryCacheCount = 0) {
  const activeTabs = allTabs.filter(t => !isMinimized(t));
  const minimizedTabs = allTabs.filter(t => isMinimized(t));

  console.log('[RenderManager] UI Rebuild starting:', {
    totalTabs: allTabs.length,
    activeCount: activeTabs.length,
    minimizedCount: minimizedTabs.length,
    cacheCount: inMemoryCacheCount,
    lastRenderedHash: _lastRenderedStateHash,
    trigger: '_renderUIImmediate()',
    timestamp: Date.now()
  });

  console.log('[RenderManager] UI List contents:', {
    activeTabIds: activeTabs.map(t => ({ id: t.id, url: t.url?.substring(0, 50) })),
    minimizedTabIds: minimizedTabs.map(t => ({ id: t.id, minimized: true }))
  });
}

/**
 * Log render completion
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @param {Array} allTabs - All tabs rendered
 * @param {Map|Object} groups - Groups created
 * @param {number} renderStartTime - When render started
 */
function logRenderComplete(allTabs, groups, renderStartTime) {
  const activeTabs = allTabs.filter(t => !isMinimized(t));
  const minimizedTabs = allTabs.filter(t => isMinimized(t));
  const renderDuration = Date.now() - renderStartTime;
  const groupCount = groups instanceof Map ? groups.size : Object.keys(groups).length;

  console.log('[RenderManager] UI Rebuild complete:', {
    renderedActive: activeTabs.length,
    renderedMinimized: minimizedTabs.length,
    groupCount,
    newHash: _lastRenderedStateHash,
    durationMs: renderDuration
  });
}

/**
 * Log group rendering info
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @param {Map} groups - Groups to render
 */
function logGroupRendering(groups) {
  console.log('[RenderManager][Display] GROUPING: Organizing Quick Tabs by originTabId', {
    totalQuickTabs: [...groups.values()].reduce((sum, g) => sum + g.length, 0),
    groups: [...groups.entries()].map(([tabId, tabs]) => ({
      originTabId: tabId,
      count: tabs.length
    }))
  });

  console.log('[RenderManager] Rendering groups directly (no global header)', {
    groupCount: groups.size,
    groupKeys: [...groups.keys()]
  });
}

/**
 * Log render performance metrics
 * v1.6.4 - Extracted from quick-tabs-manager.js
 * @param {Object} metrics - Performance metrics
 */
function logRenderPerformance(metrics) {
  const {
    totalDurationMs,
    groupingMs,
    collapseStateMs,
    domManipulationMs,
    tabsRendered,
    groupsCreated
  } = metrics;

  console.log('[RENDER_PERF] Render completed:', {
    totalDurationMs,
    phases: {
      groupingMs,
      collapseStateMs,
      domManipulationMs
    },
    tabsRendered,
    groupsCreated,
    isSlowRender: totalDurationMs > 100
  });
}

// ==================== EXPORTS ====================

export {
  // Initialization
  initialize,

  // State version
  incrementStateVersion,
  getStateVersion,
  getLastRenderedStateVersion,

  // Hash computation
  computeHash,
  getLastRenderedHash,
  updateLastRenderedHash,

  // Render scheduling
  scheduleRender,
  forceImmediateRender,
  forceRenderOnMaxWait,

  // Render lock
  isRenderInProgress,
  setRenderInProgress,
  isPendingRerenderRequested,
  setPendingRerenderRequested,
  handlePendingRerender,
  resetConsecutiveRerenderCount,
  markLastRenderedStateVersion,

  // Data extraction
  getAllQuickTabsForRender,

  // UI state
  showEmptyState,
  showContentState,

  // Logging
  logRenderStart,
  logRenderComplete,
  logGroupRendering,
  logRenderPerformance,

  // Constants
  RENDER_DEBOUNCE_MS,
  RENDER_DEBOUNCE_MAX_WAIT_MS,
  MAX_CONSECUTIVE_RERENDERS
};
