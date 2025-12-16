/**
 * Shared timing constants for deduplication and storage operations
 *
 * GAP-7 FIX: Centralized deduplication timing constants to eliminate
 * inconsistent hardcoded values across the codebase.
 *
 * v1.6.3.9-v4 - Simplified architecture constants from constants-config-reference.md
 *
 * @module constants
 * @version 1.6.3.9-v4
 */

// =============================================================================
// v1.6.3.9-v4 - STORAGE CONSTANTS (from constants-config-reference.md)
// =============================================================================

/**
 * Storage key for Quick Tab state in browser.storage.local.
 *
 * v2 suffix allows schema evolution without data loss.
 * Key name is immutable until new schema version.
 *
 * @constant {string}
 */
export const STORAGE_KEY = 'quick_tabs_state_v2';

/**
 * Whether to write state to browser.storage.sync as backup.
 *
 * Non-blocking backup (use .catch() for errors).
 * Provides recovery if storage.local corrupted.
 *
 * @constant {boolean}
 */
export const ENABLE_SYNC_BACKUP = true;

// =============================================================================
// v1.6.3.9-v4 - INITIALIZATION CONSTANTS (from constants-config-reference.md)
// =============================================================================

/**
 * Maximum time to wait for initialization to complete.
 *
 * 10 seconds is reasonable for startup.
 * State load + validation should complete in <100ms.
 * If init takes >10s, something is broken anyway.
 *
 * @constant {number}
 */
export const INIT_BARRIER_TIMEOUT_MS = 10000;

// =============================================================================
// v1.6.3.9-v4 - RENDER CONSTANTS (from constants-config-reference.md)
// =============================================================================

/**
 * Buffer rapid state changes before rendering.
 *
 * 100ms is imperceptible to users (feels responsive).
 * Batches multiple rapid storage events.
 * Reduces DOM operations by 70-90%.
 *
 * @constant {number}
 */
export const RENDER_QUEUE_DEBOUNCE_MS = 100;

// =============================================================================
// v1.6.3.9-v4 - MESSAGE CONSTANTS (from constants-config-reference.md)
// =============================================================================

/**
 * Timeout for runtime.sendMessage() calls.
 *
 * 3 seconds is standard for web timeouts.
 * Background script should respond <100ms normally.
 * Covers slow devices and startup delays.
 *
 * @constant {number}
 */
export const MESSAGE_TIMEOUT_MS = 3000;

// =============================================================================
// v1.6.3.9-v4 - HEALTH CHECK CONSTANTS (from constants-config-reference.md)
// =============================================================================

/**
 * How often to verify storage.onChanged is firing.
 *
 * 5 seconds is quick enough to detect broken storage listener.
 * Not too frequent (minimal overhead).
 *
 * @constant {number}
 */
export const STORAGE_HEALTH_CHECK_INTERVAL_MS = 5000;

/**
 * Reject storage events older than this threshold.
 *
 * 5 minutes = 300,000ms.
 * Events from before browser sleep/reload should be ignored.
 * Prevents stale state from being applied.
 *
 * @constant {number}
 */
export const STORAGE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

// =============================================================================
// v1.6.3.9-v4 - QUICK TAB ID CONSTANTS (from constants-config-reference.md)
// =============================================================================

/**
 * Prefix for all Quick Tab IDs.
 *
 * 'qt-' is short and unambiguous.
 * Always distinguishable from browser tab IDs.
 *
 * @constant {string}
 */
export const QUICK_TAB_ID_PREFIX = 'qt-';

/**
 * Length of random suffix in Quick Tab ID.
 *
 * 6 characters = 36^6 ≈ 2.1 billion combinations.
 * Very low collision probability (0.0001% for 1000 IDs).
 *
 * @constant {number}
 */
export const QUICK_TAB_ID_RANDOM_LENGTH = 6;

// =============================================================================
// v1.6.3.9-v4 - SIZE CONSTRAINTS (from constants-config-reference.md)
// =============================================================================

/**
 * Minimum width of Quick Tab window (pixels).
 *
 * 200px is usable minimum for web content.
 *
 * @constant {number}
 */
export const MIN_QUICK_TAB_WIDTH = 200;

/**
 * Maximum width of Quick Tab window (pixels).
 *
 * 3000px covers most monitor widths including 4K.
 *
 * @constant {number}
 */
export const MAX_QUICK_TAB_WIDTH = 3000;

/**
 * Minimum height of Quick Tab window (pixels).
 *
 * 200px is minimum for readable content.
 *
 * @constant {number}
 */
export const MIN_QUICK_TAB_HEIGHT = 200;

/**
 * Maximum height of Quick Tab window (pixels).
 *
 * 2000px covers most monitor heights including 4K.
 *
 * @constant {number}
 */
