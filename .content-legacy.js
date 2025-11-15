// Instructions for Github Copilot Coding Agent - DO NOT MAKE ANY MODIFICATIONS TO THIS FILE UNDER ANY CIRCUMSTANCES
// THIS IS A LEGACY FILE THAT ISN'T INVOLVED WITH THE LATEST VERSIONS OF THE EXTENSION IN ANY WAY, SO DON'T UPDATE OR MAKE CHANGES TO THIS FILE
// Copy URL on Hover - Enhanced with Quick Tabs
//
// KNOWN LIMITATIONS:
// 1. Focus Issue (#2): When you click inside a Quick Tab iframe, keyboard shortcuts
//    won't work until you click back in the main page. This is a browser security
//    limitation - iframes capture keyboard focus.
//    WORKAROUND: Click anywhere in the main page to restore keyboard shortcuts.
//
// 2. Nested Quick Tabs (#3): Cannot open Quick Tabs from inside other Quick Tabs
//    because cross-origin iframes block script injection for security.
//    WORKAROUND: Use the "Open in New Tab" button to open links in a real tab.
//
// 3. Zen Browser Theme (#10): Detecting Zen Browser workspace themes requires
//    access to Zen-specific browser APIs which are not available to content scripts.
//    Would need a separate WebExtension API or Zen Browser integration.
//
// 4. Cross-Origin Media Control: Cannot pause/resume media in cross-origin iframes
//    due to browser security restrictions. Media control only works for same-origin
//    iframes (e.g., Quick Tabs opened from the same domain).
//
// BUG FIXES (v1.5.4):
// - Fixed: Opening Quick Tab via keyboard shortcut would create multiple tabs up to
//   the limit due to BroadcastChannel infinite loop. Now Quick Tabs created from
//   broadcasts are marked with fromBroadcast=true to prevent re-broadcasting.
// - Fixed: Quick Tabs now sync across ALL domains, not just same domain tabs.
// - Fixed: Quick Tab position and size changes now sync across all tabs.
// - Fixed: Closing a Quick Tab in one tab now closes it in all tabs.
// - Fixed: Quick Tabs can now be moved outside webpage boundaries.
// - Fixed: Quick Tabs reappearing after page reload even when closed. Storage is now
//   always updated when tabs are closed, regardless of broadcast state.
//
// BUG FIXES (v1.5.4.1):
// - Fixed: Quick Tab duplication bug when navigating between pages on the same domain
//   (e.g., switching between Wikipedia pages). Restored Quick Tabs now pass
//   fromBroadcast=true to prevent re-broadcasting and creating duplicates.
// - Fixed: Quick Tabs now persist across different domains (e.g., Wikipedia to YouTube)
//   by switching from localStorage to browser.storage.local which is shared across all
//   origins.
// - Added: Duplicate detection when restoring Quick Tabs to prevent multiple instances
//   of the same URL from being created.
// - Fixed: Quick Tab position and size now persist when switching tabs. Move and resize
//   broadcast handlers now save to storage.
// - Added: Pin Quick Tab feature - pin a Quick Tab to a specific page URL. Pinned Quick
//   Tabs only appear on the page they're pinned to, while unpinned Quick Tabs appear
//   across all tabs/domains.
//
// BUG FIXES (v1.5.5):
// - Fixed: Quick Tab close now syncs across different domains. browser.storage.onChanged
//   listener now detects when Quick Tabs are removed from storage and closes them locally.
// - Added: Enhanced debug mode with throttled logging (every 0.5s) during drag/resize
//   operations showing coordinates and dimensions.
// - Fixed: Pinned Quick Tabs now close ALL other instances across all tabs when pinned.
//   When a Quick Tab is pinned to a page, it broadcasts a pin message to close instances
//   in other tabs, ensuring only the pinned instance exists.
// - Fixed: Quick Tabs with video/audio content now pause when the tab loses focus and
//   resume when the tab regains focus. This prevents media from playing in background
//   tabs. Note: Only works for same-origin iframes due to browser security restrictions.
//
// BUG FIXES (v1.5.5.2):
// - Fixed: Critical bug where Quick Tabs would immediately close after being opened with
//   keyboard shortcut. Issue was caused by browser.storage.onChanged listener firing in
//   the same tab that initiated the storage change, creating a race condition where the
//   newly created Quick Tab would be immediately closed. Added isSavingToStorage flag to
//   prevent the storage listener from processing changes initiated by the same tab.
// - Fixed: Pin button functionality - pinned Quick Tabs now properly persist in their
//   designated page instead of closing when the pin button is clicked.
// - Added: YouTube timestamp synchronization feature (experimental) - Quick Tabs with
//   YouTube videos now save and restore playback position when switching tabs or pausing.
//
// BUG FIXES (v1.5.5.3):
// - Removed: YouTube timestamp synchronization feature due to bugs and compatibility issues.
//   This feature has been removed to stabilize the extension.
// - Kept: Critical bug fix for Quick Tabs immediately closing (isSavingToStorage flag)
// - Kept: Pin button functionality fix (broadcastQuickTabUnpin)

// Default configuration
const DEFAULT_CONFIG = {
  copyUrlKey: 'y',
  copyUrlCtrl: false,
  copyUrlAlt: false,
  copyUrlShift: false,

  copyTextKey: 'x',
  copyTextCtrl: false,
  copyTextAlt: false,
  copyTextShift: false,

  // Open Link in New Tab settings
  openNewTabKey: 'o',
  openNewTabCtrl: false,
  openNewTabAlt: false,
  openNewTabShift: false,
  openNewTabSwitchFocus: false,

  // Quick Tab on Hover settings
  quickTabKey: 'q',
  quickTabCtrl: false,
  quickTabAlt: false,
  quickTabShift: false,
  quickTabCloseKey: 'Escape',
  quickTabMaxWindows: 3,
  quickTabDefaultWidth: 800,
  quickTabDefaultHeight: 600,
  quickTabPosition: 'follow-cursor',
  quickTabCustomX: 100,
  quickTabCustomY: 100,
  quickTabPersistAcrossTabs: true,
  quickTabCloseOnOpen: false,
  quickTabEnableResize: true,
  quickTabUpdateRate: 360, // Position updates per second (Hz) for dragging

  showNotification: true,
  notifDisplayMode: 'tooltip',

  // Tooltip settings
  tooltipColor: '#4CAF50',
  tooltipDuration: 1500,
  tooltipAnimation: 'fade',

  // Notification settings
  notifColor: '#4CAF50',
  notifDuration: 2000,
  notifPosition: 'bottom-right',
  notifSize: 'medium',
  notifBorderColor: '#000000',
  notifBorderWidth: 1,
  notifAnimation: 'slide',

  debugMode: false,
  darkMode: true,
  menuSize: 'medium'
};

// Constants
const GOOGLE_FAVICON_URL = 'https://www.google.com/s2/favicons?domain=';
const TOOLTIP_OFFSET_X = 10;
const TOOLTIP_OFFSET_Y = 10;
const TOOLTIP_DURATION_MS = 1500;
const TOOLTIP_FADE_OUT_MS = 200;

let CONFIG = { ...DEFAULT_CONFIG };
let currentHoveredLink = null;
let currentHoveredElement = null;
let quickTabWindows = [];
let minimizedQuickTabs = [];
let quickTabZIndex = 1000000;
let lastMouseX = 0;
let lastMouseY = 0;
let isSavingToStorage = false; // Flag to prevent processing our own storage changes

// ==================== SAVE QUEUE SYSTEM ====================
// Promise-based save queue with batching and conflict resolution

class SaveQueue {
  constructor() {
    this.queue = [];
    this.flushTimer = null;
    this.flushDelay = 50; // Batch saves within 50ms window
    this.processing = false;
    this.vectorClock = new Map(); // Track causal order
    this.saveId = 0;
  }

  /**
   * Enqueue a save operation and return a promise that resolves when confirmed
   * @param {SaveOperation} operation - The save operation to queue
   * @returns {Promise<void>} Resolves when background confirms save
   */
  enqueue(operation) {
    return new Promise((resolve, reject) => {
      // Increment vector clock for this tab
      const currentCount = this.vectorClock.get(tabInstanceId) || 0;
      this.vectorClock.set(tabInstanceId, currentCount + 1);

      // Add vector clock to operation
      operation.vectorClock = new Map(this.vectorClock);
      operation.saveId = `save_${tabInstanceId}_${this.saveId++}`;
      operation.resolve = resolve;
      operation.reject = reject;
      operation.timestamp = Date.now();

      // Check for duplicate operations (same Quick Tab, same action)
      const existingIndex = this.queue.findIndex(
        op =>
          op.quickTabId === operation.quickTabId &&
          op.type === operation.type &&
          op.timestamp > Date.now() - 100 // Within last 100ms
      );

      if (existingIndex !== -1) {
        // Replace existing operation with newer data
        debug(`[SAVE QUEUE] Deduplicating ${operation.type} for ${operation.quickTabId}`);
        const oldOp = this.queue[existingIndex];
        oldOp.reject(new Error('Superseded by newer save'));
        this.queue[existingIndex] = operation;
      } else {
        // Add new operation
        this.queue.push(operation);
        debug(
          `[SAVE QUEUE] Enqueued ${operation.type} for ${operation.quickTabId} (Queue size: ${this.queue.length})`
        );
      }

      // Schedule flush
      this.scheduleFlush();
    });
  }

