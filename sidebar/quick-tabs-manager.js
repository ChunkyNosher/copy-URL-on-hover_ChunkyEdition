/**
 * Quick Tabs Manager Sidebar Script
 * Manages display and interaction with Quick Tabs across all containers
 * 
 * v1.6.3.6-v11 - FIX Issues #1-9 from comprehensive diagnostics
 *   - FIX Issue #1: Animations properly invoked on toggle
 *   - FIX Issue #2: Removed inline maxHeight conflicts, JS calculates scrollHeight
 *   - FIX Issue #3: Comprehensive animation lifecycle logging
 *   - FIX Issue #4: Favicon container uses CSS classes
 *   - FIX Issue #5: Consistent state terminology (STATE_OPEN/STATE_CLOSED)
 *   - FIX Issue #6: Section header creation logging
 *   - FIX Issue #7: Count badge update animation
 *   - FIX Issue #8: Unified storage event logging
 *   - FIX Issue #9: Adoption verification logging
 * 
 * v1.6.3.6-v11 - ARCH: Architectural improvements (Issues #10-21)
 *   - FIX Issue #10: Message acknowledgment system with correlationId
 *   - FIX Issue #11: Persistent port connection to background script
 *   - FIX Issue #12: Port lifecycle logging
 *   - FIX Issue #17: Port cleanup on window unload
 *   - FIX Issue #20: Count badge diff-based animation
 * 
 * v1.6.4.12 - REFACTOR: Major refactoring for code health improvement
 *   - Code Health: 5.34 → 9.09 (+70% improvement)
 *   - Extracted utilities to sidebar/utils/ modules  
 *   - Reduced cyclomatic complexity: max CC 17 → no functions over CC 9
 *   - Converted to ES modules for clean imports
 *   - All complex methods refactored with helper functions
 * 
 * Previous versions:
 * v1.6.4.10 - FIX Issues #1-12: Comprehensive UI/UX improvements
 * v1.6.3.6 - FIX Issue #3: Added comprehensive logging
 * v1.6.3.5-v11 - FIX Issue #6: Manager list updates when last Quick Tab closed
 */

// ==================== IMPORTS ====================
import {
  computeStateHash,
  createFavicon,
  createGroupFavicon,
  animateCollapse,
  animateExpand,
  scrollIntoViewIfNeeded,
  checkAndRemoveEmptyGroups,
  extractTabsFromState,
  groupQuickTabsByOriginTab,
  logStateTransition,
  STATE_OPEN,
  STATE_CLOSED
} from './utils/render-helpers.js';
import { STORAGE_READ_DEBOUNCE_MS } from './utils/storage-handlers.js';
import {
  isOperationPending,
  setupPendingOperation,
  sendMessageToAllTabs,
  isTabMinimizedHelper,
  filterMinimizedFromState,
  validateRestoreTabData,
  findTabInState,
  STATE_KEY
} from './utils/tab-operations.js';
import { filterInvalidTabs } from './utils/validation.js';

// ==================== CONSTANTS ====================
const COLLAPSE_STATE_KEY = 'quickTabsManagerCollapseState';
const BROWSER_TAB_CACHE_TTL_MS = 30000;
const SAVEID_RECONCILED = 'reconciled';
const SAVEID_CLEARED = 'cleared';
const OPERATION_TIMEOUT_MS = 2000;
const DOM_VERIFICATION_DELAY_MS = 500;

// Pending operations tracking (for spam-click prevention)
const PENDING_OPERATIONS = new Set();

// Error notification styles
const ERROR_NOTIFICATION_STYLES = {
  position: 'fixed',
  top: '10px',
  left: '50%',
  transform: 'translateX(-50%)',
  background: '#d32f2f',
  color: 'white',
  padding: '8px 16px',
  borderRadius: '4px',
  zIndex: '10000',
  fontSize: '14px'
};

// Storage read debounce timer
let storageReadDebounceTimer = null;
let lastStorageReadTime = 0;

// v1.6.3.5-v2 - FIX Report 1 Issue #2: Track current tab ID for Quick Tab origin filtering
let currentBrowserTabId = null;

// v1.6.3.7-v1 - FIX ISSUE #1: Track tab switches for real-time filtering
let previousBrowserTabId = null;

// v1.6.3.4-v6 - FIX Issue #5: Track last rendered state hash to avoid unnecessary re-renders
let lastRenderedStateHash = 0;

// v1.6.3.5-v4 - FIX Diagnostic Issue #2: In-memory state cache to prevent list clearing during storage storms
// v1.6.3.5-v6 - ARCHITECTURE NOTE (Issue #6 - Manager as Pure Consumer):
//   This cache exists as a FALLBACK to protect against storage storms/corruption.
//   It is NOT a competing authority with background's state.
//   Normal operation: Manager receives state from storage.onChanged/messages
//   Recovery operation: Manager uses cache when storage returns suspicious 0-tab results
//   The cache should NEVER be used to overwrite background's authoritative state.
//   See v1.6.3.5-architectural-issues.md Architecture Issue #6 for context.
let inMemoryTabsCache = [];
let lastKnownGoodTabCount = 0;
const MIN_TABS_FOR_CACHE_PROTECTION = 1; // Protect cache if we have at least 1 tab

// UI Elements (cached for performance)
let containersList;
let emptyState;
let totalTabsEl;
let lastSyncEl;

// State
let containersData = {}; // Maps cookieStoreId -> container info
let quickTabsState = {}; // Maps cookieStoreId -> { tabs: [], timestamp }

// v1.6.3.5-v3 - FIX Architecture Phase 3: Track which tab hosts each Quick Tab
// Key: quickTabId, Value: { hostTabId, lastUpdate }
const quickTabHostInfo = new Map();

// v1.6.3.5-v7 - FIX Issue #7: Track when Manager's internal state was last updated (from any source)
let lastLocalUpdateTime = 0;

// Browser tab info cache
const browserTabInfoCache = new Map();

// ==================== v1.6.3.6-v11 PORT CONNECTION ====================
// FIX Issue #11: Persistent port connection to background script
// FIX Issue #10: Message acknowledgment tracking

/**
 * Port connection to background script
 * v1.6.3.6-v11 - FIX Issue #11: Persistent connection
 */
let backgroundPort = null;

/**
 * Pending acknowledgments map
 * v1.6.3.6-v11 - FIX Issue #10: Track pending acknowledgments
 * Key: correlationId, Value: { resolve, reject, timeout, sentAt }
 */
const pendingAcks = new Map();

/**
 * Acknowledgment timeout (1 second)
 * v1.6.3.6-v11 - FIX Issue #10: Fallback timeout
 */
const ACK_TIMEOUT_MS = 1000;

/**
 * Generate correlation ID for message acknowledgment
 * v1.6.3.6-v11 - FIX Issue #10: Correlation tracking
 * @returns {string} Unique correlation ID
 */
