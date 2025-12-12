/**
 * Sidebar Modules Index
 * sidebar/modules/index.js
 *
 * v1.6.3.8-v4 - Module organization for bundle size refactoring
 *
 * This file re-exports all sidebar modules for convenient importing.
 */

// ==================== INIT BARRIER MODULE ====================
export {
  // Constants
  INIT_BARRIER_TIMEOUT_MS,
  STORAGE_VERIFICATION_RETRY_MS,
  VISIBILITY_REFRESH_INTERVAL_MS,
  CONNECTION_STATE,
  // State getters/setters
  isFullyInitialized,
  getInitializationStarted,
  setInitializationStarted,
  getInitializationComplete,
  setInitializationComplete,
  getInitializationStartTime,
  setInitializationStartTime,
  getCurrentInitPhase,
  setCurrentInitPhase,
  getStorageListenerVerified,
  setStorageListenerVerified,
  getConnectionState,
  setConnectionState,
  getStorageVerificationRetryCount,
  setStorageVerificationRetryCount,
  resetStorageVerificationRetryCount,
  getPreInitMessageQueue,
  // Functions
  registerMessageReplayHandlers,
  initializeBarrier,
  handleInitBarrierTimeout,
  resolveInitBarrier,
  queueMessageDuringInit,
  replayQueuedMessages,
  awaitInitBarrier,
  logListenerEntry,
  guardBeforeInit
} from './init-barrier.js';

// ==================== DIAGNOSTICS MODULE ====================
export {
  // Constants
  DEBUG_MESSAGING,
  // Functions
  generateCorrelationId,
  generateSessionId,
  logPortLifecycle,
  logMessageReceived,
  logMessageProcessed,
  logDedupDecision,
  logConnectionStateTransition,
  logFallbackModeIfNeeded,
  logStorageRead,
  logStorageWrite,
  logStorageVerification,
  logKeepaliveHealthReport,
  logPortActivity,
  logFallbackHealth,
  logFallbackStalled,
  logError,
  logWarning,
  formatDuration,
  getAgeBucket,
  createDiagnosticSnapshot
} from './diagnostics.js';

// ==================== HEALTH METRICS MODULE ====================
export {
  // Constants
  DEDUP_CLEANUP_THRESHOLD,
  DEDUP_EVICTION_THRESHOLD,
  PROBE_MIN_INTERVAL_MS,
  PROBE_FORCE_RESET_MS,
  MESSAGE_DEDUP_MAX_SIZE,
  MESSAGE_ID_MAX_AGE_MS,
  FALLBACK_STALL_THRESHOLD_MS,
  STORAGE_HEALTH_PROBE_KEY,
  // State
  storageHealthStats,
  fallbackStats,
  // Dedup functions
  isMessageProcessed,
  markMessageProcessed,
  getDedupMapSize,
  checkDedupMapCapacity,
  cleanupOldMessageIds,
  evictOldestMessageIds,
  clearDedupMap,
  logDedupMapSize,
  // Storage health functions
  canStartProbe,
  startStorageProbe,
  completeStorageProbe,
  getStorageSuccessRate,
  getStorageHealthTier,
  getStorageHealthSnapshot,
  // Fallback health functions
  recordFallbackMessage,
  checkFallbackStall,
  getFallbackHealthSnapshot,
  resetFallbackStats,
  // Combined health
  generateHealthReport
} from './health-metrics.js';

// ==================== STATE SYNC MODULE ====================
export {
  // Port connection constants
  ACK_TIMEOUT_MS,
  UNIFIED_KEEPALIVE_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  MAX_HEARTBEAT_FAILURES,
  HEARTBEAT_FAILURES_BEFORE_ZOMBIE,
  KEEPALIVE_FAILURES_BEFORE_ZOMBIE,
  // Circuit breaker constants
  RECONNECT_BACKOFF_INITIAL_MS,
  RECONNECT_BACKOFF_MAX_MS,
  CIRCUIT_BREAKER_FAILURE_THRESHOLD,
  CIRCUIT_BREAKER_OPEN_DURATION_MS,
  CIRCUIT_BREAKER_PROBE_INTERVAL_MS,
  // State sync constants
  STATE_SYNC_TIMEOUT_MS,
  RENDER_DEBOUNCE_MS,
  LISTENER_REGISTRATION_TIMEOUT_MS,
  // Background activity constants
  BACKGROUND_ACTIVITY_CHECK_INTERVAL_MS,
  BACKGROUND_STALE_WARNING_THRESHOLD_MS,
  // Operation constants
  OPERATION_TIMEOUT_MS,
  DOM_VERIFICATION_DELAY_MS,
  BROWSER_TAB_CACHE_TTL_MS,
  // Storage listener constants
  STORAGE_LISTENER_TEST_KEY,
  STORAGE_LISTENER_VERIFICATION_TIMEOUT_MS,
  STORAGE_WATCHDOG_TIMEOUT_MS,
  // SaveId constants
  SAVEID_RECONCILED,
  SAVEID_CLEARED,
  // SaveId functions
  getLastProcessedSaveId,
  setLastProcessedSaveId,
  getLastSaveIdProcessedAt,
  shouldProcessSaveId,
  // Sequence ID functions
  getLastAppliedSequenceId,
  setLastAppliedSequenceId,
  checkAndUpdateSequenceId,
  // Port message sequence functions
  getNextPortMessageSequence,
  getCurrentPortMessageSequence,
  // In-memory cache
  MIN_TABS_FOR_CACHE_PROTECTION,
  getInMemoryTabsCache,
  updateInMemoryTabsCache,
  getLastKnownGoodTabCount,
  setLastKnownGoodTabCount,
  // Pending acks
  pendingAcks,
  clearPendingAck,
  clearAllPendingAcks,
  getPendingAcksCount
} from './state-sync.js';