export const MAX_QUICK_TAB_HEIGHT = 2000;

// =============================================================================
// v1.6.3.9-v4 - STATE LIMITS (from constants-config-reference.md)
// =============================================================================

/**
 * Maximum Quick Tabs allowed simultaneously.
 *
 * 100 tabs = ~50-100KB state JSON.
 * Checksum computation: O(n), ~10ms for 100 tabs.
 * Render performance: Still responsive with DOM reconciliation.
 *
 * @constant {number}
 */
export const MAX_QUICK_TABS = 100;

/**
 * Maximum URL length allowed.
 *
 * 2048 is HTTP standard max URL length.
 * Prevents storage bloat from malicious URLs.
 *
 * @constant {number}
 */
export const URL_MAX_LENGTH = 2048;

/**
 * Maximum title length.
 *
 * 255 is database field size standard.
 * Most page titles are <100 characters.
 *
 * @constant {number}
 */
export const TITLE_MAX_LENGTH = 255;

// =============================================================================
// v1.6.3.9-v4 - ORPHAN CLEANUP CONSTANTS (from constants-config-reference.md)
// =============================================================================

/**
 * How often to run orphan cleanup task.
 *
 * 1 hour = 3,600,000ms.
 * Not too frequent (minimal CPU overhead).
 *
 * @constant {number}
 */
export const ORPHAN_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// =============================================================================
// v1.6.3.9-v4 - CHECKSUM CONSTANTS (from constants-config-reference.md)
// =============================================================================

/**
 * Version of checksum algorithm.
 *
 * 'v1' allows future checksum algorithms without conflicts.
 * Current: Simple hash (not cryptographic).
 *
 * @constant {string}
 */
export const CHECKSUM_VERSION = 'v1';

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
 * Firefox storage.onChanged has NO guaranteed delivery timing per MDN docs.
 * During content script startup, events may be delayed 500ms+ on slow devices.
 * Fallback polling is the PRIMARY reliable mechanism, storage listener is optimization.
 *
 * v1.6.3.9-v3 - Issue #47-12: Increased from 2000ms to 2500ms for Firefox timing tolerance.
 *
 * @constant {number}
 */
export const FALLBACK_SYNC_TIMEOUT_MS = 2500;

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

// =============================================================================
// v1.6.3.9-v2 - TAB EVENTS CONSTANTS (Issue #6)
// =============================================================================

/**
 * Debounce interval for browser.tabs.onUpdated events.
 *
 * Prevents rapid duplicate updates when tab properties change frequently
 * (e.g., during page load when title/favicon update multiple times).
 *
 * v1.6.3.9-v2 - Issue #6: Container Isolation at Storage Level
 *
 * @constant {number}
 */
export const TAB_UPDATED_DEBOUNCE_MS = 500;

/**
 * Maximum age for pending tab updates before discarding.
 *
 * Prevents stale updates from processing if debounce accumulates
 * too many changes over an extended period.
 *
 * v1.6.3.9-v2 - Issue #6: Container Isolation at Storage Level
 *
 * @constant {number}
 */
export const PENDING_TAB_UPDATE_MAX_AGE_MS = 5000;

/**
 * Default container ID for tabs without container context.
 *
 * Firefox uses 'firefox-default' for the default (non-container) context.
 * This constant ensures consistency across all container-aware code.
 *
 * v1.6.3.9-v2 - Issue #6: Container Isolation at Storage Level
 *
 * @constant {string}
 */
export const DEFAULT_CONTAINER_ID = 'firefox-default';

// =============================================================================
// v1.6.3.9-v6 - GAP #5: CENTRALIZED BACKGROUND CONSTANTS
// =============================================================================
// These constants were moved from background.js to this centralized location
// for consistency with the project architecture.

/**
 * Window for ignoring self-triggered storage events (ms).
 *
 * When background writes to storage, the storage.onChanged event will fire.
 * This window prevents the background from processing its own writes as
 * external changes.
 *
 * v1.6.1.6 - Memory leak fix: Self-write detection window
 * v1.6.3.9-v6 - GAP #5: Moved from background.js to centralized constants
 *
 * @constant {number}
 */
export const WRITE_IGNORE_WINDOW_MS = 100;

/**
 * Cooldown period between storage change processing (ms).
 *
 * Prevents rapid duplicate processing of storage.onChanged events.
 * Applied conditionally only when dedup filter triggers.
 *
 * v1.6.3.7-v9 - FIX Issue #5: Increased from 50ms to 200ms
 * v1.6.3.9-v6 - GAP #5: Moved from background.js to centralized constants
 *
 * @constant {number}
 */
export const STORAGE_CHANGE_COOLDOWN_MS = 200;