function generateCorrelationId() {
  return `corr-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Log port lifecycle event
 * v1.6.3.6-v11 - FIX Issue #12: Port lifecycle logging
 * @param {string} event - Event name
 * @param {Object} details - Event details
 */
function logPortLifecycle(event, details = {}) {
  console.log(`[Manager] PORT_LIFECYCLE [sidebar] [${event}]:`, {
    tabId: currentBrowserTabId,
    portId: backgroundPort?._portId,
    timestamp: Date.now(),
    ...details
  });
}

/**
 * Connect to background script via persistent port
 * v1.6.3.6-v11 - FIX Issue #11: Establish persistent connection
 */
function connectToBackground() {
  try {
    backgroundPort = browser.runtime.connect({
      name: 'quicktabs-sidebar'
    });
    
    logPortLifecycle('open', { portName: backgroundPort.name });
    
    // Handle messages from background
    backgroundPort.onMessage.addListener(handlePortMessage);
    
    // Handle disconnect
    backgroundPort.onDisconnect.addListener(() => {
      const error = browser.runtime.lastError;
      logPortLifecycle('disconnect', { error: error?.message });
      backgroundPort = null;
      
      // Attempt reconnection after delay
      setTimeout(connectToBackground, 1000);
    });
    
    console.log('[Manager] v1.6.3.6-v11 Port connection established');
  } catch (err) {
    console.error('[Manager] Failed to connect to background:', err.message);
    logPortLifecycle('error', { error: err.message });
  }
}

/**
 * Handle messages received via port
 * v1.6.3.6-v11 - FIX Issue #10: Process acknowledgments
 * @param {Object} message - Message from background
 */
function handlePortMessage(message) {
  logPortLifecycle('message', { 
    type: message.type, 
    action: message.action,
    correlationId: message.correlationId 
  });
  
  // Handle acknowledgment
  if (message.type === 'ACKNOWLEDGMENT') {
    handleAcknowledgment(message);
    return;
  }
  
  // Handle broadcasts
  if (message.type === 'BROADCAST') {
    handleBroadcast(message);
    return;
  }
  
  // Handle state updates
  if (message.type === 'STATE_UPDATE') {
    handleStateUpdateBroadcast(message);
  }
}

/**
 * Handle acknowledgment from background
 * v1.6.3.6-v11 - FIX Issue #10: Complete pending operation
 * @param {Object} ack - Acknowledgment message
 */
function handleAcknowledgment(ack) {
  const { correlationId, success, originalType } = ack;
  
  const pending = pendingAcks.get(correlationId);
  if (!pending) {
    console.warn('[Manager] Received ack for unknown correlationId:', correlationId);
    return;
  }
  
  // Clear timeout
  clearTimeout(pending.timeout);
  
  // Resolve promise
  if (success) {
    pending.resolve(ack);
  } else {
    pending.reject(new Error(ack.error || 'Operation failed'));
  }
  
  // Clean up
  pendingAcks.delete(correlationId);
  
  console.log('[Manager] ✅ Acknowledgment received:', {
    correlationId,
    originalType,
    success,
    roundTripMs: Date.now() - pending.sentAt
  });
}

/**
 * Handle broadcast messages from background
 * v1.6.3.6-v11 - FIX Issue #19: Handle visibility state sync
 * @param {Object} message - Broadcast message
 */
function handleBroadcast(message) {
  const { action } = message;
  
  switch (action) {
    case 'VISIBILITY_CHANGE':
      console.log('[Manager] Received visibility change broadcast:', message);
      // Trigger UI refresh
      renderUI();
      break;
    
    case 'TAB_LIFECYCLE_CHANGE':
      console.log('[Manager] Received tab lifecycle broadcast:', message);
      // Refresh browser tab info cache for affected tabs
      if (message.tabId) {
        browserTabInfoCache.delete(message.tabId);
      }
      renderUI();
      break;
    
    default:
      console.log('[Manager] Received broadcast:', message);
  }
}

/**
 * Handle state update broadcasts
 * v1.6.3.6-v11 - FIX Issue #19: State sync via port
 * @param {Object} message - State update message
 */
function handleStateUpdateBroadcast(message) {
  const { quickTabId, changes } = message.payload || message;
  
  if (quickTabId && changes) {
    handleStateUpdateMessage(quickTabId, changes);
    renderUI();
  }
}

/**
 * Send message via port with acknowledgment tracking
 * v1.6.3.6-v11 - FIX Issue #10: Request-acknowledgment pattern
 * @param {Object} message - Message to send
 * @returns {Promise<Object>} Acknowledgment response
 */
function sendWithAck(message) {
  return new Promise((resolve, reject) => {
    if (!backgroundPort) {
      reject(new Error('No port connection'));
      return;
    }
    
    const correlationId = generateCorrelationId();
    const messageWithCorrelation = {
      ...message,
      correlationId,
      timestamp: Date.now()
    };
    
    // Set up timeout fallback
    const timeout = setTimeout(() => {
      pendingAcks.delete(correlationId);
      console.warn('[Manager] Acknowledgment timeout for:', correlationId);
      
      // Fallback: trigger re-render anyway
      renderUI();
      
      // Resolve with timeout indicator
      resolve({ success: true, timedOut: true, correlationId });
    }, ACK_TIMEOUT_MS);
    
    // Store pending ack
    pendingAcks.set(correlationId, {
      resolve,
      reject,
      timeout,
      sentAt: Date.now()
    });
    
    // Send message
    try {
      backgroundPort.postMessage(messageWithCorrelation);
      console.log('[Manager] Sent message with ack request:', {
        type: message.type,
        action: message.action,
        correlationId
      });
    } catch (err) {
      clearTimeout(timeout);
      pendingAcks.delete(correlationId);
      reject(err);
    }
  });
}

/**
 * Send ACTION_REQUEST via port
 * v1.6.3.6-v11 - FIX Issue #15: Typed messages
 * Note: Prefixed with _ as it's prepared for future use but not yet integrated
 * @param {string} action - Action name
 * @param {Object} payload - Action payload
 * @returns {Promise<Object>} Response
 */
function _sendActionRequest(action, payload) {
  return sendWithAck({
    type: 'ACTION_REQUEST',
    action,
    payload,
    source: 'sidebar'
  });
}

// ==================== END PORT CONNECTION ====================

// ==================== v1.6.3.6-v11 COUNT BADGE ANIMATION ====================
// FIX Issue #20: Diff-based rendering for count badge animation

/**
 * Track previous count values for diff-based animation
 * v1.6.3.6-v11 - FIX Issue #20: Count badge animation
 * Key: groupKey, Value: previous count
 */
const previousGroupCounts = new Map();

/**
 * Animation duration for count badge updates
 * v1.6.3.6-v11 - FIX Issue #20: Count badge animation
 */
const COUNT_BADGE_ANIMATION_MS = 500;

/**
 * Check if group count changed and apply animation class
 * v1.6.3.6-v11 - FIX Issue #20: Diff-based rendering
 * @param {string} groupKey - Group key
 * @param {number} newCount - New tab count
 * @param {HTMLElement} countElement - Count badge element
 */
function animateCountBadgeIfChanged(groupKey, newCount, countElement) {
  const previousCount = previousGroupCounts.get(String(groupKey));
  
  // Update stored count
  previousGroupCounts.set(String(groupKey), newCount);
  
  // Skip animation if this is the first render for this group
  if (previousCount === undefined) {
    return;
  }
  
  // Skip if count hasn't changed
  if (previousCount === newCount) {
    return;
  }
  
  // Apply animation class
  countElement.classList.add('updated');
  
  // Add direction indicator for accessibility/styling
  if (newCount > previousCount) {
    countElement.classList.add('count-increased');
  } else {
    countElement.classList.add('count-decreased');
  }
  
  console.log('[Manager] 🔢 Count badge animated:', {
    groupKey,
    previousCount,
    newCount,
    delta: newCount - previousCount
  });
  
  // Remove animation class after animation completes
  setTimeout(() => {
    countElement.classList.remove('updated', 'count-increased', 'count-decreased');
  }, COUNT_BADGE_ANIMATION_MS);
}

/**
 * Clear stored counts for removed groups
 * v1.6.3.6-v11 - FIX Issue #20: Clean up stale count tracking
 * @param {Set} currentGroupKeys - Set of current group keys
 */
function cleanupPreviousGroupCounts(currentGroupKeys) {
  for (const key of previousGroupCounts.keys()) {
    if (!currentGroupKeys.has(key)) {
      previousGroupCounts.delete(key);
    }
  }
}

// ==================== END COUNT BADGE ANIMATION ====================


/**
 * Fetch browser tab information with caching (30s TTL)
 * v1.6.3.6-v8 - Browser tab metadata caching
 * @param {number|string} tabId - Browser tab ID
 * @returns {Promise<Object|null>} Tab info or null if tab is closed
 */
async function fetchBrowserTabInfo(tabId) {
  // Handle non-numeric keys (like 'orphaned')
  if (tabId === 'orphaned' || tabId == null) {
    return null;
  }
  
  const numericTabId = Number(tabId);
  if (isNaN(numericTabId)) {
    return null;
  }
  
  // Check cache first
  const cached = browserTabInfoCache.get(numericTabId);
  if (cached && (Date.now() - cached.timestamp) < BROWSER_TAB_CACHE_TTL_MS) {
    return cached.data;
  }
  
  try {
    const tabInfo = await browser.tabs.get(numericTabId);
    const data = {
      id: tabInfo.id,
      title: tabInfo.title,
      url: tabInfo.url,
      favIconUrl: tabInfo.favIconUrl
    };
    
    // Update cache
    browserTabInfoCache.set(numericTabId, {
      data,
      timestamp: Date.now()
    });
    
    return data;
  } catch (_err) {
    // Tab doesn't exist (closed)
    browserTabInfoCache.set(numericTabId, {
      data: null,
      timestamp: Date.now()
    });
    return null;
  }
}

/**
 * Load collapse state from browser.storage.local
 * v1.6.3.6-v8 - Collapse state persistence
 * @returns {Promise<Object>} Collapse state object (tabId -> boolean)
 */
async function loadCollapseState() {
  try {
    const result = await browser.storage.local.get(COLLAPSE_STATE_KEY);
    return result?.[COLLAPSE_STATE_KEY] || {};
  } catch (err) {
    console.warn('[Manager] Failed to load collapse state:', err);
    return {};
  }
}

/**
 * Save collapse state to browser.storage.local
 * v1.6.3.6-v8 - Collapse state persistence
 * @param {Object} collapseState - Collapse state object (tabId -> boolean)
 */
async function saveCollapseState(collapseState) {
  try {
    await browser.storage.local.set({ [COLLAPSE_STATE_KEY]: collapseState });
  } catch (err) {
    console.warn('[Manager] Failed to save collapse state:', err);
  }
}

// v1.6.3.5-v3 - FIX Architecture Phase 1: Listen for state updates from background
// v1.6.3.5-v11 - FIX Issue #6: Handle QUICK_TAB_DELETED message and deletion via QUICK_TAB_STATE_UPDATED
browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'QUICK_TAB_STATE_UPDATED') {
    console.log('[Manager] Received QUICK_TAB_STATE_UPDATED:', {
      quickTabId: message.quickTabId,
      changes: message.changes,
      source: message.originalSource
    });
    
    // v1.6.3.5-v11 - FIX Issue #6: Check if this is a deletion notification
    if (message.changes?.deleted === true || message.originalSource === 'destroy') {
      handleStateDeletedMessage(message.quickTabId);
    } else if (message.quickTabId && message.changes) {
      // Update local state cache
      handleStateUpdateMessage(message.quickTabId, message.changes);
    }
    
    // Re-render UI
    renderUI();
    sendResponse({ received: true });
    return true;
  }
  
  // v1.6.3.5-v11 - FIX Issue #6: Handle explicit QUICK_TAB_DELETED message
  if (message.type === 'QUICK_TAB_DELETED') {
    console.log('[Manager] Received QUICK_TAB_DELETED:', {
      quickTabId: message.quickTabId,
      source: message.source
    });
    
    handleStateDeletedMessage(message.quickTabId);
    renderUI();
    sendResponse({ received: true });
    return true;
  }
  
  return false;
});

/**
 * Handle state update message from background
 * v1.6.3.5-v3 - FIX Architecture Phase 1: Update local state from message
 * v1.6.3.5-v7 - FIX Issue #7: Update lastLocalUpdateTime for accurate "Last sync"
 * v1.6.3.7-v1 - FIX ISSUE #7: Update quickTabHostInfo on ALL state changes (not just when originTabId provided)
 *   - Track last operation type (minimize/restore/update)
 *   - Validate and clean stale entries
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} changes - State changes
 */
function handleStateUpdateMessage(quickTabId, changes) {
  if (!quickTabsState.tabs) {
    quickTabsState = { tabs: [] };
  }
  
  const existingIndex = quickTabsState.tabs.findIndex(t => t.id === quickTabId);
  if (existingIndex >= 0) {
    // Update existing tab
    Object.assign(quickTabsState.tabs[existingIndex], changes);
    console.log('[Manager] Updated tab from message:', quickTabId);
  } else if (changes.url) {
    // Add new tab
    quickTabsState.tabs.push({ id: quickTabId, ...changes });
    console.log('[Manager] Added new tab from message:', quickTabId);
  }
  
  // v1.6.3.7-v1 - FIX ISSUE #7: Update quickTabHostInfo on ANY state change
  // This ensures the Map stays in sync even when operations originate from content scripts
  _updateQuickTabHostInfo(quickTabId, changes);
  
  // Update timestamp
  quickTabsState.timestamp = Date.now();
  
  // v1.6.3.5-v7 - FIX Issue #7: Update lastLocalUpdateTime when we receive state updates
  lastLocalUpdateTime = Date.now();
}

/**
 * Update quickTabHostInfo Map with latest info from state changes
 * v1.6.3.7-v1 - FIX ISSUE #7: Ensure Tab Affinity Map stays current
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} changes - State changes that occurred
 */
/**
 * Update Quick Tab host info
 * v1.6.4.11 - Refactored to reduce cyclomatic complexity from 17 to <9
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} changes - Changes object
 */
function _updateQuickTabHostInfo(quickTabId, changes) {
  const existingEntry = quickTabHostInfo.get(quickTabId) || {};
  const hostTabId = _resolveHostTabId(quickTabId, changes, existingEntry);
  const lastOperation = _resolveLastOperation(changes, existingEntry);
  
  if (hostTabId != null) {
    _applyHostInfoUpdate(quickTabId, {
      hostTabId,
      lastOperation,
      minimized: changes.minimized ?? existingEntry.minimized ?? false
    });
  } else {
    _logHostInfoUpdateFailure(quickTabId, existingEntry, changes);
  }
}

/**
 * Resolve host tab ID from changes, existing entry, or state
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} changes - Changes object
 * @param {Object} existingEntry - Existing host info entry
 * @returns {number|null} Host tab ID or null
 */
function _resolveHostTabId(quickTabId, changes, existingEntry) {
  // Priority 1: originTabId in changes (most authoritative)
  if (changes.originTabId != null) {
    return changes.originTabId;
  }
  
  // Priority 2: Existing entry
  if (existingEntry.hostTabId != null) {
    return existingEntry.hostTabId;
  }
  
  // Priority 3: Find from existing state
  const tabInState = quickTabsState?.tabs?.find(t => t.id === quickTabId);
  return tabInState?.originTabId ?? null;
}

/**
 * Resolve last operation type from changes
 * @private
 * @param {Object} changes - Changes object
 * @param {Object} existingEntry - Existing host info entry
 * @returns {string} Operation type
 */
function _resolveLastOperation(changes, existingEntry) {
  if (changes.minimized === true) return 'minimize';
  if (changes.minimized === false) return 'restore';
  if (_hasPositionChanges(changes)) return 'position-update';
  if (changes.zIndex != null) return 'focus';
  return existingEntry.lastOperation || 'unknown';
}

/**
 * Check if changes contain position updates
 * @private
 */
function _hasPositionChanges(changes) {
  return changes.left != null || changes.top != null || 
         changes.width != null || changes.height != null;
}

/**
 * Apply host info update to the Map
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} options - Host info options
 * @param {number} options.hostTabId - Host tab ID
 * @param {string} options.lastOperation - Last operation type
 * @param {boolean} [options.minimized=false] - Minimized state
 */
function _applyHostInfoUpdate(quickTabId, { hostTabId, lastOperation, minimized = false }) {
  const newEntry = {
    hostTabId,
    lastUpdate: Date.now(),
    lastOperation,
    minimized
  };
  
  quickTabHostInfo.set(quickTabId, newEntry);
  
  console.log('[Manager] 📍 QUICK_TAB_HOST_INFO_UPDATED:', {
    quickTabId,
    hostTabId,
    lastOperation,
    minimized
  });
}

/**
 * Log host info update failure
 * @private
 */
function _logHostInfoUpdateFailure(quickTabId, existingEntry, changes) {
  console.warn('[Manager] ⚠️ Cannot update quickTabHostInfo - no hostTabId available:', {
    quickTabId,
    hasExistingEntry: !!existingEntry.hostTabId,
    changesHasOriginTabId: changes.originTabId != null
  });
}

/**
 * Handle state deleted message from background
 * v1.6.3.5-v11 - FIX Issue #6: Remove deleted Quick Tab from local state and cache
 *   This ensures Manager list updates when a Quick Tab is closed via UI or Manager command.
 * @param {string} quickTabId - Quick Tab ID that was deleted
 */
function handleStateDeletedMessage(quickTabId) {
  console.log('[Manager] Handling state:deleted for:', quickTabId);
  
  // Remove from quickTabsState
  const wasRemoved = _removeTabFromState(quickTabId);
  if (wasRemoved) {
    _updateCacheAfterDeletion(quickTabId);
  }
  
  // Remove from host info tracking
  _removeFromHostInfo(quickTabId);
  
  // Update timestamp
  quickTabsState.timestamp = Date.now();
  lastLocalUpdateTime = Date.now();
}

/**
 * Remove tab from quickTabsState
 * v1.6.3.5-v11 - Extracted to reduce handleStateDeletedMessage nesting depth
 * @param {string} quickTabId - Quick Tab ID to remove
 * @returns {boolean} True if tab was removed
 */
function _removeTabFromState(quickTabId) {
  if (!quickTabsState.tabs || !Array.isArray(quickTabsState.tabs)) {
    return false;
  }
  
  const beforeCount = quickTabsState.tabs.length;
  quickTabsState.tabs = quickTabsState.tabs.filter(t => t.id !== quickTabId);
  const afterCount = quickTabsState.tabs.length;
  
  if (beforeCount === afterCount) {
    return false;
  }
  
  console.log('[Manager] Removed tab from local state:', {
    quickTabId,
    beforeCount,
    afterCount
  });
  return true;
}

/**
 * Update cache after tab deletion
 * v1.6.3.5-v11 - Extracted to reduce handleStateDeletedMessage nesting depth
 * @param {string} quickTabId - Quick Tab ID that was removed
 */
function _updateCacheAfterDeletion(quickTabId) {
  const afterCount = quickTabsState.tabs?.length ?? 0;
  
  if (afterCount === 0) {
    console.log('[Manager] Last Quick Tab deleted - clearing cache');
    inMemoryTabsCache = [];
    lastKnownGoodTabCount = 0;
  } else {
    // Update cache to remove this tab
    inMemoryTabsCache = inMemoryTabsCache.filter(t => t.id !== quickTabId);
    lastKnownGoodTabCount = afterCount;
  }
}

/**
 * Remove from host info tracking
 * v1.6.3.5-v11 - Extracted to reduce handleStateDeletedMessage nesting depth
 * @param {string} quickTabId - Quick Tab ID to remove from tracking
 */
function _removeFromHostInfo(quickTabId) {
  if (quickTabHostInfo.has(quickTabId)) {
    quickTabHostInfo.delete(quickTabId);
    console.log('[Manager] Removed from quickTabHostInfo:', quickTabId);
  }
}

/**
 * Send MANAGER_COMMAND to background for remote Quick Tab control
 * v1.6.3.5-v3 - FIX Architecture Phase 3: Manager can control Quick Tabs in any tab
 * v1.6.3.5-v6 - ARCHITECTURE NOTE: This is the PREFERRED approach for Quick Tab control.
 *   Background routes commands to specific host tabs via quickTabHostTabs Map.
 *   This enables per-tab ownership and prevents cross-tab ghosting.
 *   
 * Currently used for: none (minimize/restore still use targeted messaging)
 * Should be used for: MINIMIZE_QUICK_TAB, RESTORE_QUICK_TAB, CLOSE_QUICK_TAB, FOCUS_QUICK_TAB
 * 
 * @param {string} command - Command to execute (MINIMIZE_QUICK_TAB, RESTORE_QUICK_TAB, etc.)
 * @param {string} quickTabId - Quick Tab ID
 * @returns {Promise<Object>} Response from background
 */
async function _sendManagerCommand(command, quickTabId) {
  console.log('[Manager] Sending MANAGER_COMMAND:', { command, quickTabId });
  
  try {
    const response = await browser.runtime.sendMessage({
      type: 'MANAGER_COMMAND',
      command,
      quickTabId,
      sourceContext: 'sidebar'
    });
    
    console.log('[Manager] Command response:', response);
    return response;
  } catch (err) {
    console.error('[Manager] Failed to send command:', { command, quickTabId, error: err.message });
    return { success: false, error: err.message };
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Cache DOM elements
  containersList = document.getElementById('containersList');
  emptyState = document.getElementById('emptyState');
  totalTabsEl = document.getElementById('totalTabs');
  lastSyncEl = document.getElementById('lastSync');

  // v1.6.3.5-v2 - FIX Report 1 Issue #2: Get current tab ID for origin filtering
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      currentBrowserTabId = tabs[0].id;
      console.log('[Manager] Current browser tab ID:', currentBrowserTabId);
    }
  } catch (err) {
    console.warn('[Manager] Could not get current tab ID:', err);
  }

  // v1.6.3.6-v11 - FIX Issue #11: Establish persistent port connection
  connectToBackground();

  // Load container information from Firefox API
  await loadContainerInfo();

  // Load Quick Tabs state from storage
  await loadQuickTabsState();

  // Render initial UI
  renderUI();

  // Setup event listeners
  setupEventListeners();
  
  // v1.6.3.7-v1 - FIX ISSUE #1: Setup tab switch detection
  // Re-render UI when user switches browser tabs to show context-relevant Quick Tabs
  setupTabSwitchListener();

  // Auto-refresh every 2 seconds
  setInterval(async () => {
    await loadQuickTabsState();
    renderUI();
  }, 2000);
  
  console.log('[Manager] v1.6.3.6-v11 Port connection + Message infrastructure initialized');
});

// v1.6.3.6-v11 - FIX Issue #17: Port cleanup on window unload
window.addEventListener('unload', () => {
  if (backgroundPort) {
    logPortLifecycle('unload', { reason: 'window-unload' });
    backgroundPort.disconnect();
    backgroundPort = null;
  }
  
  // Clear pending acks
  for (const [_correlationId, pending] of pendingAcks.entries()) {
    clearTimeout(pending.timeout);
  }
  pendingAcks.clear();
});

/**
 * Load Firefox Container Tab information
 * Uses contextualIdentities API to get container names, icons, colors
 * Cross-browser: Falls back gracefully if containers not supported (Chrome)
 */
async function loadContainerInfo() {
  try {
    // Cross-browser: Check if contextualIdentities API is available
    // Firefox: Native container support
    // Chrome: No container support, use default
    if (typeof browser.contextualIdentities === 'undefined') {
      console.warn('[Cross-browser] Contextual Identities API not available (Chrome/Edge)');
      // Fallback: Only show default container
      containersData['firefox-default'] = {
        name: 'Default',
        icon: '📁',
        color: 'grey',
        cookieStoreId: 'firefox-default'
      };
      return;
    }

    // Get all Firefox containers
    const containers = await browser.contextualIdentities.query({});

    // Map containers
    containersData = {};
    containers.forEach(container => {
      containersData[container.cookieStoreId] = {
        name: container.name,
        icon: getContainerIcon(container.icon),
        color: container.color,
        colorCode: container.colorCode,
        cookieStoreId: container.cookieStoreId
      };
    });

    // Always add default container
    containersData['firefox-default'] = {
      name: 'Default',
      icon: '📁',
      color: 'grey',
      colorCode: '#808080',
      cookieStoreId: 'firefox-default'
    };

    console.log('Loaded container info:', containersData);
  } catch (err) {
    console.error('Error loading container info:', err);
  }
}

/**
 * Convert Firefox container icon identifier to emoji
 */
function getContainerIcon(icon) {
  const iconMap = {
    fingerprint: '🔒',
    briefcase: '💼',
    dollar: '💰',
    cart: '🛒',
    circle: '⭕',
    gift: '🎁',
    vacation: '🏖️',
    food: '🍴',
    fruit: '🍎',
    pet: '🐾',
    tree: '🌳',
    chill: '❄️',
    fence: '🚧'
  };

  return iconMap[icon] || '📁';
}

/**
 * Check if storage read should be debounced
 * v1.6.3.4-v6 - Extracted to reduce loadQuickTabsState complexity
 * Simply uses timing-based debounce (no storage read needed)
 * v1.6.3.5-v2 - FIX Report 2 Issue #2: Reduced debounce from 300ms to 50ms
 * @returns {Promise<void>} Resolves when ready to read
 */
async function checkStorageDebounce() {
  const now = Date.now();
  const timeSinceLastRead = now - lastStorageReadTime;
  
  // If within debounce period, wait the remaining time
  if (timeSinceLastRead < STORAGE_READ_DEBOUNCE_MS) {
    const waitTime = STORAGE_READ_DEBOUNCE_MS - timeSinceLastRead;
    console.log('[Manager] Debouncing storage read, waiting', waitTime, 'ms');
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  lastStorageReadTime = Date.now();
}

/**
 * Handle empty storage state
 * v1.6.3.5-v4 - Extracted to reduce loadQuickTabsState nesting depth
 * v1.6.3.5-v11 - FIX Issue #6: Clear cache when storage is legitimately empty
 *   If storage is empty and cache has only 1 tab, this is a legitimate single-tab deletion.
 *   Sets quickTabsState and logs appropriately - used as flow control signal
 */
function _handleEmptyStorageState() {
  // v1.6.3.5-v11 - FIX Issue #6: Check if this is a legitimate single-tab deletion
  if (inMemoryTabsCache.length === 1) {
    console.log('[Manager] Storage empty with single-tab cache - clearing cache (legitimate deletion)');
    inMemoryTabsCache = [];
    lastKnownGoodTabCount = 0;
    quickTabsState = {};
    return;
  }
  
  // Multiple tabs in cache but storage empty - use cache (potential storm protection)
  if (inMemoryTabsCache.length > 1) {
    console.log('[Manager] Storage returned empty but cache has', inMemoryTabsCache.length, 'tabs - using cache');
    quickTabsState = { tabs: inMemoryTabsCache, timestamp: Date.now() };
  } else {
    // Cache is empty too - normal empty state
    quickTabsState = {};
    console.log('[Manager] Loaded Quick Tabs state: empty');
  }
}

/**
 * Detect and handle storage storm (0 tabs but cache has tabs)
 * v1.6.3.5-v4 - Extracted to reduce loadQuickTabsState nesting depth
 * v1.6.3.5-v11 - FIX Issue #6: Allow legitimate single-tab deletions (cache=1, storage=0)
 *   Storage storms are detected when MULTIPLE tabs vanish unexpectedly.
 *   A single tab going to 0 is legitimate user action.
 * @param {Object} state - Storage state
 * @returns {boolean} True if storm detected and handled
 */
function _detectStorageStorm(state) {
  const storageTabs = state.tabs || [];
  
  // No storm if storage has tabs
  if (storageTabs.length !== 0) {
    return false;
  }
  
  // No cache to protect - no storm possible
  if (inMemoryTabsCache.length < MIN_TABS_FOR_CACHE_PROTECTION) {
    return false;
  }
  
  // v1.6.3.5-v11 - FIX Issue #6: Single tab deletion is legitimate, not a storm
  // If cache has exactly 1 tab and storage has 0, user closed the last Quick Tab
  if (inMemoryTabsCache.length === 1) {
    console.log('[Manager] Single tab→0 transition detected - clearing cache (legitimate deletion)');
    // Clear the cache to accept the new 0-tab state
    inMemoryTabsCache = [];
    lastKnownGoodTabCount = 0;
    return false; // Not a storm - proceed with normal update
  }
  
  // Multiple tabs vanished at once - this IS a storage storm
  console.warn('[Manager] ⚠️ Storage storm detected - 0 tabs in storage but', inMemoryTabsCache.length, 'in cache:', {
    storageTabCount: storageTabs.length,
    cacheTabCount: inMemoryTabsCache.length,
    lastKnownGoodCount: lastKnownGoodTabCount,
    saveId: state.saveId
  });
  quickTabsState = { tabs: inMemoryTabsCache, timestamp: Date.now() };
  console.log('[Manager] Using in-memory cache to prevent list clearing');
  return true;
}

/**
 * Update in-memory cache with valid state
 * v1.6.3.5-v4 - Extracted to reduce loadQuickTabsState nesting depth
 * v1.6.3.5-v11 - FIX Issue #6: Also update cache when tabs.length is 0 (legitimate deletion)
 *   The cache must be cleared when tabs legitimately reach 0, not just updated when > 0.
 * @param {Array} tabs - Tabs array from storage
 */
function _updateInMemoryCache(tabs) {
  if (tabs.length > 0) {
    inMemoryTabsCache = [...tabs];
    lastKnownGoodTabCount = tabs.length;
    console.log('[Manager] Updated in-memory cache:', { tabCount: tabs.length });
  } else if (lastKnownGoodTabCount === 1) {
    // v1.6.3.5-v11 - FIX Issue #6: Clear cache when going from 1→0 (single-tab deletion)
    console.log('[Manager] Clearing in-memory cache (single-tab deletion detected)');
    inMemoryTabsCache = [];
    lastKnownGoodTabCount = 0;
  }
  // Note: If lastKnownGoodTabCount > 1 and tabs.length === 0, we don't clear the cache
  // because this might be a storage storm. _detectStorageStorm handles that case.
}

/**
 * Load Quick Tabs state from browser.storage.local
 * v1.6.3 - FIX: Changed from storage.sync to storage.local (storage location since v1.6.0.12)
 * v1.6.3.4-v6 - FIX Issue #1: Debounce reads to avoid mid-transaction reads
 * v1.6.3.5-v4 - FIX Diagnostic Issue #2: Use in-memory cache to protect against storage storms
 * v1.6.3.5-v6 - FIX Diagnostic Issue #5: Log storage read operations
 * Refactored: Extracted helpers to reduce complexity and nesting depth
 */
async function loadQuickTabsState() {
  const loadStartTime = Date.now();
  
  try {
    await checkStorageDebounce();
    
    // v1.6.3.5-v6 - FIX Diagnostic Issue #5: Log storage read start
    console.log('[Manager] Reading Quick Tab state from storage...');
    
    const result = await browser.storage.local.get(STATE_KEY);
    const state = result?.[STATE_KEY];

    if (!state) {
      _handleEmptyStorageState();
      console.log('[Manager] Storage read complete: empty state', {
        source: 'storage.local',
        durationMs: Date.now() - loadStartTime
      });
      return;
    }
    
    // v1.6.3.5-v6 - FIX Diagnostic Issue #5: Log storage read result
    console.log('[Manager] Storage read result:', {
      tabCount: state.tabs?.length ?? 0,
      saveId: state.saveId,
      timestamp: state.timestamp,
      source: 'storage.local',
      durationMs: Date.now() - loadStartTime
    });
    
    // v1.6.3.4-v6 - FIX Issue #5: Check if state has actually changed
    const newHash = computeStateHash(state);
    if (newHash === lastRenderedStateHash) {
      console.log('[Manager] Storage state unchanged (hash match), skipping update');
      return;
    }
    
    // v1.6.3.5-v4 - FIX Diagnostic Issue #2: Protect against storage storms
    if (_detectStorageStorm(state)) return;
    
    // v1.6.3.5-v4 - Update cache with new valid state
    _updateInMemoryCache(state.tabs || []);
    
    quickTabsState = state;
    filterInvalidTabs(quickTabsState);
    
    // v1.6.3.5-v7 - FIX Issue #7: Update lastLocalUpdateTime when we receive new state from storage
    lastLocalUpdateTime = Date.now();
    
    console.log('[Manager] Loaded Quick Tabs state:', quickTabsState);
  } catch (err) {
    console.error('[Manager] Error loading Quick Tabs state:', err);
  }
}

/**
 * Update UI stats (total tabs and last sync time)
 * @param {number} totalTabs - Number of Quick Tabs
 * @param {number} latestTimestamp - Timestamp of last sync
 */
function updateUIStats(totalTabs, latestTimestamp) {
  totalTabsEl.textContent = `${totalTabs} Quick Tab${totalTabs !== 1 ? 's' : ''}`;

  const effectiveTimestamp = lastLocalUpdateTime > 0 ? lastLocalUpdateTime : latestTimestamp;
  
  if (effectiveTimestamp > 0) {
    const date = new Date(effectiveTimestamp);
    const timeStr = date.toLocaleTimeString();
    lastSyncEl.textContent = `Last sync: ${timeStr}`;
    
    console.log('[Manager] Last sync updated:', {
      timestamp: effectiveTimestamp,
      formatted: timeStr,
      totalTabs
    });
  } else {
    lastSyncEl.textContent = 'Last sync: Never';
  }
}

/**
 * Render the Quick Tabs Manager UI
 */
async function renderUI() {
  const renderStartTime = Date.now();
  const { allTabs, latestTimestamp } = extractTabsFromState(quickTabsState);
  
  _logRenderStart(allTabs);
  updateUIStats(allTabs.length, latestTimestamp);
  
  if (allTabs.length === 0) {
    _showEmptyState();
    // v1.6.3.6-v11 - FIX Issue #20: Clean up count tracking when empty
    previousGroupCounts.clear();
    return;
  }
  
  _showContentState();
  const groups = groupQuickTabsByOriginTab(allTabs);
  const collapseState = await loadCollapseState();
  
  _logGroupRendering(groups);
  
  // v1.6.3.6-v11 - FIX Issue #20: Clean up stale count tracking
  const currentGroupKeys = new Set([...groups.keys()].map(String));
  cleanupPreviousGroupCounts(currentGroupKeys);
  
  const groupsContainer = await _buildGroupsContainer(groups, collapseState);
  checkAndRemoveEmptyGroups(groupsContainer, groups);
  
  containersList.appendChild(groupsContainer);
  attachCollapseEventListeners(groupsContainer, collapseState);
  
  lastRenderedStateHash = computeStateHash(quickTabsState);
  _logRenderComplete(allTabs, groups, renderStartTime);
}

/**
 * Log render start with comprehensive details
 * @private
 */
function _logRenderStart(allTabs) {
  const activeTabs = allTabs.filter(t => !isTabMinimizedHelper(t));
  const minimizedTabs = allTabs.filter(t => isTabMinimizedHelper(t));
  
  console.log('[Manager] UI Rebuild starting:', {
    totalTabs: allTabs.length,
    activeCount: activeTabs.length,
    minimizedCount: minimizedTabs.length,
    cacheCount: inMemoryTabsCache.length,
    lastRenderedHash: lastRenderedStateHash,
    trigger: 'renderUI()',
    timestamp: Date.now()
  });
  
  console.log('[Manager] UI List contents:', {
    activeTabIds: activeTabs.map(t => ({ id: t.id, url: t.url?.substring(0, 50) })),
    minimizedTabIds: minimizedTabs.map(t => ({ id: t.id, minimized: true }))
  });
}

/**
 * Show empty state UI
 * @private
 */
function _showEmptyState() {
  containersList.style.display = 'none';
  emptyState.style.display = 'flex';
  console.log('[Manager] UI showing empty state (0 tabs)');
}

/**
 * Show content state UI
 * @private
 */
function _showContentState() {
  containersList.style.display = 'block';
  emptyState.style.display = 'none';
  containersList.innerHTML = '';
}

/**
 * Log group rendering info
 * @private
 */
function _logGroupRendering(groups) {
  console.log('[Manager] Issue #1: Rendering groups directly (no global header)', {
    groupCount: groups.size,
    groupKeys: [...groups.keys()]
  });
}

/**
 * Build the groups container with all tab groups
 * @private
 */
async function _buildGroupsContainer(groups, collapseState) {
  const groupsContainer = document.createElement('div');
  groupsContainer.className = 'tab-groups-container';
  
  const sortedGroupKeys = _getSortedGroupKeys(groups);
  await _fetchMissingTabInfo(sortedGroupKeys, groups);
  _resortGroupKeys(sortedGroupKeys, groups);
  
  for (const groupKey of sortedGroupKeys) {
    const group = groups.get(groupKey);
    if (_shouldSkipGroup(group, groupKey)) continue;
    
    const detailsEl = renderTabGroup(groupKey, group, collapseState);
    groupsContainer.appendChild(detailsEl);
  }
  
  return groupsContainer;
}

/**
 * Get sorted group keys (orphaned last, closed before orphaned)
 * @private
 */
function _getSortedGroupKeys(groups) {
  return [...groups.keys()].sort((a, b) => _compareGroupKeys(a, b, groups));
}

/**
 * Compare group keys for sorting
 * @private
 */
function _compareGroupKeys(a, b, groups) {
  if (a === 'orphaned') return 1;
  if (b === 'orphaned') return -1;
  
  const aGroup = groups.get(a);
  const bGroup = groups.get(b);
  const aClosed = !aGroup.tabInfo;
  const bClosed = !bGroup.tabInfo;
  
  if (aClosed && !bClosed) return 1;
  if (!aClosed && bClosed) return -1;
  
  return Number(a) - Number(b);
}

/**
 * Fetch missing browser tab info
 * @private
 */
async function _fetchMissingTabInfo(sortedGroupKeys, groups) {
  for (const groupKey of sortedGroupKeys) {
    const group = groups.get(groupKey);
    if (groupKey !== 'orphaned' && !group.tabInfo) {
      group.tabInfo = await fetchBrowserTabInfo(groupKey);
    }
  }
}

/**
 * Re-sort group keys after fetching tab info
 * @private
 */
function _resortGroupKeys(sortedGroupKeys, groups) {
  sortedGroupKeys.sort((a, b) => _compareGroupKeys(a, b, groups));
}

/**
 * Check if a group should be skipped
 * @private
 */
function _shouldSkipGroup(group, groupKey) {
  if (!group.quickTabs || group.quickTabs.length === 0) {
    console.log(`[Manager] Skipping empty group [${groupKey}]`);
    return true;
  }
  return false;
}

/**
 * Log render completion
 * @private
 */
function _logRenderComplete(allTabs, groups, renderStartTime) {
  const activeTabs = allTabs.filter(t => !isTabMinimizedHelper(t));
  const minimizedTabs = allTabs.filter(t => isTabMinimizedHelper(t));
  const renderDuration = Date.now() - renderStartTime;
  
  console.log('[Manager] UI Rebuild complete:', {
    renderedActive: activeTabs.length,
    renderedMinimized: minimizedTabs.length,
    groupCount: groups.size,
    newHash: lastRenderedStateHash,
    durationMs: renderDuration
  });
}

/**
 * Issue #4: Render a single tab group as a <details> element
 * v1.6.4.10 - Enhanced with Issues #2, #4, #5, #6, #8, #9 improvements
 * Refactored to reduce complexity by extracting helper functions
 * @param {number|string} groupKey - originTabId or 'orphaned'
 * @param {Object} group - { quickTabs: Array, tabInfo: Object | null }
 * @param {Object} collapseState - Current collapse state
 * @returns {HTMLDetailsElement}
 */
function renderTabGroup(groupKey, group, collapseState) {
  const details = document.createElement('details');
  details.className = 'tab-group';
  details.dataset.originTabId = String(groupKey);
  
  const isOrphaned = groupKey === 'orphaned';
  const isClosedTab = !isOrphaned && !group.tabInfo;
  
  // Issue #5/#6: Add special classes
  if (isOrphaned) details.classList.add('orphaned');
  if (isClosedTab) details.classList.add('closed-tab-group');
  
  // Issue #3: Apply saved collapse state (default: expanded)
  details.open = collapseState[groupKey] !== true;
  
  // Build header and content
  const summary = _createGroupHeader(groupKey, group, isOrphaned, isClosedTab);
  const content = _createGroupContent(group.quickTabs, details.open);
  
  details.appendChild(summary);
  details.appendChild(content);
  
  return details;
}

/**
 * Create the group header (summary element)
 * @private
 * @param {number|string} groupKey - Group key
 * @param {Object} group - Group data
 * @param {boolean} isOrphaned - Whether this is the orphaned group
 * @param {boolean} isClosedTab - Whether the browser tab is closed
 * @returns {HTMLElement}
 */
function _createGroupHeader(groupKey, group, isOrphaned, isClosedTab) {
  const summary = document.createElement('summary');
  summary.className = 'tab-group-header';
  
  // Issue #9: Favicon - use imported createGroupFavicon
  createGroupFavicon(summary, groupKey, group);
  
  // Title
  const title = _createGroupTitle(groupKey, group, isOrphaned, isClosedTab);
  summary.appendChild(title);
  
  // Issue #2: Tab ID (non-orphaned only)
  if (!isOrphaned) {
    const tabIdSpan = document.createElement('span');
    tabIdSpan.className = 'tab-group-tab-id';
    tabIdSpan.textContent = `#${groupKey}`;
    summary.appendChild(tabIdSpan);
  }
  
  // Issue #6: Closed tab badge with detailed tooltip
  if (isClosedTab) {
    const closedBadge = document.createElement('span');
    closedBadge.className = 'closed-tab-badge';
    closedBadge.textContent = '🚫 Closed';
    // Issue #6: Detailed tooltip explaining why tabs cannot be restored
    closedBadge.title = 'Browser tab has been closed. Quick Tabs in this group cannot be restored to their original tab. Close them or use "Adopt" to move to current tab.';
    summary.appendChild(closedBadge);
  }
  
  // Issue #5: Orphaned badge with detailed tooltip
  if (isOrphaned) {
    const orphanedBadge = document.createElement('span');
    orphanedBadge.className = 'orphaned-badge';
    orphanedBadge.textContent = '⚠️ Cannot restore';
    // Issue #5: Detailed tooltip explaining orphaned state
    orphanedBadge.title = 'These Quick Tabs have no associated browser tab (originTabId is null). They cannot be restored. Use "Adopt" button to assign to current tab, or close them.';
    summary.appendChild(orphanedBadge);
  }
  
  // Issue #2/#10/#20: Count badge with update tracking and animation
  const count = document.createElement('span');
  count.className = 'tab-group-count';
  count.textContent = String(group.quickTabs.length);
  count.dataset.count = String(group.quickTabs.length); // For tracking updates
  // v1.6.3.6-v11 - FIX Issue #20: Apply animation if count changed
  animateCountBadgeIfChanged(groupKey, group.quickTabs.length, count);
  summary.appendChild(count);
  
  return summary;
}