  /**
   * Schedule a flush after delay (debounced)
   */
  scheduleFlush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }

    this.flushTimer = setTimeout(() => {
      this.flush();
    }, this.flushDelay);
  }

  /**
   * Flush queue immediately - send all pending operations to background
   */
  async flush() {
    if (this.queue.length === 0 || this.processing) {
      return;
    }

    this.processing = true;
    this.flushTimer = null;

    // Take all pending operations
    const operations = this.queue.splice(0);

    debug(`[SAVE QUEUE] Flushing ${operations.length} operations to background`);

    try {
      // Send batch to background
      const response = await browser.runtime.sendMessage({
        action: 'BATCH_QUICK_TAB_UPDATE',
        operations: operations.map(op => ({
          type: op.type,
          quickTabId: op.quickTabId,
          data: op.data,
          priority: op.priority,
          timestamp: op.timestamp,
          vectorClock: Array.from(op.vectorClock.entries()),
          saveId: op.saveId
        })),
        tabInstanceId: tabInstanceId
      });

      if (response && response.success) {
        // Resolve all promises
        operations.forEach(op => {
          if (op.resolve) {
            op.resolve();
          }
        });
        debug(`[SAVE QUEUE] Batch save confirmed by background`);
      } else {
        throw new Error(response?.error || 'Unknown error');
      }
    } catch (err) {
      console.error('[SAVE QUEUE] Batch save failed:', err);

      // Reject all promises
      operations.forEach(op => {
        if (op.reject) {
          op.reject(err);
        }
      });

      // Optional: Retry logic
      if (operations.length > 0 && operations[0].retryCount < 3) {
        debug('[SAVE QUEUE] Retrying failed saves...');
        operations.forEach(op => {
          op.retryCount = (op.retryCount || 0) + 1;
          this.queue.push(op);
        });
        this.scheduleFlush();
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Clear queue without sending (use when tab is closing)
   */
  clear() {
    this.queue.forEach(op => {
      if (op.reject) {
        op.reject(new Error('Queue cleared'));
      }
    });
    this.queue = [];
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  size() {
    return this.queue.length;
  }
}

// Global save queue instance
const saveQueue = new SaveQueue();

// Flush queue when tab is about to close
window.addEventListener('beforeunload', () => {
  saveQueue.flush(); // Synchronous flush attempt
});
// ==================== END SAVE QUEUE SYSTEM ====================

// ==================== Z-INDEX MANAGEMENT FOR MULTIPLE QUICK TABS ====================
/**
 * Bring a Quick Tab to the front (highest z-index)
 * Called when user interacts with a Quick Tab (click, focus, or after drag)
 * @param {HTMLElement} container - The Quick Tab container element
 */
function bringQuickTabToFront(container) {
  if (!container) return;

  // Only update if this isn't already the topmost
  const currentZ = parseInt(container.style.zIndex) || 0;
  if (currentZ < quickTabZIndex - 1) {
    container.style.zIndex = quickTabZIndex++;
    debug(`Brought Quick Tab to front with z-index ${container.style.zIndex}`);
  }
}
// ==================== END Z-INDEX MANAGEMENT ====================

// ==================== SLOT NUMBER TRACKING FOR DEBUG MODE ====================
// Track Quick Tab slot numbers for debug mode display
let quickTabSlots = new Map(); // Maps quickTabId → slot number
let availableSlots = []; // Stack of freed slot numbers
let nextSlotNumber = 1;

function assignQuickTabSlot(quickTabId) {
  let slotNumber;

  if (availableSlots.length > 0) {
    // Reuse lowest available slot number
    availableSlots.sort((a, b) => a - b);
    slotNumber = availableSlots.shift();
  } else {
    // Assign new slot
    slotNumber = nextSlotNumber++;
  }

  quickTabSlots.set(quickTabId, slotNumber);
  return slotNumber;
}

function releaseQuickTabSlot(quickTabId) {
  const slotNumber = quickTabSlots.get(quickTabId);
  if (slotNumber !== undefined) {
    availableSlots.push(slotNumber);
    quickTabSlots.delete(quickTabId);
  }
}

function resetQuickTabSlots() {
  // Reset all slot tracking when all Quick Tabs are closed
  quickTabSlots.clear();
  availableSlots = [];
  nextSlotNumber = 1;
  if (CONFIG.debugMode) {
    debug('[SLOTS] Reset slot numbering - next Quick Tab will be Slot 1');
  }
}

// ==================== BROADCAST CHANNEL SETUP ====================
// Create a BroadcastChannel for real-time cross-tab Quick Tab sync
let quickTabChannel = null;

// Generate unique tab instance ID to prevent self-reception of broadcasts
const tabInstanceId = `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// ==================== FIREFOX CONTAINER SUPPORT (v1.5.7+) ====================
// Cache the current tab's cookieStoreId for container isolation
let currentCookieStoreId = null;

/**
 * Get the current tab's cookieStoreId for Firefox Container support
 * @returns {Promise<string>} The cookieStoreId (e.g., "firefox-container-1" or "firefox-default")
 */
async function getCurrentCookieStoreId() {
  // Return cached value if available
  if (currentCookieStoreId) {
    return currentCookieStoreId;
  }

  try {
    // Query for the current tab
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true
    });

    if (tabs && tabs.length > 0) {
      currentCookieStoreId = tabs[0].cookieStoreId || 'firefox-default';
      debug(`Detected container: ${currentCookieStoreId}`);
      return currentCookieStoreId;
    }

    // Fallback to default container
    currentCookieStoreId = 'firefox-default';
    return currentCookieStoreId;
  } catch (err) {
    console.error('[QuickTabs] Error getting cookieStoreId:', err);
    currentCookieStoreId = 'firefox-default';
    return currentCookieStoreId;
  }
}

// Initialize cookieStoreId detection immediately
getCurrentCookieStoreId();

/**
 * Wrapper for browser.runtime.sendMessage that automatically includes cookieStoreId
 * @param {Object} message - The message to send
 * @returns {Promise} - Promise resolving to the response
 */
async function sendRuntimeMessage(message) {
  const cookieStoreId = await getCurrentCookieStoreId();
  return browser.runtime.sendMessage({
    ...message,
    cookieStoreId: cookieStoreId
  });
}
// ==================== END FIREFOX CONTAINER SUPPORT ====================

function initializeBroadcastChannel() {
  if (quickTabChannel) return; // Already initialized

  try {
    quickTabChannel = new BroadcastChannel('quick-tabs-sync');
    debug(`BroadcastChannel initialized for Quick Tab sync (Instance ID: ${tabInstanceId})`);

    // Listen for Quick Tab creation messages from other tabs
    quickTabChannel.onmessage = handleBroadcastMessage;
  } catch (err) {
    console.error('Failed to create BroadcastChannel:', err);
    debug('BroadcastChannel not available - using localStorage fallback only');
  }
}

// Normalize URL for comparison (removes hash and query parameters)
// Used for pin URL comparisons to avoid URL fragment/query differences
function normalizeUrl(url) {
  try {
    const urlObj = new URL(url);
    // Remove hash and query parameters for pin comparison
    return `${urlObj.origin}${urlObj.pathname}`;
  } catch (e) {
    // If URL parsing fails, return original URL
    return url;
  }
}

async function handleBroadcastMessage(event) {
  const message = event.data;

  // Ignore broadcasts from ourselves to prevent self-reception bugs
  if (message.senderId === tabInstanceId) {
    debug(`Ignoring broadcast from self (Instance ID: ${tabInstanceId})`);
    return;
  }

  // FIREFOX CONTAINER FILTERING: Ignore messages from different containers
  const currentCookieStore = await getCurrentCookieStoreId();
  if (message.cookieStoreId && message.cookieStoreId !== currentCookieStore) {
    debug(
      `Ignoring broadcast from different container (${message.cookieStoreId} != ${currentCookieStore})`
    );
    return;
  }

  if (message.action === 'createQuickTab') {
    debug(`Received Quick Tab broadcast from another tab: ${message.url} (ID: ${message.id})`);

    // Check if we already have a Quick Tab with this ID (prevents duplicates from self-messaging)
    // Use ID for identification instead of URL to support multiple Quick Tabs with same URL
    const existingContainer = quickTabWindows.find(win => {
      return win.dataset.quickTabId === message.id;
    });

    if (existingContainer) {
      debug(`Skipping duplicate Quick Tab from broadcast: ${message.url} (ID: ${message.id})`);
      return;
    }

    // Filter based on pin status - only show unpinned Quick Tabs via broadcast
    // Pinned Quick Tabs are handled by storage restore based on current page URL
    if (message.pinnedToUrl) {
      const currentPageUrl = window.location.href;
      if (message.pinnedToUrl !== currentPageUrl) {
        debug(
          `Skipping pinned Quick Tab broadcast (pinned to ${message.pinnedToUrl}, current: ${currentPageUrl})`
        );
        return;
      }
    }

    // Create the Quick Tab window with the same properties
    // Pass true for fromBroadcast to prevent re-broadcasting
    createQuickTabWindow(
      message.url,
      message.width,
      message.height,
      message.left,
      message.top,
      true, // fromBroadcast = true
      message.pinnedToUrl,
      message.id // Pass the ID to maintain consistency across tabs
    );
  } else if (message.action === 'closeQuickTab') {
    debug(`Received close Quick Tab broadcast for URL: ${message.url} (ID: ${message.id})`);

    // Find and close the Quick Tab with matching ID (not URL, to avoid closing wrong duplicate)
    const container = quickTabWindows.find(win => {
      return win.dataset.quickTabId === message.id;
    });

    if (container) {
      closeQuickTabWindow(container, false); // false = don't broadcast again
    }
  } else if (message.action === 'closeAllQuickTabs') {
    debug('Received close all Quick Tabs broadcast');
    closeAllQuickTabWindows(false); // false = don't broadcast again
  } else if (message.action === 'moveQuickTab') {
    debug(`Received move Quick Tab broadcast for URL: ${message.url} (ID: ${message.id})`);

    // Find and move the Quick Tab with matching ID (not URL, to avoid moving wrong duplicate)
    const container = quickTabWindows.find(win => {
      return win.dataset.quickTabId === message.id;
    });

    if (container) {
      container.style.left = message.left + 'px';
      container.style.top = message.top + 'px';
      // Note: Don't save to storage here - the initiating tab already saved
      // This prevents race conditions and redundant saves
      if (CONFIG.debugMode) {
        debug(`[SYNC] Updated Quick Tab position via broadcast: (${message.left}, ${message.top})`);
      }
    }
  } else if (message.action === 'resizeQuickTab') {
    debug(`Received resize Quick Tab broadcast for URL: ${message.url} (ID: ${message.id})`);

    // Find and resize the Quick Tab with matching ID (not URL, to avoid resizing wrong duplicate)
    const container = quickTabWindows.find(win => {
      return win.dataset.quickTabId === message.id;
    });

    if (container) {
      container.style.width = message.width + 'px';
      container.style.height = message.height + 'px';
      // Note: Don't save to storage here - the initiating tab already saved
      // This prevents race conditions and redundant saves
      if (CONFIG.debugMode) {
        debug(`[SYNC] Updated Quick Tab size via broadcast: ${message.width}x${message.height}`);
      }
    }
  } else if (message.action === 'pinQuickTab') {
    debug(`Received pin Quick Tab broadcast for URL: ${message.url} (ID: ${message.id})`);

    // When a Quick Tab is pinned in another tab, close it in this tab
    // (unless this tab is the one it's pinned to, but that's handled by the pinning tab itself)
    const currentPageUrl = normalizeUrl(window.location.href);
    const pinnedPageUrl = normalizeUrl(message.pinnedToUrl);

    // If this tab is NOT the page where the Quick Tab is pinned, close it
    if (currentPageUrl !== pinnedPageUrl) {
      const container = quickTabWindows.find(win => {
        return win.dataset.quickTabId === message.id;
      });

      if (container) {
        debug(
          `Closing Quick Tab ${message.url} (ID: ${message.id}) because it was pinned to ${message.pinnedToUrl}`
        );
        closeQuickTabWindow(container, false); // false = don't broadcast again
      }
    }
  } else if (message.action === 'unpinQuickTab') {
    debug(`Received unpin Quick Tab broadcast for URL: ${message.url} (ID: ${message.id})`);

    // When a Quick Tab is unpinned in another tab, create it here if we don't have it
    const existingContainer = quickTabWindows.find(win => {
      return win.dataset.quickTabId === message.id;
    });

    // Only create if we don't already have this Quick Tab
    if (!existingContainer && quickTabWindows.length < CONFIG.quickTabMaxWindows) {
      createQuickTabWindow(
        message.url,
        message.width,
        message.height,
        message.left,
        message.top,
        true, // fromBroadcast = true
        null, // pinnedToUrl = null (unpinned)
        message.id // Pass the ID to maintain consistency
      );
    }
  } else if (message.action === 'clearMinimizedTabs') {
    minimizedQuickTabs = [];
    updateMinimizedTabsManager();
  }
}

async function broadcastQuickTabCreation(
  url,
  width,
  height,
  left,
  top,
  pinnedToUrl = null,
  quickTabId = null
) {
  if (!quickTabChannel || !CONFIG.quickTabPersistAcrossTabs) return;

  quickTabChannel.postMessage({
    action: 'createQuickTab',
    id: quickTabId,
    url: url,
    width: width || CONFIG.quickTabDefaultWidth,
    height: height || CONFIG.quickTabDefaultHeight,
    left: left,
    top: top,
    pinnedToUrl: pinnedToUrl,
    cookieStoreId: await getCurrentCookieStoreId(),
    senderId: tabInstanceId,
    timestamp: Date.now()
  });

  debug(`Broadcasting Quick Tab creation to other tabs: ${url} (ID: ${quickTabId})`);
}

async function broadcastQuickTabClose(quickTabId, url) {
  if (!quickTabChannel || !CONFIG.quickTabPersistAcrossTabs) return;

  quickTabChannel.postMessage({
    action: 'closeQuickTab',
    id: quickTabId,
    url: url,
    cookieStoreId: await getCurrentCookieStoreId(),
    senderId: tabInstanceId,
    timestamp: Date.now()
  });

  debug(`Broadcasting Quick Tab close to other tabs: ${url} (ID: ${quickTabId})`);
}

async function broadcastCloseAll() {
  if (!quickTabChannel || !CONFIG.quickTabPersistAcrossTabs) return;

  quickTabChannel.postMessage({
    action: 'closeAllQuickTabs',
    cookieStoreId: await getCurrentCookieStoreId(),
    senderId: tabInstanceId,
    timestamp: Date.now()
  });
}

async function broadcastQuickTabMove(quickTabId, url, left, top) {
  if (!quickTabChannel || !CONFIG.quickTabPersistAcrossTabs) return;

  quickTabChannel.postMessage({
    action: 'moveQuickTab',
    id: quickTabId,
    url: url,
    left: left,
    top: top,
    cookieStoreId: await getCurrentCookieStoreId(),
    senderId: tabInstanceId,
    timestamp: Date.now()
  });

  debug(`Broadcasting Quick Tab move to other tabs: ${url} (ID: ${quickTabId})`);
}

async function broadcastQuickTabResize(quickTabId, url, width, height) {
  if (!quickTabChannel || !CONFIG.quickTabPersistAcrossTabs) return;

  quickTabChannel.postMessage({
    action: 'resizeQuickTab',
    id: quickTabId,
    url: url,
    width: width,
    height: height,
    cookieStoreId: await getCurrentCookieStoreId(),
    senderId: tabInstanceId,
    timestamp: Date.now()
  });

  debug(`Broadcasting Quick Tab resize to other tabs: ${url} (ID: ${quickTabId})`);
}

async function broadcastQuickTabPin(quickTabId, url, pinnedToUrl) {
  if (!quickTabChannel || !CONFIG.quickTabPersistAcrossTabs) return;

  quickTabChannel.postMessage({
    action: 'pinQuickTab',
    id: quickTabId,
    url: url,
    pinnedToUrl: pinnedToUrl,
    cookieStoreId: await getCurrentCookieStoreId(),
    senderId: tabInstanceId,
    timestamp: Date.now()
  });

  debug(
    `Broadcasting Quick Tab pin to other tabs: ${url} (ID: ${quickTabId}) pinned to ${pinnedToUrl}`
  );
}

async function broadcastQuickTabUnpin(quickTabId, url, width, height, left, top) {
  if (!quickTabChannel || !CONFIG.quickTabPersistAcrossTabs) return;

  quickTabChannel.postMessage({
    action: 'unpinQuickTab',
    id: quickTabId,
    url: url,
    width: width,
    height: height,
    left: left,
    top: top,
    cookieStoreId: await getCurrentCookieStoreId(),
    senderId: tabInstanceId,
    timestamp: Date.now()
  });

  debug(`Broadcasting Quick Tab unpin to other tabs: ${url} (ID: ${quickTabId}) is now unpinned`);
}

async function broadcastClearMinimized() {
  if (!quickTabChannel || !CONFIG.quickTabPersistAcrossTabs) return;

  quickTabChannel.postMessage({
    action: 'clearMinimizedTabs',
    cookieStoreId: await getCurrentCookieStoreId(),
    senderId: tabInstanceId,
    timestamp: Date.now()
  });
}

// ==================== END BROADCAST CHANNEL SETUP ====================

// ==================== BROWSER STORAGE PERSISTENCE ====================
// Using browser.storage.sync instead of browser.storage.local for cross-device sync
// browser.storage.sync is shared across all tabs and syncs across devices
// Also using browser.storage.session for fast ephemeral reads (Firefox 115+)

// ==================== SAVE QUICK TABS (QUEUE-BASED) ====================
/**
 * Save Quick Tab state via save queue (returns promise)
 * @param {string} operationType - 'create', 'update', 'delete', 'minimize', 'restore'
 * @param {string} quickTabId - Unique Quick Tab ID
 * @returns {Promise<void>} Resolves when background confirms save
 */
async function saveQuickTabState(operationType, quickTabId, additionalData = {}) {
  if (!CONFIG.quickTabPersistAcrossTabs) {
    return Promise.resolve();
  }

  // Build current state for this Quick Tab
  let quickTabData = null;

  if (operationType === 'delete') {
    // For delete, only need ID
    quickTabData = { id: quickTabId };
  } else {
    // Get active browser tab ID
    let activeTabId = null;
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs.length > 0) {
        activeTabId = tabs[0].id;
      }
    } catch (err) {
      debug('Error getting active tab ID:', err);
    }

    // Find Quick Tab container
    const container = quickTabWindows.find(w => w.dataset.quickTabId === quickTabId);
    if (!container && operationType !== 'minimize') {
      debug(`[SAVE] Quick Tab ${quickTabId} not found, skipping save`);
      return Promise.resolve();
    }

    if (operationType === 'minimize') {
      // For minimize, get data from minimizedQuickTabs array or additionalData
      const minTab = minimizedQuickTabs.find(t => t.id === quickTabId);
      if (minTab) {
        quickTabData = { ...minTab, activeTabId: activeTabId };
      } else if (additionalData) {
        quickTabData = { ...additionalData, activeTabId: activeTabId };
      }
    } else {
      // Build state from container
      const iframe = container.querySelector('iframe');
      const titleText = container.querySelector('.copy-url-quicktab-titlebar span');
      const rect = container.getBoundingClientRect();
      const url = iframe?.src || iframe?.getAttribute('data-deferred-src') || '';

      quickTabData = {
        id: quickTabId,
        url: url,
        title: titleText?.textContent || 'Quick Tab',
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        pinnedToUrl: container._pinnedToUrl || null,
        slotNumber: CONFIG.debugMode ? quickTabSlots.get(quickTabId) || null : null,
        minimized: false,
        activeTabId: activeTabId,
        ...additionalData
      };
    }
  }

  // Enqueue save operation
  return saveQueue.enqueue({
    type: operationType,
    quickTabId: quickTabId,
    data: quickTabData,
    priority: operationType === 'create' ? 2 : 1 // High priority for creates
  });
}

/**
 * Legacy function - now delegates to queue-based system
 * Kept for backward compatibility with existing code
 */
async function saveQuickTabsToStorage() {
  if (!CONFIG.quickTabPersistAcrossTabs) return;

  // Save all Quick Tabs via queue
  const promises = [];

  quickTabWindows.forEach(container => {
    const quickTabId = container.dataset.quickTabId;
    if (quickTabId) {
      promises.push(saveQuickTabState('update', quickTabId));
    }
  });

  minimizedQuickTabs.forEach(tab => {
    if (tab.id) {
      promises.push(saveQuickTabState('minimize', tab.id));
    }
  });

  return Promise.all(promises);
}
// ==================== END SAVE QUICK TABS ====================

async function restoreQuickTabsFromStorage() {
  if (!CONFIG.quickTabPersistAcrossTabs) return;

  // Get current container ID
  const cookieStoreId = await getCurrentCookieStoreId();

  // Try session storage first (faster), fall back to sync storage
  const loadState = async () => {
    try {
      // Try session storage first if available
      if (typeof browser.storage.session !== 'undefined') {
        const sessionResult = await browser.storage.session.get('quick_tabs_session');
        if (sessionResult && sessionResult.quick_tabs_session) {
          const containerStates = sessionResult.quick_tabs_session;
          // Check if container-aware format
          if (containerStates[cookieStoreId] && containerStates[cookieStoreId].tabs) {
            return containerStates[cookieStoreId].tabs;
          }
        }
      }

      // Fall back to sync storage
      const syncResult = await browser.storage.sync.get('quick_tabs_state_v2');
      if (syncResult && syncResult.quick_tabs_state_v2) {
        const containerStates = syncResult.quick_tabs_state_v2;
        // Check if container-aware format
        if (containerStates[cookieStoreId] && containerStates[cookieStoreId].tabs) {
          return containerStates[cookieStoreId].tabs;
        }
      }

      return null;
    } catch (err) {
      console.error('Error loading Quick Tab state:', err);
      return null;
    }
  };

  loadState()
    .then(tabs => {
      if (!tabs || !Array.isArray(tabs) || tabs.length === 0) return;

      debug(
        `Restoring ${tabs.length} Quick Tabs from browser.storage for container ${cookieStoreId}`
      );

      // Get current page URL for pin filtering
      const currentPageUrl = window.location.href;

      // NEW: Build a map of existing Quick Tabs by ID (not URL)
      const existingQuickTabsById = new Map();
      quickTabWindows.forEach(container => {
        const id = container.dataset.quickTabId;
        if (id) {
          existingQuickTabsById.set(id, container);
        }
      });

      // Process all tabs from storage
      const normalTabs = tabs.filter(t => !t.minimized && t.url && t.url.trim() !== '');
      normalTabs.forEach(tab => {
        // Filter based on pin status
        if (tab.pinnedToUrl) {
          // Only restore pinned Quick Tabs on the page they're pinned to
          if (tab.pinnedToUrl !== currentPageUrl) {
            debug(
              `Skipping pinned Quick Tab (pinned to ${tab.pinnedToUrl}, current: ${currentPageUrl})`
            );
            return;
          }
        }

        // NEW: Check if this Quick Tab already exists by ID (not URL)
        // This allows multiple Quick Tabs with the same URL
        if (tab.id && existingQuickTabsById.has(tab.id)) {
          // UPDATE the existing Quick Tab instead of skipping it
          const container = existingQuickTabsById.get(tab.id);

          // Update position
          const currentLeft = parseFloat(container.style.left) || 0;
          const currentTop = parseFloat(container.style.top) || 0;
          if (tab.left !== undefined && tab.top !== undefined) {
            if (Math.abs(currentLeft - tab.left) > 1 || Math.abs(currentTop - tab.top) > 1) {
              container.style.left = tab.left + 'px';
              container.style.top = tab.top + 'px';
              debug(
                `Updated existing Quick Tab ${tab.url} (ID: ${tab.id}) position to (${tab.left}, ${tab.top})`
              );
            }
          }

          // Update size
          const currentWidth = parseFloat(container.style.width) || 0;
          const currentHeight = parseFloat(container.style.height) || 0;
          if (tab.width !== undefined && tab.height !== undefined) {
            if (
              Math.abs(currentWidth - tab.width) > 1 ||
              Math.abs(currentHeight - tab.height) > 1
            ) {
              container.style.width = tab.width + 'px';
              container.style.height = tab.height + 'px';
              debug(
                `Updated existing Quick Tab ${tab.url} (ID: ${tab.id}) size to ${tab.width}x${tab.height}`
              );
            }
          }

          return; // Don't create a new one
        }

        // Create new Quick Tab if it doesn't exist and we haven't hit the limit
        if (quickTabWindows.length >= CONFIG.quickTabMaxWindows) return;

        // Pass true for fromBroadcast to prevent re-broadcasting when restoring from storage
        // This fixes the duplication bug where restored tabs would broadcast and create duplicates
        // Also pass the ID to maintain consistency
        createQuickTabWindow(
          tab.url,
          tab.width,
          tab.height,
          tab.left,
          tab.top,
          true,
          tab.pinnedToUrl,
          tab.id
        );
      });

      // Restore minimized tabs (also check for duplicates by ID and pin status)
      const existingMinimizedIds = new Set(minimizedQuickTabs.map(t => t.id).filter(id => id));
      const minimized = tabs.filter(t => {
        if (!t.minimized) return false;
        if (!t.url || t.url.trim() === '') return false; // Skip empty URLs
        if (t.id && existingMinimizedIds.has(t.id)) return false;

        // Filter based on pin status
        if (t.pinnedToUrl && t.pinnedToUrl !== currentPageUrl) {
          debug(
            `Skipping minimized pinned Quick Tab (pinned to ${t.pinnedToUrl}, current: ${currentPageUrl})`
          );
          return false;
        }

        return true;
      });

      if (minimized.length > 0) {
        minimizedQuickTabs.push(...minimized);
        updateMinimizedTabsManager();
      }
    })
    .catch(err => {
      console.error('Error restoring Quick Tabs from browser.storage:', err);
    });
}

function clearQuickTabsFromStorage() {
  browser.storage.sync
    .remove('quick_tabs_state_v2')
    .then(() => {
      debug('Cleared Quick Tabs from browser.storage.sync');

      // Reset slot numbering when storage is cleared
      if (CONFIG.debugMode) {
        resetQuickTabSlots();
      }

      // Also clear session storage if available
      if (typeof browser.storage.session !== 'undefined') {
        browser.storage.session.remove('quick_tabs_session').catch(() => {
          // Session storage not available, that's OK
        });
      }
    })
    .catch(err => {
      console.error('Error clearing browser.storage.sync:', err);
    });
}

// Listen for storage changes from other tabs/windows
// browser.storage.onChanged works across all origins
// ==================== STATE SYNC FROM COORDINATOR ====================
// Receive canonical state from background and update local Quick Tabs

browser.runtime.onMessage.addListener((message, sender) => {
  if (message.action === 'SYNC_STATE_FROM_COORDINATOR') {
    const canonicalState = message.state;

    debug(`[SYNC] Received canonical state from coordinator: ${canonicalState.tabs.length} tabs`);

    syncLocalStateWithCanonical(canonicalState);
  }
});

function syncLocalStateWithCanonical(canonicalState) {
  if (!canonicalState || !canonicalState.tabs) return;

  const currentPageUrl = window.location.href;

  // Build map of canonical tabs by ID
  const canonicalById = new Map();
  canonicalState.tabs.forEach(tab => {
    if (tab.id) {
      canonicalById.set(tab.id, tab);
    }
  });

  // Update or remove local Quick Tabs based on canonical state
  quickTabWindows.forEach((container, index) => {
    const quickTabId = container.dataset.quickTabId;
    const canonical = canonicalById.get(quickTabId);

    if (!canonical) {
      // Tab doesn't exist in canonical state - close it
      debug(`[SYNC] Closing Quick Tab ${quickTabId} (not in canonical state)`);
      closeQuickTabWindow(container, false);
    } else if (canonical.minimized) {
      // Tab should be minimized
      const iframe = container.querySelector('iframe');
      const url = iframe?.src || iframe?.getAttribute('data-deferred-src');
      debug(`[SYNC] Minimizing Quick Tab ${quickTabId} per canonical state`);
      minimizeQuickTab(container, url, canonical.title);
    } else {
      // Update position/size from canonical state
      if (canonical.left !== undefined && canonical.top !== undefined) {
        const currentLeft = parseFloat(container.style.left);
        const currentTop = parseFloat(container.style.top);

        if (
          Math.abs(currentLeft - canonical.left) > 5 ||
          Math.abs(currentTop - canonical.top) > 5
        ) {
          container.style.left = canonical.left + 'px';
          container.style.top = canonical.top + 'px';
          debug(
            `[SYNC] Updated Quick Tab ${quickTabId} position from canonical: (${canonical.left}, ${canonical.top})`
          );
        }
      }

      if (canonical.width !== undefined && canonical.height !== undefined) {
        const currentWidth = parseFloat(container.style.width);
        const currentHeight = parseFloat(container.style.height);

        if (
          Math.abs(currentWidth - canonical.width) > 5 ||
          Math.abs(currentHeight - canonical.height) > 5
        ) {
          container.style.width = canonical.width + 'px';
          container.style.height = canonical.height + 'px';
          debug(
            `[SYNC] Updated Quick Tab ${quickTabId} size from canonical: ${canonical.width}x${canonical.height}`
          );
        }
      }
    }
  });

  // Create Quick Tabs that exist in canonical but not locally
  canonicalState.tabs.forEach(canonicalTab => {
    if (canonicalTab.minimized) return; // Handle minimized separately

    // Check if tab should be visible on this page (pin filtering)
    if (canonicalTab.pinnedToUrl && canonicalTab.pinnedToUrl !== currentPageUrl) {
      return;
    }

    // Check if we already have this Quick Tab
    const exists = quickTabWindows.some(w => w.dataset.quickTabId === canonicalTab.id);

    if (!exists && quickTabWindows.length < CONFIG.quickTabMaxWindows) {
      debug(`[SYNC] Creating Quick Tab ${canonicalTab.id} from canonical state`);
      createQuickTabWindow(
        canonicalTab.url,
        canonicalTab.width,
        canonicalTab.height,
        canonicalTab.left,
        canonicalTab.top,
        true, // fromBroadcast = true (don't save again)
        canonicalTab.pinnedToUrl,
        canonicalTab.id
      );
    }
  });

  // Sync minimized tabs
  const canonicalMinimized = canonicalState.tabs.filter(t => t.minimized);
  minimizedQuickTabs = canonicalMinimized;
  updateMinimizedTabsManager(true); // true = fromSync

  debug(`[SYNC] Local state synchronized with canonical state`);
}
// ==================== END STATE SYNC ====================

// ==================== END BROWSER STORAGE PERSISTENCE ====================

// Initialize tooltip animation keyframes once
function initTooltipAnimation() {
  if (document.querySelector('style[data-copy-url-tooltip]')) return;

  const style = document.createElement('style');
  style.setAttribute('data-copy-url-tooltip', 'true');
  style.textContent = `
    @keyframes tooltipFadeIn {
      from { opacity: 0; transform: translateY(-5px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
}

// Load settings from storage
function loadSettings() {
  browser.storage.local.get(DEFAULT_CONFIG, function (items) {
    CONFIG = items;
    debug('Settings loaded from storage');
  });
}

// Log helper for debugging
function debug(msg) {
  if (CONFIG.debugMode) {
    console.log('[CopyURLHover]', msg);
  }
}

// Determine the domain type
function getDomainType() {
  const hostname = window.location.hostname;
  // Social Media
  if (hostname.includes('twitter.com') || hostname.includes('x.com')) return 'twitter';
  if (hostname.includes('reddit.com')) return 'reddit';
  if (hostname.includes('linkedin.com')) return 'linkedin';
  if (hostname.includes('instagram.com')) return 'instagram';
  if (hostname.includes('facebook.com')) return 'facebook';
  if (hostname.includes('tiktok.com')) return 'tiktok';
  if (hostname.includes('threads.net')) return 'threads';
  if (hostname.includes('bluesky.social')) return 'bluesky';
  if (hostname.includes('mastodon')) return 'mastodon';
  if (hostname.includes('snapchat.com')) return 'snapchat';
  if (hostname.includes('whatsapp.com')) return 'whatsapp';
  if (hostname.includes('telegram.org')) return 'telegram';

  // Video Platforms
  if (hostname.includes('youtube.com')) return 'youtube';
  if (hostname.includes('vimeo.com')) return 'vimeo';
  if (hostname.includes('dailymotion.com')) return 'dailymotion';
  if (hostname.includes('twitch.tv')) return 'twitch';
  if (hostname.includes('rumble.com')) return 'rumble';
  if (hostname.includes('odysee.com')) return 'odysee';
  if (hostname.includes('bitchute.com')) return 'bitchute';

  // Developer Platforms
  if (hostname.includes('github.com') || hostname.includes('ghe.')) return 'github';
  if (hostname.includes('gitlab.com')) return 'gitlab';
  if (hostname.includes('bitbucket.org')) return 'bitbucket';
  if (hostname.includes('stackoverflow.com')) return 'stackoverflow';
  if (hostname.includes('stackexchange.com')) return 'stackexchange';
  if (hostname.includes('serverfault.com')) return 'serverfault';
  if (hostname.includes('superuser.com')) return 'superuser';
  if (hostname.includes('codepen.io')) return 'codepen';
  if (hostname.includes('jsfiddle.net')) return 'jsfiddle';
  if (hostname.includes('replit.com')) return 'replit';
  if (hostname.includes('glitch.com')) return 'glitch';
  if (hostname.includes('codesandbox.io')) return 'codesandbox';

  // Blogging Platforms
  if (hostname.includes('medium.com')) return 'medium';
  if (hostname.includes('devto') || hostname.includes('dev.to')) return 'devto';
  if (hostname.includes('hashnode.com')) return 'hashnode';
  if (hostname.includes('substack.com')) return 'substack';
  if (hostname.includes('wordpress.com')) return 'wordpress';
  if (hostname.includes('blogger.com') || hostname.includes('blogspot.com')) return 'blogger';
  if (hostname.includes('ghost.io') || hostname.includes('ghost.org')) return 'ghost';
  if (hostname.includes('notion.site') || hostname.includes('notion.so')) return 'notion';

  // E-commerce
  if (hostname.includes('amazon.') || hostname.includes('smile.amazon')) return 'amazon';
  if (hostname.includes('ebay.')) return 'ebay';
  if (hostname.includes('etsy.com')) return 'etsy';
  if (hostname.includes('walmart.com')) return 'walmart';
  if (hostname.includes('flipkart.com')) return 'flipkart';
  if (hostname.includes('aliexpress.com')) return 'aliexpress';
  if (hostname.includes('alibaba.com')) return 'alibaba';
  if (hostname.includes('shopify.')) return 'shopify';
  if (hostname.includes('target.com')) return 'target';
  if (hostname.includes('bestbuy.com')) return 'bestbuy';
  if (hostname.includes('newegg.com')) return 'newegg';
  if (hostname.includes('wish.com')) return 'wish';

  // Image & Design Platforms
  if (hostname.includes('pinterest.com')) return 'pinterest';
  if (hostname.includes('tumblr.com')) return 'tumblr';
  if (hostname.includes('dribbble.com')) return 'dribbble';
  if (hostname.includes('behance.net')) return 'behance';
  if (hostname.includes('deviantart.com')) return 'deviantart';
  if (hostname.includes('flickr.com')) return 'flickr';
  if (hostname.includes('500px.com')) return '500px';
  if (hostname.includes('unsplash.com')) return 'unsplash';
  if (hostname.includes('pexels.com')) return 'pexels';
  if (hostname.includes('pixabay.com')) return 'pixabay';
  if (hostname.includes('artstation.com')) return 'artstation';
  if (hostname.includes('imgur.com')) return 'imgur';
  if (hostname.includes('giphy.com')) return 'giphy';

  // News & Discussion
  if (hostname.includes('hackernews') || hostname.includes('news.ycombinator')) return 'hackernews';
  if (hostname.includes('producthunt.com')) return 'producthunt';
  if (hostname.includes('quora.com')) return 'quora';
  if (hostname.includes('discord.com') || hostname.includes('discordapp.com')) return 'discord';
  if (hostname.includes('slack.com')) return 'slack';
  if (hostname.includes('lobste.rs')) return 'lobsters';
  if (hostname.includes('news.google.com')) return 'googlenews';
  if (hostname.includes('feedly.com')) return 'feedly';

  // Entertainment & Media
  if (hostname.includes('wikipedia.org')) return 'wikipedia';
  if (hostname.includes('imdb.com')) return 'imdb';
  if (hostname.includes('rottentomatoes.com')) return 'rottentomatoes';
  if (hostname.includes('netflix.com')) return 'netflix';
  if (hostname.includes('letterboxd.com')) return 'letterboxd';
  if (hostname.includes('goodreads.com')) return 'goodreads';
  if (hostname.includes('myanimelist.net')) return 'myanimelist';
  if (hostname.includes('anilist.co')) return 'anilist';
  if (hostname.includes('kitsu.io')) return 'kitsu';
  if (hostname.includes('last.fm')) return 'lastfm';
  if (hostname.includes('spotify.com')) return 'spotify';
  if (hostname.includes('soundcloud.com')) return 'soundcloud';
  if (hostname.includes('bandcamp.com')) return 'bandcamp';

  // Gaming
  if (hostname.includes('steamcommunity.com')) return 'steam';
  if (hostname.includes('steampowered.com')) return 'steampowered';
  if (hostname.includes('epicgames.com')) return 'epicgames';
  if (hostname.includes('gog.com')) return 'gog';
  if (hostname.includes('itch.io')) return 'itchio';
  if (hostname.includes('gamejolt.com')) return 'gamejolt';

  // Professional & Learning
  if (hostname.includes('coursera.org')) return 'coursera';
  if (hostname.includes('udemy.com')) return 'udemy';
  if (hostname.includes('edx.org')) return 'edx';
  if (hostname.includes('khanacademy.org')) return 'khanacademy';
  if (hostname.includes('skillshare.com')) return 'skillshare';
  if (hostname.includes('pluralsight.com')) return 'pluralsight';
  if (hostname.includes('udacity.com')) return 'udacity';

  // Other
  if (hostname.includes('archive.org')) return 'archiveorg';
  if (hostname.includes('patreon.com')) return 'patreon';
  if (hostname.includes('ko-fi.com')) return 'kofi';
  if (hostname.includes('buymeacoffee.com')) return 'buymeacoffee';
  if (hostname.includes('gumroad.com')) return 'gumroad';

  return 'generic';
}

// Generic URL finder - most robust
function findUrl(element, domainType) {
  // Try direct link first
  if (element.tagName === 'A' && element.href) {
    return element.href;
  }

  // Check parents for href (up to 20 levels)
  let parent = element.parentElement;
  for (let i = 0; i < 20; i++) {
    if (!parent) break;
    if (parent.href) return parent.href;
    parent = parent.parentElement;
  }

  // Site-specific handlers
  const handlers = {
    // Social Media
    twitter: findTwitterUrl,
    reddit: findRedditUrl,
    linkedin: findLinkedInUrl,
    instagram: findInstagramUrl,
    facebook: findFacebookUrl,
    tiktok: findTikTokUrl,
    threads: findThreadsUrl,
    bluesky: findBlueskyUrl,
    mastodon: findMastodonUrl,
    snapchat: findSnapchatUrl,
    whatsapp: findWhatsappUrl,
    telegram: findTelegramUrl,

    // Video Platforms
    youtube: findYouTubeUrl,
    vimeo: findVimeoUrl,
    dailymotion: findDailyMotionUrl,
    twitch: findTwitchUrl,
    rumble: findRumbleUrl,
    odysee: findOdyseeUrl,
    bitchute: findBitchuteUrl,

    // Developer Platforms
    github: findGitHubUrl,
    gitlab: findGitLabUrl,
    bitbucket: findBitbucketUrl,
    stackoverflow: findStackOverflowUrl,
    stackexchange: findStackExchangeUrl,
    serverfault: findServerFaultUrl,
    superuser: findSuperUserUrl,
    codepen: findCodepenUrl,
    jsfiddle: findJSFiddleUrl,
    replit: findReplitUrl,
    glitch: findGlitchUrl,
    codesandbox: findCodesandboxUrl,

    // Blogging Platforms
    medium: findMediumUrl,
    devto: findDevToUrl,
    hashnode: findHashnodeUrl,
    substack: findSubstackUrl,
    wordpress: findWordpressUrl,
    blogger: findBloggerUrl,
    ghost: findGhostUrl,
    notion: findNotionUrl,

    // E-commerce
    amazon: findAmazonUrl,
    ebay: findEbayUrl,
    etsy: findEtsyUrl,
    walmart: findWalmartUrl,
    flipkart: findFlipkartUrl,
    aliexpress: findAliexpressUrl,
    alibaba: findAlibabaUrl,
    shopify: findShopifyUrl,
    target: findTargetUrl,
    bestbuy: findBestBuyUrl,
    newegg: findNeweggUrl,
    wish: findWishUrl,

    // Image & Design Platforms
    pinterest: findPinterestUrl,
    tumblr: findTumblrUrl,
    dribbble: findDribbbleUrl,
    behance: findBehanceUrl,
    deviantart: findDeviantartUrl,
    flickr: findFlickrUrl,
    '500px': find500pxUrl,
    unsplash: findUnsplashUrl,
    pexels: findPexelsUrl,
    pixabay: findPixabayUrl,
    artstation: findArtstationUrl,
    imgur: findImgurUrl,
    giphy: findGiphyUrl,

    // News & Discussion
    hackernews: findHackerNewsUrl,
    producthunt: findProductHuntUrl,
    quora: findQuoraUrl,
    discord: findDiscordUrl,
    slack: findSlackUrl,
    lobsters: findLobstersUrl,
    googlenews: findGoogleNewsUrl,
    feedly: findFeedlyUrl,

    // Entertainment & Media
    wikipedia: findWikipediaUrl,
    imdb: findImdbUrl,
    rottentomatoes: findRottenTomatoesUrl,
    netflix: findNetflixUrl,
    letterboxd: findLetterboxdUrl,
    goodreads: findGoodreadsUrl,
    myanimelist: findMyAnimeListUrl,
    anilist: findAniListUrl,
    kitsu: findKitsuUrl,
    lastfm: findLastFmUrl,
    spotify: findSpotifyUrl,
    soundcloud: findSoundcloudUrl,
    bandcamp: findBandcampUrl,

    // Gaming
    steam: findSteamUrl,
    steampowered: findSteamPoweredUrl,
    epicgames: findEpicGamesUrl,
    gog: findGOGUrl,
    itchio: findItchIoUrl,
    gamejolt: findGameJoltUrl,

    // Professional & Learning
    coursera: findCourseraUrl,
    udemy: findUdemyUrl,
    edx: findEdXUrl,
    khanacademy: findKhanAcademyUrl,
    skillshare: findSkillshareUrl,
    pluralsight: findPluralsightUrl,
    udacity: findUdacityUrl,

    // Other
    archiveorg: findArchiveOrgUrl,
    patreon: findPatreonUrl,
    kofi: findKoFiUrl,
    buymeacoffee: findBuyMeACoffeeUrl,
    gumroad: findGumroadUrl
  };

  if (handlers[domainType]) {
    const url = handlers[domainType](element);
    if (url) return url;
  }

  // Final fallback - find ANY link
  return findGenericUrl(element);
}

// ===== SOCIAL MEDIA HANDLERS =====

function findTwitterUrl(element) {
  debug('=== TWITTER URL FINDER ===');
  debug('Hovered element: ' + element.tagName + ' - ' + element.className);

  if (element && element.href) {
    debug(`URL found directly from hovered element: ${element.href}`);
    return element.href;
  }

  debug('No Twitter URL found on the provided element.');
  return null;
}

function findRedditUrl(element) {
  const post = element.closest(
    '[data-testid="post-container"], .Post, .post-container, [role="article"]'
  );
  if (!post) return findGenericUrl(element);

  const titleLink = post.querySelector(
    'a[data-testid="post-title"], h3 a, .PostTitle a, [data-click-id="body"] a'
  );
  if (titleLink?.href) return titleLink.href;

  return null;
}

function findLinkedInUrl(element) {
  const post = element.closest('[data-id], .feed-shared-update-v2, [data-test="activity-item"]');
  if (!post) return findGenericUrl(element);

  const links = post.querySelectorAll('a[href]');
  for (let link of links) {
    const url = link.href;
    if (url.includes('/feed/') || url.includes('/posts/')) return url;
  }

  return null;
}

function findInstagramUrl(element) {
  const post = element.closest('[role="article"], article');
  if (!post) return findGenericUrl(element);

  const link = post.querySelector('a[href*="/p/"], a[href*="/reel/"], time a');
  if (link?.href) return link.href;

  return null;
}

function findFacebookUrl(element) {
  const post = element.closest('[role="article"], [data-testid="post"]');
  if (!post) return findGenericUrl(element);

  const links = post.querySelectorAll(
    'a[href*="/posts/"], a[href*="/photos/"], a[href*="/videos/"]'
  );
  if (links.length > 0) return links[0].href;

  return null;
}

function findTikTokUrl(element) {
  const video = element.closest('[data-e2e="user-post-item"], .video-feed-item');
  if (!video) return findGenericUrl(element);

  const link = video.querySelector('a[href*="/@"]');
  if (link?.href) return link.href;

  return null;
}

function findThreadsUrl(element) {
  const post = element.closest('[role="article"]');
  if (!post) return findGenericUrl(element);

  const link = post.querySelector('a[href*="/t/"], time a');
  if (link?.href) return link.href;

  return null;
}

function findBlueskyUrl(element) {
  const post = element.closest('[data-testid="postThreadItem"], [role="article"]');
  if (!post) return findGenericUrl(element);

  const link = post.querySelector('a[href*="/post/"]');
  if (link?.href) return link.href;

  return null;
}

function findMastodonUrl(element) {
  const post = element.closest('.status, [data-id]');
  if (!post) return findGenericUrl(element);

  const link = post.querySelector('a.status__relative-time, a.detailed-status__datetime');
  if (link?.href) return link.href;

  return null;
}

function findSnapchatUrl(element) {
  const story = element.closest('[role="article"], .Story');
  if (!story) return findGenericUrl(element);

  const link = story.querySelector('a[href*="/add/"], a[href*="/spotlight/"]');
  if (link?.href) return link.href;

  return null;
}

function findWhatsappUrl(element) {
  // WhatsApp Web doesn't use traditional links - it's a single-page app
  // The current chat/conversation URL is the most relevant URL to copy
  return window.location.href;
}

function findTelegramUrl(element) {
  const message = element.closest('.message, [data-mid]');
  if (!message) return findGenericUrl(element);

  const link = message.querySelector('a[href*="t.me"]');
  if (link?.href) return link.href;

  return null;
}

// ===== VIDEO PLATFORM HANDLERS =====

function findYouTubeUrl(element) {
  const videoCard = element.closest(
    'ytd-rich-grid-media, ytd-thumbnail, ytd-video-renderer, ytd-grid-video-renderer, a[href*="/watch"]'
  );
  if (!videoCard) return findGenericUrl(element);

  const thumbnailLink = videoCard.querySelector('a#thumbnail[href*="watch?v="]');
  if (thumbnailLink?.href) return thumbnailLink.href;

  const watchLink = videoCard.querySelector('a[href*="watch?v="]');
  if (watchLink?.href) return watchLink.href;

  return null;
}

function findVimeoUrl(element) {
  const video = element.closest('[data-clip-id], .clip_grid_item');
  if (!video) return findGenericUrl(element);

  const link = video.querySelector('a[href*="/video/"], a[href*="vimeo.com/"]');
  if (link?.href) return link.href;

  return null;
}

function findDailyMotionUrl(element) {
  const video = element.closest('[data-video], .sd_video_item');
  if (!video) return findGenericUrl(element);

  const link = video.querySelector('a[href*="/video/"]');
  if (link?.href) return link.href;

  return null;
}

function findTwitchUrl(element) {
  const stream = element.closest('[data-a-target="video-card"], .video-card');
  if (!stream) return findGenericUrl(element);

  const link = stream.querySelector('a[href*="/videos/"], a[href*="/clip/"]');
  if (link?.href) return link.href;

  return null;
}

function findRumbleUrl(element) {
  const video = element.closest('.video-item, [data-video]');
  if (!video) return findGenericUrl(element);

  const link = video.querySelector('a[href*=".html"]');
  if (link?.href) return link.href;

  return null;
}

function findOdyseeUrl(element) {
  const video = element.closest('.claim-preview, [data-id]');
  if (!video) return findGenericUrl(element);

  const link = video.querySelector('a[href*="/@"]');
  if (link?.href) return link.href;

  return null;
}

function findBitchuteUrl(element) {
  const video = element.closest('.video-card, .channel-videos-container');
  if (!video) return findGenericUrl(element);

  const link = video.querySelector('a[href*="/video/"]');
  if (link?.href) return link.href;

  return null;
}

// ===== DEVELOPER PLATFORM HANDLERS =====

function findGitHubUrl(element) {
  const item = element.closest('[data-testid="issue-row"], .Box-row, .issue, [role="article"]');
  if (!item) return findGenericUrl(element);

  const link = item.querySelector(
    'a[href*="/issues/"], a[href*="/pull/"], a[href*="/discussions/"]'
  );
  if (link?.href) return link.href;

  return null;
}

function findGitLabUrl(element) {
  const item = element.closest('.issue, .merge-request, [data-qa-selector]');
  if (!item) return findGenericUrl(element);

  const link = item.querySelector('a[href*="/issues/"], a[href*="/merge_requests/"]');
  if (link?.href) return link.href;

  return null;
}

function findBitbucketUrl(element) {
  const item = element.closest('[data-testid="issue-row"], .iterable-item');
  if (!item) return findGenericUrl(element);

  const link = item.querySelector('a[href*="/issues/"], a[href*="/pull-requests/"]');
  if (link?.href) return link.href;

  return null;
}

function findStackOverflowUrl(element) {
  const question = element.closest('.s-post-summary, [data-post-id]');
  if (!question) return findGenericUrl(element);

  const link = question.querySelector('a.s-link[href*="/questions/"]');
  if (link?.href) return link.href;

  return null;
}

function findStackExchangeUrl(element) {
  const question = element.closest('.s-post-summary, .question-summary');
  if (!question) return findGenericUrl(element);

  const link = question.querySelector('a[href*="/questions/"]');
  if (link?.href) return link.href;

  return null;
}

function findServerFaultUrl(element) {
  // Server Fault uses the same Stack Exchange structure
  return findStackExchangeUrl(element);
}

function findSuperUserUrl(element) {
  // Super User uses the same Stack Exchange structure
  return findStackExchangeUrl(element);
}

function findCodepenUrl(element) {
  const pen = element.closest('[data-slug], .single-pen');
  if (!pen) return findGenericUrl(element);

  const link = pen.querySelector('a[href*="/pen/"]');
  if (link?.href) return link.href;

  return null;
}

function findJSFiddleUrl(element) {
  const fiddle = element.closest('.fiddle, [data-id]');
  if (!fiddle) return findGenericUrl(element);

  const link = fiddle.querySelector('a[href*="jsfiddle.net"]');
  if (link?.href) return link.href;

  return null;
}

function findReplitUrl(element) {
  const repl = element.closest('[data-repl-id], .repl-item');
  if (!repl) return findGenericUrl(element);

  const link = repl.querySelector('a[href*="/@"]');
  if (link?.href) return link.href;

  return null;
}

function findGlitchUrl(element) {
  const project = element.closest('.project, [data-project-id]');
  if (!project) return findGenericUrl(element);

  const link = project.querySelector('a[href*="glitch.com/~"]');
  if (link?.href) return link.href;

  return null;
}

function findCodesandboxUrl(element) {
  const sandbox = element.closest('[data-id], .sandbox-item');
  if (!sandbox) return findGenericUrl(element);

  const link = sandbox.querySelector('a[href*="/s/"]');
  if (link?.href) return link.href;

  return null;
}

// ===== BLOGGING PLATFORM HANDLERS =====

function findMediumUrl(element) {
  const article = element.closest('[data-post-id], article');
  if (!article) return findGenericUrl(element);

  const link = article.querySelector('a[data-action="open-post"], h2 a, h3 a');
  if (link?.href) return link.href;

  return null;
}

function findDevToUrl(element) {
  const article = element.closest('.crayons-story, [data-article-id]');
  if (!article) return findGenericUrl(element);

  const link = article.querySelector('a[id*="article-link"], h2 a, h3 a');
  if (link?.href) return link.href;

  return null;
}

function findHashnodeUrl(element) {
  const article = element.closest('[data-post-id], .post-card');
  if (!article) return findGenericUrl(element);

  const link = article.querySelector('a[href*="/post/"], h1 a, h2 a');
  if (link?.href) return link.href;

  return null;
}

function findSubstackUrl(element) {
  const article = element.closest('.post, [data-testid="post-preview"]');
  if (!article) return findGenericUrl(element);

  const link = article.querySelector('a[href*="/p/"], h2 a, h3 a');
  if (link?.href) return link.href;

  return null;
}

function findWordpressUrl(element) {
  const post = element.closest('.post, .hentry, article');
  if (!post) return findGenericUrl(element);

  const link = post.querySelector('a.entry-title-link, h2 a, .entry-title a');
  if (link?.href) return link.href;

  return null;
}

function findBloggerUrl(element) {
  const post = element.closest('.post, .post-outer');
  if (!post) return findGenericUrl(element);

  const link = post.querySelector('h3.post-title a, a.post-title');
  if (link?.href) return link.href;

  return null;
}

function findGhostUrl(element) {
  const article = element.closest('.post-card, article');
  if (!article) return findGenericUrl(element);

  const link = article.querySelector('.post-card-title a, h2 a');
  if (link?.href) return link.href;

  return null;
}

function findNotionUrl(element) {
  // Notion typically uses current page URL
  return window.location.href;
}

// ===== E-COMMERCE HANDLERS =====

function findAmazonUrl(element) {
  const product = element.closest(
    '[data-component-type="s-search-result"], .s-result-item, [data-asin]'
  );
  if (!product) return findGenericUrl(element);

  const link = product.querySelector('a.a-link-normal[href*="/dp/"], h2 a');
  if (link?.href) return link.href;

  return null;
}

function findEbayUrl(element) {
  const item = element.closest('.s-item, [data-view="mi"]');
  if (!item) return findGenericUrl(element);

  const link = item.querySelector('a.s-item__link, .vip a');
  if (link?.href) return link.href;

  return null;
}

function findEtsyUrl(element) {
  const listing = element.closest('[data-listing-id], .listing-link');
  if (!listing) return findGenericUrl(element);

  const link = listing.querySelector('a[href*="/listing/"]');
  if (link?.href) return link.href;

  return null;
}

function findWalmartUrl(element) {
  const product = element.closest('[data-item-id], .search-result-gridview-item');
  if (!product) return findGenericUrl(element);

  const link = product.querySelector('a[href*="/ip/"]');
  if (link?.href) return link.href;

  return null;
}

function findFlipkartUrl(element) {
  const product = element.closest('[data-id], ._2kHMtA');
  if (!product) return findGenericUrl(element);

  const link = product.querySelector('a[href*="/p/"]');
  if (link?.href) return link.href;

  return null;
}

function findAliexpressUrl(element) {
  const product = element.closest('[data-product-id], .product-item');
  if (!product) return findGenericUrl(element);

  const link = product.querySelector('a[href*="/item/"]');
  if (link?.href) return link.href;

  return null;
}

function findAlibabaUrl(element) {
  const product = element.closest('[data-content], .organic-list-offer');
  if (!product) return findGenericUrl(element);

  const link = product.querySelector('a[href*="/product-detail/"]');
  if (link?.href) return link.href;

  return null;
}

function findShopifyUrl(element) {
  const product = element.closest('.product-item, .grid-item, [data-product-id]');
  if (!product) return findGenericUrl(element);

  const link = product.querySelector('a[href*="/products/"]');
  if (link?.href) return link.href;

  return null;
}

function findTargetUrl(element) {
  const product = element.closest('[data-test="product-grid-item"]');
  if (!product) return findGenericUrl(element);

  const link = product.querySelector('a[href*="/p/"]');
  if (link?.href) return link.href;

  return null;
}

function findBestBuyUrl(element) {
  const product = element.closest('.sku-item, [data-sku-id]');
  if (!product) return findGenericUrl(element);

  const link = product.querySelector('a[href*="/site/"]');
  if (link?.href) return link.href;

  return null;
}

function findNeweggUrl(element) {
  const item = element.closest('.item-cell, [data-item]');
  if (!item) return findGenericUrl(element);

  const link = item.querySelector('a.item-title');
  if (link?.href) return link.href;

  return null;
}

function findWishUrl(element) {
  const product = element.closest('[data-productid], .ProductCard');
  if (!product) return findGenericUrl(element);

  const link = product.querySelector('a[href*="/product/"]');
  if (link?.href) return link.href;

  return null;
}

// ===== IMAGE & DESIGN PLATFORM HANDLERS =====

function findPinterestUrl(element) {
  const pin = element.closest('[data-test-id="pin"], [role="button"]');
  if (!pin) return findGenericUrl(element);

  const link = pin.querySelector('a[href*="/pin/"]');
  if (link?.href) return link.href;

  return null;
}

function findTumblrUrl(element) {
  const post = element.closest('[data-id], article');
  if (!post) return findGenericUrl(element);

  const link = post.querySelector('a[href*="/post/"]');
  if (link?.href) return link.href;

  return null;
}

function findDribbbleUrl(element) {
  const shot = element.closest('[data-thumbnail-target], .shot-thumbnail');
  if (!shot) return findGenericUrl(element);

  const link = shot.querySelector('a[href*="/shots/"]');
  if (link?.href) return link.href;

  return null;
}

function findBehanceUrl(element) {
  const project = element.closest('[data-project-id], .Project');
  if (!project) return findGenericUrl(element);

  const link = project.querySelector('a[href*="/gallery/"]');
  if (link?.href) return link.href;

  return null;
}

function findDeviantartUrl(element) {
  const deviation = element.closest('[data-deviationid], ._2vUXu');
  if (!deviation) return findGenericUrl(element);

  const link = deviation.querySelector('a[data-hook="deviation_link"]');
  if (link?.href) return link.href;

  return null;
}

function findFlickrUrl(element) {
  const photo = element.closest('.photo-list-photo-view, [data-photo-id]');
  if (!photo) return findGenericUrl(element);

  const link = photo.querySelector('a[href*="/photos/"]');
  if (link?.href) return link.href;

  return null;
}

function find500pxUrl(element) {
  const photo = element.closest('[data-test="photo-item"]');
  if (!photo) return findGenericUrl(element);

  const link = photo.querySelector('a[href*="/photo/"]');
  if (link?.href) return link.href;

  return null;
}

function findUnsplashUrl(element) {
  const photo = element.closest('figure, [data-test="photo-grid-single-column-figure"]');
  if (!photo) return findGenericUrl(element);

  const link = photo.querySelector('a[href*="/photos/"]');
  if (link?.href) return link.href;

  return null;
}

function findPexelsUrl(element) {
  const photo = element.closest('[data-photo-modal-medium], article');
  if (!photo) return findGenericUrl(element);

  const link = photo.querySelector('a[href*="/photo/"]');
  if (link?.href) return link.href;

  return null;
}

function findPixabayUrl(element) {
  const photo = element.closest('[data-id], .item');
  if (!photo) return findGenericUrl(element);

  const link = photo.querySelector('a[href*="/photos/"], a[href*="/illustrations/"]');
  if (link?.href) return link.href;

  return null;
}

function findArtstationUrl(element) {
  const project = element.closest('.project, [data-project-id]');
  if (!project) return findGenericUrl(element);

  const link = project.querySelector('a[href*="/artwork/"]');
  if (link?.href) return link.href;

  return null;
}

function findImgurUrl(element) {
  const post = element.closest('[id^="post-"], .Post');
  if (!post) return findGenericUrl(element);

  const link = post.querySelector('a[href*="/gallery/"]');
  if (link?.href) return link.href;

  return null;
}

function findGiphyUrl(element) {
  const gif = element.closest('[data-giphy-id], .gif');
  if (!gif) return findGenericUrl(element);

  const link = gif.querySelector('a[href*="/gifs/"]');
  if (link?.href) return link.href;

  return null;
}

// ===== NEWS & DISCUSSION HANDLERS =====

function findHackerNewsUrl(element) {
  const row = element.closest('.athing');
  if (!row) return findGenericUrl(element);

  const link = row.querySelector('a.titlelink, .storylink');
  if (link?.href) return link.href;

  return null;
}

function findProductHuntUrl(element) {
  const item = element.closest('[data-test="post-item"]');
  if (!item) return findGenericUrl(element);

  const link = item.querySelector('a[href*="/posts/"]');
  if (link?.href) return link.href;

  return null;
}

function findQuoraUrl(element) {
  const question = element.closest('[data-scroll-id], .q-box');
  if (!question) return findGenericUrl(element);

  const link = question.querySelector('a[href*="/q/"], a[href*="/question/"], a.question_link');
  if (link?.href) return link.href;

  return null;
}

function findDiscordUrl(element) {
  const message = element.closest('[id^="chat-messages-"], .message');
  if (!message) return findGenericUrl(element);

  const link = message.querySelector('a[href]');
  if (link?.href) return link.href;

  return null;
}

function findSlackUrl(element) {
  const message = element.closest('[data-qa="message_container"]');
  if (!message) return findGenericUrl(element);

  const link = message.querySelector('a[href*="/archives/"]');
  if (link?.href) return link.href;

  return null;
}

function findLobstersUrl(element) {
  const story = element.closest('.story');
  if (!story) return findGenericUrl(element);

  const link = story.querySelector('a.u-url');
  if (link?.href) return link.href;

  return null;
}

function findGoogleNewsUrl(element) {
  const article = element.closest('article, [data-n-tid]');
  if (!article) return findGenericUrl(element);

  const link = article.querySelector('a[href*="./articles/"], h3 a, h4 a');
  if (link?.href) return link.href;

  return null;
}

function findFeedlyUrl(element) {
  const entry = element.closest('[data-entry-id], .entry');
  if (!entry) return findGenericUrl(element);

  const link = entry.querySelector('a.entry__title');
  if (link?.href) return link.href;

  return null;
}

// ===== ENTERTAINMENT & MEDIA HANDLERS =====

function findWikipediaUrl(element) {
  // Only return URL if hovering over an actual link element
  // Don't default to current page URL
  return findGenericUrl(element);
}

function findImdbUrl(element) {
  const item = element.closest('.lister-item, [data-testid="title"]');
  if (!item) return findGenericUrl(element);

  const link = item.querySelector('a[href*="/title/"], a[href*="/name/"]');
  if (link?.href) return link.href;

  return null;
}

function findRottenTomatoesUrl(element) {
  const item = element.closest('[data-qa="discovery-media-list-item"]');
  if (!item) return findGenericUrl(element);

  const link = item.querySelector('a[href*="/m/"], a[href*="/tv/"]');
  if (link?.href) return link.href;

  return null;
}

function findNetflixUrl(element) {
  // Netflix uses current page URL
  return window.location.href;
}

function findLetterboxdUrl(element) {
  const film = element.closest('.film-poster, [data-film-id]');
  if (!film) return findGenericUrl(element);

  const link = film.querySelector('a[href*="/film/"]');
  if (link?.href) return link.href;

  return null;
}

function findGoodreadsUrl(element) {
  const book = element.closest('.bookBox, [data-book-id]');
  if (!book) return findGenericUrl(element);

  const link = book.querySelector('a[href*="/book/show/"]');
  if (link?.href) return link.href;

  return null;
}

function findMyAnimeListUrl(element) {
  const anime = element.closest('.anime_ranking_h3, [data-id]');
  if (!anime) return findGenericUrl(element);

  const link = anime.querySelector('a[href*="/anime/"]');
  if (link?.href) return link.href;

  return null;
}

function findAniListUrl(element) {
  const media = element.closest('.media-card, [data-media-id]');
  if (!media) return findGenericUrl(element);

  const link = media.querySelector('a[href*="/anime/"], a[href*="/manga/"]');
  if (link?.href) return link.href;

  return null;
}

function findKitsuUrl(element) {
  const media = element.closest('.media-card');
  if (!media) return findGenericUrl(element);

  const link = media.querySelector('a[href*="/anime/"], a[href*="/manga/"]');
  if (link?.href) return link.href;

  return null;
}

function findLastFmUrl(element) {
  const item = element.closest('.chartlist-row, [data-track-id]');
  if (!item) return findGenericUrl(element);

  const link = item.querySelector('a[href*="/music/"]');
  if (link?.href) return link.href;

  return null;
}

function findSpotifyUrl(element) {
  const item = element.closest('[data-testid="tracklist-row"], .track');
  if (!item) return findGenericUrl(element);

  const link = item.querySelector('a[href*="/track/"], a[href*="/album/"]');
  if (link?.href) return link.href;

  return null;
}

function findSoundcloudUrl(element) {
  const track = element.closest('.searchItem, .soundList__item');
  if (!track) return findGenericUrl(element);

  const link = track.querySelector('a[href*="soundcloud.com/"]');
  if (link?.href) return link.href;

  return null;
}

function findBandcampUrl(element) {
  const item = element.closest('.item-details, [data-item-id]');
  if (!item) return findGenericUrl(element);

  const link = item.querySelector('a[href*="/track/"], a[href*="/album/"]');
  if (link?.href) return link.href;

  return null;
}

// ===== GAMING HANDLERS =====

function findSteamUrl(element) {
  const item = element.closest('[data-ds-appid], .search_result_row');
  if (!item) return findGenericUrl(element);

  const link = item.querySelector('a[href*="/app/"]');
  if (link?.href) return link.href;

  return null;
}

function findSteamPoweredUrl(element) {
  const item = element.closest('[data-ds-appid], .game_area');
  if (!item) return findGenericUrl(element);

  const link = item.querySelector('a[href*="/app/"]');
  if (link?.href) return link.href;

  return null;
}

function findEpicGamesUrl(element) {
  const game = element.closest('[data-component="Card"]');
  if (!game) return findGenericUrl(element);

  const link = game.querySelector('a[href*="/p/"]');
  if (link?.href) return link.href;

  return null;
}

function findGOGUrl(element) {
  const product = element.closest('.product-row, [data-game-id]');
  if (!product) return findGenericUrl(element);

  const link = product.querySelector('a[href*="/game/"]');
  if (link?.href) return link.href;

  return null;
}

function findItchIoUrl(element) {
  const game = element.closest('.game_cell, [data-game_id]');
  if (!game) return findGenericUrl(element);

  const link = game.querySelector('a.game_link, a.title');
  if (link?.href) return link.href;

  return null;
}

function findGameJoltUrl(element) {
  const game = element.closest('.game-card, [data-game-id]');
  if (!game) return findGenericUrl(element);

  const link = game.querySelector('a[href*="/games/"]');
  if (link?.href) return link.href;

  return null;
}

// ===== PROFESSIONAL & LEARNING HANDLERS =====

function findCourseraUrl(element) {
  const course = element.closest('[data-e2e="CourseCard"], .CourseCard');
  if (!course) return findGenericUrl(element);

  const link = course.querySelector('a[href*="/learn/"]');
  if (link?.href) return link.href;

  return null;
}

function findUdemyUrl(element) {
  const course = element.closest('[data-purpose="course-card"]');
  if (!course) return findGenericUrl(element);

  const link = course.querySelector('a[href*="/course/"]');
  if (link?.href) return link.href;

  return null;
}

function findEdXUrl(element) {
  const course = element.closest('.course-card, [data-course-id]');
  if (!course) return findGenericUrl(element);

  const link = course.querySelector('a[href*="/course/"]');
  if (link?.href) return link.href;

  return null;
}

function findKhanAcademyUrl(element) {
  const item = element.closest('[data-test-id], .link-item');
  if (!item) return findGenericUrl(element);

  const link = item.querySelector('a[href*="/math/"], a[href*="/science/"]');
  if (link?.href) return link.href;

  return null;
}

function findSkillshareUrl(element) {
  const classCard = element.closest('[data-class-id], .class-card');
  if (!classCard) return findGenericUrl(element);

  const link = classCard.querySelector('a[href*="/classes/"]');
  if (link?.href) return link.href;

  return null;
}

function findPluralsightUrl(element) {
  const course = element.closest('[data-course-id], .course-card');
  if (!course) return findGenericUrl(element);

  const link = course.querySelector('a[href*="/courses/"]');
  if (link?.href) return link.href;

  return null;
}

function findUdacityUrl(element) {
  const course = element.closest('[data-testid="catalog-card"]');
  if (!course) return findGenericUrl(element);

  const link = course.querySelector('a[href*="/course/"]');
  if (link?.href) return link.href;

  return null;
}

// ===== OTHER HANDLERS =====

function findArchiveOrgUrl(element) {
  const item = element.closest('.item-ia, [data-id]');
  if (!item) return findGenericUrl(element);

  const link = item.querySelector('a[href*="/details/"]');
  if (link?.href) return link.href;

  return null;
}

function findPatreonUrl(element) {
  const post = element.closest('[data-tag="post-card"]');
  if (!post) return findGenericUrl(element);

  const link = post.querySelector('a[href*="/posts/"]');
  if (link?.href) return link.href;

  return null;
}

function findKoFiUrl(element) {
  const post = element.closest('.feed-item, [data-post-id]');
  if (!post) return findGenericUrl(element);

  const link = post.querySelector('a[href*="/post/"]');
  if (link?.href) return link.href;

  return null;
}

function findBuyMeACoffeeUrl(element) {
  const post = element.closest('.feed-card');
  if (!post) return findGenericUrl(element);

  const link = post.querySelector('a[href*="/p/"]');
  if (link?.href) return link.href;

  return null;
}

function findGumroadUrl(element) {
  const product = element.closest('[data-permalink], .product-card');
  if (!product) return findGenericUrl(element);

  const link = product.querySelector('a[href*="gumroad.com/"]');
  if (link?.href) return link.href;

  return null;
}

// ===== GENERIC FALLBACK =====

function findGenericUrl(element) {
  // Look for direct href on clicked element
  if (element.href) return element.href;

  // Look for closest link
  const link = element.closest('a[href]');
  if (link?.href) return link.href;

  // Only search within element if it's a clear container (article, div with specific roles, etc.)
  // Don't search for unrelated links
  if (
    element.tagName === 'ARTICLE' ||
    element.getAttribute('role') === 'article' ||
    element.getAttribute('role') === 'link' ||
    element.classList.contains('post') ||
    element.hasAttribute('data-testid') ||
    element.hasAttribute('data-id')
  ) {
    const innerLink = element.querySelector('a[href]');
    if (innerLink?.href) return innerLink.href;
  }

  // Don't search siblings - that's too broad and causes false positives
  return null;
}

// Get link text
function getLinkText(element) {
  if (element.tagName === 'A') {
    return element.textContent.trim();
  }

  const link = element.querySelector('a[href]');
  if (link) {
    return link.textContent.trim();
  }

  return element.textContent.trim().substring(0, 100);
}

// Track mouse position for Quick Tab placement
document.addEventListener(
  'mousemove',
  function (event) {
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
  },
  true
);

// Hover detection
document.addEventListener(
  'mouseover',
  function (event) {
    let target = event.target;
    let element = null;
    const domainType = getDomainType();

    // Special, more precise handling for Twitter
    if (domainType === 'twitter') {
      // IMPORTANT: Find the CLOSEST article to the hovered element (innermost)
      // This will be the correct tweet if hovering over a nested quote
      const tweetArticle = target.closest('article');

      if (tweetArticle) {
        debug(`Found article at: ${tweetArticle.className}`);

        // Count how many status links are in this article
        const allStatusLinks = tweetArticle.querySelectorAll('a[href*="/status/"]');
        debug(`Status links in this article: ${allStatusLinks.length}`);

        // Print each status link for debugging
        allStatusLinks.forEach((link, index) => {
          debug(`  Link ${index}: ${link.href}`);
        });

        // CRITICAL: We need the FIRST status link that is a DIRECT child or close relative
        // For the correct tweet (not nested ones), find the main tweet's status link
        let mainStatusLink = null;

        // Try to find the status link that's closest in the DOM tree
        // Usually it's a direct child of the article or one level deep
        for (let link of allStatusLinks) {
          // Check if this is the main tweet's link by seeing if it's in a header section
          const timeElement = link.querySelector('time');
          if (timeElement) {
            debug(`Found status link with time element: ${link.href}`);
            mainStatusLink = link;
            break;
          }
        }

        // If no link with time found, use the first one
        if (!mainStatusLink && allStatusLinks.length > 0) {
          mainStatusLink = allStatusLinks[0];
          debug(`Using first status link: ${mainStatusLink.href}`);
        }

        if (mainStatusLink) {
          element = mainStatusLink;
          debug(`Selected element href: ${element.href}`);
        }
      }
    }

    // Use the old logic for other websites if the new Twitter logic doesn't find anything
    if (!element) {
      if (target.tagName === 'A' && target.href) {
        element = target;
      } else {
        element = target.closest(
          'article, [role="article"], .post, [data-testid="post"], [role="link"], .item, [data-id]'
        );
      }

      // Fallback: if no container found, use the target itself
      // This allows site-specific handlers to traverse the DOM with their own logic
      if (!element) {
        element = target;
        debug(
          `[${domainType}] No specific container found, using target element: ${target.tagName}`
        );
      }
    }

    if (element) {
      debug(`[${domainType}] Element detected, attempting URL detection...`);
      const url = findUrl(element, domainType);
      if (url) {
        currentHoveredLink = element;
        currentHoveredElement = element;
        debug(`[${domainType}] URL found: ${url}`);
      } else {
        // Clear hover state if no URL found - prevents false positives
        currentHoveredLink = null;
        currentHoveredElement = null;
        debug(`[${domainType}] No URL found for element`);
      }
    } else {
      // Clear hover state if no valid element
      currentHoveredLink = null;
      currentHoveredElement = null;
    }
  },
  true
);

// Mouseout
document.addEventListener(
  'mouseout',
  function (event) {
    currentHoveredLink = null;
    currentHoveredElement = null;
  },
  true
);

// Show notification
function showNotification(message, options = {}) {
  if (!CONFIG.showNotification) return;

  const showTooltip = options.tooltip || false;

  try {
    const notif = document.createElement('div');
    notif.textContent = message;

    // If tooltip is requested (for URL copy), show it near the cursor
    if (showTooltip) {
      // Ensure tooltip animation is initialized
      initTooltipAnimation();

      notif.style.cssText = `
        position: fixed;
        left: ${lastMouseX + TOOLTIP_OFFSET_X}px;
        top: ${lastMouseY + TOOLTIP_OFFSET_Y}px;
        background: ${CONFIG.notifColor};
        color: #fff;
        padding: 6px 12px;
        border-radius: 4px;
        border: 1px solid ${CONFIG.notifBorderColor || '#000000'};
        z-index: 999999;
        font-size: 12px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        animation: tooltipFadeIn 0.2s ease-out;
        pointer-events: none;
        white-space: nowrap;
      `;

      document.documentElement.appendChild(notif);

      // Schedule tooltip removal with fade out
      const removeTooltip = () => {
        notif.style.opacity = '0';
        notif.style.transition = `opacity ${TOOLTIP_FADE_OUT_MS}ms`;
        setTimeout(() => notif.remove(), TOOLTIP_FADE_OUT_MS);
      };
      setTimeout(removeTooltip, TOOLTIP_DURATION_MS);

      return;
    }

    // Regular notification (existing code)
    // Get position styles based on notifPosition setting
    let positionStyles = '';
    let isCenter = false;
    switch (CONFIG.notifPosition) {
      case 'top-left':
        positionStyles = 'top: 20px; left: 20px;';
        break;
      case 'top-center':
        positionStyles = 'top: 20px; left: 50%;';
        isCenter = true;
        break;
      case 'top-right':
        positionStyles = 'top: 20px; right: 20px;';
        break;
      case 'bottom-left':
        positionStyles = 'bottom: 20px; left: 20px;';
        break;
      case 'bottom-center':
        positionStyles = 'bottom: 20px; left: 50%;';
        isCenter = true;
        break;
      case 'bottom-right':
      default:
        positionStyles = 'bottom: 20px; right: 20px;';
        break;
    }

    // Get size styles based on notifSize setting
    let fontSize = '14px';
    let padding = '12px 20px';
    switch (CONFIG.notifSize) {
      case 'small':
        fontSize = '12px';
        padding = '8px 14px';
        break;
      case 'medium':
        fontSize = '14px';
        padding = '12px 20px';
        break;
      case 'large':
        fontSize = '16px';
        padding = '16px 26px';
        break;
    }

    // Get animation name
    let animationName = '';
    const animation = CONFIG.notifAnimation || 'slide';
    switch (animation) {
      case 'slide':
        animationName = 'notifSlideIn';
        break;
      case 'pop':
        animationName = 'notifPopIn';
        break;
      case 'none':
        animationName = 'notifFadeIn';
        break;
      default:
        animationName = 'notifSlideIn';
    }

    // Border styles
    const borderWidth = CONFIG.notifBorderWidth || 1;
    const borderColor = CONFIG.notifBorderColor || '#000000';

    notif.style.cssText = `
      position: fixed;
      ${positionStyles}
      ${isCenter ? 'transform: translateX(-50%);' : ''}
      background: ${CONFIG.notifColor};
      color: #fff;
      padding: ${padding};
      border-radius: 6px;
      border: ${borderWidth}px solid ${borderColor};
      z-index: 999999;
      font-size: ${fontSize};
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      animation: ${animationName} 0.3s ease-out;
    `;

    // Create animation styles based on position and animation type
    if (!document.querySelector('style[data-copy-url-notif]')) {
      const style = document.createElement('style');
      style.setAttribute('data-copy-url-notif', 'true');

      const position = CONFIG.notifPosition || 'bottom-right';

      let slideKeyframes = '';
      if (position.includes('center')) {
        if (position.includes('top')) {
          slideKeyframes = `
            @keyframes notifSlideIn {
              from { opacity: 0; margin-top: -50px; }
              to { opacity: 1; margin-top: 0; }
            }
          `;
        } else {
          slideKeyframes = `
            @keyframes notifSlideIn {
              from { opacity: 0; margin-bottom: -50px; }
              to { opacity: 1; margin-bottom: 0; }
            }
          `;
        }
      } else if (position.includes('right')) {
        slideKeyframes = `
          @keyframes notifSlideIn {
            from { transform: translateX(400px); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
        `;
      } else if (position.includes('left')) {
        slideKeyframes = `
          @keyframes notifSlideIn {
            from { transform: translateX(-400px); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
        `;
      }

      const popKeyframes = `
        @keyframes notifPopIn {
          0% { transform: scale(0.3); opacity: 0; }
          50% { transform: scale(1.05); }
          100% { transform: scale(1); opacity: 1; }
        }
      `;

      const fadeKeyframes = `
        @keyframes notifFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `;

      style.textContent = slideKeyframes + popKeyframes + fadeKeyframes;
      document.head.appendChild(style);
    }

    document.documentElement.appendChild(notif);

    setTimeout(() => {
      notif.remove();
    }, CONFIG.notifDuration);
  } catch (e) {
    debug('Notification error: ' + e.message);
  }
}

// Check modifiers
function checkModifiers(requireCtrl, requireAlt, requireShift, event) {
  const ctrlPressed = event.ctrlKey || event.metaKey;
  const altPressed = event.altKey;
  const shiftPressed = event.shiftKey;

  return requireCtrl === ctrlPressed && requireAlt === altPressed && requireShift === shiftPressed;
}

// Check if on a restricted page
function isRestrictedPage() {
  const url = window.location.href;
  return (
    url.startsWith('about:') ||
    url.startsWith('chrome:') ||
    url.startsWith('moz-extension:') ||
    url.startsWith('chrome-extension:')
  );
}

// Try to inject content script functionality into same-origin iframe
function tryInjectIntoIframe(iframe) {
  try {
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) {
      debug('Cannot access iframe document - likely cross-origin');
      return;
    }

    // Check if we can access the iframe (same-origin check)
    const iframeUrl = iframe.contentWindow.location.href;
    debug(`Attempting to inject into iframe: ${iframeUrl}`);

    // Create a script element with our content script's functionality
    // We'll create a minimal version that enables Quick Tabs within the iframe
    const script = iframeDoc.createElement('script');
    script.textContent = `
      // Minimal Quick Tab support for iframes
      (function() {
        if (window.__quickTabEnabled) return; // Already injected
        window.__quickTabEnabled = true;
        
        // Send message to parent to create Quick Tab
        function createQuickTabInParent(url) {
          // Get the parent origin for secure message passing
          const parentOrigin = (window.location.ancestorOrigins && window.location.ancestorOrigins[0]) 
            || window.location.origin;
          window.parent.postMessage({
            type: 'CREATE_QUICK_TAB',
            url: url
          }, parentOrigin);
        }
        
        // Add event listener for link hover
        document.addEventListener('keydown', function(event) {
          if (event.key === 'q' && !event.ctrlKey && !event.altKey && !event.shiftKey) {
            // For keyboard events, we need to find the currently hovered element
            let link = null;
            
            // Try to find hovered link using :hover pseudo-class
            const hovered = document.querySelectorAll(':hover');
            for (let el of hovered) {
              if (el.tagName === 'A' && el.href) {
                link = el;
                break;
              }
            }
            
            if (link && link.href) {
              event.preventDefault();
              createQuickTabInParent(link.href);
            }
          }
        }, true);
        
        console.log('[CopyURLHover] Nested Quick Tab support enabled in iframe');
      })();
    `;

    iframeDoc.head.appendChild(script);
    debug('Successfully injected Quick Tab support into same-origin iframe');
  } catch (err) {
    // Expected for cross-origin iframes
    debug('Could not inject into iframe (expected for cross-origin): ' + err.message);
  }
}

// Create Quick Tab window
function createQuickTabWindow(
  url,
  width,
  height,
  left,
  top,
  fromBroadcast = false,
  pinnedToUrl = null,
  quickTabId = null
) {
  if (isRestrictedPage()) {
    showNotification('✗ Quick Tab not available on this page');
    debug('Quick Tab blocked on restricted page');
    return;
  }

  // Validate URL
  if (!url || url.trim() === '') {
    debug('Cannot create Quick Tab with empty URL');
    return;
  }

  // Check max windows limit
  if (quickTabWindows.length >= CONFIG.quickTabMaxWindows) {
    showNotification(`✗ Maximum ${CONFIG.quickTabMaxWindows} Quick Tabs allowed`);
    debug(`Maximum Quick Tab windows (${CONFIG.quickTabMaxWindows}) reached`);
    return;
  }

  // Generate unique ID for this Quick Tab instance if not provided
  // This ensures multiple Quick Tabs with the same URL are tracked separately
  if (!quickTabId) {
    quickTabId = `qt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  debug(`Creating Quick Tab for URL: ${url} with ID: ${quickTabId}`);

  // Use provided dimensions or defaults
  const windowWidth = width || CONFIG.quickTabDefaultWidth;
  const windowHeight = height || CONFIG.quickTabDefaultHeight;

  // Create container
  const container = document.createElement('div');
  container.className = 'copy-url-quicktab-window';
  container.dataset.quickTabId = quickTabId; // Store ID on container for later reference
  container.style.cssText = `
    position: fixed;
    width: ${windowWidth}px;
    height: ${windowHeight}px;
    background: ${CONFIG.darkMode ? '#2d2d2d' : '#ffffff'};
    border: 2px solid ${CONFIG.darkMode ? '#555' : '#ddd'};
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: ${quickTabZIndex++};
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-width: 300px;
    min-height: 200px;
  `;

  // Position the window
  let posX, posY;

  // If position is provided (from restore), use it
  if (left !== undefined && top !== undefined) {
    posX = left;
    posY = top;
  } else {
    // Otherwise calculate based on settings
    switch (CONFIG.quickTabPosition) {
      case 'follow-cursor':
        posX = lastMouseX + 10;
        posY = lastMouseY + 10;
        break;
      case 'center':
        posX = (window.innerWidth - windowWidth) / 2;
        posY = (window.innerHeight - windowHeight) / 2;
        break;
      case 'top-left':
        posX = 20;
        posY = 20;
        break;
      case 'top-right':
        posX = window.innerWidth - windowWidth - 20;
        posY = 20;
        break;
      case 'bottom-left':
        posX = 20;
        posY = window.innerHeight - windowHeight - 20;
        break;
      case 'bottom-right':
        posX = window.innerWidth - windowWidth - 20;
        posY = window.innerHeight - windowHeight - 20;
        break;
      case 'custom':
        posX = CONFIG.quickTabCustomX;
        posY = CONFIG.quickTabCustomY;
        break;
      default:
        posX = lastMouseX + 10;
        posY = lastMouseY + 10;
    }
  }

  // Ensure window stays within viewport
  posX = Math.max(0, Math.min(posX, window.innerWidth - windowWidth));
  posY = Math.max(0, Math.min(posY, window.innerHeight - windowHeight));

  container.style.left = posX + 'px';
  container.style.top = posY + 'px';

  // Create iframe first (needed for button handlers)
  const iframe = document.createElement('iframe');

  // For cross-origin iframes created via broadcast when tab is hidden,
  // defer loading until tab becomes visible to prevent autoplay in background
  if (document.hidden && fromBroadcast) {
    iframe.setAttribute('data-deferred-src', url);

    // Load the iframe when tab becomes visible
    const loadWhenVisible = () => {
      if (!document.hidden) {
        iframe.src = iframe.getAttribute('data-deferred-src');
        iframe.removeAttribute('data-deferred-src');
        document.removeEventListener('visibilitychange', loadWhenVisible);
      }
    };
    document.addEventListener('visibilitychange', loadWhenVisible);
  } else {
    // Load immediately for foreground tabs or manually created Quick Tabs
    iframe.src = url;
  }

  iframe.style.cssText = `
    flex: 1;
    border: none;
    width: 100%;
    background: white;
  `;

  // Create title bar
  const titleBar = document.createElement('div');
  titleBar.className = 'copy-url-quicktab-titlebar';
  titleBar.style.cssText = `
    height: 40px;
    background: ${CONFIG.darkMode ? '#1e1e1e' : '#f5f5f5'};
    border-bottom: 1px solid ${CONFIG.darkMode ? '#555' : '#ddd'};
    display: flex;
    align-items: center;
    padding: 0 10px;
    user-select: none;
    gap: 5px;
    cursor: move;
  `;

  // Navigation buttons container
  const navContainer = document.createElement('div');
  navContainer.style.cssText = `
    display: flex;
    gap: 4px;
    align-items: center;
  `;

  // Helper function to create navigation button
  const createNavButton = (symbol, title) => {
    const btn = document.createElement('button');
    btn.textContent = symbol;
    btn.title = title;
    btn.style.cssText = `
      width: 24px;
      height: 24px;
      background: transparent;
      color: ${CONFIG.darkMode ? '#e0e0e0' : '#333'};
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      font-weight: bold;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s;
    `;
    btn.onmouseover = () => (btn.style.background = CONFIG.darkMode ? '#444' : '#e0e0e0');
    btn.onmouseout = () => (btn.style.background = 'transparent');
    return btn;
  };

  // Back button
  const backBtn = createNavButton('←', 'Back');
  backBtn.onclick = e => {
    e.stopPropagation();
    if (iframe.contentWindow) {
      try {
        iframe.contentWindow.history.back();
      } catch (err) {
        debug('Cannot navigate back - cross-origin restriction');
      }
    }
  };

  // Forward button
  const forwardBtn = createNavButton('→', 'Forward');
  forwardBtn.onclick = e => {
    e.stopPropagation();
    if (iframe.contentWindow) {
      try {
        iframe.contentWindow.history.forward();
      } catch (err) {
        debug('Cannot navigate forward - cross-origin restriction');
      }
    }
  };

  // Reload button
  const reloadBtn = createNavButton('↻', 'Reload');
  reloadBtn.onclick = e => {
    e.stopPropagation();
    const currentSrc = iframe.src;
    iframe.src = 'about:blank';
    setTimeout(() => {
      iframe.src = currentSrc;
    }, 10);
  };
  navContainer.appendChild(backBtn);
  navContainer.appendChild(forwardBtn);
  navContainer.appendChild(reloadBtn);

  // Favicon
  const favicon = document.createElement('img');
  favicon.style.cssText = `
    width: 16px;
    height: 16px;
    margin-left: 5px;
  `;
  // Extract domain for favicon
  try {
    const urlObj = new URL(url);
    favicon.src = `${GOOGLE_FAVICON_URL}${urlObj.hostname}&sz=32`;
    favicon.onerror = () => {
      favicon.style.display = 'none';
    };
  } catch (e) {
    favicon.style.display = 'none';
  }

  // Title text
  const titleText = document.createElement('span');
  titleText.textContent = 'Loading...';
  titleText.style.cssText = `
    flex: 1;
    font-size: 12px;
    font-weight: 500;
    color: ${CONFIG.darkMode ? '#e0e0e0' : '#333'};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin: 0 5px;
  `;

  // Minimize button
  const minimizeBtn = document.createElement('button');
  minimizeBtn.textContent = '−';
  minimizeBtn.title = 'Minimize';
  minimizeBtn.style.cssText = `
    width: 24px;
    height: 24px;
    background: transparent;
    color: ${CONFIG.darkMode ? '#e0e0e0' : '#333'};
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 16px;
    font-weight: bold;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;
  `;
  minimizeBtn.onmouseover = () =>
    (minimizeBtn.style.background = CONFIG.darkMode ? '#444' : '#e0e0e0');
  minimizeBtn.onmouseout = () => (minimizeBtn.style.background = 'transparent');
  minimizeBtn.onclick = e => {
    e.stopPropagation();
    minimizeQuickTab(container, iframe.src, titleText.textContent);
  };

  // Open in new tab button
  const openBtn = document.createElement('button');
  openBtn.textContent = '🔗';
  openBtn.title = 'Open in New Tab';
  openBtn.style.cssText = `
    width: 24px;
    height: 24px;
    background: transparent;
    color: ${CONFIG.darkMode ? '#e0e0e0' : '#333'};
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;
  `;
  openBtn.onmouseover = () => (openBtn.style.background = CONFIG.darkMode ? '#444' : '#e0e0e0');
  openBtn.onmouseout = () => (openBtn.style.background = 'transparent');
  openBtn.onclick = e => {
    e.stopPropagation();
    browser.runtime.sendMessage({
      action: 'openTab',
      url: iframe.src,
      switchFocus: true // Always switch focus when opening from Quick Tab
    });
    showNotification('✓ Opened in new tab');
    debug(`Quick Tab opened URL in new tab: ${iframe.src}`);

    // Close Quick Tab if setting is enabled
    if (CONFIG.quickTabCloseOnOpen) {
      closeQuickTabWindow(container);
    }
  };

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.title = 'Close';
  closeBtn.style.cssText = `
    width: 24px;
    height: 24px;
    background: transparent;
    color: ${CONFIG.darkMode ? '#e0e0e0' : '#333'};
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;
  `;
  closeBtn.onmouseover = () =>
    (closeBtn.style.background = CONFIG.darkMode ? '#ff5555' : '#ffcccc');
  closeBtn.onmouseout = () => (closeBtn.style.background = 'transparent');
  closeBtn.onclick = e => {
    e.stopPropagation();
    closeQuickTabWindow(container);
  };

  titleBar.appendChild(navContainer);
  titleBar.appendChild(favicon);
  titleBar.appendChild(titleText);

  // Slot number label for debug mode
  if (CONFIG.debugMode) {
    const slotNumber = assignQuickTabSlot(quickTabId);

    const slotLabel = document.createElement('span');
    slotLabel.className = 'quicktab-slot-label';
    slotLabel.textContent = `Slot ${slotNumber}`;
    slotLabel.style.cssText = `
      font-size: 11px;
      color: ${CONFIG.darkMode ? '#888' : '#666'};
      margin-left: 8px;
      margin-right: 5px;
      font-weight: normal;
      font-family: monospace;
      background: ${CONFIG.darkMode ? '#333' : '#f0f0f0'};
      padding: 2px 6px;
      border-radius: 3px;
      white-space: nowrap;
    `;

    titleBar.appendChild(slotLabel);
  }

  // Pin button (before minimize button)
  const pinBtn = document.createElement('button');
  pinBtn.textContent = pinnedToUrl ? '📌' : '📍';
  pinBtn.title = pinnedToUrl ? `Pinned to: ${pinnedToUrl}` : 'Pin to current page';
  pinBtn.style.cssText = `
    width: 24px;
    height: 24px;
    background: ${pinnedToUrl ? (CONFIG.darkMode ? '#444' : '#e0e0e0') : 'transparent'};
    color: ${CONFIG.darkMode ? '#e0e0e0' : '#333'};
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;
  `;
  pinBtn.onmouseover = () => (pinBtn.style.background = CONFIG.darkMode ? '#444' : '#e0e0e0');
  pinBtn.onmouseout = () =>
    (pinBtn.style.background = pinnedToUrl
      ? CONFIG.darkMode
        ? '#444'
        : '#e0e0e0'
      : 'transparent');
  pinBtn.onclick = e => {
    e.stopPropagation();

    // Toggle pin state
    if (container._pinnedToUrl) {
      // Unpin
      container._pinnedToUrl = null;
      pinBtn.textContent = '📍';
      pinBtn.title = 'Pin to current page';
      pinBtn.style.background = 'transparent';
      showNotification('✓ Quick Tab unpinned');
      debug(`Quick Tab unpinned: ${iframe.src || iframe.getAttribute('data-deferred-src')}`);

      // Notify background script to update pin state
      const quickTabId = container.dataset.quickTabId;
      if (quickTabId) {
        sendRuntimeMessage({
          action: 'UPDATE_QUICK_TAB_PIN',
          id: quickTabId,
          pinnedToUrl: null
        }).catch(err => {
          debug('Error notifying background of Quick Tab unpin:', err);
        });
      }

      // Save unpin via queue
      if (CONFIG.quickTabPersistAcrossTabs && quickTabId) {
        saveQuickTabState('update', quickTabId, {
          pinnedToUrl: null
        })
          .then(() => {
            debug(`Quick Tab ${quickTabId} unpinned and saved`);
          })
          .catch(err => {
            console.error(`Failed to save unpin for ${quickTabId}:`, err);
          });
      }
    } else {
      // Pin to current page URL
      const currentPageUrl = window.location.href;
      container._pinnedToUrl = currentPageUrl;
      pinBtn.textContent = '📌';
      pinBtn.title = `Pinned to: ${currentPageUrl}`;
      pinBtn.style.background = CONFIG.darkMode ? '#444' : '#e0e0e0';
      showNotification('✓ Quick Tab pinned to this page');
      debug(`Quick Tab pinned to: ${currentPageUrl}`);

      // Save pin via queue
      const quickTabId = container.dataset.quickTabId;
      if (quickTabId && CONFIG.quickTabPersistAcrossTabs) {
        saveQuickTabState('update', quickTabId, {
          pinnedToUrl: currentPageUrl
        })
          .then(() => {
            debug(`Quick Tab ${quickTabId} pinned and saved`);
          })
          .catch(err => {
            console.error(`Failed to save pin for ${quickTabId}:`, err);
          });
      }
    }
  };

  titleBar.appendChild(pinBtn);
  titleBar.appendChild(minimizeBtn);
  titleBar.appendChild(openBtn);
  titleBar.appendChild(closeBtn);

  container.appendChild(titleBar);
  container.appendChild(iframe);

  // Try to update title when iframe loads
  iframe.addEventListener('load', () => {
    try {
      // This will fail for cross-origin iframes, but that's okay
      const iframeTitle = iframe.contentDocument?.title;
      if (iframeTitle) {
        titleText.textContent = iframeTitle;
        titleText.title = iframeTitle;
      } else {
        // Fallback to URL
        try {
          const urlObj = new URL(iframe.src);
          titleText.textContent = urlObj.hostname;
          titleText.title = iframe.src;
        } catch (e) {
          titleText.textContent = 'Quick Tab';
        }
      }

      // Try to inject content script into same-origin iframe for nested Quick Tabs
      tryInjectIntoIframe(iframe);

      // If this tab is hidden (Quick Tab created via broadcast while tab was in background),
      // pause any media that might have started playing
      if (document.hidden) {
        pauseMediaInIframe(iframe);
        debug(`Paused media in newly created Quick Tab because tab is hidden: ${iframe.src}`);
      }
    } catch (e) {
      // Cross-origin - use URL instead
      try {
        const urlObj = new URL(iframe.src);
        titleText.textContent = urlObj.hostname;
        titleText.title = iframe.src;
      } catch (err) {
        titleText.textContent = 'Quick Tab';
      }
    }
  });

  // Add to DOM
  document.documentElement.appendChild(container);

  // Store the pinned URL on the container
  container._pinnedToUrl = pinnedToUrl;

  // Add to tracking array
  quickTabWindows.push(container);

  // Make draggable
  makeDraggable(container, titleBar);

  // Make resizable if enabled
  if (CONFIG.quickTabEnableResize) {
    makeResizable(container);
  }

  // Bring to front on click (z-index management)
  container.addEventListener('mousedown', () => {
    bringQuickTabToFront(container);
  });

  showNotification('✓ Quick Tab opened');
  debug(`Quick Tab window created. Total windows: ${quickTabWindows.length}`);

  // Save via queue-based system (replaces both broadcast and background message)
  if (!fromBroadcast && CONFIG.quickTabPersistAcrossTabs) {
    saveQuickTabState('create', quickTabId, {
      url: url,
      width: windowWidth,
      height: windowHeight,
      left: posX,
      top: posY,
      pinnedToUrl: pinnedToUrl
    })
      .then(() => {
        debug(`Quick Tab ${quickTabId} creation saved and confirmed`);
      })
      .catch(err => {
        console.error(`Failed to save Quick Tab ${quickTabId}:`, err);
        showNotification('⚠️ Quick Tab save failed');
      });
  }
}

// Close Quick Tab window
function closeQuickTabWindow(container, broadcast = true) {
  const index = quickTabWindows.indexOf(container);
  if (index > -1) {
    quickTabWindows.splice(index, 1);
  }

  // Get URL and ID before removing the container (check both src and data-deferred-src)
  const iframe = container.querySelector('iframe');
  const url = iframe ? iframe.src || iframe.getAttribute('data-deferred-src') : null;
  const quickTabId = container.dataset.quickTabId;

  // Release slot number for reuse in debug mode
  if (quickTabId && CONFIG.debugMode) {
    releaseQuickTabSlot(quickTabId);
  }

  // Clean up drag listeners
  if (container._dragCleanup) {
    container._dragCleanup();
  }
  // Clean up resize listeners
  if (container._resizeCleanup) {
    container._resizeCleanup();
  }
  container.remove();
  debug(`Quick Tab window closed. ID: ${quickTabId}, Remaining windows: ${quickTabWindows.length}`);

  // Save deletion via queue-based system
  if (CONFIG.quickTabPersistAcrossTabs && quickTabId) {
    saveQuickTabState('delete', quickTabId).catch(err => {
      debug('Error saving Quick Tab deletion:', err);
    });
  }
}

// Close all Quick Tab windows
function closeAllQuickTabWindows(broadcast = true) {
  const count = quickTabWindows.length;
  quickTabWindows.forEach(window => {
    // Release slot number for each Quick Tab in debug mode
    const quickTabId = window.dataset.quickTabId;
    if (quickTabId && CONFIG.debugMode) {
      releaseQuickTabSlot(quickTabId);
    }

    if (window._dragCleanup) {
      window._dragCleanup();
    }
    if (window._resizeCleanup) {
      window._resizeCleanup();
    }
    window.remove();
  });
  quickTabWindows = [];

  // Reset slot numbering when all Quick Tabs are closed
  if (CONFIG.debugMode) {
    resetQuickTabSlots();
  }

  if (count > 0) {
    showNotification(`✓ Closed ${count} Quick Tab${count > 1 ? 's' : ''}`);
    debug(`All Quick Tab windows closed (${count} total)`);
  }

  // Always clear storage when all tabs are closed
  if (CONFIG.quickTabPersistAcrossTabs) {
    clearQuickTabsFromStorage();
  }

  // Broadcast to other tabs if enabled
  if (broadcast && CONFIG.quickTabPersistAcrossTabs) {
    broadcastCloseAll();
  }
}

// Minimize Quick Tab - Updated for Sidebar API (v1.5.8)
async function minimizeQuickTab(container, url, title) {
  const index = quickTabWindows.indexOf(container);
  if (index > -1) {
    quickTabWindows.splice(index, 1);
  }

  const quickTabId = container.dataset.quickTabId;
  const rect = container.getBoundingClientRect();

  // Get active browser tab ID
  let activeTabId = null;
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0) {
      activeTabId = tabs[0].id;
    }
  } catch (err) {
    debug('Error getting active tab ID:', err);
  }

  // Store complete minimized tab info (including position/size for restoration)
  const minimizedData = {
    id: quickTabId,
    url: url,
    title: title || 'Quick Tab',
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    minimized: true,
    pinnedToUrl: container._pinnedToUrl || null,
    slotNumber: CONFIG.debugMode ? quickTabSlots.get(quickTabId) || null : null,
    activeTabId: activeTabId,
    timestamp: Date.now()
  };

  minimizedQuickTabs.push(minimizedData);

  // Clean up and hide
  container.remove();

  showNotification('✓ Quick Tab minimized');
  debug(`Quick Tab minimized. Total minimized: ${minimizedQuickTabs.length}`);

  // Update or create minimized tabs manager
  updateMinimizedTabsManager();

  // Save to storage via queue if persistence is enabled
  if (CONFIG.quickTabPersistAcrossTabs && quickTabId) {
    saveQuickTabState('minimize', quickTabId, minimizedData).catch(err => {
      debug('Error saving minimized Quick Tab:', err);
    });
  }
}

// Restore minimized Quick Tab - Updated for Sidebar API (v1.5.8)
async function restoreQuickTab(indexOrId) {
  let tab = null;
  let index = -1;

  // Support both index-based (for backward compatibility) and ID-based restore
  if (typeof indexOrId === 'number' && indexOrId >= 0 && indexOrId < minimizedQuickTabs.length) {
    // Index-based restore (from local minimizedQuickTabs array)
    index = indexOrId;
    tab = minimizedQuickTabs[index];
  } else if (typeof indexOrId === 'string') {
    // ID-based restore (from sidebar command)
    const quickTabId = indexOrId;

    // Load state from storage to get Quick Tab details
    try {
      const cookieStoreId = await getCurrentCookieStoreId();
      const result = await browser.storage.sync.get('quick_tabs_state_v2');

      if (!result || !result.quick_tabs_state_v2) {
        debug('No Quick Tabs state found');
        return;
      }

      const state = result.quick_tabs_state_v2;
      const containerState = state[cookieStoreId];

      if (!containerState || !containerState.tabs) {
        debug(`No Quick Tabs for container ${cookieStoreId}`);
        return;
      }

      // Find the Quick Tab to restore
      tab = containerState.tabs.find(t => t.id === quickTabId);

      if (!tab) {
        debug(`Quick Tab ${quickTabId} not found in storage`);
        return;
      }

      // Also remove from local minimizedQuickTabs array if present
      index = minimizedQuickTabs.findIndex(t => t.id === quickTabId);
    } catch (err) {
      console.error('Error loading Quick Tab from storage:', err);
      return;
    }
  }

  if (!tab) {
    debug('No tab to restore');
    return;
  }

  // Remove from local array if found
  if (index >= 0) {
    minimizedQuickTabs.splice(index, 1);
  }

  // Create Quick Tab window with stored properties
  createQuickTabWindow(
    tab.url,
    tab.width,
    tab.height,
    tab.left,
    tab.top,
    true, // fromBroadcast = true (don't re-save)
    tab.pinnedToUrl,
    tab.id
  );

  updateMinimizedTabsManager();

  // Update storage to mark as not minimized
  if (CONFIG.quickTabPersistAcrossTabs && tab.id) {
    try {
      const cookieStoreId = await getCurrentCookieStoreId();
      const result = await browser.storage.sync.get('quick_tabs_state_v2');

      if (result && result.quick_tabs_state_v2) {
        const state = result.quick_tabs_state_v2;

        if (state[cookieStoreId] && state[cookieStoreId].tabs) {
          // Update the tab to mark as not minimized
          const updatedTabs = state[cookieStoreId].tabs.map(t => {
            if (t.id === tab.id) {
              return { ...t, minimized: false };
            }
            return t;
          });

          state[cookieStoreId].tabs = updatedTabs;
          state[cookieStoreId].timestamp = Date.now();

          await browser.storage.sync.set({ quick_tabs_state_v2: state });
        }
      }
    } catch (err) {
      debug('Error updating restored Quick Tab in storage:', err);
    }
  }

  debug(`Quick Tab restored from minimized. Remaining minimized: ${minimizedQuickTabs.length}`);
}

// Delete minimized Quick Tab
function deleteMinimizedQuickTab(index) {
  if (index < 0 || index >= minimizedQuickTabs.length) return;

  minimizedQuickTabs.splice(index, 1);
  showNotification('✓ Minimized Quick Tab deleted');
  updateMinimizedTabsManager();

  debug(`Minimized Quick Tab deleted. Remaining minimized: ${minimizedQuickTabs.length}`);
}

// REMOVED: updateMinimizedTabsManager() - Replaced by sidebar/quick-tabs-manager.html
// Minimized Quick Tabs are now managed through the Firefox sidebar API (v1.5.8+)
// The floating minimized manager has been replaced with a full sidebar panel
// See sidebar/quick-tabs-manager.html for the new implementation
function updateMinimizedTabsManager() {
  // No-op: Minimized tabs are now managed by sidebar
  // This function is kept for backward compatibility but does nothing
  // All minimized tab state is stored in browser.storage.sync and displayed in the sidebar
}

// Make element draggable
// ==================== MAKE DRAGGABLE WITH POINTER EVENTS ====================
// Uses Pointer Events API with setPointerCapture for reliable drag without slipping
// Integrates with BroadcastChannel, browser.storage.sync, and browser.runtime messaging
function makeDraggable(element, handle) {
  let isDragging = false;
  let offsetX = 0,
    offsetY = 0;
  let currentPointerId = null;
  let dragOverlay = null;
  let lastThrottledSaveTime = 0;
  let lastDebugLogTime = 0;
  const THROTTLE_SAVE_MS = 500; // Save every 500ms during drag
  const DEBUG_LOG_INTERVAL_MS = 100; // Debug log every 100ms

  // Create full-screen overlay during drag to prevent pointer escape
  const createDragOverlay = () => {
    const overlay = document.createElement('div');
    overlay.className = 'copy-url-drag-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 999999999;
      cursor: grabbing;
      pointer-events: auto;
      background: transparent;
    `;
    document.documentElement.appendChild(overlay);
    return overlay;
  };

  const removeDragOverlay = () => {
    if (dragOverlay) {
      dragOverlay.remove();
      dragOverlay = null;
    }
  };

  // Throttled save during drag (integrates with browser.runtime.sendMessage)
  const throttledSaveDuringDrag = (newLeft, newTop) => {
    const now = performance.now();
    if (now - lastThrottledSaveTime < THROTTLE_SAVE_MS) return;

    lastThrottledSaveTime = now;

    // Get Quick Tab metadata
    const iframe = element.querySelector('iframe');
    if (!iframe || !CONFIG.quickTabPersistAcrossTabs) return;

    const url = iframe.src || iframe.getAttribute('data-deferred-src');
    const quickTabId = element.dataset.quickTabId;
    if (!url || !quickTabId) return;

    const rect = element.getBoundingClientRect();

    // INTEGRATION POINT 1: Send to background script for real-time cross-origin coordination
    sendRuntimeMessage({
      action: 'UPDATE_QUICK_TAB_POSITION',
      id: quickTabId,
      url: url,
      left: Math.round(newLeft),
      top: Math.round(newTop),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    }).catch(err => {
      debug('[POINTER] Error sending throttled position update to background:', err);
    });

    // INTEGRATION POINT 2: BroadcastChannel for same-origin real-time sync (redundant but fast)
    broadcastQuickTabMove(quickTabId, url, Math.round(newLeft), Math.round(newTop));
  };

  // Final save on drag end (integrates with all three layers)
  const finalSaveOnDragEnd = (finalLeft, finalTop) => {
    const iframe = element.querySelector('iframe');
    if (!iframe || !CONFIG.quickTabPersistAcrossTabs) return;

    const quickTabId = element.dataset.quickTabId;
    if (!quickTabId) return;

    // Save via queue
    saveQuickTabState('update', quickTabId, {
      left: finalLeft,
      top: finalTop
    })
      .then(() => {
        debug(`Quick Tab ${quickTabId} position saved: (${finalLeft}, ${finalTop})`);
      })
      .catch(err => {
        console.error(`Failed to save position for ${quickTabId}:`, err);
      });
  };

  // =========================
  // POINTER EVENT HANDLERS
  // =========================

  const handlePointerDown = e => {
    // Ignore non-primary buttons and clicks on buttons/images
    if (e.button !== 0) return;
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'IMG') return;

    // Bring this Quick Tab to front when user starts interacting
    bringQuickTabToFront(element);

    // Start dragging
    isDragging = true;
    currentPointerId = e.pointerId;

    // CRITICAL: Capture all future pointer events to this element
    // This prevents "drag slipping" even during very fast mouse movements
    handle.setPointerCapture(e.pointerId);

    // Calculate offset from mouse to element top-left
    const rect = element.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;

    // Create full-screen overlay for maximum capture area
    dragOverlay = createDragOverlay();

    // Update cursor
    handle.style.cursor = 'grabbing';
    element.style.cursor = 'grabbing';

    // Reset timing trackers
    lastThrottledSaveTime = performance.now();
    lastDebugLogTime = performance.now();

    if (CONFIG.debugMode) {
      const url = element.querySelector('iframe')?.src || 'unknown';
      debug(
        `[POINTER DOWN] Drag started - Pointer ID: ${e.pointerId}, URL: ${url}, Start: (${Math.round(rect.left)}, ${Math.round(rect.top)})`
      );
    }

    e.preventDefault();
  };

  const handlePointerMove = e => {
    if (!isDragging) return;

    // Verify pointer is still captured (safety check)
    if (e.pointerId !== currentPointerId) return;

    // Calculate new position (direct, no RAF delay)
    const newLeft = e.clientX - offsetX;
    const newTop = e.clientY - offsetY;

    // IMMEDIATE POSITION UPDATE (no requestAnimationFrame)
    // This eliminates the 16ms delay that causes stale positions
    element.style.left = newLeft + 'px';
    element.style.top = newTop + 'px';

    // Throttled save during drag (500ms intervals)
    throttledSaveDuringDrag(newLeft, newTop);

    // Debug logging (throttled to 100ms intervals)
    if (CONFIG.debugMode) {
      const now = performance.now();
      if (now - lastDebugLogTime >= DEBUG_LOG_INTERVAL_MS) {
        const url = element.querySelector('iframe')?.src || 'unknown';
        debug(
          `[POINTER MOVE] Dragging - URL: ${url}, Position: (${Math.round(newLeft)}, ${Math.round(newTop)})`
        );
        lastDebugLogTime = now;
      }
    }

    e.preventDefault();
  };

  const handlePointerUp = e => {
    if (!isDragging) return;
    if (e.pointerId !== currentPointerId) return;

    isDragging = false;

    // Get final position
    const rect = element.getBoundingClientRect();
    const finalLeft = rect.left;
    const finalTop = rect.top;

    // Release pointer capture (automatic, but explicit is clearer)
    handle.releasePointerCapture(e.pointerId);

    // Remove overlay
    removeDragOverlay();

    // Restore cursor
    handle.style.cursor = 'grab';
    element.style.cursor = 'default';

    // FINAL SAVE - integrates with all three sync layers
    finalSaveOnDragEnd(finalLeft, finalTop);

    if (CONFIG.debugMode) {
      const url = element.querySelector('iframe')?.src || 'unknown';
      debug(
        `[POINTER UP] Drag ended - URL: ${url}, Final Position: (${Math.round(finalLeft)}, ${Math.round(finalTop)})`
      );
    }
  };

  const handlePointerCancel = e => {
    if (!isDragging) return;

    // CRITICAL FOR ISSUE #51: Handle tab switches during drag
    // This event fires when:
    // - User switches tabs mid-drag (document.hidden becomes true)
    // - Browser interrupts the drag operation
    // - Touch input is cancelled

    isDragging = false;

    // Get current position before cleanup
    const rect = element.getBoundingClientRect();
    const currentLeft = rect.left;
    const currentTop = rect.top;

    // Release capture
    if (currentPointerId !== null) {
      try {
        handle.releasePointerCapture(currentPointerId);
      } catch (err) {
        // Capture may already be released
        debug('[POINTER CANCEL] Capture already released');
      }
    }

    // Remove overlay
    removeDragOverlay();

    // Restore cursor
    handle.style.cursor = 'grab';
    element.style.cursor = 'default';

    // EMERGENCY SAVE - ensures position is saved even if drag was interrupted
    finalSaveOnDragEnd(currentLeft, currentTop);

    if (CONFIG.debugMode) {
      const url = element.querySelector('iframe')?.src || 'unknown';
      debug(
        `[POINTER CANCEL] Drag cancelled - URL: ${url}, Saved Position: (${Math.round(currentLeft)}, ${Math.round(currentTop)})`
      );
    }
  };

  const handleLostPointerCapture = e => {
    // This fires when capture is released (either explicitly or automatically)
    // Useful for cleanup verification

    if (CONFIG.debugMode) {
      debug(`[LOST CAPTURE] Pointer capture released - Pointer ID: ${e.pointerId}`);
    }

    // Ensure cleanup
    isDragging = false;
    removeDragOverlay();
    handle.style.cursor = 'grab';
    element.style.cursor = 'default';
  };

  // =========================
  // ATTACH EVENT LISTENERS
  // =========================

  handle.addEventListener('pointerdown', handlePointerDown);
  handle.addEventListener('pointermove', handlePointerMove);
  handle.addEventListener('pointerup', handlePointerUp);
  handle.addEventListener('pointercancel', handlePointerCancel);
  handle.addEventListener('lostpointercapture', handleLostPointerCapture);

  // Also handle window/document level events for safety
  window.addEventListener('blur', () => {
    if (isDragging) {
      handlePointerCancel({ pointerId: currentPointerId });
    }
  });

  // Store cleanup function for when Quick Tab is closed
  element._dragCleanup = () => {
    removeDragOverlay();
    handle.removeEventListener('pointerdown', handlePointerDown);
    handle.removeEventListener('pointermove', handlePointerMove);
    handle.removeEventListener('pointerup', handlePointerUp);
    handle.removeEventListener('pointercancel', handlePointerCancel);
    handle.removeEventListener('lostpointercapture', handleLostPointerCapture);

    if (CONFIG.debugMode) {
      debug('[CLEANUP] Drag event listeners removed');
    }
  };
}
// ==================== END MAKE DRAGGABLE ====================

// ==================== MAKE RESIZABLE WITH POINTER EVENTS ====================
// Uses Pointer Events API for each resize handle direction
// Integrates with BroadcastChannel and browser.runtime messaging
function makeResizable(element) {
  const minWidth = 300;
  const minHeight = 200;
  const handleSize = 10;
  const THROTTLE_SAVE_MS = 500;
  const DEBUG_LOG_INTERVAL_MS = 100;

  // Define resize handles (unchanged)
  const handles = {
    se: { cursor: 'se-resize', bottom: 0, right: 0 },
    sw: { cursor: 'sw-resize', bottom: 0, left: 0 },
    ne: { cursor: 'ne-resize', top: 0, right: 0 },
    nw: { cursor: 'nw-resize', top: 0, left: 0 },
    e: { cursor: 'e-resize', top: handleSize, right: 0, bottom: handleSize },
    w: { cursor: 'w-resize', top: handleSize, left: 0, bottom: handleSize },
    s: { cursor: 's-resize', bottom: 0, left: handleSize, right: handleSize },
    n: { cursor: 'n-resize', top: 0, left: handleSize, right: handleSize }
  };

  const resizeHandleElements = [];

  Object.entries(handles).forEach(([direction, style]) => {
    const handle = document.createElement('div');
    handle.className = 'copy-url-resize-handle';
    handle.style.cssText = `
      position: absolute;
      ${style.top !== undefined ? `top: ${style.top}px;` : ''}
      ${style.bottom !== undefined ? `bottom: ${style.bottom}px;` : ''}
      ${style.left !== undefined ? `left: ${style.left}px;` : ''}
      ${style.right !== undefined ? `right: ${style.right}px;` : ''}
      ${direction.includes('e') || direction.includes('w') ? `width: ${handleSize}px;` : ''}
      ${direction.includes('n') || direction.includes('s') ? `height: ${handleSize}px;` : ''}
      ${direction.length === 2 ? `width: ${handleSize}px; height: ${handleSize}px;` : ''}
      cursor: ${style.cursor};
      z-index: 10;
    `;

    let isResizing = false;
    let currentPointerId = null;
    let startX, startY, startWidth, startHeight, startLeft, startTop;
    let resizeOverlay = null;
    let lastThrottledSaveTime = 0;
    let lastDebugLogTime = 0;

    const createResizeOverlay = () => {
      const overlay = document.createElement('div');
      overlay.className = 'copy-url-resize-overlay';
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 999999999;
        cursor: ${style.cursor};
        pointer-events: auto;
        background: transparent;
      `;
      document.documentElement.appendChild(overlay);
      return overlay;
    };

    const removeResizeOverlay = () => {
      if (resizeOverlay) {
        resizeOverlay.remove();
        resizeOverlay = null;
      }
    };

    // Throttled save during resize
    const throttledSaveDuringResize = (newWidth, newHeight, newLeft, newTop) => {
      const now = performance.now();
      if (now - lastThrottledSaveTime < THROTTLE_SAVE_MS) return;

      lastThrottledSaveTime = now;

      const iframe = element.querySelector('iframe');
      if (!iframe || !CONFIG.quickTabPersistAcrossTabs) return;

      const quickTabId = element.dataset.quickTabId;
      if (!quickTabId) return;

      // Save via queue (will be batched)
      saveQuickTabState('update', quickTabId, {
        left: newLeft,
        top: newTop,
        width: newWidth,
        height: newHeight
      }).catch(err => {
        debug('[POINTER] Error during throttled resize save:', err);
      });
    };

    const finalSaveOnResizeEnd = (finalWidth, finalHeight, finalLeft, finalTop) => {
      const iframe = element.querySelector('iframe');
      if (!iframe || !CONFIG.quickTabPersistAcrossTabs) return;

      const quickTabId = element.dataset.quickTabId;
      if (!quickTabId) return;

      // Save via queue
      saveQuickTabState('update', quickTabId, {
        left: finalLeft,
        top: finalTop,
        width: finalWidth,
        height: finalHeight
      })
        .then(() => {
          debug(
            `Quick Tab ${quickTabId} resize saved: ${finalWidth}x${finalHeight} at (${finalLeft}, ${finalTop})`
          );
        })
        .catch(err => {
          console.error(`Failed to save resize for ${quickTabId}:`, err);
        });
    };

    // =========================
    // POINTER EVENT HANDLERS
    // =========================

    const handlePointerDown = e => {
      if (e.button !== 0) return;

      isResizing = true;
      currentPointerId = e.pointerId;

      // Capture pointer to prevent escape during resize
      handle.setPointerCapture(e.pointerId);

      // Store initial state
      startX = e.clientX;
      startY = e.clientY;
      const rect = element.getBoundingClientRect();
      startWidth = rect.width;
      startHeight = rect.height;
      startLeft = rect.left;
      startTop = rect.top;

      // Create overlay
      resizeOverlay = createResizeOverlay();

      // Reset timing
      lastThrottledSaveTime = performance.now();
      lastDebugLogTime = performance.now();

      if (CONFIG.debugMode) {
        const url = element.querySelector('iframe')?.src || 'unknown';
        debug(
          `[POINTER DOWN] Resize started - Direction: ${direction}, URL: ${url}, Start Size: ${Math.round(startWidth)}x${Math.round(startHeight)}`
        );
      }

      e.preventDefault();
      e.stopPropagation();
    };

    const handlePointerMove = e => {
      if (!isResizing) return;
      if (e.pointerId !== currentPointerId) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      let newWidth = startWidth;
      let newHeight = startHeight;
      let newLeft = startLeft;
      let newTop = startTop;

      // Calculate new dimensions based on resize direction
      if (direction.includes('e')) {
        newWidth = Math.max(minWidth, startWidth + dx);
      }
      if (direction.includes('w')) {
        const maxDx = startWidth - minWidth;
        const constrainedDx = Math.min(dx, maxDx);
        newWidth = startWidth - constrainedDx;
        newLeft = startLeft + constrainedDx;
      }
      if (direction.includes('s')) {
        newHeight = Math.max(minHeight, startHeight + dy);
      }
      if (direction.includes('n')) {
        const maxDy = startHeight - minHeight;
        const constrainedDy = Math.min(dy, maxDy);
        newHeight = startHeight - constrainedDy;
        newTop = startTop + constrainedDy;
      }

      // IMMEDIATE UPDATE (no RAF)
      element.style.width = newWidth + 'px';
      element.style.height = newHeight + 'px';
      element.style.left = newLeft + 'px';
      element.style.top = newTop + 'px';

      // Throttled save during resize
      throttledSaveDuringResize(newWidth, newHeight, newLeft, newTop);

      // Debug logging
      if (CONFIG.debugMode) {
        const now = performance.now();
        if (now - lastDebugLogTime >= DEBUG_LOG_INTERVAL_MS) {
          const url = element.querySelector('iframe')?.src || 'unknown';
          debug(
            `[POINTER MOVE] Resizing - URL: ${url}, Size: ${Math.round(newWidth)}x${Math.round(newHeight)}, Position: (${Math.round(newLeft)}, ${Math.round(newTop)})`
          );
          lastDebugLogTime = now;
        }
      }

      e.preventDefault();
    };

    const handlePointerUp = e => {
      if (!isResizing) return;
      if (e.pointerId !== currentPointerId) return;

      isResizing = false;

      // Get final dimensions
      const rect = element.getBoundingClientRect();
      const finalWidth = rect.width;
      const finalHeight = rect.height;
      const finalLeft = rect.left;
      const finalTop = rect.top;

      // Release capture
      handle.releasePointerCapture(e.pointerId);

      // Remove overlay
      removeResizeOverlay();

      // Final save
      finalSaveOnResizeEnd(finalWidth, finalHeight, finalLeft, finalTop);

      if (CONFIG.debugMode) {
        const url = element.querySelector('iframe')?.src || 'unknown';
        debug(
          `[POINTER UP] Resize ended - URL: ${url}, Final Size: ${Math.round(finalWidth)}x${Math.round(finalHeight)}, Position: (${Math.round(finalLeft)}, ${Math.round(finalTop)})`
        );
      }
    };

    const handlePointerCancel = e => {
      if (!isResizing) return;

      // Handle interruption during resize
      isResizing = false;

      const rect = element.getBoundingClientRect();

      if (currentPointerId !== null) {
        try {
          handle.releasePointerCapture(currentPointerId);
        } catch (err) {
          debug('[POINTER CANCEL] Resize capture already released');
        }
      }

      removeResizeOverlay();

      // Emergency save
      finalSaveOnResizeEnd(rect.width, rect.height, rect.left, rect.top);

      if (CONFIG.debugMode) {
        const url = element.querySelector('iframe')?.src || 'unknown';
        debug(
          `[POINTER CANCEL] Resize cancelled - URL: ${url}, Saved Size: ${Math.round(rect.width)}x${Math.round(rect.height)}`
        );
      }
    };

    // Attach listeners
    handle.addEventListener('pointerdown', handlePointerDown);
    handle.addEventListener('pointermove', handlePointerMove);
    handle.addEventListener('pointerup', handlePointerUp);
    handle.addEventListener('pointercancel', handlePointerCancel);

    element.appendChild(handle);
    resizeHandleElements.push({
      handle,
      handlePointerDown,
      handlePointerMove,
      handlePointerUp,
      handlePointerCancel,
      removeResizeOverlay
    });
  });

  // Store cleanup function
  element._resizeCleanup = () => {
    resizeHandleElements.forEach(
      ({
        handle,
        handlePointerDown,
        handlePointerMove,
        handlePointerUp,
        handlePointerCancel,
        removeResizeOverlay
      }) => {
        removeResizeOverlay();
        handle.removeEventListener('pointerdown', handlePointerDown);
        handle.removeEventListener('pointermove', handlePointerMove);
        handle.removeEventListener('pointerup', handlePointerUp);
        handle.removeEventListener('pointercancel', handlePointerCancel);
        handle.remove();
      }
    );

    if (CONFIG.debugMode) {
      debug('[CLEANUP] Resize event listeners removed');
    }
  };
}
// ==================== END MAKE RESIZABLE ====================

// Check modifiers
// Keyboard handler
document.addEventListener(
  'keydown',
  function (event) {
    // Handle Quick Tab close on Escape
    if (event.key === CONFIG.quickTabCloseKey && quickTabWindows.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      closeAllQuickTabWindows();
      return;
    }

    if (!currentHoveredLink && !currentHoveredElement) return;

    if (
      event.target.tagName === 'INPUT' ||
      event.target.tagName === 'TEXTAREA' ||
      event.target.contentEditable === 'true'
    ) {
      return;
    }

    const key = event.key.toLowerCase();
    const element = currentHoveredLink || currentHoveredElement;
    const domainType = getDomainType();
    const url = findUrl(element, domainType);

    // Open Link in New Tab
    if (
      key === CONFIG.openNewTabKey.toLowerCase() &&
      checkModifiers(CONFIG.openNewTabCtrl, CONFIG.openNewTabAlt, CONFIG.openNewTabShift, event)
    ) {
      event.preventDefault();
      event.stopPropagation();

      if (!url) {
        showNotification('✗ No URL found');
        return;
      }

      debug(`Opening URL in new tab: ${url}`);
      browser.runtime.sendMessage({
        action: 'openTab',
        url: url,
        switchFocus: CONFIG.openNewTabSwitchFocus
      });
      showNotification('✓ Opened in new tab');
    }

    // Quick Tab on Hover
    else if (
      key === CONFIG.quickTabKey.toLowerCase() &&
      checkModifiers(CONFIG.quickTabCtrl, CONFIG.quickTabAlt, CONFIG.quickTabShift, event)
    ) {
      event.preventDefault();
      event.stopPropagation();

      if (!url) {
        showNotification('✗ No URL found');
        return;
      }

      createQuickTabWindow(url);
    }

    // Copy URL
    else if (
      key === CONFIG.copyUrlKey.toLowerCase() &&
      checkModifiers(CONFIG.copyUrlCtrl, CONFIG.copyUrlAlt, CONFIG.copyUrlShift, event)
    ) {
      event.preventDefault();
      event.stopPropagation();

      if (!url) {
        showNotification('✗ No URL found');
        return;
      }

      navigator.clipboard
        .writeText(url)
        .then(() => {
          showNotification('✓ URL copied!', { tooltip: true });
        })
        .catch(() => {
          showNotification('✗ Copy failed');
        });
    }

    // Copy Text
    else if (
      key === CONFIG.copyTextKey.toLowerCase() &&
      checkModifiers(CONFIG.copyTextCtrl, CONFIG.copyTextAlt, CONFIG.copyTextShift, event)
    ) {
      event.preventDefault();
      event.stopPropagation();

      const text = getLinkText(element);

      navigator.clipboard
        .writeText(text)
        .then(() => {
          showNotification('✓ Text copied!');
        })
        .catch(() => {
          showNotification('✗ Copy failed');
        });
    }
  },
  true
);

// Message listener for nested Quick Tabs from iframes
window.addEventListener('message', function (event) {
  // Validate origin - only accept from same origin or about:blank iframes
  const currentOrigin = window.location.origin;
  if (event.origin !== currentOrigin && event.origin !== 'null') {
    debug(`Rejected message from unauthorized origin: ${event.origin}`);
    return;
  }

  // Only accept messages from same origin or our iframes
  if (event.data && event.data.type === 'CREATE_QUICK_TAB') {
    const url = event.data.url;
    if (url) {
      debug(`Received Quick Tab request from iframe: ${url}`);
      createQuickTabWindow(url);
    }
  }
});

// Storage listener
browser.storage.onChanged.addListener(function (changes, areaName) {
  if (areaName === 'local') {
    loadSettings();
  }
});

// Runtime message listener for background script messages
browser.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.action === 'tabActivated') {
    debug('Tab activated, checking for stored Quick Tabs');
    restoreQuickTabsFromStorage();
    sendResponse({ received: true });
  }

  // NEW: Handle real-time position/size updates from background
  if (message.action === 'UPDATE_QUICK_TAB_FROM_BACKGROUND') {
    // Find Quick Tab by ID instead of URL to avoid updating wrong duplicate
    const container = quickTabWindows.find(win => {
      return win.dataset.quickTabId === message.id;
    });

    if (container) {
      // Update position
      if (message.left !== undefined && message.top !== undefined) {
        container.style.left = message.left + 'px';
        container.style.top = message.top + 'px';
      }

      // Update size
      if (message.width !== undefined && message.height !== undefined) {
        container.style.width = message.width + 'px';
        container.style.height = message.height + 'px';
      }

      debug(
        `Updated Quick Tab ${message.url} (ID: ${message.id}) from background: pos(${message.left}, ${message.top}), size(${message.width}x${message.height})`
      );
    }

    sendResponse({ success: true });
  }

  // NEW: Handle Quick Tab close from background
  if (message.action === 'CLOSE_QUICK_TAB_FROM_BACKGROUND') {
    // Find Quick Tab by ID instead of URL to avoid closing wrong duplicate
    const container = quickTabWindows.find(win => {
      return win.dataset.quickTabId === message.id;
    });

    if (container) {
      closeQuickTabWindow(container, false); // false = don't broadcast again
      debug(`Closed Quick Tab ${message.url} (ID: ${message.id}) from background command`);
    }

    sendResponse({ success: true });
  }

  // NEW: Handle clear all Quick Tabs command
  if (message.action === 'CLEAR_ALL_QUICK_TABS') {
    // Close all Quick Tab windows
    while (quickTabWindows.length > 0) {
      closeQuickTabWindow(quickTabWindows[0], false);
    }
    // Clear minimized tabs
    minimizedQuickTabs = [];
    updateMinimizedTabsManager();
    debug('Cleared all Quick Tabs');
    sendResponse({ success: true });
    return true;
  }

  // NEW: Handle minimize command from sidebar
  if (message.action === 'MINIMIZE_QUICK_TAB') {
    const quickTabId = message.quickTabId;
    const container = quickTabWindows.find(w => w.dataset.quickTabId === quickTabId);

    if (container) {
      const iframe = container.querySelector('iframe');
      const url = iframe?.src || iframe?.getAttribute('data-deferred-src');
      const titleEl = container.querySelector('.copy-url-quicktab-titlebar span');
      const title = titleEl?.textContent || 'Quick Tab';

      minimizeQuickTab(container, url, title);
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'Quick Tab not found' });
    }
    return true;
  }

  // NEW: Handle restore command from sidebar
  if (message.action === 'RESTORE_QUICK_TAB') {
    restoreQuickTab(message.quickTabId);
    sendResponse({ success: true });
    return true;
  }

  // NEW: Handle close minimized command from sidebar
  if (message.action === 'CLOSE_MINIMIZED_QUICK_TABS') {
    // Remove minimized tabs from local array (if still using it)
    // Note: With sidebar API, this is mainly for cleanup
    minimizedQuickTabs = [];
    updateMinimizedTabsManager();
    sendResponse({ success: true });
    return true;
  }

  // NEW: Handle close specific Quick Tab from sidebar
  if (message.action === 'CLOSE_QUICK_TAB') {
    const quickTabId = message.quickTabId;
    const container = quickTabWindows.find(w => w.dataset.quickTabId === quickTabId);

    if (container) {
      closeQuickTabWindow(container);
      sendResponse({ success: true });
    } else {
      // Also check in minimized tabs and remove from storage
      const cookieStoreId = await getCurrentCookieStoreId();
      const result = await browser.storage.sync.get('quick_tabs_state_v2');

      if (result && result.quick_tabs_state_v2) {
        const state = result.quick_tabs_state_v2;

        if (state[cookieStoreId] && state[cookieStoreId].tabs) {
          const originalLength = state[cookieStoreId].tabs.length;
          state[cookieStoreId].tabs = state[cookieStoreId].tabs.filter(t => t.id !== quickTabId);

          if (state[cookieStoreId].tabs.length !== originalLength) {
            state[cookieStoreId].timestamp = Date.now();
            await browser.storage.sync.set({ quick_tabs_state_v2: state });
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'Quick Tab not found' });
          }
        }
      } else {
        sendResponse({ success: false, error: 'Quick Tab not found' });
      }
    }
    return true;
  }

  // Handle toggle minimized manager command
  if (message.action === 'TOGGLE_MINIMIZED_MANAGER') {
    // This will be implemented in Phase 2
    // For now, just acknowledge
    debug('Toggle minimized manager command received (not yet implemented)');
    sendResponse({ success: true });
    return true;
  }

  // NEW: Handle full state sync from background on tab activation
  if (message.action === 'SYNC_QUICK_TAB_STATE_FROM_BACKGROUND') {
    const state = message.state;
    if (state && state.tabs) {
      state.tabs.forEach(tab => {
        const container = quickTabWindows.find(win => {
          const iframe = win.querySelector('iframe');
          if (!iframe) return false;
          const iframeSrc = iframe.src || iframe.getAttribute('data-deferred-src');
          return iframeSrc === tab.url;
        });

        if (container) {
          // Update existing Quick Tab
          if (tab.left !== undefined && tab.top !== undefined) {
            container.style.left = tab.left + 'px';
            container.style.top = tab.top + 'px';
          }
          if (tab.width !== undefined && tab.height !== undefined) {
            container.style.width = tab.width + 'px';
            container.style.height = tab.height + 'px';
          }
          debug(`Synced Quick Tab ${tab.url} from background state`);
        }
      });
    }
    sendResponse({ success: true });
  }

  // NEW: Handle toggle Quick Tabs Panel command from background script
  if (message.action === 'TOGGLE_QUICK_TABS_PANEL') {
    toggleQuickTabsPanel();
    sendResponse({ success: true });
    return true;
  }

  return true; // Keep channel open for async response
});

// ==================== QUICK TABS MANAGER PANEL HTML/CSS ====================
// HTML template for floating panel (embedded inline for easy injection)
const PANEL_HTML = `
<div id="quick-tabs-manager-panel" class="quick-tabs-manager-panel" style="display: none;">
  <div class="panel-header">
    <span class="panel-drag-handle">≡</span>
    <h2 class="panel-title">Quick Tabs Manager</h2>
    <div class="panel-controls">
      <button class="panel-btn panel-minimize" title="Minimize Panel">−</button>
      <button class="panel-btn panel-close" title="Close Panel">✕</button>
    </div>
  </div>
  
  <div class="panel-actions">
    <button id="panel-closeMinimized" class="panel-btn-secondary" title="Close all minimized Quick Tabs">
      Close Minimized
    </button>
    <button id="panel-closeAll" class="panel-btn-danger" title="Close all Quick Tabs">
      Close All
    </button>
  </div>
  
  <div class="panel-stats">
    <span id="panel-totalTabs">0 Quick Tabs</span>
    <span id="panel-lastSync">Last sync: Never</span>
  </div>
  
  <div id="panel-containersList" class="panel-containers-list">
    <!-- Dynamically populated -->
  </div>
  
  <div id="panel-emptyState" class="panel-empty-state" style="display: none;">
    <div class="empty-icon">📭</div>
    <div class="empty-text">No Quick Tabs</div>
    <div class="empty-hint">Press Q while hovering over a link</div>
  </div>
</div>
`;

// CSS template for floating panel
const PANEL_CSS = `
/* Quick Tabs Manager Floating Panel Styles */

.quick-tabs-manager-panel {
  position: fixed;
  top: 100px;
  right: 20px;
  width: 350px;
  height: 500px;
  background: #2d2d2d;
  border: 2px solid #555;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  z-index: 999999999; /* Above all Quick Tabs */
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  color: #e0e0e0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 250px;
  min-height: 300px;
}

/* Panel Header (draggable) */
.panel-header {
  background: #1e1e1e;
  border-bottom: 1px solid #555;
  padding: 10px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: grab;
  user-select: none;
}

.panel-header:active {
  cursor: grabbing;
}

.panel-drag-handle {
  font-size: 18px;
  color: #888;
  cursor: grab;
}

.panel-title {
  flex: 1;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.panel-controls {
  display: flex;
  gap: 4px;
}

.panel-btn {
  width: 24px;
  height: 24px;
  background: transparent;
  color: #e0e0e0;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.panel-btn:hover {
  background: #444;
}

.panel-close:hover {
  background: #ff5555;
}

/* Panel Actions */
.panel-actions {
  padding: 10px 12px;
  background: #2d2d2d;
  border-bottom: 1px solid #555;
  display: flex;
  gap: 8px;
}

.panel-btn-secondary,
.panel-btn-danger {
  flex: 1;
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: opacity 0.2s;
}

.panel-btn-secondary {
  background: #4a90e2;
  color: white;
}

.panel-btn-secondary:hover {
  opacity: 0.8;
}

.panel-btn-danger {
  background: #f44336;
  color: white;
}

.panel-btn-danger:hover {
  opacity: 0.8;
}

/* Panel Stats */
.panel-stats {
  padding: 8px 12px;
  background: #1e1e1e;
  border-bottom: 1px solid #555;
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #999;
}

/* Containers List */
.panel-containers-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px 0;
}

/* Container Section */
.panel-container-section {
  margin-bottom: 16px;
}

.panel-container-header {
  padding: 8px 12px;
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  background: #1e1e1e;
  border-top: 1px solid #555;
  border-bottom: 1px solid #555;
  display: flex;
  align-items: center;
  gap: 6px;
}

.panel-container-icon {
  font-size: 14px;
}

.panel-container-count {
  margin-left: auto;
  font-weight: normal;
  color: #999;
  font-size: 11px;
}

/* Quick Tab Items */
.panel-quick-tab-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #555;
  transition: background 0.2s;
  cursor: pointer;
}

.panel-quick-tab-item:hover {
  background: #3a3a3a;
}

.panel-quick-tab-item.active {
  border-left: 3px solid #4CAF50;
  padding-left: 9px;
}

.panel-quick-tab-item.minimized {
  border-left: 3px solid #FFC107;
  padding-left: 9px;
}

.panel-status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.panel-status-indicator.green {
  background: #4CAF50;
}

.panel-status-indicator.yellow {
  background: #FFC107;
}

.panel-favicon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.panel-tab-info {
  flex: 1;
  min-width: 0;
}

.panel-tab-title {
  font-weight: 500;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.panel-tab-meta {
  font-size: 10px;
  color: #999;
  margin-top: 2px;
}

.panel-tab-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.panel-btn-icon {
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 4px;
  font-size: 12px;
  transition: background 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.panel-btn-icon:hover {
  background: #555;
}

/* Empty State */
.panel-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
  color: #999;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
}

.empty-text {
  font-size: 16px;
  font-weight: 500;
  margin-bottom: 8px;
}

.empty-hint {
  font-size: 12px;
}

/* Resize Handles */
.panel-resize-handle {
  position: absolute;
  z-index: 10;
}

.panel-resize-handle.n { top: 0; left: 10px; right: 10px; height: 10px; cursor: n-resize; }
.panel-resize-handle.s { bottom: 0; left: 10px; right: 10px; height: 10px; cursor: s-resize; }
.panel-resize-handle.e { right: 0; top: 10px; bottom: 10px; width: 10px; cursor: e-resize; }
.panel-resize-handle.w { left: 0; top: 10px; bottom: 10px; width: 10px; cursor: w-resize; }
.panel-resize-handle.ne { top: 0; right: 0; width: 10px; height: 10px; cursor: ne-resize; }
.panel-resize-handle.nw { top: 0; left: 0; width: 10px; height: 10px; cursor: nw-resize; }
.panel-resize-handle.se { bottom: 0; right: 0; width: 10px; height: 10px; cursor: se-resize; }
.panel-resize-handle.sw { bottom: 0; left: 0; width: 10px; height: 10px; cursor: sw-resize; }

/* Scrollbar Styling */
.panel-containers-list::-webkit-scrollbar {
  width: 8px;
}

.panel-containers-list::-webkit-scrollbar-track {
  background: #1e1e1e;
}

.panel-containers-list::-webkit-scrollbar-thumb {
  background: #555;
  border-radius: 4px;
}

.panel-containers-list::-webkit-scrollbar-thumb:hover {
  background: #666;
}
`;
// ==================== END QUICK TABS MANAGER PANEL HTML/CSS ====================

// ==================== QUICK TABS MANAGER PANEL INJECTION ====================
// State
let quickTabsPanel = null;
let isPanelOpen = false;
let panelState = {
  left: 20,
  top: 100,
  width: 350,
  height: 500,
  isOpen: false
};

/**
 * Create and inject the Quick Tabs Manager panel into the page
 */
function createQuickTabsPanel() {
  // Check if panel already exists
  if (quickTabsPanel) {
    debug('[Panel] Panel already exists');
    return;
  }

  // Inject CSS
  const style = document.createElement('style');
  style.id = 'quick-tabs-manager-panel-styles';
  style.textContent = PANEL_CSS;
  document.head.appendChild(style);

  // Create panel container
  const container = document.createElement('div');
  container.innerHTML = PANEL_HTML;
  const panel = container.firstElementChild;

  // Load saved panel state from storage
  browser.storage.local.get('quick_tabs_panel_state').then(result => {
    if (result && result.quick_tabs_panel_state) {
      panelState = { ...panelState, ...result.quick_tabs_panel_state };

      // Apply saved position and size
      panel.style.left = panelState.left + 'px';
      panel.style.top = panelState.top + 'px';
      panel.style.width = panelState.width + 'px';
      panel.style.height = panelState.height + 'px';

      // Show panel if it was open before
      if (panelState.isOpen) {
        panel.style.display = 'flex';
        isPanelOpen = true;
      }
    }
  });

  // Append to body
  document.documentElement.appendChild(panel);
  quickTabsPanel = panel;

  // Make draggable
  const header = panel.querySelector('.panel-header');
  makePanelDraggable(panel, header);

  // Make resizable
  makePanelResizable(panel);

  // Setup panel event listeners
  setupPanelEventListeners(panel);

  // Initialize panel content
  updatePanelContent();

  // Auto-refresh every 2 seconds
  setInterval(updatePanelContent, 2000);

  debug('[Panel] Quick Tabs Manager panel created and injected');
}

/**
 * Toggle panel visibility
 */
function toggleQuickTabsPanel() {
  if (!quickTabsPanel) {
    createQuickTabsPanel();
  }

  if (isPanelOpen) {
    // Hide panel
    quickTabsPanel.style.display = 'none';
    isPanelOpen = false;
    panelState.isOpen = false;
  } else {
    // Show panel
    quickTabsPanel.style.display = 'flex';
    isPanelOpen = true;
    panelState.isOpen = true;

    // Bring to front
    quickTabsPanel.style.zIndex = '999999999';

    // Update content immediately
    updatePanelContent();
  }

  // Save state
  savePanelState();

  debug(`[Panel] Panel toggled: ${isPanelOpen ? 'OPEN' : 'CLOSED'}`);
}

/**
 * Save panel state to browser.storage.local
 */
function savePanelState() {
  if (!quickTabsPanel) return;

  const rect = quickTabsPanel.getBoundingClientRect();

  panelState = {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    isOpen: isPanelOpen
  };

  browser.storage.local.set({ quick_tabs_panel_state: panelState }).catch(err => {
    debug('[Panel] Error saving panel state:', err);
  });
}
// ==================== END QUICK TABS MANAGER PANEL INJECTION ====================

// ==================== PANEL DRAG IMPLEMENTATION ====================
/**
 * Make panel draggable using Pointer Events API
 * @param {HTMLElement} panel - The panel container
 * @param {HTMLElement} handle - The drag handle (header)
 */
function makePanelDraggable(panel, handle) {
  let isDragging = false;
  let offsetX = 0,
    offsetY = 0;
  let currentPointerId = null;

  const handlePointerDown = e => {
    if (e.button !== 0) return; // Only left click
    if (e.target.classList.contains('panel-btn')) return; // Ignore buttons

    isDragging = true;
    currentPointerId = e.pointerId;

    // Capture pointer
    handle.setPointerCapture(e.pointerId);

    // Calculate offset
    const rect = panel.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;

    handle.style.cursor = 'grabbing';
    e.preventDefault();
  };

  const handlePointerMove = e => {
    if (!isDragging || e.pointerId !== currentPointerId) return;

    // Calculate new position
    const newLeft = e.clientX - offsetX;
    const newTop = e.clientY - offsetY;

    // Apply position
    panel.style.left = newLeft + 'px';
    panel.style.top = newTop + 'px';

    e.preventDefault();
  };

  const handlePointerUp = e => {
    if (!isDragging || e.pointerId !== currentPointerId) return;

    isDragging = false;
    handle.releasePointerCapture(e.pointerId);
    handle.style.cursor = 'grab';

    // Save final position
    savePanelState();
  };

  const handlePointerCancel = e => {
    if (!isDragging) return;

    isDragging = false;
    handle.style.cursor = 'grab';

    // Save position
    savePanelState();
  };

  // Attach listeners
  handle.addEventListener('pointerdown', handlePointerDown);
  handle.addEventListener('pointermove', handlePointerMove);
  handle.addEventListener('pointerup', handlePointerUp);
  handle.addEventListener('pointercancel', handlePointerCancel);
}
// ==================== END PANEL DRAG IMPLEMENTATION ====================

// ==================== PANEL RESIZE IMPLEMENTATION ====================
/**
 * Make panel resizable from all edges/corners
 * @param {HTMLElement} panel - The panel container
 */
function makePanelResizable(panel) {
  const minWidth = 250;
  const minHeight = 300;
  const handleSize = 10;

  // Define resize handles
  const handles = {
    n: { cursor: 'n-resize', top: 0, left: handleSize, right: handleSize, height: handleSize },
    s: { cursor: 's-resize', bottom: 0, left: handleSize, right: handleSize, height: handleSize },
    e: { cursor: 'e-resize', right: 0, top: handleSize, bottom: handleSize, width: handleSize },
    w: { cursor: 'w-resize', left: 0, top: handleSize, bottom: handleSize, width: handleSize },
    ne: { cursor: 'ne-resize', top: 0, right: 0, width: handleSize, height: handleSize },
    nw: { cursor: 'nw-resize', top: 0, left: 0, width: handleSize, height: handleSize },
    se: { cursor: 'se-resize', bottom: 0, right: 0, width: handleSize, height: handleSize },
    sw: { cursor: 'sw-resize', bottom: 0, left: 0, width: handleSize, height: handleSize }
  };

  Object.entries(handles).forEach(([direction, style]) => {
    const handle = document.createElement('div');
    handle.className = `panel-resize-handle ${direction}`;
    handle.style.cssText = `
      position: absolute;
      ${style.top !== undefined ? `top: ${style.top}px;` : ''}
      ${style.bottom !== undefined ? `bottom: ${style.bottom}px;` : ''}
      ${style.left !== undefined ? `left: ${style.left}px;` : ''}
      ${style.right !== undefined ? `right: ${style.right}px;` : ''}
      ${style.width ? `width: ${style.width}px;` : ''}
      ${style.height ? `height: ${style.height}px;` : ''}
      cursor: ${style.cursor};
      z-index: 10;
    `;

    let isResizing = false;
    let currentPointerId = null;
    let startX, startY, startWidth, startHeight, startLeft, startTop;

    const handlePointerDown = e => {
      if (e.button !== 0) return;

      isResizing = true;
      currentPointerId = e.pointerId;
      handle.setPointerCapture(e.pointerId);

      startX = e.clientX;
      startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      startWidth = rect.width;
      startHeight = rect.height;
      startLeft = rect.left;
      startTop = rect.top;

      e.preventDefault();
      e.stopPropagation();
    };

    const handlePointerMove = e => {
      if (!isResizing || e.pointerId !== currentPointerId) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      let newWidth = startWidth;
      let newHeight = startHeight;
      let newLeft = startLeft;
      let newTop = startTop;

      // Calculate new dimensions based on direction
      if (direction.includes('e')) {
        newWidth = Math.max(minWidth, startWidth + dx);
      }
      if (direction.includes('w')) {
        const maxDx = startWidth - minWidth;
        const constrainedDx = Math.min(dx, maxDx);
        newWidth = startWidth - constrainedDx;
        newLeft = startLeft + constrainedDx;
      }
      if (direction.includes('s')) {
        newHeight = Math.max(minHeight, startHeight + dy);
      }
      if (direction.includes('n')) {
        const maxDy = startHeight - minHeight;
        const constrainedDy = Math.min(dy, maxDy);
        newHeight = startHeight - constrainedDy;
        newTop = startTop + constrainedDy;
      }

      // Apply new dimensions
      panel.style.width = newWidth + 'px';
      panel.style.height = newHeight + 'px';
      panel.style.left = newLeft + 'px';
      panel.style.top = newTop + 'px';

      e.preventDefault();
    };

    const handlePointerUp = e => {
      if (!isResizing || e.pointerId !== currentPointerId) return;

      isResizing = false;
      handle.releasePointerCapture(e.pointerId);

      // Save final size/position
      savePanelState();
    };

    const handlePointerCancel = e => {
      if (!isResizing) return;

      isResizing = false;
      savePanelState();
    };

    // Attach listeners
    handle.addEventListener('pointerdown', handlePointerDown);
    handle.addEventListener('pointermove', handlePointerMove);
    handle.addEventListener('pointerup', handlePointerUp);
    handle.addEventListener('pointercancel', handlePointerCancel);

    panel.appendChild(handle);
  });
}
// ==================== END PANEL RESIZE IMPLEMENTATION ====================

// ==================== PANEL EVENT LISTENERS ====================
/**
 * Setup event listeners for panel buttons and interactions
 * @param {HTMLElement} panel - The panel container
 */
function setupPanelEventListeners(panel) {
  // Close button
  const closeBtn = panel.querySelector('.panel-close');
  closeBtn.addEventListener('click', e => {
    e.stopPropagation();
    toggleQuickTabsPanel(); // Close panel
  });

  // Minimize button (same as close for now)
  const minimizeBtn = panel.querySelector('.panel-minimize');
  minimizeBtn.addEventListener('click', e => {
    e.stopPropagation();
    toggleQuickTabsPanel(); // Hide panel
  });

  // Close Minimized button
  const closeMinimizedBtn = panel.querySelector('#panel-closeMinimized');
  closeMinimizedBtn.addEventListener('click', async e => {
    e.stopPropagation();
    await closeMinimizedTabsFromPanel();
  });

  // Close All button
  const closeAllBtn = panel.querySelector('#panel-closeAll');
  closeAllBtn.addEventListener('click', async e => {
    e.stopPropagation();
    await closeAllTabsFromPanel();
  });

  // Delegated listener for Quick Tab item actions
  const containersList = panel.querySelector('#panel-containersList');
  containersList.addEventListener('click', async e => {
    const button = e.target.closest('button[data-action]');
    if (!button) return;

    e.stopPropagation();

    const action = button.dataset.action;
    const quickTabId = button.dataset.quickTabId;
    const tabId = button.dataset.tabId;

    switch (action) {
      case 'goToTab':
        await browser.tabs.update(parseInt(tabId), { active: true });
        break;
      case 'minimize':
        await minimizeQuickTabFromPanel(quickTabId);
        break;
      case 'restore':
        await restoreQuickTabFromPanel(quickTabId);
        break;
      case 'close':
        await closeQuickTabFromPanel(quickTabId);
        break;
    }
  });
}

/**
 * Close minimized tabs from panel
 */
async function closeMinimizedTabsFromPanel() {
  try {
    const result = await browser.storage.sync.get('quick_tabs_state_v2');
    if (!result || !result.quick_tabs_state_v2) return;

    const state = result.quick_tabs_state_v2;
    let hasChanges = false;

    Object.keys(state).forEach(cookieStoreId => {
      if (state[cookieStoreId] && state[cookieStoreId].tabs) {
        const originalLength = state[cookieStoreId].tabs.length;
        state[cookieStoreId].tabs = state[cookieStoreId].tabs.filter(t => !t.minimized);

        if (state[cookieStoreId].tabs.length !== originalLength) {
          hasChanges = true;
          state[cookieStoreId].timestamp = Date.now();
        }
      }
    });

    if (hasChanges) {
      await browser.storage.sync.set({ quick_tabs_state_v2: state });
      debug('[Panel] Closed all minimized Quick Tabs');
    }
  } catch (err) {
    console.error('[Panel] Error closing minimized tabs:', err);
  }
}

/**
 * Close all tabs from panel
 */
async function closeAllTabsFromPanel() {
  try {
    await browser.storage.sync.remove('quick_tabs_state_v2');

    // Notify all tabs
    const tabs = await browser.tabs.query({});
    tabs.forEach(tab => {
      browser.tabs
        .sendMessage(tab.id, {
          action: 'CLEAR_ALL_QUICK_TABS'
        })
        .catch(() => {});
    });

    debug('[Panel] Closed all Quick Tabs');
  } catch (err) {
    console.error('[Panel] Error closing all tabs:', err);
  }
}

/**
 * Minimize Quick Tab from panel
 */
async function minimizeQuickTabFromPanel(quickTabId) {
  const container = quickTabWindows.find(w => w.dataset.quickTabId === quickTabId);
  if (container) {
    const iframe = container.querySelector('iframe');
    const url = iframe?.src || iframe?.getAttribute('data-deferred-src');
    const titleEl = container.querySelector('.copy-url-quicktab-titlebar span');
    const title = titleEl?.textContent || 'Quick Tab';

    minimizeQuickTab(container, url, title);
  }
}

/**
 * Restore Quick Tab from panel
 */
async function restoreQuickTabFromPanel(quickTabId) {
  restoreQuickTab(quickTabId);
}

/**
 * Close Quick Tab from panel
 */
async function closeQuickTabFromPanel(quickTabId) {
  const container = quickTabWindows.find(w => w.dataset.quickTabId === quickTabId);
  if (container) {
    closeQuickTabWindow(container);
  }
}
// ==================== END PANEL EVENT LISTENERS ====================

// ==================== PANEL CONTENT UPDATE ====================
/**
 * Update panel content with current Quick Tabs state
 * Reuses logic from sidebar/quick-tabs-manager.js
 */
async function updatePanelContent() {
  if (!quickTabsPanel || !isPanelOpen) return;

  const totalTabsEl = quickTabsPanel.querySelector('#panel-totalTabs');
  const lastSyncEl = quickTabsPanel.querySelector('#panel-lastSync');
  const containersList = quickTabsPanel.querySelector('#panel-containersList');
  const emptyState = quickTabsPanel.querySelector('#panel-emptyState');

  // Load Quick Tabs state
  let quickTabsState = {};
  try {
    const result = await browser.storage.sync.get('quick_tabs_state_v2');
    if (result && result.quick_tabs_state_v2) {
      quickTabsState = result.quick_tabs_state_v2;
    }
  } catch (err) {
    debug('[Panel] Error loading Quick Tabs state:', err);
    return;
  }

  // Calculate totals
  let totalTabs = 0;
  let latestTimestamp = 0;

  Object.keys(quickTabsState).forEach(cookieStoreId => {
    const containerState = quickTabsState[cookieStoreId];
    if (containerState && containerState.tabs) {
      totalTabs += containerState.tabs.length;
      if (containerState.timestamp > latestTimestamp) {
        latestTimestamp = containerState.timestamp;
      }
    }
  });

  // Update stats
  totalTabsEl.textContent = `${totalTabs} Quick Tab${totalTabs !== 1 ? 's' : ''}`;

  if (latestTimestamp > 0) {
    const date = new Date(latestTimestamp);
    lastSyncEl.textContent = `Last sync: ${date.toLocaleTimeString()}`;
  } else {
    lastSyncEl.textContent = 'Last sync: Never';
  }

  // Show/hide empty state
  if (totalTabs === 0) {
    containersList.style.display = 'none';
    emptyState.style.display = 'flex';
    return;
  } else {
    containersList.style.display = 'block';
    emptyState.style.display = 'none';
  }

  // Load container info
  let containersData = {};
  try {
    if (typeof browser.contextualIdentities !== 'undefined') {
      const containers = await browser.contextualIdentities.query({});
      containers.forEach(container => {
        containersData[container.cookieStoreId] = {
          name: container.name,
          icon: getContainerIconForPanel(container.icon),
          color: container.color
        };
      });
    }

    // Always add default container
    containersData['firefox-default'] = {
      name: 'Default',
      icon: '📁',
      color: 'grey'
    };
  } catch (err) {
    debug('[Panel] Error loading container info:', err);
  }

  // Clear and rebuild containers list
  containersList.innerHTML = '';

  // Sort containers
  const sortedContainers = Object.keys(containersData).sort((a, b) => {
    if (a === 'firefox-default') return -1;
    if (b === 'firefox-default') return 1;
    return containersData[a].name.localeCompare(containersData[b].name);
  });

  sortedContainers.forEach(cookieStoreId => {
    const containerInfo = containersData[cookieStoreId];
    const containerState = quickTabsState[cookieStoreId];

    if (!containerState || !containerState.tabs || containerState.tabs.length === 0) {
      return; // Skip empty containers
    }

    renderPanelContainerSection(containersList, cookieStoreId, containerInfo, containerState);
  });
}

/**
 * Get container icon for panel (emoji)
 */
function getContainerIconForPanel(icon) {
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
 * Render container section in panel
 */
function renderPanelContainerSection(containersList, cookieStoreId, containerInfo, containerState) {
  const section = document.createElement('div');
  section.className = 'panel-container-section';

  // Header
  const header = document.createElement('h3');
  header.className = 'panel-container-header';
  header.innerHTML = `
    <span class="panel-container-icon">${containerInfo.icon}</span>
    <span class="panel-container-name">${containerInfo.name}</span>
    <span class="panel-container-count">(${containerState.tabs.length} tab${containerState.tabs.length !== 1 ? 's' : ''})</span>
  `;

  section.appendChild(header);

  // Tabs
  const activeTabs = containerState.tabs.filter(t => !t.minimized);
  const minimizedTabs = containerState.tabs.filter(t => t.minimized);

  activeTabs.forEach(tab => {
    section.appendChild(renderPanelQuickTabItem(tab, false));
  });

  minimizedTabs.forEach(tab => {
    section.appendChild(renderPanelQuickTabItem(tab, true));
  });

  containersList.appendChild(section);
}

/**
 * Render Quick Tab item in panel
 */
function renderPanelQuickTabItem(tab, isMinimized) {
  const item = document.createElement('div');
  item.className = `panel-quick-tab-item ${isMinimized ? 'minimized' : 'active'}`;

  // Indicator
  const indicator = document.createElement('span');
  indicator.className = `panel-status-indicator ${isMinimized ? 'yellow' : 'green'}`;

  // Favicon
  const favicon = document.createElement('img');
  favicon.className = 'panel-favicon';
  try {
    const urlObj = new URL(tab.url);
    favicon.src = `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
    favicon.onerror = () => (favicon.style.display = 'none');
  } catch (e) {
    favicon.style.display = 'none';
  }

  // Info
  const info = document.createElement('div');
  info.className = 'panel-tab-info';

  const title = document.createElement('div');
  title.className = 'panel-tab-title';
  title.textContent = tab.title || 'Quick Tab';

  const meta = document.createElement('div');
  meta.className = 'panel-tab-meta';

  let metaParts = [];
  if (isMinimized) metaParts.push('Minimized');
  if (tab.activeTabId) metaParts.push(`Tab ${tab.activeTabId}`);
  if (tab.width && tab.height) metaParts.push(`${Math.round(tab.width)}×${Math.round(tab.height)}`);
  meta.textContent = metaParts.join(' • ');

  info.appendChild(title);
  info.appendChild(meta);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'panel-tab-actions';

  if (!isMinimized) {
    // Go to Tab button
    if (tab.activeTabId) {
      const goToBtn = document.createElement('button');
      goToBtn.className = 'panel-btn-icon';
      goToBtn.textContent = '🔗';
      goToBtn.title = 'Go to Tab';
      goToBtn.dataset.action = 'goToTab';
      goToBtn.dataset.tabId = tab.activeTabId;
      actions.appendChild(goToBtn);
    }

    // Minimize button
    const minBtn = document.createElement('button');
    minBtn.className = 'panel-btn-icon';
    minBtn.textContent = '➖';
    minBtn.title = 'Minimize';
    minBtn.dataset.action = 'minimize';
    minBtn.dataset.quickTabId = tab.id;
    actions.appendChild(minBtn);
  } else {
    // Restore button
    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'panel-btn-icon';
    restoreBtn.textContent = '↑';
    restoreBtn.title = 'Restore';
    restoreBtn.dataset.action = 'restore';
    restoreBtn.dataset.quickTabId = tab.id;
    actions.appendChild(restoreBtn);
  }

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'panel-btn-icon';
  closeBtn.textContent = '✕';
  closeBtn.title = 'Close';
  closeBtn.dataset.action = 'close';
  closeBtn.dataset.quickTabId = tab.id;
  actions.appendChild(closeBtn);

  // Assemble
  item.appendChild(indicator);
  item.appendChild(favicon);
  item.appendChild(info);
  item.appendChild(actions);

  return item;
}
// ==================== END PANEL CONTENT UPDATE ====================

// Initialize
loadSettings();

// Initialize BroadcastChannel for cross-tab sync
initializeBroadcastChannel();

// Restore Quick Tabs from localStorage on page load
// Only restore if no Quick Tabs currently exist and persistence is enabled
if (quickTabWindows.length === 0 && minimizedQuickTabs.length === 0) {
  setTimeout(() => {
    restoreQuickTabsFromStorage();
  }, 100); // Small delay to ensure page is ready
}

// ==================== MEDIA PLAYBACK CONTROL ====================
// Pause/resume media in Quick Tab iframes when page visibility changes
// This prevents videos/audio from playing in background tabs

function pauseMediaInIframe(iframe) {
  try {
    // Try to access iframe content (will fail for cross-origin)
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) return;

    // Pause all video and audio elements
    const videos = iframeDoc.querySelectorAll('video');
    const audios = iframeDoc.querySelectorAll('audio');

    videos.forEach(video => {
      if (!video.paused) {
        video.pause();
        // Mark that we paused it so we can resume later
        video.dataset.pausedByExtension = 'true';
      }
    });

    audios.forEach(audio => {
      if (!audio.paused) {
        audio.pause();
        audio.dataset.pausedByExtension = 'true';
      }
    });

    debug(`Paused media in Quick Tab iframe: ${iframe.src}`);
  } catch (err) {
    // Cross-origin iframe - can't control media directly
    // As a fallback, we can try to send a postMessage to the iframe
    // but this requires the iframe to implement a listener
    debug(`Cannot pause media in cross-origin iframe: ${iframe.src}`);
  }
}

function resumeMediaInIframe(iframe) {
  try {
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) return;

    // Resume videos and audios that we paused
    const videos = iframeDoc.querySelectorAll('video[data-paused-by-extension="true"]');
    const audios = iframeDoc.querySelectorAll('audio[data-paused-by-extension="true"]');

    videos.forEach(video => {
      video.play().catch(() => {
        // Autoplay might be blocked, ignore error
      });
      delete video.dataset.pausedByExtension;
    });

    audios.forEach(audio => {
      audio.play().catch(() => {
        // Autoplay might be blocked, ignore error
      });
      delete audio.dataset.pausedByExtension;
    });

    debug(`Resumed media in Quick Tab iframe: ${iframe.src}`);
  } catch (err) {
    debug(`Cannot resume media in cross-origin iframe: ${iframe.src}`);
  }
}

function pauseAllQuickTabMedia() {
  quickTabWindows.forEach(container => {
    const iframe = container.querySelector('iframe');
    if (iframe) {
      pauseMediaInIframe(iframe);
    }
  });
}

function resumeAllQuickTabMedia() {
  quickTabWindows.forEach(container => {
    const iframe = container.querySelector('iframe');
    if (iframe) {
      resumeMediaInIframe(iframe);
    }
  });
}

// Listen for page visibility changes
// ==================== VISIBILITY CHANGE HANDLER ====================
// CRITICAL FOR ISSUE #51: Force save when user switches tabs
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Page is now hidden (user switched to another tab)
    debug('[VISIBILITY] Page hidden - pausing media and force-saving state');
    pauseAllQuickTabMedia();

    // FORCE SAVE: Ensure all Quick Tab positions/sizes are saved before tab becomes inactive
    // This prevents position loss when user switches tabs during or immediately after drag
    if (CONFIG.quickTabPersistAcrossTabs && quickTabWindows.length > 0) {
      quickTabWindows.forEach(container => {
        const iframe = container.querySelector('iframe');
        const rect = container.getBoundingClientRect();
        const url = iframe?.src || iframe?.getAttribute('data-deferred-src');
        const quickTabId = container.dataset.quickTabId;

        if (url && quickTabId) {
          // Send to background immediately (don't wait for throttle)
          sendRuntimeMessage({
            action: 'UPDATE_QUICK_TAB_POSITION',
            id: quickTabId,
            url: url,
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            source: 'visibilitychange' // Mark source for debugging
          }).catch(err => {
            debug('[VISIBILITY] Error sending emergency save to background:', err);
          });
        }
      });

      debug(
        `[VISIBILITY] Emergency saved ${quickTabWindows.length} Quick Tab positions before tab switch`
      );
    }
  } else {
    // Page is now visible (user switched back to this tab)
    debug('[VISIBILITY] Page visible - resuming media');
    resumeAllQuickTabMedia();
  }
});
// ==================== END VISIBILITY CHANGE HANDLER ====================

// Also pause media when window loses focus (additional safety)
window.addEventListener('blur', () => {
  debug('Window blur - pausing media in Quick Tabs');
  pauseAllQuickTabMedia();
});

window.addEventListener('focus', () => {
  debug('Window focus - resuming media in Quick Tabs');
  resumeAllQuickTabMedia();
});

// ==================== END MEDIA PLAYBACK CONTROL ====================

// ==================== INITIALIZE PANEL ON PAGE LOAD ====================
// Create panel when page loads (hidden by default)
// Panel will be shown when user presses Ctrl+Alt+Z
window.addEventListener('load', () => {
  // Small delay to ensure page is fully loaded
  setTimeout(() => {
    createQuickTabsPanel();
  }, 500);
});
// ==================== END INITIALIZE PANEL ====================

debug('Extension loaded - supports 100+ websites with site-specific optimized handlers');
