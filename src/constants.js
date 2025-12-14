/**
 * Shared timing constants for deduplication and storage operations
 *
 * GAP-7 FIX: Centralized deduplication timing constants to eliminate
 * inconsistent hardcoded values across the codebase.
 *
 * @module constants
 * @version 1.6.3.9
 */

/**
 * Storage listener latency tolerance for self-write detection.
 *
 * Firefox's storage.onChanged listener typically fires 100-250ms after
 * a storage write completes. This constant accounts for:
 * - Firefox storage listener propagation delay (~100-250ms)
 * - Additional network jitter buffer (~50ms)
 *
 * Used in content.js for self-write detection to prevent echoed storage
 * changes from being processed as external updates.
 *
 * @constant {number}
 */
export const STORAGE_DEDUP_WINDOW_MS = 300;

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