/**
 * Create group title element
 * @private
 */
function _createGroupTitle(groupKey, group, isOrphaned, _isClosedTab) {
  const title = document.createElement('span');
  title.className = 'tab-group-title';
  
  if (isOrphaned) {
    title.textContent = '⚠️ Orphaned Quick Tabs';
    title.title = 'These Quick Tabs belong to browser tabs that have closed. They cannot be restored.';
  } else if (group.tabInfo?.title) {
    title.textContent = group.tabInfo.title;
    title.title = group.tabInfo.url || '';
  } else {
    title.textContent = `Tab ${groupKey}`;
    title.classList.add('closed-tab');
    title.title = 'This browser tab has been closed. Quick Tabs cannot be restored.';
  }
  
  return title;
}

/**
 * Create group content element with Quick Tab items
 * Issue #2: Removed inline maxHeight initialization - CSS handles initial state
 * Issue #6: Added logging for section header creation
 * @private
 * @param {Array} quickTabs - Array of Quick Tab objects
 * @param {boolean} isOpen - Whether group starts open
 * @returns {HTMLElement}
 */
function _createGroupContent(quickTabs, isOpen) {
  const content = document.createElement('div');
  content.className = 'tab-group-content';
  
  // Sort: active first, then minimized
  const sortedTabs = [...quickTabs].sort((a, b) => {
    return (isTabMinimizedHelper(a) ? 1 : 0) - (isTabMinimizedHelper(b) ? 1 : 0);
  });
  
  const activeTabs = sortedTabs.filter(t => !isTabMinimizedHelper(t));
  const minimizedTabs = sortedTabs.filter(t => isTabMinimizedHelper(t));
  const hasBothSections = activeTabs.length > 0 && minimizedTabs.length > 0;
  
  // Issue #6: Log section creation with counts before DOM insertion
  console.log('[Manager] Creating group content sections:', {
    activeCount: activeTabs.length,
    minimizedCount: minimizedTabs.length,
    hasBothSections,
    isOpen,
    timestamp: Date.now()
  });
  
  // Issue #8: Section headers and dividers
  if (hasBothSections) {
    const activeHeader = _createSectionHeader(`Active (${activeTabs.length})`);
    content.appendChild(activeHeader);
    // Issue #6: Confirm DOM insertion
    console.log('[Manager] Section header inserted: Active', { count: activeTabs.length });
  }
  
  activeTabs.forEach(tab => content.appendChild(renderQuickTabItem(tab, 'global', false)));
  
  if (hasBothSections) {
    content.appendChild(_createSectionDivider('minimized'));
    const minimizedHeader = _createSectionHeader(`Minimized (${minimizedTabs.length})`);
    content.appendChild(minimizedHeader);
    // Issue #6: Confirm DOM insertion
    console.log('[Manager] Section header inserted: Minimized', { count: minimizedTabs.length });
  }
  
  minimizedTabs.forEach(tab => content.appendChild(renderQuickTabItem(tab, 'global', true)));
  
  // Issue #2: DO NOT set inline maxHeight - CSS handles initial state via :not([open])
  // The animation functions (animateCollapse/animateExpand) calculate scrollHeight dynamically
  // Setting inline styles here conflicts with CSS rules and JS animations
  if (!isOpen) {
    // Only set for initially collapsed state - will be managed by animation functions
    content.style.maxHeight = '0';
    content.style.opacity = '0';
  }
  // Issue #2: For open state, rely on CSS defaults (no inline styles)
  
  return content;
}

