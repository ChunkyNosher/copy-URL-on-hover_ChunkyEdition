/**
 * Shared timing constants for deduplication and storage operations
 *
 * GAP-7 FIX: Centralized deduplication timing constants to eliminate
 * inconsistent hardcoded values across the codebase.
 *
 * @module constants
 * @version 1.6.3.9-v2
 */

// =============================================================================
// FIREFOX STORAGE LISTENER TIMING CONSTANTS
// =============================================================================
// These constants are based on Firefox's documented storage.onChanged behavior.
// Reference: Bugzilla #1554088 - Firefox fires storage.onChanged 100-250ms
// after a storage write completes.
// =============================================================================

/**
 * Maximum latency for Firefox storage.onChanged listener.
 *
 * Firefox's storage.onChanged listener fires 100-250ms after a storage write
 * completes (per Bugzilla #1554088). This constant represents the upper bound
 * of that latency range.
 *
 * Exported for use in any module that needs to reference Firefox's documented
 * storage timing behavior. Currently used to document how STORAGE_DEDUP_WINDOW_MS
 * is calculated.
 *
 * @constant {number}
 */
export const FIREFOX_STORAGE_LISTENER_LATENCY_MAX_MS = 250;

/**
 * Safety buffer for storage listener timing.
 *
 * Additional buffer on top of Firefox's documented latency to account for:
 * - Network jitter
 * - System load variations
 * - Edge cases in timing
 *
 * Exported for use in any module that needs to apply a timing safety margin.
 * Currently used to document how STORAGE_DEDUP_WINDOW_MS is calculated.
 *
 * @constant {number}
 */
export const STORAGE_LATENCY_BUFFER_MS = 50;

/**
 * Storage listener latency tolerance for self-write detection.
 *
 * Firefox's storage.onChanged listener typically fires 100-250ms after
 * a storage write completes. This constant accounts for:
 * - Firefox storage listener propagation delay (~100-250ms)
 * - Additional safety buffer (~50ms)
 *
 * Total: FIREFOX_STORAGE_LISTENER_LATENCY_MAX_MS (250) + STORAGE_LATENCY_BUFFER_MS (50) = 300ms
 *
 * Used in content.js for self-write detection to prevent echoed storage
 * changes from being processed as external updates.
 *
 * @constant {number}
 */
export const STORAGE_DEDUP_WINDOW_MS = 300;

/**
 * Storage event ordering tolerance for out-of-order event handling.
 *
 * Same value as STORAGE_DEDUP_WINDOW_MS (300ms) but with different semantic purpose:
 * - STORAGE_DEDUP_WINDOW_MS: Used for self-write detection (ignoring echoed storage changes)
 * - STORAGE_ORDERING_TOLERANCE_MS: Used for validating event ordering (accepting delayed events)
 *
 * Kept as separate constants for code clarity and future flexibility if these
 * tolerances need to diverge.
 *
 * @constant {number}
 */
export const STORAGE_ORDERING_TOLERANCE_MS = 300;

/**
 * Out-of-order event tolerance for cross-tab timing.
 *
 * Tight tolerance window for accepting events that arrive slightly
 * out of order due to cross-tab timing differences. Shorter than
 * STORAGE_ORDERING_TOLERANCE_MS because it's for already-received events.
 *
 * @constant {number}
 */
export const OUT_OF_ORDER_TOLERANCE_MS = 100;

// =============================================================================
// FALLBACK AND TIMEOUT CONSTANTS
// =============================================================================

/**
 * Timeout for fallback sync to complete.
 *
 * When Promise-based messages fail, we fall back to storage.onChanged.
 * This timeout triggers a warning if the fallback doesn't complete
 * within the expected window.
 *
 * @constant {number}
 */
export const FALLBACK_SYNC_TIMEOUT_MS = 2000;

/**
 * Timeout for tab ID fetch operations.
 *
 * Maximum time to wait for background to respond with tab ID.
 * Reduced from 10s to 2s for non-blocking initialization.
 *
 * @constant {number}
 */
export const TAB_ID_FETCH_TIMEOUT_MS = 2000;

/**
 * Delay between tab ID fetch retries.
 *
 * @constant {number}
 */
export const TAB_ID_FETCH_RETRY_DELAY_MS = 300;

/**
 * Delay for fallback retry operations.
 *
 * @constant {number}
 */
export const FALLBACK_RETRY_DELAY_MS = 500;

// =============================================================================
// MESSAGE DEDUPLICATION CONSTANTS
// =============================================================================

/**
 * Message-level deduplication window for correlationId matching.
 *
 * Used by StorageManager to detect duplicate write requests within
 * a short time window. This is shorter than STORAGE_DEDUP_WINDOW_MS
 * because it operates at the message level, not the storage level.
 *
 * Purpose: Prevent rapid duplicate writes from the same source.
 * - Typical double-click interval: 200-300ms
 * - Programmatic retry: 0-10ms
 * - User interaction debounce: 50ms
 *
 * @constant {number}
 */
export const MESSAGE_DEDUP_WINDOW_MS = 50;

/**
 * Restore message deduplication window.
 *
 * Prevents rapid duplicate RESTORE_QUICK_TAB commands from being processed.
 * Matched to MESSAGE_DEDUP_WINDOW_MS for consistency.
 *
 * @constant {number}
 */
export const RESTORE_DEDUP_WINDOW_MS = 50;

/**
 * Handler-level deduplication window for QuickTabHandler.
 *
 * Used to deduplicate messages at the handler level. Slightly longer
 * than MESSAGE_DEDUP_WINDOW_MS to account for async processing delays.
 *
 * @constant {number}
 */
export const HANDLER_DEDUP_WINDOW_MS = 100;

/**
 * Iframe logging deduplication window.
 *
 * Used in background.js (initializeWebRequestHeaderModification function)
 * to prevent spam logging when the same URL is processed multiple times
 * in rapid succession during webRequest header modification.
 *
 * NOTE: This constant is exported for consistency but currently the value
 * is defined locally in background.js. Future refactoring may import this.
 *
 * @constant {number}
 */
export const IFRAME_DEDUP_WINDOW_MS = 200;
