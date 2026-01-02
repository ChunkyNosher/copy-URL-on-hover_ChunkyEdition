/**
 * Quick Tabs Manager Sidebar Script
 * Manages display and interaction with Quick Tabs across all containers
 *
 * === v1.6.4-v4 CONTAINER ISOLATION & FILTERING ===
 * v1.6.4-v4 - FEATURE: Container-based filtering for Quick Tabs
 *   - Quick Tabs filtered by Firefox Container (cookieStoreId/originContainerId)
 *   - Default view: Only Quick Tabs from current container are shown
 *   - Container dropdown in Manager header for filter selection
 *   - Options: "Current Container" (default), "All Containers", or specific container
 *   - Container names resolved from browser.contextualIdentities API
 *   - Dynamic update when user switches to a different container tab
 *   - State variables: _currentContainerId, _selectedContainerFilter
 *   - Key functions: _filterQuickTabsByContainer(), initializeContainerIsolation()
 *   - Preference persisted to storage (quickTabsContainerFilter)
 *
 * === v1.6.4-v3 TRANSFER/DUPLICATE STATE SYNC FIX ===
 * v1.6.4-v3 - FIX BUG #15d: Added _pendingCriticalStateRefresh flag to force immediate render
 *            after transfer/duplicate operations to ensure Manager displays correct state
 *   - ROOT CAUSE: GET_ALL_QUICK_TABS_RESPONSE used debounced rendering, which could skip
 *     or delay render after transfer/duplicate operations due to hash check
 *   - FIX: Added _pendingCriticalStateRefresh flag set before requestAllQuickTabsViaPort()
 *     in _handleSuccessfulTransferAck() and DUPLICATE_QUICK_TAB_ACK handlers
 *   - When flag is set, _handleQuickTabsStateUpdate() bypasses scheduleRender() and calls
 *     _forceImmediateRender('critical-state-refresh') instead
 *
 * v1.6.4-v3 - FIX BUG #1/#2: Transfer/duplicate Quick Tabs not appearing in Manager
 *   - ROOT CAUSE: setTimeout(0) wrapper around requestAllQuickTabsViaPort() caused
 *     inconsistent state sync. The event loop deferral meant the request could be
 *     processed after unrelated state changes, causing stale data.
 *   - FIX: Removed setTimeout(0) wrapper, call requestAllQuickTabsViaPort() directly
 *     - Modified _handleSuccessfulTransferAck() - direct call after optimistic update
 *     - Modified DUPLICATE_QUICK_TAB_ACK handler - direct call after optimistic update
 *   - BEHAVIOR: Immediate state request after ACK ensures Manager gets updated state
 *   - NOTE: STATE_CHANGED safety timeout removed as direct call is more reliable
 *
 * v1.6.4-v3 - FIX BUG #4: Excessive logging during drag operations (60+ logs/sec)
 *   - ROOT CAUSE: [DEBOUNCE][DRAG_EVENT_QUEUED] and [DEBOUNCE][MAIN_EVENT_QUEUED]
 *     logs were firing on every mouse move during drag operations
 *   - FIX: Removed console.log calls in UpdateHandler.js, kept counter logic
 *   - Files: src/features/quick-tabs/handlers/UpdateHandler.js lines 152, 494
 *
 * === v1.6.4-v2 MOVE TO CURRENT TAB STATE SYNC FIX ===
 * v1.6.4-v2 - FIX BUG #2: "Move to Current Tab" Quick Tab not appearing in Manager
 *   - ROOT CAUSE: State version race condition during render
 *     When ACK triggers _forceImmediateRender(), STATE_CHANGED may arrive during render.
 *     The render completion was setting _lastRenderedStateVersion = _stateVersion,
 *     but _stateVersion had already been incremented by STATE_CHANGED. This caused
 *     the STATE_CHANGED re-render to be skipped as version appeared already rendered.
 *   - FIX: Capture state version at render START, not END
 *     - Added stateVersionAtRenderStart in _executeRenderUIInternal()
 *     - _lastRenderedStateVersion now uses captured version, not current version
 *     - STATE_CHANGED render now proceeds since its version > captured version
 *   - Added STATE_VERSION_DRIFT_DURING_RENDER logging for debugging
 *
 * === v1.6.4 TRANSFER/DUPLICATE STATE SYNC & QUICK TAB ORDERING ===
 * v1.6.4 - FIX BUG #1/#2: Transferred/duplicated Quick Tabs not appearing in Manager
 *   - ROOT CAUSE: Race condition between ACK and STATE_CHANGED messages
 *   - FIX: Removed redundant requestAllQuickTabsViaPort() calls from ACK handlers
 *   - STATE_CHANGED message already contains complete updated state
 *   - Enhanced logging to trace message ordering for debugging
 *
 * v1.6.4 - FIX BUG #3: Quick Tab reordering within groups resets
 *   - ROOT CAUSE: No persistence mechanism for Quick Tab order within groups
 *   - FIX: Added _userQuickTabOrderByGroup storage similar to tab group order
 *   - Added _saveUserQuickTabOrder(), _persistQuickTabOrderToStorage()
 *   - Added _loadQuickTabOrderFromStorage(), _applyUserQuickTabOrder()
 *   - Modified _handleQuickTabDrop() and _handleTabGroupDrop() to save order
 *   - Modified _createGroupContent() to apply user's Quick Tab order
 *
 * v1.6.4 - FIX BUG #4: Last Quick Tab close not reflected in Manager
 *   - Enhanced logging for empty state transitions
 *   - Added low-count monitoring for debugging last-close scenarios
 *
 * === v1.6.3.12-v12 BUTTON OPERATION FIX & STATE VERSION TRACKING ===
 * v1.6.3.12-v12 - FIX Issue #48: Manager buttons not working (Close, Minimize, Restore, Close All, Close Minimized)
 *   - ROOT CAUSE: Optimistic UI disabled buttons but STATE_CHANGED didn't always trigger re-render
 *   - FIX #1: Added safety timeout in _applyOptimisticUIUpdate() to revert UI if no response
 *     - After OPERATION_TIMEOUT_MS, reverts button disabled state and requests fresh state
 *   - FIX #2: Added _lastRenderedStateVersion tracking in scheduleRender()
 *     - Re-render now triggers on state version change even if content hash is same
 *     - Ensures UI rebuilds after minimize/restore which may not change tab count
 *   - FIX #3: _handleQuickTabsStateUpdate() now increments state version
 *     - Forces re-render after every STATE_CHANGED message from background
 *     - DOM rebuild clears disabled button states
 *
 * === v1.6.3.12-v11 CROSS-TAB DISPLAY & BUTTON FIXES ===
 * v1.6.3.12-v11 - FIX Issues from quick-tab-manager-sync-issues.md:
 *   - Issue #1: Manager now displays Quick Tabs from ALL browser tabs
 *     - Added _getAllQuickTabsForRender() that prioritizes port data over storage
 *     - Port data (_allQuickTabsFromPort) contains ALL Quick Tabs from ALL tabs
 *     - Fallback to storage only when port data is empty
 *   - Issue #2/#3: Close Minimized/Close All buttons already have event listeners
 *     - Verified _setupHeaderButtons() attaches listeners to both buttons
 *     - Button clicks call closeMinimizedQuickTabsViaPort()/closeAllQuickTabsViaPort()
 *   - Issue #12: Browser tab cache invalidation on ORIGIN_TAB_CLOSED
 *     - Cache already invalidated in _handleOriginTabClosed() (v1.6.4 fix)
 *   - Issue #19: Render lock now uses try-finally for deadlock protection
 *     - _renderUIImmediate() already has try-finally (v1.6.4 fix)
 *
 * === v1.6.4 PORT VALIDATION & RENDER ROBUSTNESS ===
 * v1.6.4 - FIX Issues from continuation-analysis.md:
 *   - Issue #15: Port message input validation - validates Quick Tab objects
 *     - Added _validateQuickTabObject() to check required fields (id, originTabId, url)
 *     - Added _filterValidQuickTabs() to filter invalid objects with logging
 *     - Added _isValidSequenceNumber() for sequence number validation
 *     - _createStateUpdateHandler() now filters invalid Quick Tab objects
 *   - Issue #19: Render debounce race conditions
 *     - Added _isRenderInProgress and _pendingRerenderRequested flags
 *     - renderUI() now uses render lock to prevent concurrent execution
 *     - Pending re-renders are scheduled after current render completes
 *   - Issue #20: Circuit breaker auto-reset state corruption
 *     - initializeQuickTabsPort() now clears auto-reset timer on success
 *     - _executeCircuitBreakerAutoReset() already checks if still tripped
 *     - Enhanced logging in _clearCircuitBreakerAutoResetTimer()
 *
 * === v1.6.3.12-v9 COMPREHENSIVE LOGGING & OPTIMISTIC UI ===
 * v1.6.3.12-v9 - FIX Issues from log-analysis-bugs-v1.6.3.12.md:
 *   - Issue #1: Manager buttons now have comprehensive click logging
 *   - Issue #2: Close All button has detailed logging via closeAllQuickTabsViaPort()
 *   - Issue #3: Close Minimized button has detailed logging via closeMinimizedQuickTabsViaPort()
 *   - Issue #4: Manager updates logged via enhanced scheduleRender() and STATE_CHANGED handling
 *   - Issue #8: Button DOM creation logged in _createTabActions()
 *   - Issue #10: Minimize/restore operations logged in *ViaPort() functions
 *   - Button Architecture: Implemented optimistic UI updates for instant feedback
 *
 * === v1.6.3.12-v5 PORT MESSAGING ARCHITECTURE ===
 * PRIMARY SYNC: Port messaging ('quick-tabs-port') - Option 4 Architecture
 *   - Background script memory is SINGLE SOURCE OF TRUTH (quickTabsSessionState)
 *   - All Quick Tab operations use port messaging, NOT storage APIs
 *   - storage.onChanged listener is FALLBACK only for edge cases
 *   - Quick Tabs are session-only (cleared on browser restart via explicit cleanup)
 *
 * IMPORTANT: browser.storage.session does NOT exist in Firefox Manifest V2
 *   - All storage operations use browser.storage.local exclusively
 *   - Session-only behavior achieved via explicit startup cleanup in background.js
 *   - Collapse state uses storage.local (UI preference)
 *   - v1.6.3.12-v5: All storage.session references removed
 *
 * v1.6.3.12-v7 - FIX Bug #2: Manager buttons use port messaging
 *   - Button handlers (minimize, restore, close) now use *ViaPort() functions
 *   - This fixes Manager buttons not working because old functions sent
 *     messages to content scripts via tabs.sendMessage (Manager is not a content script)
 *
 * v1.6.3.12-v4 - FIX Diagnostic Gaps #1-8:
 *   - Gap #4: browser.runtime.lastError captured IMMEDIATELY in disconnect handler
 *   - Gap #5: CorrelationId propagation through entire handler → render chain
 *   - Gap #6: FIFO ordering assumption documented in _portMessageHandlers
 *   - Gap #7: Cache staleness detection with periodic check (10s interval)
 *          - Warns if cache stale >30 seconds (CACHE_STALENESS_ALERT_MS)
 *          - Auto-syncs if cache stale >60 seconds (CACHE_STALENESS_AUTO_SYNC_MS)
 *
 * v1.6.3.10-v5 - FIX Bug #3: Animation Playing for All Quick Tabs During Single Adoption
 *   - Implemented surgical DOM update for adoption events
 *   - Only adopted Quick Tab animates, other Quick Tabs untouched
 *   - Added _performSurgicalAdoptionUpdate() for targeted DOM manipulation
 *   - Added _moveQuickTabBetweenGroups() for cross-group moves without re-render
 *   - CSS animation classes now only applied to specific elements
 *   - Removed automatic itemFadeIn animation on all Quick Tab items
 *
 * v1.6.3.10-v3 - Phase 2: Tabs API Integration
 *   - FIX Issue #47: ADOPTION_COMPLETED port message for immediate re-render
 *   - Background broadcasts ADOPTION_COMPLETED after storage write
 *   - Manager handles port message and triggers immediate scheduleRender()
 *   - NEW: ORIGIN_TAB_CLOSED handler for orphan detection
 *
 * v1.6.3.10-v2 - FIX Manager UI Issues (Issues #1, #4, #8)
 *   - FIX Issue #1: Reduced render debounce 300ms→100ms, sliding-window debounce
 *   - FIX Issue #4: Smart circuit breaker with sliding-window backoff, action queue
 *   - FIX Issue #8: Cache staleness tracking, cache only for initial hydration
 *
 * v1.6.3.10-v1 - FIX Critical Cross-Tab Sync Issues (Issues #2, #3, #5, #6, #7)
 *   - FIX Issue #2: Port lifecycle & zombie port detection with 500ms timeout
 *   - FIX Issue #3: Storage concurrency with write serialization (transactionId + sequence)
 *   - FIX Issue #5: Reduced heartbeat interval 25s→15s, timeout 5s→2s, adaptive backoff
 *   - FIX Issue #6: Structured port/message lifecycle logging with state transitions
 *   - FIX Issue #7: Minimize/restore retry logic (2x retry + broadcast fallback)
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
 * v1.6.3.12-v7 - REFACTOR: Major refactoring for code health improvement
 *   - Code Health: 5.34 → 9.09 (+70% improvement)
 *   - Extracted utilities to sidebar/utils/ modules
 *   - Reduced cyclomatic complexity: max CC 17 → no functions over CC 9
 *   - Converted to ES modules for clean imports
 *   - All complex methods refactored with helper functions
 *
 * Previous versions:
 * v1.6.3.12-v7 - FIX Issues #1-12: Comprehensive UI/UX improvements
 * v1.6.3.6 - FIX Issue #3: Added comprehensive logging
 * v1.6.3.5-v11 - FIX Issue #6: Manager list updates when last Quick Tab closed
 */

// ==================== IMPORTS ====================
// v1.6.4 - Code Health: Import extracted manager modules first
import {
  initialize as initializeDragDrop,
  attachDragDropEventListeners,
  getDragState as _getDragState,
  resetDragState as _resetDragState,
  getCachedModifierKey as _getCachedModifierKey
} from './managers/DragDropManager.js';
import {
  GROUP_ORDER_STORAGE_KEY as _GROUP_ORDER_STORAGE_KEY,
  QUICK_TAB_ORDER_STORAGE_KEY as _QUICK_TAB_ORDER_STORAGE_KEY,
  saveUserGroupOrder,
  loadGroupOrderFromStorage,
  applyUserGroupOrder as _applyUserGroupOrder,
  saveUserQuickTabOrder,
  loadQuickTabOrderFromStorage,
  applyUserQuickTabOrder as _applyUserQuickTabOrder,
  getUserGroupOrder as _getUserGroupOrder
} from './managers/OrderManager.js';
// v1.6.4 - Import PortManager for port-related functionality (extracted for code health)
import {
  isValidMessageObject as _isValidMessageObjectFromPM,
  isValidQuickTabsField as _isValidQuickTabsFieldFromPM,
  isValidSequenceNumber as _isValidSequenceNumberFromPM,
  validateStateUpdateMessage as _validateStateUpdateMessageFromPM,
  validateAckMessage as _validateAckMessageFromPM,
  logValidationError as _logPortMessageValidationErrorFromPM,
  checkMessageSequence as _checkMessageSequenceFromPM,
  buildAckLogData as _buildAckLogDataFromPM,
  SEQUENCE_GAP_WARNING_ENABLED as _SEQUENCE_GAP_WARNING_ENABLED_FROM_PM
} from './managers/PortManager.js';
// v1.6.4 - Import RenderManager for render-related functionality (extracted for code health)
import {
  incrementStateVersion as _incrementStateVersionFromRM,
  forceImmediateRender as _forceImmediateRenderFromRM,
  logRenderStart as _logRenderStartFromRM,
  logRenderComplete as _logRenderCompleteFromRM,
  logGroupRendering as _logGroupRenderingFromRM,
  logRenderPerformance as _logRenderPerformanceFromRM,
  showEmptyState as _showEmptyStateFromRM,
  showContentState as _showContentStateFromRM,
  RENDER_DEBOUNCE_MS as _RENDER_DEBOUNCE_MS_FROM_RM,
  RENDER_DEBOUNCE_MAX_WAIT_MS as _RENDER_DEBOUNCE_MAX_WAIT_MS_FROM_RM,
  MAX_CONSECUTIVE_RERENDERS as _MAX_CONSECUTIVE_RERENDERS_FROM_RM
} from './managers/RenderManager.js';
// v1.6.4 - Import StorageChangeAnalyzer for storage change handling (extracted for code health)
import {
  SAVEID_RECONCILED as _SAVEID_RECONCILED_FROM_SCA,
  SAVEID_CLEARED as _SAVEID_CLEARED_FROM_SCA,
  buildAnalysisResult as _buildAnalysisResultFromSCA,
  buildTabCountChangeResult as _buildTabCountChangeResultFromSCA,
  buildMetadataOnlyResult as _buildMetadataOnlyResultFromSCA,
  buildDataChangeResult as _buildDataChangeResultFromSCA,
  buildNoChangesResult as _buildNoChangesResultFromSCA,
  getTabsFromValue as _getTabsFromValueFromSCA,
  checkSingleTabDataChanges as _checkSingleTabDataChangesFromSCA,
  checkTabChanges as _checkTabChangesFromSCA,
  buildResultFromChangeAnalysis as _buildResultFromChangeAnalysisFromSCA,
  analyzeStorageChange as _analyzeStorageChangeFromSCA,
  hasPositionDiff as _hasPositionDiffFromSCA,
  hasSizeDiff as _hasSizeDiffFromSCA,
  identifyChangedTabs as _identifyChangedTabsFromSCA,
  isSingleTabDeletion as _isSingleTabDeletionFromSCA,
  isExplicitClearOperation as _isExplicitClearOperationFromSCA,
  isSuspiciousStorageDrop as _isSuspiciousStorageDropFromSCA,
  buildStorageChangeContext as _buildStorageChangeContextFromSCA,
  logStorageChangeEvent as _logStorageChangeEventFromSCA,
  logTabIdChanges as _logTabIdChangesFromSCA,
  logPositionSizeChanges as _logPositionSizeChangesFromSCA
} from './managers/StorageChangeAnalyzer.js';
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
  STATE_CLOSED,
  ANIMATION_DURATION_MS
} from './utils/render-helpers.js';
import {
  STORAGE_READ_DEBOUNCE_MS,
  queryAllContentScriptsForQuickTabs,
  restoreStateFromContentScripts
} from './utils/storage-handlers.js';
import {
  isOperationPending,
  setupPendingOperation,
  sendMessageToAllTabs,
  isTabMinimizedHelper,
  filterMinimizedFromState,
  validateRestoreTabData,
  findTabInState,
  determineRestoreSource,
  STATE_KEY
} from './utils/tab-operations.js';
import { filterInvalidTabs, validateQuickTabObject } from './utils/validation.js';

// ==================== CONSTANTS ====================
const COLLAPSE_STATE_KEY = 'quickTabsManagerCollapseState';
// v1.6.4 - FIX Issue #48/#7: Manager UI state persistence key
// Stores scroll position and other UI state that should persist across browser restarts
const MANAGER_STATE_KEY = 'manager_state_v2';
// v1.6.4 - FIX Issue #48/#7: Debounce delay for scroll position save (prevents excessive writes)
const SCROLL_POSITION_SAVE_DEBOUNCE_MS = 200;
const BROWSER_TAB_CACHE_TTL_MS = 30000;
// v1.6.4 - Note: SAVEID_RECONCILED and SAVEID_CLEARED now imported from StorageChangeAnalyzer.js
const SAVEID_RECONCILED = _SAVEID_RECONCILED_FROM_SCA;
const SAVEID_CLEARED = _SAVEID_CLEARED_FROM_SCA;
const OPERATION_TIMEOUT_MS = 2000;
const DOM_VERIFICATION_DELAY_MS = 500;
// v1.6.4 - Note: GROUP_ORDER_STORAGE_KEY and QUICK_TAB_ORDER_STORAGE_KEY now imported from OrderManager.js

// ==================== v1.6.3.7 CONSTANTS ====================
// FIX Issue #3: UI Flicker Prevention - Debounce renderUI()
// v1.6.3.10-v2 - FIX Issue #1: Reduced from 300ms to 100ms to match storage mutation frequency
const RENDER_DEBOUNCE_MS = 100;
// FIX Issue #5: Port Reconnect Circuit Breaker
const RECONNECT_BACKOFF_INITIAL_MS = 100;
// v1.6.3.10-v2 - FIX Issue #4: Reduced max backoff from 10000ms to 2000ms
const RECONNECT_BACKOFF_MAX_MS = 2000;
const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5;
// v1.6.3.10-v2 - FIX Issue #4: Reduced from 10000ms to 3000ms
const CIRCUIT_BREAKER_OPEN_DURATION_MS = 3000;
// v1.6.3.10-v2 - FIX Issue #4: Sliding window for failure tracking (failures older than this don't count)
const CIRCUIT_BREAKER_SLIDING_WINDOW_MS = 5000;

// ==================== v1.6.3.10-v1 CONSTANTS ====================
// FIX Issue #2: Zombie port detection timeout (500ms)
const PORT_MESSAGE_TIMEOUT_MS = 500;
// FIX Issue #7: Messaging retry configuration
const MESSAGE_RETRY_COUNT = 2;
const MESSAGE_RETRY_BACKOFF_MS = 150;

// ==================== v1.6.3.10-v2 CONSTANTS ====================
// FIX Issue #8: Cache staleness tracking
const CACHE_STALENESS_ALERT_MS = 30000; // Alert if cache diverges for >30 seconds
// v1.6.3.12-v4 - Gap #7: Auto-sync threshold when cache severely stale
const CACHE_STALENESS_AUTO_SYNC_MS = 60000; // Request state sync if stale for >60 seconds
// v1.6.3.12-v4 - Gap #7: Cache staleness check interval
const CACHE_STALENESS_CHECK_INTERVAL_MS = 10000; // Check every 10 seconds
// FIX Issue #1: Sliding-window debounce maximum wait time
const RENDER_DEBOUNCE_MAX_WAIT_MS = 300; // Maximum wait time even with extensions

// ==================== v1.6.3.10-v7 CONSTANTS ====================
// FIX Bug #1: quickTabHostInfo memory leak prevention
const HOST_INFO_MAX_ENTRIES = 500; // Maximum entries before pruning old ones
const HOST_INFO_MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
// FIX Bug #3: Adaptive port timeout
const PORT_VIABILITY_MIN_TIMEOUT_MS = 700; // Minimum timeout (increased from 500ms)
const PORT_VIABILITY_MAX_TIMEOUT_MS = 3000; // Maximum adaptive timeout
const LATENCY_SAMPLES_MAX = 50; // Maximum latency samples to track for 95th percentile

// ==================== v1.6.4 FIX Issue #17 CONSTANTS ====================
// Browser tab info cache audit interval
const BROWSER_TAB_CACHE_AUDIT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ==================== v1.6.4-v3 FIX BUG #1/#2/#3 CONSTANTS ====================
// Safety timeout for STATE_CHANGED after transfer/duplicate operations
// If STATE_CHANGED doesn't arrive within this time, request fresh state
const STATE_CHANGED_SAFETY_TIMEOUT_MS = 500;

// ==================== v1.6.3.12-v7 FIX Issue #30 CONSTANTS ====================
// Port reconnection circuit breaker for Quick Tabs port
const QUICK_TABS_PORT_MAX_RECONNECT_ATTEMPTS = 10; // Max attempts before giving up
const QUICK_TABS_PORT_RECONNECT_BACKOFF_INITIAL_MS = 1000; // Start at 1 second
const QUICK_TABS_PORT_RECONNECT_BACKOFF_MAX_MS = 30000; // Max 30 seconds between attempts
// v1.6.4 - FIX Issue #5: Auto-reset circuit breaker after timeout period
const QUICK_TABS_PORT_CIRCUIT_BREAKER_AUTO_RESET_MS = 60000; // 60 seconds before auto-reset

// ==================== v1.6.3.12-v7 FIX Issue #13 CONSTANTS ====================
// Port messaging FIFO ordering - sequence number tracking
const SEQUENCE_GAP_WARNING_ENABLED = true; // Enable/disable out-of-order detection logging

// ==================== v1.6.4-v2 FEATURE: LIVE METRICS CONSTANTS ====================
// Settings keys for live metrics feature
const METRICS_ENABLED_KEY = 'quickTabsMetricsEnabled';
const METRICS_INTERVAL_KEY = 'quickTabsMetricsIntervalMs';
// Default values for metrics settings
const METRICS_DEFAULT_ENABLED = true;
const METRICS_DEFAULT_INTERVAL_MS = 1000; // 1 second
const METRICS_MIN_INTERVAL_MS = 500; // Minimum 500ms
const METRICS_MAX_INTERVAL_MS = 30000; // Maximum 30 seconds
// v1.6.4-v3 - Removed ESTIMATED_MEMORY_PER_QUICK_TAB_BYTES (no longer using memory tracking)

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

// v1.6.4 - FIX Issue #48/#7: Scroll position save debounce timer
// Debounces scroll position persistence to avoid excessive storage writes
let _scrollPositionSaveTimer = null;

// v1.6.3.5-v2 - FIX Report 1 Issue #2: Track current tab ID for Quick Tab origin filtering
let currentBrowserTabId = null;

// v1.6.3.7-v1 - FIX ISSUE #1: Track tab switches for real-time filtering
let previousBrowserTabId = null;

// v1.6.4-v4 - FEATURE: Container isolation and filtering
// Track current container ID for filtering Quick Tabs by container
let _currentContainerId = 'firefox-default';
// v1.6.4-v4 - FIX BUG #1: Default to 'all' so Quick Tabs are visible by default.
// Selected container filter: 'all' (default, show all), 'current' (filter by current container), or a specific cookieStoreId.
let _selectedContainerFilter = 'all';
// Container dropdown DOM element reference
let _containerFilterDropdown = null;

// v1.6.3.4-v6 - FIX Issue #5: Track last rendered state hash to avoid unnecessary re-renders
let lastRenderedStateHash = 0;

// v1.6.4 - FIX Issue #21: State version tracking for render transaction boundaries
// Tracks the state version when a render is scheduled vs when it executes
let _stateVersion = 0; // Incremented on every state change
let _stateVersionAtSchedule = 0; // Version when render was scheduled
// v1.6.3.12-v12 - FIX Issue #48: Track state version at last render completion
// This allows scheduleRender to detect if state changed since last render
let _lastRenderedStateVersion = 0;

// v1.6.3.5-v4 - FIX Diagnostic Issue #2: In-memory state cache to prevent list clearing during storage storms
// v1.6.3.5-v6 - ARCHITECTURE NOTE (Issue #6 - Manager as Pure Consumer):
//   This cache exists as a FALLBACK to protect against storage storms/corruption.
//   It is NOT a competing authority with background's state.
//   Normal operation: Manager receives state from storage.onChanged/messages
//   Recovery operation: Manager uses cache when storage returns suspicious 0-tab results
//   The cache should NEVER be used to overwrite background's authoritative state.
//   See v1.6.3.5-architectural-issues.md Architecture Issue #6 for context.
// v1.6.3.10-v2 - FIX Issue #8: Cache is now ONLY used for initial hydration, not ongoing fallback
//   Cache staleness is tracked - alerts if >30 seconds without storage sync
let inMemoryTabsCache = [];
let lastKnownGoodTabCount = 0;
const MIN_TABS_FOR_CACHE_PROTECTION = 1; // Protect cache if we have at least 1 tab

// v1.6.3.10-v2 - FIX Issue #8: Cache staleness tracking
let lastCacheSyncFromStorage = 0; // Timestamp when cache was last synchronized with storage
let cacheHydrationComplete = false; // Flag to track if initial hydration is done

// UI Elements (cached for performance)
let containersList;
let emptyState;
let totalTabsEl;
let lastSyncEl;

// State
let containersData = {}; // Maps cookieStoreId -> container info
let quickTabsState = {}; // Maps cookieStoreId -> { tabs: [], timestamp }

// v1.6.3.5-v3 - FIX Architecture Phase 3: Track which tab hosts each Quick Tab
// Key: quickTabId, Value: { hostTabId, lastUpdate, containerId }
// v1.6.3.10-v7 - FIX Bug #1: Added maintenance interval and max size guard
const quickTabHostInfo = new Map();
let hostInfoMaintenanceIntervalId = null;

// v1.6.4 - FIX Issue #17: Browser tab info cache audit interval ID
let browserTabCacheAuditIntervalId = null;

// v1.6.3.10-v7 - FIX Bug #3: Adaptive port timeout tracking
// Track recent heartbeat latencies for 95th percentile calculation
const recentLatencySamples = [];
let adaptivePortTimeout = PORT_VIABILITY_MIN_TIMEOUT_MS;

// v1.6.3.10-v7 - FIX Bug #3: Message deduplication to prevent re-sends on reconnect
// Key: messageHash (action + quickTabId), Value: timestamp
const sentMessageDedup = new Map();
const MESSAGE_DEDUP_TTL_MS = 2000; // Dedup window: don't resend same message within 2s

// v1.6.3.5-v7 - FIX Issue #7: Track when Manager's internal state was last updated (from any source)
let lastLocalUpdateTime = 0;

// v1.6.3.11-v12 - FIX Issue #6: Track last event received for staleness detection
let lastEventReceivedTime = 0;
const STALENESS_THRESHOLD_MS = 30000; // 30 seconds - warn if no events received

// Browser tab info cache
const browserTabInfoCache = new Map();

// ==================== v1.6.4-v2 FEATURE: LIVE METRICS STATE ====================
// Interval ID for metrics update timer
let _metricsIntervalId = null;
// Current metrics settings
let _metricsEnabled = METRICS_DEFAULT_ENABLED;
let _metricsIntervalMs = METRICS_DEFAULT_INTERVAL_MS;
// v1.6.4-v3 REMOVED: DOM element references removed - metrics footer now only in settings.html
// The postMessage to parent window is still active for the expandable footer

// v1.6.4-v3 - Log action tracking state
let _totalLogActions = 0;
// Log actions in the current sliding window (for calculating actions per second)
let _logActionsWindow = [];
// Window size in milliseconds for calculating logs per second
const LOG_ACTIONS_WINDOW_MS = 5000; // 5 second sliding window
// v1.6.4-v3 - Task 2: Track log actions per category for breakdown display
let _logActionsByCategory = {};
// v1.6.4-v3 - Task 3: Cache of live console filter settings (loaded from storage)
let _liveFilterSettingsCache = null;

/**
 * v1.6.4 - FIX Issue #21: Increment state version when external state arrives
 * Call this when state is updated from external sources (port messages, storage.onChanged)
 * This allows scheduleRender to detect if state changed between scheduling and rendering.
 * @private
 * @param {string} source - Source of state update for logging
 */
function _incrementStateVersion(source) {
  _stateVersion++;
  console.log('[Manager] v1.6.4 STATE_VERSION_INCREMENT:', {
    newVersion: _stateVersion,
    source,
    timestamp: Date.now()
  });
}

// ==================== v1.6.4-v2 FEATURE: LIVE METRICS FUNCTIONS ====================

// v1.6.4-v3 REMOVED: _initMetricsDOMReferences() function deleted
// Metrics footer DOM elements no longer exist in quick-tabs-manager.html
// Metrics are sent to parent window via postMessage for display in settings.html

/**
 * Load metrics settings from storage
 * v1.6.4-v2 - FEATURE: Live metrics footer
 * @private
 * @returns {Promise<void>}
 */
async function _loadMetricsSettings() {
  try {
    const result = await browser.storage.local.get([METRICS_ENABLED_KEY, METRICS_INTERVAL_KEY]);

    _metricsEnabled =
      result[METRICS_ENABLED_KEY] !== undefined
        ? result[METRICS_ENABLED_KEY]
        : METRICS_DEFAULT_ENABLED;

    _metricsIntervalMs =
      result[METRICS_INTERVAL_KEY] !== undefined
        ? Math.max(
            METRICS_MIN_INTERVAL_MS,
            Math.min(METRICS_MAX_INTERVAL_MS, result[METRICS_INTERVAL_KEY])
          )
        : METRICS_DEFAULT_INTERVAL_MS;

    console.log('[Manager] METRICS: Settings loaded', {
      enabled: _metricsEnabled,
      intervalMs: _metricsIntervalMs
    });
  } catch (err) {
    console.warn('[Manager] METRICS: Failed to load settings, using defaults', err.message);
    _metricsEnabled = METRICS_DEFAULT_ENABLED;
    _metricsIntervalMs = METRICS_DEFAULT_INTERVAL_MS;
  }
}

/**
 * Load live console filter settings from storage
 * v1.6.4-v3 - Task 3: Filter-aware log counting
 * Note: Uses standard console here since interceptors not yet installed during init
 * @private
 * @returns {Promise<void>}
 */
async function _loadLiveFilterSettings() {
  try {
    const result = await browser.storage.local.get('liveConsoleCategoriesEnabled');
    _liveFilterSettingsCache = result.liveConsoleCategoriesEnabled || null;

    // Use regular console here - interceptors not yet installed during init
    // This log will be counted once interceptors are installed (non-issue)
    console.log('[Manager] METRICS: Live filter settings loaded', {
      hasSettings: !!_liveFilterSettingsCache
    });
  } catch (err) {
    // Use regular console for error - important to log even during init
    console.warn('[Manager] METRICS: Failed to load filter settings', err.message);
    _liveFilterSettingsCache = null; // Count all logs if settings unavailable
  }
}

/**
 * Detect log category from log message prefix
 * v1.6.4-v3 - Task 2: Parse log prefix to determine category
 * @private
 * @param {Array} args - Arguments passed to console method
 * @returns {string} Category ID or 'uncategorized'
 */
function _detectCategoryFromLog(args) {
  if (!args || args.length === 0) return 'uncategorized';

  const firstArg = args[0];
  if (typeof firstArg !== 'string') return 'uncategorized';

  // Match pattern: [emoji displayName] or [displayName] at start
  const match = firstArg.match(/^\[([^\]]+)\]/);
  if (!match) return 'uncategorized';

  const prefix = match[1]
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim();

  // Category mapping based on common prefixes
  const mapping = {
    'url detection': 'url-detection',
    'hover events': 'hover',
    hover: 'hover',
    'clipboard operations': 'clipboard',
    clipboard: 'clipboard',
    'keyboard shortcuts': 'keyboard',
    keyboard: 'keyboard',
    'quick tab actions': 'quick-tabs',
    'quick tabs': 'quick-tabs',
    'quick tab manager': 'quick-tab-manager',
    manager: 'quick-tab-manager',
    'event bus': 'event-bus',
    configuration: 'config',
    config: 'config',
    'state management': 'state',
    state: 'state',
    'browser storage': 'storage',
    storage: 'storage',
    'message passing': 'messaging',
    messaging: 'messaging',
    'web requests': 'webrequest',
    webrequest: 'webrequest',
    'tab management': 'tabs',
    tabs: 'tabs',
    performance: 'performance',
    errors: 'errors',
    initialization: 'initialization',
    background: 'state',
    sidebar: 'quick-tab-manager',
    settings: 'config'
  };

  return mapping[prefix] || 'uncategorized';
}

/**
 * Check if a category is enabled in live console filters
 * v1.6.4-v3 - Task 3: Filter-aware log counting
 * @private
 * @param {string} category - Category ID to check
 * @returns {boolean} True if category is enabled
 */
function _isCategoryFilterEnabled(category) {
  // If no filter settings cached, count all logs
  if (!_liveFilterSettingsCache) return true;

  // 'uncategorized' always counted
  if (category === 'uncategorized') return true;

  // Check if category exists in filter settings
  if (!(category in _liveFilterSettingsCache)) return true;

  return _liveFilterSettingsCache[category] === true;
}

/**
 * Track a log action (called when console.log, console.warn, console.error are invoked)
 * v1.6.4-v3 - FEATURE: Log action tracking with category detection and filtering
 * @private
 * @param {Array} args - Arguments passed to the console method
 */
function _trackLogAction(args) {
  // v1.6.4-v3 - Task 2: Detect category from log message
  const category = _detectCategoryFromLog(args);

  // v1.6.4-v3 - Task 3: Only count if category is enabled in live filters
  if (!_isCategoryFilterEnabled(category)) {
    return; // Don't count filtered-out logs
  }

  const now = Date.now();
  _totalLogActions++;
  _logActionsWindow.push(now);

  // v1.6.4-v3 - Task 2: Increment category counter
  _logActionsByCategory[category] = (_logActionsByCategory[category] || 0) + 1;

  // Remove old entries outside the window
  _pruneLogActionsWindow(now);
}

/**
 * Remove log action timestamps outside the sliding window
 * v1.6.4-v3 - FEATURE: Log action tracking
 * @private
 * @param {number} now - Current timestamp
 */
function _pruneLogActionsWindow(now) {
  const windowStart = now - LOG_ACTIONS_WINDOW_MS;
  while (_logActionsWindow.length > 0 && _logActionsWindow[0] < windowStart) {
    _logActionsWindow.shift();
  }
}

/**
 * Calculate log actions per second based on sliding window
 * v1.6.4-v3 - FEATURE: Log action tracking
 * Uses actual time span of data in window for accurate rate calculation
 * @private
 * @returns {number} Log actions per second (rounded to 1 decimal)
 */
function _calculateLogsPerSecond() {
  const now = Date.now();
  _pruneLogActionsWindow(now);

  const actionsInWindow = _logActionsWindow.length;

  // If no actions or only one action, return 0 (can't calculate meaningful rate)
  if (actionsInWindow <= 1) {
    return 0;
  }

  // Calculate rate using actual time span between first and last action in window
  // This provides accurate rate even when window isn't full
  const oldestTimestamp = _logActionsWindow[0];
  const actualTimeSpanMs = now - oldestTimestamp;

  // Avoid division by zero; require at least 100ms of data
  if (actualTimeSpanMs < 100) {
    return 0;
  }

  const actualTimeSpanSeconds = actualTimeSpanMs / 1000;
  const rate = actionsInWindow / actualTimeSpanSeconds;

  return Math.round(rate * 10) / 10; // Round to 1 decimal
}

/**
 * Clear log action counts (resets total and window)
 * v1.6.4-v3 - FEATURE: Log action tracking
 * Called on page refresh or via explicit reset
 * Note: Uses original console to avoid triggering the interceptor
 */
function _clearLogActionCounts() {
  _totalLogActions = 0;
  _logActionsWindow = [];
  // v1.6.4-v3 - Task 2: Also reset category breakdown
  _logActionsByCategory = {};
  // Use original console to avoid incrementing counter during clear
  if (console._originalLog) {
    console._originalLog('[Manager] METRICS: Log action counts cleared');
  }
}

/**
 * Install console interceptors to track log actions and capture logs for export
 * v1.6.4-v3 - FEATURE: Log action tracking with category detection
 * v1.6.4-v3 - FEATURE: Log buffer for export functionality
 * @private
 */
function _installConsoleInterceptors() {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  // Helper to add log to buffer
  const addToLogBuffer = (type, args) => {
    const message = args
      .map(arg => {
        if (arg === null || arg === undefined) return String(arg);
        if (arg instanceof Error)
          return `[Error: ${arg.message}]\nStack: ${arg.stack || 'unavailable'}`;
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg, null, 2);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      })
      .join(' ');

    // Enforce buffer size limit
    if (MANAGER_LOG_BUFFER.length >= MAX_MANAGER_LOG_BUFFER_SIZE) {
      MANAGER_LOG_BUFFER.shift();
    }

    MANAGER_LOG_BUFFER.push({
      timestamp: Date.now(),
      type,
      message,
      source: 'manager'
    });
  };

  console.log = function (...args) {
    _trackLogAction(args);
    addToLogBuffer('LOG', args);
    originalLog.apply(console, args);
  };

  console.warn = function (...args) {
    _trackLogAction(args);
    addToLogBuffer('WARN', args);
    originalWarn.apply(console, args);
  };

  console.error = function (...args) {
    _trackLogAction(args);
    addToLogBuffer('ERROR', args);
    originalError.apply(console, args);
  };

  // Store originals for potential restoration
  console._originalLog = originalLog;
  console._originalWarn = originalWarn;
  console._originalError = originalError;
}

/**
 * Get all captured Manager logs for export
 * v1.6.4-v3 - FEATURE: Log buffer for export functionality
 * @returns {Array} Copy of log buffer
 */
function getManagerLogs() {
  return [...MANAGER_LOG_BUFFER];
}

/**
 * Clear Manager log buffer
 * v1.6.4-v3 - FEATURE: Log buffer for export functionality
 * @returns {number} Number of entries cleared
 */
function clearManagerLogs() {
  const cleared = MANAGER_LOG_BUFFER.length;
  MANAGER_LOG_BUFFER.length = 0;
  // Use original console to avoid incrementing counter
  if (console._originalLog) {
    console._originalLog('[Manager] Log buffer cleared:', cleared, 'entries');
  }
  return cleared;
}

/**
 * Update a metric value with animation if changed
 * v1.6.4-v2 - FEATURE: Live metrics footer
 * @private
 * @param {HTMLElement} element - The metric value element
 * @param {string} newValue - The new value to display
 */
// v1.6.4-v3 REMOVED: _updateMetricValue() function removed - local DOM elements no longer exist

/**
 * Update all metrics display
 * v1.6.4-v2 - FEATURE: Live metrics footer
 * v1.6.4-v3 - Changed to log action tracking
 * v1.6.4-v3 - Also send metrics to parent window for display in settings.html
 * v1.6.4-v3 - Task 2: Include category breakdown in metrics update
 * v1.6.4-v3 - MODIFIED: Local DOM updates removed - only sends postMessage to parent
 * @private
 */
function _updateMetrics() {
  // Get metrics data for parent window
  const quickTabCount = _allQuickTabsFromPort.length;
  const logsPerSecond = _calculateLogsPerSecond();
  const totalLogs = _totalLogActions;
  // v1.6.4-v3 - Task 2: Include category breakdown
  const categoryBreakdown = { ..._logActionsByCategory };

  // v1.6.4-v3 - Send metrics to parent window (settings.html) for display
  // Uses window.location.origin for security instead of '*'
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        {
          type: 'METRICS_UPDATE',
          quickTabCount,
          logsPerSecond,
          totalLogs,
          categoryBreakdown,
          enabled: _metricsEnabled
        },
        window.location.origin
      );
    }
  } catch {
    // Ignore cross-origin errors - parent might not be available
  }

  // v1.6.4-v3 REMOVED: Local DOM updates removed - metrics footer now only in settings.html
}

// v1.6.4-v3 REMOVED: _applyMetricsVisibility() function deleted
// Local metrics footer no longer exists - visibility controlled by parent window (settings.html)

/**
 * Start the metrics update interval
 * v1.6.4-v2 - FEATURE: Live metrics footer
 * @private
 */
function _startMetricsInterval() {
  // Clear any existing interval
  _stopMetricsInterval();

  if (!_metricsEnabled) {
    console.log('[Manager] METRICS: Not starting interval - metrics disabled');
    return;
  }

  console.log('[Manager] METRICS: Starting interval', {
    intervalMs: _metricsIntervalMs
  });

  // Run immediately once
  _updateMetrics();

  // Set up recurring interval
  _metricsIntervalId = setInterval(_updateMetrics, _metricsIntervalMs);
}

/**
 * Stop the metrics update interval
 * v1.6.4-v2 - FEATURE: Live metrics footer
 * @private
 */
function _stopMetricsInterval() {
  if (_metricsIntervalId !== null) {
    clearInterval(_metricsIntervalId);
    _metricsIntervalId = null;
    console.log('[Manager] METRICS: Interval stopped');
  }
}

/**
 * Initialize live metrics feature
 * v1.6.4-v2 - FEATURE: Live metrics footer
 * v1.6.4-v3 - Added console interceptors for log action tracking
 * v1.6.4-v3 - Task 3: Load live filter settings for filtered log counting
 * Called on sidebar initialization
 */
async function initializeMetrics() {
  console.log('[Manager] METRICS: Initializing...');

  // v1.6.4-v3 - Task 3: Load live filter settings BEFORE installing interceptors
  await _loadLiveFilterSettings();

  // v1.6.4-v3 - Install console interceptors FIRST (before any other logs)
  _installConsoleInterceptors();

  // v1.6.4-v3 REMOVED: DOM references init no longer needed (metrics footer in parent window)
  // Previously: if (!_initMetricsDOMReferences()) { return; }

  // Load settings from storage
  await _loadMetricsSettings();

  // v1.6.4-v3 REMOVED: Visibility application no longer needed (controlled by parent window)
  // Previously: _applyMetricsVisibility();

  // Start interval if enabled
  _startMetricsInterval();

  // Listen for settings changes
  browser.storage.onChanged.addListener(_handleMetricsSettingsChange);

  // v1.6.4-v3 - FIX Task 1: Listen for CLEAR_LOG_ACTION_COUNTS from parent window (settings.js)
  window.addEventListener('message', _handleParentWindowMessage);

  console.log('[Manager] METRICS: Initialization complete');
}

/**
 * Handle storage changes for metrics settings
 * v1.6.4-v2 - FEATURE: Live metrics footer
 * v1.6.4-v3 - Task 3: Also refresh live filter settings when they change
 * @private
 * @param {Object} changes - Storage changes object
 * @param {string} areaName - Storage area name
 */
function _handleMetricsSettingsChange(changes, areaName) {
  if (areaName !== 'local') return;

  let settingsChanged = false;

  if (changes[METRICS_ENABLED_KEY] !== undefined) {
    _metricsEnabled = changes[METRICS_ENABLED_KEY].newValue;
    settingsChanged = true;
    console.log('[Manager] METRICS: Enabled setting changed', {
      enabled: _metricsEnabled
    });
  }

  if (changes[METRICS_INTERVAL_KEY] !== undefined) {
    _metricsIntervalMs = Math.max(
      METRICS_MIN_INTERVAL_MS,
      Math.min(METRICS_MAX_INTERVAL_MS, changes[METRICS_INTERVAL_KEY].newValue)
    );
    settingsChanged = true;
    console.log('[Manager] METRICS: Interval setting changed', {
      intervalMs: _metricsIntervalMs
    });
  }

  // v1.6.4-v3 - Task 3: Update live filter settings cache when they change
  if (changes.liveConsoleCategoriesEnabled !== undefined) {
    _liveFilterSettingsCache = changes.liveConsoleCategoriesEnabled.newValue || null;
    console.log('[Manager] METRICS: Live filter settings updated');
  }

  if (settingsChanged) {
    // v1.6.4-v3 REMOVED: _applyMetricsVisibility() no longer needed (controlled by parent window)
    _startMetricsInterval(); // Restart with new settings
  }
}

/**
 * Send a postMessage response to parent window
 * v1.6.4-v3 - FEATURE: Helper for log buffer functionality
 * @private
 * @param {MessageEventSource} source - The message source to respond to
 * @param {string} origin - The origin to post message to
 * @param {Object} message - The message object to send
 */
function _sendParentWindowResponse(source, origin, message) {
  try {
    source.postMessage(message, origin);
  } catch (err) {
    console.error('[Manager] Failed to send response:', message.type, err);
  }
}

/**
 * Parent window message handlers lookup table
 * v1.6.4-v3 - FEATURE: Lookup table pattern to reduce complexity
 * @private
 */
const _parentWindowMessageHandlers = {
  CLEAR_LOG_ACTION_COUNTS: () => {
    _clearLogActionCounts();
    if (console._originalLog) {
      console._originalLog(
        '[Manager] METRICS: Log action counts cleared via parent window message'
      );
    }
  },
  GET_MANAGER_LOGS: event => {
    const logs = getManagerLogs();
    if (console._originalLog) {
      console._originalLog('[Manager] GET_MANAGER_LOGS: Returning', logs.length, 'logs');
    }
    _sendParentWindowResponse(event.source, event.origin, {
      type: 'MANAGER_LOGS_RESPONSE',
      logs: logs
    });
  },
  CLEAR_MANAGER_LOGS: event => {
    const cleared = clearManagerLogs();
    _sendParentWindowResponse(event.source, event.origin, {
      type: 'CLEAR_MANAGER_LOGS_RESPONSE',
      cleared: cleared
    });
  }
};

/**
 * Handle messages from parent window (settings.js)
 * v1.6.4-v3 - FIX Task 1: Reset log action counts when Clear Log History clicked
 * v1.6.4-v3 - FEATURE: Log buffer retrieval and clearing for export functionality
 * v1.6.4-v3 - Refactored to use lookup table pattern for reduced complexity
 * @private
 * @param {MessageEvent} event - Message event from parent window
 */
function _handleParentWindowMessage(event) {
  // Only accept messages from same origin
  if (event.origin !== window.location.origin) return;

  const data = event.data || {};
  const handler = _parentWindowMessageHandlers[data.type];
  if (handler) {
    handler(event);
  }
}

/**
 * Cleanup metrics on sidebar close
 * v1.6.4-v2 - FEATURE: Live metrics footer
 */
function cleanupMetrics() {
  _stopMetricsInterval();
  browser.storage.onChanged.removeListener(_handleMetricsSettingsChange);
  // v1.6.4-v3 - Also remove parent window message listener
  window.removeEventListener('message', _handleParentWindowMessage);
  console.log('[Manager] METRICS: Cleanup complete');
}

// ==================== END LIVE METRICS FUNCTIONS ====================

// ==================== v1.6.4-v4 CONTAINER ISOLATION AND FILTERING ====================

/**
 * Storage key for container filter preference
 * v1.6.4-v4 - FEATURE: Container isolation
 */
const CONTAINER_FILTER_STORAGE_KEY = 'quickTabsContainerFilter';

/**
 * Get container name by cookieStoreId (async)
 * Uses containersData cache when available, falls back to API
 * v1.6.4-v4 - FEATURE: Container isolation
 * @private
 * @param {string} cookieStoreId - Container ID (e.g., 'firefox-container-1')
 * @returns {Promise<string>} Container name (e.g., 'Shopping')
 */
async function _getContainerNameByIdAsync(cookieStoreId) {
  // Check cache first
  if (containersData[cookieStoreId]) {
    return containersData[cookieStoreId].name;
  }

  // Handle default container
  if (!cookieStoreId || cookieStoreId === 'firefox-default') {
    return 'Default';
  }

  // Try to fetch from API if not in cache
  const container = await _tryFetchContainerFromAPI(cookieStoreId);
  if (container) {
    return container.name;
  }

  // Fallback: format cookieStoreId as a readable name
  return _formatContainerIdAsName(cookieStoreId);
}

/**
 * Try to fetch container info from contextualIdentities API
 * v1.6.4-v4 - FEATURE: Container isolation - extracted to reduce nesting depth
 * @private
 * @param {string} cookieStoreId - Container ID
 * @returns {Promise<Object|null>} Container object or null
 */
async function _tryFetchContainerFromAPI(cookieStoreId) {
  if (typeof browser.contextualIdentities === 'undefined') {
    return null;
  }

  try {
    const container = await browser.contextualIdentities.get(cookieStoreId);
    if (container) {
      // Cache the result
      containersData[cookieStoreId] = {
        name: container.name,
        icon: getContainerIcon(container.icon),
        color: container.color,
        colorCode: container.colorCode,
        cookieStoreId: container.cookieStoreId
      };
      return container;
    }
  } catch (err) {
    console.log('[Manager] CONTAINER_NAME_LOOKUP: API error for', cookieStoreId, err.message);
  }

  return null;
}

/**
 * Format container ID as a readable name (fallback)
 * v1.6.4-v4 - FEATURE: Container isolation
 * @private
 * @param {string} cookieStoreId - Container ID
 * @returns {string} Formatted name
 */
function _formatContainerIdAsName(cookieStoreId) {
  // Early return for invalid input
  if (!cookieStoreId || typeof cookieStoreId !== 'string') {
    return 'Unnamed Container';
  }
  // e.g., 'firefox-container-1' -> 'Container 1'
  const match = cookieStoreId.match(/firefox-container-(\d+)/);
  if (match) {
    return `Container ${match[1]}`;
  }
  // Return the ID itself if it doesn't match expected pattern
  return cookieStoreId === '' ? 'Unnamed Container' : cookieStoreId;
}

/**
 * Get container name synchronously from cache
 * v1.6.4-v4 - FEATURE: Container isolation
 * @private
 * @param {string} cookieStoreId - Container ID
 * @returns {string} Container name or fallback
 */
function _getContainerNameSync(cookieStoreId) {
  if (containersData[cookieStoreId]) {
    return containersData[cookieStoreId].name;
  }
  if (!cookieStoreId || cookieStoreId === 'firefox-default') {
    return 'Default';
  }
  return _formatContainerIdAsName(cookieStoreId);
}

/**
 * Get container icon by cookieStoreId
 * v1.6.4-v4 - FEATURE: Container isolation
 * @private
 * @param {string} cookieStoreId - Container ID
 * @returns {string} Container icon emoji
 */
function _getContainerIconSync(cookieStoreId) {
  if (containersData[cookieStoreId]) {
    return containersData[cookieStoreId].icon;
  }
  return '📁';
}

/**
 * Update current container ID from active tab
 * v1.6.4-v4 - FEATURE: Container isolation
 * @private
 * @param {number} tabId - Browser tab ID
 */
async function _updateCurrentContainerId(tabId) {
  const oldContainerId = _currentContainerId;

  try {
    const tab = await browser.tabs.get(tabId);
    _currentContainerId = tab?.cookieStoreId || 'firefox-default';
  } catch (err) {
    console.log('[Manager] CONTAINER_UPDATE: Tab lookup failed', tabId, err.message);
    _currentContainerId = 'firefox-default';
  }

  const containerChanged = oldContainerId !== _currentContainerId;

  if (containerChanged) {
    console.log('[Manager] 🔄 CONTAINER_CHANGED:', {
      previousContainerId: oldContainerId,
      previousContainerName: _getContainerNameSync(oldContainerId),
      currentContainerId: _currentContainerId,
      currentContainerName: _getContainerNameSync(_currentContainerId)
    });
  }

  return containerChanged;
}

/**
 * Populate container filter dropdown with available containers
 * v1.6.4-v4 - FEATURE: Container isolation
 * @private
 */
async function _populateContainerDropdown() {
  if (!_containerFilterDropdown) return;

  // Clear existing options
  _containerFilterDropdown.innerHTML = '';

  // Add "Current Container" option (default)
  const currentName = _getContainerNameSync(_currentContainerId);
  const currentIcon = _getContainerIconSync(_currentContainerId);
  const currentOption = document.createElement('option');
  currentOption.value = 'current';
  currentOption.textContent = `${currentIcon} ${currentName}`;
  currentOption.title = `Filter to Quick Tabs in current container (${currentName})`;
  _containerFilterDropdown.appendChild(currentOption);

  // Add "All Containers" option
  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.textContent = '🌐 All Containers';
  allOption.title = 'Show Quick Tabs from all containers';
  _containerFilterDropdown.appendChild(allOption);

  // Add separator-like disabled option
  const separator = document.createElement('option');
  separator.disabled = true;
  separator.textContent = '──────────';
  _containerFilterDropdown.appendChild(separator);

  // Add each known container as an option
  const containerIds = Object.keys(containersData).sort((a, b) => {
    // Sort default first, then by name
    if (a === 'firefox-default') return -1;
    if (b === 'firefox-default') return 1;
    return _getContainerNameSync(a).localeCompare(_getContainerNameSync(b));
  });

  for (const containerId of containerIds) {
    const name = _getContainerNameSync(containerId);
    const icon = _getContainerIconSync(containerId);
    const option = document.createElement('option');
    option.value = containerId;
    option.textContent = `${icon} ${name}`;
    option.title = `Filter to Quick Tabs in ${name} container`;
    _containerFilterDropdown.appendChild(option);
  }

  // Set the selected value
  _containerFilterDropdown.value = _selectedContainerFilter;

  console.log('[Manager] CONTAINER_DROPDOWN_POPULATED:', {
    containerCount: containerIds.length,
    selectedFilter: _selectedContainerFilter,
    currentContainerId: _currentContainerId
  });
}

/**
 * Handle container filter dropdown change
 * v1.6.4-v4 - FEATURE: Container isolation
 * @private
 * @param {Event} event - Change event
 */
function _handleContainerFilterChange(event) {
  // Validate event target
  if (!event?.target?.value) {
    console.warn('[Manager] CONTAINER_FILTER_CHANGE: Invalid event target');
    return;
  }
  const newValue = event.target.value;
  const oldValue = _selectedContainerFilter;

  if (newValue === oldValue) return;

  _selectedContainerFilter = newValue;

  console.log('[Manager] 🔄 CONTAINER_FILTER_CHANGED:', {
    previousFilter: oldValue,
    newFilter: newValue,
    filterName:
      newValue === 'current'
        ? _getContainerNameSync(_currentContainerId)
        : newValue === 'all'
          ? 'All Containers'
          : _getContainerNameSync(newValue)
  });

  // Save preference to storage
  _saveContainerFilterPreference(newValue);

  // Re-render UI with new filter
  _incrementStateVersion('container-filter-change');
  renderUI();
}

/**
 * Save container filter preference to storage
 * v1.6.4-v4 - FEATURE: Container isolation
 * @private
 * @param {string} filterValue - Filter value to save
 */
async function _saveContainerFilterPreference(filterValue) {
  try {
    await browser.storage.local.set({ [CONTAINER_FILTER_STORAGE_KEY]: filterValue });
    console.log('[Manager] CONTAINER_FILTER_SAVED:', filterValue);
  } catch (err) {
    console.warn('[Manager] CONTAINER_FILTER_SAVE_FAILED:', err.message);
  }
}

/**
 * Load container filter preference from storage
 * v1.6.4-v4 - FEATURE: Container isolation
 * v1.6.4-v4 - FIX BUG #1: Default to 'all' if no saved preference
 * v1.6.4-v4 - FIX BUG #1b: Migrate old 'current' preference to 'all' on version upgrade
 * @private
 */
async function _loadContainerFilterPreference() {
  try {
    const result = await browser.storage.local.get([CONTAINER_FILTER_STORAGE_KEY, 'containerFilterMigrated_v1_6_4_v4']);
    const savedFilter = result[CONTAINER_FILTER_STORAGE_KEY];
    const alreadyMigrated = result['containerFilterMigrated_v1_6_4_v4'];
    
    // v1.6.4-v4 - FIX BUG #1b: One-time migration from 'current' to 'all'
    const needsMigration = !alreadyMigrated && savedFilter === 'current';
    
    if (needsMigration) {
      await _migrateContainerFilterToAll();
      return;
    }
    
    // v1.6.4-v4 - FIX BUG #1: Default to 'all' so Quick Tabs are visible by default
    _selectedContainerFilter = savedFilter || 'all';
    console.log('[Manager] CONTAINER_FILTER_LOADED:', _selectedContainerFilter);
    
    // Mark migration check complete to prevent re-running on future loads
    if (!alreadyMigrated) {
      await browser.storage.local.set({ 'containerFilterMigrated_v1_6_4_v4': true });
    }
  } catch (err) {
    console.warn('[Manager] CONTAINER_FILTER_LOAD_FAILED:', err.message);
    _selectedContainerFilter = 'all';
  }
}

/**
 * Migrate container filter from 'current' to 'all'
 * v1.6.4-v4 - FIX BUG #1b: One-time migration helper
 * @private
 */
async function _migrateContainerFilterToAll() {
  console.log('[Manager] CONTAINER_FILTER_MIGRATING: Resetting "current" to "all" for v1.6.4-v4');
  _selectedContainerFilter = 'all';
  await browser.storage.local.set({
    [CONTAINER_FILTER_STORAGE_KEY]: 'all',
    'containerFilterMigrated_v1_6_4_v4': true
  });
  console.log('[Manager] CONTAINER_FILTER_LOADED:', _selectedContainerFilter, '(migrated from current)');
}

/**
 * Filter Quick Tabs by container based on current filter setting
 * v1.6.4-v4 - FEATURE: Container isolation
 * @private
 * @param {Array} allTabs - All Quick Tabs
 * @returns {Array} Filtered Quick Tabs
 */
function _filterQuickTabsByContainer(allTabs) {
  if (!Array.isArray(allTabs) || allTabs.length === 0) {
    return allTabs;
  }

  // If filter is 'all', return all tabs
  if (_selectedContainerFilter === 'all') {
    return allTabs;
  }

  // Determine the target container ID
  const targetContainerId =
    _selectedContainerFilter === 'current' ? _currentContainerId : _selectedContainerFilter;

  // Filter tabs by originContainerId
  const filtered = allTabs.filter(tab => {
    // Get the tab's container ID (use 'firefox-default' if not set)
    const tabContainerId = tab.originContainerId || 'firefox-default';
    return tabContainerId === targetContainerId;
  });

  console.log('[Manager] CONTAINER_FILTER_APPLIED:', {
    filter: _selectedContainerFilter,
    targetContainerId,
    targetContainerName: _getContainerNameSync(targetContainerId),
    totalTabs: allTabs.length,
    filteredTabs: filtered.length
  });

  return filtered;
}

/**
 * Setup container filter dropdown event listener
 * v1.6.4-v4 - FEATURE: Container isolation
 * @private
 */
function _setupContainerFilterDropdown() {
  _containerFilterDropdown = document.getElementById('containerFilter');
  if (!_containerFilterDropdown) {
    console.warn('[Manager] CONTAINER_FILTER: Dropdown element not found');
    return;
  }

  _containerFilterDropdown.addEventListener('change', _handleContainerFilterChange);
  console.log('[Manager] CONTAINER_FILTER: Dropdown event listener attached');
}

/**
 * Initialize container isolation feature
 * v1.6.4-v4 - FEATURE: Container isolation
 * Called during sidebar initialization
 */
async function initializeContainerIsolation() {
  console.log('[Manager] CONTAINER_ISOLATION: Initializing...');

  // Load saved filter preference
  await _loadContainerFilterPreference();

  // Setup dropdown - validate it was found
  _setupContainerFilterDropdown();
  if (!_containerFilterDropdown) {
    console.warn('[Manager] CONTAINER_ISOLATION: Dropdown not found - feature disabled');
    return;
  }

  // Get current container from active tab
  if (currentBrowserTabId) {
    await _updateCurrentContainerId(currentBrowserTabId);
  }

  // Populate dropdown
  await _populateContainerDropdown();

  console.log('[Manager] CONTAINER_ISOLATION: Initialization complete', {
    currentContainerId: _currentContainerId,
    currentContainerName: _getContainerNameSync(_currentContainerId),
    selectedFilter: _selectedContainerFilter,
    dropdownReady: !!_containerFilterDropdown
  });
}

/**
 * Update container dropdown display when container changes
 * v1.6.4-v4 - FEATURE: Container isolation
 * Called when user switches to a different container tab
 * @private
 */
async function _onContainerContextChanged() {
  // Update dropdown to show new "current" container name
  await _populateContainerDropdown();

  // If filter is 'current', re-render to apply new container filter
  if (_selectedContainerFilter === 'current') {
    console.log('[Manager] CONTAINER_CONTEXT_CHANGED: Re-rendering for current container filter');
    renderUI();
  }
}

// ==================== END CONTAINER ISOLATION FUNCTIONS ====================

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

// ==================== v1.6.3.12 OPTION 4: QUICK TABS PORT ====================
// FIX: browser.storage.session does NOT exist in Firefox Manifest V2
// Sidebar connects to background via 'quick-tabs-port' for Quick Tab operations

/**
 * Delay before attempting Quick Tabs port reconnection (2 seconds)
 * v1.6.3.12 - Option 4: Centralized reconnect delay constant
 */
const QUICK_TABS_SIDEBAR_RECONNECT_DELAY_MS = 2000;

/**
 * Quick Tabs port connection to background
 * v1.6.3.12 - Option 4: Replaces storage.session with port messaging
 */
let quickTabsPort = null;

/**
 * All Quick Tabs received from background
 * v1.6.3.12 - Option 4: In-memory cache from background
 */
let _allQuickTabsFromPort = [];

// v1.6.4-v3 - Log buffer for export functionality
const MAX_MANAGER_LOG_BUFFER_SIZE = 5000;
const MANAGER_LOG_BUFFER = [];

// v1.6.4 - Note: _userGroupOrder and _userQuickTabOrderByGroup now managed by OrderManager.js
// These module-level variables have been removed to reduce code duplication

/**
 * Track sent Quick Tab port operations for roundtrip time calculation
 * v1.6.3.12-v2 - FIX Issue #16-17: Port messaging roundtrip time tracking
 * Key: quickTabId, Value: { sentAt: number, messageType: string }
 */
const _quickTabPortOperationTimestamps = new Map();

/**
 * v1.6.3.12-v7 - FIX Issue #30: Quick Tabs port reconnection circuit breaker state
 * Tracks consecutive reconnection attempts to prevent infinite reconnection loops
 */
let _quickTabsPortReconnectAttempts = 0;
let _quickTabsPortReconnectBackoffMs = QUICK_TABS_PORT_RECONNECT_BACKOFF_INITIAL_MS;
let _quickTabsPortCircuitBreakerTripped = false;
// v1.6.4 - FIX Issue #5: Track when circuit breaker was tripped for auto-reset
let _quickTabsPortCircuitBreakerTrippedAt = 0;
let _quickTabsPortCircuitBreakerAutoResetTimerId = null;

/**
 * v1.6.3.12-v7 - FIX Issue #13: Port message sequence number tracking
 * Tracks last received sequence number for out-of-order detection
 */
let _lastReceivedSequence = 0;
let _sequenceGapsDetected = 0;

/**
 * v1.6.4-v3 - FIX BUG #1/#2/#3: Safety timeout for STATE_CHANGED
 * Tracks pending safety timeout after transfer/duplicate operations
 * Cleared when STATE_CHANGED arrives
 */
let _stateChangedSafetyTimeoutId = null;

/**
 * v1.6.4-v3 - FIX BUG #15d: Flag to force immediate render after transfer/duplicate response
 * When set, GET_ALL_QUICK_TABS_RESPONSE will bypass debounced scheduling and force immediate render
 * This ensures Manager displays correct state after transfer/duplicate operations
 */
let _pendingCriticalStateRefresh = false;

/**
 * Initialize Quick Tabs port connection
 * v1.6.3.12 - Option 4: Connect to background via 'quick-tabs-port'
 * v1.6.3.12-v7 - FIX Issue #30: Add circuit breaker with max reconnection attempts
 */
/**
 * Check if circuit breaker is tripped and log if so
 * v1.6.4 - FIX Code Health: Extracted to reduce initializeQuickTabsPort line count
 * @private
 * @returns {boolean} True if circuit breaker is tripped and execution should be aborted
 */
function _checkCircuitBreakerTripped() {
  if (!_quickTabsPortCircuitBreakerTripped) return false;

  console.warn('[Sidebar] QUICK_TABS_PORT_CIRCUIT_BREAKER_OPEN:', {
    timestamp: Date.now(),
    attempts: _quickTabsPortReconnectAttempts,
    maxAttempts: QUICK_TABS_PORT_MAX_RECONNECT_ATTEMPTS,
    message: 'Connection attempts exhausted. Use manual reconnect button.'
  });
  return true;
}

/**
 * Reset circuit breaker state on successful connection
 * v1.6.4 - FIX Code Health: Extracted to reduce initializeQuickTabsPort line count
 * @private
 */
function _resetCircuitBreakerOnSuccess() {
  _quickTabsPortReconnectAttempts = 0;
  _quickTabsPortReconnectBackoffMs = QUICK_TABS_PORT_RECONNECT_BACKOFF_INITIAL_MS;
  _quickTabsPortCircuitBreakerTripped = false;
  _clearCircuitBreakerAutoResetTimer();
}

/**
 * Handle port disconnect event
 * v1.6.4 - FIX Code Health: Extracted to reduce initializeQuickTabsPort line count
 * @private
 */
function _handleQuickTabsPortDisconnect() {
  // CRITICAL: Capture browser.runtime.lastError IMMEDIATELY - browser clears it after callback
  const lastError = browser.runtime?.lastError;
  const disconnectTimestamp = Date.now();

  console.warn('[Sidebar] QUICK_TABS_PORT_DISCONNECTED:', {
    reason: lastError?.message || 'unknown',
    errorCaptured: !!lastError,
    timestamp: disconnectTimestamp,
    pendingOperations: _quickTabPortOperationTimestamps.size,
    portWasConnected: !!quickTabsPort,
    cacheStalenessMs: disconnectTimestamp - lastCacheSyncFromStorage,
    reconnectAttempts: _quickTabsPortReconnectAttempts
  });

  quickTabsPort = null;
  _quickTabPortOperationTimestamps.clear();
  _scheduleQuickTabsPortReconnect(disconnectTimestamp);
}

/**
 * Send SIDEBAR_READY message with fallback
 * v1.6.4 - FIX Code Health: Extracted to reduce initializeQuickTabsPort line count
 * @private
 */
function _sendSidebarReadyMessage() {
  const message = { type: 'SIDEBAR_READY', timestamp: Date.now() };
  try {
    quickTabsPort.postMessage(message);
    console.log('[Sidebar] SIDEBAR_READY sent to background via port');
  } catch (err) {
    console.warn('[Sidebar] SIDEBAR_READY port failed, trying fallback:', err.message);
    browser.runtime
      .sendMessage({ ...message, source: 'sendMessage_fallback' })
      .then(() => console.log('[Sidebar] SIDEBAR_READY sent via runtime.sendMessage fallback'))
      .catch(sendErr =>
        console.error('[Sidebar] SIDEBAR_READY both methods failed:', {
          portError: err.message,
          sendMessageError: sendErr.message
        })
      );
  }
}

/**
 * Initialize Quick Tabs port connection
 * v1.6.3.12 - Option 4: Connect to background via 'quick-tabs-port'
 * v1.6.3.12-v7 - FIX Issue #30: Add circuit breaker with max reconnection attempts
 * v1.6.4 - FIX Code Health: Extracted helpers to reduce line count (84 -> ~35)
 */
function initializeQuickTabsPort() {
  if (_checkCircuitBreakerTripped()) return;

  console.log('[Sidebar] PORT_LIFECYCLE: Connection attempt starting', {
    timestamp: Date.now(),
    portName: 'quick-tabs-port',
    existingPort: !!quickTabsPort,
    reconnectAttempt: _quickTabsPortReconnectAttempts
  });

  try {
    quickTabsPort = browser.runtime.connect({ name: 'quick-tabs-port' });
    _resetCircuitBreakerOnSuccess();

    console.log('[Sidebar] PORT_LIFECYCLE: Connection established', {
      timestamp: Date.now(),
      portName: 'quick-tabs-port',
      success: true,
      circuitBreakerReset: true,
      autoResetTimerCleared: true
    });

    quickTabsPort.onMessage.addListener(handleQuickTabsPortMessage);
    quickTabsPort.onDisconnect.addListener(_handleQuickTabsPortDisconnect);

    _sendSidebarReadyMessage();

    console.log('[Sidebar] Sidebar requesting initial state after port connection', {
      timestamp: Date.now(),
      portConnected: !!quickTabsPort
    });
    requestAllQuickTabsViaPort();
  } catch (err) {
    console.error('[Sidebar] PORT_LIFECYCLE: Connection failed', {
      timestamp: Date.now(),
      portName: 'quick-tabs-port',
      error: err.message,
      success: false,
      reconnectAttempt: _quickTabsPortReconnectAttempts
    });
    _scheduleQuickTabsPortReconnect(Date.now());
  }
}

/**
 * Schedule Quick Tabs port reconnection with exponential backoff and circuit breaker
 * v1.6.3.12-v7 - FIX Issue #30: Implement max reconnection attempts with exponential backoff
 * @private
 * @param {number} disconnectTimestamp - When the disconnect occurred
 */
function _scheduleQuickTabsPortReconnect(disconnectTimestamp) {
  // Increment reconnect attempts
  _quickTabsPortReconnectAttempts++;

  // Check if we've exceeded max attempts
  if (_quickTabsPortReconnectAttempts >= QUICK_TABS_PORT_MAX_RECONNECT_ATTEMPTS) {
    _quickTabsPortCircuitBreakerTripped = true;
    // v1.6.4 - FIX Issue #5: Record when circuit breaker was tripped for auto-reset
    _quickTabsPortCircuitBreakerTrippedAt = Date.now();

    console.error('[Sidebar] QUICK_TABS_PORT_CIRCUIT_BREAKER_TRIPPED:', {
      timestamp: Date.now(),
      attempts: _quickTabsPortReconnectAttempts,
      maxAttempts: QUICK_TABS_PORT_MAX_RECONNECT_ATTEMPTS,
      message: 'Max reconnection attempts reached. Background may be unavailable.',
      recoveryAction: 'manual_reconnect_required',
      autoResetAfterMs: QUICK_TABS_PORT_CIRCUIT_BREAKER_AUTO_RESET_MS
    });

    // v1.6.3.12-v7 - FIX Issue #30: Show error notification to user
    _showQuickTabsPortConnectionError();

    // v1.6.4 - FIX Issue #5: Schedule automatic circuit breaker reset
    _scheduleCircuitBreakerAutoReset();
    return;
  }

  // Calculate backoff delay with exponential increase
  const backoffDelay = _quickTabsPortReconnectBackoffMs;

  console.log('[Sidebar] QUICK_TABS_PORT_RECONNECT_SCHEDULED:', {
    timestamp: Date.now(),
    attempt: _quickTabsPortReconnectAttempts,
    maxAttempts: QUICK_TABS_PORT_MAX_RECONNECT_ATTEMPTS,
    backoffMs: backoffDelay,
    timeSinceDisconnect: Date.now() - disconnectTimestamp,
    nextBackoffMs: Math.min(backoffDelay * 2, QUICK_TABS_PORT_RECONNECT_BACKOFF_MAX_MS)
  });

  // Schedule reconnect with current backoff
  setTimeout(() => {
    if (!quickTabsPort && !_quickTabsPortCircuitBreakerTripped) {
      console.log('[Sidebar] PORT_LIFECYCLE: Attempting Quick Tabs port reconnection', {
        timestamp: Date.now(),
        attempt: _quickTabsPortReconnectAttempts,
        timeSinceDisconnect: Date.now() - disconnectTimestamp
      });
      initializeQuickTabsPort();
    }
  }, backoffDelay);

  // Increase backoff for next attempt (capped at max)
  _quickTabsPortReconnectBackoffMs = Math.min(
    _quickTabsPortReconnectBackoffMs * 2,
    QUICK_TABS_PORT_RECONNECT_BACKOFF_MAX_MS
  );
}

/**
 * Show error notification when Quick Tabs port connection fails
 * v1.6.3.12-v7 - FIX Issue #30: User feedback after max reconnection attempts
 * @private
 */
function _showQuickTabsPortConnectionError() {
  const errorMessage = 'Connection to background lost. Click to reconnect.';

  // Create error notification element
  const notification = document.createElement('div');
  notification.id = 'quick-tabs-port-error-notification';
  notification.className = 'error-notification reconnect-available';
  notification.textContent = errorMessage;
  notification.style.cssText = `
    position: fixed;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    background: #d32f2f;
    color: white;
    padding: 10px 16px;
    border-radius: 4px;
    z-index: 10000;
    font-size: 14px;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  `;

  // v1.6.3.12-v7 - FIX Issue #30: Add click handler for manual reconnect
  notification.addEventListener('click', () => {
    manualQuickTabsPortReconnect();
    notification.remove();
  });

  // Remove any existing notification first
  const existing = document.getElementById('quick-tabs-port-error-notification');
  if (existing) {
    existing.remove();
  }

  document.body.appendChild(notification);

  console.log('[Sidebar] QUICK_TABS_PORT_ERROR_NOTIFICATION_SHOWN:', {
    timestamp: Date.now(),
    message: errorMessage,
    hasManualReconnect: true
  });
}

/**
 * Manual reconnection triggered by user
 * v1.6.3.12-v7 - FIX Issue #30: Provide manual reconnect mechanism
 */
function manualQuickTabsPortReconnect() {
  console.log('[Sidebar] QUICK_TABS_PORT_MANUAL_RECONNECT:', {
    timestamp: Date.now(),
    previousAttempts: _quickTabsPortReconnectAttempts,
    wasCircuitBreakerTripped: _quickTabsPortCircuitBreakerTripped
  });

  // v1.6.4 - FIX Issue #5: Clear any pending auto-reset timer
  _clearCircuitBreakerAutoResetTimer();

  // Reset circuit breaker state
  _quickTabsPortReconnectAttempts = 0;
  _quickTabsPortReconnectBackoffMs = QUICK_TABS_PORT_RECONNECT_BACKOFF_INITIAL_MS;
  _quickTabsPortCircuitBreakerTripped = false;
  _quickTabsPortCircuitBreakerTrippedAt = 0;

  // Attempt connection
  initializeQuickTabsPort();
}

/**
 * Remove Quick Tabs port error notification from DOM
 * v1.6.4 - FIX Issue #5: Extracted helper for notification removal
 * @private
 */
function _removeQuickTabsPortErrorNotification() {
  const notification = document.getElementById('quick-tabs-port-error-notification');
  if (notification) {
    notification.remove();
  }
}

/**
 * Execute circuit breaker auto-reset logic
 * v1.6.4 - FIX Issue #5: Extracted callback logic for clarity and testability
 * @private
 */
function _executeCircuitBreakerAutoReset() {
  // Clear the timer ID first to prevent race conditions
  _quickTabsPortCircuitBreakerAutoResetTimerId = null;

  // Check if still tripped (could have been manually reset)
  if (!_quickTabsPortCircuitBreakerTripped) {
    console.log('[Sidebar] CIRCUIT_BREAKER_AUTO_RESET_SKIPPED: Already reset');
    return;
  }

  console.log('[Sidebar] CIRCUIT_BREAKER_AUTO_RESET_TRIGGERED:', {
    timestamp: Date.now(),
    trippedDurationMs: Date.now() - _quickTabsPortCircuitBreakerTrippedAt,
    previousAttempts: _quickTabsPortReconnectAttempts
  });

  // Reset circuit breaker state
  _quickTabsPortReconnectAttempts = 0;
  _quickTabsPortReconnectBackoffMs = QUICK_TABS_PORT_RECONNECT_BACKOFF_INITIAL_MS;
  _quickTabsPortCircuitBreakerTripped = false;
  _quickTabsPortCircuitBreakerTrippedAt = 0;

  // Remove error notification if present
  _removeQuickTabsPortErrorNotification();

  // Attempt reconnection
  initializeQuickTabsPort();
}

/**
 * Schedule automatic circuit breaker reset after timeout period
 * v1.6.4 - FIX Issue #5: Implement timeout-based reset for circuit breaker
 * After 60 seconds, allow one more reconnection attempt automatically
 * @private
 */
function _scheduleCircuitBreakerAutoReset() {
  // Clear any existing timer
  _clearCircuitBreakerAutoResetTimer();

  console.log('[Sidebar] CIRCUIT_BREAKER_AUTO_RESET_SCHEDULED:', {
    timestamp: Date.now(),
    resetAfterMs: QUICK_TABS_PORT_CIRCUIT_BREAKER_AUTO_RESET_MS,
    trippedAt: _quickTabsPortCircuitBreakerTrippedAt
  });

  _quickTabsPortCircuitBreakerAutoResetTimerId = setTimeout(
    _executeCircuitBreakerAutoReset,
    QUICK_TABS_PORT_CIRCUIT_BREAKER_AUTO_RESET_MS
  );
}

/**
 * Clear the circuit breaker auto-reset timer
 * v1.6.4 - FIX Issue #5: Helper to cancel pending auto-reset
 * v1.6.4 - FIX Issue #20: Add logging when timer is cleared
 * @private
 */
function _clearCircuitBreakerAutoResetTimer() {
  if (_quickTabsPortCircuitBreakerAutoResetTimerId !== null) {
    clearTimeout(_quickTabsPortCircuitBreakerAutoResetTimerId);

    console.log('[Sidebar] CIRCUIT_BREAKER_AUTO_RESET_TIMER_CLEARED:', {
      timestamp: Date.now(),
      reason: 'manual_reconnect_or_successful_connection'
    });

    _quickTabsPortCircuitBreakerAutoResetTimerId = null;
  }
}

// ==================== v1.6.3.12-v2 PORT MESSAGE HANDLER HELPERS ====================
/**
 * Compute per-origin-tab statistics for cross-tab visibility logging
 * v1.6.4 - FIX Issue #11/#14: Extracted to reduce _handleQuickTabsStateUpdate complexity
 * v1.6.4 - Code Review: Added defensive validation for tab.originTabId
 * @private
 * @param {Array} quickTabs - Quick Tabs array
 * @returns {{ originTabStats: Object, originTabCount: number }}
 */
function _computeOriginTabStats(quickTabs) {
  // Use Object.create(null) to avoid prototype pollution
  const originTabStats = Object.create(null);
  for (const tab of quickTabs) {
    // Defensive: handle missing or invalid originTabId
    const originTabId = typeof tab?.originTabId === 'number' ? tab.originTabId : 'unknown';
    const originKey = `tab-${originTabId}`;
    if (!originTabStats[originKey]) {
      originTabStats[originKey] = 0;
    }
    originTabStats[originKey]++;
  }
  return {
    originTabStats,
    originTabCount: Object.keys(originTabStats).length
  };
}

/**
 * Log cross-tab aggregation statistics
 * v1.6.4 - FIX Issue #11/#14: Extracted to reduce _handleQuickTabsStateUpdate complexity
 * @private
 */
function _logCrossTabAggregation(quickTabs, receiveTime, renderReason, correlationId) {
  const { originTabStats, originTabCount } = _computeOriginTabStats(quickTabs);

  console.log('[Sidebar] STATE_SYNC_CROSS_TAB_AGGREGATION:', {
    timestamp: receiveTime,
    source: renderReason,
    correlationId: correlationId || null,
    totalQuickTabs: quickTabs.length,
    originTabCount,
    quickTabsPerOriginTab: originTabStats,
    message: `Received ${quickTabs.length} Quick Tabs from ${originTabCount} browser tabs`
  });
}

/**
 * Handle empty state transition for Quick Tabs
 * v1.6.4 - Extracted to reduce complexity of _handleQuickTabsStateUpdate
 * @private
 * @param {boolean} wasNotEmpty - Whether state was non-empty before
 * @param {boolean} isNowEmpty - Whether state is now empty
 * @param {string|null} correlationId - Correlation ID for async tracing
 * @returns {boolean} True if immediate render was forced, false otherwise
 */
function _handleEmptyStateTransition(wasNotEmpty, isNowEmpty, correlationId) {
  if (!wasNotEmpty || !isNowEmpty) {
    return false;
  }

  console.log('[Sidebar] STATE_SYNC_PATH_EMPTY_TRANSITION: Forcing immediate render', {
    previousCount: _allQuickTabsFromPort.length,
    newCount: 0,
    wasNotEmpty,
    isNowEmpty,
    correlationId: correlationId || null,
    reason: 'Last Quick Tab closed - forcing immediate render',
    timestamp: Date.now()
  });
  _forceImmediateRender('empty-state-transition');
  return true;
}

/**
 * Log low Quick Tab count for debugging last-close issues
 * v1.6.4 - Extracted to reduce complexity of _handleQuickTabsStateUpdate
 * @private
 * @param {Array} quickTabs - Quick Tabs array
 * @param {boolean} wasNotEmpty - Whether state was non-empty before
 * @param {string|null} correlationId - Correlation ID for async tracing
 */
function _logLowQuickTabCount(quickTabs, wasNotEmpty, correlationId) {
  if (quickTabs.length > 1) {
    return;
  }

  console.log('[Sidebar] STATE_SYNC_PATH_LOW_COUNT:', {
    previousCount: wasNotEmpty ? '>0' : '0',
    newCount: quickTabs.length,
    correlationId: correlationId || null,
    quickTabIds: quickTabs.map(qt => qt.id),
    timestamp: Date.now(),
    message: 'Low Quick Tab count - monitoring for last-close issue'
  });
}

/**
 * Handle Quick Tabs state update from background
 * v1.6.3.12-v2 - FIX Code Health: Extract duplicate state update logic
 * v1.6.3.12 - Gap #7: End-to-end state sync path logging
 * v1.6.3.12-v4 - Gap #5: Accept and propagate correlationId through entire chain
 * v1.6.4 - FIX Issue #11/#14: Add cross-tab aggregation logging (extracted to helper)
 * v1.6.4 - FIX BUG #4: Extract empty state handling to reduce complexity
 * @private
 * @param {Array} quickTabs - Quick Tabs array
 * @param {string} renderReason - Reason for render scheduling
 * @param {string} [correlationId=null] - Correlation ID for async tracing
 */
function _handleQuickTabsStateUpdate(quickTabs, renderReason, correlationId = null) {
  const receiveTime = Date.now();

  // v1.6.4-v3 - FIX BUG #1/#2/#3: Clear any pending safety timeout since STATE_CHANGED arrived
  _clearStateChangedSafetyTimeout();

  // v1.6.3.12 - Gap #7: Log Manager received update with correlationId
  console.log('[Sidebar] STATE_SYNC_PATH_MANAGER_RECEIVED:', {
    timestamp: receiveTime,
    source: renderReason,
    correlationId: correlationId || null,
    tabCount: Array.isArray(quickTabs) ? quickTabs.length : 0,
    isValidArray: Array.isArray(quickTabs),
    previousTabCount: _allQuickTabsFromPort.length
  });

  if (!Array.isArray(quickTabs)) {
    console.warn('[Sidebar] STATE_SYNC_PATH_INVALID:', {
      timestamp: receiveTime,
      source: renderReason,
      correlationId: correlationId || null,
      reason: 'quickTabs is not an array',
      receivedType: typeof quickTabs
    });
    return;
  }

  // v1.6.4 - FIX Issue #11/#14: Log per-origin-tab breakdown for cross-tab visibility
  _logCrossTabAggregation(quickTabs, receiveTime, renderReason, correlationId);

  // v1.6.4 - FIX BUG #4: Track if transitioning to empty state for forced render
  const wasNotEmpty = _allQuickTabsFromPort.length > 0;
  const isNowEmpty = quickTabs.length === 0;

  _allQuickTabsFromPort = quickTabs;

  // v1.6.4-v3 - DEBUG: Log state received during critical refresh for transfer debugging
  // Note: Uses extracted helper to avoid adding complexity to this function
  if (_pendingCriticalStateRefresh) {
    _logCriticalRefreshStateReceived(quickTabs, renderReason, correlationId);
  }

  console.log(`[Sidebar] ${renderReason}: ${quickTabs.length} Quick Tabs`);
  updateQuickTabsStateFromPort(quickTabs);

  // v1.6.3.12-v12 - FIX Issue #48: Increment state version to ensure re-render bypasses hash check
  // This is critical for button operations where the state content may not change
  // but we still need to rebuild the DOM to clear disabled states
  _incrementStateVersion(renderReason);

  // v1.6.3.12 - Gap #7: Log Manager render triggered with correlationId
  console.log('[Sidebar] STATE_SYNC_PATH_RENDER_TRIGGERED:', {
    timestamp: Date.now(),
    source: renderReason,
    correlationId: correlationId || null,
    tabCount: quickTabs.length,
    latencyMs: Date.now() - receiveTime
  });

  // v1.6.4 - FIX BUG #4: Handle empty state transition with extracted helper
  if (_handleEmptyStateTransition(wasNotEmpty, isNowEmpty, correlationId)) {
    return;
  }

  // v1.6.4 - FIX BUG #4: Log transitions involving 1 Quick Tab for debugging
  _logLowQuickTabCount(quickTabs, wasNotEmpty, correlationId);

  // v1.6.4-v3 - FIX BUG #15d: Force immediate render if critical state refresh is pending
  if (_pendingCriticalStateRefresh) {
    _pendingCriticalStateRefresh = false;
    console.log('[Sidebar] CRITICAL_STATE_REFRESH_EXECUTING: Forcing immediate render', {
      renderReason,
      tabCount: quickTabs.length,
      timestamp: Date.now()
    });
    _forceImmediateRender('critical-state-refresh');
  } else {
    // v1.6.3.12-v4 - Gap #5: Pass correlationId to scheduleRender
    scheduleRender(renderReason, correlationId);
  }
}

/**
 * Handle Quick Tab port ACK with roundtrip time calculation
 * v1.6.3.12-v2 - FIX Issue #16-17: Log ACK with roundtrip time
 * v1.6.3.12 - Gap #8: Log correlation ID match for async tracing
 * @private
 * @param {Object} msg - ACK message from background
 * @param {string} ackType - Type of ACK (e.g., 'CLOSE', 'MINIMIZE', 'RESTORE')
 */
/**
 * Build ACK log data
 * v1.6.3.12-v7 - Extracted for complexity reduction
 * @private
 */
function _buildAckLogData(msg, sentInfo) {
  const { success, timestamp: responseTimestamp, correlationId: responseCorrelationId } = msg;
  const roundtripMs = sentInfo ? Date.now() - sentInfo.sentAt : null;
  return {
    success,
    roundtripMs,
    responseTimestamp,
    sentAt: sentInfo?.sentAt || null,
    sentCorrelationId: sentInfo?.correlationId || null,
    responseCorrelationId: responseCorrelationId || null,
    correlationMatch: sentInfo?.correlationId === responseCorrelationId
  };
}

function _handleQuickTabPortAck(msg, ackType) {
  const { quickTabId } = msg;
  const sentInfo = _quickTabPortOperationTimestamps.get(quickTabId);

  console.log(`[Sidebar] QUICK_TAB_ACK_RECEIVED: ${ackType}`, {
    quickTabId,
    ..._buildAckLogData(msg, sentInfo)
  });

  // Exit early if no quickTabId - nothing to clean up
  if (!quickTabId) return;

  // Clean up operation timestamp tracking
  _quickTabPortOperationTimestamps.delete(quickTabId);

  // v1.6.3.12-v13 - FIX Issue #48: Clear pending operation on ACK to allow future operations
  // The comment in _checkAndTrackPendingOperation says "will be cleared by OPERATION_TIMEOUT_MS or ACK"
  // but this cleanup was missing - operations were only cleared by the timeout.
  // This fix ensures buttons can be clicked again immediately after ACK.
  // ackType is always a string from the ACK handler factory (CLOSE, MINIMIZE, RESTORE)
  const action = typeof ackType === 'string' ? ackType.toLowerCase() : '';
  if (!action) return;

  const operationKey = `${action}-${quickTabId}`;
  // Set.delete() returns true if element was present and deleted
  if (PENDING_OPERATIONS.delete(operationKey)) {
    console.log('[Sidebar] PENDING_OPERATION_CLEARED_BY_ACK:', {
      operationKey,
      ackType,
      quickTabId
    });
  }
}

/**
 * Check if message is a valid object
 * v1.6.3.12-v7 - FIX Code Health: Extracted from _validateStateUpdateMessage
 * @private
 * @param {*} msg - Message to validate
 * @returns {boolean} True if message is a valid object
 */
function _isValidMessageObject(msg) {
  return msg && typeof msg === 'object';
}

/**
 * Check if quickTabs field is valid when present
 * v1.6.3.12-v7 - FIX Code Health: Extracted from _validateStateUpdateMessage
 * @private
 * @param {*} quickTabs - quickTabs field to validate
 * @returns {boolean} True if quickTabs is valid (undefined, null, or array)
 */
function _isValidQuickTabsField(quickTabs) {
  return quickTabs === undefined || quickTabs === null || Array.isArray(quickTabs);
}

/**
 * Validate individual Quick Tab object has required fields
 * v1.6.4 - FIX Issue #15: Add Quick Tab object validation
 * v1.6.4-v2 - Delegates to utils/validation.js to reduce function count
 * @private
 * @param {*} qt - Quick Tab object to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
function _validateQuickTabObject(qt) {
  return validateQuickTabObject(qt);
}

/**
 * Filter and validate Quick Tab objects array, logging invalid entries
 * v1.6.4 - FIX Issue #15: Filter out invalid Quick Tab objects before processing
 * v1.6.4.1 - FIX: Add critical warning when ALL Quick Tabs fail validation
 * @private
 * @param {Array} quickTabs - Quick Tabs array to validate
 * @param {string} messageType - Message type for logging
 * @returns {Array} Filtered array containing only valid Quick Tab objects
 */
function _filterValidQuickTabs(quickTabs, messageType) {
  if (!Array.isArray(quickTabs)) {
    // Use console.error for unexpected non-array input (likely a bug)
    console.error('[Manager] _filterValidQuickTabs: Input is not an array (unexpected)', {
      messageType,
      receivedType: typeof quickTabs,
      timestamp: Date.now()
    });
    return [];
  }

  // v1.6.4.1 - FIX: Handle empty array case explicitly
  if (quickTabs.length === 0) {
    console.log('[Manager] _filterValidQuickTabs: Empty array received (valid)', {
      messageType,
      timestamp: Date.now()
    });
    return [];
  }

  const validTabs = [];
  const invalidCount = { total: 0, reasons: {} };

  for (let i = 0; i < quickTabs.length; i++) {
    const qt = quickTabs[i];
    const validation = _validateQuickTabObject(qt);

    if (validation.valid) {
      validTabs.push(qt);
    } else {
      invalidCount.total++;
      _aggregateValidationErrors(validation.errors, invalidCount.reasons);
    }
  }

  // Log validation failures for debugging
  if (invalidCount.total > 0) {
    _logQuickTabValidationFailures(quickTabs.length, validTabs.length, invalidCount, messageType);
  }

  // v1.6.4.1 - FIX: Critical warning when ALL Quick Tabs fail validation
  if (quickTabs.length > 0 && validTabs.length === 0) {
    // Generate dynamic hint based on actual validation errors
    const errorTypes = Object.keys(invalidCount.reasons);
    console.error('[Manager] CRITICAL_VALIDATION_FAILURE: ALL Quick Tabs failed validation!', {
      messageType,
      inputCount: quickTabs.length,
      validCount: 0,
      invalidReasons: invalidCount.reasons,
      firstQuickTab: quickTabs[0],
      timestamp: Date.now(),
      hint: `Check Quick Tab object structure. Validation errors: ${errorTypes.join(', ')}`
    });
  }

  return validTabs;
}

/**
 * Aggregate validation errors into a reasons object
 * v1.6.4 - FIX Issue #15: Extracted to reduce nesting depth
 * @private
 * @param {string[]} errors - Array of error messages
 * @param {Object} reasons - Object to aggregate error counts into
 */
function _aggregateValidationErrors(errors, reasons) {
  for (const error of errors) {
    reasons[error] = (reasons[error] || 0) + 1;
  }
}

/**
 * Log Quick Tab validation failures
 * v1.6.4 - FIX Issue #15: Extracted to reduce function length
 * @private
 */
function _logQuickTabValidationFailures(totalReceived, validCount, invalidCount, messageType) {
  console.warn('[Sidebar] PORT_MESSAGE_QUICKTAB_VALIDATION_FAILURES:', {
    timestamp: Date.now(),
    messageType,
    totalReceived,
    validCount,
    invalidCount: invalidCount.total,
    invalidReasons: invalidCount.reasons
  });
}

/**
 * Log state received during critical refresh for transfer debugging
 * v1.6.4-v3 - DEBUG: Extracted to reduce complexity of _handleQuickTabsStateUpdate
 * @private
 * @param {Array} quickTabs - Quick Tabs array
 * @param {string} renderReason - Reason for render
 * @param {string|null} correlationId - Correlation ID for tracing
 */
function _logCriticalRefreshStateReceived(quickTabs, renderReason, correlationId) {
  console.log('[Sidebar] CRITICAL_REFRESH_STATE_RECEIVED:', {
    renderReason,
    quickTabCount: quickTabs.length,
    quickTabIds: quickTabs.map(qt => qt.id),
    originTabIds: quickTabs.map(qt => qt.originTabId),
    correlationId: correlationId || null,
    timestamp: Date.now()
  });
}

/**
 * Validate sequence number field
 * v1.6.4 - FIX Issue #15: Add sequence number validation
 * @private
 * @param {*} sequence - Sequence number to validate
 * @returns {boolean} True if sequence is valid (undefined/null or number)
 */
function _isValidSequenceNumber(sequence) {
  return sequence === undefined || sequence === null || typeof sequence === 'number';
}

/**
 * Validate message has required fields for state update handlers
 * v1.6.3.12-v7 - FIX Issue #9: Defensive input validation for port message handlers
 * v1.6.3.12-v7 - FIX Code Health: Extracted complex conditionals to helpers
 * v1.6.4 - FIX Issue #15: Add sequence number validation
 * @private
 * @param {Object} msg - Message to validate
 * @param {string} _handlerName - Handler name for logging (unused, for signature consistency)
 * @returns {{ valid: boolean, error?: string }}
 */
function _validateStateUpdateMessage(msg, _handlerName) {
  if (!_isValidMessageObject(msg)) {
    return { valid: false, error: 'Message is not an object' };
  }
  // quickTabs can be undefined/null (will be handled by _handleQuickTabsStateUpdate)
  // but if present, it should be an array
  if (!_isValidQuickTabsField(msg.quickTabs)) {
    return { valid: false, error: `quickTabs field is not an array (got ${typeof msg.quickTabs})` };
  }
  // v1.6.4 - FIX Issue #15: Validate sequence number
  if (!_isValidSequenceNumber(msg.sequence)) {
    return { valid: false, error: `sequence field is not a number (got ${typeof msg.sequence})` };
  }
  return { valid: true };
}

/**
 * Validate message has required fields for ACK handlers
 * v1.6.3.12-v7 - FIX Issue #9: Defensive input validation for port message handlers
 * @private
 * @param {Object} msg - Message to validate
 * @param {string} handlerName - Handler name for logging
 * @returns {{ valid: boolean, error?: string }}
 */
function _validateAckMessage(msg, handlerName) {
  if (!msg || typeof msg !== 'object') {
    return { valid: false, error: 'Message is not an object' };
  }
  // ACK messages should have success field (boolean)
  if (typeof msg.success !== 'boolean') {
    // Not a hard error - some ACKs may not have success field
    console.warn(
      `[Sidebar] PORT_MESSAGE_VALIDATION_WARN: ${handlerName} - success field missing or not boolean (got ${typeof msg.success})`
    );
  }
  return { valid: true };
}

/**
 * Log validation error for port message handlers
 * v1.6.3.12-v7 - FIX Code Health: Extracted from duplicate handler code
 * @private
 * @param {string} type - Message type
 * @param {Object} msg - Original message
 * @param {string} error - Validation error message
 */
function _logPortMessageValidationError(type, msg, error) {
  console.error('[Sidebar] PORT_MESSAGE_VALIDATION_ERROR:', {
    type,
    correlationId: msg?.correlationId || null,
    error
  });
}

/**
 * Handle successful transfer ACK - update local state and force render
 * v1.6.4 - FIX BUG #1: Extracted to reduce complexity of TRANSFER_QUICK_TAB_ACK handler
 * v1.6.4-v3 - FIX BUG #1/#2: Direct requestAllQuickTabsViaPort() call without setTimeout
 * @private
 * @param {Object} msg - ACK message with quickTabId, oldOriginTabId, newOriginTabId
 */
function _handleSuccessfulTransferAck(msg) {
  // v1.6.4 - FIX BUG #1/#2: Add logging to trace message ordering
  console.log('[Sidebar] TRANSFER_QUICK_TAB_ACK: Updating local state and forcing render', {
    quickTabId: msg.quickTabId,
    oldOriginTabId: msg.oldOriginTabId,
    newOriginTabId: msg.newOriginTabId,
    currentPortDataCount: _allQuickTabsFromPort.length,
    timestamp: Date.now(),
    message: 'Requesting fresh state immediately after ACK'
  });

  // v1.6.4-v3 - DEBUG: Log state BEFORE optimistic update for transfer debugging
  console.log('[Sidebar] TRANSFER_BEFORE_OPTIMISTIC_UPDATE:', {
    quickTabId: msg.quickTabId,
    newOriginTabId: msg.newOriginTabId,
    currentQuickTabCount: _allQuickTabsFromPort.length,
    quickTabIds: _allQuickTabsFromPort.map(qt => qt.id),
    originTabIds: _allQuickTabsFromPort.map(qt => qt.originTabId),
    timestamp: Date.now()
  });

  // Clear cache for both old and new origin tabs
  _clearTabCacheForTransfer(msg.oldOriginTabId, msg.newOriginTabId);

  // Update _allQuickTabsFromPort optimistically
  _updateLocalQuickTabOrigin(msg.quickTabId, msg.newOriginTabId);

  // v1.6.4-v3 - DEBUG: Log state AFTER optimistic update for transfer debugging
  console.log('[Sidebar] TRANSFER_AFTER_OPTIMISTIC_UPDATE:', {
    quickTabId: msg.quickTabId,
    newOriginTabId: msg.newOriginTabId,
    quickTabCount: _allQuickTabsFromPort.length,
    quickTabIds: _allQuickTabsFromPort.map(qt => qt.id),
    originTabIds: _allQuickTabsFromPort.map(qt => qt.originTabId),
    quickTabFoundInLocalState: _allQuickTabsFromPort.some(qt => qt.id === msg.quickTabId),
    timestamp: Date.now()
  });

  // Also update quickTabsState for hash consistency
  _updateQuickTabsStateOrigin(msg.quickTabId, msg.newOriginTabId);

  // Increment state version and force immediate render
  _incrementStateVersion('transfer-ack');
  _forceImmediateRender('transfer-ack-success');

  // v1.6.4-v3 - FIX BUG #15d: Set flag to force immediate render when response arrives
  _pendingCriticalStateRefresh = true;
  console.log('[Sidebar] CRITICAL_STATE_REFRESH_PENDING: Transfer ACK', {
    quickTabId: msg.quickTabId
  });

  // v1.6.4-v3 - FIX BUG #1/#2: Request fresh state immediately after transfer ACK
  // Direct call ensures we get updated state even if STATE_CHANGED broadcast is dropped.
  // Removed setTimeout(0) wrapper as it was causing inconsistent state sync.
  console.log('[Sidebar] TRANSFER_ACK_REQUESTING_FRESH_STATE:', {
    quickTabId: msg.quickTabId,
    newOriginTabId: msg.newOriginTabId,
    timestamp: Date.now()
  });
  const portRequestSuccess = requestAllQuickTabsViaPort();

  // v1.6.4-v3 - Code Review: Clear flag if port request fails to prevent unintended immediate renders
  if (!portRequestSuccess) {
    _pendingCriticalStateRefresh = false;
    console.warn('[Sidebar] CRITICAL_STATE_REFRESH_CLEARED: Port request failed', {
      quickTabId: msg.quickTabId
    });
  }
}

/**
 * Clear browser tab cache for transfer operation
 * v1.6.4 - FIX BUG #1: Extracted to reduce complexity
 * @private
 * @param {number} oldOriginTabId - Old origin tab ID
 * @param {number} newOriginTabId - New origin tab ID
 */
function _clearTabCacheForTransfer(oldOriginTabId, newOriginTabId) {
  if (oldOriginTabId) browserTabInfoCache.delete(oldOriginTabId);
  if (newOriginTabId) browserTabInfoCache.delete(newOriginTabId);
}

/**
 * Update Quick Tab's originTabId in _allQuickTabsFromPort
 * v1.6.4 - FIX BUG #1: Extracted to reduce complexity
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @param {number} newOriginTabId - New origin tab ID
 */
function _updateLocalQuickTabOrigin(quickTabId, newOriginTabId) {
  const quickTabIndex = _allQuickTabsFromPort.findIndex(qt => qt.id === quickTabId);
  if (quickTabIndex >= 0) {
    _allQuickTabsFromPort[quickTabIndex].originTabId = newOriginTabId;
    _allQuickTabsFromPort[quickTabIndex].transferredAt = Date.now();
    console.log('[Sidebar] TRANSFER_QUICK_TAB_ACK: Updated local Quick Tab originTabId', {
      quickTabId,
      newOriginTabId
    });
  } else {
    console.warn('[Sidebar] TRANSFER_QUICK_TAB_ACK: Quick Tab not found in local state', {
      quickTabId
    });
  }
}

/**
 * Update Quick Tab's originTabId in quickTabsState for hash consistency
 * v1.6.4 - FIX BUG #1: Extracted to reduce complexity
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @param {number} newOriginTabId - New origin tab ID
 */
function _updateQuickTabsStateOrigin(quickTabId, newOriginTabId) {
  if (!quickTabsState?.tabs) return;
  const stateIndex = quickTabsState.tabs.findIndex(qt => qt.id === quickTabId);
  if (stateIndex >= 0) {
    quickTabsState.tabs[stateIndex].originTabId = newOriginTabId;
    quickTabsState.tabs[stateIndex].transferredAt = Date.now();
  }
}

/**
 * Schedule safety timeout to request fresh state if STATE_CHANGED doesn't arrive
 * v1.6.4-v3 - FIX BUG #1/#2/#3: Handles edge case where sidebar port is disconnected
 * or background fails to send STATE_CHANGED after transfer/duplicate
 *
 * Note: Clearing existing timeout before setting new one is INTENTIONAL behavior.
 * Rapid successive operations (e.g., multiple transfers) should only result in
 * ONE fresh state request after the last operation, not multiple requests.
 * The fresh state request will contain ALL Quick Tabs including all transferred ones.
 *
 * @private
 * @param {string} source - Source of the operation ('transfer-ack' or 'duplicate-ack')
 * @param {string} quickTabId - Quick Tab ID for logging
 */
function _scheduleStateChangedSafetyTimeout(source, quickTabId) {
  // Clear any existing safety timeout - intentional for batching rapid operations
  if (_stateChangedSafetyTimeoutId) {
    clearTimeout(_stateChangedSafetyTimeoutId);
  }

  _stateChangedSafetyTimeoutId = setTimeout(() => {
    console.warn('[Sidebar] STATE_CHANGED_SAFETY_TIMEOUT:', {
      source,
      quickTabId,
      timeoutMs: STATE_CHANGED_SAFETY_TIMEOUT_MS,
      timestamp: Date.now(),
      message: 'STATE_CHANGED not received within timeout, requesting fresh state'
    });

    // Request fresh state from background
    requestAllQuickTabsViaPort();

    // Clear the timeout ID
    _stateChangedSafetyTimeoutId = null;
  }, STATE_CHANGED_SAFETY_TIMEOUT_MS);

  console.log('[Sidebar] STATE_CHANGED_SAFETY_TIMEOUT_SCHEDULED:', {
    source,
    quickTabId,
    timeoutMs: STATE_CHANGED_SAFETY_TIMEOUT_MS,
    timestamp: Date.now()
  });
}

/**
 * Clear the STATE_CHANGED safety timeout
 * v1.6.4-v3 - FIX BUG #1/#2/#3: Called when STATE_CHANGED is received to cancel pending request
 * @private
 */
function _clearStateChangedSafetyTimeout() {
  if (_stateChangedSafetyTimeoutId) {
    clearTimeout(_stateChangedSafetyTimeoutId);
    _stateChangedSafetyTimeoutId = null;
    console.log('[Sidebar] STATE_CHANGED_SAFETY_TIMEOUT_CLEARED:', {
      timestamp: Date.now(),
      reason: 'STATE_CHANGED received'
    });
  }
}

/**
 * Create a state update handler with validation
 * v1.6.3.12-v7 - FIX Code Health: Generic factory for state update handlers
 * v1.6.4 - FIX Issue #15: Filter invalid Quick Tab objects before processing
 * @private
 * @param {string} messageType - The message type for logging
 * @param {string} renderReason - The reason to pass to scheduleRender
 * @returns {Function} Handler function
 */
function _createStateUpdateHandler(messageType, renderReason) {
  return msg => {
    const validation = _validateStateUpdateMessage(msg, messageType);
    if (!validation.valid) {
      _logPortMessageValidationError(messageType, msg, validation.error);
      return;
    }

    // v1.6.4 - FIX Issue #15: Filter out invalid Quick Tab objects
    const validatedQuickTabs = _filterValidQuickTabs(msg.quickTabs, messageType);
    _handleQuickTabsStateUpdate(validatedQuickTabs, renderReason, msg.correlationId);
  };
}

/**
 * Create an ACK handler with validation
 * v1.6.3.12-v7 - FIX Code Health: Generic factory for ACK handlers
 * @private
 * @param {string} messageType - The message type for logging
 * @param {string} ackType - The ACK type to pass to _handleQuickTabPortAck
 * @returns {Function} Handler function
 */
function _createAckHandler(messageType, ackType) {
  return msg => {
    const validation = _validateAckMessage(msg, messageType);
    if (!validation.valid) {
      _logPortMessageValidationError(messageType, msg, validation.error);
      return;
    }
    _handleQuickTabPortAck(msg, ackType);
  };
}

/**
 * Quick Tabs port message handlers lookup table
 * v1.6.3.12-v2 - FIX Code Health: Replace switch with lookup table
 * v1.6.3.12-v2 - FIX Issue #16-17: ACK handlers now log roundtrip time
 * v1.6.3.12-v4 - Gap #5: Pass correlationId through handler chain
 * v1.6.3.12-v4 - Gap #6: Document FIFO ordering assumption
 * v1.6.3.12-v7 - FIX Issue #9: Handlers now include input validation
 * v1.6.3.12-v7 - FIX Code Health: Use factory functions to reduce duplication
 *
 * IMPORTANT - MESSAGE ORDERING ASSUMPTION (Gap #6):
 * This handler assumes that port messages arrive in FIFO (First-In-First-Out) order.
 * Per WebExtensions specification, browser.runtime.Port messaging within a single
 * extension process preserves message ordering. This is relied upon for:
 *   - State updates being applied in the order they occurred
 *   - ACKs correlating to the correct sent messages
 *   - No out-of-order state corruption
 *
 * If message ordering issues are observed in the future:
 *   1. Add sequence numbers to messages from background
 *   2. Buffer out-of-order messages and process in sequence
 *   3. Request full state sync if sequence gap detected
 *
 * @private
 */
const _portMessageHandlers = {
  // State update handlers - use factory pattern
  SIDEBAR_STATE_SYNC: _createStateUpdateHandler('SIDEBAR_STATE_SYNC', 'quick-tabs-port-sync'),
  GET_ALL_QUICK_TABS_RESPONSE: _createStateUpdateHandler(
    'GET_ALL_QUICK_TABS_RESPONSE',
    'quick-tabs-port-sync'
  ),
  STATE_CHANGED: _createStateUpdateHandler('STATE_CHANGED', 'state-changed-notification'),

  // ACK handlers - use factory pattern
  CLOSE_QUICK_TAB_ACK: _createAckHandler('CLOSE_QUICK_TAB_ACK', 'CLOSE'),
  MINIMIZE_QUICK_TAB_ACK: _createAckHandler('MINIMIZE_QUICK_TAB_ACK', 'MINIMIZE'),
  RESTORE_QUICK_TAB_ACK: _createAckHandler('RESTORE_QUICK_TAB_ACK', 'RESTORE'),

  // Close All ACK - special handler with additional logging
  CLOSE_ALL_QUICK_TABS_ACK: msg => {
    const validation = _validateAckMessage(msg, 'CLOSE_ALL_QUICK_TABS_ACK');
    if (!validation.valid) {
      _logPortMessageValidationError('CLOSE_ALL_QUICK_TABS_ACK', msg, validation.error);
      return;
    }
    console.log('[Sidebar] CLOSE_ALL_QUICK_TABS_ACK received:', {
      success: msg.success,
      closedCount: msg.closedCount || 0,
      correlationId: msg.correlationId || null,
      timestamp: Date.now()
    });
  },
  // v1.6.4 - FIX Issue #2: Handle CLOSE_MINIMIZED_QUICK_TABS_ACK from background
  CLOSE_MINIMIZED_QUICK_TABS_ACK: msg => {
    const validation = _validateAckMessage(msg, 'CLOSE_MINIMIZED_QUICK_TABS_ACK');
    if (!validation.valid) {
      _logPortMessageValidationError('CLOSE_MINIMIZED_QUICK_TABS_ACK', msg, validation.error);
      return;
    }
    console.log('[Sidebar] CLOSE_MINIMIZED_QUICK_TABS_ACK received:', {
      success: msg.success,
      closedCount: msg.closedCount || 0,
      correlationId: msg.correlationId || null,
      timestamp: Date.now()
    });
  },
  // v1.6.3.12-v7 - FIX Issue #12: Handle ORIGIN_TAB_CLOSED message when a browser tab with Quick Tabs is closed
  // This allows the Manager to detect orphaned Quick Tabs and update its UI accordingly
  ORIGIN_TAB_CLOSED: msg => {
    _handleOriginTabClosed(msg);
  },
  // v1.6.4 - FIX BUG #3: Add ACK handlers for transfer/duplicate operations
  // These ensure proper logging and prevent "unknown_type" warnings in the port handler
  // v1.6.4 - FIX BUG #1: Request fresh state after successful transfer to ensure Manager displays transferred Quick Tab
  TRANSFER_QUICK_TAB_ACK: msg => {
    console.log('[Sidebar] TRANSFER_QUICK_TAB_ACK received:', {
      success: msg.success,
      quickTabId: msg.quickTabId || null,
      oldOriginTabId: msg.oldOriginTabId || null,
      newOriginTabId: msg.newOriginTabId || null,
      error: msg.error || null,
      correlationId: msg.correlationId || null,
      timestamp: Date.now()
    });
    // v1.6.4 - FIX BUG #1: Use extracted helper to handle successful transfer
    if (msg.success && msg.quickTabId) {
      _handleSuccessfulTransferAck(msg);
    }
  },
  // v1.6.4 - FIX BUG #3: Handle duplicate ACK
  // v1.6.4 - FIX BUG #2: Force immediate render after successful duplicate
  // v1.6.4-v3 - FIX BUG #1/#2: Direct requestAllQuickTabsViaPort() call without setTimeout
  DUPLICATE_QUICK_TAB_ACK: msg => {
    console.log('[Sidebar] DUPLICATE_QUICK_TAB_ACK received:', {
      success: msg.success,
      newQuickTabId: msg.newQuickTabId || null,
      newOriginTabId: msg.newOriginTabId || null,
      error: msg.error || null,
      correlationId: msg.correlationId || null,
      currentPortDataCount: _allQuickTabsFromPort.length,
      timestamp: Date.now(),
      message: 'Requesting fresh state immediately after ACK'
    });
    // v1.6.4 - FIX BUG #2: If duplicate succeeded, increment version and force render
    if (msg.success) {
      console.log(
        '[Sidebar] DUPLICATE_QUICK_TAB_ACK: Updating state and forcing render after successful duplicate'
      );
      // Clear cache for the new origin tab
      if (msg.newOriginTabId) browserTabInfoCache.delete(msg.newOriginTabId);

      // v1.6.4 - FIX BUG #2: Increment state version and force immediate render
      _incrementStateVersion('duplicate-ack');
      _forceImmediateRender('duplicate-ack-success');

      // v1.6.4-v3 - FIX BUG #15d: Set flag to force immediate render when response arrives
      _pendingCriticalStateRefresh = true;
      console.log('[Sidebar] CRITICAL_STATE_REFRESH_PENDING: Duplicate ACK', {
        newQuickTabId: msg.newQuickTabId
      });

      // v1.6.4-v3 - FIX BUG #1/#2: Request fresh state immediately after duplicate ACK
      // Direct call ensures we get updated state even if STATE_CHANGED broadcast is dropped.
      // Removed setTimeout(0) wrapper as it was causing inconsistent state sync.
      console.log('[Sidebar] DUPLICATE_ACK_REQUESTING_FRESH_STATE:', {
        newQuickTabId: msg.newQuickTabId,
        newOriginTabId: msg.newOriginTabId,
        timestamp: Date.now()
      });
      const portRequestSuccess = requestAllQuickTabsViaPort();

      // v1.6.4-v3 - Code Review: Clear flag if port request fails to prevent unintended immediate renders
      if (!portRequestSuccess) {
        _pendingCriticalStateRefresh = false;
        console.warn('[Sidebar] CRITICAL_STATE_REFRESH_CLEARED: Port request failed', {
          newQuickTabId: msg.newQuickTabId
        });
      }
    }
  }
};

/**
 * Mark Quick Tabs as orphaned in local state
 * v1.6.3.12-v7 - FIX Code Health: Extracted to reduce complexity of ORIGIN_TAB_CLOSED handler
 * @private
 * @param {Array<string>} orphanedQuickTabIds - IDs of orphaned Quick Tabs
 * @param {number} timestamp - Timestamp when tab was closed
 */
function _markQuickTabsAsOrphaned(orphanedQuickTabIds, timestamp) {
  if (!orphanedQuickTabIds || !Array.isArray(orphanedQuickTabIds)) return;

  const orphanedIds = new Set(orphanedQuickTabIds);
  const currentTabs = quickTabsState?.tabs || [];

  for (const tab of currentTabs) {
    if (orphanedIds.has(tab.id)) {
      tab.isOrphaned = true;
      tab.orphanedAt = timestamp;
    }
  }
}

/**
 * Handle ORIGIN_TAB_CLOSED message
 * v1.6.3.12-v7 - FIX Code Health: Extracted to reduce complexity
 * v1.6.3.12-v7 - FIX Code Review: Added input validation
 * @private
 * @param {Object} msg - Message from background
 */
/**
 * Validate origin tab closed message
 * v1.6.3.12-v7 - FIX Code Health: Extracted to reduce _handleOriginTabClosed complexity
 * @private
 * @param {Object} msg - Message to validate
 * @returns {boolean} True if message is valid
 */
function _validateOriginTabClosedMessage(msg) {
  if (!_isValidMessageObject(msg)) {
    console.error('[Sidebar] ORIGIN_TAB_CLOSED_VALIDATION_ERROR: Message is not an object');
    return false;
  }

  if (typeof msg.originTabId !== 'number') {
    console.warn('[Sidebar] ORIGIN_TAB_CLOSED_VALIDATION_WARN: originTabId is not a number', {
      received: typeof msg.originTabId
    });
  }

  return true;
}

/**
 * Log origin tab closed message
 * v1.6.3.12-v7 - FIX Code Health: Extracted to reduce _handleOriginTabClosed complexity
 * @private
 * @param {Object} msg - Message to log
 * @param {number} timestamp - Timestamp
 */
function _logOriginTabClosed(msg, timestamp) {
  console.log('[Sidebar] ORIGIN_TAB_CLOSED received:', {
    originTabId: msg.originTabId,
    orphanedCount: msg.orphanedCount || 0,
    orphanedQuickTabIds: msg.orphanedQuickTabIds || [],
    timestamp,
    correlationId: msg?.correlationId || null
  });
}

/**
 * Handle ORIGIN_TAB_CLOSED message
 * v1.6.3.12-v7 - FIX Code Health: Extracted to reduce complexity
 * v1.6.3.12-v7 - FIX Code Review: Added input validation
 * v1.6.3.12-v7 - FIX Code Health: Extracted validation and logging helpers
 * v1.6.4 - FIX Issue #17: Invalidate browserTabInfoCache when origin tab closes
 * @private
 * @param {Object} msg - Message from background
 */
function _handleOriginTabClosed(msg) {
  if (!_validateOriginTabClosedMessage(msg)) {
    return;
  }

  const timestamp = msg.timestamp || Date.now();
  _logOriginTabClosed(msg, timestamp);

  // v1.6.4 - FIX Issue #17: Invalidate cache for the closed tab
  if (typeof msg.originTabId === 'number') {
    const cacheHadEntry = browserTabInfoCache.has(msg.originTabId);
    browserTabInfoCache.delete(msg.originTabId);

    console.log('[Sidebar] BROWSER_TAB_CACHE_INVALIDATED:', {
      timestamp,
      originTabId: msg.originTabId,
      reason: 'ORIGIN_TAB_CLOSED received',
      cacheHadEntry,
      remainingCacheSize: browserTabInfoCache.size
    });
  }

  // Mark affected Quick Tabs as orphaned in local state
  _markQuickTabsAsOrphaned(msg.orphanedQuickTabIds, timestamp);

  // Request fresh state from background to ensure consistency
  requestAllQuickTabsViaPort();

  // Schedule re-render to update UI with orphan indicators
  scheduleRender('origin-tab-closed', msg?.correlationId);
}

/**
 * Log port handler entry with all context
 * v1.6.3.12-v7 - FIX Code Health: Extracted to reduce handleQuickTabsPortMessage complexity
 * @private
 * @param {Object} params - Entry log parameters
 */
function _logPortHandlerEntry({
  type,
  correlationId,
  entryTimestamp,
  msgTimestamp,
  payloadSize,
  sequence,
  sequenceStatus
}) {
  console.log(
    `[PORT_HANDLER_ENTRY] type=${type}, correlationId=${correlationId || 'none'}, timestamp=${entryTimestamp}`,
    {
      type,
      correlationId: correlationId || null,
      timestamp: entryTimestamp,
      messageTimestamp: msgTimestamp || null,
      payloadSize,
      source: 'background',
      sequence: sequence ?? null,
      expectedSequence: _lastReceivedSequence + 1,
      sequenceStatus
    }
  );
}

/**
 * Log port handler exit with outcome and timing
 * v1.6.3.12-v7 - FIX Code Health: Extracted to reduce handleQuickTabsPortMessage complexity
 * @private
 * @param {Object} params - Exit log parameters
 */
function _logPortHandlerExit({ type, correlationId, outcome, durationMs, errorMessage }) {
  const exitLogData = {
    type,
    correlationId: correlationId || null,
    outcome,
    durationMs: durationMs.toFixed(2)
  };
  if (errorMessage) {
    exitLogData.error = errorMessage;
  }
  console.log(
    `[PORT_HANDLER_EXIT] type=${type}, outcome=${outcome}, durationMs=${durationMs.toFixed(2)}`,
    exitLogData
  );
}

/**
 * Execute port message handler with error handling
 * v1.6.3.12-v7 - FIX Code Health: Extracted to reduce handleQuickTabsPortMessage complexity
 * @private
 * @param {Function|undefined} handler - Handler function
 * @param {Object} message - Port message
 * @param {string} type - Message type
 * @param {string|null} correlationId - Correlation ID
 * @returns {{ outcome: string, errorMessage: string|null }}
 */
function _executePortHandler(handler, message, type, correlationId) {
  if (!handler) {
    return { outcome: 'unknown_type', errorMessage: null };
  }

  try {
    handler(message);
    return { outcome: 'success', errorMessage: null };
  } catch (err) {
    console.error('[Sidebar] PORT_MESSAGE_HANDLER_ERROR:', {
      type,
      correlationId: correlationId || null,
      error: err.message
    });
    return { outcome: 'error', errorMessage: err.message };
  }
}

/**
 * Handle messages from Quick Tabs port
 * v1.6.3.12-v2 - FIX Code Health: Use lookup table instead of switch
 * v1.6.3.12-v2 - FIX Issue #16-17: Enhanced port message logging
 * v1.6.3.12 - Gap #3: Port message handler entry/exit logging
 * v1.6.3.12-v5 - FIX Issue #7: Use performance.now() for accurate duration
 * v1.6.3.12-v7 - FIX Issue #13: Add sequence number tracking for FIFO ordering detection
 * v1.6.3.12-v7 - FIX Code Health: Refactored to reduce complexity
 * @param {Object} message - Message from background
 */
function handleQuickTabsPortMessage(message) {
  const { type, timestamp: msgTimestamp, correlationId, sequence } = message;
  const handlerStartTime = performance.now();
  const entryTimestamp = Date.now();

  // v1.6.3.12-v7 - FIX Issue #13: Check message sequence for out-of-order detection
  const sequenceCheckResult = _checkMessageSequence(sequence, type, correlationId);

  // v1.6.3.12-v7 - FIX Code Health: Extracted entry logging
  _logPortHandlerEntry({
    type,
    correlationId,
    entryTimestamp,
    msgTimestamp,
    payloadSize: JSON.stringify(message).length,
    sequence,
    sequenceStatus: sequenceCheckResult.status
  });

  // v1.6.3.12-v7 - FIX Code Health: Extracted handler execution
  const handler = _portMessageHandlers[type];
  const { outcome, errorMessage } = _executePortHandler(handler, message, type, correlationId);

  // v1.6.3.12-v7 - FIX Code Health: Extracted exit logging
  const durationMs = performance.now() - handlerStartTime;
  _logPortHandlerExit({ type, correlationId, outcome, durationMs, errorMessage });
}

/**
 * Check message sequence number for FIFO ordering detection
 * v1.6.3.12-v7 - FIX Issue #13: Detect out-of-order messages and request state sync
 * v1.6.3.12-v7 - FIX Code Health: Extracted helpers to reduce complexity
 * @private
 * @param {number|undefined} sequence - Message sequence number from background
 * @param {string} type - Message type for logging
 * @param {string|null} correlationId - Correlation ID for logging
 * @returns {{ status: string, isOutOfOrder: boolean }}
 */
function _checkMessageSequence(sequence, type, correlationId) {
  // If sequence number is not provided, skip checking (backward compatibility)
  if (sequence === undefined || sequence === null) {
    return { status: 'no_sequence', isOutOfOrder: false };
  }

  const expectedSequence = _lastReceivedSequence + 1;
  const isOutOfOrder = sequence !== expectedSequence && _lastReceivedSequence > 0;

  if (isOutOfOrder) {
    return _handleOutOfOrderSequence(sequence, expectedSequence, type, correlationId);
  }

  // Update last received sequence
  _updateLastReceivedSequence(sequence);

  return { status: 'in_order', isOutOfOrder: false };
}

/**
 * Handle out-of-order sequence detection
 * v1.6.3.12-v7 - FIX Code Health: Extracted from _checkMessageSequence
 * @private
 * @param {number} sequence - Received sequence
 * @param {number} expectedSequence - Expected sequence
 * @param {string} type - Message type
 * @param {string|null} correlationId - Correlation ID
 * @returns {{ status: string, isOutOfOrder: boolean }}
 */
function _handleOutOfOrderSequence(sequence, expectedSequence, type, correlationId) {
  _sequenceGapsDetected++;

  _logOutOfOrderSequence(sequence, expectedSequence, type, correlationId);

  // Only trigger sync for significant gaps (not just duplicate messages)
  if (sequence > expectedSequence) {
    _lastReceivedSequence = sequence;
    _triggerSequenceGapRecovery(type, correlationId);
  }

  return { status: 'out_of_order', isOutOfOrder: true };
}

/**
 * Log out-of-order sequence warning
 * v1.6.3.12-v7 - FIX Code Health: Extracted from _checkMessageSequence
 * @private
 * @param {number} sequence - Received sequence
 * @param {number} expectedSequence - Expected sequence
 * @param {string} type - Message type
 * @param {string|null} correlationId - Correlation ID
 */
function _logOutOfOrderSequence(sequence, expectedSequence, type, correlationId) {
  if (!SEQUENCE_GAP_WARNING_ENABLED) {
    return;
  }

  console.warn('[Sidebar] PORT_MESSAGE_OUT_OF_ORDER:', {
    timestamp: Date.now(),
    type,
    correlationId: correlationId || null,
    expectedSequence,
    actualSequence: sequence,
    gap: sequence - expectedSequence,
    totalGapsDetected: _sequenceGapsDetected,
    message: `Expected sequence ${expectedSequence}, received ${sequence}`,
    recoveryAction: 'requesting_full_state_sync'
  });
}

/**
 * Update last received sequence number
 * v1.6.3.12-v7 - FIX Code Health: Extracted from _checkMessageSequence
 * @private
 * @param {number} sequence - New sequence number
 */
function _updateLastReceivedSequence(sequence) {
  if (sequence > _lastReceivedSequence) {
    _lastReceivedSequence = sequence;
  }
}

/**
 * Trigger recovery from sequence gap by requesting full state sync
 * v1.6.3.12-v7 - FIX Issue #13: Request full state sync to recover from sequence gaps
 * @private
 * @param {string} type - Message type that triggered gap detection
 * @param {string|null} correlationId - Correlation ID for logging
 */
function _triggerSequenceGapRecovery(type, correlationId) {
  console.log('[Sidebar] SEQUENCE_GAP_RECOVERY_TRIGGERED:', {
    timestamp: Date.now(),
    triggeringMessageType: type,
    correlationId: correlationId || null,
    totalGapsDetected: _sequenceGapsDetected,
    action: 'requesting_full_state_sync'
  });

  // Request full state sync to ensure we have consistent state
  requestAllQuickTabsViaPort();
}

/**
 * Update internal Quick Tabs state from port data
 * v1.6.3.12 - Option 4: Sync internal state with port data
 * @param {Array} quickTabs - Quick Tabs array from background
 */
function updateQuickTabsStateFromPort(quickTabs) {
  // Convert to the format expected by the UI
  const tabsForState = quickTabs.map(qt => ({
    ...qt,
    // Ensure required fields exist
    id: qt.id,
    originTabId: qt.originTabId,
    url: qt.url,
    minimized: qt.minimized || false
  }));

  // Update quickTabsState
  quickTabsState = {
    tabs: tabsForState,
    timestamp: Date.now(),
    saveId: `port-sync-${Date.now()}`
  };

  // Update in-memory cache
  inMemoryTabsCache = tabsForState;
  lastKnownGoodTabCount = tabsForState.length;
  lastLocalUpdateTime = Date.now();
  lastCacheSyncFromStorage = Date.now();
  lastEventReceivedTime = Date.now();

  console.log('[Sidebar] Quick Tabs state updated from port:', {
    tabCount: tabsForState.length,
    timestamp: quickTabsState.timestamp
  });
}

/**
 * Request Quick Tab close via port
 * v1.6.3.12 - Option 4: Send close command to background
 * @param {string} quickTabId - Quick Tab ID to close
 */
// ==================== v1.6.3.12-v2 SIDEBAR PORT OPERATION HELPER ====================
/**
 * Generate correlation ID for port operations
 * v1.6.3.12 - Gap #8: Correlation IDs for async operations
 * @private
 * @returns {string} Unique correlation ID
 */
function _generatePortCorrelationId() {
  return `port-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Execute sidebar port operation with error handling
 * v1.6.3.12-v2 - FIX Code Health: Generic port operation wrapper
 * v1.6.3.12-v2 - FIX Issue #16-17: Track sent timestamps for roundtrip calculation
 * v1.6.3.12 - Gap #8: Add correlation IDs to port messages
 * v1.6.4 - ADD fallback messaging: Add browser.runtime.sendMessage fallback
 * @private
 * @param {string} messageType - Type of message to send
 * @param {Object} [payload={}] - Optional message payload
 * @returns {boolean} Success status (true if port send succeeded, fallback is fire-and-forget)
 */
function _executeSidebarPortOperation(messageType, payload = {}) {
  const sentAt = Date.now();
  // v1.6.3.12 - Gap #8: Generate correlation ID for tracking
  const correlationId = _generatePortCorrelationId();

  const message = {
    type: messageType,
    ...payload,
    timestamp: sentAt,
    correlationId
  };

  // v1.6.3.12-v2 - FIX Issue #16-17: Track sent timestamp for ACK roundtrip calculation
  const quickTabId = payload.quickTabId || null;
  if (quickTabId) {
    _quickTabPortOperationTimestamps.set(quickTabId, {
      sentAt,
      messageType,
      correlationId // v1.6.3.12 - Gap #8: Store correlationId for matching
    });
  }

  let portSucceeded = false;

  // v1.6.4 - ADD fallback messaging: Try port first if available
  if (quickTabsPort) {
    try {
      quickTabsPort.postMessage(message);
      portSucceeded = true;
      console.log(`[Sidebar] QUICK_TAB_PORT_MESSAGE_SENT: ${messageType}`, {
        quickTabId,
        timestamp: sentAt,
        method: 'port',
        hasRoundtripTracking: !!quickTabId
      });
    } catch (err) {
      console.warn(`[Sidebar] Port send failed for ${messageType}, trying fallback:`, err.message);
    }
  } else {
    console.warn(`[Sidebar] Cannot ${messageType} via port - not connected, trying fallback`);
  }

  // v1.6.4 - FIX BUG #1: Only use fallback when port fails or is unavailable
  if (portSucceeded) {
    // Port succeeded, no fallback needed
    return true;
  }

  // Port failed or unavailable, try fallback
  browser.runtime
    .sendMessage({
      ...message,
      source: 'sendMessage_fallback'
    })
    .then(() => {
      console.log(`[Sidebar] ${messageType} sent via runtime.sendMessage fallback`, {
        quickTabId
      });
    })
    .catch(sendErr => {
      console.error(`[Sidebar] ${messageType} both port and fallback failed:`, {
        quickTabId,
        error: sendErr.message
      });
    });

  return false;
}

/**
 * Request Quick Tab close via port
 * v1.6.3.12-v2 - FIX Code Health: Use generic wrapper
 * v1.6.3.12-v9 - FIX Issue #1: Add comprehensive logging for button operations
 * @param {string} quickTabId - Quick Tab ID to close
 */
function closeQuickTabViaPort(quickTabId) {
  const timestamp = Date.now();
  console.log('[Manager] CLOSE_QUICK_TAB_VIA_PORT_CALLED:', {
    quickTabId,
    timestamp,
    portConnected: !!quickTabsPort,
    portCircuitBreakerTripped: _quickTabsPortCircuitBreakerTripped
  });

  const result = _executeSidebarPortOperation('CLOSE_QUICK_TAB', { quickTabId });

  console.log('[Manager] CLOSE_QUICK_TAB_VIA_PORT_RESULT:', {
    quickTabId,
    success: result,
    timestamp: Date.now(),
    roundtripStarted: result
  });

  return result;
}

/**
 * Request Quick Tab minimize via port
 * v1.6.3.12-v2 - FIX Code Health: Use generic wrapper
 * v1.6.3.12-v9 - FIX Issue #10: Add comprehensive logging for minimize operations
 * @param {string} quickTabId - Quick Tab ID to minimize
 */
function minimizeQuickTabViaPort(quickTabId) {
  const timestamp = Date.now();
  console.log('[Manager] MINIMIZE_QUICK_TAB_VIA_PORT_CALLED:', {
    quickTabId,
    timestamp,
    portConnected: !!quickTabsPort,
    portCircuitBreakerTripped: _quickTabsPortCircuitBreakerTripped
  });

  const result = _executeSidebarPortOperation('MINIMIZE_QUICK_TAB', { quickTabId });

  console.log('[Manager] MINIMIZE_QUICK_TAB_VIA_PORT_RESULT:', {
    quickTabId,
    success: result,
    timestamp: Date.now(),
    roundtripStarted: result
  });

  return result;
}

/**
 * Request Quick Tab restore via port
 * v1.6.3.12-v2 - FIX Code Health: Use generic wrapper
 * v1.6.3.12-v9 - FIX Issue #10: Add comprehensive logging for restore operations
 * @param {string} quickTabId - Quick Tab ID to restore
 */
function restoreQuickTabViaPort(quickTabId) {
  const timestamp = Date.now();
  console.log('[Manager] RESTORE_QUICK_TAB_VIA_PORT_CALLED:', {
    quickTabId,
    timestamp,
    portConnected: !!quickTabsPort,
    portCircuitBreakerTripped: _quickTabsPortCircuitBreakerTripped
  });

  const result = _executeSidebarPortOperation('RESTORE_QUICK_TAB', { quickTabId });

  console.log('[Manager] RESTORE_QUICK_TAB_VIA_PORT_RESULT:', {
    quickTabId,
    success: result,
    timestamp: Date.now(),
    roundtripStarted: result
  });

  return result;
}

/**
 * Request all Quick Tabs via port
 * v1.6.3.12-v2 - FIX Code Health: Use generic wrapper
 * v1.6.4 - FIX Issue #14: Add comprehensive logging for cross-tab state request
 */
function requestAllQuickTabsViaPort() {
  const timestamp = Date.now();

  // v1.6.4 - FIX Issue #14: Log request for cross-tab state
  console.log('[Sidebar] GET_ALL_QUICK_TABS_REQUEST:', {
    timestamp,
    portConnected: !!quickTabsPort,
    portCircuitBreakerTripped: _quickTabsPortCircuitBreakerTripped,
    currentCachedTabCount: _allQuickTabsFromPort.length,
    message: 'Requesting ALL Quick Tabs from ALL browser tabs'
  });

  const result = _executeSidebarPortOperation('GET_ALL_QUICK_TABS');

  // v1.6.4 - FIX Issue #14: Log request result
  console.log('[Sidebar] GET_ALL_QUICK_TABS_REQUEST_RESULT:', {
    timestamp: Date.now(),
    success: result,
    roundtripStarted: result,
    message: result ? 'Request sent, awaiting GET_ALL_QUICK_TABS_RESPONSE' : 'Request failed'
  });

  return result;
}

/**
 * Request close all Quick Tabs via port
 * v1.6.4 - FIX Issue #2: Implement bulk close operation for Manager header button
 * v1.6.3.12-v9 - FIX Issue #2: Add comprehensive logging for Close All operation
 * @returns {boolean} Success status
 */
function closeAllQuickTabsViaPort() {
  const timestamp = Date.now();
  const quickTabCount = _allQuickTabsFromPort.length;

  console.log('[Manager] CLOSE_ALL_QUICK_TABS_VIA_PORT_CALLED:', {
    timestamp,
    currentQuickTabCount: quickTabCount,
    portConnected: !!quickTabsPort,
    portCircuitBreakerTripped: _quickTabsPortCircuitBreakerTripped,
    quickTabIds: _allQuickTabsFromPort.map(qt => qt.id)
  });

  const result = _executeSidebarPortOperation('CLOSE_ALL_QUICK_TABS');

  console.log('[Manager] CLOSE_ALL_QUICK_TABS_VIA_PORT_RESULT:', {
    success: result,
    timestamp: Date.now(),
    quickTabsToClose: quickTabCount,
    roundtripStarted: result
  });

  return result;
}

/**
 * Request close only minimized Quick Tabs via port
 * v1.6.4 - FIX Issue #2: Implement bulk close minimized operation for Manager header button
 * v1.6.3.12-v9 - FIX Issue #3: Add comprehensive logging for Close Minimized operation
 * @returns {boolean} Success status
 */
function closeMinimizedQuickTabsViaPort() {
  const timestamp = Date.now();
  const minimizedTabs = _allQuickTabsFromPort.filter(qt => qt.minimized);
  const minimizedCount = minimizedTabs.length;

  console.log('[Manager] CLOSE_MINIMIZED_QUICK_TABS_VIA_PORT_CALLED:', {
    timestamp,
    minimizedCount,
    totalQuickTabCount: _allQuickTabsFromPort.length,
    portConnected: !!quickTabsPort,
    portCircuitBreakerTripped: _quickTabsPortCircuitBreakerTripped,
    minimizedQuickTabIds: minimizedTabs.map(qt => qt.id)
  });

  const result = _executeSidebarPortOperation('CLOSE_MINIMIZED_QUICK_TABS');

  console.log('[Manager] CLOSE_MINIMIZED_QUICK_TABS_VIA_PORT_RESULT:', {
    success: result,
    timestamp: Date.now(),
    minimizedTabsToClose: minimizedCount,
    roundtripStarted: result
  });

  return result;
}

// ==================== END v1.6.3.12 OPTION 4 QUICK TABS PORT ====================

// ==================== v1.6.3.6-v12 HEARTBEAT MECHANISM ====================
// FIX Issue #2, #4: Heartbeat to prevent Firefox 30s background script termination
// v1.6.3.10-v1 - FIX Issue #5: Reduced interval for better margin

/**
 * Heartbeat interval (15 seconds - Firefox idle timeout is 30s)
 * v1.6.3.10-v1 - FIX Issue #5: Reduced from 25s to 15s for 15s safety margin
 */
const HEARTBEAT_INTERVAL_MS = 15000;

/**
 * Maximum heartbeat interval for adaptive backoff
 * v1.6.3.10-v1 - FIX Issue #5: Never exceed 20s even with network latency
 */
const HEARTBEAT_INTERVAL_MAX_MS = 20000;

/**
 * Heartbeat timeout (2 seconds)
 * v1.6.3.10-v1 - FIX Issue #5: Reduced from 5s to 2s for faster failure detection
 */
const HEARTBEAT_TIMEOUT_MS = 2000;

/**
 * Heartbeat interval ID
 * v1.6.3.6-v12 - FIX Issue #4: Track interval for cleanup
 */
let heartbeatIntervalId = null;

/**
 * Last heartbeat response time
 * v1.6.3.6-v12 - FIX Issue #4: Track background responsiveness
 */
let lastHeartbeatResponse = Date.now();

/**
 * Consecutive heartbeat failures
 * v1.6.3.6-v12 - FIX Issue #4: Track for reconnection
 */
let consecutiveHeartbeatFailures = 0;
const MAX_HEARTBEAT_FAILURES = 2;

// ==================== v1.6.3.7 CIRCUIT BREAKER STATE ====================
// FIX Issue #5: Port Reconnect Circuit Breaker to prevent thundering herd
/**
 * Circuit breaker state
 * v1.6.3.7 - FIX Issue #5: Prevent thundering herd on reconnect
 * States: 'closed' (connected), 'open' (not trying), 'half-open' (attempting)
 * v1.6.3.10-v2 - FIX Issue #4: Added sliding window tracking and action queue
 */
let circuitBreakerState = 'closed';
let circuitBreakerOpenTime = 0;
let reconnectAttempts = 0;
let reconnectBackoffMs = RECONNECT_BACKOFF_INITIAL_MS;

// v1.6.3.10-v2 - FIX Issue #4: Sliding window failure tracking
/**
 * Track failure timestamps for sliding window analysis
 * v1.6.3.10-v2 - FIX Issue #4: Only failures within CIRCUIT_BREAKER_SLIDING_WINDOW_MS count
 * @type {number[]}
 */
let failureTimestamps = [];

// v1.6.3.10-v2 - FIX Issue #4: Action queue for operations during circuit open
/**
 * Queue user actions during circuit breaker open state
 * v1.6.3.10-v2 - FIX Issue #4: Actions are flushed on successful reconnect
 * @type {Array<{action: string, payload: Object, timestamp: number}>}
 */
let pendingActionQueue = [];
const MAX_PENDING_ACTIONS = 50; // Prevent queue from growing unbounded

/**
 * Failure reason classification
 * v1.6.3.10-v2 - FIX Issue #4: Different failure types have different handling
 */
const FAILURE_REASON = {
  TRANSIENT: 'transient', // Network blip - exponential backoff
  ZOMBIE_PORT: 'zombie-port', // Port dead - immediate reconnect, no count
  BACKGROUND_DEAD: 'background-dead' // Background unloaded - request state sync on reconnect
};

// ==================== v1.6.3.10-v1 PORT STATE MACHINE ====================
// FIX Issue #2: Explicit port state tracking for zombie detection
/**
 * Port connection state machine
 * v1.6.3.10-v1 - FIX Issue #2: Track port viability explicitly
 * States: 'connected', 'zombie', 'reconnecting', 'dead'
 */
let portState = 'dead';

/**
 * Timestamp of last successful port message
 * v1.6.3.10-v1 - FIX Issue #2: Track for zombie detection
 */
let lastSuccessfulPortMessage = 0;

/**
 * Current adaptive heartbeat interval
 * v1.6.3.10-v1 - FIX Issue #5: Adaptive backoff based on network latency
 */
let currentHeartbeatInterval = HEARTBEAT_INTERVAL_MS;

// ==================== v1.6.3.7 RENDER DEBOUNCE STATE ====================
// FIX Issue #3: UI Flicker Prevention
// v1.6.3.10-v2 - FIX Issue #1: Added sliding-window debounce state
let renderDebounceTimer = null;
let lastRenderedHash = 0;
let pendingRenderUI = false;

// v1.6.3.10-v2 - FIX Issue #1: Sliding-window debounce tracking
let debounceStartTimestamp = 0; // When the debounce window started
let debounceExtensionCount = 0; // How many times we've extended the debounce

// v1.6.4 - FIX Issue #19: Render lock to prevent concurrent render calls
let _isRenderInProgress = false;
let _pendingRerenderRequested = false;
// v1.6.4 - Code Review: Add counter to prevent infinite re-render loops
let _consecutiveRerenderCount = 0;
const MAX_CONSECUTIVE_RERENDERS = 3; // Limit re-renders to prevent infinite loops

/**
 * Generate correlation ID for message acknowledgment
 * v1.6.3.6-v11 - FIX Issue #10: Correlation tracking
 * @returns {string} Unique correlation ID
 */
function generateCorrelationId() {
  return `corr-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Generate correlation ID for Manager operations
 * v1.6.3.12-v7 - FIX Code Review: Centralized correlation ID generation for operations
 * @param {string} operation - Operation type (e.g., 'min', 'restore', 'close', 'adopt')
 * @param {string} quickTabId - Quick Tab ID
 * @returns {string} Correlation ID for the operation
 */
function generateOperationCorrelationId(operation, quickTabId) {
  return `${operation}-${quickTabId}-${Date.now()}`;
}

/**
 * Log port lifecycle event with comprehensive context
 * v1.6.3.6-v11 - FIX Issue #12: Port lifecycle logging
 * v1.6.3.10-v1 - FIX Issue #6: Enhanced structured logging with state transitions
 * @param {string} event - Event name (CONNECT, DISCONNECT, ZOMBIE_DETECTED, etc.)
 * @param {Object} details - Event details
 */
function logPortLifecycle(event, details = {}) {
  const logEntry = {
    event,
    tabId: currentBrowserTabId,
    portId: backgroundPort?._portId,
    portState,
    circuitBreakerState,
    timestamp: Date.now(),
    timeSinceLastSuccess:
      lastSuccessfulPortMessage > 0 ? Date.now() - lastSuccessfulPortMessage : null,
    ...details
  };

  // v1.6.3.10-v1 - FIX Issue #6: Use appropriate log level based on event
  const errorEvents = ['ZOMBIE_DETECTED', 'HEARTBEAT_TIMEOUT', 'MESSAGE_TIMEOUT', 'CIRCUIT_OPEN'];
  const warnEvents = ['DISCONNECT', 'RECONNECT_ATTEMPT_N'];

  if (errorEvents.includes(event)) {
    console.error(`[Manager] PORT_LIFECYCLE [sidebar] [${event}]:`, logEntry);
  } else if (warnEvents.includes(event)) {
    console.warn(`[Manager] PORT_LIFECYCLE [sidebar] [${event}]:`, logEntry);
  } else {
    console.log(`[Manager] PORT_LIFECYCLE [sidebar] [${event}]:`, logEntry);
  }
}

/**
 * Log port state transition
 * v1.6.3.10-v1 - FIX Issue #6: Track all state transitions with context
 * @param {string} fromState - Previous state
 * @param {string} toState - New state
 * @param {string} reason - Reason for transition
 * @param {Object} context - Additional context
 */
function logPortStateTransition(fromState, toState, reason, context = {}) {
  const logEntry = {
    transition: `${fromState} → ${toState}`,
    reason,
    portId: backgroundPort?._portId,
    circuitBreakerState,
    reconnectAttempts,
    timestamp: Date.now(),
    ...context
  };

  console.log('[Manager] PORT_STATE_TRANSITION:', logEntry);

  // Update port state
  portState = toState;
}

/**
 * Connect to background script via persistent port
 * v1.6.3.6-v11 - FIX Issue #11: Establish persistent connection
 * v1.6.3.6-v12 - FIX Issue #2, #4: Start heartbeat on connect
 * v1.6.3.7 - FIX Issue #5: Implement circuit breaker with exponential backoff
 * v1.6.3.10-v1 - FIX Issue #2: Port state machine tracking
 * v1.6.3.10-v2 - FIX Issue #4: Flush pending action queue on successful reconnect
 */
function connectToBackground() {
  const previousState = portState;

  // v1.6.3.7 - FIX Issue #5: Check circuit breaker state
  if (circuitBreakerState === 'open') {
    const timeSinceOpen = Date.now() - circuitBreakerOpenTime;
    if (timeSinceOpen < CIRCUIT_BREAKER_OPEN_DURATION_MS) {
      logPortLifecycle('CIRCUIT_OPEN', {
        timeRemainingMs: CIRCUIT_BREAKER_OPEN_DURATION_MS - timeSinceOpen,
        recoveryAction: 'waiting for cooldown'
      });
      return;
    }
    // Transition to half-open state
    logPortStateTransition(portState, 'reconnecting', 'circuit breaker cooldown expired');
    circuitBreakerState = 'half-open';
    logPortLifecycle('CIRCUIT_HALF_OPEN', { attemptingReconnect: true });
  }

  // v1.6.3.10-v1 - FIX Issue #2: Update port state to reconnecting
  logPortStateTransition(previousState, 'reconnecting', 'connection attempt starting');

  try {
    backgroundPort = browser.runtime.connect({
      name: 'quicktabs-sidebar'
    });

    logPortLifecycle('CONNECT', { portName: backgroundPort.name });

    // Handle messages from background
    backgroundPort.onMessage.addListener(handlePortMessage);

    // Handle disconnect
    backgroundPort.onDisconnect.addListener(() => {
      const error = browser.runtime.lastError;
      logPortLifecycle('DISCONNECT', {
        error: error?.message,
        recoveryAction: 'scheduling reconnect'
      });

      // v1.6.3.10-v1 - FIX Issue #2: Update port state
      logPortStateTransition(portState, 'dead', `disconnected: ${error?.message || 'unknown'}`);
      backgroundPort = null;

      // v1.6.3.6-v12 - FIX Issue #4: Stop heartbeat on disconnect
      stopHeartbeat();

      // v1.6.3.7 - FIX Issue #5: Implement exponential backoff reconnection
      scheduleReconnect();
    });

    // v1.6.3.10-v1 - FIX Issue #2: Mark port as connected
    logPortStateTransition('reconnecting', 'connected', 'connection established successfully');
    lastSuccessfulPortMessage = Date.now();

    // v1.6.3.7 - FIX Issue #5: Reset circuit breaker on successful connect
    circuitBreakerState = 'closed';
    reconnectAttempts = 0;
    reconnectBackoffMs = RECONNECT_BACKOFF_INITIAL_MS;

    // v1.6.3.10-v2 - FIX Issue #4: Clear sliding window failures on successful connect
    failureTimestamps = [];

    // v1.6.3.10-v1 - FIX Issue #5: Reset adaptive heartbeat interval
    currentHeartbeatInterval = HEARTBEAT_INTERVAL_MS;

    // v1.6.3.6-v12 - FIX Issue #2, #4: Start heartbeat mechanism
    // v1.6.3.12-v7 - FIX Issue #14: Explicitly restart heartbeat after reconnection
    console.log('[Manager] Starting heartbeat after reconnection', {
      timestamp: Date.now(),
      previousHeartbeatState: heartbeatIntervalId ? 'running' : 'stopped',
      interval: currentHeartbeatInterval
    });
    startHeartbeat();

    // v1.6.3.12-v7 - FIX Issue E: Request full state sync after reconnection
    // This ensures Manager has latest state after any disconnection
    _requestFullStateSync();

    // v1.6.3.10-v2 - FIX Issue #4: Flush pending action queue on successful reconnect
    _flushPendingActionQueue();

    console.log('[Manager] v1.6.3.10-v2 Port connection established with action queue flush');
  } catch (err) {
    console.error('[Manager] Failed to connect to background:', err.message);
    logPortLifecycle('CONNECT_ERROR', {
      error: err.message,
      recoveryAction: 'scheduling reconnect'
    });
    logPortStateTransition(portState, 'dead', `connection failed: ${err.message}`);

    // v1.6.3.7 - FIX Issue #5: Handle connection failure
    handleConnectionFailure();
  }
}

/**
 * Schedule reconnection with exponential backoff
 * v1.6.3.7 - FIX Issue #5: Exponential backoff for port reconnection
 * v1.6.3.10-v1 - FIX Issue #2: Zombie detection bypasses circuit breaker delay
 * v1.6.3.10-v2 - FIX Issue #4: Sliding-window failure tracking
 * @param {string} [failureReason=FAILURE_REASON.TRANSIENT] - Reason for failure
 */
function scheduleReconnect(failureReason = FAILURE_REASON.TRANSIENT) {
  // v1.6.3.10-v2 - FIX Issue #4: Zombie port doesn't count toward failures
  if (failureReason === FAILURE_REASON.ZOMBIE_PORT) {
    logPortLifecycle('RECONNECT_ZOMBIE_BYPASS', {
      reason: 'zombie port detection - bypassing failure count',
      failureTimestampsCount: failureTimestamps.length
    });
    // Don't increment failure count for zombie ports - reconnect immediately
    setTimeout(() => {
      console.log('[Manager] Attempting reconnect after zombie detection');
      connectToBackground();
    }, RECONNECT_BACKOFF_INITIAL_MS);
    return;
  }

  // v1.6.3.10-v2 - FIX Issue #4: Track failure with timestamp for sliding window
  const now = Date.now();
  failureTimestamps.push(now);

  // Remove failures older than the sliding window
  _pruneOldFailures(now);

  reconnectAttempts = failureTimestamps.length;

  logPortLifecycle('RECONNECT_ATTEMPT_N', {
    attempt: reconnectAttempts,
    backoffMs: reconnectBackoffMs,
    maxFailures: CIRCUIT_BREAKER_FAILURE_THRESHOLD,
    failureReason,
    slidingWindowFailures: failureTimestamps.length,
    recoveryAction: `waiting ${reconnectBackoffMs}ms before retry`
  });

  // v1.6.3.10-v2 - FIX Issue #4: Only count recent failures for circuit breaker
  if (failureTimestamps.length >= CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
    tripCircuitBreaker();
    return;
  }

  // Schedule reconnect with current backoff
  setTimeout(() => {
    console.log('[Manager] Attempting reconnect (attempt', reconnectAttempts, ')');
    connectToBackground();
  }, reconnectBackoffMs);

  // Calculate next backoff with exponential increase, capped at max
  reconnectBackoffMs = Math.min(reconnectBackoffMs * 2, RECONNECT_BACKOFF_MAX_MS);
}

/**
 * Prune failure timestamps older than sliding window
 * v1.6.3.10-v2 - FIX Issue #4: Failures older than CIRCUIT_BREAKER_SLIDING_WINDOW_MS don't count
 * @private
 * @param {number} now - Current timestamp
 */
function _pruneOldFailures(now) {
  const windowStart = now - CIRCUIT_BREAKER_SLIDING_WINDOW_MS;
  failureTimestamps = failureTimestamps.filter(ts => ts > windowStart);
}

/**
 * Force immediate reconnect (bypass circuit breaker)
 * v1.6.3.10-v1 - FIX Issue #2: Used when zombie port detected
 * v1.6.3.10-v2 - FIX Issue #4: Zombie detection uses ZOMBIE_PORT failure reason
 * Zombie detection means background unloaded, not transient failure
 */
function forceImmediateReconnect() {
  // v1.6.3.10-v1 - FIX Code Review: Store previous state for proper logging
  const previousPortState = portState;

  logPortLifecycle('ZOMBIE_DETECTED', {
    recoveryAction: 'forcing immediate reconnect (bypassing circuit breaker)',
    previousState: previousPortState
  });

  // v1.6.3.10-v2 - FIX Issue #4: Reset circuit breaker - zombie is not a transient failure
  // Clear failure timestamps to prevent zombie detection from polluting sliding window
  circuitBreakerState = 'half-open';
  circuitBreakerOpenTime = 0;
  reconnectAttempts = 0;
  reconnectBackoffMs = RECONNECT_BACKOFF_INITIAL_MS;

  // Mark port as zombie before reconnect attempt
  logPortStateTransition(previousPortState, 'zombie', 'message timeout detected');

  // Clean up old port
  if (backgroundPort) {
    try {
      backgroundPort.disconnect();
    } catch (_err) {
      // Port may already be invalid
    }
    backgroundPort = null;
  }

  stopHeartbeat();

  // v1.6.3.10-v2 - FIX Issue #4: Use scheduleReconnect with ZOMBIE_PORT reason
  // This bypasses the failure counting
  scheduleReconnect(FAILURE_REASON.ZOMBIE_PORT);
}

/**
 * Handle connection failure
 * v1.6.3.7 - FIX Issue #5: Track failures for circuit breaker
 * v1.6.3.10-v2 - FIX Issue #4: Pass failure reason for sliding window tracking
 */
function handleConnectionFailure() {
  // v1.6.3.10-v2 - FIX Issue #4: Always schedule reconnect, let sliding window handle thresholds
  scheduleReconnect(FAILURE_REASON.TRANSIENT);
}

/**
 * Trip the circuit breaker to "open" state
 * v1.6.3.7 - FIX Issue #5: Stop reconnection attempts for cooldown period
 * v1.6.3.10-v1 - FIX Issue #6: Enhanced logging for circuit breaker events
 * v1.6.3.10-v2 - FIX Issue #4: Clear failure timestamps, flush pending actions on reopen
 */
function tripCircuitBreaker() {
  const previousState = circuitBreakerState;
  circuitBreakerState = 'open';
  circuitBreakerOpenTime = Date.now();

  // v1.6.3.10-v2 - FIX Issue #4: Log pending actions that are queued
  logPortLifecycle('CIRCUIT_OPEN', {
    previousState,
    attempts: reconnectAttempts,
    slidingWindowFailures: failureTimestamps.length,
    cooldownMs: CIRCUIT_BREAKER_OPEN_DURATION_MS,
    reopenAt: new Date(circuitBreakerOpenTime + CIRCUIT_BREAKER_OPEN_DURATION_MS).toISOString(),
    pendingActionsQueued: pendingActionQueue.length,
    recoveryAction: `will retry after ${CIRCUIT_BREAKER_OPEN_DURATION_MS / 1000}s cooldown`
  });

  // Schedule attempt to reopen circuit breaker
  setTimeout(() => {
    logPortLifecycle('CIRCUIT_HALF_OPEN', {
      reason: 'cooldown expired',
      recoveryAction: 'attempting reconnection'
    });
    circuitBreakerState = 'half-open';
    reconnectAttempts = 0;
    reconnectBackoffMs = RECONNECT_BACKOFF_INITIAL_MS;
    // v1.6.3.10-v2 - FIX Issue #4: Clear sliding window failures on reopen
    failureTimestamps = [];
    connectToBackground();
  }, CIRCUIT_BREAKER_OPEN_DURATION_MS);
}

/**
 * Queue a user action during circuit breaker open state
 * v1.6.3.10-v2 - FIX Issue #4: Actions are queued and flushed on successful reconnect
 * @param {string} action - Action name (e.g., 'MINIMIZE_QUICK_TAB')
 * @param {Object} payload - Action payload
 * @returns {boolean} True if queued, false if circuit is not open or queue full
 */
function _queuePendingAction(action, payload) {
  if (circuitBreakerState !== 'open') {
    return false; // Only queue when circuit is open
  }

  if (pendingActionQueue.length >= MAX_PENDING_ACTIONS) {
    console.warn('[Manager] Pending action queue full, discarding oldest action');
    pendingActionQueue.shift(); // Remove oldest
  }

  pendingActionQueue.push({
    action,
    payload,
    timestamp: Date.now()
  });

  console.log('[Manager] ACTION_QUEUED:', {
    action,
    payload,
    queueLength: pendingActionQueue.length
  });

  return true;
}

/**
 * Flush pending action queue after successful reconnect
 * v1.6.3.10-v2 - FIX Issue #4: Send queued actions to background
 * v1.6.3.10-v2 - FIX Code Review: Prune stale actions and use sendMessageToAllTabs for broadcast
 * @private
 */
async function _flushPendingActionQueue() {
  if (pendingActionQueue.length === 0) {
    return;
  }

  // v1.6.3.10-v2 - FIX Code Review: Prune actions older than 30 seconds as stale
  const MAX_ACTION_AGE_MS = 30000;
  const now = Date.now();
  const actionsToFlush = pendingActionQueue.filter(a => now - a.timestamp < MAX_ACTION_AGE_MS);
  const staleCount = pendingActionQueue.length - actionsToFlush.length;
  pendingActionQueue = [];

  console.log('[Manager] FLUSHING_PENDING_ACTIONS:', {
    count: actionsToFlush.length,
    staleDiscarded: staleCount,
    actions: actionsToFlush.map(a => a.action)
  });

  for (const queuedAction of actionsToFlush) {
    await _flushSingleAction(queuedAction, now);
  }
}

/**
 * Flush a single queued action
 * v1.6.3.10-v2 - FIX Code Review: Extracted to reduce nesting depth
 * @private
 * @param {Object} queuedAction - Queued action object
 * @param {number} now - Current timestamp
 */
async function _flushSingleAction(queuedAction, now) {
  const { action, payload, timestamp } = queuedAction;
  const age = now - timestamp;
  console.log('[Manager] FLUSHING_ACTION:', { action, payload, ageMs: age });

  try {
    const quickTabId = payload?.quickTabId;
    if (quickTabId) {
      await sendMessageToAllTabs(action, quickTabId);
    } else {
      await browser.runtime.sendMessage({ action, ...payload });
    }
  } catch (err) {
    console.warn('[Manager] Failed to flush queued action:', { action, error: err.message });
  }
}

// ==================== v1.6.3.6-v12 HEARTBEAT FUNCTIONS ====================
// v1.6.3.10-v1 - FIX Issue #5: Reduced interval (15s), adaptive backoff, faster timeout (2s)

/**
 * Start heartbeat interval
 * v1.6.3.6-v12 - FIX Issue #2, #4: Keep background alive
 * v1.6.3.10-v1 - FIX Issue #5: Adaptive interval based on latency
 * v1.6.3.12-v11 - FIX Issue #20: Add confirmation logging for heartbeat start
 */
function startHeartbeat() {
  // Clear any existing interval
  stopHeartbeat();

  // Send initial heartbeat immediately
  sendHeartbeat();

  // v1.6.3.10-v1 - FIX Issue #5: Use adaptive interval
  heartbeatIntervalId = setInterval(sendHeartbeat, currentHeartbeatInterval);

  // v1.6.3.12-v11 - FIX Issue #20: Confirm heartbeat actually started
  // Note: setInterval returns a positive integer in browsers (never 0)
  const heartbeatActive = typeof heartbeatIntervalId === 'number' && heartbeatIntervalId > 0;

  logPortLifecycle('HEARTBEAT_STARTED', {
    intervalMs: currentHeartbeatInterval,
    timeoutMs: HEARTBEAT_TIMEOUT_MS,
    safetyMarginMs: 30000 - currentHeartbeatInterval,
    // v1.6.3.12-v11 - FIX Issue #20: Confirmation that setInterval succeeded
    heartbeatActive,
    intervalId: typeof heartbeatIntervalId
  });

  // v1.6.3.12-v11 - FIX Issue #20: Explicit confirmation log after reconnection
  if (heartbeatActive) {
    console.log('[Manager] HEARTBEAT_CONFIRMED_ACTIVE:', {
      timestamp: Date.now(),
      intervalMs: currentHeartbeatInterval,
      intervalIdType: typeof heartbeatIntervalId,
      message: 'Heartbeat interval successfully created and active'
    });
  } else {
    console.error('[Manager] HEARTBEAT_FAILED_TO_START:', {
      timestamp: Date.now(),
      intervalId: heartbeatIntervalId,
      message: 'setInterval did not return a valid interval ID'
    });
  }
}

/**
 * Stop heartbeat interval
 * v1.6.3.6-v12 - FIX Issue #4: Cleanup on disconnect/unload
 */
function stopHeartbeat() {
  if (heartbeatIntervalId) {
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
    logPortLifecycle('HEARTBEAT_STOPPED', {
      reason: 'cleanup'
    });
  }
}

/**
 * Adjust heartbeat interval based on observed latency
 * v1.6.3.10-v1 - FIX Issue #5: Adaptive backoff based on network latency
 * @param {number} latencyMs - Observed round-trip latency
 */
function adjustHeartbeatInterval(latencyMs) {
  const previousInterval = currentHeartbeatInterval;

  // If latency is high (>500ms), increase interval slightly to reduce load
  // But never exceed the maximum (20s) to maintain safety margin
  if (latencyMs > 500) {
    currentHeartbeatInterval = Math.min(currentHeartbeatInterval + 1000, HEARTBEAT_INTERVAL_MAX_MS);
  } else if (latencyMs < 100 && currentHeartbeatInterval > HEARTBEAT_INTERVAL_MS) {
    // Low latency - can reduce interval back toward baseline
    currentHeartbeatInterval = Math.max(currentHeartbeatInterval - 500, HEARTBEAT_INTERVAL_MS);
  }

  // If interval changed, restart heartbeat with new interval
  if (currentHeartbeatInterval !== previousInterval) {
    console.log('[Manager] HEARTBEAT_ADAPTIVE:', {
      previousIntervalMs: previousInterval,
      newIntervalMs: currentHeartbeatInterval,
      observedLatencyMs: latencyMs,
      safetyMarginMs: 30000 - currentHeartbeatInterval
    });

    // Restart heartbeat with new interval
    if (heartbeatIntervalId) {
      clearInterval(heartbeatIntervalId);
      heartbeatIntervalId = setInterval(sendHeartbeat, currentHeartbeatInterval);
    }
  }
}

/**
 * Send heartbeat message to background
 * v1.6.3.6-v12 - FIX Issue #2, #4: Heartbeat with timeout detection
 * v1.6.3.7 - FIX Issue #2: Enhanced logging for port state transitions
 * v1.6.3.10-v1 - FIX Issue #2, #5: Zombie detection, adaptive interval
 */
/**
 * Handle heartbeat when port is not connected
 * v1.6.3.10-v8 - FIX Code Health: Extracted to reduce sendHeartbeat complexity
 * @private
 */
function _handleHeartbeatNoPort() {
  logPortLifecycle('HEARTBEAT_SKIPPED', {
    reason: 'port not connected',
    circuitBreakerState,
    reconnectAttempts
  });
  consecutiveHeartbeatFailures++;
  if (consecutiveHeartbeatFailures >= MAX_HEARTBEAT_FAILURES) {
    logPortLifecycle('HEARTBEAT_TIMEOUT', {
      failures: consecutiveHeartbeatFailures,
      recoveryAction: 'triggering reconnect'
    });
    scheduleReconnect();
  }
}

/**
 * Handle successful heartbeat response
 * v1.6.3.10-v8 - FIX Code Health: Extracted to reduce sendHeartbeat complexity
 * @private
 */
function _handleHeartbeatSuccess(timestamp, response) {
  const latencyMs = Date.now() - timestamp;
  consecutiveHeartbeatFailures = 0;
  lastHeartbeatResponse = Date.now();
  lastSuccessfulPortMessage = Date.now();

  if (portState === 'zombie') {
    logPortStateTransition('zombie', 'connected', 'heartbeat success confirmed');
  }

  logPortLifecycle('HEARTBEAT_SENT', {
    roundTripMs: latencyMs,
    backgroundAlive: response?.backgroundAlive,
    isInitialized: response?.isInitialized,
    adaptiveInterval: currentHeartbeatInterval
  });
  adjustHeartbeatInterval(latencyMs);
}

/**
 * Handle heartbeat failure
 * v1.6.3.10-v8 - FIX Code Health: Extracted to reduce sendHeartbeat complexity
 * @private
 */
function _handleHeartbeatFailure(err) {
  consecutiveHeartbeatFailures++;
  logPortLifecycle('HEARTBEAT_TIMEOUT', {
    error: err.message,
    failures: consecutiveHeartbeatFailures,
    maxFailures: MAX_HEARTBEAT_FAILURES,
    timeSinceLastSuccess: Date.now() - lastHeartbeatResponse,
    recoveryAction:
      consecutiveHeartbeatFailures >= MAX_HEARTBEAT_FAILURES
        ? 'forcing immediate reconnect'
        : 'will retry'
  });

  if (err.message === 'Heartbeat timeout' || err.message === 'Port message timeout') {
    forceImmediateReconnect();
    return true; // Early return signal
  }

  if (consecutiveHeartbeatFailures >= MAX_HEARTBEAT_FAILURES) {
    logPortLifecycle('HEARTBEAT_MAX_FAILURES', {
      failures: consecutiveHeartbeatFailures,
      recoveryAction: 'forcing immediate reconnect'
    });
    forceImmediateReconnect();
  }
  return false;
}

async function sendHeartbeat() {
  if (!backgroundPort) {
    _handleHeartbeatNoPort();
    return;
  }

  const timestamp = Date.now();

  try {
    const response = await sendPortMessageWithTimeout(
      { type: 'HEARTBEAT', timestamp, source: 'sidebar' },
      HEARTBEAT_TIMEOUT_MS
    );
    _handleHeartbeatSuccess(timestamp, response);
  } catch (err) {
    _handleHeartbeatFailure(err);
  }
}

/**
 * Send port message with timeout
 * v1.6.3.6-v12 - FIX Issue #4: Wrap port messages with timeout
 * v1.6.3.10-v1 - FIX Issue #2: Short timeout for zombie detection (500ms default)
 * @param {Object} message - Message to send
 * @param {number} timeoutMs - Timeout in milliseconds (defaults to PORT_MESSAGE_TIMEOUT_MS)
 * @returns {Promise<Object>} Response from background
 */
/**
 * Create timeout handler for port message
 * v1.6.4 - FIX Code Health: Extracted to reduce sendPortMessageWithTimeout line count
 * v1.6.4 - FIX Code Health: Use options object to reduce argument count
 * @private
 * @param {Object} opts - Options object
 * @param {string} opts.correlationId - Correlation ID for tracking
 * @param {number} opts.sentAt - Timestamp when message was sent
 * @param {number} opts.timeoutMs - Timeout duration in milliseconds
 * @param {string} opts.messageType - Type of message being sent
 * @param {Function} opts.reject - Promise reject function
 * @returns {number} Timeout ID
 */
function _createPortMessageTimeout(opts) {
  const { correlationId, sentAt, timeoutMs, messageType, reject } = opts;
  return setTimeout(() => {
    pendingAcks.delete(correlationId);
    logPortLifecycle('MESSAGE_TIMEOUT', {
      messageType,
      correlationId,
      waitedMs: Date.now() - sentAt,
      timeoutMs,
      recoveryAction: 'treating as zombie port'
    });
    reject(new Error('Port message timeout'));
  }, timeoutMs);
}

/**
 * Handle port message send failure with fallback
 * v1.6.4 - FIX Code Health: Extracted to reduce sendPortMessageWithTimeout line count
 * v1.6.4 - FIX Code Health: Use options object to reduce argument count
 * @private
 * @param {Object} opts - Options object
 * @param {Error} opts.err - Original port send error
 * @param {Object} opts.messageWithCorrelation - Message with correlation ID
 * @param {number} opts.timeout - Timeout ID to clear
 * @param {string} opts.correlationId - Correlation ID for tracking
 * @param {string} opts.messageType - Type of message being sent
 * @param {Function} opts.resolve - Promise resolve function
 * @param {Function} opts.reject - Promise reject function
 */
function _handlePortSendFailure(opts) {
  const { err, messageWithCorrelation, timeout, correlationId, messageType, resolve, reject } =
    opts;
  logPortLifecycle('MESSAGE_SEND_FAILED', {
    messageType,
    correlationId,
    error: err.message,
    recoveryAction: 'trying runtime.sendMessage fallback'
  });

  browser.runtime
    .sendMessage({ ...messageWithCorrelation, source: 'sendMessage_fallback' })
    .then(response => {
      clearTimeout(timeout);
      pendingAcks.delete(correlationId);
      logPortLifecycle('MESSAGE_FALLBACK_SUCCESS', { messageType, correlationId });
      resolve(response);
    })
    .catch(sendErr => {
      clearTimeout(timeout);
      pendingAcks.delete(correlationId);
      logPortLifecycle('MESSAGE_FALLBACK_FAILED', {
        messageType,
        correlationId,
        portError: err.message,
        sendMessageError: sendErr.message
      });
      reject(err);
    });
}

/**
 * Send message via port with timeout and fallback
 * v1.6.4 - FIX Code Health: Extracted helpers to reduce line count (70 -> ~30)
 */
function sendPortMessageWithTimeout(message, timeoutMs = PORT_MESSAGE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (!backgroundPort) {
      reject(new Error('Port not connected'));
      return;
    }

    const correlationId = generateCorrelationId();
    const messageWithCorrelation = { ...message, correlationId };
    const sentAt = Date.now();

    logPortLifecycle('MESSAGE_ACK_PENDING', {
      messageType: message.type,
      correlationId,
      timeoutMs
    });

    const timeout = _createPortMessageTimeout({
      correlationId,
      sentAt,
      timeoutMs,
      messageType: message.type,
      reject
    });

    pendingAcks.set(correlationId, {
      resolve,
      reject,
      timeout,
      sentAt,
      messageType: message.type
    });

    try {
      backgroundPort.postMessage(messageWithCorrelation);
    } catch (err) {
      _handlePortSendFailure({
        err,
        messageWithCorrelation,
        timeout,
        correlationId,
        messageType: message.type,
        resolve,
        reject
      });
    }
  });
}

/**
 * Verify port is viable before critical operation
 * v1.6.3.10-v1 - FIX Issue #2: Verify port viability before minimize/restore/close
 * v1.6.3.10-v7 - FIX Bug #3: Adaptive timeout based on 95th percentile latency
 * @returns {Promise<boolean>} True if port is viable, false if zombie detected
 */
async function verifyPortViability() {
  if (!backgroundPort) {
    logPortLifecycle('PORT_VIABILITY_CHECK', {
      result: 'failed',
      reason: 'port not connected'
    });
    return false;
  }

  // v1.6.3.10-v7 - FIX Bug #3: Use adaptive timeout instead of fixed 500ms
  const timeoutMs = _calculateAdaptiveTimeout();
  const startTime = Date.now();

  // Quick ping to verify background is responsive
  try {
    await sendPortMessageWithTimeout(
      {
        type: 'HEARTBEAT',
        timestamp: Date.now(),
        source: 'viability-check'
      },
      timeoutMs
    );

    // v1.6.3.10-v7 - FIX Bug #3: Track latency for adaptive timeout
    const latencyMs = Date.now() - startTime;
    _recordLatencySample(latencyMs);

    lastSuccessfulPortMessage = Date.now();
    logPortLifecycle('PORT_VIABILITY_CHECK', {
      result: 'success',
      portState,
      latencyMs,
      adaptiveTimeoutMs: timeoutMs
    });
    return true;
  } catch (err) {
    const elapsedMs = Date.now() - startTime;

    // v1.6.3.10-v7 - FIX Bug #3: Check if port is actually disconnected vs just slow
    // If we're close to timeout but port is still connected, might just be slow
    if (elapsedMs < timeoutMs && backgroundPort) {
      console.log('[Manager] PORT_VIABILITY_CHECK: Possible slow response, not zombie', {
        elapsedMs,
        timeoutMs,
        error: err.message
      });
    }

    logPortLifecycle('PORT_VIABILITY_CHECK', {
      result: 'failed',
      error: err.message,
      elapsedMs,
      adaptiveTimeoutMs: timeoutMs,
      recoveryAction: 'triggering reconnect'
    });

    // Port is zombie - trigger reconnect
    forceImmediateReconnect();
    return false;
  }
}

// ==================== v1.6.3.10-v7 ADAPTIVE TIMEOUT ====================
// FIX Bug #3: Adaptive port timeout based on observed latency

/**
 * Record a latency sample for adaptive timeout calculation
 * v1.6.3.10-v7 - FIX Bug #3: Track heartbeat latencies
 * @private
 * @param {number} latencyMs - Observed round-trip latency
 */
function _recordLatencySample(latencyMs) {
  recentLatencySamples.push(latencyMs);

  // Keep only the most recent samples
  if (recentLatencySamples.length > LATENCY_SAMPLES_MAX) {
    recentLatencySamples.shift();
  }

  // Recalculate adaptive timeout
  _updateAdaptiveTimeout();
}

/**
 * Calculate 95th percentile of latency samples
 * v1.6.3.10-v7 - FIX Bug #3: Statistical latency analysis
 * @private
 * @returns {number} 95th percentile latency in ms
 */
function _calculate95thPercentileLatency() {
  if (recentLatencySamples.length < 3) {
    return PORT_VIABILITY_MIN_TIMEOUT_MS; // Not enough data
  }

  const sorted = [...recentLatencySamples].sort((a, b) => a - b);
  const index = Math.floor(sorted.length * 0.95);
  return sorted[Math.min(index, sorted.length - 1)];
}

/**
 * Update adaptive timeout based on recent latencies
 * v1.6.3.10-v7 - FIX Bug #3: Set timeout to max(700ms, 2x observed latency)
 * @private
 */
function _updateAdaptiveTimeout() {
  const p95Latency = _calculate95thPercentileLatency();

  // timeout = max(700ms, 2x observed latency), capped at max
  const calculatedTimeout = Math.max(PORT_VIABILITY_MIN_TIMEOUT_MS, p95Latency * 2);
  adaptivePortTimeout = Math.min(calculatedTimeout, PORT_VIABILITY_MAX_TIMEOUT_MS);

  console.log('[Manager] ADAPTIVE_TIMEOUT_UPDATED:', {
    p95LatencyMs: p95Latency,
    newTimeoutMs: adaptivePortTimeout,
    sampleCount: recentLatencySamples.length
  });
}

/**
 * Calculate current adaptive timeout for port viability check
 * v1.6.3.10-v7 - FIX Bug #3: Returns adaptive or default timeout
 * @private
 * @returns {number} Timeout in milliseconds
 */
function _calculateAdaptiveTimeout() {
  return adaptivePortTimeout;
}

// ==================== v1.6.3.10-v7 MESSAGE DEDUPLICATION ====================
// FIX Bug #3: Prevent re-sending same message on reconnect

/**
 * Check if a message was recently sent (deduplication)
 * v1.6.3.10-v7 - FIX Bug #3: Prevent duplicate sends on reconnect
 * @private
 * @param {string} action - Message action
 * @param {string} quickTabId - Quick Tab ID
 * @returns {boolean} True if message was recently sent and should be skipped
 */
function _isDuplicateMessage(action, quickTabId) {
  const hash = `${action}:${quickTabId}`;
  const lastSent = sentMessageDedup.get(hash);

  if (!lastSent) {
    return false;
  }

  const age = Date.now() - lastSent;
  if (age < MESSAGE_DEDUP_TTL_MS) {
    console.log('[Manager] MESSAGE_DEDUP_DETECTED:', {
      action,
      quickTabId,
      ageMs: age,
      ttlMs: MESSAGE_DEDUP_TTL_MS
    });
    return true;
  }

  return false;
}

/**
 * Mark a message as sent for deduplication
 * v1.6.3.10-v7 - FIX Bug #3: Track sent messages
 * @private
 * @param {string} action - Message action
 * @param {string} quickTabId - Quick Tab ID
 */
function _markMessageSent(action, quickTabId) {
  const hash = `${action}:${quickTabId}`;
  sentMessageDedup.set(hash, Date.now());

  // Cleanup old entries periodically
  _cleanupSentMessageDedup();
}

/**
 * Cleanup old dedup entries
 * v1.6.3.10-v7 - FIX Bug #3: Prevent memory growth
 * @private
 */
function _cleanupSentMessageDedup() {
  const now = Date.now();
  for (const [hash, timestamp] of sentMessageDedup.entries()) {
    if (now - timestamp > MESSAGE_DEDUP_TTL_MS * 2) {
      sentMessageDedup.delete(hash);
    }
  }
}

// ==================== END ADAPTIVE TIMEOUT & DEDUP ====================

// ==================== END HEARTBEAT FUNCTIONS ====================

// ==================== v1.6.3.12-v7 STATE SYNC & UNIFIED RENDER ====================
// FIX Issue E: State sync on port reconnection
// FIX Issue B: Unified render entry point
// FIX Issue D: Hash-based state staleness detection

/**
 * State hash captured when debounce timer was set
 * v1.6.3.12-v7 - FIX Issue D: Detect state staleness during debounce
 */
let capturedStateHashAtDebounce = 0;

/**
 * Timestamp when debounce was set
 * v1.6.3.12-v7 - FIX Issue D: Track debounce timing
 */
let debounceSetTimestamp = 0;

/**
 * State sync timeout (5 seconds)
 * v1.6.3.12-v7 - FIX Issue E: Timeout for state sync request
 */
const STATE_SYNC_TIMEOUT_MS = 5000;

/**
 * Build state sync request message
 * v1.6.3.11-v3 - FIX CodeScene: Extract from _requestFullStateSync
 * @private
 */
function _buildStateSyncRequest() {
  return {
    type: 'REQUEST_FULL_STATE_SYNC',
    timestamp: Date.now(),
    source: 'sidebar',
    currentCacheHash: computeStateHash(quickTabsState),
    currentCacheTabCount: quickTabsState?.tabs?.length ?? 0
  };
}

/**
 * Request full state sync from background after port reconnection
 * v1.6.3.12-v7 - FIX Issue E: Ensure Manager has latest state after reconnection
 * v1.6.3.11-v3 - FIX CodeScene: Reduce complexity by extracting helpers
 * @private
 */
async function _requestFullStateSync() {
  if (!backgroundPort) {
    console.warn('[Manager] Cannot request state sync - port not connected');
    return;
  }

  console.log('[Manager] STATE_SYNC_REQUESTED: requesting full state from background');

  try {
    const response = await sendPortMessageWithTimeout(
      _buildStateSyncRequest(),
      STATE_SYNC_TIMEOUT_MS
    );

    if (response?.success && response?.state) {
      _handleStateSyncResponse(response);
    } else {
      console.warn('[Manager] State sync response did not include state:', response);
    }
  } catch (err) {
    console.warn(
      '[Manager] State sync timed out after',
      STATE_SYNC_TIMEOUT_MS,
      'ms, proceeding with cached state (may be stale):',
      err.message
    );
  }
}

/**
 * Handle state sync response from background
 * v1.6.3.12-v7 - FIX Issue E: Compare and update state
 * @private
 * @param {Object} response - Response from background with state
 */
function _handleStateSyncResponse(response) {
  const serverState = response.state;
  const serverTabCount = serverState?.tabs?.length ?? 0;
  const cacheTabCount = quickTabsState?.tabs?.length ?? 0;

  const serverHash = computeStateHash(serverState);
  const cacheHash = computeStateHash(quickTabsState);
  const hashDiverged = serverHash !== cacheHash;

  console.log('[Manager] STATE_SYNC_RECEIVED:', {
    serverTabCount,
    cacheTabCount,
    serverHash,
    cacheHash,
    diverged: hashDiverged
  });

  if (hashDiverged) {
    console.log(
      '[Manager] STATE_DIVERGENCE_DETECTED: server has',
      serverTabCount,
      'tabs, cache had',
      cacheTabCount,
      'tabs - updating'
    );

    // Update local state from server
    quickTabsState = serverState;
    _updateInMemoryCache(serverState.tabs || []);
    lastKnownGoodTabCount = serverTabCount;
    lastLocalUpdateTime = Date.now();

    // Trigger UI update
    scheduleRender('state-sync-divergence');
  } else {
    console.log('[Manager] State sync complete - no divergence detected');
  }
}

/**
 * Unified render entry point - ALL render triggers go through here
 * v1.6.3.12-v7 - FIX Issue B: Single entry point prevents cascading render triggers
 * @param {string} source - Source of render trigger for logging
 */
/**
 * Log hash computation for render scheduling
 * v1.6.3.12-v7 - Extracted for complexity reduction
 * @private
 */
function _logHashComputation(scheduleTimestamp, source, currentHash) {
  console.log('[Sidebar] DEBOUNCE_HASH_COMPUTED:', {
    timestamp: scheduleTimestamp,
    source,
    hashValue: currentHash,
    previousHash: lastRenderedStateHash,
    hashChanged: currentHash !== lastRenderedStateHash,
    stateTabCount: quickTabsState?.tabs?.length || 0,
    fieldsInHash: ['id', 'url', 'left', 'top', 'width', 'height', 'minimized', 'saveId']
  });
}

/**
 * Log when render is skipped due to hash match
 * v1.6.3.12-v7 - Extracted for complexity reduction
 * @private
 */
/**
 * Build state summary for logging
 * v1.6.3.12-v7 - Extracted for complexity reduction
 * @private
 */
function _buildStateSummary() {
  const tabs = quickTabsState?.tabs || [];
  return {
    totalTabs: tabs.length,
    minimizedTabs: tabs.filter(t => t.minimized).length
  };
}

/**
 * Log when render is skipped due to hash match
 * v1.6.3.12-v4 - Gap #5: Include correlationId for tracing
 * @private
 */
function _logRenderSkipped(scheduleTimestamp, source, currentHash, correlationId = null) {
  console.log('[Manager] RENDER_DEDUPLICATION: prevented duplicate render (hash unchanged)', {
    source,
    hash: currentHash,
    correlationId: correlationId || null
  });
  console.log('[Sidebar] DEBOUNCE_SKIPPED_HASH_MATCH:', {
    timestamp: scheduleTimestamp,
    source,
    correlationId: correlationId || null,
    hash: currentHash,
    tabCount: quickTabsState?.tabs?.length || 0,
    stateSummary: _buildStateSummary()
  });
}

/**
 * Count Quick Tabs and minimized tabs from state
 * v1.6.4-v2 - Extracted for complexity reduction
 * @private
 * @returns {{ tabCount: number, minimizedCount: number }}
 */
function _computeTabCounts() {
  const tabCount = quickTabsState?.tabs?.length ?? 0;
  const minimizedCount = quickTabsState?.tabs?.filter(t => t.minimized)?.length ?? 0;
  return { tabCount, minimizedCount };
}

/**
 * Log render scheduled box header to console
 * v1.6.4-v2 - Extracted for complexity reduction
 * @private
 * @param {string} source - Source of render request
 * @param {number} tabCount - Total tab count
 * @param {number} minimizedCount - Minimized tab count
 * @param {string|null} correlationId - Correlation ID for tracing
 */
function _logRenderScheduledBox(source, tabCount, minimizedCount, correlationId) {
  console.log('[Manager] ┌─────────────────────────────────────────────────────────');
  console.log('[Manager] │ RENDER_SCHEDULED');
  console.log('[Manager] │ Source:', source);
  console.log('[Manager] │ TabCount:', tabCount, '(minimized:', minimizedCount + ')');
  console.log('[Manager] │ CorrelationId:', correlationId || 'none');
  console.log('[Manager] └─────────────────────────────────────────────────────────');
}

/**
 * Log debounce scheduled event
 * v1.6.4-v2 - Extracted for complexity reduction
 * @private
 * @param {number} scheduleTimestamp - Timestamp when render was scheduled
 * @param {string} source - Source of render request
 * @param {string|null} correlationId - Correlation ID for tracing
 */
function _logDebounceScheduled(scheduleTimestamp, source, correlationId) {
  console.log('[Sidebar] DEBOUNCE_SCHEDULED:', {
    timestamp: scheduleTimestamp,
    source,
    correlationId: correlationId || null,
    debounceId: `render-${scheduleTimestamp}`,
    delayMs: RENDER_DEBOUNCE_MS,
    reason: 'hash_changed'
  });
}

/**
 * @typedef {Object} RenderLogContext
 * @property {string} source - Source of render request
 * @property {string|null} currentHash - Current state hash
 * @property {number} tabCount - Total tab count
 * @property {number} minimizedCount - Minimized tab count
 * @property {string|null} correlationId - Correlation ID for tracing
 */

/**
 * Log render scheduled structured event
 * v1.6.4-v2 - Extracted for complexity reduction, uses options object
 * @private
 * @param {RenderLogContext} context - Render log context
 */
function _logRenderScheduledStructured(context) {
  const { source, currentHash, tabCount, minimizedCount, correlationId } = context;
  console.log('[Manager] RENDER_SCHEDULED:', {
    source,
    correlationId: correlationId || null,
    newHash: currentHash,
    previousHash: lastRenderedStateHash,
    tabCount,
    minimizedCount,
    timestamp: Date.now()
  });
}

/**
 * Log when render is scheduled
 * v1.6.3.12-v7 - Extracted for complexity reduction
 * v1.6.3.12-v4 - Gap #5: Include correlationId for tracing
 * v1.6.3.12-v9 - FIX Issue #4: Enhanced logging for Manager update tracking
 * v1.6.4-v2 - Refactored to reduce cyclomatic complexity by extracting log helpers
 * @private
 */
function _logRenderScheduled(scheduleTimestamp, source, currentHash, correlationId = null) {
  const { tabCount, minimizedCount } = _computeTabCounts();
  _logRenderScheduledBox(source, tabCount, minimizedCount, correlationId);
  _logDebounceScheduled(scheduleTimestamp, source, correlationId);
  _logRenderScheduledStructured({ source, currentHash, tabCount, minimizedCount, correlationId });
}

/**
 * Schedule UI render with deduplication
 * v1.6.3.12-v4 - Gap #5: Accept correlationId for end-to-end tracing
 * v1.6.4 - FIX Issue #21: Track state version for render transaction boundaries
 * v1.6.3.12-v12 - FIX Issue #48: Also check state version to ensure button operations trigger re-render
 * @param {string} [source='unknown'] - Source of render request
 * @param {string} [correlationId=null] - Correlation ID for async tracing
 */
function scheduleRender(source = 'unknown', correlationId = null) {
  const scheduleTimestamp = Date.now();
  const currentHash = computeStateHash(quickTabsState);

  _logHashComputation(scheduleTimestamp, source, currentHash);

  // v1.6.3.12-v12 - FIX Issue #48: Check both hash AND state version
  // Hash comparison prevents unnecessary renders when content hasn't changed
  // State version comparison ensures renders after button operations even if content hash is same
  // (e.g., minimize/restore doesn't change tab count but needs UI rebuild to clear disabled states)
  const hashUnchanged = currentHash === lastRenderedStateHash;
  const versionUnchanged = _stateVersion === _lastRenderedStateVersion;

  if (hashUnchanged && versionUnchanged) {
    _logRenderSkipped(scheduleTimestamp, source, currentHash, correlationId);
    return;
  }

  // Log why render is proceeding
  if (!hashUnchanged) {
    console.log('[Manager] RENDER_SCHEDULED: Hash changed', {
      timestamp: scheduleTimestamp,
      source,
      previousHash: lastRenderedStateHash,
      currentHash
    });
  } else if (!versionUnchanged) {
    console.log('[Manager] RENDER_SCHEDULED: State version changed (hash same)', {
      timestamp: scheduleTimestamp,
      source,
      previousVersion: _lastRenderedStateVersion,
      currentVersion: _stateVersion,
      reason: 'Forcing re-render for UI state refresh'
    });
  }

  // v1.6.4 - FIX Issue #21: Capture state version at schedule time
  // This allows us to detect if state changed between scheduling and rendering
  _stateVersionAtSchedule = _stateVersion;

  _logRenderScheduled(scheduleTimestamp, source, currentHash, correlationId);

  // v1.6.4 - FIX Issue #21: Use requestAnimationFrame for DOM mutation batching
  // This ensures DOM mutations are batched efficiently and prevents layout thrashing
  requestAnimationFrame(() => {
    // v1.6.4 - FIX Issue #21: Check if state changed since scheduling
    if (_stateVersion !== _stateVersionAtSchedule) {
      console.log('[Manager] v1.6.4 RENDER_STATE_DRIFT:', {
        scheduledVersion: _stateVersionAtSchedule,
        currentVersion: _stateVersion,
        versionDrift: _stateVersion - _stateVersionAtSchedule,
        source,
        note: 'State changed between schedule and render - rendering latest state'
      });
    }
    renderUI();
  });
}

// ==================== END STATE SYNC & UNIFIED RENDER ====================

/**
 * Handle messages received via port
 * v1.6.3.6-v11 - FIX Issue #10: Process acknowledgments
 * v1.6.3.6-v12 - FIX Issue #4: Handle HEARTBEAT_ACK
 * v1.6.3.12-v7 - FIX Issue E: Handle FULL_STATE_SYNC response
 * @param {Object} message - Message from background
 */
function handlePortMessage(message) {
  logPortLifecycle('message', {
    type: message.type,
    action: message.action,
    correlationId: message.correlationId
  });

  // v1.6.3.6-v12 - FIX Issue #4: Handle heartbeat acknowledgment
  if (message.type === 'HEARTBEAT_ACK') {
    handleAcknowledgment(message);
    return;
  }

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
    // v1.6.3.12-v7 - FIX Issue B: Route through unified render entry point
    handleStateUpdateBroadcast(message);
    scheduleRender('port-STATE_UPDATE');
    return;
  }

  // v1.6.3.12-v7 - FIX Issue E: Handle full state sync response
  if (message.type === 'FULL_STATE_SYNC') {
    _handleStateSyncResponse(message);
    return;
  }

  // v1.6.3.10-v3 - FIX Issue #47: Handle adoption completion for immediate re-render
  if (message.type === 'ADOPTION_COMPLETED') {
    handleAdoptionCompletion(message);
    return;
  }

  // v1.6.3.10-v3 - Phase 2: Handle origin tab closed for orphan detection
  if (message.type === 'ORIGIN_TAB_CLOSED') {
    handleOriginTabClosed(message);
    return;
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
 * v1.6.3.12-v7 - FIX Issue B: Route all renders through scheduleRender()
 * @param {Object} message - Broadcast message
 */
function handleBroadcast(message) {
  const { action } = message;

  switch (action) {
    case 'VISIBILITY_CHANGE':
      console.log('[Manager] Received visibility change broadcast:', message);
      // v1.6.3.12-v7 - FIX Issue B: Route through unified entry point
      scheduleRender('broadcast-VISIBILITY_CHANGE');
      break;

    case 'TAB_LIFECYCLE_CHANGE':
      console.log('[Manager] Received tab lifecycle broadcast:', message);
      // Refresh browser tab info cache for affected tabs
      if (message.tabId) {
        browserTabInfoCache.delete(message.tabId);
      }
      // v1.6.3.12-v7 - FIX Issue B: Route through unified entry point
      scheduleRender('broadcast-TAB_LIFECYCLE_CHANGE');
      break;

    default:
      console.log('[Manager] Received broadcast:', message);
  }
}

/**
 * Handle state update broadcasts
 * v1.6.3.6-v11 - FIX Issue #19: State sync via port
 * v1.6.3.12-v7 - FIX Issue B: No longer calls renderUI directly - caller must route through scheduleRender
 * @param {Object} message - State update message
 */
function handleStateUpdateBroadcast(message) {
  const { quickTabId, changes } = message.payload || message;

  if (quickTabId && changes) {
    handleStateUpdateMessage(quickTabId, changes);
    // v1.6.3.12-v7 - FIX Issue B: renderUI() removed - caller (handlePortMessage) now routes through scheduleRender()
  }
}

/**
 * Handle adoption completion from background
 * v1.6.3.10-v3 - FIX Issue #47: Adoption re-render fix
 * v1.6.3.10-v5 - FIX Bug #3: Surgical DOM update to prevent all Quick Tabs animating
 * v1.6.3.12-v7 - FIX BUG #4: Update quickTabHostInfo to prevent stale host tab routing
 * v1.6.3.10-v7 - FIX Bug #2: Container validation for adoption
 * @param {Object} message - Adoption completion message
 */
/**
 * Invalidate browser tab info cache for affected tabs during adoption
 * v1.6.3.11-v3 - FIX CodeScene: Extract from handleAdoptionCompletion
 * @private
 */
function _invalidateAffectedTabCaches(oldOriginTabId, newOriginTabId) {
  if (oldOriginTabId) browserTabInfoCache.delete(oldOriginTabId);
  if (newOriginTabId) browserTabInfoCache.delete(newOriginTabId);
}

/**
 * Update quickTabHostInfo for adopted Quick Tab
 * v1.6.3.11-v3 - FIX CodeScene: Extract from handleAdoptionCompletion
 * @private
 */
function _updateHostInfoForAdoption(adoptedQuickTabId, newOriginTabId, newContainerId) {
  if (!adoptedQuickTabId || !newOriginTabId) return;

  const previousHostInfo = quickTabHostInfo.get(adoptedQuickTabId);
  quickTabHostInfo.set(adoptedQuickTabId, {
    hostTabId: newOriginTabId,
    containerId: newContainerId || null,
    lastUpdate: Date.now(),
    lastOperation: 'adoption',
    confirmed: true
  });
  console.log('[Manager] ADOPTION_HOST_INFO_UPDATED:', {
    adoptedQuickTabId,
    previousHostTabId: previousHostInfo?.hostTabId ?? null,
    newHostTabId: newOriginTabId,
    containerId: newContainerId
  });
}

/**
 * Handle adoption completion from background script
 * v1.6.3.12-v7 - FIX BUG #4: Update quickTabHostInfo to prevent stale host tab routing
 * v1.6.3.10-v7 - FIX Bug #2: Container validation for adoption
 * v1.6.3.11-v3 - FIX CodeScene: Reduce complexity by extracting helpers
 * @param {Object} message - Adoption completion message
 */
async function handleAdoptionCompletion(message) {
  const { adoptedQuickTabId, oldOriginTabId, newOriginTabId, timestamp } = message;

  console.log('[Manager] ADOPTION_COMPLETED received via port:', {
    adoptedQuickTabId,
    oldOriginTabId,
    newOriginTabId,
    timestamp,
    timeSinceBroadcast: Date.now() - timestamp
  });

  // Validate containers match before processing adoption
  const containerValidation = await _validateAdoptionContainers(oldOriginTabId, newOriginTabId);
  if (!containerValidation.valid) {
    console.warn('[Manager] ADOPTION_CONTAINER_MISMATCH:', {
      adoptedQuickTabId,
      oldOriginTabId,
      newOriginTabId,
      oldContainerId: containerValidation.oldContainerId,
      newContainerId: containerValidation.newContainerId,
      reason: containerValidation.reason,
      action: 'proceeding with warning - cross-container adoption'
    });
  }

  lastCacheSyncFromStorage = Date.now();
  _invalidateAffectedTabCaches(oldOriginTabId, newOriginTabId);
  _updateHostInfoForAdoption(adoptedQuickTabId, newOriginTabId, containerValidation.newContainerId);

  // Attempt surgical DOM update first (prevents all Quick Tabs from animating)
  const surgicalUpdateSuccess = await _performSurgicalAdoptionUpdate(
    adoptedQuickTabId,
    oldOriginTabId,
    newOriginTabId
  );

  if (surgicalUpdateSuccess) {
    console.log('[Manager] ADOPTION_SURGICAL_UPDATE_SUCCESS:', {
      adoptedQuickTabId,
      oldOriginTabId,
      newOriginTabId,
      message: 'Only adopted Quick Tab updated - no full rebuild'
    });
  } else {
    console.log('[Manager] ADOPTION_SURGICAL_UPDATE_FAILED, falling back to full render:', {
      adoptedQuickTabId,
      reason: 'surgical update returned false'
    });
    scheduleRender('adoption-completed-fallback');
  }
}

/**
 * Validate containers match for adoption
 * v1.6.3.10-v7 - FIX Bug #2: Container validation for cross-container adoption detection
 * @private
 * @param {number|string|null} oldOriginTabId - Previous origin tab ID
 * @param {number} newOriginTabId - New origin tab ID
 * @returns {Promise<{valid: boolean, oldContainerId: string|null, newContainerId: string|null, reason?: string}>}
 */
async function _validateAdoptionContainers(oldOriginTabId, newOriginTabId) {
  // Skip validation if old tab ID is not a valid number (orphaned, null, etc.)
  if (typeof oldOriginTabId !== 'number' || oldOriginTabId <= 0) {
    console.log('[Manager] ADOPTION_CONTAINER_VALIDATION_SKIPPED:', {
      reason: 'old tab ID is not valid',
      oldOriginTabId,
      newOriginTabId
    });
    // Try to get new container ID even if we can't compare
    const newContainerId = await _getTabContainerId(newOriginTabId);
    return { valid: true, oldContainerId: null, newContainerId, reason: 'old tab not available' };
  }

  try {
    // Get container IDs for both tabs in parallel
    const [oldContainerId, newContainerId] = await Promise.all([
      _getTabContainerId(oldOriginTabId),
      _getTabContainerId(newOriginTabId)
    ]);

    // If either tab doesn't exist or container can't be determined, allow adoption
    if (oldContainerId === null || newContainerId === null) {
      return {
        valid: true,
        oldContainerId,
        newContainerId,
        reason: 'container ID not available for one or both tabs'
      };
    }

    // Compare containers
    const containersMatch = oldContainerId === newContainerId;
    return {
      valid: containersMatch,
      oldContainerId,
      newContainerId,
      reason: containersMatch ? 'containers match' : 'containers differ'
    };
  } catch (err) {
    console.warn('[Manager] ADOPTION_CONTAINER_VALIDATION_ERROR:', {
      oldOriginTabId,
      newOriginTabId,
      error: err.message
    });
    // On error, allow adoption but log warning
    return {
      valid: true,
      oldContainerId: null,
      newContainerId: null,
      reason: `validation error: ${err.message}`
    };
  }
}

/**
 * Get container ID (cookieStoreId) for a browser tab
 * v1.6.3.10-v7 - FIX Bug #2: Helper for container validation
 * @private
 * @param {number} tabId - Browser tab ID
 * @returns {Promise<string|null>} Container ID or null if tab doesn't exist
 */
async function _getTabContainerId(tabId) {
  if (!tabId || tabId <= 0) {
    return null;
  }

  try {
    const tab = await browser.tabs.get(tabId);
    return tab?.cookieStoreId || 'firefox-default';
  } catch (err) {
    // Tab may not exist anymore
    console.log('[Manager] CONTAINER_ID_LOOKUP_FAILED:', {
      tabId,
      error: err.message
    });
    return null;
  }
}

/**
 * Perform surgical DOM update for adoption - only update the adopted Quick Tab
 * v1.6.3.10-v5 - FIX Bug #3: Prevents animation on all Quick Tabs during single adoption
 * @private
 * @param {string} adoptedQuickTabId - ID of the adopted Quick Tab
 * @param {number|string|null} oldOriginTabId - Previous origin tab ID (may be 'orphaned' or null)
 * @param {number} newOriginTabId - New origin tab ID
 * @returns {Promise<boolean>} True if surgical update succeeded, false if full render needed
 */
async function _performSurgicalAdoptionUpdate(adoptedQuickTabId, oldOriginTabId, newOriginTabId) {
  const startTime = Date.now();

  try {
    // Step 1: Load fresh state from storage
    const stateLoadResult = await _loadFreshAdoptionState(adoptedQuickTabId);
    if (!stateLoadResult.success) {
      return false;
    }

    const { adoptedTab } = stateLoadResult;

    // Step 2: Try to move existing element between groups
    const existingElement = _findQuickTabDOMElement(adoptedQuickTabId);
    const moveResult = await _tryMoveExistingElement({
      existingElement,
      adoptedTab,
      oldOriginTabId,
      newOriginTabId,
      adoptedQuickTabId,
      startTime
    });

    if (moveResult.handled) {
      return moveResult.success;
    }

    // Step 3: Try inserting into correct group as fallback
    return await _tryInsertAsNewElement({
      adoptedTab,
      existingElement,
      oldOriginTabId,
      newOriginTabId,
      adoptedQuickTabId,
      startTime
    });
  } catch (err) {
    console.error('[Manager] SURGICAL_UPDATE_ERROR:', {
      adoptedQuickTabId,
      error: err.message,
      durationMs: Date.now() - startTime
    });
    return false;
  }
}

/**
 * Load fresh state from storage for adoption surgical update
 * @private
 * @param {string} adoptedQuickTabId - ID of the adopted Quick Tab
 * @returns {Promise<{success: boolean, adoptedTab?: Object}>}
 */
async function _loadFreshAdoptionState(adoptedQuickTabId) {
  // v1.6.3.12-v5 - FIX: Use storage.local exclusively (storage.session not available in Firefox MV2)
  const result = await browser.storage.local.get(STATE_KEY);
  const state = result?.[STATE_KEY];

  if (!state?.tabs) {
    console.warn('[Manager] SURGICAL_UPDATE: No tabs in storage');
    return { success: false };
  }

  // Update local state
  quickTabsState = state;
  _updateInMemoryCache(state.tabs);

  // Find the adopted Quick Tab
  const adoptedTab = state.tabs.find(t => t.id === adoptedQuickTabId);
  if (!adoptedTab) {
    console.warn('[Manager] SURGICAL_UPDATE: Adopted Quick Tab not found in state:', {
      adoptedQuickTabId
    });
    return { success: false };
  }

  return { success: true, adoptedTab };
}

/**
 * Try to move an existing DOM element between groups
 * @private
 * @returns {Promise<{handled: boolean, success: boolean}>}
 */
/**
 * Try to move an existing element between groups
 * v1.6.3.10-v8 - FIX Code Health: Use options object
 * @private
 */
async function _tryMoveExistingElement({
  existingElement,
  adoptedTab,
  oldOriginTabId,
  newOriginTabId,
  adoptedQuickTabId,
  startTime
}) {
  if (!existingElement) return { handled: false, success: false };

  const moved = await _moveQuickTabBetweenGroups(
    existingElement,
    adoptedTab,
    oldOriginTabId,
    newOriginTabId
  );
  if (!moved) return { handled: false, success: false };

  console.log('[Manager] SURGICAL_UPDATE_COMPLETE:', {
    adoptedQuickTabId,
    oldOriginTabId,
    newOriginTabId,
    method: 'move-between-groups',
    durationMs: Date.now() - startTime
  });
  return { handled: true, success: true };
}

/**
 * Try to insert as a new element in the target group
 * v1.6.3.10-v8 - FIX Code Health: Use options object
 * @private
 */
async function _tryInsertAsNewElement({
  adoptedTab,
  existingElement,
  oldOriginTabId,
  newOriginTabId,
  adoptedQuickTabId,
  startTime
}) {
  const inserted = await _insertQuickTabIntoGroup(adoptedTab, newOriginTabId);
  if (!inserted) {
    console.warn('[Manager] SURGICAL_UPDATE: Could not insert into target group');
    return false;
  }

  if (existingElement) {
    _removeQuickTabFromDOM(existingElement, oldOriginTabId);
  }

  console.log('[Manager] SURGICAL_UPDATE_COMPLETE:', {
    adoptedQuickTabId,
    oldOriginTabId,
    newOriginTabId,
    method: 'insert-into-group',
    durationMs: Date.now() - startTime
  });
  return true;
}

/**
 * Find existing DOM element for a Quick Tab by ID
 * v1.6.3.10-v5 - FIX Bug #3: Helper for surgical DOM updates
 * @private
 * @param {string} quickTabId - Quick Tab ID to find
 * @returns {HTMLElement|null} The DOM element or null if not found
 */
function _findQuickTabDOMElement(quickTabId) {
  return containersList.querySelector(`.quick-tab-item[data-tab-id="${quickTabId}"]`);
}

/**
 * Move a Quick Tab DOM element between groups
 * v1.6.3.10-v5 - FIX Bug #3: Moves element without recreating (prevents animation)
 * @private
 * @param {HTMLElement} element - The Quick Tab DOM element to move
 * @param {Object} tabData - Updated Quick Tab data
 * @param {number|string|null} oldOriginTabId - Previous group key
 * @param {number} newOriginTabId - New group key
 * @returns {boolean} True if move succeeded
 */
function _moveQuickTabBetweenGroups(element, tabData, oldOriginTabId, newOriginTabId) {
  // Find the target group
  const targetGroup = containersList.querySelector(
    `.tab-group[data-origin-tab-id="${newOriginTabId}"]`
  );

  if (!targetGroup) {
    // Target group doesn't exist - need to create it
    console.log('[Manager] SURGICAL_UPDATE: Target group not found, will create:', {
      newOriginTabId
    });
    return false;
  }

  const targetContent = targetGroup.querySelector('.tab-group-content');
  if (!targetContent) {
    console.warn('[Manager] SURGICAL_UPDATE: Target group has no content container');
    return false;
  }

  return _executeElementMove({ element, tabData, targetContent, oldOriginTabId, newOriginTabId });
}

/**
 * Execute element move between groups
 * v1.6.3.10-v8 - FIX Code Health: Use options object
 * @private
 */
function _executeElementMove({ element, tabData, targetContent, oldOriginTabId, newOriginTabId }) {
  const oldParent = element.parentElement;
  element.remove();
  element.classList.remove('orphaned-item');
  element.classList.add('adoption-animation');

  const isMinimized = isTabMinimizedHelper(tabData);
  const insertionPoint = _findInsertionPoint(targetContent, isMinimized);

  if (insertionPoint) {
    targetContent.insertBefore(element, insertionPoint);
  } else {
    targetContent.appendChild(element);
  }

  _updateGroupCountAfterMove(oldOriginTabId, newOriginTabId);
  _cleanupEmptySourceGroup(oldParent, oldOriginTabId);

  setTimeout(() => element.classList.remove('adoption-animation'), ANIMATION_DURATION_MS);

  console.log('[Manager] SURGICAL_MOVE_COMPLETE:', {
    quickTabId: tabData.id,
    fromGroup: oldOriginTabId,
    toGroup: newOriginTabId
  });
  return true;
}

/**
 * Find the correct insertion point within a group's content
 * v1.6.3.10-v5 - FIX Bug #3: Helper for surgical DOM insertion
 * @private
 * @param {HTMLElement} content - The group content container
 * @param {boolean} isMinimized - Whether the Quick Tab is minimized
 * @returns {HTMLElement|null} The element to insert before, or null to append
 */
function _findInsertionPoint(content, isMinimized) {
  if (isMinimized) {
    // Minimized tabs go at the end
    return null;
  }

  // Active tabs go before minimized tabs
  // Find the first minimized item or section divider
  const minimizedItem = content.querySelector('.quick-tab-item.minimized');
  const sectionDivider = content.querySelector('.section-divider');

  return sectionDivider || minimizedItem || null;
}

/**
 * Insert a Quick Tab into its target group
 * v1.6.3.10-v5 - FIX Bug #3: Creates element and inserts with animation
 * @private
 * @param {Object} tabData - Quick Tab data
 * @param {number} targetOriginTabId - Target group's origin tab ID
 * @returns {boolean} True if insertion succeeded
 */
function _insertQuickTabIntoGroup(tabData, targetOriginTabId) {
  const targetGroup = containersList.querySelector(
    `.tab-group[data-origin-tab-id="${targetOriginTabId}"]`
  );

  if (!targetGroup) {
    console.log('[Manager] SURGICAL_INSERT: Target group not found:', { targetOriginTabId });
    return false;
  }

  const targetContent = targetGroup.querySelector('.tab-group-content');
  if (!targetContent) {
    return false;
  }

  // Create and insert the element
  return _createAndInsertQuickTabElement(tabData, targetContent, targetOriginTabId);
}

/**
 * Create and insert a Quick Tab element into target content
 * v1.6.3.10-v5 - FIX Bug #3: Extracted to reduce nesting depth
 * @private
 * @param {Object} tabData - Quick Tab data
 * @param {HTMLElement} targetContent - Target content container
 * @param {number} targetOriginTabId - Target group's origin tab ID
 * @returns {boolean} True if successful
 */
function _createAndInsertQuickTabElement(tabData, targetContent, targetOriginTabId) {
  // Create the Quick Tab element
  const isMinimized = isTabMinimizedHelper(tabData);
  const newElement = renderQuickTabItem(tabData, 'global', isMinimized);

  // Add adoption animation class ONLY to this new element
  newElement.classList.add('adoption-animation');

  // Find insertion point and insert
  const insertionPoint = _findInsertionPoint(targetContent, isMinimized);
  if (insertionPoint) {
    targetContent.insertBefore(newElement, insertionPoint);
  } else {
    targetContent.appendChild(newElement);
  }

  // Update group count
  _adjustGroupCount(targetOriginTabId, 1);

  // Remove animation class after animation completes
  setTimeout(() => {
    newElement.classList.remove('adoption-animation');
  }, ANIMATION_DURATION_MS);

  console.log('[Manager] SURGICAL_INSERT_COMPLETE:', {
    quickTabId: tabData.id,
    targetGroup: targetOriginTabId
  });

  return true;
}

/**
 * Remove a Quick Tab element from DOM and clean up source group
 * v1.6.3.10-v5 - FIX Bug #3: Helper for surgical removal
 * @private
 * @param {HTMLElement} element - The element to remove
 * @param {number|string|null} sourceGroupKey - The source group's key
 */
function _removeQuickTabFromDOM(element, sourceGroupKey) {
  const parent = element.parentElement;
  element.remove();

  // Update source group count
  _adjustGroupCount(sourceGroupKey, -1);

  // Clean up empty source group
  _cleanupEmptySourceGroup(parent, sourceGroupKey);
}

/**
 * Update group counts after moving a Quick Tab
 * v1.6.3.10-v5 - FIX Bug #3: Updates count badges without re-render
 * v1.6.3.12-v7 - Refactored: Use unified _adjustGroupCount
 * @private
 * @param {number|string|null} oldGroupKey - Previous group key
 * @param {number} newGroupKey - New group key
 */
function _updateGroupCountAfterMove(oldGroupKey, newGroupKey) {
  _adjustGroupCount(oldGroupKey, -1);
  _adjustGroupCount(newGroupKey, 1);
}

/**
 * Adjust a group's count badge by delta
 * v1.6.3.12-v7 - Refactored: Combined _incrementGroupCount and _decrementGroupCount
 * @private
 * @param {number|string|null} groupKey - Group key
 * @param {number} delta - Amount to adjust by (positive or negative)
 */
function _adjustGroupCount(groupKey, delta) {
  if (groupKey === null || groupKey === undefined) return;

  const group = containersList.querySelector(`.tab-group[data-origin-tab-id="${groupKey}"]`);
  if (!group) return;

  const countBadge = group.querySelector('.tab-group-count');
  if (!countBadge) return;

  const currentCount = parseInt(countBadge.textContent, 10) || 0;
  const newCount = Math.max(0, currentCount + delta);
  countBadge.textContent = String(newCount);
  countBadge.dataset.count = String(newCount);

  // Add visual feedback based on direction
  const feedbackClass = delta > 0 ? 'count-increased' : 'count-decreased';
  countBadge.classList.add(feedbackClass);
  setTimeout(() => countBadge.classList.remove(feedbackClass), 300);
}

/**
 * Clean up a source group if it's now empty after moving a Quick Tab
 * v1.6.3.10-v5 - FIX Bug #3: Removes empty groups with animation
 * Refactored with early returns to reduce nesting depth
 * @private
 * @param {HTMLElement|null} contentParent - The content container that was the parent
 * @param {number|string|null} groupKey - The group key
 */
function _cleanupEmptySourceGroup(contentParent, groupKey) {
  if (!contentParent) return;

  // Check if the content has any remaining Quick Tab items
  const remainingItems = contentParent.querySelectorAll('.quick-tab-item');
  if (remainingItems.length > 0) return;

  // Find the parent details element
  const groupElement = contentParent.closest('.tab-group');
  if (!groupElement) return;

  // Perform the cleanup
  _animateGroupRemovalAndCleanup(groupElement, groupKey);
}

/**
 * Animate group removal and clean up tracking
 * v1.6.3.10-v5 - FIX Bug #3: Extracted to reduce nesting depth
 * @private
 * @param {HTMLElement} groupElement - The group element to remove
 * @param {number|string|null} groupKey - The group key
 */
function _animateGroupRemovalAndCleanup(groupElement, groupKey) {
  console.log('[Manager] SURGICAL_CLEANUP: Removing empty group:', { groupKey });

  // Use the existing animation for group removal
  groupElement.classList.add('removing');
  setTimeout(() => {
    if (groupElement.parentNode) {
      groupElement.remove();
    }
  }, ANIMATION_DURATION_MS);

  // Update previousGroupCounts tracking
  if (previousGroupCounts.has(String(groupKey))) {
    previousGroupCounts.delete(String(groupKey));
  }
}

/**
 * Handle origin tab closed - mark Quick Tabs as orphaned in UI
 * v1.6.3.10-v3 - Phase 2: Orphan detection
 * @param {Object} message - Origin tab closed message
 */
function handleOriginTabClosed(message) {
  const { originTabId, orphanedQuickTabIds, orphanedCount, timestamp } = message;

  console.log('[Manager] ORIGIN_TAB_CLOSED received:', {
    originTabId,
    orphanedCount,
    orphanedIds: orphanedQuickTabIds,
    timeSinceBroadcast: Date.now() - timestamp
  });

  // Update cache staleness tracking
  lastCacheSyncFromStorage = Date.now();

  // Invalidate browser tab info cache for the closed tab
  browserTabInfoCache.delete(originTabId);

  // Schedule high-priority re-render to show orphan warnings
  scheduleRender('origin-tab-closed');

  console.log('[Manager] ORPHAN_RENDER_SCHEDULED:', {
    orphanedCount,
    trigger: 'port-ORIGIN_TAB_CLOSED'
  });
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
    // v1.6.4 - ADD fallback messaging: Wrap port.postMessage and try runtime.sendMessage on failure
    try {
      backgroundPort.postMessage(messageWithCorrelation);
      console.log('[Manager] Sent message with ack request via port:', {
        type: message.type,
        action: message.action,
        correlationId
      });
    } catch (err) {
      console.warn('[Manager] Port send failed, trying runtime.sendMessage fallback:', err.message);

      // v1.6.4 - ADD fallback messaging: Try browser.runtime.sendMessage as fallback
      browser.runtime
        .sendMessage({
          ...messageWithCorrelation,
          source: 'sendMessage_fallback'
        })
        .then(response => {
          clearTimeout(timeout);
          pendingAcks.delete(correlationId);
          console.log('[Manager] Fallback sendMessage succeeded:', {
            type: message.type,
            correlationId
          });
          resolve(response || { success: true, method: 'sendMessage_fallback', correlationId });
        })
        .catch(sendErr => {
          clearTimeout(timeout);
          pendingAcks.delete(correlationId);
          console.error('[Manager] Both port and sendMessage failed:', {
            type: message.type,
            portError: err.message,
            sendMessageError: sendErr.message
          });
          reject(err); // Reject with original port error
        });
      return; // Don't reject here - let the fallback handle it
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
  if (cached && Date.now() - cached.timestamp < BROWSER_TAB_CACHE_TTL_MS) {
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

// ==================== v1.6.4 MANAGER STATE PERSISTENCE ====================
// FIX Issue #48/#7: Sidebar State Not Persisting Between Firefox Sessions
// Firefox's xulstore.json is unreliable - persist manager UI state to storage.local

/**
 * Load manager UI state from browser.storage.local
 * v1.6.4 - FIX Issue #48/#7: Manager state persistence across Firefox sessions
 * @returns {Promise<Object>} Manager state object with scrollPosition
 */
async function loadManagerState() {
  try {
    const result = await browser.storage.local.get(MANAGER_STATE_KEY);
    const state = result?.[MANAGER_STATE_KEY] || {};

    console.log('[Manager] MANAGER_STATE_LOADED:', {
      timestamp: Date.now(),
      scrollPosition: state.scrollPosition ?? 0,
      savedAt: state.savedAt ?? null,
      hasState: !!result?.[MANAGER_STATE_KEY]
    });

    return state;
  } catch (err) {
    console.warn('[Manager] Failed to load manager state:', err);
    return {};
  }
}

/**
 * Save manager UI state to browser.storage.local
 * v1.6.4 - FIX Issue #48/#7: Manager state persistence across Firefox sessions
 * @param {Object} managerState - Manager state object with scrollPosition
 */
async function saveManagerState(managerState) {
  try {
    const stateToSave = {
      ...managerState,
      savedAt: Date.now()
    };

    await browser.storage.local.set({ [MANAGER_STATE_KEY]: stateToSave });

    console.log('[Manager] MANAGER_STATE_SAVED:', {
      timestamp: Date.now(),
      scrollPosition: stateToSave.scrollPosition ?? 0
    });
  } catch (err) {
    console.warn('[Manager] Failed to save manager state:', err);
  }
}

/**
 * Save scroll position with debouncing to avoid excessive storage writes
 * v1.6.4 - FIX Issue #48/#7: Debounced scroll position persistence
 * @private
 * @param {number} scrollTop - Current scroll position
 */
function _saveScrollPositionDebounced(scrollTop) {
  // Clear any existing timer
  if (_scrollPositionSaveTimer) {
    clearTimeout(_scrollPositionSaveTimer);
  }

  // Schedule save with debounce
  // v1.6.4 - Simplified: directly save scroll position without loading full state
  // Scroll position is the primary state we care about - other fields are preserved
  // by the storage.local merge semantics
  _scrollPositionSaveTimer = setTimeout(async () => {
    _scrollPositionSaveTimer = null;
    await saveManagerState({ scrollPosition: scrollTop });
  }, SCROLL_POSITION_SAVE_DEBOUNCE_MS);
}

/**
 * Restore manager scroll position from storage
 * v1.6.4 - FIX Issue #48/#7: Restore scroll position on manager initialization
 * @private
 */
async function _restoreManagerScrollPosition() {
  if (!containersList) {
    console.warn('[Manager] Cannot restore scroll position - containersList not found');
    return;
  }

  try {
    const managerState = await loadManagerState();
    const savedScrollPosition = managerState.scrollPosition;

    // v1.6.4 - Only restore if we have a valid saved scroll position
    // Position 0 is the default, so we skip restoring if undefined/null or if explicitly 0
    // This avoids unnecessary DOM manipulation when scroll position wasn't explicitly saved
    if (typeof savedScrollPosition === 'number' && savedScrollPosition > 0) {
      // Use requestAnimationFrame to ensure DOM is ready before scrolling
      requestAnimationFrame(() => {
        containersList.scrollTop = savedScrollPosition;

        console.log('[Manager] SCROLL_POSITION_RESTORED:', {
          timestamp: Date.now(),
          scrollPosition: savedScrollPosition,
          actualScrollTop: containersList.scrollTop
        });
      });
    }
  } catch (err) {
    console.warn('[Manager] Failed to restore scroll position:', err);
  }
}

/**
 * Setup scroll position persistence listener
 * v1.6.4 - FIX Issue #48/#7: Save scroll position on scroll events
 * @private
 */
function _setupScrollPositionPersistence() {
  if (!containersList) {
    console.warn('[Manager] Cannot setup scroll persistence - containersList not found');
    return;
  }

  containersList.addEventListener('scroll', () => {
    const scrollTop = containersList.scrollTop;
    _saveScrollPositionDebounced(scrollTop);
  });

  console.log('[Manager] SCROLL_PERSISTENCE_SETUP: scroll listener attached', {
    timestamp: Date.now(),
    debounceMs: SCROLL_POSITION_SAVE_DEBOUNCE_MS
  });
}

// ==================== END MANAGER STATE PERSISTENCE ====================

/**
 * Dispatch incoming runtime message to appropriate handler
 * v1.6.3.11-v12 - FIX Issue #5: Refactored from inline listener to reduce complexity
 * @param {Object} message - Incoming message
 * @param {Function} sendResponse - Response callback
 * @returns {boolean} True if message was handled, false otherwise
 */
function _dispatchRuntimeMessage(message, sendResponse) {
  const handlers = {
    QUICK_TAB_STATE_UPDATED: () => _handleStateUpdatedMessage(message, sendResponse),
    QUICK_TAB_DELETED: () => _handleDeletedMessage(message, sendResponse),
    QUICKTAB_MOVED: () => _handleMovedMessage(message, sendResponse),
    QUICKTAB_RESIZED: () => _handleResizedMessage(message, sendResponse),
    QUICKTAB_MINIMIZED: () => _handleMinimizedMessage(message, sendResponse),
    QUICKTAB_REMOVED: () => _handleRemovedMessage(message, sendResponse)
  };

  const handler = handlers[message.type];
  if (handler) {
    return handler();
  }
  return false;
}

/**
 * Handle QUICK_TAB_STATE_UPDATED message
 * @private
 */
function _handleStateUpdatedMessage(message, sendResponse) {
  console.log('[Manager] Received QUICK_TAB_STATE_UPDATED:', {
    quickTabId: message.quickTabId,
    changes: message.changes,
    source: message.originalSource
  });

  if (message.changes?.deleted === true || message.originalSource === 'destroy') {
    handleStateDeletedMessage(message.quickTabId);
  } else if (message.quickTabId && message.changes) {
    handleStateUpdateMessage(message.quickTabId, message.changes);
  }

  // v1.6.3.11-v12 - FIX: Route through scheduleRender for consistency
  scheduleRender('QUICK_TAB_STATE_UPDATED');
  sendResponse({ received: true });
  return true;
}

/**
 * Handle QUICK_TAB_DELETED message
 * @private
 */
function _handleDeletedMessage(message, sendResponse) {
  console.log('[Manager] Received QUICK_TAB_DELETED:', {
    quickTabId: message.quickTabId,
    source: message.source
  });

  handleStateDeletedMessage(message.quickTabId);
  // v1.6.3.11-v12 - FIX: Route through scheduleRender for consistency
  scheduleRender('QUICK_TAB_DELETED');
  sendResponse({ received: true });
  return true;
}

/**
 * Generic message dispatcher for Quick Tab state changes
 * v1.6.3.12-v7 - Refactored: Extracted common pattern from _handleMovedMessage, _handleResizedMessage, _handleMinimizedMessage
 * @private
 * @param {Object} params - Dispatch parameters
 * @param {string} params.emoji - Log emoji
 * @param {string} params.logLabel - Log label (e.g., 'QUICKTAB_MOVED')
 * @param {Object} params.logFields - Fields to log
 * @param {Function} params.handler - Handler function to call
 * @param {Object} params.message - Original message
 * @param {Function} params.sendResponse - Response callback
 * @returns {boolean} True to indicate async response
 */
function _dispatchQuickTabMessage({ emoji, logLabel, logFields, handler, message, sendResponse }) {
  console.log(`[Manager] ${emoji} Received ${logLabel}:`, logFields);
  handler(message);
  sendResponse({ received: true });
  return true;
}

/**
 * Message dispatcher configuration
 * v1.6.3.12-v7 - Use lookup table to eliminate code duplication
 * @private
 */
const _messageDispatcherConfig = {
  MOVED: {
    emoji: '📍',
    logLabel: 'QUICKTAB_MOVED',
    extractLogFields: msg => ({
      quickTabId: msg.quickTabId,
      left: msg.left,
      top: msg.top,
      originTabId: msg.originTabId
    }),
    handler: handleQuickTabMovedMessage
  },
  RESIZED: {
    emoji: '📐',
    logLabel: 'QUICKTAB_RESIZED',
    extractLogFields: msg => ({
      quickTabId: msg.quickTabId,
      width: msg.width,
      height: msg.height,
      originTabId: msg.originTabId
    }),
    handler: handleQuickTabResizedMessage
  },
  MINIMIZED: {
    emoji: '🔽',
    logLabel: 'QUICKTAB_MINIMIZED',
    extractLogFields: msg => ({
      quickTabId: msg.quickTabId,
      minimized: msg.minimized,
      originTabId: msg.originTabId
    }),
    handler: handleQuickTabMinimizedMessage
  }
};

/**
 * Create message handler using config lookup
 * v1.6.3.12-v7 - Refactored: Factory function to eliminate duplication
 * @private
 */
function _createMessageDispatcher(configKey) {
  const config = _messageDispatcherConfig[configKey];
  return (message, sendResponse) =>
    _dispatchQuickTabMessage({
      emoji: config.emoji,
      logLabel: config.logLabel,
      logFields: config.extractLogFields(message),
      handler: config.handler,
      message,
      sendResponse
    });
}

// Create dispatch handlers using factory
const _handleMovedMessage = _createMessageDispatcher('MOVED');
const _handleResizedMessage = _createMessageDispatcher('RESIZED');
const _handleMinimizedMessage = _createMessageDispatcher('MINIMIZED');

/**
 * Handle QUICKTAB_REMOVED message
 * @private
 */
function _handleRemovedMessage(message, sendResponse) {
  // v1.6.3.11-v12 - FIX Issue #6: Track event for staleness detection
  _markEventReceived();

  console.log('[Manager] ❌ Received QUICKTAB_REMOVED:', {
    quickTabId: message.quickTabId,
    originTabId: message.originTabId,
    source: message.source
  });

  handleStateDeletedMessage(message.quickTabId);
  scheduleRender('QUICKTAB_REMOVED');
  sendResponse({ received: true });
  return true;
}

// v1.6.3.5-v3 - FIX Architecture Phase 1: Listen for state updates from background
// v1.6.3.5-v11 - FIX Issue #6: Handle QUICK_TAB_DELETED message and deletion via QUICK_TAB_STATE_UPDATED
// v1.6.3.11-v12 - FIX Issue #5: Handle QUICKTAB_MOVED, QUICKTAB_RESIZED, QUICKTAB_MINIMIZED, QUICKTAB_REMOVED
browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  return _dispatchRuntimeMessage(message, sendResponse);
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
 * Generic handler for Quick Tab property updates from content script
 * v1.6.3.12-v7 - Refactored: Extracted common pattern from handleQuickTab*Message functions
 * @private
 * @param {Object} params - Handler parameters
 * @param {string} params.quickTabId - Quick Tab ID
 * @param {Object} params.updates - Properties to update on the tab
 * @param {number|null} params.originTabId - Origin tab ID (optional)
 * @param {string} params.logLabel - Log label for this handler
 * @param {string} params.renderReason - Reason string for scheduleRender
 * @param {Object} params.logFields - Additional fields to log
 */
function _handleQuickTabPropertyUpdate({
  quickTabId,
  updates,
  originTabId,
  logLabel,
  renderReason,
  logFields
}) {
  // Track event for staleness detection
  _markEventReceived();

  console.log(`[Manager] [${logLabel}] Processing update:`, logFields);

  if (!quickTabsState.tabs) {
    quickTabsState = { tabs: [] };
  }

  const existingIndex = quickTabsState.tabs.findIndex(t => t.id === quickTabId);
  if (existingIndex >= 0) {
    Object.assign(quickTabsState.tabs[existingIndex], updates);
    console.log(`[Manager] [${logLabel}] Updated for:`, quickTabId);
  } else {
    console.warn(`[Manager] [${logLabel}] Tab not found in state:`, quickTabId);
  }

  // Update host info if originTabId provided
  if (originTabId != null) {
    _updateQuickTabHostInfo(quickTabId, { originTabId, ...updates });
  }

  // Update timestamp
  quickTabsState.timestamp = Date.now();
  lastLocalUpdateTime = Date.now();

  // Schedule render for UI update
  scheduleRender(renderReason);
}

/**
 * Quick Tab message handler configuration
 * v1.6.3.12-v7 - Use lookup table to eliminate code duplication
 * @private
 */
const _quickTabMessageHandlerConfig = {
  MOVED: {
    extractUpdates: msg => ({ left: msg.left, top: msg.top }),
    extractLogFields: msg => ({
      quickTabId: msg.quickTabId,
      left: msg.left,
      top: msg.top,
      originTabId: msg.originTabId
    }),
    logLabel: 'MOVE_HANDLER',
    renderReason: 'QUICKTAB_MOVED'
  },
  RESIZED: {
    extractUpdates: msg => ({ width: msg.width, height: msg.height }),
    extractLogFields: msg => ({
      quickTabId: msg.quickTabId,
      width: msg.width,
      height: msg.height,
      originTabId: msg.originTabId
    }),
    logLabel: 'RESIZE_HANDLER',
    renderReason: 'QUICKTAB_RESIZED'
  },
  MINIMIZED: {
    extractUpdates: msg => ({ minimized: msg.minimized }),
    extractLogFields: msg => ({
      quickTabId: msg.quickTabId,
      minimized: msg.minimized,
      originTabId: msg.originTabId
    }),
    logLabel: 'MINIMIZE_HANDLER',
    renderReason: 'QUICKTAB_MINIMIZED'
  }
};

/**
 * Generic Quick Tab message handler using config lookup
 * v1.6.3.12-v7 - Refactored: Eliminate duplication via configuration
 * @private
 */
function _handleQuickTabMessage(message, configKey) {
  const config = _quickTabMessageHandlerConfig[configKey];
  const { quickTabId, originTabId } = message;
  _handleQuickTabPropertyUpdate({
    quickTabId,
    updates: config.extractUpdates(message),
    originTabId,
    logLabel: config.logLabel,
    renderReason: config.renderReason,
    logFields: config.extractLogFields(message)
  });
}

/**
 * Handle QUICKTAB_MOVED message from content script
 * v1.6.3.11-v12 - FIX Issue #5: Real-time position update handler
 * v1.6.3.12-v7 - Refactored: Use config-based handler
 * @param {Object} message - QUICKTAB_MOVED message
 */
function handleQuickTabMovedMessage(message) {
  _handleQuickTabMessage(message, 'MOVED');
}

/**
 * Handle QUICKTAB_RESIZED message from content script
 * v1.6.3.11-v12 - FIX Issue #5: Real-time size update handler
 * v1.6.3.12-v7 - Refactored: Use config-based handler
 * @param {Object} message - QUICKTAB_RESIZED message
 */
function handleQuickTabResizedMessage(message) {
  _handleQuickTabMessage(message, 'RESIZED');
}

/**
 * Handle QUICKTAB_MINIMIZED message from content script
 * v1.6.3.11-v12 - FIX Issue #5: Real-time minimize state update handler
 * v1.6.3.12-v7 - Refactored: Use config-based handler
 * @param {Object} message - QUICKTAB_MINIMIZED message
 */
function handleQuickTabMinimizedMessage(message) {
  _handleQuickTabMessage(message, 'MINIMIZED');
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
 * v1.6.3.12-v7 - Refactored to reduce cyclomatic complexity from 17 to <9
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
  return (
    changes.left != null || changes.top != null || changes.width != null || changes.height != null
  );
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

// ==================== v1.6.3.10-v7 HOST INFO MAINTENANCE ====================
// FIX Bug #1: Periodic cleanup to prevent memory leaks

/**
 * Start periodic maintenance task for quickTabHostInfo
 * v1.6.3.10-v7 - FIX Bug #1: Prevents memory leak from orphaned entries
 */
function _startHostInfoMaintenance() {
  // Clear any existing interval
  if (hostInfoMaintenanceIntervalId) {
    clearInterval(hostInfoMaintenanceIntervalId);
  }

  // Run maintenance every 5 minutes
  hostInfoMaintenanceIntervalId = setInterval(() => {
    _performHostInfoMaintenance();
  }, HOST_INFO_MAINTENANCE_INTERVAL_MS);

  console.log('[Manager] HOST_INFO_MAINTENANCE_STARTED:', {
    intervalMs: HOST_INFO_MAINTENANCE_INTERVAL_MS,
    maxEntries: HOST_INFO_MAX_ENTRIES
  });
}

/**
 * Stop periodic maintenance task
 * v1.6.3.10-v7 - FIX Bug #1: Cleanup on unload
 */
function _stopHostInfoMaintenance() {
  if (hostInfoMaintenanceIntervalId) {
    clearInterval(hostInfoMaintenanceIntervalId);
    hostInfoMaintenanceIntervalId = null;
    console.log('[Manager] HOST_INFO_MAINTENANCE_STOPPED');
  }
}

// ==================== v1.6.4 FIX Issue #17: Browser Tab Cache Audit ====================

/**
 * Start periodic browser tab cache audit
 * v1.6.4 - FIX Issue #17: Remove expired entries and validate remaining entries
 */
function _startBrowserTabCacheAudit() {
  // Clear any existing interval
  if (browserTabCacheAuditIntervalId) {
    clearInterval(browserTabCacheAuditIntervalId);
  }

  // Run audit every 5 minutes
  browserTabCacheAuditIntervalId = setInterval(() => {
    _performBrowserTabCacheAudit();
  }, BROWSER_TAB_CACHE_AUDIT_INTERVAL_MS);

  console.log('[Manager] BROWSER_TAB_CACHE_AUDIT_STARTED:', {
    intervalMs: BROWSER_TAB_CACHE_AUDIT_INTERVAL_MS,
    currentCacheSize: browserTabInfoCache.size
  });
}

/**
 * Stop periodic browser tab cache audit
 * v1.6.4 - FIX Issue #17: Cleanup on unload
 */
function _stopBrowserTabCacheAudit() {
  if (browserTabCacheAuditIntervalId) {
    clearInterval(browserTabCacheAuditIntervalId);
    browserTabCacheAuditIntervalId = null;
    console.log('[Manager] BROWSER_TAB_CACHE_AUDIT_STOPPED');
  }
}

/**
 * Perform browser tab cache audit
 * v1.6.4 - FIX Issue #17: Check if cached entries are still valid
 * Removes expired entries and verifies remaining entries exist
 */
async function _performBrowserTabCacheAudit() {
  const auditStartTime = Date.now();
  const cacheSize = browserTabInfoCache.size;

  if (cacheSize === 0) {
    console.log('[Manager] BROWSER_TAB_CACHE_AUDIT: Cache is empty, skipping');
    return;
  }

  const expiredEntries = [];
  const invalidatedEntries = [];
  const validEntries = [];

  // Iterate through all cached entries
  for (const [tabId, cached] of browserTabInfoCache.entries()) {
    // Check if entry is expired (TTL exceeded)
    if (Date.now() - cached.timestamp > BROWSER_TAB_CACHE_TTL_MS) {
      expiredEntries.push(tabId);
      continue;
    }

    // If cache indicates tab is closed (data === null), skip validation
    if (cached.data === null) {
      validEntries.push(tabId);
      continue;
    }

    // Verify tab still exists
    try {
      await browser.tabs.get(tabId);
      validEntries.push(tabId);
    } catch (_err) {
      // Tab no longer exists - mark cache entry as closed
      browserTabInfoCache.set(tabId, {
        data: null,
        timestamp: Date.now()
      });
      invalidatedEntries.push(tabId);
    }
  }

  // Remove expired entries
  for (const tabId of expiredEntries) {
    browserTabInfoCache.delete(tabId);
  }

  const auditDurationMs = Date.now() - auditStartTime;

  console.log('[Manager] BROWSER_TAB_CACHE_AUDIT_COMPLETE:', {
    timestamp: Date.now(),
    originalCacheSize: cacheSize,
    expiredEntriesRemoved: expiredEntries.length,
    entriesInvalidated: invalidatedEntries.length,
    validEntries: validEntries.length,
    finalCacheSize: browserTabInfoCache.size,
    auditDurationMs
  });

  // If entries were invalidated (tabs closed), trigger re-render for orphan detection
  if (invalidatedEntries.length > 0) {
    console.log(
      '[Manager] BROWSER_TAB_CACHE_AUDIT: Tabs closed, scheduling render for orphan detection',
      {
        closedTabIds: invalidatedEntries
      }
    );
    scheduleRender('cache-audit-invalidation');
  }
}

// ==================== END v1.6.4 FIX Issue #17 ====================

// ==================== v1.6.3.12-v11 FIX Issue #12: Tab Navigation Cache Invalidation ====================
/**
 * Handler for browser.tabs.onUpdated events
 * Invalidates browserTabInfoCache when tabs navigate to new URLs
 * v1.6.3.12-v11 - FIX Issue #12: Proactive cache invalidation on tab navigation
 * @param {number} tabId - Tab that was updated
 * @param {Object} changeInfo - What changed in the tab
 * @param {Object} _tab - Full tab info (unused)
 */
function _handleTabUpdated(tabId, changeInfo, _tab) {
  // Only invalidate cache when URL changes (navigation)
  // This catches: new page load, same-page navigation, redirects
  if (changeInfo.url) {
    // Optimized: Map.delete() returns true if key existed, no need for separate has() check
    const wasDeleted = browserTabInfoCache.delete(tabId);
    if (wasDeleted) {
      const urlLength = changeInfo.url.length;
      console.log('[Manager] BROWSER_TAB_CACHE_INVALIDATED:', {
        timestamp: Date.now(),
        tabId,
        reason: 'tab_navigation',
        newUrl: changeInfo.url.substring(0, 50) + (urlLength > 50 ? '...' : ''),
        remainingCacheSize: browserTabInfoCache.size
      });
    }
  }
}

/**
 * Check if browser.tabs.onUpdated API is available
 * v1.6.3.12-v12 - FIX Code Health: Extract complex conditional
 * @private
 * @returns {boolean} True if API is available
 */
function _isTabsOnUpdatedAvailable() {
  return typeof browser !== 'undefined' && browser.tabs && browser.tabs.onUpdated;
}

/**
 * Start listening for tab updates to invalidate cache
 * v1.6.3.12-v11 - FIX Issue #12: Register tabs.onUpdated listener
 * v1.6.3.12-v12 - FIX Code Health: Extract complex conditional
 */
function _startTabUpdateListener() {
  if (_isTabsOnUpdatedAvailable()) {
    browser.tabs.onUpdated.addListener(_handleTabUpdated);
    console.log('[Manager] TAB_UPDATE_LISTENER_STARTED:', {
      timestamp: Date.now(),
      reason: 'cache_invalidation_on_navigation'
    });
  } else {
    console.warn('[Manager] TAB_UPDATE_LISTENER_UNAVAILABLE: browser.tabs.onUpdated not available');
  }
}

/**
 * Stop listening for tab updates (cleanup on unload)
 * v1.6.3.12-v11 - FIX Issue #12: Cleanup tab update listener
 * v1.6.3.12-v12 - FIX Code Health: Use extracted predicate
 */
function _stopTabUpdateListener() {
  if (_isTabsOnUpdatedAvailable()) {
    browser.tabs.onUpdated.removeListener(_handleTabUpdated);
    console.log('[Manager] TAB_UPDATE_LISTENER_STOPPED');
  }
}
// ==================== END v1.6.3.12-v11 FIX Issue #12 ====================

/**
 * Get set of valid Quick Tab IDs from current state
 * v1.6.3.11-v3 - FIX CodeScene: Extract from _performHostInfoMaintenance
 * @private
 * @returns {Set} Set of valid Quick Tab IDs
 */
function _getValidQuickTabIds() {
  const validIds = new Set();
  if (quickTabsState?.tabs && Array.isArray(quickTabsState.tabs)) {
    quickTabsState.tabs.forEach(tab => validIds.add(tab.id));
  }
  return validIds;
}

/**
 * Find orphaned host info entries
 * v1.6.3.11-v3 - FIX CodeScene: Extract from _performHostInfoMaintenance
 * @private
 * @param {Set} validQuickTabIds - Set of valid Quick Tab IDs
 * @returns {Array} Array of orphaned entry IDs
 */
function _findOrphanedHostInfoEntries(validQuickTabIds) {
  const orphaned = [];
  for (const [quickTabId] of quickTabHostInfo.entries()) {
    if (!validQuickTabIds.has(quickTabId)) {
      orphaned.push(quickTabId);
    }
  }
  return orphaned;
}

/**
 * Perform maintenance on quickTabHostInfo - remove orphaned entries
 * v1.6.3.10-v7 - FIX Bug #1: Validates entries against current quickTabsState
 * v1.6.3.11-v3 - FIX CodeScene: Reduce complexity by extracting helpers
 */
function _performHostInfoMaintenance() {
  const startTime = Date.now();
  const entriesBefore = quickTabHostInfo.size;

  if (entriesBefore === 0) return;

  const validQuickTabIds = _getValidQuickTabIds();
  const orphanedEntries = _findOrphanedHostInfoEntries(validQuickTabIds);

  // Delete orphaned entries
  orphanedEntries.forEach(id => quickTabHostInfo.delete(id));

  // Check if we still exceed max size - prune oldest entries
  const prunedOldest = _pruneOldestHostInfoEntries();

  if (orphanedEntries.length > 0 || prunedOldest > 0) {
    console.log('[Manager] HOST_INFO_MAINTENANCE_COMPLETE:', {
      entriesBefore,
      entriesAfter: quickTabHostInfo.size,
      orphanedRemoved: orphanedEntries.length,
      oldestPruned: prunedOldest,
      validQuickTabCount: validQuickTabIds.size,
      durationMs: Date.now() - startTime
    });
  }
}

/**
 * Prune oldest entries if map exceeds max size
 * v1.6.3.10-v7 - FIX Bug #1: Max size guard (500 entries)
 * @returns {number} Number of entries pruned
 */
function _pruneOldestHostInfoEntries() {
  if (quickTabHostInfo.size <= HOST_INFO_MAX_ENTRIES) {
    return 0;
  }

  // Convert to array and sort by lastUpdate (oldest first)
  const entries = Array.from(quickTabHostInfo.entries()).sort(
    (a, b) => (a[1].lastUpdate || 0) - (b[1].lastUpdate || 0)
  );

  // Calculate how many to remove
  const toRemove = quickTabHostInfo.size - HOST_INFO_MAX_ENTRIES;
  const removed = entries.slice(0, toRemove);

  // Remove oldest entries
  removed.forEach(([id]) => quickTabHostInfo.delete(id));

  console.log('[Manager] HOST_INFO_PRUNED_OLDEST:', {
    removed: toRemove,
    oldestRemovedIds: removed.slice(0, 5).map(([id]) => id), // Log first 5 for debug
    newSize: quickTabHostInfo.size
  });

  return toRemove;
}

// ==================== END HOST INFO MAINTENANCE ====================

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
  const initStartTimestamp = Date.now();

  // v1.6.4 - FIX Issue #22: Register storage.onChanged listener FIRST
  // This must happen BEFORE any async operations to ensure we don't miss
  // any storage changes that occur during initialization.
  // CRITICAL: The order is important - listener registration must be synchronous
  // and happen before connectToBackground() or loadQuickTabsState()
  _setupStorageOnChangedListener();
  console.log('[Manager] v1.6.4 STORAGE_LISTENER_REGISTERED_FIRST:', {
    timestamp: initStartTimestamp,
    note: 'Registered before any async operations'
  });

  // Cache DOM elements
  containersList = document.getElementById('containersList');
  emptyState = document.getElementById('emptyState');
  totalTabsEl = document.getElementById('totalTabs');
  lastSyncEl = document.getElementById('lastSync');

  // v1.6.4 - FIX BUG #4: Load saved group order before first render (delegated to OrderManager)
  await loadGroupOrderFromStorage();

  // v1.6.4 - FIX BUG #3: Load saved Quick Tab order within groups before first render (delegated to OrderManager)
  await loadQuickTabOrderFromStorage();

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

  // v1.6.4 - FIX Issue #22: Log hydration request timestamp for comparison with listener
  const hydrationRequestTimestamp = Date.now();
  console.log('[Manager] v1.6.4 HYDRATION_REQUEST_TIMING:', {
    listenerRegisteredAt: initStartTimestamp,
    hydrationRequestAt: hydrationRequestTimestamp,
    deltaMs: hydrationRequestTimestamp - initStartTimestamp,
    note: 'Listener was registered before this point'
  });

  // v1.6.3.6-v11 - FIX Issue #11: Establish persistent port connection
  connectToBackground();

  // v1.6.3.12 - Option 4: Also connect via Quick Tabs port for in-memory storage
  initializeQuickTabsPort();

  // Load container information from Firefox API
  await loadContainerInfo();

  // v1.6.4-v4 - FEATURE: Initialize container isolation AFTER container info loaded
  await initializeContainerIsolation();

  // Load Quick Tabs state from storage
  await loadQuickTabsState();

  // Render initial UI
  renderUI();

  // Setup event listeners (NOTE: storage.onChanged already registered above)
  setupEventListeners();

  // v1.6.4 - FIX Issue #48/#7: Setup scroll position persistence
  _setupScrollPositionPersistence();

  // v1.6.4 - FIX Issue #48/#7: Restore scroll position from storage
  await _restoreManagerScrollPosition();

  // v1.6.3.7-v1 - FIX ISSUE #1: Setup tab switch detection
  // Re-render UI when user switches browser tabs to show context-relevant Quick Tabs
  setupTabSwitchListener();

  // v1.6.3.10-v7 - FIX Bug #1: Start periodic maintenance for quickTabHostInfo
  _startHostInfoMaintenance();

  // v1.6.4 - FIX Issue #17: Start periodic browser tab cache audit
  _startBrowserTabCacheAudit();

  // v1.6.3.12-v11 - FIX Issue #12: Start tab update listener for cache invalidation
  _startTabUpdateListener();

  // v1.6.3.12-v4 - Gap #7: Start cache staleness monitoring
  _startCacheStalenessMonitor();

  // v1.6.4-v2 - FEATURE: Initialize live metrics footer
  await initializeMetrics();

  // Auto-refresh every 2 seconds
  // v1.6.3.11-v12 - FIX Issue #6: Enhanced with staleness detection
  setInterval(async () => {
    await loadQuickTabsState();
    renderUI();

    // v1.6.3.11-v12 - FIX Issue #6: Check for staleness
    _checkStaleness();
  }, 2000);

  // v1.6.3.11-v12 - FIX Issue #6: Request immediate sync on Manager open
  _requestImmediateSync();

  console.log(
    '[Manager] v1.6.4-v4 Container isolation + Port connection + Quick Tabs port + Host info maintenance + Cache staleness monitor + Browser tab cache audit + Scroll persistence initialized'
  );
});

/**
 * Check for staleness and log warning if no events received for threshold period
 * v1.6.3.11-v12 - FIX Issue #6: Staleness tracking for fallback sync
 * v1.6.3.12-v4 - Gap #7: Enhanced with cache staleness detection and auto-sync
 * @private
 */
function _checkStaleness() {
  if (lastEventReceivedTime === 0) {
    // No events received yet - this is normal on startup
    return;
  }

  const timeSinceLastEvent = Date.now() - lastEventReceivedTime;
  if (timeSinceLastEvent > STALENESS_THRESHOLD_MS) {
    console.warn('[Manager] ⚠️ STALENESS_WARNING: No events received for', {
      timeSinceLastEventMs: timeSinceLastEvent,
      thresholdMs: STALENESS_THRESHOLD_MS,
      lastEventReceivedTime,
      lastLocalUpdateTime,
      recommendation: 'Consider checking content script connectivity'
    });
  }
}

/**
 * Request cache sync with port fallback to runtime.sendMessage
 * v1.6.4 - ADD fallback messaging: Extracted from _checkCacheStaleness to reduce nesting
 * @private
 * @param {number} timestamp - Current timestamp
 */
function _requestCacheSyncWithFallback(timestamp) {
  const syncMessage = {
    type: 'GET_ALL_QUICK_TABS',
    reason: 'cache-staleness-auto-sync',
    timestamp,
    correlationId: _generatePortCorrelationId()
  };

  let portSucceeded = false;
  if (quickTabsPort) {
    try {
      quickTabsPort.postMessage(syncMessage);
      portSucceeded = true;
      console.log('[Manager] Cache sync request sent via port');
    } catch (err) {
      console.warn('[Manager] Cache sync port failed, trying fallback:', err.message);
    }
  }

  // v1.6.4 - ADD fallback messaging: Always try browser.runtime.sendMessage as fallback/backup
  if (!portSucceeded) {
    browser.runtime
      .sendMessage({ ...syncMessage, source: 'sendMessage_fallback' })
      .then(() => {
        console.log('[Manager] Cache sync request sent via runtime.sendMessage fallback');
      })
      .catch(sendErr => {
        console.error('[Manager] Cache sync request both methods failed:', sendErr.message);
      });
  }
}

/**
 * Check cache staleness and request sync if needed
 * v1.6.3.12-v4 - Gap #7: Dedicated cache staleness monitor
 *   - Warns if cache stale for >30 seconds (CACHE_STALENESS_ALERT_MS)
 *   - Requests full state sync if stale for >60 seconds (CACHE_STALENESS_AUTO_SYNC_MS)
 * @private
 */
function _checkCacheStaleness() {
  const now = Date.now();

  // Skip if no cache sync has happened yet (initial hydration pending)
  if (lastCacheSyncFromStorage === 0) {
    console.log('[Manager] CACHE_STALENESS_CHECK: Skipping - initial sync pending');
    return;
  }

  const cacheStalenessMs = now - lastCacheSyncFromStorage;

  // v1.6.3.12-v4 - Gap #7: Log periodic staleness check
  console.log('[Manager] CACHE_STALENESS_CHECK:', {
    timestamp: now,
    lastCacheSyncFromStorage,
    cacheStalenessMs,
    alertThresholdMs: CACHE_STALENESS_ALERT_MS,
    autoSyncThresholdMs: CACHE_STALENESS_AUTO_SYNC_MS,
    isStale: cacheStalenessMs > CACHE_STALENESS_ALERT_MS,
    needsAutoSync: cacheStalenessMs > CACHE_STALENESS_AUTO_SYNC_MS
  });

  // v1.6.3.12-v4 - Gap #7: Auto-sync if severely stale (>60 seconds)
  if (cacheStalenessMs > CACHE_STALENESS_AUTO_SYNC_MS) {
    console.warn('[Manager] ⚠️ CACHE_STALENESS_AUTO_SYNC: Cache severely stale, requesting sync', {
      cacheStalenessMs,
      thresholdMs: CACHE_STALENESS_AUTO_SYNC_MS,
      lastCacheSyncFromStorage,
      recoveryAction: 'requesting full state sync from background'
    });

    // v1.6.4 - ADD fallback messaging: Extracted to helper to reduce nesting
    _requestCacheSyncWithFallback(now);
    return;
  }

  // v1.6.3.12-v4 - Gap #7: Warn if stale (>30 seconds)
  if (cacheStalenessMs > CACHE_STALENESS_ALERT_MS) {
    console.warn('[Manager] ⚠️ CACHE_STALENESS_ALERT: Cache stale for extended period', {
      cacheStalenessMs,
      thresholdMs: CACHE_STALENESS_ALERT_MS,
      lastCacheSyncFromStorage,
      recommendation: 'Port messaging may be disrupted, consider checking connection'
    });
  }
}

/**
 * Cache staleness check interval ID
 * v1.6.3.12-v4 - Gap #7: Track interval for cleanup
 * @private
 */
let _cacheStalenessIntervalId = null;

/**
 * Start periodic cache staleness monitoring
 * v1.6.3.12-v4 - Gap #7: Run every 10 seconds to detect stale cache
 * @private
 */
function _startCacheStalenessMonitor() {
  // Clear any existing interval
  if (_cacheStalenessIntervalId) {
    clearInterval(_cacheStalenessIntervalId);
  }

  // Start periodic check
  _cacheStalenessIntervalId = setInterval(_checkCacheStaleness, CACHE_STALENESS_CHECK_INTERVAL_MS);

  console.log('[Manager] CACHE_STALENESS_MONITOR_STARTED:', {
    intervalMs: CACHE_STALENESS_CHECK_INTERVAL_MS,
    alertThresholdMs: CACHE_STALENESS_ALERT_MS,
    autoSyncThresholdMs: CACHE_STALENESS_AUTO_SYNC_MS
  });
}

/**
 * Stop cache staleness monitoring
 * v1.6.3.12-v4 - Gap #7: Cleanup on unload
 * @private
 */
function _stopCacheStalenessMonitor() {
  if (_cacheStalenessIntervalId) {
    clearInterval(_cacheStalenessIntervalId);
    _cacheStalenessIntervalId = null;
    console.log('[Manager] CACHE_STALENESS_MONITOR_STOPPED');
  }
}

/**
 * Request immediate state sync from background when Manager opens
 * v1.6.3.11-v12 - FIX Issue #6: Ensure Manager has current state on open
 * @private
 */
async function _requestImmediateSync() {
  try {
    console.log('[Manager] [SYNC] Requesting immediate state sync on open');

    await browser.runtime.sendMessage({
      type: 'REQUEST_FULL_STATE_SYNC',
      source: 'Manager',
      timestamp: Date.now()
    });

    console.log('[Manager] [SYNC] Sync request sent');
  } catch (err) {
    console.debug('[Manager] [SYNC] Could not request sync:', err.message);
  }
}

/**
 * Update lastEventReceivedTime when any event is processed
 * v1.6.3.11-v12 - FIX Issue #6: Track last event for staleness detection
 * @private
 */
function _markEventReceived() {
  lastEventReceivedTime = Date.now();
}

// v1.6.3.6-v11 - FIX Issue #17: Port cleanup on window unload
// v1.6.3.6-v12 - FIX Issue #4: Also stop heartbeat on unload
// v1.6.3.10-v7 - FIX Bug #1: Also stop host info maintenance on unload
// v1.6.3.12-v4 - Gap #7: Also stop cache staleness monitor on unload
// v1.6.3.12-v7 - FIX Issue #11: Also disconnect quickTabsPort on unload
// v1.6.3.12-v11 - FIX Issue #12: Also stop tab update listener on unload
// v1.6.4-v2 - FEATURE: Also cleanup metrics on unload
window.addEventListener('unload', () => {
  console.log('[Sidebar] PORT_CLEANUP: Sidebar unloading, closing ports and stopping timers', {
    timestamp: Date.now(),
    hasBackgroundPort: !!backgroundPort,
    hasQuickTabsPort: !!quickTabsPort
  });

  // v1.6.3.6-v12 - FIX Issue #4: Stop heartbeat before disconnecting
  stopHeartbeat();

  // v1.6.3.10-v7 - FIX Bug #1: Stop host info maintenance
  _stopHostInfoMaintenance();

  // v1.6.3.12-v4 - Gap #7: Stop cache staleness monitor
  _stopCacheStalenessMonitor();

  // v1.6.3.12-v11 - FIX Issue #12: Stop tab update listener
  _stopTabUpdateListener();

  // v1.6.4-v2 - FEATURE: Cleanup live metrics
  cleanupMetrics();

  // v1.6.3.12-v7 - FIX Issue #11: Disconnect quickTabsPort on unload
  if (quickTabsPort) {
    console.log('[Sidebar] PORT_CLEANUP: Disconnecting quickTabsPort');
    try {
      quickTabsPort.disconnect();
    } catch (_err) {
      // Expected: Port may already be disconnected if background unloaded first
      // This is normal during browser shutdown or extension reload
      console.log(
        '[Sidebar] PORT_CLEANUP: quickTabsPort already disconnected (expected during shutdown)'
      );
    }
    quickTabsPort = null;
  }

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

  // v1.6.3.12-v7 - FIX Issue #11: Clear pending operation timestamps
  _quickTabPortOperationTimestamps.clear();
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
    console.log(
      '[Manager] Storage empty with single-tab cache - clearing cache (legitimate deletion)'
    );
    inMemoryTabsCache = [];
    lastKnownGoodTabCount = 0;
    quickTabsState = {};
    return;
  }

  // Multiple tabs in cache but storage empty - use cache (potential storm protection)
  if (inMemoryTabsCache.length > 1) {
    console.log(
      '[Manager] Storage returned empty but cache has',
      inMemoryTabsCache.length,
      'tabs - using cache'
    );
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
 * v1.6.3.6-v12 - FIX Issue #5: Trigger reconciliation instead of silently using cache
 * v1.6.3.10-v2 - FIX Issue #8: Cache NOT used as fallback for corrupted storage
 *   - Trigger immediate reconciliation instead
 *   - Cache only used for initial hydration on page load
 *   - Track cache staleness
 * @param {Object} state - Storage state
 * @returns {boolean} True if storm detected and handled
 */
function _detectStorageStorm(state) {
  const storageTabs = state.tabs || [];

  // No storm if storage has tabs
  if (storageTabs.length !== 0) {
    // v1.6.3.10-v2 - FIX Issue #8: Update cache sync timestamp when storage has valid data
    lastCacheSyncFromStorage = Date.now();
    return false;
  }

  // No cache to protect - no storm possible
  if (inMemoryTabsCache.length < MIN_TABS_FOR_CACHE_PROTECTION) {
    return false;
  }

  // v1.6.3.5-v11 - FIX Issue #6: Single tab deletion is legitimate, not a storm
  // If cache has exactly 1 tab and storage has 0, user closed the last Quick Tab
  if (inMemoryTabsCache.length === 1) {
    console.log(
      '[Manager] Single tab→0 transition detected - clearing cache (legitimate deletion)'
    );
    // Clear the cache to accept the new 0-tab state
    inMemoryTabsCache = [];
    lastKnownGoodTabCount = 0;
    lastCacheSyncFromStorage = Date.now();
    return false; // Not a storm - proceed with normal update
  }

  // v1.6.3.10-v2 - FIX Issue #8: Check cache staleness - alert if >30 seconds without refresh
  const cacheStalenessMs = Date.now() - lastCacheSyncFromStorage;
  if (cacheStalenessMs > CACHE_STALENESS_ALERT_MS) {
    console.warn('[Manager] CACHE_STALENESS_ALERT:', {
      stalenessMs: cacheStalenessMs,
      alertThresholdMs: CACHE_STALENESS_ALERT_MS,
      cacheTabCount: inMemoryTabsCache.length,
      lastSyncTimestamp: lastCacheSyncFromStorage
    });
  }

  // v1.6.3.6-v12 - FIX Issue #5: CACHE_DIVERGENCE - trigger reconciliation
  // v1.6.3.10-v2 - FIX Issue #8: Cache NOT used as fallback - reconciliation is authoritative
  console.warn('[Manager] v1.6.3.10-v2 CACHE_DIVERGENCE (no fallback):', {
    storageTabCount: storageTabs.length,
    cacheTabCount: inMemoryTabsCache.length,
    lastKnownGoodCount: lastKnownGoodTabCount,
    cacheStalenessMs,
    saveId: state.saveId,
    action: 'triggering immediate reconciliation'
  });

  // v1.6.3.6-v12 - FIX Issue #5: Trigger reconciliation with content scripts
  // v1.6.3.10-v2 - FIX Issue #8: Do NOT use cache as fallback - let reconciliation determine truth
  _triggerCacheReconciliation();

  // v1.6.3.10-v2 - FIX Issue #8: Return true to skip normal processing
  // UI will be updated by reconciliation callback
  return true;
}

/**
 * Trigger reconciliation with content scripts when cache diverges from storage
 * v1.6.3.6-v12 - FIX Issue #5: Query content scripts and restore to STORAGE if needed
 * v1.6.3.6-v12 - FIX Code Review: Use module-level imports instead of dynamic import
 * v1.6.3.10-v2 - FIX Issue #8: Update cache sync timestamp after reconciliation
 */
async function _triggerCacheReconciliation() {
  console.log('[Manager] v1.6.3.10-v2 Starting cache reconciliation...');

  try {
    // Query all content scripts for their Quick Tabs
    // v1.6.3.6-v12 - FIX Code Review: Using module-level import
    const contentScriptTabs = await queryAllContentScriptsForQuickTabs();

    console.log('[Manager] v1.6.3.10-v2 Reconciliation found:', {
      contentScriptTabCount: contentScriptTabs.length,
      cacheTabCount: inMemoryTabsCache.length
    });

    if (contentScriptTabs.length > 0) {
      // v1.6.3.6-v12 - FIX Issue #5: Content scripts have tabs - restore to STORAGE
      console.warn(
        '[Manager] CORRUPTION_CONFIRMED: Content scripts have tabs but storage is empty'
      );
      console.log('[Manager] v1.6.3.10-v2 Restoring state to storage...');

      const restoredState = await restoreStateFromContentScripts(contentScriptTabs);
      quickTabsState = restoredState;
      inMemoryTabsCache = [...restoredState.tabs];
      lastKnownGoodTabCount = restoredState.tabs.length;
      // v1.6.3.10-v2 - FIX Issue #8: Update cache sync timestamp
      lastCacheSyncFromStorage = Date.now();

      console.log(
        '[Manager] v1.6.3.10-v2 Reconciliation complete: Restored',
        contentScriptTabs.length,
        'tabs to storage'
      );
      renderUI(); // Re-render with restored state
    } else {
      // v1.6.3.6-v12 - FIX Issue #5: Content scripts also show 0 - accept 0 and clear cache
      console.log('[Manager] v1.6.3.10-v2 Content scripts confirm 0 tabs - accepting empty state');
      inMemoryTabsCache = [];
      lastKnownGoodTabCount = 0;
      // v1.6.3.10-v2 - FIX Issue #8: Update cache sync timestamp
      lastCacheSyncFromStorage = Date.now();
      quickTabsState = { tabs: [], timestamp: Date.now() };
      renderUI();
    }
  } catch (err) {
    console.error('[Manager] v1.6.3.10-v2 Reconciliation error:', err.message);
    // v1.6.3.10-v2 - FIX Issue #8: Do NOT use cache as fallback on error
    // Log the error but don't silently mask storage issues
    console.warn(
      '[Manager] RECONCILIATION_ERROR: Not using cache fallback - showing current state'
    );
  }
}

/**
 * Update in-memory cache with valid state
 * v1.6.3.5-v4 - Extracted to reduce loadQuickTabsState nesting depth
 * v1.6.3.5-v11 - FIX Issue #6: Also update cache when tabs.length is 0 (legitimate deletion)
 *   The cache must be cleared when tabs legitimately reach 0, not just updated when > 0.
 * v1.6.3.10-v2 - FIX Issue #8: Track cache staleness timestamp
 * @param {Array} tabs - Tabs array from storage
 */
function _updateInMemoryCache(tabs) {
  // v1.6.3.10-v2 - FIX Issue #8: Always update cache sync timestamp
  lastCacheSyncFromStorage = Date.now();

  // v1.6.3.10-v2 - FIX Issue #8: Mark initial hydration as complete
  if (!cacheHydrationComplete && tabs.length >= 0) {
    cacheHydrationComplete = true;
    console.log('[Manager] CACHE_HYDRATION_COMPLETE:', {
      tabCount: tabs.length,
      timestamp: lastCacheSyncFromStorage
    });
  }

  if (tabs.length > 0) {
    inMemoryTabsCache = [...tabs];
    lastKnownGoodTabCount = tabs.length;
    console.log('[Manager] Updated in-memory cache:', {
      tabCount: tabs.length,
      syncTimestamp: lastCacheSyncFromStorage
    });
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
 * Process and apply valid storage state
 * v1.6.3.12-v7 - Extracted from loadQuickTabsState to reduce complexity
 * @private
 * @param {Object} state - Valid storage state
 * @param {number} loadStartTime - Load operation start timestamp
 * @returns {boolean} True if state was applied, false if skipped
 */
function _processStorageState(state, loadStartTime) {
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
    return false;
  }

  // v1.6.3.5-v4 - FIX Diagnostic Issue #2: Protect against storage storms
  if (_detectStorageStorm(state)) return false;

  // v1.6.3.5-v4 - Update cache with new valid state
  _updateInMemoryCache(state.tabs || []);

  quickTabsState = state;
  filterInvalidTabs(quickTabsState);

  // v1.6.4 - FIX Issue #21: Increment state version for render transaction tracking
  _incrementStateVersion('loadQuickTabsState');

  // v1.6.3.5-v7 - FIX Issue #7: Update lastLocalUpdateTime when we receive new state from storage
  lastLocalUpdateTime = Date.now();

  console.log('[Manager] Loaded Quick Tabs state:', quickTabsState);
  return true;
}

/**
 * Load Quick Tabs state from browser.storage.local
 * v1.6.3 - FIX: Changed from storage.sync to storage.local (storage location since v1.6.0.12)
 * v1.6.3.4-v6 - FIX Issue #1: Debounce reads to avoid mid-transaction reads
 * v1.6.3.5-v4 - FIX Diagnostic Issue #2: Use in-memory cache to protect against storage storms
 * v1.6.3.5-v6 - FIX Diagnostic Issue #5: Log storage read operations
 * Refactored: Extracted helpers to reduce complexity and nesting depth
 * v1.6.3.12-v5 - FIX: Use storage.local exclusively (storage.session not available in Firefox MV2)
 * v1.6.3.12-v7 - Refactored: Extracted _processStorageState to reduce CC
 */
async function loadQuickTabsState() {
  const loadStartTime = Date.now();

  try {
    await checkStorageDebounce();

    // v1.6.3.5-v6 - FIX Diagnostic Issue #5: Log storage read start
    console.log('[Manager] Reading Quick Tab state from storage...');

    // v1.6.3.12-v5 - FIX: Use storage.local exclusively (storage.session not available in Firefox MV2)
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

    _processStorageState(state, loadStartTime);
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
 * Execute the debounced render operation
 * v1.6.3.11-v3 - FIX CodeScene: Extract from renderUI to reduce complexity
 * @private
 * @param {number} debounceTime - The debounce time used
 */
async function _executeDebounceRender(debounceTime) {
  renderDebounceTimer = null;

  // Only render if still pending (wasn't cancelled)
  if (!pendingRenderUI) {
    console.log('[Manager] Skipping debounced render - no longer pending');
    return;
  }

  pendingRenderUI = false;
  const completionTime = Date.now();
  console.log('[Manager] RENDER_DEBOUNCE_COMPLETE:', {
    totalWaitMs: completionTime - debounceStartTimestamp,
    extensions: debounceExtensionCount,
    finalDebounceMs: debounceTime
  });

  // Reset sliding window tracking
  debounceStartTimestamp = 0;
  debounceExtensionCount = 0;

  // Fetch CURRENT state from storage, not captured hash
  const staleCheckResult = await _checkAndReloadStaleState();
  if (staleCheckResult.stateReloaded) {
    console.log(
      '[Manager] State changed while debounce was waiting, rendering with fresh state',
      staleCheckResult
    );
  }

  // Recalculate hash after potential fresh load
  const finalHash = computeStateHash(quickTabsState);

  // v1.6.4 - FIX Issue #48: Check BOTH hash AND state version before skipping
  // The render might be needed even if hash is unchanged (e.g., port data changed)
  const hashUnchanged = finalHash === lastRenderedHash;
  const versionUnchanged = _stateVersion === _lastRenderedStateVersion;

  if (hashUnchanged && versionUnchanged) {
    console.log('[Manager] Skipping render - state hash AND version unchanged', {
      hash: finalHash,
      stateVersion: _stateVersion,
      tabCount: quickTabsState?.tabs?.length ?? 0
    });
    return;
  }

  if (!hashUnchanged) {
    console.log('[Manager] Debounce render proceeding: hash changed', {
      previousHash: lastRenderedHash,
      newHash: finalHash
    });
  } else {
    console.log('[Manager] Debounce render proceeding: state version changed', {
      previousVersion: _lastRenderedStateVersion,
      newVersion: _stateVersion
    });
  }

  // Update hash before render to prevent re-render loops even if _renderUIImmediate() throws
  lastRenderedHash = finalHash;
  lastRenderedStateHash = finalHash;
  // v1.6.3.12-v12 - FIX Issue #48: Also update state version tracker
  _lastRenderedStateVersion = _stateVersion;

  // Synchronize DOM mutation with requestAnimationFrame
  requestAnimationFrame(() => {
    _renderUIImmediate();
  });
}

/**
 * Render the Quick Tabs Manager UI (debounced)
 * v1.6.3.7 - FIX Issue #3: Debounced to max once per 300ms to prevent UI flicker
 * v1.6.3.12-v7 - FIX Issue D: Hash-based state staleness detection during debounce
 * v1.6.3.10-v2 - FIX Issue #1: Sliding-window debounce that extends timer on new changes
 *   - Reduced debounce from 300ms to 100ms
 *   - Timer extends on each new change (up to RENDER_DEBOUNCE_MAX_WAIT_MS)
 *   - Compares against CURRENT storage read, not captured hash
 * v1.6.3.11-v3 - FIX CodeScene: Extract debounce callback to reduce complexity
 *
 * Issue #14 Note (State Hash Timing): State hash is captured at debounce scheduling
 * (capturedStateHashAtDebounce) for debugging, but the FINAL hash is always recomputed
 * at render time in _executeDebounceRender() to ensure fresh state comparison.
 * This is the correct behavior - we render with the latest state, not stale captured state.
 *
 * Issue #18 Note (Debounce Timing): Manager uses 100ms debounce (RENDER_DEBOUNCE_MS)
 * with 300ms max wait (RENDER_DEBOUNCE_MAX_WAIT_MS). This is intentionally faster than
 * UpdateHandler's 200/300ms to provide responsive UI updates in the sidebar.
 *
 * This is the public API - all callers should use this function.
 */
function renderUI() {
  const now = Date.now();
  pendingRenderUI = true;

  // Sliding-window debounce logic
  const isNewDebounceWindow = debounceStartTimestamp === 0 || !renderDebounceTimer;

  if (isNewDebounceWindow) {
    debounceStartTimestamp = now;
    debounceExtensionCount = 0;
    capturedStateHashAtDebounce = computeStateHash(quickTabsState);
  } else {
    debounceExtensionCount++;
    const totalWaitTime = now - debounceStartTimestamp;
    if (totalWaitTime >= RENDER_DEBOUNCE_MAX_WAIT_MS) {
      _forceRenderOnMaxWait(totalWaitTime);
      return;
    }
  }

  debounceSetTimestamp = now;
  if (renderDebounceTimer) {
    clearTimeout(renderDebounceTimer);
  }

  // Calculate remaining wait time for sliding window
  const elapsedSinceStart = now - debounceStartTimestamp;
  const remainingMaxWait = RENDER_DEBOUNCE_MAX_WAIT_MS - elapsedSinceStart;
  const debounceTime = Math.min(RENDER_DEBOUNCE_MS, remainingMaxWait);

  // Schedule the actual render
  renderDebounceTimer = setTimeout(() => _executeDebounceRender(debounceTime), debounceTime);
}

/**
 * Build stale check result object
 * v1.6.3.11-v3 - FIX CodeScene: Extract from _checkAndReloadStaleState
 * @private
 */
function _buildStaleCheckResult(stateReloaded, inMemoryHash, storageHash, debounceWaitTime) {
  return {
    stateReloaded,
    capturedHash: capturedStateHashAtDebounce,
    currentHash: inMemoryHash,
    storageHash,
    debounceWaitMs: debounceWaitTime
  };
}

/**
 * Apply fresh state from storage if valid
 * v1.6.3.11-v3 - FIX CodeScene: Extract from _checkAndReloadStaleState
 * @private
 */
function _applyFreshStorageState(storageState, inMemoryHash, storageHash) {
  if (storageState?.tabs) {
    quickTabsState = storageState;
    _updateInMemoryCache(storageState.tabs);
    console.log('[Manager] STALE_STATE_RELOADED:', {
      inMemoryHash,
      storageHash,
      inMemoryTabCount: quickTabsState?.tabs?.length ?? 0,
      storageTabCount: storageState.tabs.length
    });
  }
}

/**
 * Check for stale state during debounce and reload if needed
 * v1.6.3.12-v7 - FIX Issue D: Extracted to reduce nesting depth
 * v1.6.3.10-v2 - FIX Issue #1: Always fetch CURRENT storage state, not just on hash mismatch
 * v1.6.3.11-v3 - FIX CodeScene: Reduce complexity by extracting helpers
 * v1.6.3.12-v5 - FIX: Use storage.local exclusively (storage.session not available in Firefox MV2)
 * v1.6.4 - FIX BUG #1/#2: Skip storage reload when fresh port data exists
 *   - Port data is the source of truth for Option 4 architecture
 *   - Storage may not reflect transfer/duplicate operations immediately
 *   - Only reload from storage if port data is stale or empty
 * @private
 * @returns {Promise<{ stateReloaded: boolean, capturedHash: number, currentHash: number, storageHash: number, debounceWaitMs: number }>}
 */
async function _checkAndReloadStaleState() {
  const inMemoryHash = computeStateHash(quickTabsState);
  const debounceWaitTime = Date.now() - debounceSetTimestamp;

  // v1.6.4 - FIX BUG #1/#2: Skip storage reload when port data is fresh
  if (_isPortDataFresh()) {
    return _handleFreshPortData(inMemoryHash, debounceWaitTime);
  }

  return _checkStorageForStaleState(inMemoryHash, debounceWaitTime);
}

/**
 * Check if port data is fresh (received after debounce was set)
 * v1.6.4 - FIX BUG #1/#2: Extracted to reduce _checkAndReloadStaleState complexity
 * v1.6.4.1 - FIX BUG: Port data should ALWAYS be considered fresh if it exists
 *   The timing comparison (lastEventReceivedTime > debounceSetTimestamp) was flawed because
 *   requestAnimationFrame callbacks can run AFTER the port message handler completes,
 *   making debounceSetTimestamp newer than lastEventReceivedTime even though port data is valid.
 *   In Option 4 architecture, port data is the source of truth - if it exists, use it.
 *
 * @private
 * @returns {boolean} True if port data exists (source of truth in Option 4 architecture)
 */
function _isPortDataFresh() {
  const hasPortData = _allQuickTabsFromPort?.length > 0;

  // v1.6.4.1 - FIX: Simplified check - if we have port data, it's authoritative
  // The previous timing comparison was flawed due to requestAnimationFrame timing
  if (hasPortData) {
    console.log('[Manager] PORT_DATA_FRESH_CHECK: Port data exists, treating as fresh', {
      portTabCount: _allQuickTabsFromPort.length,
      lastEventReceivedTime,
      debounceSetTimestamp,
      note: 'Port data is source of truth in Option 4 architecture'
    });
    return true;
  }

  return false;
}

/**
 * Handle case when port data is fresh - skip storage reload
 * v1.6.4 - FIX BUG #1/#2: Extracted to reduce _checkAndReloadStaleState complexity
 * v1.6.4.1 - Updated logging to reflect simplified freshness check
 * @private
 */
function _handleFreshPortData(inMemoryHash, debounceWaitTime) {
  console.log('[Manager] STALE_CHECK_SKIPPED: Port data exists, using as source of truth', {
    portTabCount: _allQuickTabsFromPort.length,
    lastEventReceivedTime,
    debounceSetTimestamp,
    note: 'Option 4 architecture: port data is authoritative'
  });
  return _buildStaleCheckResult(false, inMemoryHash, inMemoryHash, debounceWaitTime);
}

/**
 * Check storage for stale state and reload if needed
 * v1.6.4 - FIX BUG #1/#2: Extracted to reduce _checkAndReloadStaleState complexity
 * @private
 */
/**
 * Check if port data takes precedence over storage
 * v1.6.4 - FIX Code Health: Extracted to reduce _checkStorageForStaleState complexity
 * @private
 * @param {Object} storageState - Storage state
 * @param {number} inMemoryHash - In-memory state hash
 * @param {number} storageHash - Storage state hash
 * @returns {boolean} True if port data should be used instead
 */
function _shouldSkipStorageOverwrite(storageState, inMemoryHash, storageHash) {
  if (!_allQuickTabsFromPort || _allQuickTabsFromPort.length === 0) {
    return false;
  }

  console.log('[Manager] STALE_CHECK_SKIPPED: Port data exists, not overwriting with storage', {
    portTabCount: _allQuickTabsFromPort.length,
    storageTabCount: storageState?.tabs?.length ?? 0,
    inMemoryHash,
    storageHash
  });
  return true;
}

async function _checkStorageForStaleState(inMemoryHash, debounceWaitTime) {
  try {
    const freshResult = await browser.storage.local.get(STATE_KEY);
    const storageState = freshResult?.[STATE_KEY];
    const storageHash = computeStateHash(storageState || {});

    // State matches - no stale check needed
    if (storageHash === inMemoryHash) {
      return _buildStaleCheckResult(false, inMemoryHash, storageHash, debounceWaitTime);
    }

    // Port data is authoritative - don't overwrite
    if (_shouldSkipStorageOverwrite(storageState, inMemoryHash, storageHash)) {
      return _buildStaleCheckResult(false, inMemoryHash, storageHash, debounceWaitTime);
    }

    // Reload from storage (fallback mode)
    _applyFreshStorageState(storageState, inMemoryHash, storageHash);
    return _buildStaleCheckResult(true, inMemoryHash, storageHash, debounceWaitTime);
  } catch (err) {
    console.warn('[Manager] Failed to check storage state, using in-memory:', err.message);
    return _buildStaleCheckResult(false, inMemoryHash, 0, debounceWaitTime);
  }
}

/**
 * Load fresh state from storage during debounce stale check
 * v1.6.3.12-v7 - FIX Issue D: Extracted to reduce nesting depth
 * v1.6.3.12-v5 - FIX: Use storage.local exclusively (storage.session not available in Firefox MV2)
 * @private
 */
async function _loadFreshStateFromStorage() {
  try {
    // v1.6.3.12-v5 - FIX: Use storage.local exclusively (storage.session not available in Firefox MV2)
    const freshResult = await browser.storage.local.get(STATE_KEY);
    const freshState = freshResult?.[STATE_KEY];
    if (freshState?.tabs) {
      quickTabsState = freshState;
      _updateInMemoryCache(freshState.tabs);
      console.log('[Manager] Loaded fresh state from storage (stale prevention)');
    }
  } catch (err) {
    console.warn('[Manager] Failed to load fresh state, using current:', err.message);
  }
}

/**
 * Force render when max debounce wait time reached
 * v1.6.3.10-v2 - FIX Issue #1: Extracted to reduce nesting depth in renderUI()
 * @private
 * @param {number} totalWaitTime - Total time waited since debounce started
 */
function _forceRenderOnMaxWait(totalWaitTime) {
  console.log('[Manager] RENDER_DEBOUNCE_MAX_REACHED:', {
    totalWaitMs: totalWaitTime,
    extensions: debounceExtensionCount,
    maxWaitMs: RENDER_DEBOUNCE_MAX_WAIT_MS
  });

  // Clear timer and render immediately
  if (renderDebounceTimer) {
    clearTimeout(renderDebounceTimer);
    renderDebounceTimer = null;
  }
  debounceStartTimestamp = 0;
  debounceExtensionCount = 0;
  pendingRenderUI = false;

  requestAnimationFrame(() => {
    _renderUIImmediate();
  });
}

/**
 * Force immediate render (bypasses debounce)
 * v1.6.3.7 - FIX Issue #3: Use for critical updates that can't wait
 */
function _renderUIImmediate_force() {
  pendingRenderUI = false;
  if (renderDebounceTimer) {
    clearTimeout(renderDebounceTimer);
    renderDebounceTimer = null;
  }
  requestAnimationFrame(() => {
    _renderUIImmediate();
  });
}

/**
 * Force immediate render with reason logging (bypasses debounce)
 * v1.6.4 - FIX BUG #1: Used for critical updates like transfer operations
 * @private
 * @param {string} reason - Reason for forcing render (for logging)
 */
function _forceImmediateRender(reason) {
  console.log('[Manager] FORCE_IMMEDIATE_RENDER:', {
    reason,
    timestamp: Date.now(),
    previousPendingRender: pendingRenderUI,
    previousDebounceTimer: !!renderDebounceTimer
  });

  // Clear any pending debounced render
  pendingRenderUI = false;
  if (renderDebounceTimer) {
    clearTimeout(renderDebounceTimer);
    renderDebounceTimer = null;
  }
  debounceStartTimestamp = 0;
  debounceExtensionCount = 0;

  // Force immediate render
  requestAnimationFrame(() => {
    _renderUIImmediate();
  });
}

/**
 * Internal render function - performs actual DOM manipulation
 * v1.6.3.7 - FIX Issue #3: Renamed from renderUI, now called via debounce wrapper
 * v1.6.3.7 - FIX Issue #8: Enhanced render logging for debugging
 * v1.6.3.12-v7 - FIX Area E: Enhanced render performance logging with [RENDER_PERF] prefix
 */
async function _renderUIImmediate() {
  // v1.6.4 - FIX Issue #19: Check if render is already in progress
  if (_isRenderInProgress) {
    _pendingRerenderRequested = true;
    console.log(
      '[Manager] RENDER_SKIPPED: Render already in progress, scheduling re-render after completion',
      {
        timestamp: Date.now(),
        consecutiveRerenderCount: _consecutiveRerenderCount
      }
    );
    return;
  }

  // v1.6.4 - FIX Issue #19: Set render lock
  _isRenderInProgress = true;

  try {
    await _executeRenderUIInternal();
    // Reset consecutive counter on successful render completion
    _consecutiveRerenderCount = 0;
  } finally {
    // v1.6.4 - FIX Issue #19: Release render lock
    _isRenderInProgress = false;

    // v1.6.4 - FIX Issue #19: Check if re-render was requested while we were rendering
    _handlePendingRerender();
  }
}

/**
 * Handle pending re-render after render completes
 * v1.6.4 - Code Review: Extracted to avoid return in finally and reduce nesting
 * @private
 */
function _handlePendingRerender() {
  if (!_pendingRerenderRequested) {
    return;
  }

  _pendingRerenderRequested = false;
  _consecutiveRerenderCount++;

  // v1.6.4 - Code Review: Prevent infinite re-render loops
  if (_consecutiveRerenderCount > MAX_CONSECUTIVE_RERENDERS) {
    console.warn(
      '[Manager] RENDER_RERENDER_LIMIT_REACHED: Stopping re-renders to prevent infinite loop',
      {
        timestamp: Date.now(),
        consecutiveRerenderCount: _consecutiveRerenderCount,
        maxAllowed: MAX_CONSECUTIVE_RERENDERS
      }
    );
    _consecutiveRerenderCount = 0;
    return;
  }

  console.log('[Manager] RENDER_RERENDER: Re-rendering due to pending request', {
    timestamp: Date.now(),
    consecutiveRerenderCount: _consecutiveRerenderCount
  });
  // Schedule re-render through normal debounce mechanism
  renderUI();
}

/**
 * Get all Quick Tabs from port data or storage fallback, with container filtering
 * v1.6.3.12-v11 - FIX Issue #1: Prioritize port data for cross-tab visibility
 * v1.6.4-v4 - FEATURE: Container isolation - filter by container based on user setting
 * Port data (`_allQuickTabsFromPort`) contains ALL Quick Tabs from ALL browser tabs,
 * while storage-based state may be filtered. Always prefer port data when available.
 * @private
 * @returns {{ allTabs: Array, latestTimestamp: number, source: string }}
 */
function _getAllQuickTabsForRender() {
  let allTabs;
  let source;

  // v1.6.3.12-v11 - FIX Issue #1: Prioritize port data for cross-tab visibility
  // Simplified: arrays are truthy when they have length > 0
  if (_allQuickTabsFromPort?.length) {
    allTabs = [..._allQuickTabsFromPort]; // Clone to avoid mutation
    source = 'port';
  } else {
    // Fallback to storage-based state extraction
    const extracted = extractTabsFromState(quickTabsState);
    allTabs = extracted.allTabs;
    source = 'storage';
  }

  // v1.6.4-v4 - FEATURE: Container isolation - Apply container filter
  const unfilteredCount = allTabs.length;
  allTabs = _filterQuickTabsByContainer(allTabs);

  console.log('[Manager] RENDER_DATA_SOURCE:', {
    source,
    unfilteredCount,
    filteredCount: allTabs.length,
    containerFilter: _selectedContainerFilter,
    currentContainerId: _currentContainerId
  });

  return {
    allTabs,
    latestTimestamp: lastLocalUpdateTime || Date.now(),
    source
  };
}

/**
 * Internal render implementation (extracted from _renderUIImmediate)
 * v1.6.4 - FIX Issue #19: Extracted to separate function for render lock pattern
 * v1.6.3.12-v11 - FIX Issue #1: Use _getAllQuickTabsForRender for cross-tab visibility
 * @private
 */
async function _executeRenderUIInternal() {
  const renderStartTime = Date.now();
  // v1.6.4-v2 - FIX BUG #2: Capture state version at render START to prevent
  // race condition where STATE_CHANGED arrives during render and increments
  // _stateVersion before we set _lastRenderedStateVersion
  const stateVersionAtRenderStart = _stateVersion;
  // v1.6.3.12-v11 - FIX Issue #1: Use helper that prioritizes port data
  const { allTabs, latestTimestamp, source } = _getAllQuickTabsForRender();

  // v1.6.4-v3 - DEBUG: Log render input data for transfer debugging (uses extracted helper)
  _logRenderInputData(allTabs, source);

  // v1.6.3.7 - FIX Issue #8: Log render entry with trigger reason
  const triggerReason = pendingRenderUI ? 'debounced' : 'direct';
  console.log('[Manager] RENDER_UI: entry', {
    triggerReason,
    tabCount: allTabs.length,
    dataSource: source,
    timestamp: renderStartTime
  });

  _logRenderStart(allTabs);
  updateUIStats(allTabs.length, latestTimestamp);

  if (allTabs.length === 0) {
    _showEmptyState();
    // v1.6.3.6-v11 - FIX Issue #20: Clean up count tracking when empty
    previousGroupCounts.clear();

    // v1.6.4-v2 - FIX BUG #2: Also update version tracker for empty state
    _lastRenderedStateVersion = stateVersionAtRenderStart;

    // v1.6.3.12-v7 - FIX Area E: Log render performance even for empty state
    const emptyDuration = Date.now() - renderStartTime;
    console.log('[RENDER_PERF] Empty state render completed:', {
      durationMs: emptyDuration,
      tabsRendered: 0,
      groupsCreated: 0
    });
    return;
  }

  _showContentState();
  const groupStartTime = Date.now();
  const groups = groupQuickTabsByOriginTab(allTabs);
  // v1.6.4 - FIX BUG #4: Apply user's preferred group order
  const orderedGroups = _applyUserGroupOrder(groups);
  const groupDuration = Date.now() - groupStartTime;

  const collapseStateStartTime = Date.now();
  const collapseState = await loadCollapseState();
  const collapseStateDuration = Date.now() - collapseStateStartTime;

  _logGroupRendering(orderedGroups);

  // v1.6.3.6-v11 - FIX Issue #20: Clean up stale count tracking
  const currentGroupKeys = new Set([...orderedGroups.keys()].map(String));
  cleanupPreviousGroupCounts(currentGroupKeys);

  const domStartTime = Date.now();
  const groupsContainer = await _buildGroupsContainer(orderedGroups, collapseState);
  checkAndRemoveEmptyGroups(groupsContainer, orderedGroups);

  // v1.6.3.12-v13 - FIX Bug #2: Use replaceChildren() for atomic DOM swap
  // replaceChildren() removes all children AND appends new ones in a single operation,
  // eliminating the visual gap/flicker that occurs with innerHTML='' followed by appendChild()
  containersList.replaceChildren(groupsContainer);
  attachCollapseEventListeners(groupsContainer, collapseState);
  // v1.6.4 - FEATURE #2/#3/#5: Attach drag-and-drop event listeners (delegated to DragDropManager)
  _attachDragDropListeners(groupsContainer);
  const domDuration = Date.now() - domStartTime;

  // v1.6.4-v2 - FIX BUG #2: Update trackers with captured version from render START
  _updateRenderTrackers(stateVersionAtRenderStart);

  // v1.6.3.12-v7 - FIX Area E: Enhanced render performance logging
  const totalDuration = Date.now() - renderStartTime;
  console.log('[RENDER_PERF] Render completed:', {
    totalDurationMs: totalDuration,
    phases: {
      groupingMs: groupDuration,
      collapseStateMs: collapseStateDuration,
      domManipulationMs: domDuration
    },
    tabsRendered: allTabs.length,
    groupsCreated: groups.size,
    isSlowRender: totalDuration > 100
  });

  // v1.6.3.7 - FIX Issue #8: Log render exit with summary
  console.log('[Manager] RENDER_UI: exit', {
    triggerReason,
    tabsRendered: allTabs.length,
    groupsCreated: groups.size,
    durationMs: totalDuration
  });

  _logRenderComplete(allTabs, groups, renderStartTime);
}

/**
 * Update render trackers after successful render
 * v1.6.4-v2 - FIX BUG #2: Extracted to reduce _executeRenderUIInternal line count
 * Updates hash and state version trackers using captured version from render START
 * to prevent race condition when STATE_CHANGED arrives during render
 * @private
 * @param {number} stateVersionAtRenderStart - State version captured at render start
 */
function _updateRenderTrackers(stateVersionAtRenderStart) {
  // v1.6.3.7 - FIX Issue #3: Update hash tracker after successful render
  lastRenderedHash = computeStateHash(quickTabsState);
  lastRenderedStateHash = lastRenderedHash; // Keep both in sync for compatibility
  // v1.6.3.12-v12 - FIX Issue #48: Update state version tracker after successful render
  // v1.6.4-v2 - FIX BUG #2: Use captured version from render START, not current version
  _lastRenderedStateVersion = stateVersionAtRenderStart;

  // v1.6.4-v2 - FIX BUG #2: Log if state version changed during render
  if (_stateVersion !== stateVersionAtRenderStart) {
    console.log('[Manager] STATE_VERSION_DRIFT_DURING_RENDER:', {
      versionAtStart: stateVersionAtRenderStart,
      currentVersion: _stateVersion,
      drift: _stateVersion - stateVersionAtRenderStart,
      message: 'State was updated during render - next render will process newer state'
    });
  }
}

/**
 * Log render input data for transfer debugging
 * v1.6.4-v3 - DEBUG: Extracted to reduce lines in _executeRenderUIInternal
 * @private
 * @param {Array} allTabs - Quick Tabs to render
 * @param {string} source - Data source (port, cache, etc.)
 */
function _logRenderInputData(allTabs, source) {
  console.log('[Manager] RENDER_INPUT_DATA:', {
    tabCount: allTabs.length,
    quickTabIds: allTabs.map(t => t.id),
    originTabIds: allTabs.map(t => t.originTabId),
    dataSource: source,
    timestamp: Date.now()
  });
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
    trigger: '_renderUIImmediate()',
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
 * Show content state UI - prepares for content but does NOT clear existing content
 * v1.6.3.12-v13 - FIX Bug #2: Don't clear innerHTML here to prevent flicker
 *   - Content clearing moved to AFTER new content is built (atomic swap)
 * @private
 */
function _showContentState() {
  containersList.style.display = 'block';
  emptyState.style.display = 'none';
  // v1.6.3.12-v13 - FIX Bug #2: Removed innerHTML = '' - now done in _executeRenderUIInternal
  // after new content is built to prevent UI flicker
}

/**
 * Log group rendering info
 * @private
 */
function _logGroupRendering(groups) {
  // v1.6.3.10-v4 - FIX Issue #1: Diagnostic logging for Manager display GROUPING
  console.log('[Manager][Display] GROUPING: Organizing Quick Tabs by originTabId', {
    totalQuickTabs: [...groups.values()].reduce((sum, g) => sum + g.length, 0),
    groups: [...groups.entries()].map(([tabId, tabs]) => ({
      originTabId: tabId,
      count: tabs.length
    }))
  });

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
 * v1.6.4 - FIX BUG #4: Respect user-defined order from orderedGroups Map
 * If _userGroupOrder is set, preserve Map iteration order (which _applyUserGroupOrder set)
 * Only apply the orphaned/closed sorting for NEW groups not in user order
 * v1.6.4 - Code Health: Uses _getUserGroupOrder() from OrderManager
 * @private
 */
function _getSortedGroupKeys(groups) {
  // v1.6.4 - FIX BUG #4: If user has defined an order, preserve Map iteration order
  // The Map was already ordered by _applyUserGroupOrder() - we only need to move orphaned to end
  const userOrder = _getUserGroupOrder();
  if (userOrder && userOrder.length > 0) {
    const keys = [...groups.keys()];
    // v1.6.4 - FIX Code Review: Use filter for cleaner partition
    const regular = keys.filter(k => k !== 'orphaned');
    const orphaned = keys.filter(k => k === 'orphaned');
    return regular.concat(orphaned);
  }
  // Default behavior when no user order is set
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
 * v1.6.4 - FIX BUG #3: Only re-sort if user hasn't defined a custom order
 * v1.6.4 - Code Health: Uses _getUserGroupOrder() from OrderManager
 * @private
 */
function _resortGroupKeys(sortedGroupKeys, groups) {
  // v1.6.4 - FIX BUG #3: Don't re-sort if user has defined a custom order
  // The user's order should be preserved - only move orphaned groups to end
  const userOrder = _getUserGroupOrder();
  if (userOrder && userOrder.length > 0) {
    console.log('[Manager] RESORT_SKIPPED: User group order is defined, preserving user order');
    return;
  }
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
 * v1.6.3.12-v7 - Enhanced with Issues #2, #4, #5, #6, #8, #9 improvements
 * v1.6.3.12-v7 - FIX Issue C: Added comprehensive logging for orphaned group rendering
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

  // v1.6.3.12-v7 - FIX Issue C: Log orphaned group rendering
  if (isOrphaned) {
    console.log('[Manager] ORPHANED_GROUP_RENDER:', {
      groupKey,
      tabCount: group.quickTabs.length,
      tabIds: group.quickTabs.map(t => t.id),
      message: 'Rendering orphaned Quick Tabs with adoption UI',
      timestamp: Date.now()
    });
  }

  // Issue #5/#6: Add special classes
  if (isOrphaned) details.classList.add('orphaned');
  if (isClosedTab) details.classList.add('closed-tab-group');

  // Issue #3: Apply saved collapse state (default: expanded)
  details.open = collapseState[groupKey] !== true;

  // Build header and content
  // v1.6.4 - FIX BUG #3: Pass groupKey to apply user's Quick Tab order
  const summary = _createGroupHeader(groupKey, group, isOrphaned, isClosedTab);
  const content = _createGroupContent(group.quickTabs, details.open, groupKey);

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
    closedBadge.title =
      'Browser tab has been closed. Quick Tabs in this group cannot be restored to their original tab. Close them or use "Adopt" to move to current tab.';
    summary.appendChild(closedBadge);
  }

  // Issue #5: Orphaned badge with detailed tooltip
  if (isOrphaned) {
    const orphanedBadge = document.createElement('span');
    orphanedBadge.className = 'orphaned-badge';
    orphanedBadge.textContent = '⚠️ Cannot restore';
    // Issue #5: Detailed tooltip explaining orphaned state
    orphanedBadge.title =
      'These Quick Tabs have no associated browser tab (originTabId is null). They cannot be restored. Use "Adopt" button to assign to current tab, or close them.';
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

  // v1.6.4 - FEATURE #4: Add group action buttons (Go to Tab, Close All in Tab)
  const groupActions = _createGroupActions(groupKey, isOrphaned);
  summary.appendChild(groupActions);

  return summary;
}

/**
 * Create group action buttons (Go to Tab, Close All in Tab)
 * v1.6.4 - FEATURE #4: New tab buttons for each group header
 * @private
 * @param {number|string} groupKey - Group key (origin tab ID)
 * @param {boolean} isOrphaned - Whether this is the orphaned group
 * @returns {HTMLElement} Container with action buttons
 */
function _createGroupActions(groupKey, isOrphaned) {
  const actionsContainer = document.createElement('div');
  actionsContainer.className = 'tab-group-actions';

  // Don't add actions for orphaned group
  if (isOrphaned) {
    return actionsContainer;
  }

  // Go to Tab button - switches to this browser tab
  const goToTabBtn = document.createElement('button');
  goToTabBtn.className = 'btn-icon btn-go-to-tab';
  goToTabBtn.textContent = '🔗';
  goToTabBtn.title = `Go to Tab ${groupKey}`;
  goToTabBtn.dataset.action = 'goToTab';
  goToTabBtn.dataset.tabId = String(groupKey);
  goToTabBtn.addEventListener('click', e => {
    e.stopPropagation(); // Prevent toggle of details
    _handleGoToTabGroup(groupKey);
  });
  actionsContainer.appendChild(goToTabBtn);

  // Close All in Tab button - closes all Quick Tabs in this group
  const closeAllBtn = document.createElement('button');
  closeAllBtn.className = 'btn-icon btn-close-all-in-tab';
  closeAllBtn.textContent = '🗑️';
  closeAllBtn.title = `Close all Quick Tabs in Tab ${groupKey}`;
  closeAllBtn.dataset.action = 'closeAllInTab';
  closeAllBtn.dataset.tabId = String(groupKey);
  closeAllBtn.addEventListener('click', e => {
    e.stopPropagation(); // Prevent toggle of details
    _handleCloseAllInTabGroup(groupKey);
  });
  actionsContainer.appendChild(closeAllBtn);

  return actionsContainer;
}

/**
 * Handle "Go to Tab" button click - switches to the browser tab
 * v1.6.4 - FEATURE #4: Navigate to browser tab
 * @private
 * @param {number|string} tabId - The browser tab ID to switch to
 */
async function _handleGoToTabGroup(tabId) {
  const numTabId = typeof tabId === 'string' ? parseInt(tabId, 10) : tabId;

  console.log('[Manager] GO_TO_TAB_CLICKED:', {
    tabId: numTabId,
    timestamp: Date.now()
  });

  try {
    await browser.tabs.update(numTabId, { active: true });
    console.log('[Manager] GO_TO_TAB_SUCCESS:', { tabId: numTabId });
  } catch (err) {
    console.error('[Manager] GO_TO_TAB_FAILED:', {
      tabId: numTabId,
      error: err.message
    });
    // Tab might have been closed
    _showErrorNotification(`Cannot switch to tab: ${err.message}`);
  }
}

/**
 * Handle "Close All in Tab" button click - closes all Quick Tabs in this group
 * v1.6.4 - FEATURE #4: Close all Quick Tabs in a specific tab group
 * @private
 * @param {number|string} tabId - The browser tab ID whose Quick Tabs to close
 */
function _handleCloseAllInTabGroup(tabId) {
  const numTabId = typeof tabId === 'string' ? parseInt(tabId, 10) : tabId;

  console.log('[Manager] CLOSE_ALL_IN_TAB_CLICKED:', {
    tabId: numTabId,
    timestamp: Date.now()
  });

  // Get all Quick Tabs for this origin tab
  const quickTabsInGroup = _allQuickTabsFromPort.filter(qt => qt.originTabId === numTabId);

  if (quickTabsInGroup.length === 0) {
    console.log('[Manager] CLOSE_ALL_IN_TAB_NO_TABS:', { tabId: numTabId });
    return;
  }

  console.log('[Manager] CLOSE_ALL_IN_TAB_SENDING:', {
    tabId: numTabId,
    count: quickTabsInGroup.length,
    quickTabIds: quickTabsInGroup.map(qt => qt.id)
  });

  // Close each Quick Tab via port
  for (const qt of quickTabsInGroup) {
    closeQuickTabViaPort(qt.id);
  }
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
    title.title =
      'These Quick Tabs belong to browser tabs that have closed. They cannot be restored.';
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
 * v1.6.4 - FIX BUG #3: Apply user's preferred Quick Tab order before rendering
 * @private
 * @param {Array} quickTabs - Array of Quick Tab objects
 * @param {boolean} isOpen - Whether group starts open
 * @param {string|number} originTabId - Origin tab ID for applying user ordering
 * @returns {HTMLElement}
 */
function _createGroupContent(quickTabs, isOpen, originTabId) {
  const content = document.createElement('div');
  content.className = 'tab-group-content';

  // v1.6.4 - FIX BUG #3: Apply user's preferred Quick Tab order first
  const orderedTabs = _applyUserQuickTabOrder(quickTabs, originTabId);

  // Sort: active first, then minimized (preserving user order within each category)
  const activeTabs = orderedTabs.filter(t => !isTabMinimizedHelper(t));
  const minimizedTabs = orderedTabs.filter(t => isTabMinimizedHelper(t));
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
 * v1.6.3.12-v7 - Enhanced with smooth height animations and scroll-into-view
 * @param {HTMLElement} container - Container with <details> elements
 * @param {Object} collapseState - Current collapse state (will be modified)
 */
function attachCollapseEventListeners(container, collapseState) {
  const detailsElements = container.querySelectorAll('details.tab-group');

  for (const details of detailsElements) {
    const content = details.querySelector('.tab-group-content');
    let isAnimating = false;

    // Issue #1: Override default toggle behavior to invoke animation functions
    details.querySelector('summary').addEventListener('click', async e => {
      // Issue #1: Prevent default toggle to manually control via animation functions
      e.preventDefault();

      // Issue #1: isAnimating flag prevents rapid-click issues
      if (isAnimating) {
        console.log(
          `[Manager] Toggle ignored - animation in progress for [${details.dataset.originTabId}]`
        );
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

// ==================== v1.6.4 DRAG AND DROP ====================
// FEATURE #2, #3, #5: Drag-and-Drop Reordering and Cross-Tab Transfer
// v1.6.4 - Code Health: Delegated to DragDropManager.js module

/**
 * Initialize drag-and-drop functionality
 * v1.6.4 - Delegates to DragDropManager module
 * @private
 */
async function _initDragDrop() {
  await initializeDragDrop();
}

// Initialize drag-drop on module load
_initDragDrop();

/**
 * Wrapper to attach drag-and-drop event listeners using DragDropManager
 * v1.6.4 - Code Health: Delegates to DragDropManager module with callbacks
 * @param {HTMLElement} container - Container with tab groups
 */
function _attachDragDropListeners(container) {
  attachDragDropEventListeners(container, {
    // Callback to get Quick Tab data by ID
    getQuickTabData: quickTabId => {
      return _allQuickTabsFromPort.find(qt => qt.id === quickTabId);
    },
    // Callback to save group order after reorder
    saveGroupOrder: containerEl => {
      saveUserGroupOrder(containerEl);
    },
    // Callback to save Quick Tab order after reorder within group
    saveQuickTabOrder: (originTabId, groupElement) => {
      saveUserQuickTabOrder(originTabId, groupElement);
    },
    // Callback to transfer Quick Tab to another tab
    transferQuickTab: (quickTabId, newOriginTabId) => {
      _transferQuickTabToTab(quickTabId, newOriginTabId);
    },
    // Callback to duplicate Quick Tab to another tab
    duplicateQuickTab: (quickTabData, newOriginTabId) => {
      _duplicateQuickTabToTab(quickTabData, newOriginTabId);
    }
  });
}

/**
 * Transfer a Quick Tab to a different browser tab
 * v1.6.4 - FEATURE #3: Cross-tab transfer via port message
 * @private
 * @param {string} quickTabId - Quick Tab ID to transfer
 * @param {number} newOriginTabId - New origin tab ID
 */
function _transferQuickTabToTab(quickTabId, newOriginTabId) {
  console.log('[Manager] TRANSFER_QUICK_TAB: Sending port message', {
    quickTabId,
    newOriginTabId,
    timestamp: Date.now()
  });

  try {
    const success = _executeSidebarPortOperation('TRANSFER_QUICK_TAB', {
      quickTabId,
      newOriginTabId
    });

    if (success) {
      console.log('[Manager] TRANSFER_QUICK_TAB: Message sent successfully');
    } else {
      console.error('[Manager] TRANSFER_QUICK_TAB: Failed to send message');
    }
  } catch (err) {
    console.error('[Manager] TRANSFER_QUICK_TAB: Error:', err.message);
  }
}

/**
 * Duplicate a Quick Tab to a different browser tab
 * v1.6.4 - FEATURE #5: Shift+drag duplicate via port message
 * @private
 * @param {Object} quickTabData - Quick Tab data to duplicate
 * @param {number} newOriginTabId - Target origin tab ID
 */
function _duplicateQuickTabToTab(quickTabData, newOriginTabId) {
  console.log('[Manager] DUPLICATE_QUICK_TAB: Sending port message', {
    sourceQuickTabId: quickTabData.id,
    newOriginTabId,
    timestamp: Date.now()
  });

  try {
    // Create a new Quick Tab with same properties but new ID and origin
    const duplicateData = {
      url: quickTabData.url,
      title: quickTabData.title,
      left: quickTabData.left,
      top: quickTabData.top,
      width: quickTabData.width,
      height: quickTabData.height,
      minimized: quickTabData.minimized,
      newOriginTabId
    };

    const success = _executeSidebarPortOperation('DUPLICATE_QUICK_TAB', duplicateData);

    if (success) {
      console.log('[Manager] DUPLICATE_QUICK_TAB: Message sent successfully');
    } else {
      console.error('[Manager] DUPLICATE_QUICK_TAB: Failed to send message');
    }
  } catch (err) {
    console.error('[Manager] DUPLICATE_QUICK_TAB: Error:', err.message);
  }
}

// ==================== END DRAG AND DROP ====================

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
 * v1.6.3.12-v7 - Refactored to reduce bumpy road complexity
 * v1.6.3.12-v9 - FIX Issue #8: Add comprehensive logging for button DOM creation
 * @param {Object} tab - Quick Tab data
 * @param {boolean} isMinimized - Whether tab is minimized
 * @returns {HTMLElement} Actions container
 */
function _createTabActions(tab, isMinimized) {
  const actions = document.createElement('div');
  actions.className = 'tab-actions';

  const context = _buildTabActionContext(tab, isMinimized);

  // v1.6.3.12-v9 - FIX Issue #8: Log button creation for this Quick Tab
  console.log('[Manager] BUTTON_DOM_CREATION:', {
    quickTabId: tab.id,
    isMinimized,
    isOrphaned: context.isOrphaned,
    isRestorePending: context.isRestorePending,
    timestamp: Date.now()
  });

  const buttonsCreated = [];

  if (!isMinimized) {
    _appendActiveTabActions(actions, tab, context);
    buttonsCreated.push('goToTab', 'minimize');
  } else {
    _appendMinimizedTabActions(actions, tab, context);
    buttonsCreated.push('restore');
  }

  // Adopt button for orphaned tabs
  if (context.isOrphaned && currentBrowserTabId) {
    _appendAdoptButton(actions, tab);
    buttonsCreated.push('adopt');
  }

  // Close button (always available)
  _appendCloseButton(actions, tab);
  buttonsCreated.push('close');

  // v1.6.3.12-v9 - FIX Issue #8: Log which buttons were created
  console.log('[Manager] BUTTONS_CREATED:', {
    quickTabId: tab.id,
    buttons: buttonsCreated,
    buttonCount: buttonsCreated.length
  });

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
 * v1.6.4 - FEATURE #6: Added "Open in New Tab" button
 * v1.6.4 - FIX: Replaced "Go to Tab" with "Move to Current Tab" per user request
 * @private
 */
function _appendActiveTabActions(actions, tab, context) {
  // v1.6.4 - FEATURE #6: Open in New Tab button
  const openInTabBtn = _createActionButton('↗️', 'Open in New Tab', {
    action: 'openInNewTab',
    quickTabId: tab.id,
    url: tab.url
  });
  openInTabBtn.classList.add('btn-open-in-tab');
  actions.appendChild(openInTabBtn);

  // v1.6.4 - FIX: Replaced "Go to Tab" with "Move to Current Tab" button
  // This moves the Quick Tab to the current active browser tab
  // If modifier key is held, it duplicates instead of moving
  if (tab.originTabId) {
    const moveToCurrentTabBtn = _createActionButton('📥', 'Move to Current Tab', {
      action: 'moveToCurrentTab',
      quickTabId: tab.id,
      originTabId: tab.originTabId,
      url: tab.url,
      title: tab.title
    });
    moveToCurrentTabBtn.classList.add('btn-move-to-current-tab');
    actions.appendChild(moveToCurrentTabBtn);
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
 * v1.6.4 - FEATURE #6: Added "Open in New Tab" button
 * @private
 */
function _appendMinimizedTabActions(actions, tab, context) {
  // v1.6.4 - FEATURE #6: Open in New Tab button (also available for minimized tabs)
  const openInTabBtn = _createActionButton('↗️', 'Open in New Tab', {
    action: 'openInNewTab',
    quickTabId: tab.id,
    url: tab.url
  });
  openInTabBtn.classList.add('btn-open-in-tab');
  actions.appendChild(openInTabBtn);

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
 * v1.6.4 - FIX Issue #16: Also check isOrphaned flag set by background
 * @private
 * @param {Object} tab - Quick Tab data
 * @returns {boolean} True if orphaned
 */
function _isOrphanedQuickTab(tab) {
  // v1.6.4 - FIX Issue #16: Check isOrphaned flag from background (highest priority)
  // Background sets this flag when ORIGIN_TAB_CLOSED is detected
  if (tab.isOrphaned === true) {
    return true;
  }

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

  // v1.6.4 - FIX Issue #16: Add 'orphaned' class for visual indicator
  const isOrphaned = _isOrphanedQuickTab(tab);
  if (isOrphaned) {
    item.classList.add('orphaned');
    item.dataset.orphaned = 'true';
  }

  // Status indicator
  // v1.6.3.4-v10 - FIX Issue #4: Use helper function for indicator class
  const indicator = document.createElement('span');
  const indicatorClass = _getIndicatorClass(tab, isMinimized);
  indicator.className = `status-indicator ${indicatorClass}`;

  // v1.6.3.4-v10 - FIX Issue #4: Add tooltip for warning state
  if (indicatorClass === 'orange') {
    indicator.title = 'Warning: Window may not be visible. Try restoring again.';
  }

  // v1.6.4 - FIX Issue #16: Add orphan badge if tab is orphaned
  if (isOrphaned) {
    const orphanBadge = document.createElement('span');
    orphanBadge.className = 'orphan-badge';
    orphanBadge.textContent = '⚠️';
    orphanBadge.title = 'Orphaned: Browser tab was closed. Use "Adopt to Current Tab" to recover.';
    item.appendChild(orphanBadge);
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
 * Apply optimistic UI update for immediate visual feedback
 * v1.6.3.12-v9 - FIX Button Architecture: Implement Phase 1 of two-phase architecture
 *   - Phase 1: Update DOM immediately (this function)
 *   - Phase 2: Send port message to background (done by caller)
 *
 * This provides instant visual feedback while port message is in flight.
 * If port message fails, the next STATE_CHANGED will reconcile.
 *
 * @private
 * @param {string} action - The action being performed (minimize, restore, close)
 * @param {string} quickTabId - The Quick Tab ID being acted upon
 * @param {HTMLButtonElement} button - The button element clicked
 */
/**
 * Configuration object for optimistic UI update
 * v1.6.3.12-v12 - FIX Code Health: Reduce function arguments by using options object
 * @typedef {Object} OptimisticUIRevertOptions
 * @property {HTMLElement} quickTabItem - The Quick Tab item element
 * @property {HTMLButtonElement} button - The button element
 * @property {string} action - The action that was attempted
 * @property {string} quickTabId - The Quick Tab ID
 * @property {string} originalTitle - Original button title
 */

/**
 * Revert optimistic UI update if operation times out
 * v1.6.3.12-v12 - FIX Issue #48: Add safety timeout to re-enable buttons
 * v1.6.3.12-v12 - FIX Code Health: Use options object to reduce arguments (5 -> 1)
 * @private
 * @param {OptimisticUIRevertOptions} options - Revert options
 */
function _revertOptimisticUI(options) {
  const { quickTabItem, button, action, quickTabId, originalTitle } = options;

  console.log('[Manager] OPTIMISTIC_UI_TIMEOUT: Reverting UI state', {
    action,
    quickTabId,
    reason: 'No STATE_CHANGED received within timeout'
  });

  // Remove pending classes
  if (quickTabItem) {
    quickTabItem.classList.remove('minimizing', 'restoring', 'closing', 'operation-pending');
  }

  // Re-enable button (check isConnected to ensure it's still in the DOM)
  if (button && button.isConnected) {
    button.disabled = false;
    button.title = originalTitle || button.dataset.originalTitle || '';
  }

  // Request fresh state from background to ensure consistency
  requestAllQuickTabsViaPort();
}

/**
 * Apply optimistic UI classes and disable button for an action
 * v1.6.3.12-v12 - FIX Code Health: Extracted to reduce _applyOptimisticUIUpdate LoC
 * v1.6.3.12-v12 - FIX Code Health: Use options object to reduce arguments (5 -> 1)
 * @private
 * @param {Object} options - Apply options
 * @param {HTMLElement} options.quickTabItem - Quick Tab item element
 * @param {HTMLButtonElement} options.button - Button element
 * @param {string} options.actionClass - CSS class for the action (e.g., 'minimizing')
 * @param {string} options.pendingTitle - Title to show while pending
 * @param {string} options.quickTabId - Quick Tab ID for logging
 */
function _applyOptimisticClasses(options) {
  const { quickTabItem, button, actionClass, pendingTitle, quickTabId } = options;
  quickTabItem.classList.add(actionClass);
  quickTabItem.classList.add('operation-pending');
  button.disabled = true;
  button.title = pendingTitle;
  console.log(`[Manager] OPTIMISTIC_UI_APPLIED: ${actionClass.replace('ing', '')}`, {
    quickTabId,
    classes: `${actionClass}, operation-pending`
  });
}

/**
 * Action-to-config lookup table for optimistic UI updates
 * v1.6.3.12-v12 - FIX Code Review: Moved outside function scope to avoid recreation
 * v1.6.4-v3 - FIX: Added openInNewTab to prevent flicker when opening and closing Quick Tab
 * @private
 */
const _optimisticUIActionConfig = {
  minimize: { class: 'minimizing', title: 'Minimizing...' },
  restore: { class: 'restoring', title: 'Restoring...' },
  close: { class: 'closing', title: 'Closing...' },
  openInNewTab: { class: 'closing', title: 'Opening...' }
};

function _applyOptimisticUIUpdate(action, quickTabId, button) {
  const timestamp = Date.now();

  console.log('[Manager] OPTIMISTIC_UI_UPDATE:', {
    action,
    quickTabId,
    timestamp,
    phase: 'applying_immediate_visual_feedback'
  });

  // Find the Quick Tab item in the DOM
  const quickTabItem = button.closest('.quick-tab-item');
  if (!quickTabItem) {
    console.warn('[Manager] OPTIMISTIC_UI_UPDATE_FAILED: Could not find quick-tab-item parent', {
      action,
      quickTabId
    });
    return;
  }

  // v1.6.3.12-v12 - FIX Code Review: Use module-level lookup table
  const config = _optimisticUIActionConfig[action];
  if (!config) {
    console.log('[Manager] OPTIMISTIC_UI_SKIPPED: action not supported', { action, quickTabId });
    return;
  }

  try {
    const originalTitle = button.title;
    _applyOptimisticClasses({
      quickTabItem,
      button,
      actionClass: config.class,
      pendingTitle: config.title,
      quickTabId
    });

    // v1.6.3.12-v12 - FIX Issue #48: Safety timeout to revert UI if STATE_CHANGED doesn't arrive
    // v1.6.3.12-v12 - FIX Code Review: Also check isConnected before reverting
    setTimeout(() => {
      if (quickTabItem.isConnected && quickTabItem.classList.contains('operation-pending')) {
        _revertOptimisticUI({ quickTabItem, button, action, quickTabId, originalTitle });
      }
    }, OPERATION_TIMEOUT_MS);
  } catch (err) {
    console.error('[Manager] OPTIMISTIC_UI_UPDATE_ERROR:', {
      action,
      quickTabId,
      error: err.message
    });
  }
}

/**
 * Handle Close Minimized button click
 * v1.6.3.12-v9 - Extracted from setupEventListeners to reduce function length
 * @private
 */
async function _handleCloseMinimizedButtonClick() {
  const clickTimestamp = Date.now();
  console.log('[Manager] ┌─────────────────────────────────────────────────────────');
  console.log('[Manager] │ HEADER_BUTTON_CLICKED: closeMinimized');
  console.log('[Manager] │ Timestamp:', new Date(clickTimestamp).toISOString());
  console.log('[Manager] └─────────────────────────────────────────────────────────');

  console.log('[Manager] CLOSE_MINIMIZED_BUTTON_CLICK:', {
    buttonId: 'closeMinimized',
    timestamp: clickTimestamp,
    minimizedTabCount: _allQuickTabsFromPort.filter(qt => qt.minimized).length,
    totalTabCount: _allQuickTabsFromPort.length,
    portConnected: !!quickTabsPort
  });

  await closeMinimizedTabs();

  console.log('[Manager] CLOSE_MINIMIZED_BUTTON_CLICK_COMPLETE:', {
    timestamp: Date.now(),
    durationMs: Date.now() - clickTimestamp
  });
}

/**
 * Handle Close All button click
 * v1.6.3.12-v9 - Extracted from setupEventListeners to reduce function length
 * @private
 */
async function _handleCloseAllButtonClick() {
  const clickTimestamp = Date.now();
  console.log('[Manager] ┌─────────────────────────────────────────────────────────');
  console.log('[Manager] │ HEADER_BUTTON_CLICKED: closeAll');
  console.log('[Manager] │ Timestamp:', new Date(clickTimestamp).toISOString());
  console.log('[Manager] └─────────────────────────────────────────────────────────');

  console.log('[Manager] CLOSE_ALL_BUTTON_CLICK:', {
    buttonId: 'closeAll',
    timestamp: clickTimestamp,
    totalTabCount: _allQuickTabsFromPort.length,
    portConnected: !!quickTabsPort
  });

  await closeAllTabs();

  console.log('[Manager] CLOSE_ALL_BUTTON_CLICK_COMPLETE:', {
    timestamp: Date.now(),
    durationMs: Date.now() - clickTimestamp
  });
}

/**
 * Setup header buttons (Close Minimized, Close All)
 * v1.6.3.12-v9 - Extracted from setupEventListeners to reduce function length
 * @private
 */
function _setupHeaderButtons() {
  const closeMinimizedBtn = document.getElementById('closeMinimized');
  if (closeMinimizedBtn) {
    closeMinimizedBtn.addEventListener('click', _handleCloseMinimizedButtonClick);
    console.log('[Manager] EVENT_LISTENER_ATTACHED: closeMinimized button');
  } else {
    console.error('[Manager] EVENT_LISTENER_FAILED: closeMinimized button not found in DOM');
  }

  const closeAllBtn = document.getElementById('closeAll');
  if (closeAllBtn) {
    closeAllBtn.addEventListener('click', _handleCloseAllButtonClick);
    console.log('[Manager] EVENT_LISTENER_ATTACHED: closeAll button');
  } else {
    console.error('[Manager] EVENT_LISTENER_FAILED: closeAll button not found in DOM');
  }
}

/**
 * @typedef {Object} QuickTabActionOptions
 * @property {string} action - The action type (goToTab, minimize, restore, close, adoptToCurrentTab)
 * @property {string} quickTabId - The Quick Tab ID
 * @property {string} tabId - The browser tab ID (for goToTab action)
 * @property {HTMLButtonElement} button - The clicked button element
 * @property {number} clickTimestamp - When the click occurred
 */

/**
 * Check and track pending operation for state-dependent actions
 * v1.6.4 - FIX Issue #48/#10: Defense-in-depth for operation ordering
 * @private
 * @param {string} action - Action type
 * @param {string} quickTabId - Quick Tab ID
 * @returns {boolean} True if operation should proceed, false if blocked
 */
function _checkAndTrackPendingOperation(action, quickTabId) {
  const stateDependentActions = ['minimize', 'restore', 'close'];
  if (!stateDependentActions.includes(action) || !quickTabId) {
    return true; // Not a state-dependent action, allow
  }

  const operationKey = `${action}-${quickTabId}`;
  if (PENDING_OPERATIONS.has(operationKey)) {
    console.log('[Manager] DISPATCH_BLOCKED: Operation already pending', {
      action,
      quickTabId,
      operationKey,
      timestamp: Date.now()
    });
    return false;
  }

  // Add to pending operations (will be cleared by OPERATION_TIMEOUT_MS or ACK)
  PENDING_OPERATIONS.add(operationKey);
  setTimeout(() => PENDING_OPERATIONS.delete(operationKey), OPERATION_TIMEOUT_MS);
  return true;
}

/**
 * Dispatch Quick Tab action based on button action type
 * v1.6.3.12-v9 - Extracted from setupEventListeners to reduce function length
 * v1.6.4-v2 - Refactored to use options object to reduce argument count
 * v1.6.4 - FIX Issue #48/#10: Check PENDING_OPERATIONS before dispatching state-dependent operations
 * @private
 * @param {QuickTabActionOptions} options - Action options
 */
async function _dispatchQuickTabAction(options) {
  const { action, quickTabId, tabId, button, clickTimestamp } = options;

  // v1.6.4 - FIX Issue #48/#10: Check for pending operations on state-dependent actions
  if (!_checkAndTrackPendingOperation(action, quickTabId)) {
    return;
  }

  // v1.6.4 - Refactored to dispatch table for reduced line count
  const dispatcher = _getActionDispatcher(action);
  if (dispatcher) {
    await dispatcher({ quickTabId, tabId, button, clickTimestamp });
  } else {
    console.warn('[Manager] UNKNOWN_ACTION:', { action, quickTabId, tabId, timestamp: Date.now() });
  }
}

/**
 * Get action dispatcher function for a given action type
 * v1.6.4 - Extracted from _dispatchQuickTabAction to reduce function length
 * v1.6.4 - Added moveToCurrentTab action
 * @private
 */
function _getActionDispatcher(action) {
  const dispatchers = {
    goToTab: _dispatchGoToTab,
    openInNewTab: _dispatchOpenInNewTab,
    minimize: _dispatchMinimize,
    restore: _dispatchRestore,
    close: _dispatchClose,
    adoptToCurrentTab: _dispatchAdoptToCurrentTab,
    moveToCurrentTab: _dispatchMoveToCurrentTab
  };
  return dispatchers[action];
}

async function _dispatchGoToTab({ tabId, clickTimestamp }) {
  console.log('[Manager] ACTION_DISPATCH: goToTab', { tabId, timestamp: Date.now() });
  await goToTab(parseInt(tabId));
  console.log('[Manager] ACTION_COMPLETE: goToTab', {
    tabId,
    durationMs: Date.now() - clickTimestamp
  });
}

async function _dispatchOpenInNewTab({ quickTabId, button, clickTimestamp }) {
  console.log('[Manager] ACTION_DISPATCH: openInNewTab', {
    quickTabId,
    url: button.dataset.url,
    timestamp: Date.now()
  });
  await _handleOpenInNewTab(button.dataset.url, quickTabId);
  console.log('[Manager] ACTION_COMPLETE: openInNewTab', {
    quickTabId,
    durationMs: Date.now() - clickTimestamp
  });
}

function _dispatchMinimize({ quickTabId, clickTimestamp }) {
  console.log('[Manager] ACTION_DISPATCH: minimize via port', {
    quickTabId,
    timestamp: Date.now()
  });
  minimizeQuickTabViaPort(quickTabId);
  console.log('[Manager] ACTION_SENT: minimize', {
    quickTabId,
    durationMs: Date.now() - clickTimestamp
  });
}

function _dispatchRestore({ quickTabId, clickTimestamp }) {
  console.log('[Manager] ACTION_DISPATCH: restore via port', { quickTabId, timestamp: Date.now() });
  restoreQuickTabViaPort(quickTabId);
  console.log('[Manager] ACTION_SENT: restore', {
    quickTabId,
    durationMs: Date.now() - clickTimestamp
  });
}

function _dispatchClose({ quickTabId, clickTimestamp }) {
  console.log('[Manager] ACTION_DISPATCH: close via port', { quickTabId, timestamp: Date.now() });
  closeQuickTabViaPort(quickTabId);
  console.log('[Manager] ACTION_SENT: close', {
    quickTabId,
    durationMs: Date.now() - clickTimestamp
  });
}

async function _dispatchAdoptToCurrentTab({ quickTabId, button, clickTimestamp }) {
  console.log('[Manager] ACTION_DISPATCH: adoptToCurrentTab', {
    quickTabId,
    targetTabId: button.dataset.targetTabId,
    timestamp: Date.now()
  });
  await adoptQuickTabToCurrentTab(quickTabId, parseInt(button.dataset.targetTabId));
  console.log('[Manager] ACTION_COMPLETE: adoptToCurrentTab', {
    quickTabId,
    durationMs: Date.now() - clickTimestamp
  });
}

/**
 * Dispatch "Move to Current Tab" action
 * v1.6.4 - FIX: Replacement for "Go to Tab" - moves Quick Tab to current active tab
 * NOTE: Button click always moves. Use drag-and-drop with Shift key to duplicate.
 * @private
 */
async function _dispatchMoveToCurrentTab({ quickTabId, button, clickTimestamp }) {
  const originTabId = parseInt(button.dataset.originTabId, 10);

  console.log('[Manager] ACTION_DISPATCH: moveToCurrentTab', {
    quickTabId,
    originTabId,
    timestamp: Date.now()
  });

  try {
    // Get the current active browser tab
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });

    if (!activeTab) {
      console.error('[Manager] MOVE_TO_CURRENT_TAB: No active tab found');
      _showErrorNotification('Cannot move: No active tab found');
      return;
    }

    const currentTabId = activeTab.id;

    // Don't move if already on the same tab
    if (originTabId === currentTabId) {
      console.log('[Manager] MOVE_TO_CURRENT_TAB: Already on current tab, no action needed', {
        quickTabId,
        tabId: currentTabId
      });
      return;
    }

    console.log('[Manager] MOVE_TO_CURRENT_TAB: Operation', {
      quickTabId,
      fromTabId: originTabId,
      toTabId: currentTabId
    });

    // Button click always moves (use drag-and-drop with modifier key to duplicate)
    _transferQuickTabToTab(quickTabId, currentTabId);
    console.log('[Manager] MOVE_TO_CURRENT_TAB: Transfer sent', {
      quickTabId,
      toTabId: currentTabId
    });

    console.log('[Manager] ACTION_COMPLETE: moveToCurrentTab', {
      quickTabId,
      durationMs: Date.now() - clickTimestamp
    });
  } catch (err) {
    console.error('[Manager] MOVE_TO_CURRENT_TAB_FAILED:', {
      quickTabId,
      error: err.message
    });
    _showErrorNotification(`Failed to move Quick Tab: ${err.message}`);
  }
}

/**
 * Handle "Open in New Tab" action from Manager
 * v1.6.4 - FEATURE #6: Open Quick Tab URL in new browser tab via Manager
 * @private
 * @param {string} url - URL to open
 * @param {string} quickTabId - Quick Tab ID for logging
 */
async function _handleOpenInNewTab(url, quickTabId) {
  if (!url) {
    console.error('[Manager] OPEN_IN_NEW_TAB_NO_URL:', { quickTabId });
    _showErrorNotification('Cannot open: URL not available');
    return;
  }

  try {
    // Use the same mechanism as the Quick Tab UI button
    const response = await browser.runtime.sendMessage({
      action: 'openTab',
      url: url,
      switchFocus: true
    });

    console.log('[Manager] OPEN_IN_NEW_TAB_SUCCESS:', {
      quickTabId,
      url,
      tabId: response?.tabId
    });

    // v1.6.4-v2 - FIX BUG #5: Close the Quick Tab after successfully opening in new tab
    // This ensures the Quick Tab is removed from both the origin tab and the Manager
    if (quickTabId) {
      console.log('[Manager] OPEN_IN_NEW_TAB_CLOSING_QUICK_TAB:', {
        quickTabId,
        reason: 'URL opened in new tab successfully'
      });
      closeQuickTabViaPort(quickTabId);
    }
  } catch (err) {
    console.error('[Manager] OPEN_IN_NEW_TAB_FAILED:', {
      quickTabId,
      url,
      error: err.message
    });
    _showErrorNotification(`Failed to open URL: ${err.message}`);
  }
}

/**
 * Handle delegated click on Quick Tab action buttons
 * v1.6.3.12-v9 - Extracted from setupEventListeners to reduce function length
 * @private
 * @param {Event} e - Click event
 */
async function _handleQuickTabActionClick(e) {
  const button = e.target.closest('button[data-action]');
  if (!button) {
    // Only log if clicked element was a button without data-action (for debugging)
    const clickedButton = e.target.closest('button');
    if (clickedButton) {
      console.log('[Manager] CLICK_NOT_ACTION_BUTTON:', {
        tagName: e.target.tagName,
        className: e.target.className,
        id: e.target.id,
        hasDataAction: !!clickedButton.dataset?.action
      });
    }
    return;
  }

  const action = button.dataset.action;
  const quickTabId = button.dataset.quickTabId;
  const tabId = button.dataset.tabId;
  const clickTimestamp = Date.now();

  console.log('[Manager] ┌─────────────────────────────────────────────────────────');
  console.log('[Manager] │ QUICK_TAB_ACTION_BUTTON_CLICKED');
  console.log('[Manager] │ Action:', action);
  console.log('[Manager] │ QuickTabId:', quickTabId);
  console.log('[Manager] │ Timestamp:', new Date(clickTimestamp).toISOString());
  console.log('[Manager] └─────────────────────────────────────────────────────────');

  console.log('[Manager] QUICK_TAB_BUTTON_CLICKED:', {
    action,
    quickTabId,
    tabId,
    buttonText: button.textContent,
    buttonTitle: button.title,
    buttonDisabled: button.disabled,
    timestamp: clickTimestamp,
    portConnected: !!quickTabsPort,
    currentBrowserTabId
  });

  _applyOptimisticUIUpdate(action, quickTabId, button);
  await _dispatchQuickTabAction({ action, quickTabId, tabId, button, clickTimestamp });
}

/**
 * Setup delegated click handler for Quick Tab action buttons
 * v1.6.3.12-v9 - Extracted from setupEventListeners to reduce function length
 * @private
 */
function _setupQuickTabActionHandler() {
  if (containersList) {
    containersList.addEventListener('click', _handleQuickTabActionClick);
    console.log('[Manager] EVENT_LISTENER_ATTACHED: containersList delegated click handler');
  } else {
    console.error('[Manager] EVENT_LISTENER_FAILED: containersList element not found');
  }
}

/**
 * Setup event listeners for user interactions
 * v1.6.3.12-v9 - FIX Issue #1-3, #8: Add comprehensive logging for all button operations
 *   - Log when header buttons (Close Minimized, Close All) are clicked
 *   - Log before and after port operations are invoked
 *   - Add optimistic UI updates for immediate visual feedback
 */
function setupEventListeners() {
  const setupTimestamp = Date.now();

  console.log('[Manager] SETUP_EVENT_LISTENERS_ENTRY:', {
    timestamp: setupTimestamp,
    containersListExists: !!containersList,
    closeMinimizedBtnExists: !!document.getElementById('closeMinimized'),
    closeAllBtnExists: !!document.getElementById('closeAll')
  });

  _setupHeaderButtons();
  _setupQuickTabActionHandler();

  console.log('[Manager] EVENT_LISTENERS_SETUP_COMPLETE:', {
    timestamp: new Date().toISOString(),
    containersListElement: !!containersList,
    closeMinimizedElement: !!document.getElementById('closeMinimized'),
    closeAllElement: !!document.getElementById('closeAll')
  });

  // v1.6.4 - FIX Issue #22: storage.onChanged listener is now registered at the
  // start of DOMContentLoaded BEFORE any async operations. This ensures we don't
  // miss storage changes that occur during initialization.
  // _setupStorageOnChangedListener() is now called from DOMContentLoaded directly.
}

/**
 * Setup storage.onChanged listener as fallback mechanism
 * v1.6.3.12 - Extracted from setupEventListeners to reduce function length
 * v1.6.4 - FIX Issue #22: NOW CALLED AT START OF DOMContentLoaded
 *   CRITICAL: This listener MUST be registered BEFORE any async operations
 *   to ensure we don't miss storage changes that occur during initialization.
 *   The background script may send state updates via storage.local while
 *   the manager is still initializing, and missing these updates causes
 *   state divergence.
 * @private
 */
function _setupStorageOnChangedListener() {
  // Listen for storage changes to auto-update
  // v1.6.3 - FIX: Changed from 'sync' to 'local' (storage location since v1.6.0.12)
  // v1.6.3.12-v7 - FIX: Changed from 'local' to 'session' (Quick Tabs are now session-only)
  // v1.6.3.4-v6 - FIX Issue #1: Debounce storage reads to avoid mid-transaction reads
  // v1.6.3.4-v9 - FIX Issue #18: Add reconciliation logic for suspicious storage changes
  // v1.6.3.5-v2 - FIX Report 2 Issue #6: Refactored to reduce complexity
  // v1.6.3.12-v2 - FIX Issue #13: storage.onChanged is FALLBACK mechanism for port messaging
  //   - PRIMARY: Port messaging ('quick-tabs-port') for real-time sync
  //   - FALLBACK: storage.local changes caught here for edge cases
  //   - NOTE: 'session' area does NOT exist in Firefox MV2

  // v1.6.3.12 - Gap #2: Log storage.onChanged listener registration
  console.log('[Sidebar] STORAGE_ONCHANGED_LISTENER_REGISTERED:', {
    timestamp: Date.now(),
    area: 'local',
    stateKey: STATE_KEY,
    purpose: 'fallback for port messaging',
    note: 'storage.session does NOT exist in Firefox MV2'
  });

  browser.storage.onChanged.addListener((changes, areaName) => {
    // v1.6.3.12 - Gap #2: Log storage.onChanged event fired
    console.log('[Sidebar] STORAGE_ONCHANGED_EVENT:', {
      timestamp: Date.now(),
      areaName,
      changedKeys: Object.keys(changes),
      hasStateKey: !!changes[STATE_KEY]
    });

    // v1.6.3.12-v2 - FIX Issue #13: Listen for 'local' area as fallback
    // Port messaging is the PRIMARY sync mechanism (Option 4 Architecture)
    // storage.session does NOT exist in Firefox MV2, so listen for 'local' instead
    if (areaName !== 'local' || !changes[STATE_KEY]) {
      console.log('[Sidebar] STORAGE_ONCHANGED_SKIPPED:', {
        reason: areaName !== 'local' ? 'wrong_area' : 'no_state_key',
        areaName,
        expectedArea: 'local'
      });
      return;
    }

    console.log('[Sidebar] STORAGE_ONCHANGED_HANDLER_INVOKED:', {
      timestamp: Date.now(),
      areaName,
      stateKey: STATE_KEY,
      fallbackPath: true
    });
    _handleStorageChange(changes[STATE_KEY]);
  });
}

/**
 * Handle tab or container switch
 * v1.6.4-v4 - FEATURE: Container isolation - extracted to reduce nesting depth
 * @private
 * @param {number} newTabId - New browser tab ID
 */
async function _handleTabOrContainerSwitch(newTabId) {
  const containerChanged = await _updateCurrentContainerId(newTabId);
  if (containerChanged) {
    // Container changed - update dropdown and potentially re-filter
    await _onContainerContextChanged();
  } else {
    // v1.6.3.12-v10 - FIX Issue #48: Re-render UI to update browser tab context
    renderUI();
  }
}

/**
 * Handle window focus change
 * v1.6.4-v4 - FEATURE: Container isolation - extracted to reduce nesting depth
 * @private
 * @param {number} windowId - Window ID that received focus
 */
async function _handleWindowFocusChange(windowId) {
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

      // v1.6.4-v4 - FEATURE: Container isolation - check if container changed
      await _handleTabOrContainerSwitch(currentBrowserTabId);
    }
  } catch (err) {
    console.warn('[Manager] Error handling window focus change:', err);
  }
}

/**
 * Setup browser tab activation listener for real-time context updates
 * v1.6.3.7-v1 - FIX ISSUE #1: Manager Panel Shows Orphaned Quick Tabs
 * v1.6.3.12-v10 - FIX Issue #48: Clarified that Manager shows ALL Quick Tabs from ALL tabs
 * v1.6.4-v4 - FEATURE: Container isolation - detect container changes on tab switch
 * When user switches between browser tabs, re-render the Manager UI to:
 * - Update the current browser tab context (for orphan detection)
 * - Refresh browser tab info cache
 * - v1.6.4-v4: Update container filter dropdown if container changed
 * NOTE: Manager shows Quick Tabs filtered by container based on user setting
 */
function setupTabSwitchListener() {
  // Listen for tab activation (user switches to a different tab)
  browser.tabs.onActivated.addListener(async activeInfo => {
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

    // v1.6.4-v4 - FEATURE: Container isolation - check if container changed
    await _handleTabOrContainerSwitch(newTabId);
  });

  // Also listen for window focus changes (user switches browser windows)
  browser.windows.onFocusChanged.addListener(async windowId => {
    if (windowId === browser.windows.WINDOW_ID_NONE) {
      return; // Window lost focus
    }

    await _handleWindowFocusChange(windowId);
  });

  console.log('[Manager] Tab switch listener initialized');
}

/**
 * Handle storage change event
 * v1.6.3.5-v2 - Extracted to reduce setupEventListeners complexity
 * v1.6.3.5-v6 - FIX Diagnostic Issue #5: Added comprehensive logging
 * v1.6.3.7 - FIX Issue #3: Skip renderUI() if only z-index changed (flicker prevention)
 * v1.6.3.7 - FIX Issue #4: Update lastLocalUpdateTime on storage.onChanged
 * v1.6.3.7 - FIX Issue #8: Enhanced storage synchronization logging
 * v1.6.3.7-v1 - FIX ISSUE #5: Added writingTabId source identification
 * v1.6.3.12-v7 - Refactored to reduce cyclomatic complexity from 23 to <9
 * v1.6.4 - FIX Code Health: Use imported functions from StorageChangeAnalyzer
 * @param {Object} change - The storage change object
 */
function _handleStorageChange(change) {
  const context = _buildStorageChangeContextFromSCA(change, currentBrowserTabId);

  // v1.6.3.7 - FIX Issue #8: Log storage listener entry
  console.log('[Manager] STORAGE_LISTENER:', {
    event: 'storage.onChanged',
    oldSaveId: context.oldValue?.saveId || 'none',
    newSaveId: context.newValue?.saveId || 'none',
    timestamp: Date.now()
  });

  // Log the storage change
  _logStorageChangeEventFromSCA(context, currentBrowserTabId);

  // Log tab ID changes (added/removed)
  _logTabIdChangesFromSCA(context);

  // Log position/size updates
  _logPositionSizeChangesFromSCA(context);

  // Check for and handle suspicious drops
  if (_isSuspiciousStorageDropFromSCA(context.oldTabCount, context.newTabCount, context.newValue)) {
    _handleSuspiciousStorageDrop(context.oldValue);
    return;
  }

  // v1.6.3.7 - FIX Issue #3: Check if only metadata changed (z-index, etc.)
  const changeAnalysis = _analyzeStorageChangeFromSCA(context.oldValue, context.newValue);

  // v1.6.3.7 - FIX Issue #4: Update lastLocalUpdateTime for ANY real data change
  if (changeAnalysis.hasDataChange) {
    lastLocalUpdateTime = Date.now();
    console.log('[Manager] STORAGE_LISTENER: lastLocalUpdateTime updated', {
      newTimestamp: lastLocalUpdateTime,
      reason: changeAnalysis.changeReason
    });
  }

  // v1.6.3.7 - FIX Issue #3: Skip renderUI if only metadata changed
  if (!changeAnalysis.requiresRender) {
    console.log('[Manager] STORAGE_LISTENER: Skipping renderUI (metadata-only change)', {
      changeType: changeAnalysis.changeType,
      reason: changeAnalysis.skipReason
    });
    // Still update local state cache but don't re-render
    _updateLocalStateCache(context.newValue);
    return;
  }

  _scheduleStorageUpdate();
}

// v1.6.4 - Note: The following functions have been extracted to StorageChangeAnalyzer.js:
// _buildAnalysisResult, _buildTabCountChangeResult, _buildMetadataOnlyResult, _buildDataChangeResult,
// _buildNoChangesResult, _getTabsFromValue, _buildResultFromChangeAnalysis, _analyzeStorageChange,
// _checkSingleTabDataChanges, _checkTabChanges, _buildStorageChangeContext, _logStorageChangeEvent,
// _logTabIdChanges, _logPositionSizeChanges, _identifyChangedTabs, _hasPositionDiff, _hasSizeDiff,
// _isSuspiciousStorageDrop, _isSingleTabDeletion, _isExplicitClearOperation

/**
 * Update local state cache without triggering renderUI()
 * v1.6.3.7 - FIX Issue #3: Keep local state in sync during metadata-only updates
 * v1.6.4 - FIX Issue #21: Increment state version for render transaction tracking
 * @private
 * @param {Object} newValue - New storage value
 */
function _updateLocalStateCache(newValue) {
  if (newValue?.tabs) {
    quickTabsState = newValue;
    _updateInMemoryCache(newValue.tabs);
    // v1.6.4 - FIX Issue #21: Increment state version
    _incrementStateVersion('_updateLocalStateCache');
  }
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
 * v1.6.3.12-v7 - FIX Issue B: Route through unified scheduleRender entry point
 */
function _scheduleStorageUpdate() {
  if (storageReadDebounceTimer) {
    clearTimeout(storageReadDebounceTimer);
  }

  storageReadDebounceTimer = setTimeout(() => {
    storageReadDebounceTimer = null;
    loadQuickTabsState().then(() => {
      // v1.6.3.12-v7 - FIX Issue B: Route through unified entry point
      scheduleRender('storage.onChanged');
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

    console.log(
      '[Manager] Reconciliation found',
      uniqueQuickTabs.length,
      'unique Quick Tabs in content scripts'
    );

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
    console.warn(
      '[Manager] CORRUPTION DETECTED: Content scripts have Quick Tabs but storage is empty'
    );
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
 * v1.6.3.12-v7 - FIX Issue B: Route through unified scheduleRender entry point
 * v1.6.3.12-v5 - FIX: Use storage.local exclusively (storage.session not available in Firefox MV2)
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

  // v1.6.3.12-v5 - FIX: Use storage.local exclusively (storage.session not available in Firefox MV2)
  await browser.storage.local.set({ [STATE_KEY]: restoredState });
  console.log('[Manager] State restored from content scripts:', quickTabs.length, 'tabs');

  // Update local state and re-render
  quickTabsState = restoredState;
  // v1.6.3.12-v7 - FIX Issue B: Route through unified entry point
  scheduleRender('restore-from-content-scripts');
}

/**
 * Schedule normal state update after delay
 * v1.6.3.4-v9 - Extracted to reduce code duplication
 * v1.6.3.12-v7 - FIX Issue B: Route through unified scheduleRender entry point
 */
function _scheduleNormalUpdate() {
  setTimeout(() => {
    loadQuickTabsState().then(() => {
      // v1.6.3.12-v7 - FIX Issue B: Route through unified entry point
      scheduleRender('reconciliation-complete');
    });
  }, STORAGE_READ_DEBOUNCE_MS);
}

/**
 * Close all minimized Quick Tabs (NEW FEATURE #1)
 * v1.6.3 - FIX: Changed from storage.sync to storage.local and updated for unified format
 * v1.6.3.4-v6 - FIX Issue #4: Send CLOSE_QUICK_TAB to content scripts BEFORE updating storage
 * v1.6.3.12-v7 - FIX Issue A: Send command to background instead of direct storage write
 *   - Manager sends CLOSE_MINIMIZED_TABS command
 *   - Background processes command, updates state, writes to storage
 *   - Background sends confirmation back to Manager
 */
/**
 * Log successful close minimized command
 * v1.6.3.11-v9 - FIX CodeScene: Extracted to reduce closeMinimizedTabs complexity
 * @private
 * @param {Object} response - Response from background script
 */
function _logCloseMinimizedSuccess(response) {
  console.log('[Manager] ✅ CLOSE_MINIMIZED_COMMAND_SUCCESS:', {
    closedCount: response?.closedCount || 0,
    closedIds: response?.closedIds || [],
    timedOut: response?.timedOut || false
  });
}

/**
 * Log failed close minimized command
 * v1.6.3.11-v9 - FIX CodeScene: Extracted to reduce closeMinimizedTabs complexity
 * @private
 * @param {Object} response - Response from background script
 */
function _logCloseMinimizedFailure(response) {
  console.error('[Manager] ❌ CLOSE_MINIMIZED_COMMAND_FAILED:', {
    error: response?.error || 'Unknown error'
  });
}

/**
 * Check if close minimized response indicates success
 * v1.6.3.11-v9 - FIX CodeScene: Extracted to reduce closeMinimizedTabs complexity
 * @private
 * @param {Object} response - Response from background script
 * @returns {boolean} True if operation succeeded
 */
function _isCloseMinimizedSuccessful(response) {
  return response?.success || response?.timedOut;
}

function closeMinimizedTabs() {
  const timestamp = Date.now();
  const minimizedTabs = _allQuickTabsFromPort.filter(qt => qt.minimized);

  console.log('[Manager] ┌─────────────────────────────────────────────────────────');
  console.log('[Manager] │ CLOSE_MINIMIZED_TABS function invoked');
  console.log('[Manager] │ Minimized tabs count:', minimizedTabs.length);
  console.log('[Manager] └─────────────────────────────────────────────────────────');

  console.log('[Manager] CLOSE_MINIMIZED_TABS_INITIATED:', {
    timestamp,
    minimizedCount: minimizedTabs.length,
    minimizedQuickTabIds: minimizedTabs.map(qt => qt.id),
    totalQuickTabs: _allQuickTabsFromPort.length,
    portConnected: !!quickTabsPort
  });

  try {
    // v1.6.3.12-v8 - FIX Issue #1: Use port messaging via closeMinimizedQuickTabsViaPort()
    // This ensures the operation uses the same port architecture as other Quick Tab operations
    // The actual state update will come via STATE_CHANGED message from background
    const success = closeMinimizedQuickTabsViaPort();

    if (success) {
      console.log('[Manager] CLOSE_MINIMIZED_QUICK_TABS sent via port successfully');
      // Note: Re-render will be triggered by STATE_CHANGED message from background
    } else {
      console.warn('[Manager] Failed to send CLOSE_MINIMIZED_QUICK_TABS - port not connected');
    }
  } catch (err) {
    console.error('[Manager] Error sending close minimized command:', err);
  }
}

/**
 * Load state from storage
 * v1.6.3.12-v5 - FIX: Use storage.local exclusively (storage.session not available in Firefox MV2)
 * @private
 */
async function _loadStorageState() {
  // v1.6.3.12-v5 - FIX: Use storage.local exclusively (storage.session not available in Firefox MV2)
  const result = await browser.storage.local.get(STATE_KEY);
  return result?.[STATE_KEY] ?? null;
}

/**
 * Collect minimized tab IDs from state
 * @private
 */
function _collectMinimizedTabIds(state) {
  if (!state.tabs || !Array.isArray(state.tabs)) return [];
  return state.tabs.filter(tab => isTabMinimizedHelper(tab)).map(tab => tab.id);
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
 * v1.6.3.12-v5 - FIX: Use storage.local exclusively (storage.session not available in Firefox MV2)
 * @private
 */
async function _updateStorageAfterClose(state) {
  const hasChanges = filterMinimizedFromState(state);

  if (hasChanges) {
    // v1.6.3.12-v5 - FIX: Use storage.local exclusively (storage.session not available in Firefox MV2)
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
    browser.tabs.sendMessage(tab.id, { action: 'CLOSE_MINIMIZED_QUICK_TABS' }).catch(() => {
      // Ignore errors
    });
  });
}

/**
 * Close all Quick Tabs - both active and minimized (NEW FEATURE #2)
 * v1.6.3 - FIX: Changed from storage.sync to storage.local
 * v1.6.3.5-v6 - FIX Architecture Issue #1: Use background-coordinated clear
 * v1.6.3.12-v7 - Refactored to reduce cyclomatic complexity
 */
async function closeAllTabs() {
  const startTime = Date.now();

  console.log('[Manager] ┌─────────────────────────────────────────────────────────');
  console.log('[Manager] │ CLOSE_ALL_TABS function invoked');
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
 * Send CLOSE_ALL_QUICK_TABS message to background via port
 * v1.6.3.12-v7 - FIX Issue #15: Use port messaging for Close All operation
 * @private
 * @returns {Promise<Object>} Response from background
 */
function _sendClearAllMessage() {
  console.log('[Manager] Close All: Dispatching CLOSE_ALL_QUICK_TABS via port...', {
    portConnected: !!quickTabsPort,
    timestamp: Date.now()
  });

  // v1.6.3.12-v7 - FIX Issue #15: Use port messaging (Option 4 architecture)
  if (quickTabsPort) {
    const correlationId = _generatePortCorrelationId();
    const sentAt = Date.now();

    // Track operation for roundtrip calculation
    _quickTabPortOperationTimestamps.set('close-all', {
      sentAt,
      messageType: 'CLOSE_ALL_QUICK_TABS',
      correlationId
    });

    quickTabsPort.postMessage({
      type: 'CLOSE_ALL_QUICK_TABS',
      timestamp: sentAt,
      correlationId
    });

    console.log('[Sidebar] CLOSE_ALL_QUICK_TABS sent via port:', {
      correlationId,
      timestamp: sentAt
    });

    // Return a promise that resolves after a short delay
    // The actual state update will come via STATE_CHANGED message
    return Promise.resolve({ success: true, method: 'port', correlationId });
  }

  // Fallback to runtime.sendMessage if port not connected
  console.warn('[Manager] Close All: Port not connected, falling back to runtime.sendMessage');
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

// ==================== v1.6.3.12-v7 OPERATION HELPERS ====================
// FIX Code Health: Extracted helpers to reduce minimizeQuickTab/closeQuickTab line count

/**
 * Check if operation should be queued due to circuit breaker
 * v1.6.3.12-v7 - FIX Code Health: Extracted to reduce function size
 * @private
 * @param {string} action - Action name
 * @param {string} quickTabId - Quick Tab ID
 * @param {string} correlationId - Correlation ID for logging
 * @returns {boolean} True if operation was queued
 */
function _shouldQueueForCircuitBreaker(action, quickTabId, correlationId) {
  if (circuitBreakerState !== 'open') return false;
  const queued = _queuePendingAction(action, { quickTabId });
  if (queued) {
    console.log('[Manager] OPERATION_QUEUED: Circuit breaker open:', {
      action,
      quickTabId,
      correlationId,
      reason: 'circuit-breaker-open'
    });
    _showErrorNotification('Connection temporarily unavailable. Action queued.');
  }
  return queued;
}

/**
 * Check port viability and queue if not viable
 * v1.6.3.12-v7 - FIX Code Health: Extracted to reduce function size
 * @private
 * @param {string} action - Action name
 * @param {string} quickTabId - Quick Tab ID
 * @param {string} correlationId - Correlation ID for logging
 * @returns {Promise<boolean>} True if port is viable, false if operation was deferred
 */
async function _checkPortViabilityOrQueue(action, quickTabId, correlationId) {
  const portViable = await verifyPortViability();
  if (portViable) return true;
  console.warn('[Manager] OPERATION_DEFERRED: Port not viable:', {
    action,
    quickTabId,
    correlationId,
    reason: 'port-not-viable'
  });
  _queuePendingAction(action, { quickTabId });
  _showErrorNotification('Connection lost. Action queued for retry.');
  return false;
}

/**
 * Resolve target tab ID from host info or origin tab ID
 * v1.6.3.12-v7 - FIX Code Health: Extracted to reduce function size
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @param {string} action - Action name for logging
 * @param {string} correlationId - Correlation ID for logging
 * @returns {{ targetTabId: number|null, originTabId: number|null }}
 */
function _resolveTargetTab(quickTabId, action, correlationId) {
  const tabData = findTabInState(quickTabId, quickTabsState);
  const hostInfo = quickTabHostInfo.get(quickTabId);
  const originTabId = tabData?.originTabId;
  const targetTabId = hostInfo?.hostTabId || originTabId;
  console.log('[Manager] OPERATION_TARGET_RESOLVED:', {
    action,
    quickTabId,
    correlationId,
    targetTabId,
    originTabId,
    hostInfoTabId: hostInfo?.hostTabId,
    source: hostInfo?.hostTabId ? 'hostInfo' : 'originTabId'
  });
  return { targetTabId, originTabId };
}

/**
 * Log operation completion or failure
 * v1.6.3.12-v7 - FIX Code Health: Extracted to reduce function size
 * @private
 * @param {string} action - Action name
 * @param {string} quickTabId - Quick Tab ID
 * @param {string} correlationId - Correlation ID
 * @param {Object} result - Operation result
 * @param {number} durationMs - Operation duration
 * @param {number|null} targetTabId - Target tab ID
 */
/**
 * Log operation result (success or failure)
 * v1.6.3.10-v8 - FIX Code Health: Use options object instead of 6 parameters
 * @private
 * @param {Object} opts - Logging options
 */
function _logOperationResult({
  action,
  quickTabId,
  correlationId,
  result,
  durationMs,
  targetTabId
}) {
  const baseData = { action, quickTabId, correlationId, durationMs, attempts: result.attempts };
  if (result.success) {
    console.log('[Manager] OPERATION_COMPLETED:', {
      ...baseData,
      status: 'success',
      method: result.method,
      targetTabId: result.targetTabId
    });
  } else {
    console.error('[Manager] OPERATION_FAILED:', {
      ...baseData,
      status: 'failed',
      error: result.error,
      targetTabId
    });
  }
}

// ==================== END v1.6.3.12-v7 OPERATION HELPERS ====================

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
 * v1.6.3.10-v2 - FIX Issue #4: Queue action if circuit breaker is open
 * v1.6.3.12-v7 - FIX Issue #20: Comprehensive logging for Manager-initiated operations
 * v1.6.3.12-v7 - FIX Code Health: Refactored to reduce line count (107 -> ~55)
 */
async function minimizeQuickTab(quickTabId) {
  const correlationId = generateOperationCorrelationId('min', quickTabId);
  const startTime = Date.now();

  console.log('[Manager] OPERATION_INITIATED: Manager action requested:', {
    action: 'MINIMIZE_QUICK_TAB',
    quickTabId,
    correlationId,
    currentBrowserTabId,
    timestamp: startTime
  });

  // v1.6.3.4-v5 - FIX Issue #4: Prevent spam-clicking
  const operationKey = `minimize-${quickTabId}`;
  if (PENDING_OPERATIONS.has(operationKey)) {
    console.log('[Manager] OPERATION_REJECTED: Duplicate operation pending:', {
      action: 'MINIMIZE_QUICK_TAB',
      quickTabId,
      correlationId,
      reason: 'duplicate-pending'
    });
    return;
  }
  PENDING_OPERATIONS.add(operationKey);
  setTimeout(() => PENDING_OPERATIONS.delete(operationKey), OPERATION_TIMEOUT_MS);

  // v1.6.3.10-v2 - FIX Issue #4: Queue if circuit breaker open
  if (_shouldQueueForCircuitBreaker('MINIMIZE_QUICK_TAB', quickTabId, correlationId)) {
    PENDING_OPERATIONS.delete(operationKey);
    return;
  }

  // v1.6.3.10-v1 - FIX Issue #2: Verify port viability
  if (!(await _checkPortViabilityOrQueue('MINIMIZE_QUICK_TAB', quickTabId, correlationId))) {
    PENDING_OPERATIONS.delete(operationKey);
    return;
  }

  // Resolve target tab
  const { targetTabId, originTabId } = _resolveTargetTab(
    quickTabId,
    'MINIMIZE_QUICK_TAB',
    correlationId
  );

  // v1.6.3.10-v4 - FIX Issue #1: Diagnostic logging
  console.log('[Manager][Operation] VALIDATION: Checking cross-tab operation', {
    operation: 'MINIMIZE',
    quickTabId,
    quickTabOriginTabId: originTabId,
    requestingTabId: currentBrowserTabId,
    targetTabId,
    decision: 'ALLOW'
  });

  // Send message with retry
  const result = await _sendMessageWithRetry(
    { action: 'MINIMIZE_QUICK_TAB', quickTabId, correlationId },
    targetTabId,
    'minimize'
  );

  const durationMs = Date.now() - startTime;
  _logOperationResult({
    action: 'MINIMIZE_QUICK_TAB',
    quickTabId,
    correlationId,
    result,
    durationMs,
    targetTabId
  });

  if (!result.success) {
    _showErrorNotification(`Failed to minimize Quick Tab: ${result.error}`);
  }
}

// ==================== v1.6.3.10-v1 MESSAGE RETRY LOGIC ====================
// FIX Issue #7: Retry logic for minimize/restore/close operations

/**
 * Attempt targeted message with retry
 * v1.6.3.10-v1 - FIX Issue #7: Extracted to reduce nesting depth
 * @private
 * @param {Object} message - Message to send
 * @param {number} targetTabId - Target tab ID
 * @param {string} operation - Operation name for logging
 * @returns {Promise<{ success: boolean, attempts: number, targetTabId?: number }|null>}
 */
async function _attemptTargetedMessageWithRetry(message, targetTabId, operation) {
  for (let retry = 0; retry <= MESSAGE_RETRY_COUNT; retry++) {
    const result = await _trySingleTargetedMessage(message, targetTabId, operation, retry);
    if (result.success) {
      return result;
    }
    // Wait before next retry (unless last attempt)
    if (retry < MESSAGE_RETRY_COUNT) {
      await _delay(MESSAGE_RETRY_BACKOFF_MS);
    }
  }
  return null; // All retries failed
}

/**
 * Try a single targeted message
 * v1.6.3.10-v1 - FIX Issue #7: Extracted to reduce nesting
 * @private
 */
async function _trySingleTargetedMessage(message, targetTabId, operation, retry) {
  const attempts = retry + 1;
  console.log(`[Manager] MESSAGE_RETRY: ${operation} attempt ${attempts}`, {
    quickTabId: message.quickTabId,
    targetTabId,
    retry
  });

  try {
    const response = await _sendMessageWithTimeout(targetTabId, message, PORT_MESSAGE_TIMEOUT_MS);
    if (response?.success) {
      logPortLifecycle('MESSAGE_ACK_RECEIVED', {
        operation,
        quickTabId: message.quickTabId,
        targetTabId,
        attempts,
        method: 'targeted'
      });
      return { success: true, attempts, targetTabId };
    }
    return { success: false, attempts };
  } catch (err) {
    console.warn(`[Manager] MESSAGE_RETRY: ${operation} attempt ${attempts} failed`, {
      quickTabId: message.quickTabId,
      targetTabId,
      error: err.message,
      willRetry: retry < MESSAGE_RETRY_COUNT
    });
    return { success: false, attempts };
  }
}

/**
 * Send message with retry logic and broadcast fallback
 * v1.6.3.10-v1 - FIX Issue #7: Retry 2x before broadcast fallback
 * v1.6.3.10-v7 - FIX Bug #3: Message deduplication to prevent re-sends
 * @private
 * @param {Object} message - Message to send (action, quickTabId)
 * @param {number|null} targetTabId - Target tab ID (null for broadcast-only)
 * @param {string} operation - Operation name for logging (minimize/restore/close)
 * @returns {Promise<{ success: boolean, method: string, targetTabId?: number, attempts: number, error?: string }>}
 */
async function _sendMessageWithRetry(message, targetTabId, operation) {
  let attempts = 0;

  // v1.6.3.10-v7 - FIX Bug #3: Check for duplicate message
  if (_isDuplicateMessage(message.action, message.quickTabId)) {
    console.log('[Manager] MESSAGE_DEDUP_SKIPPED:', {
      action: message.action,
      quickTabId: message.quickTabId,
      operation
    });
    return {
      success: true, // Treat as success since message was already sent
      method: 'dedup',
      attempts: 0,
      error: 'Duplicate message skipped'
    };
  }

  // v1.6.3.11-v11 - FIX Issue 48 #5: Log message send
  console.log(
    `[Manager] MESSAGE_SENDING: action=${message.action}, quickTabId=${message.quickTabId}, targetTabId=${targetTabId ?? 'broadcast'}`,
    {
      action: message.action,
      quickTabId: message.quickTabId,
      targetTabId: targetTabId ?? 'broadcast',
      correlationId: message.correlationId,
      timestamp: new Date().toISOString()
    }
  );

  // v1.6.3.10-v7 - FIX Bug #3: Mark message as sent before attempting
  _markMessageSent(message.action, message.quickTabId);

  // v1.6.3.10-v1 - FIX Issue #7: Try targeted message first (if target known)
  if (targetTabId) {
    const targetedResult = await _attemptTargetedMessageWithRetry(message, targetTabId, operation);
    if (targetedResult?.success) {
      // v1.6.3.11-v11 - FIX Issue 48 #5: Log message response
      console.log(`[Manager] MESSAGE_RESPONSE: action=${message.action}, success=true`, {
        action: message.action,
        quickTabId: message.quickTabId,
        targetTabId: targetedResult.targetTabId,
        method: 'targeted',
        attempts: targetedResult.attempts
      });
      return {
        success: true,
        method: 'targeted',
        targetTabId: targetedResult.targetTabId,
        attempts: targetedResult.attempts
      };
    }
    attempts = MESSAGE_RETRY_COUNT + 1; // Count all targeted attempts
  }

  // v1.6.3.10-v1 - FIX Issue #7: Fall back to broadcast
  const broadcastResult = await _sendMessageViaBroadcast(message, operation, attempts);

  // v1.6.3.11-v11 - FIX Issue 48 #5: Log broadcast response
  console.log(
    `[Manager] MESSAGE_RESPONSE: action=${message.action}, success=${broadcastResult.success}`,
    {
      action: message.action,
      quickTabId: message.quickTabId,
      method: broadcastResult.method,
      success: broadcastResult.success,
      attempts: broadcastResult.attempts,
      error: broadcastResult.error ?? null
    }
  );

  return broadcastResult;
}

/**
 * Send message via broadcast fallback
 * v1.6.3.10-v1 - FIX Issue #7: Extracted to reduce function length
 * @private
 */
async function _sendMessageViaBroadcast(message, operation, previousAttempts) {
  console.log(`[Manager] MESSAGE_RETRY: ${operation} falling back to broadcast`, {
    quickTabId: message.quickTabId,
    previousAttempts,
    reason: previousAttempts > 0 ? 'targeted messages failed' : 'no target tab'
  });

  try {
    const broadcastResult = await sendMessageToAllTabs(message.action, message.quickTabId);
    const totalAttempts = previousAttempts + 1;

    if (broadcastResult.success > 0) {
      logPortLifecycle('MESSAGE_ACK_RECEIVED', {
        operation,
        quickTabId: message.quickTabId,
        attempts: totalAttempts,
        method: 'broadcast',
        successCount: broadcastResult.success
      });
      return { success: true, method: 'broadcast', attempts: totalAttempts };
    }

    return {
      success: false,
      method: 'broadcast',
      attempts: totalAttempts,
      error: 'No tabs responded'
    };
  } catch (err) {
    return {
      success: false,
      method: 'broadcast',
      attempts: previousAttempts + 1,
      error: err.message
    };
  }
}

/**
 * Send message to specific tab with timeout
 * v1.6.3.10-v1 - FIX Issue #7: Wrapped tabs.sendMessage with timeout
 * @private
 * @param {number} tabId - Target tab ID
 * @param {Object} message - Message to send
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<Object>} Response from content script
 */
function _sendMessageWithTimeout(tabId, message, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Message timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    browser.tabs
      .sendMessage(tabId, message)
      .then(response => {
        clearTimeout(timer);
        resolve(response);
      })
      .catch(err => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Async delay helper
 * v1.6.3.10-v1 - FIX Issue #7: Use instead of setTimeout for race conditions
 * @private
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
function _delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== END MESSAGE RETRY LOGIC ====================

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
 * v1.6.3.12-v7 - Refactored to reduce cyclomatic complexity
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
 * v1.6.3.12-v7 - FIX BUG #4: Prioritize originTabId from storage over quickTabHostInfo
 *
 * After adoption, storage contains the correct originTabId but quickTabHostInfo
 * may still have the old host tab ID. We should prioritize storage (tabData.originTabId)
 * as the source of truth.
 *
 * @private
 */
function _resolveRestoreTarget(quickTabId, tabData) {
  const hostInfo = quickTabHostInfo.get(quickTabId);

  // v1.6.3.12-v7 - FIX BUG #4: Prioritize storage originTabId over quickTabHostInfo
  // After adoption, storage has the correct originTabId but hostInfo may be stale
  if (tabData.originTabId) {
    return tabData.originTabId;
  }

  // Fall back to hostInfo if no originTabId in storage
  return hostInfo?.hostTabId || null;
}

/**
 * Log restore target resolution details
 * v1.6.3.12-v7 - FIX BUG #4: Enhanced logging to show source of truth
 * v1.6.3.12-v7 - Use shared determineRestoreSource utility to reduce code duplication
 * @private
 */
function _logRestoreTargetResolution(quickTabId, tabData, targetTabId) {
  const hostInfo = quickTabHostInfo.get(quickTabId);
  // v1.6.3.12-v7 - Use shared utility for source determination
  const source = determineRestoreSource(tabData, hostInfo);

  console.log('[Manager] 🎯 RESTORE_TARGET_RESOLUTION:', {
    quickTabId,
    targetTabId,
    hostInfoTabId: hostInfo?.hostTabId,
    originTabId: tabData.originTabId,
    source,
    // v1.6.3.12-v7 - Show if hostInfo was overridden by storage originTabId
    hostInfoOverridden:
      hostInfo?.hostTabId && tabData.originTabId && hostInfo.hostTabId !== tabData.originTabId
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
    console.warn(
      `[Manager] Targeted restore failed (tab ${targetTabId} may be closed), falling back to broadcast:`,
      err.message
    );
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

    browser.tabs
      .sendMessage(tabId, {
        action: 'RESTORE_QUICK_TAB',
        quickTabId,
        // v1.6.3.7-v1 - FIX ISSUE #6: Include metadata for tracking
        _meta: {
          requestId: `restore-${quickTabId}-${Date.now()}`,
          sentAt: Date.now(),
          expectsConfirmation: true
        }
      })
      .then(response => {
        clearTimeout(timer);
        resolve(response);
      })
      .catch(err => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Send restore message to all tabs and track first confirmation
 * v1.6.3.7-v1 - FIX ISSUE #2: Broadcast with confirmation tracking
 * v1.6.3.12-v7 - Refactored to reduce nesting depth
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
 * v1.6.3.12-v7 - Refactored to reduce nesting depth to 2
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
 * Check restore preconditions and return early if not met
 * v1.6.3.12-v7 - FIX Issue #20: Extracted to reduce complexity
 * @private
 * @returns {Object|null} { validation, operationKey } if preconditions met, null otherwise
 */
function _checkRestorePreconditions(quickTabId, correlationId) {
  const operationKey = `restore-${quickTabId}`;
  if (isOperationPending(operationKey)) {
    console.log('[Manager] OPERATION_REJECTED: Duplicate operation pending:', {
      action: 'RESTORE_QUICK_TAB',
      quickTabId,
      correlationId,
      reason: 'duplicate-pending'
    });
    return null;
  }

  const validation = validateRestoreTabData(quickTabId, quickTabsState);
  if (!validation.valid) {
    console.log('[Manager] OPERATION_REJECTED: Validation failed:', {
      action: 'RESTORE_QUICK_TAB',
      quickTabId,
      correlationId,
      reason: 'validation-failed',
      error: validation.error
    });
    _showErrorNotification(validation.error);
    return null;
  }

  return { validation, operationKey };
}

/**
 * Check connectivity prerequisites for restore
 * v1.6.3.12-v7 - FIX Issue #20: Extracted to reduce complexity
 * @private
 * @returns {Promise<boolean>} true if connectivity is available
 */
async function _checkRestoreConnectivity(quickTabId, correlationId) {
  // v1.6.3.10-v2 - FIX Issue #4: Queue action if circuit breaker is open
  if (circuitBreakerState === 'open') {
    const queued = _queuePendingAction('RESTORE_QUICK_TAB', { quickTabId });
    if (queued) {
      console.log('[Manager] OPERATION_QUEUED: Circuit breaker open:', {
        action: 'RESTORE_QUICK_TAB',
        quickTabId,
        correlationId,
        reason: 'circuit-breaker-open'
      });
      _showErrorNotification('Connection temporarily unavailable. Action queued.');
      return false;
    }
  }

  // v1.6.3.10-v1 - FIX Issue #2: Verify port viability before critical operation
  const portViable = await verifyPortViability();
  if (!portViable) {
    console.warn('[Manager] OPERATION_DEFERRED: Port not viable:', {
      action: 'RESTORE_QUICK_TAB',
      quickTabId,
      correlationId,
      reason: 'port-not-viable'
    });
    _queuePendingAction('RESTORE_QUICK_TAB', { quickTabId });
    _showErrorNotification('Connection lost. Action queued for retry.');
    return false;
  }

  return true;
}

/**
 * Handle restore operation result
 * v1.6.3.12-v7 - FIX Issue #20: Extracted to reduce complexity
 * @private
 */
function _handleRestoreOperationResult(quickTabId, result, correlationId, durationMs) {
  if (result.success) {
    console.log('[Manager] OPERATION_COMPLETED: Manager action completed:', {
      action: 'RESTORE_QUICK_TAB',
      quickTabId,
      correlationId,
      status: 'success',
      method: result.method,
      targetTabId: result.targetTabId,
      attempts: result.attempts,
      durationMs
    });

    // v1.6.3.10-v1 - Update host info after successful restore
    if (result.targetTabId) {
      quickTabHostInfo.set(quickTabId, {
        hostTabId: result.targetTabId,
        lastUpdate: Date.now(),
        lastOperation: 'restore',
        confirmed: true
      });
    }
  } else {
    console.error('[Manager] OPERATION_FAILED: Manager action failed:', {
      action: 'RESTORE_QUICK_TAB',
      quickTabId,
      correlationId,
      status: 'failed',
      error: result.error,
      attempts: result.attempts,
      durationMs
    });
    _showErrorNotification(`Failed to restore Quick Tab: ${result.error}`);
  }
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
 * v1.6.3.12-v7 - Refactored to reduce cyclomatic complexity
 * v1.6.3.12-v7 - FIX Issue #20: Comprehensive logging for Manager-initiated operations
 */
async function restoreQuickTab(quickTabId) {
  const correlationId = generateOperationCorrelationId('restore', quickTabId);
  const startTime = Date.now();

  // v1.6.3.12-v7 - FIX Issue #20: Log operation start
  console.log('[Manager] OPERATION_INITIATED: Manager action requested:', {
    action: 'RESTORE_QUICK_TAB',
    quickTabId,
    correlationId,
    currentBrowserTabId,
    timestamp: startTime
  });

  _logRestoreRequest(quickTabId, startTime, correlationId);

  // Check preconditions
  const preconditions = _checkRestorePreconditions(quickTabId, correlationId);
  if (!preconditions) return;

  const { validation, operationKey } = preconditions;

  // Check connectivity
  const connectivityOk = await _checkRestoreConnectivity(quickTabId, correlationId);
  if (!connectivityOk) return;

  console.log('[Manager] Restore validated - tab is minimized:', quickTabId);
  setupPendingOperation(operationKey);

  // Resolve target
  const hostInfo = quickTabHostInfo.get(quickTabId);
  const targetTabId = hostInfo?.hostTabId || validation.tabData.originTabId;

  // v1.6.3.12-v7 - FIX Issue #20: Log target resolution
  console.log('[Manager] OPERATION_TARGET_RESOLVED:', {
    action: 'RESTORE_QUICK_TAB',
    quickTabId,
    correlationId,
    targetTabId,
    originTabId: validation.tabData.originTabId,
    hostInfoTabId: hostInfo?.hostTabId,
    source: hostInfo?.hostTabId ? 'hostInfo' : 'originTabId'
  });

  // v1.6.3.10-v4 - FIX Issue #1: Diagnostic logging for cross-tab operation VALIDATION
  console.log('[Manager][Operation] VALIDATION: Checking cross-tab operation', {
    operation: 'RESTORE',
    quickTabId: quickTabId,
    quickTabOriginTabId: validation.tabData.originTabId,
    requestingTabId: currentBrowserTabId,
    targetTabId: targetTabId,
    decision: 'ALLOW'
  });

  const result = await _sendMessageWithRetry(
    {
      action: 'RESTORE_QUICK_TAB',
      quickTabId,
      correlationId
    },
    targetTabId,
    'restore'
  );

  const durationMs = Date.now() - startTime;

  _logRestoreResult(
    quickTabId,
    { success: result.success, confirmedBy: result.targetTabId },
    startTime,
    correlationId
  );

  _handleRestoreOperationResult(quickTabId, result, correlationId, durationMs);

  _scheduleRestoreVerification(quickTabId);
}

/**
 * Log restore request with context
 * v1.6.3.12-v7 - FIX Issue #20: Added correlationId parameter
 * @private
 */
function _logRestoreRequest(quickTabId, timestamp, correlationId = null) {
  console.log('[Manager] 🔄 RESTORE_REQUEST:', {
    quickTabId,
    timestamp,
    correlationId,
    quickTabsStateTabCount: quickTabsState?.tabs?.length ?? 0,
    currentBrowserTabId
  });
}

/**
 * Log restore result
 * v1.6.3.12-v7 - FIX Issue #20: Added correlationId parameter
 * @private
 */
function _logRestoreResult(quickTabId, confirmationResult, startTime, correlationId = null) {
  console.log('[Manager] 🔄 RESTORE_RESULT:', {
    quickTabId,
    correlationId,
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
 * v1.6.3.12-v5 - FIX: Use storage.local exclusively (storage.session not available in Firefox MV2)
 * @private
 */
async function _getQuickTabFromStorage(quickTabId) {
  // v1.6.3.12-v5 - FIX: Use storage.local exclusively (storage.session not available in Firefox MV2)
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
 * v1.6.3.10-v2 - FIX Issue #4: Queue action if circuit breaker is open
 * v1.6.3.12-v7 - FIX Issue #20: Comprehensive logging for Manager-initiated operations
 * v1.6.3.12-v7 - FIX Code Health: Refactored to reduce line count (91 -> ~40)
 */
async function closeQuickTab(quickTabId) {
  const correlationId = generateOperationCorrelationId('close', quickTabId);
  const startTime = Date.now();

  console.log('[Manager] OPERATION_INITIATED: Manager action requested:', {
    action: 'CLOSE_QUICK_TAB',
    quickTabId,
    correlationId,
    currentBrowserTabId,
    timestamp: startTime
  });

  // v1.6.3.10-v2 - FIX Issue #4: Queue if circuit breaker open
  if (_shouldQueueForCircuitBreaker('CLOSE_QUICK_TAB', quickTabId, correlationId)) {
    return;
  }

  // v1.6.3.10-v1 - FIX Issue #2: Verify port viability
  if (!(await _checkPortViabilityOrQueue('CLOSE_QUICK_TAB', quickTabId, correlationId))) {
    return;
  }

  // Resolve target tab
  const { targetTabId, originTabId } = _resolveTargetTab(
    quickTabId,
    'CLOSE_QUICK_TAB',
    correlationId
  );

  // v1.6.3.10-v4 - FIX Issue #1: Diagnostic logging
  console.log('[Manager][Operation] VALIDATION: Checking cross-tab operation', {
    operation: 'CLOSE',
    quickTabId,
    quickTabOriginTabId: originTabId,
    requestingTabId: currentBrowserTabId,
    targetTabId,
    decision: 'ALLOW'
  });

  // Send message with retry
  const result = await _sendMessageWithRetry(
    { action: 'CLOSE_QUICK_TAB', quickTabId, correlationId },
    targetTabId,
    'close'
  );

  const durationMs = Date.now() - startTime;
  _logOperationResult({
    action: 'CLOSE_QUICK_TAB',
    quickTabId,
    correlationId,
    result,
    durationMs,
    targetTabId
  });

  if (result.success) {
    quickTabHostInfo.delete(quickTabId);
  } else {
    _showErrorNotification(`Failed to close Quick Tab: ${result.error}`);
  }
}

/**
 * Adopt an orphaned Quick Tab to the current browser tab
 * v1.6.3.7-v1 - FIX ISSUE #8: Allow users to "rescue" orphaned Quick Tabs
 * v1.6.3.12-v7 - FIX Issue A: Send ADOPT_TAB command to background instead of direct storage write
 *   - Manager sends command, background is sole writer
 *   - Background updates state, writes to storage, sends confirmation
 * v1.6.3.12-v7 - FIX Issue #20: Comprehensive logging for Manager-initiated operations
 * @param {string} quickTabId - The Quick Tab ID to adopt
 * @param {number} targetTabId - The browser tab ID to adopt to
 */
async function adoptQuickTabToCurrentTab(quickTabId, targetTabId) {
  const correlationId = generateOperationCorrelationId('adopt', quickTabId);
  const startTime = Date.now();

  // v1.6.3.12-v7 - FIX Issue #20: Log operation start
  console.log('[Manager] OPERATION_INITIATED: Manager action requested:', {
    action: 'ADOPT_TAB',
    quickTabId,
    targetTabId,
    correlationId,
    currentBrowserTabId,
    timestamp: startTime
  });

  _logAdoptRequest(quickTabId, targetTabId, correlationId);

  // Validate targetTabId
  if (!_isValidTargetTabId(targetTabId)) {
    console.error('[Manager] OPERATION_REJECTED: Invalid targetTabId:', {
      action: 'ADOPT_TAB',
      quickTabId,
      targetTabId,
      correlationId,
      reason: 'invalid-target-tab-id'
    });
    return;
  }

  try {
    // v1.6.3.12-v7 - FIX Issue A: Send command to background instead of direct storage write
    console.log('[Manager] Sending ADOPT_QUICK_TAB command to background:', {
      quickTabId,
      targetTabId,
      correlationId
    });

    const response = await _sendActionRequest('ADOPT_TAB', {
      quickTabId,
      targetTabId,
      correlationId
    });

    _handleAdoptResponse({ quickTabId, targetTabId, response, correlationId, startTime });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error('[Manager] OPERATION_FAILED:', {
      action: 'ADOPT_TAB',
      quickTabId,
      targetTabId,
      correlationId,
      status: 'failed',
      error: err.message,
      durationMs
    });
  }
}

/**
 * Handle adoption command response
 * v1.6.3.12-v7 - FIX Issue A: Extracted to reduce nesting depth
 * v1.6.3.12-v7 - FIX Issue #20: Added correlationId and timing parameters
 * @private
 * @param {string} quickTabId - Quick Tab ID
 * @param {number} targetTabId - Target browser tab ID
 * @param {Object} response - Response from background
 * @param {string} correlationId - Correlation ID for tracing
 * @param {number} startTime - Operation start timestamp
 */
/**
 * Handle successful adoption response
 * v1.6.3.10-v8 - FIX Code Health: Use options object
 * @private
 */
function _handleAdoptSuccess({ quickTabId, targetTabId, response, correlationId, durationMs }) {
  console.log('[Manager] OPERATION_COMPLETED:', {
    action: 'ADOPT_TAB',
    quickTabId,
    targetTabId,
    correlationId,
    status: 'success',
    oldOriginTabId: response?.oldOriginTabId,
    newOriginTabId: targetTabId,
    timedOut: response?.timedOut || false,
    durationMs
  });
  console.log('[Manager] ✅ ADOPT_COMMAND_SUCCESS:', {
    quickTabId,
    targetTabId,
    timedOut: response?.timedOut || false
  });

  quickTabHostInfo.set(quickTabId, {
    hostTabId: targetTabId,
    lastUpdate: Date.now(),
    lastOperation: 'adopt',
    confirmed: true
  });
  if (response?.oldOriginTabId) browserTabInfoCache.delete(response.oldOriginTabId);
  scheduleRender('adopt-success');
}

/**
 * Handle failed adoption response
 * v1.6.3.10-v8 - FIX Code Health: Use options object
 * @private
 */
function _handleAdoptFailure({ quickTabId, targetTabId, response, correlationId, durationMs }) {
  const error = response?.error || 'Unknown error';
  console.error('[Manager] OPERATION_FAILED:', {
    action: 'ADOPT_TAB',
    quickTabId,
    targetTabId,
    correlationId,
    status: 'failed',
    error,
    durationMs
  });
  console.error('[Manager] ❌ ADOPT_COMMAND_FAILED:', { quickTabId, targetTabId, error });
}

/**
 * Handle adoption response
 * v1.6.3.10-v8 - FIX Code Health: Use options object
 * @private
 */
function _handleAdoptResponse({
  quickTabId,
  targetTabId,
  response,
  correlationId = null,
  startTime = null
}) {
  const durationMs = startTime ? Date.now() - startTime : null;
  const opts = { quickTabId, targetTabId, response, correlationId, durationMs };
  if (response?.success || response?.timedOut) {
    _handleAdoptSuccess(opts);
  } else {
    _handleAdoptFailure(opts);
  }
}

/**
 * Log adopt request
 * v1.6.3.7 - FIX Issue #7: Enhanced adoption data flow logging
 * v1.6.3.12-v7 - FIX Issue C: Added ADOPTION_INITIATED log as specified in acceptance criteria
 * v1.6.3.12-v7 - FIX Issue #20: Added correlationId parameter
 * @private
 */
function _logAdoptRequest(quickTabId, targetTabId, correlationId = null) {
  // v1.6.3.12-v7 - FIX Issue C: Log ADOPTION_INITIATED as specified in issue requirements
  console.log('[Manager] ADOPTION_INITIATED:', {
    quickTabId,
    targetTabId,
    correlationId,
    message: `${quickTabId} → tab-${targetTabId}`,
    timestamp: Date.now()
  });

  // v1.6.3.7 - FIX Issue #7: Use standardized format for adoption flow tracking
  console.log('[Manager] ADOPTION_FLOW:', {
    quickTabId,
    originTabId: targetTabId,
    correlationId,
    action: 'adopt_button_clicked',
    result: 'pending',
    currentBrowserTabId,
    timestamp: Date.now()
  });

  console.log('[Manager] 📥 ADOPT_TO_CURRENT_TAB:', {
    quickTabId,
    targetTabId,
    correlationId,
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
 * v1.6.3.7 - FIX Issue #7: Added adoption data flow logging throughout
 * Refactored to reduce function length by extracting helpers
 * @private
 * @returns {Promise<{ oldOriginTabId: number, saveId: string, writeTimestamp: number }|null>} Result or null if failed
 */
async function _performAdoption(quickTabId, targetTabId) {
  const writeStartTime = Date.now();

  const stateResult = await _readStorageForAdoption(quickTabId, targetTabId);
  if (!stateResult.success) return null;

  const { state, quickTab, tabIndex: _tabIndex, oldOriginTabId } = stateResult;

  quickTab.originTabId = targetTabId;
  _logAdoptionUpdate(quickTabId, oldOriginTabId, targetTabId);

  return _persistAdoption({ quickTabId, targetTabId, state, oldOriginTabId, writeStartTime });
}

/**
 * Read storage state for adoption
 * v1.6.3.7 - FIX Issue #7: Helper for adoption with logging
 * v1.6.3.12-v5 - FIX: Use storage.local exclusively (storage.session not available in Firefox MV2)
 * @private
 */
async function _readStorageForAdoption(quickTabId, targetTabId) {
  // v1.6.3.12-v5 - FIX: Use storage.local exclusively (storage.session not available in Firefox MV2)
  const result = await browser.storage.local.get(STATE_KEY);
  const state = result?.[STATE_KEY];

  if (!state?.tabs?.length) {
    console.warn('[Manager] No Quick Tabs in storage to adopt');
    console.log('[Manager] ADOPTION_FLOW:', {
      quickTabId,
      originTabId: targetTabId,
      action: 'storage_read',
      result: 'failed_no_tabs'
    });
    return { success: false };
  }

  const tabIndex = state.tabs.findIndex(t => t.id === quickTabId);
  if (tabIndex === -1) {
    console.warn('[Manager] Quick Tab not found for adopt:', quickTabId);
    console.log('[Manager] ADOPTION_FLOW:', {
      quickTabId,
      originTabId: targetTabId,
      action: 'find_tab',
      result: 'failed_tab_not_found'
    });
    return { success: false };
  }

  const quickTab = state.tabs[tabIndex];
  const oldOriginTabId = quickTab.originTabId;

  console.log('[Manager] ADOPTION_FLOW:', {
    quickTabId,
    originTabId: oldOriginTabId,
    action: 'before_update',
    result: 'read_existing',
    existingOriginTabId: oldOriginTabId
  });

  return { success: true, state, quickTab, tabIndex, oldOriginTabId };
}

/**
 * Log adoption update (before persist)
 * v1.6.3.7 - FIX Issue #7: Helper for adoption logging
 * @private
 */
function _logAdoptionUpdate(quickTabId, oldOriginTabId, targetTabId) {
  console.log('[Manager] ADOPTION_FLOW:', {
    quickTabId,
    originTabId: targetTabId,
    action: 'after_update',
    result: 'updated_in_memory',
    oldOriginTabId,
    newOriginTabId: targetTabId
  });
}

/**
 * Persist adoption to storage
 * v1.6.3.7 - FIX Issue #7: Helper for adoption persistence with logging
 * v1.6.3.10-v8 - FIX Code Health: Use options object
 * @private
 */
async function _persistAdoption({
  quickTabId,
  targetTabId,
  state,
  oldOriginTabId,
  writeStartTime
}) {
  const saveId = `adopt-${quickTabId}-${Date.now()}`;
  const writeTimestamp = Date.now();
  const stateToWrite = {
    tabs: state.tabs,
    saveId,
    timestamp: writeTimestamp,
    writingTabId: targetTabId,
    writingInstanceId: `manager-adopt-${writeTimestamp}`
  };

  console.log('[Manager] ADOPT_STORAGE_WRITE:', {
    quickTabId,
    oldOriginTabId,
    newOriginTabId: targetTabId,
    saveId,
    tabCount: state.tabs.length
  });
  console.log('[Manager] ADOPTION_FLOW:', {
    quickTabId,
    originTabId: targetTabId,
    action: 'before_persist',
    saveId
  });

  // v1.6.3.12-v5 - FIX: Use storage.local exclusively (storage.session not available in Firefox MV2)
  await browser.storage.local.set({ [STATE_KEY]: stateToWrite });
  const writeEndTime = Date.now();

  console.log('[Manager] ADOPTION_FLOW:', {
    quickTabId,
    originTabId: targetTabId,
    action: 'after_persist',
    saveId,
    durationMs: writeEndTime - writeStartTime
  });
  console.log('[Manager] ✅ ADOPT_COMPLETED:', {
    quickTabId,
    oldOriginTabId,
    newOriginTabId: targetTabId,
    saveId
  });

  _verifyAdoptionInStorage(quickTabId, saveId, writeTimestamp);
  return { oldOriginTabId, saveId, writeTimestamp };
}

/**
 * Issue #9: Verify adoption was persisted by monitoring storage.onChanged
 * Logs time delta between write and confirmation, warns if no confirmation within 2 seconds
 * v1.6.3.12-v2 - FIX Issue #13: Listen for 'local' area (Firefox MV2 has no storage.session)
 * @private
 * @param {string} quickTabId - Quick Tab ID that was adopted
 * @param {string} expectedSaveId - SaveId to look for in storage change
 * @param {number} writeTimestamp - Timestamp when write occurred
 */
function _verifyAdoptionInStorage(quickTabId, expectedSaveId, writeTimestamp) {
  let confirmed = false;
  const CONFIRMATION_TIMEOUT_MS = 2000;

  // Issue #9: Temporary listener for this specific saveId
  // v1.6.3.12-v2 - FIX Issue #13: Listen for 'local' area (Firefox MV2 has no storage.session)
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