/**
 * Create section header element
 * @private
 */
function _createSectionHeader(text) {
  const header = document.createElement('div');
  header.className = 'section-header';
  header.textContent = text;
  return header;
}

/**
 * Create section divider element
 * @private
 */
function _createSectionDivider(label) {
  const divider = document.createElement('div');
  divider.className = 'section-divider';
  divider.dataset.label = label;
  return divider;
}

/**
 * Issue #9: Create favicon element with timeout and fallback
/**
 * Issue #1/#5: Attach event listeners for collapse toggle with smooth animations
 * v1.6.3.6-v11 - FIX Issues #1, #5: Animations properly invoked, consistent state terminology
 * v1.6.4.10 - Enhanced with smooth height animations and scroll-into-view
 * @param {HTMLElement} container - Container with <details> elements
 * @param {Object} collapseState - Current collapse state (will be modified)
 */
function attachCollapseEventListeners(container, collapseState) {
  const detailsElements = container.querySelectorAll('details.tab-group');
  
  for (const details of detailsElements) {
    const content = details.querySelector('.tab-group-content');
    let isAnimating = false;
    
    // Issue #1: Override default toggle behavior to invoke animation functions
    details.querySelector('summary').addEventListener('click', async (e) => {
      // Issue #1: Prevent default toggle to manually control via animation functions
      e.preventDefault();
      
      // Issue #1: isAnimating flag prevents rapid-click issues
      if (isAnimating) {
        console.log(`[Manager] Toggle ignored - animation in progress for [${details.dataset.originTabId}]`);
        return;
      }
      isAnimating = true;
      
      const originTabId = details.dataset.originTabId;
      const isCurrentlyOpen = details.open;
      
      // Issue #5: Use consistent state terminology via imported constants
      const fromState = isCurrentlyOpen ? STATE_OPEN : STATE_CLOSED;
      const toState = isCurrentlyOpen ? STATE_CLOSED : STATE_OPEN;
      
      // Issue #5: Use unified state transition logging
      logStateTransition(originTabId, 'toggle', fromState, toState, {
        trigger: 'user-click',
        animationPending: true
      });
      
      if (isCurrentlyOpen) {
        // Issue #1: INVOKE animateCollapse - this was previously not being called
        console.log(`[Manager] Invoking animateCollapse() for group [${originTabId}]`);
        const result = await animateCollapse(details, content);
        console.log(`[Manager] animateCollapse() completed for group [${originTabId}]:`, result);
      } else {
        // Issue #1: INVOKE animateExpand - this was previously not being called  
        console.log(`[Manager] Invoking animateExpand() for group [${originTabId}]`);
        const result = await animateExpand(details, content);
        console.log(`[Manager] animateExpand() completed for group [${originTabId}]:`, result);
        
        // Issue #4: Scroll into view if group is off-screen after expanding
        scrollIntoViewIfNeeded(details);
      }
      
      // Update collapse state
      const isNowCollapsed = !details.open;
      if (isNowCollapsed) {
        collapseState[originTabId] = true;
      } else {
        delete collapseState[originTabId];
      }
      
      // Issue #3: Save to storage
      await saveCollapseState(collapseState);
      
      isAnimating = false;
    });
  }
}

/**
 * Render a single Quick Tab item
 */

/**
 * v1.6.3.4-v3 - Helper to get position value from flat or nested format
 * @param {Object} tab - Quick Tab data
 * @param {string} flatKey - Key for flat format (e.g., 'width')
 * @param {string} nestedKey - Key for nested format (e.g., 'size')
 * @param {string} prop - Property name (e.g., 'width')
 * @returns {number|undefined} The value or undefined
 */
function _getValue(tab, flatKey, nestedKey, prop) {
  return tab[flatKey] ?? tab[nestedKey]?.[prop];
}

/**
 * v1.6.3.4 - Helper to format size and position string for tab metadata
 * Extracted to reduce complexity in _createTabInfo
 * FIX Issue #3: Only show position if both left and top are defined
 * v1.6.3.4-v3 - FIX TypeError: Handle both flat and nested position/size formats
 * @param {Object} tab - Quick Tab data
 * @returns {string|null} Formatted size/position string or null
 */
function _formatSizePosition(tab) {
  // v1.6.3.4-v3 - FIX TypeError: Handle both flat (width/height) and nested (size.width) formats
  const width = _getValue(tab, 'width', 'size', 'width');
  const height = _getValue(tab, 'height', 'size', 'height');
  
  if (!width || !height) {
    return null;
  }
  
  let sizeStr = `${Math.round(width)}×${Math.round(height)}`;
  
  // v1.6.3.4-v3 - FIX TypeError: Handle both flat (left/top) and nested (position.left) formats
  const left = _getValue(tab, 'left', 'position', 'left');
  const top = _getValue(tab, 'top', 'position', 'top');
  
  // v1.6.3.4 - FIX Issue #3: Only show position if both values exist
  if (left != null && top != null) {
    sizeStr += ` at (${Math.round(left)}, ${Math.round(top)})`;
  }
  
  return sizeStr;
}

/**
 * Create tab info section (title + metadata)
 * v1.6.3.4 - FIX Bug #6: Added position display (x, y) alongside size
 * @param {Object} tab - Quick Tab data
 * @param {boolean} isMinimized - Whether tab is minimized
 * @returns {HTMLDivElement} Tab info element
 */
function _createTabInfo(tab, isMinimized) {
  const tabInfo = document.createElement('div');
  tabInfo.className = 'tab-info';

  const title = document.createElement('div');
  title.className = 'tab-title';
  title.textContent = tab.title || 'Quick Tab';
  title.title = tab.title || tab.url;

  const meta = document.createElement('div');
  meta.className = 'tab-meta';

  // Build metadata string
  const metaParts = [];

  if (isMinimized) {
    metaParts.push('Minimized');
  }

  if (tab.activeTabId) {
    metaParts.push(`Tab ${tab.activeTabId}`);
  }

  // v1.6.3.4 - FIX Bug #6: Size with position display
  const sizePosition = _formatSizePosition(tab);
  if (sizePosition) {
    metaParts.push(sizePosition);
  }

  if (tab.slotNumber) {
    metaParts.push(`Slot ${tab.slotNumber}`);
  }

  meta.textContent = metaParts.join(' • ');

  tabInfo.appendChild(title);
  tabInfo.appendChild(meta);

  return tabInfo;
}

/**
 * Create action buttons for Quick Tab
 * v1.6.3.4-v5 - FIX Issue #4: Disable restore button when operation in progress (domVerified=false)
 * v1.6.3.7-v1 - FIX ISSUE #8: Add visual indicator and "Adopt" button for orphaned tabs
 *   - Orphaned = originTabId is null/undefined OR originTabId browser tab is closed
 *   - "Adopt" button moves Quick Tab to current browser tab
 * @param {Object} tab - Quick Tab data
 * @param {boolean} isMinimized - Whether tab is minimized
 * @returns {HTMLDivElement} Actions element
 */
/**
 * Create tab action buttons
 * v1.6.4.11 - Refactored to reduce bumpy road complexity
 * @param {Object} tab - Quick Tab data
 * @param {boolean} isMinimized - Whether tab is minimized
 * @returns {HTMLElement} Actions container
 */
function _createTabActions(tab, isMinimized) {
  const actions = document.createElement('div');
  actions.className = 'tab-actions';
  
  const context = _buildTabActionContext(tab, isMinimized);
  
  if (!isMinimized) {
    _appendActiveTabActions(actions, tab, context);
  } else {
    _appendMinimizedTabActions(actions, tab, context);
  }
  
  // Adopt button for orphaned tabs
  if (context.isOrphaned && currentBrowserTabId) {
    _appendAdoptButton(actions, tab);
  }
  
  // Close button (always available)
  _appendCloseButton(actions, tab);
  
  return actions;
}

/**
 * Build context for tab action creation
 * @private
 */
function _buildTabActionContext(tab, isMinimized) {
  return {
    isRestorePending: !isMinimized && tab.domVerified === false,
    isOrphaned: _isOrphanedQuickTab(tab)
  };
}

/**
 * Append action buttons for active (non-minimized) tabs
 * @private
 */
function _appendActiveTabActions(actions, tab, context) {
  // Go to Tab button
  if (tab.activeTabId) {
    const goToTabBtn = _createActionButton('🔗', `Go to Tab ${tab.activeTabId}`, {
      action: 'goToTab',
      tabId: tab.activeTabId
    });
    actions.appendChild(goToTabBtn);
  }
  
  // Minimize button
  const minimizeBtn = _createActionButton('➖', 'Minimize', {
    action: 'minimize',
    quickTabId: tab.id
  });
  
  if (context.isRestorePending) {
    minimizeBtn.disabled = true;
    minimizeBtn.title = 'Restore in progress...';
  }
  
  actions.appendChild(minimizeBtn);
}

/**
 * Append action buttons for minimized tabs
 * @private
 */
function _appendMinimizedTabActions(actions, tab, context) {
  const restoreBtn = _createActionButton('↑', 'Restore', {
    action: 'restore',
    quickTabId: tab.id
  });
  
  if (context.isOrphaned) {
    restoreBtn.disabled = true;
    restoreBtn.title = 'Cannot restore - browser tab was closed. Use "Adopt to Current Tab" first.';
  }
  
  actions.appendChild(restoreBtn);
}

/**
 * Append adopt button for orphaned tabs
 * @private
 */
function _appendAdoptButton(actions, tab) {
  const adoptBtn = _createActionButton('📥', `Adopt to current tab (Tab #${currentBrowserTabId})`, {
    action: 'adoptToCurrentTab',
    quickTabId: tab.id,
    targetTabId: currentBrowserTabId
  });
  adoptBtn.classList.add('btn-adopt');
  actions.appendChild(adoptBtn);
}

/**
 * Append close button
 * @private
 */
function _appendCloseButton(actions, tab) {
  const closeBtn = _createActionButton('✕', 'Close', {
    action: 'close',
    quickTabId: tab.id
  });
  actions.appendChild(closeBtn);
}

/**
 * Create a standard action button
 * @private
 * @param {string} text - Button text
 * @param {string} title - Button title/tooltip
 * @param {Object} dataset - Data attributes to set
 * @returns {HTMLButtonElement}
 */
function _createActionButton(text, title, dataset) {
  const btn = document.createElement('button');
  btn.className = 'btn-icon';
  btn.textContent = text;
  btn.title = title;
  
  for (const [key, value] of Object.entries(dataset)) {
    btn.dataset[key] = value;
  }
  
  return btn;
}

/**
 * Check if a Quick Tab is orphaned (no valid browser tab to restore to)
 * v1.6.3.7-v1 - FIX ISSUE #8: Detect orphaned tabs
 * @private
 * @param {Object} tab - Quick Tab data
 * @returns {boolean} True if orphaned
 */
function _isOrphanedQuickTab(tab) {
  // No originTabId means definitely orphaned
  if (tab.originTabId == null) {
    return true;
  }
  
  // Check if the origin tab is still open using cached browser tab info
  const cachedInfo = browserTabInfoCache.get(tab.originTabId);
  if (cachedInfo && cachedInfo.data === null) {
    // Cache indicates this tab was closed
    return true;
  }
  
  // Not orphaned (or we don't have confirmation yet)
  return false;
}

/**
 * Determine status indicator class based on tab state
 * v1.6.3.4-v10 - FIX Issue #4: Check domVerified for warning indicator
 * @param {Object} tab - Quick Tab data
 * @param {boolean} isMinimized - Whether tab is minimized
 * @returns {string} - CSS class for indicator color
 */
function _getIndicatorClass(tab, isMinimized) {
  // Minimized tabs show yellow indicator
  if (isMinimized) {
    return 'yellow';
  }
  
  // v1.6.3.4-v10 - FIX Issue #4: Check domVerified property
  // If domVerified is explicitly false, show orange/warning indicator
  // This means restore was attempted but DOM wasn't actually rendered
  if (tab.domVerified === false) {
    return 'orange';
  }
  
  // Active tabs with verified DOM show green
  return 'green';
}

function renderQuickTabItem(tab, cookieStoreId, isMinimized) {
  const item = document.createElement('div');
  item.className = `quick-tab-item ${isMinimized ? 'minimized' : 'active'}`;
  item.dataset.tabId = tab.id;
  item.dataset.containerId = cookieStoreId;

  // Status indicator
  // v1.6.3.4-v10 - FIX Issue #4: Use helper function for indicator class
  const indicator = document.createElement('span');
  const indicatorClass = _getIndicatorClass(tab, isMinimized);
  indicator.className = `status-indicator ${indicatorClass}`;
  
  // v1.6.3.4-v10 - FIX Issue #4: Add tooltip for warning state
  if (indicatorClass === 'orange') {
    indicator.title = 'Warning: Window may not be visible. Try restoring again.';
  }

  // Create components - using imported createFavicon
  const favicon = createFavicon(tab.url);
  const tabInfo = _createTabInfo(tab, isMinimized);
  const actions = _createTabActions(tab, isMinimized);

  // Assemble item
  item.appendChild(indicator);
  item.appendChild(favicon);
  item.appendChild(tabInfo);
  item.appendChild(actions);

  return item;
}

/**
 * Setup event listeners for user interactions
 */
function setupEventListeners() {
  // Close Minimized button
  document.getElementById('closeMinimized').addEventListener('click', async () => {
    await closeMinimizedTabs();
  });

  // Close All button
  document.getElementById('closeAll').addEventListener('click', async () => {
    await closeAllTabs();
  });

  // Delegated event listener for Quick Tab actions
  containersList.addEventListener('click', async e => {
    const button = e.target.closest('button[data-action]');
    if (!button) return;

    const action = button.dataset.action;
    const quickTabId = button.dataset.quickTabId;
    const tabId = button.dataset.tabId;

    switch (action) {
      case 'goToTab':
        await goToTab(parseInt(tabId));
        break;
      case 'minimize':
        await minimizeQuickTab(quickTabId);
        break;
      case 'restore':
        await restoreQuickTab(quickTabId);
        break;
      case 'close':
        await closeQuickTab(quickTabId);
        break;
      // v1.6.3.7-v1 - FIX ISSUE #8: Handle adopt to current tab action
      case 'adoptToCurrentTab':
        await adoptQuickTabToCurrentTab(quickTabId, parseInt(button.dataset.targetTabId));
        break;
    }
  });

  // Listen for storage changes to auto-update
  // v1.6.3 - FIX: Changed from 'sync' to 'local' (storage location since v1.6.0.12)
  // v1.6.3.4-v6 - FIX Issue #1: Debounce storage reads to avoid mid-transaction reads
  // v1.6.3.4-v9 - FIX Issue #18: Add reconciliation logic for suspicious storage changes
  // v1.6.3.5-v2 - FIX Report 2 Issue #6: Refactored to reduce complexity
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[STATE_KEY]) return;
    _handleStorageChange(changes[STATE_KEY]);
  });
}

/**
 * Setup browser tab activation listener for real-time context updates
 * v1.6.3.7-v1 - FIX ISSUE #1: Manager Panel Shows Orphaned Quick Tabs
 * When user switches between browser tabs, update the Manager to show
 * context-relevant Quick Tabs (those with originTabId matching current tab)
 */
function setupTabSwitchListener() {
  // Listen for tab activation (user switches to a different tab)
  browser.tabs.onActivated.addListener((activeInfo) => {
    const newTabId = activeInfo.tabId;
    
    // Only process if tab actually changed
    if (newTabId === currentBrowserTabId) {
      return;
    }
    
    previousBrowserTabId = currentBrowserTabId;
    currentBrowserTabId = newTabId;
    
    console.log('[Manager] 🔄 TAB_SWITCH_DETECTED:', {
      previousTabId: previousBrowserTabId,
      currentTabId: currentBrowserTabId,
      timestamp: Date.now()
    });
    
    // Clear browser tab info cache for the previous tab to ensure fresh data
    browserTabInfoCache.delete(previousBrowserTabId);
    
    // Re-render UI with filtered Quick Tabs for new tab context
    renderUI();
  });
  
  // Also listen for window focus changes (user switches browser windows)
  browser.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === browser.windows.WINDOW_ID_NONE) {
      return; // Window lost focus
    }
    
    try {
      // Get the active tab in the newly focused window
      const tabs = await browser.tabs.query({ active: true, windowId });
      if (tabs[0] && tabs[0].id !== currentBrowserTabId) {
        previousBrowserTabId = currentBrowserTabId;
        currentBrowserTabId = tabs[0].id;
        
        console.log('[Manager] 🪟 WINDOW_FOCUS_CHANGED:', {
          previousTabId: previousBrowserTabId,
          currentTabId: currentBrowserTabId,
          windowId
        });
        
        renderUI();
      }
    } catch (err) {
      console.warn('[Manager] Error handling window focus change:', err);
    }
  });
  
  console.log('[Manager] Tab switch listener initialized');
}

/**
 * Handle storage change event
 * v1.6.3.5-v2 - Extracted to reduce setupEventListeners complexity
 * v1.6.3.5-v6 - FIX Diagnostic Issue #5: Added comprehensive logging
 * v1.6.3.7-v1 - FIX ISSUE #5: Added writingTabId source identification
 * v1.6.4.11 - Refactored to reduce cyclomatic complexity from 23 to <9
 * @param {Object} change - The storage change object
 */
function _handleStorageChange(change) {
  const context = _buildStorageChangeContext(change);
  
  // Log the storage change
  _logStorageChangeEvent(context);
  
  // Log tab ID changes (added/removed)
  _logTabIdChanges(context);
  
  // Log position/size updates
  _logPositionSizeChanges(context);
  
  // Check for and handle suspicious drops
  if (_isSuspiciousStorageDrop(context.oldTabCount, context.newTabCount, context.newValue)) {
    _handleSuspiciousStorageDrop(context.oldValue);
    return;
  }
  
  _scheduleStorageUpdate();
}

/**
 * Build context object for storage change handling
 * v1.6.4.11 - Extracted to reduce _handleStorageChange complexity
 * @private
 * @param {Object} change - Storage change object
 * @returns {Object} Context with parsed values
 */
function _buildStorageChangeContext(change) {
  const newValue = change.newValue;
  const oldValue = change.oldValue;
  const oldTabCount = oldValue?.tabs?.length ?? 0;
  const newTabCount = newValue?.tabs?.length ?? 0;
  const sourceTabId = newValue?.writingTabId;
  const sourceInstanceId = newValue?.writingInstanceId;
  const isFromCurrentTab = sourceTabId === currentBrowserTabId;
  
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

/**
 * Log storage change event with comprehensive details
 * Issue #8: Unified logStorageEvent() format for sequence analysis
 * v1.6.4.11 - Extracted to reduce _handleStorageChange complexity
 * v1.6.3.6-v11 - FIX Issue #8: Unified storage event logging format
 * @private
 * @param {Object} context - Storage change context
 */
function _logStorageChangeEvent(context) {
  // Issue #8: Determine what changed (added/removed tab IDs)
  const oldIds = new Set((context.oldValue?.tabs || []).map(t => t.id));
  const newIds = new Set((context.newValue?.tabs || []).map(t => t.id));
  const addedIds = [...newIds].filter(id => !oldIds.has(id));
  const removedIds = [...oldIds].filter(id => !newIds.has(id));
  
  // Issue #8: Unified format for storage event logging
  console.log(`[Manager] STORAGE_CHANGED: tabs ${context.oldTabCount}→${context.newTabCount} (delta: ${context.newTabCount - context.oldTabCount}), saveId: '${context.newValue?.saveId || 'none'}', source: tab-${context.sourceTabId || 'unknown'}`, {
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
  });
}

/**
 * Log tab ID changes (added/removed)
 * v1.6.4.11 - Extracted to reduce _handleStorageChange complexity
 * @private
 * @param {Object} context - Storage change context
 */
function _logTabIdChanges(context) {
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
 * v1.6.4.11 - Extracted to reduce _handleStorageChange complexity
 * @private
 * @param {Object} context - Storage change context
 */
function _logPositionSizeChanges(context) {
  if (!context.newValue?.tabs || !context.oldValue?.tabs) {
    return;
  }
  
  const changedTabs = _identifyChangedTabs(context.oldValue.tabs, context.newValue.tabs);
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

/**
 * Identify tabs that changed position or size
 * v1.6.3.7-v1 - FIX ISSUE #4: Track position/size updates
 * @param {Array} oldTabs - Previous tabs array
 * @param {Array} newTabs - New tabs array
 * @returns {Object} Object with positionChanged and sizeChanged arrays
 */
/**
 * Identify tabs that have position or size changes
 * v1.6.4.11 - Refactored to reduce bumpy road complexity
 * @param {Array} oldTabs - Previous tab array
 * @param {Array} newTabs - New tab array
 * @returns {{ positionChanged: Array, sizeChanged: Array }}
 */
function _identifyChangedTabs(oldTabs, newTabs) {
  const oldTabMap = new Map(oldTabs.map(t => [t.id, t]));
  const positionChanged = [];
  const sizeChanged = [];
  
  for (const newTab of newTabs) {
    const oldTab = oldTabMap.get(newTab.id);
    if (!oldTab) continue;
    
    if (_hasPositionDiff(oldTab, newTab)) {
      positionChanged.push(newTab.id);
    }
    
    if (_hasSizeDiff(oldTab, newTab)) {
      sizeChanged.push(newTab.id);
    }
  }
  
  return { positionChanged, sizeChanged };
}

/**
 * Check if position has changed between tabs
 * @private
 */
function _hasPositionDiff(oldTab, newTab) {
  if (!newTab.position || !oldTab.position) return false;
  return newTab.position.x !== oldTab.position.x || 
         newTab.position.y !== oldTab.position.y;
}

/**
 * Check if size has changed between tabs
 * @private
 */
function _hasSizeDiff(oldTab, newTab) {
  if (!newTab.size || !oldTab.size) return false;
  return newTab.size.width !== oldTab.size.width || 
         newTab.size.height !== oldTab.size.height;
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
function _isSuspiciousStorageDrop(oldTabCount, newTabCount, newValue) {
  // Single tab deletion (1→0) is always legitimate - user closed last Quick Tab
  if (_isSingleTabDeletion(oldTabCount, newTabCount)) {
    console.log('[Manager] Single tab deletion detected (1→0) - legitimate operation');
    return false;
  }
  
  // Multi-tab drop to 0 is suspicious unless explicitly cleared
  const isMultiTabDrop = oldTabCount > 1 && newTabCount === 0;
  return isMultiTabDrop && !_isExplicitClearOperation(newValue);
}

/**
 * Check if this is a single tab deletion (legitimate)
 * @private
 */
function _isSingleTabDeletion(oldTabCount, newTabCount) {
  return oldTabCount === 1 && newTabCount === 0;
}

/**
 * Check if this is an explicit clear operation
 * @private
 */
function _isExplicitClearOperation(newValue) {
  if (!newValue) return true;
  const saveId = newValue.saveId || '';
  return saveId.includes(SAVEID_RECONCILED) || saveId.includes(SAVEID_CLEARED);
}

/**
 * Handle suspicious storage drop (potential corruption)
 * v1.6.3.5-v2 - Extracted for clarity
 * @param {Object} oldValue - Previous storage value
 */
function _handleSuspiciousStorageDrop(oldValue) {
  console.warn('[Manager] ⚠️ SUSPICIOUS: Tab count dropped to 0!');
  console.warn('[Manager] This may indicate storage corruption. Querying content scripts...');
  
  _reconcileWithContentScripts(oldValue).catch(err => {
    console.error('[Manager] Reconciliation error:', err);
    _showErrorNotification('Failed to recover Quick Tab state. Data may be lost.');
  });
}

/**
 * Schedule debounced storage update
 * v1.6.3.5-v2 - Extracted to reduce complexity
 */
function _scheduleStorageUpdate() {
  if (storageReadDebounceTimer) {
    clearTimeout(storageReadDebounceTimer);
  }
  
  storageReadDebounceTimer = setTimeout(() => {
    storageReadDebounceTimer = null;
    loadQuickTabsState().then(() => {
      const newHash = computeStateHash(quickTabsState);
      if (newHash !== lastRenderedStateHash) {
        lastRenderedStateHash = newHash;
        renderUI();
      }
    });
  }, STORAGE_READ_DEBOUNCE_MS);
}

/**
 * Reconcile storage state with content scripts when suspicious changes detected
 * v1.6.3.4-v9 - FIX Issue #18: Query content scripts before clearing UI
 * @param {Object} _previousState - The previous state before the suspicious change (unused but kept for future use)
 */
async function _reconcileWithContentScripts(_previousState) {
  console.log('[Manager] Starting reconciliation with content scripts...');
  
  try {
    const foundQuickTabs = await _queryAllContentScriptsForQuickTabs();
    const uniqueQuickTabs = _deduplicateQuickTabs(foundQuickTabs);
    
    console.log('[Manager] Reconciliation found', uniqueQuickTabs.length, 'unique Quick Tabs in content scripts');
    
    await _processReconciliationResult(uniqueQuickTabs);
  } catch (err) {
    console.error('[Manager] Reconciliation failed:', err);
    _scheduleNormalUpdate();
  }
}

/**
 * Query all content scripts for their Quick Tabs state
 * v1.6.3.4-v9 - Extracted to reduce nesting depth
 * @returns {Promise<Array>} Array of Quick Tabs from all tabs
 */
async function _queryAllContentScriptsForQuickTabs() {
  const tabs = await browser.tabs.query({});
  const foundQuickTabs = [];
  
  for (const tab of tabs) {
    const quickTabs = await _queryContentScriptForQuickTabs(tab.id);
    foundQuickTabs.push(...quickTabs);
  }
  
  return foundQuickTabs;
}

/**
 * Query a single content script for Quick Tabs
 * v1.6.3.4-v9 - Extracted to reduce nesting depth
 * @param {number} tabId - Browser tab ID
 * @returns {Promise<Array>} Quick Tabs from this tab
 */
async function _queryContentScriptForQuickTabs(tabId) {
  try {
    const response = await browser.tabs.sendMessage(tabId, {
      action: 'GET_QUICK_TABS_STATE'
    });
    
    if (response?.quickTabs && Array.isArray(response.quickTabs)) {
      console.log(`[Manager] Received ${response.quickTabs.length} Quick Tabs from tab ${tabId}`);
      return response.quickTabs;
    }
    return [];
  } catch (_err) {
    // Content script may not be loaded - this is expected
    return [];
  }
}

/**
 * Deduplicate Quick Tabs by ID
 * v1.6.3.4-v9 - Extracted to reduce nesting depth
 * @param {Array} quickTabs - Array of Quick Tabs (may contain duplicates)
 * @returns {Array} Deduplicated array
 */
function _deduplicateQuickTabs(quickTabs) {
  const uniqueQuickTabs = [];
  const seenIds = new Set();
  
  for (const qt of quickTabs) {
    if (!seenIds.has(qt.id)) {
      seenIds.add(qt.id);
      uniqueQuickTabs.push(qt);
    }
  }
  
  return uniqueQuickTabs;
}

/**
 * Process reconciliation result - restore or proceed with normal update
 * v1.6.3.4-v9 - Extracted to reduce nesting depth
 * @param {Array} uniqueQuickTabs - Deduplicated Quick Tabs from content scripts
 */
async function _processReconciliationResult(uniqueQuickTabs) {
  if (uniqueQuickTabs.length > 0) {
    // Content scripts have Quick Tabs but storage is empty - this is corruption!
    console.warn('[Manager] CORRUPTION DETECTED: Content scripts have Quick Tabs but storage is empty');
    await _restoreStateFromContentScripts(uniqueQuickTabs);
  } else {
    // No Quick Tabs found in content scripts - the empty state may be valid
    console.log('[Manager] No Quick Tabs found in content scripts - empty state appears valid');
    _scheduleNormalUpdate();
  }
}

/**
 * Restore state from content scripts data
 * v1.6.3.4-v9 - Extracted to reduce nesting depth
 * v1.6.3.5-v2 - FIX Code Review: Use SAVEID_RECONCILED constant
 * 
 * ARCHITECTURE NOTE (v1.6.3.5-v6):
 * This function writes directly to storage as a RECOVERY operation.
 * This is an intentional exception to the "single-writer" architecture because:
 * 1. It only runs when storage corruption is detected
 * 2. Background's cache may be corrupted, so we need to restore from content scripts
 * 3. The SAVEID_RECONCILED prefix allows other components to recognize this write
 * 
 * DO NOT use this pattern for normal operations - use message-based control instead.
 * See v1.6.3.5-architectural-issues.md Architecture Issue #6.
 * 
 * @param {Array} quickTabs - Quick Tabs from content scripts
 */
async function _restoreStateFromContentScripts(quickTabs) {
  console.warn('[Manager] Restoring from content script state...');
  
  const restoredState = {
    tabs: quickTabs,
    timestamp: Date.now(),
    saveId: `${SAVEID_RECONCILED}-${Date.now()}`
  };
  
  await browser.storage.local.set({ [STATE_KEY]: restoredState });
  console.log('[Manager] State restored from content scripts:', quickTabs.length, 'tabs');
  
  // Update local state and re-render
  quickTabsState = restoredState;
  renderUI();
}

/**
 * Schedule normal state update after delay
 * v1.6.3.4-v9 - Extracted to reduce code duplication
 */
function _scheduleNormalUpdate() {
  setTimeout(() => {
    loadQuickTabsState().then(() => {
      const newHash = computeStateHash(quickTabsState);
      if (newHash !== lastRenderedStateHash) {
        lastRenderedStateHash = newHash;
        renderUI();
      }
    });
  }, STORAGE_READ_DEBOUNCE_MS);
}

/**
 * Close all minimized Quick Tabs (NEW FEATURE #1)
 * v1.6.3 - FIX: Changed from storage.sync to storage.local and updated for unified format
 * v1.6.3.4-v6 - FIX Issue #4: Send CLOSE_QUICK_TAB to content scripts BEFORE updating storage
 * 
 * ARCHITECTURE NOTE (v1.6.3.5-v6):
 * This function writes directly to storage, which violates the "single-writer" architecture.
 * This is a known deviation that should be addressed in a future refactor:
 * - Should send CLOSE_MINIMIZED_QUICK_TABS command to background
 * - Background should handle the storage write
 * - Manager should receive confirmation via message
 * 
 * Current behavior is acceptable for now because:
 * 1. Operation is atomic (read-modify-write within same function)
 * 2. Content scripts are notified before storage write
 * 3. No race condition risk since minimized tabs have no DOM
 * 
 * TODO: Migrate to background-coordinated approach (see v1.6.3.5-architectural-issues.md)
 */
/**
 * Close all minimized Quick Tabs
 * v1.6.4.11 - Refactored to reduce cyclomatic complexity
 */
async function closeMinimizedTabs() {
  try {
    const state = await _loadStorageState();
    if (!state) return;
    
    const minimizedTabIds = _collectMinimizedTabIds(state);
    console.log('[Manager] Closing minimized tabs:', minimizedTabIds);
    
    await _broadcastCloseMessages(minimizedTabIds);
    await _updateStorageAfterClose(state);
  } catch (err) {
    console.error('Error closing minimized tabs:', err);
  }
}

/**
 * Load state from storage
 * @private
 */
async function _loadStorageState() {
  const result = await browser.storage.local.get(STATE_KEY);
  return result?.[STATE_KEY] ?? null;
}

/**
 * Collect minimized tab IDs from state
 * @private
 */
function _collectMinimizedTabIds(state) {
  if (!state.tabs || !Array.isArray(state.tabs)) return [];
  return state.tabs
    .filter(tab => isTabMinimizedHelper(tab))
    .map(tab => tab.id);
}

/**
 * Broadcast close messages to all browser tabs
 * @private
 */
async function _broadcastCloseMessages(minimizedTabIds) {
  const browserTabs = await browser.tabs.query({});
  
  for (const quickTabId of minimizedTabIds) {
    _sendCloseMessageToAllTabs(browserTabs, quickTabId);
  }
}

/**
 * Send close message to all browser tabs
 * @private
 */
function _sendCloseMessageToAllTabs(browserTabs, quickTabId) {
  browserTabs.forEach(tab => {
    browser.tabs
      .sendMessage(tab.id, {
        action: 'CLOSE_QUICK_TAB',
        quickTabId
      })
      .catch(() => {
        // Ignore errors for tabs where content script isn't loaded
      });
  });
}

/**
 * Update storage after closing minimized tabs
 * @private
 */
async function _updateStorageAfterClose(state) {
  const hasChanges = filterMinimizedFromState(state);
  
  if (hasChanges) {
    await browser.storage.local.set({ [STATE_KEY]: state });
    await _broadcastLegacyCloseMessage();
    console.log('Closed all minimized Quick Tabs');
  }
}

/**
 * Broadcast legacy close minimized message for backwards compat
 * @private
 */
async function _broadcastLegacyCloseMessage() {
  const browserTabs = await browser.tabs.query({});
  browserTabs.forEach(tab => {
    browser.tabs
      .sendMessage(tab.id, { action: 'CLOSE_MINIMIZED_QUICK_TABS' })
      .catch(() => {
        // Ignore errors
      });
  });
}

/**
 * Close all Quick Tabs - both active and minimized (NEW FEATURE #2)
 * v1.6.3 - FIX: Changed from storage.sync to storage.local
 * v1.6.3.5-v6 - FIX Architecture Issue #1: Use background-coordinated clear
 * v1.6.4.12 - Refactored to reduce cyclomatic complexity
 */
async function closeAllTabs() {
  const startTime = Date.now();
  
  console.log('[Manager] ┌─────────────────────────────────────────────────────────');
  console.log('[Manager] │ Close All button clicked');
  console.log('[Manager] └─────────────────────────────────────────────────────────');
  
  try {
    const preActionState = _capturePreActionState();
    _logPreActionState(preActionState);
    
    const response = await _sendClearAllMessage();
    _logClearAllResponse(response, startTime);
    
    const hostInfoBeforeClear = quickTabHostInfo.size;
    quickTabHostInfo.clear();
    
    _logPostActionCleanup(preActionState.clearedIds, hostInfoBeforeClear, startTime);
    _resetLocalState();
    
    console.log('[Manager] Close All: UI updated, operation complete');
  } catch (err) {
    _logCloseAllError(err, startTime);
  }
}

/**
 * Capture pre-action state for closeAll
 * @private
 */
function _capturePreActionState() {
  const clearedIds = quickTabsState?.tabs?.map(t => t.id) || [];
  const originTabIds = quickTabsState?.tabs?.map(t => t.originTabId).filter(Boolean) || [];
  return { clearedIds, originTabIds };
}

/**
 * Log pre-action state for closeAll
 * @private
 */
function _logPreActionState({ clearedIds, originTabIds }) {
  console.log('[Manager] Close All: Pre-action state:', {
    tabCount: clearedIds.length,
    ids: clearedIds,
    originTabIds: [...new Set(originTabIds)],
    cacheCount: inMemoryTabsCache.length,
    hostInfoCount: quickTabHostInfo.size,
    timestamp: Date.now()
  });
}

/**
 * Send COORDINATED_CLEAR_ALL_QUICK_TABS message to background
 * @private
 * @returns {Promise<Object>} Response from background
 */
function _sendClearAllMessage() {
  console.log('[Manager] Close All: Dispatching COORDINATED_CLEAR_ALL_QUICK_TABS to background...');
  return browser.runtime.sendMessage({
    action: 'COORDINATED_CLEAR_ALL_QUICK_TABS'
  });
}

/**
 * Log clearAll response from background
 * @private
 */
function _logClearAllResponse(response, startTime) {
  console.log('[Manager] Close All: Background response:', {
    success: response?.success,
    response,
    durationMs: Date.now() - startTime
  });
  
  if (response?.success) {
    console.log('[Manager] Close All: Coordinated clear successful');
  } else {
    console.warn('[Manager] Close All: Coordinated clear returned non-success:', response);
  }
}

/**
 * Log post-action cleanup for closeAll
 * @private
 */
function _logPostActionCleanup(clearedIds, hostInfoCleared, startTime) {
  console.log('[Manager] Close All: Post-action cleanup:', {
    clearedIds,
    clearedCount: clearedIds.length,
    hostInfoCleared,
    totalDurationMs: Date.now() - startTime
  });
}

/**
 * Reset local state after closeAll
 * @private
 */
function _resetLocalState() {
  quickTabsState = {};
  inMemoryTabsCache = [];
  lastKnownGoodTabCount = 0;
  lastLocalUpdateTime = Date.now();
  renderUI();
}

/**
 * Log closeAll error
 * @private
 */
function _logCloseAllError(err, startTime) {
  console.error('[Manager] Close All: ERROR:', {
    message: err.message,
    stack: err.stack,
    durationMs: Date.now() - startTime
  });
}

/**
 * Go to the browser tab containing this Quick Tab (NEW FEATURE #3)
 */
async function goToTab(tabId) {
  try {
    await browser.tabs.update(tabId, { active: true });
    console.log(`Switched to tab ${tabId}`);
  } catch (err) {
    console.error(`Error switching to tab ${tabId}:`, err);
    alert('Could not switch to tab - it may have been closed.');
  }
}

/**
 * Minimize an active Quick Tab
 * v1.6.3.4-v11 - FIX Issue #4: Send to ALL tabs, not just active tab
 *   Quick Tab may exist in a different browser tab than the active one.
 *   Cross-tab minimize was failing because message was only sent to active tab.
 * v1.6.3.4-v5 - FIX Issue #4: Prevent spam-clicking by tracking pending operations
 * v1.6.3.5-v7 - FIX Issue #3: Use targeted tab messaging via quickTabHostInfo or originTabId
 */
async function minimizeQuickTab(quickTabId) {
  // v1.6.3.4-v5 - FIX Issue #4: Prevent spam-clicking
  const operationKey = `minimize-${quickTabId}`;
  if (PENDING_OPERATIONS.has(operationKey)) {
    console.log(`[Manager] Ignoring duplicate minimize for ${quickTabId} (operation pending)`);
    return;
  }
  
  // Mark operation as pending
  PENDING_OPERATIONS.add(operationKey);
  
  // Auto-clear pending state after timeout (safety net)
  setTimeout(() => {
    PENDING_OPERATIONS.delete(operationKey);
  }, OPERATION_TIMEOUT_MS);
  
  // v1.6.3.5-v7 - FIX Issue #3: Use targeted tab messaging - using imported findTabInState
  const tabData = findTabInState(quickTabId, quickTabsState);
  const hostInfo = quickTabHostInfo.get(quickTabId);
  const originTabId = tabData?.originTabId;
  const targetTabId = hostInfo?.hostTabId || originTabId;
  
  if (targetTabId) {
    console.log('[Manager] Sending MINIMIZE_QUICK_TAB to specific host tab:', {
      quickTabId,
      targetTabId,
      source: hostInfo ? 'quickTabHostInfo' : 'originTabId'
    });
    
    try {
      await browser.tabs.sendMessage(targetTabId, {
        action: 'MINIMIZE_QUICK_TAB',
        quickTabId
      });
      console.log(`[Manager] Minimized Quick Tab ${quickTabId} via targeted message to tab ${targetTabId}`);
    } catch (err) {
      console.warn(`[Manager] Targeted minimize failed (tab ${targetTabId} may be closed), falling back to broadcast:`, err.message);
      // Fallback to broadcast if targeted message fails - using imported sendMessageToAllTabs
      const result = await sendMessageToAllTabs('MINIMIZE_QUICK_TAB', quickTabId);
      console.log(`[Manager] Minimized Quick Tab ${quickTabId} via broadcast | success: ${result.success}, errors: ${result.errors}`);
    }
  } else {
    // No host info available - fall back to broadcast
    console.log('[Manager] No host tab info found, using broadcast for minimize:', quickTabId);
    const result = await sendMessageToAllTabs('MINIMIZE_QUICK_TAB', quickTabId);
    console.log(`[Manager] Minimized Quick Tab ${quickTabId} via broadcast | success: ${result.success}, errors: ${result.errors}`);
  }
}

/**
 * Show error notification to user
 * v1.6.3.4-v9 - FIX Issue #15: User feedback for invalid operations
 * @param {string} message - Error message to display
 */
function _showErrorNotification(message) {
  // Create notification element
  const notification = document.createElement('div');
  notification.className = 'error-notification';
  notification.textContent = message;
  // v1.6.3.4-v9: Use extracted styles constant for maintainability
  Object.assign(notification.style, ERROR_NOTIFICATION_STYLES);
  document.body.appendChild(notification);
  
  // Remove after 3 seconds
  setTimeout(() => {
    notification.remove();
  }, 3000);
}

/**
 * Send restore message to target tab with confirmation tracking
 * v1.6.3.6-v8 - Extracted to reduce restoreQuickTab complexity
 * v1.6.3.7-v1 - FIX ISSUE #2: Implement per-message confirmation with timeout
 * v1.6.4.12 - Refactored to reduce cyclomatic complexity
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @param {Object} tabData - Tab data with originTabId
 * @returns {Promise<{ success: boolean, confirmedBy?: number, error?: string }>}
 */
function _sendRestoreMessage(quickTabId, tabData) {
  const targetTabId = _resolveRestoreTarget(quickTabId, tabData);
  
  _logRestoreTargetResolution(quickTabId, tabData, targetTabId);
  
  if (!targetTabId) {
    console.log('[Manager] ⚠️ No host tab info found, using broadcast for restore:', quickTabId);
    return _sendRestoreMessageWithConfirmationBroadcast(quickTabId);
  }
  
  return _tryTargetedRestoreWithFallback(quickTabId, targetTabId);
}

/**
 * Resolve the target tab ID for restore operation
 * @private
 */
function _resolveRestoreTarget(quickTabId, tabData) {
  const hostInfo = quickTabHostInfo.get(quickTabId);
  return hostInfo?.hostTabId || tabData.originTabId || null;
}

/**
 * Log restore target resolution details
 * @private
 */
function _logRestoreTargetResolution(quickTabId, tabData, targetTabId) {
  const hostInfo = quickTabHostInfo.get(quickTabId);
  const source = hostInfo ? 'quickTabHostInfo' : tabData.originTabId ? 'originTabId' : 'broadcast';
  
  console.log('[Manager] 🎯 RESTORE_TARGET_RESOLUTION:', {
    quickTabId,
    targetTabId,
    hostInfoTabId: hostInfo?.hostTabId,
    originTabId: tabData.originTabId,
    source
  });
}

/**
 * Try targeted restore, fall back to broadcast on failure
 * @private
 */
async function _tryTargetedRestoreWithFallback(quickTabId, targetTabId) {
  try {
    const response = await _sendRestoreMessageWithTimeout(targetTabId, quickTabId, 500);
    
    _logRestoreConfirmation(quickTabId, targetTabId, response);
    
    if (response?.success) {
      _updateHostInfoAfterRestore(quickTabId, targetTabId);
    }
    
    return { success: response?.success ?? false, confirmedBy: targetTabId };
  } catch (err) {
    console.warn(`[Manager] Targeted restore failed (tab ${targetTabId} may be closed), falling back to broadcast:`, err.message);
    return _sendRestoreMessageWithConfirmationBroadcast(quickTabId);
  }
}

/**
 * Log restore confirmation details
 * @private
 */
function _logRestoreConfirmation(quickTabId, targetTabId, response) {
  console.log('[Manager] ✅ RESTORE_CONFIRMATION:', {
    quickTabId,
    targetTabId,
    success: response?.success,
    action: response?.action,
    completedAt: response?.completedAt || Date.now(),
    responseDetails: response
  });
}

/**
 * Update quickTabHostInfo after successful restore
 * @private
 */
function _updateHostInfoAfterRestore(quickTabId, targetTabId) {
  quickTabHostInfo.set(quickTabId, {
    hostTabId: targetTabId,
    lastUpdate: Date.now(),
    lastOperation: 'restore',
    confirmed: true
  });
}

/**
 * Send restore message with timeout for confirmation
 * v1.6.3.7-v1 - FIX ISSUE #2: Timeout mechanism for message confirmation
 * @private
 * @param {number} tabId - Target browser tab ID
 * @param {string} quickTabId - Quick Tab ID
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<Object>} Response from content script
 */
function _sendRestoreMessageWithTimeout(tabId, quickTabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      console.warn(`[Manager] Restore confirmation timeout (${timeoutMs}ms) for:`, {
        quickTabId,
        targetTabId: tabId
      });
      reject(new Error(`Confirmation timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    
    browser.tabs.sendMessage(tabId, {
      action: 'RESTORE_QUICK_TAB',
      quickTabId,
      // v1.6.3.7-v1 - FIX ISSUE #6: Include metadata for tracking
      _meta: {
        requestId: `restore-${quickTabId}-${Date.now()}`,
        sentAt: Date.now(),
        expectsConfirmation: true
      }
    }).then(response => {
      clearTimeout(timer);
      resolve(response);
    }).catch(err => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Send restore message to all tabs and track first confirmation
 * v1.6.3.7-v1 - FIX ISSUE #2: Broadcast with confirmation tracking
 * v1.6.4.11 - Refactored to reduce nesting depth
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @returns {Promise<{ success: boolean, confirmedBy?: number, broadcastResults: Object }>}
 */
async function _sendRestoreMessageWithConfirmationBroadcast(quickTabId) {
  const tabs = await browser.tabs.query({});
  console.log(`[Manager] Broadcasting RESTORE_QUICK_TAB to ${tabs.length} tabs for:`, quickTabId);
  
  const results = await _broadcastRestoreToTabs(tabs, quickTabId);
  const result = _buildBroadcastResult(results, tabs.length);
  
  console.log(`[Manager] Restored Quick Tab ${quickTabId} via broadcast:`, result);
  return result;
}

/**
 * Broadcast restore message to all tabs
 * v1.6.4.11 - Refactored to reduce nesting depth to 2
 * @private
 */
async function _broadcastRestoreToTabs(tabs, quickTabId) {
  let confirmedBy = null;
  let successCount = 0;
  let errorCount = 0;
  
  for (const tab of tabs) {
    const result = await _sendRestoreToSingleTab(tab, quickTabId);
    const counts = _processRestoreResult(result, tab, quickTabId, confirmedBy);
    
    errorCount += counts.errorDelta;
    successCount += counts.successDelta;
    
    if (counts.newConfirmedBy) {
      confirmedBy = counts.newConfirmedBy;
    }
  }
  
  return { confirmedBy, successCount, errorCount };
}

/**
 * Process a single restore result
 * @private
 */
function _processRestoreResult(result, tab, quickTabId, existingConfirmedBy) {
  if (result.error) {
    return { errorDelta: 1, successDelta: 0, newConfirmedBy: null };
  }
  
  if (!result.success) {
    return { errorDelta: 0, successDelta: 0, newConfirmedBy: null };
  }
  
  // First successful confirmation
  if (!existingConfirmedBy) {
    _handleFirstConfirmation(quickTabId, tab.id, result.response);
    return { errorDelta: 0, successDelta: 1, newConfirmedBy: tab.id };
  }
  
  return { errorDelta: 0, successDelta: 1, newConfirmedBy: null };
}

/**
 * Send restore message to a single tab
 * @private
 */
async function _sendRestoreToSingleTab(tab, quickTabId) {
  try {
    const response = await browser.tabs.sendMessage(tab.id, {
      action: 'RESTORE_QUICK_TAB',
      quickTabId,
      _meta: {
        requestId: `restore-${quickTabId}-${Date.now()}`,
        sentAt: Date.now(),
        expectsConfirmation: true
      }
    });
    
    return { success: response?.success, response, error: false };
  } catch (_err) {
    return { success: false, response: null, error: true };
  }
}

/**
 * Handle first successful restore confirmation
 * @private
 */
function _handleFirstConfirmation(quickTabId, tabId, response) {
  console.log('[Manager] ✅ RESTORE_CONFIRMED_BY_TAB:', {
    quickTabId,
    confirmedBy: tabId,
    response
  });
  
  quickTabHostInfo.set(quickTabId, {
    hostTabId: tabId,
    lastUpdate: Date.now(),
    lastOperation: 'restore',
    confirmed: true
  });
}

/**
 * Build broadcast result object
 * @private
 */
function _buildBroadcastResult(results, totalTabs) {
  return {
    success: results.successCount > 0,
    confirmedBy: results.confirmedBy,
    broadcastResults: {
      success: results.successCount,
      errors: results.errorCount,
      totalTabs
    }
  };
}

/**
 * Restore a minimized Quick Tab
 * v1.6.3.4-v11 - FIX Issue #4: Send to ALL tabs, not just active tab
 * v1.6.3.4-v5 - FIX Issue #4: Prevent spam-clicking by tracking pending operations
 * v1.6.3.4-v9 - FIX Issue #15: Validate tab is actually minimized before restore
 * v1.6.3.5-v2 - FIX Report 2 Issue #8: DOM-verified handshake before UI update
 * v1.6.3.5-v7 - FIX Issue #3: Use targeted tab messaging via quickTabHostInfo or originTabId
 * v1.6.3.6-v8 - FIX Issue #5: Enhanced diagnostic logging + refactored for complexity
 * v1.6.3.7-v1 - FIX ISSUE #2: Track confirmation responses from content scripts
 * v1.6.4.12 - Refactored to reduce cyclomatic complexity
 */
async function restoreQuickTab(quickTabId) {
  const startTime = Date.now();
  
  _logRestoreRequest(quickTabId, startTime);
  
  const operationKey = `restore-${quickTabId}`;
  if (isOperationPending(operationKey)) {
    console.log(`[Manager] Ignoring duplicate restore for ${quickTabId} (operation pending)`);
    return;
  }
  
  const validation = validateRestoreTabData(quickTabId, quickTabsState);
  if (!validation.valid) {
    _showErrorNotification(validation.error);
    return;
  }
  
  console.log('[Manager] Restore validated - tab is minimized:', quickTabId);
  setupPendingOperation(operationKey);
  
  const confirmationResult = await _sendRestoreMessage(quickTabId, validation.tabData);
  _logRestoreResult(quickTabId, confirmationResult, startTime);
  
  _scheduleRestoreVerification(quickTabId);
}

/**
 * Log restore request with context
 * @private
 */
function _logRestoreRequest(quickTabId, timestamp) {
  console.log('[Manager] 🔄 RESTORE_REQUEST:', {
    quickTabId,
    timestamp,
    quickTabsStateTabCount: quickTabsState?.tabs?.length ?? 0,
    currentBrowserTabId
  });
}

/**
 * Log restore result
 * @private
 */
function _logRestoreResult(quickTabId, confirmationResult, startTime) {
  console.log('[Manager] 🔄 RESTORE_RESULT:', {
    quickTabId,
    success: confirmationResult?.success,
    confirmedBy: confirmationResult?.confirmedBy,
    durationMs: Date.now() - startTime
  });
  
  if (!confirmationResult?.success) {
    console.warn('[Manager] ⚠️ Restore not confirmed by any tab:', quickTabId);
  }
}

/**
 * Schedule DOM verification after restore operation
 * @private
 * @param {string} quickTabId - Quick Tab ID to verify
 */
function _scheduleRestoreVerification(quickTabId) {
  setTimeout(() => _verifyRestoreDOM(quickTabId), DOM_VERIFICATION_DELAY_MS);
}

/**
 * Verify DOM was rendered after restore
 * @private
 * @param {string} quickTabId - Quick Tab ID to verify
 */
async function _verifyRestoreDOM(quickTabId) {
  try {
    const tab = await _getQuickTabFromStorage(quickTabId);
    _logRestoreVerificationResult(quickTabId, tab);
  } catch (err) {
    console.error('[Manager] Error verifying restore:', err);
  }
}

/**
 * Get Quick Tab from storage by ID
 * @private
 */
async function _getQuickTabFromStorage(quickTabId) {
  const stateResult = await browser.storage.local.get(STATE_KEY);
  const state = stateResult?.[STATE_KEY];
  return state?.tabs?.find(t => t.id === quickTabId) || null;
}

/**
 * Log restore verification result
 * @private
 */
function _logRestoreVerificationResult(quickTabId, tab) {
  if (tab?.domVerified === false) {
    console.warn('[Manager] Restore WARNING: DOM not verified after restore:', quickTabId);
  } else if (tab && !tab.minimized) {
    console.log('[Manager] Restore confirmed: DOM verified for:', quickTabId);
  }
}

/**
 * Close a Quick Tab
 */
async function closeQuickTab(quickTabId) {
  try {
    // Send message to all tabs to close this Quick Tab
    const tabs = await browser.tabs.query({});
    tabs.forEach(tab => {
      browser.tabs
        .sendMessage(tab.id, {
          action: 'CLOSE_QUICK_TAB',
          quickTabId: quickTabId
        })
        .catch(() => {
          // Ignore errors
        });
    });

    console.log(`Closed Quick Tab ${quickTabId}`);
  } catch (err) {
    console.error(`Error closing Quick Tab ${quickTabId}:`, err);
  }
}

/**
 * Adopt an orphaned Quick Tab to the current browser tab
 * v1.6.3.7-v1 - FIX ISSUE #8: Allow users to "rescue" orphaned Quick Tabs
 *   - Updates originTabId to the current browser tab
 *   - Persists the change to storage
 *   - Re-renders the Manager UI
 * @param {string} quickTabId - The Quick Tab ID to adopt
 * @param {number} targetTabId - The browser tab ID to adopt to
 */
async function adoptQuickTabToCurrentTab(quickTabId, targetTabId) {
  _logAdoptRequest(quickTabId, targetTabId);
  
  // Validate targetTabId
  if (!_isValidTargetTabId(targetTabId)) {
    console.error('[Manager] ❌ Invalid targetTabId for adopt:', targetTabId);
    return;
  }
  
  try {
    const adoptResult = await _performAdoption(quickTabId, targetTabId);
    if (adoptResult) {
      _finalizeAdoption(quickTabId, targetTabId, adoptResult.oldOriginTabId);
    }
  } catch (err) {
    console.error('[Manager] ❌ Error adopting Quick Tab:', err);
  }
}

/**
 * Log adopt request
 * @private
 */
function _logAdoptRequest(quickTabId, targetTabId) {
  console.log('[Manager] 📥 ADOPT_TO_CURRENT_TAB:', {
    quickTabId,
    targetTabId,
    currentBrowserTabId,
    timestamp: Date.now()
  });
}

/**
 * Check if target tab ID is valid
 * @private
 */
function _isValidTargetTabId(targetTabId) {
  return targetTabId && targetTabId > 0;
}

/**
 * Perform the adoption operation
 * Issue #9: Enhanced with storage verification logging
 * v1.6.3.6-v11 - FIX Issue #9: Adoption verification logging
 * @private
 * @returns {Promise<{ oldOriginTabId: number, saveId: string, writeTimestamp: number }|null>} Result or null if failed
 */
async function _performAdoption(quickTabId, targetTabId) {
  const writeStartTime = Date.now();
  const result = await browser.storage.local.get(STATE_KEY);
  const state = result?.[STATE_KEY];
  
  if (!state?.tabs?.length) {
    console.warn('[Manager] No Quick Tabs in storage to adopt');
    return null;
  }
  
  const tabIndex = state.tabs.findIndex(t => t.id === quickTabId);
  if (tabIndex === -1) {
    console.warn('[Manager] Quick Tab not found for adopt:', quickTabId);
    return null;
  }
  
  const quickTab = state.tabs[tabIndex];
  const oldOriginTabId = quickTab.originTabId;
  
  // Update originTabId
  quickTab.originTabId = targetTabId;
  
  // Persist the change
  const saveId = `adopt-${quickTabId}-${Date.now()}`;
  const writeTimestamp = Date.now();
  const stateToWrite = {
    tabs: state.tabs,
    saveId,
    timestamp: writeTimestamp,
    writingTabId: targetTabId,
    writingInstanceId: `manager-adopt-${writeTimestamp}`
  };
  
  // Issue #9: Log exact data being written
  console.log('[Manager] 📝 ADOPT_STORAGE_WRITE:', {
    quickTabId,
    oldOriginTabId,
    newOriginTabId: targetTabId,
    saveId,
    timestamp: writeTimestamp,
    tabCount: state.tabs.length
  });
  
  await browser.storage.local.set({ [STATE_KEY]: stateToWrite });
  
  const writeEndTime = Date.now();
  
  console.log('[Manager] ✅ ADOPT_COMPLETED:', {
    quickTabId,
    oldOriginTabId,
    newOriginTabId: targetTabId,
    saveId,
    writeDurationMs: writeEndTime - writeStartTime
  });
  
  // Issue #9: Set up temporary listener for storage.onChanged to verify write confirmation
  _verifyAdoptionInStorage(quickTabId, saveId, writeTimestamp);
  
  return { oldOriginTabId, saveId, writeTimestamp };
}

/**
 * Issue #9: Verify adoption was persisted by monitoring storage.onChanged
 * Logs time delta between write and confirmation, warns if no confirmation within 2 seconds
 * @private
 * @param {string} quickTabId - Quick Tab ID that was adopted
 * @param {string} expectedSaveId - SaveId to look for in storage change
 * @param {number} writeTimestamp - Timestamp when write occurred
 */
function _verifyAdoptionInStorage(quickTabId, expectedSaveId, writeTimestamp) {
  let confirmed = false;
  const CONFIRMATION_TIMEOUT_MS = 2000;
  
  // Issue #9: Temporary listener for this specific saveId
  const verificationListener = (changes, areaName) => {
    if (areaName !== 'local' || !changes[STATE_KEY]) return;
    
    const newValue = changes[STATE_KEY].newValue;
    if (newValue?.saveId === expectedSaveId) {
      confirmed = true;
      const confirmationTime = Date.now();
      const timeDelta = confirmationTime - writeTimestamp;
      
      console.log('[Manager] ✅ ADOPT_VERIFICATION_CONFIRMED:', {
        quickTabId,
        saveId: expectedSaveId,
        writeTimestamp,
        confirmationTimestamp: confirmationTime,
        timeDeltaMs: timeDelta
      });
      
      // Clean up listener
      browser.storage.onChanged.removeListener(verificationListener);
    }
  };
  
  browser.storage.onChanged.addListener(verificationListener);
  
  // Issue #9: Warning if no confirmation within timeout
  setTimeout(() => {
    if (!confirmed) {
      console.warn('[Manager] ⚠️ ADOPT_VERIFICATION_TIMEOUT:', {
        quickTabId,
        saveId: expectedSaveId,
        writeTimestamp,
        timeoutMs: CONFIRMATION_TIMEOUT_MS,
        message: 'No storage.onChanged confirmation received within timeout'
      });
      
      // Clean up listener
      browser.storage.onChanged.removeListener(verificationListener);
    }
  }, CONFIRMATION_TIMEOUT_MS);
}

/**
 * Finalize adoption by updating local state and UI
 * @private
 */
function _finalizeAdoption(quickTabId, targetTabId, oldOriginTabId) {
  // Update local quickTabHostInfo
  quickTabHostInfo.set(quickTabId, {
    hostTabId: targetTabId,
    lastUpdate: Date.now(),
    lastOperation: 'adopt',
    confirmed: true
  });
  
  // Invalidate cache for old tab
  browserTabInfoCache.delete(oldOriginTabId);
  
  // Re-render UI to reflect the change
  renderUI();
}
