/**
 * Copy URL on Hover - Enhanced with Quick Tabs
 * Main Content Script Entry Point (Hybrid Architecture v1.5.9.3)
 *
 * This file serves as the main entry point and coordinates between modules.
 * URL handlers have been extracted to features/url-handlers/ for better maintainability.
 *
 * v1.5.9.3 Changes:
 * - Added console interceptor for comprehensive log capture
 * - Fixed log export "No logs found" issue by capturing all console.log() calls
 * - Console interceptor must be imported FIRST to capture all subsequent logs
 *
 * v1.5.8.10 Changes:
 * - Implemented Hybrid Modular/EventBus Architecture (Architecture #10)
 * - Moved dom.js and browser-api.js from utils/ to core/
 * - Created modular CSS files in ui/css/ (base.css, notifications.css, quick-tabs.css)
 * - Extracted notification logic into separate toast.js and tooltip.js modules
 * - Renamed quick-tab-window.js to window.js following architecture guidelines
 * - Enhanced EventBus integration for all features
 * - Follows hybrid-architecture-implementation.md
 */

// ✅ CRITICAL: Import console interceptor FIRST to capture all logs
// This MUST be imported before any other modules to capture their logs
// eslint-disable-next-line import/order
import { getConsoleLogs, getBufferStats, clearConsoleLogs } from './utils/console-interceptor.js';

// CRITICAL: Early detection marker - must execute first
console.log('[Copy-URL-on-Hover] Script loaded! @', new Date().toISOString());
try {
  window.CUO_debug_marker = 'JS executed to top of file!';
  console.log('[Copy-URL-on-Hover] Debug marker set successfully');
} catch (e) {
  console.error('[Copy-URL-on-Hover] CRITICAL: Failed to set window marker', e);
}

// Global error handler to catch all unhandled errors
window.addEventListener('error', event => {
  console.error('[Copy-URL-on-Hover] GLOBAL ERROR:', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error,
    stack: event.error?.stack
  });
});

// Unhandled promise rejection handler
window.addEventListener('unhandledrejection', event => {
  console.error('[Copy-URL-on-Hover] UNHANDLED PROMISE REJECTION:', {
    reason: event.reason,
    promise: event.promise
  });
});

console.log('[Copy-URL-on-Hover] Global error handlers installed');

// Import core modules
console.log('[Copy-URL-on-Hover] Starting module imports...');
import { copyToClipboard, sendMessageToBackground } from './core/browser-api.js';
import { ConfigManager, CONSTANTS, DEFAULT_CONFIG } from './core/config.js';
import { EventBus, Events } from './core/events.js';
import { StateManager } from './core/state.js';
import { initNotifications } from './features/notifications/index.js';
import { initQuickTabs } from './features/quick-tabs/index.js';
import { getLinkText } from './features/url-handlers/generic.js';
import { URLHandlerRegistry } from './features/url-handlers/index.js';
import { clearLogBuffer, debug, enableDebug, getLogBuffer } from './utils/debug.js';

console.log('[Copy-URL-on-Hover] All module imports completed successfully');

// Initialize core systems
console.log('[Copy-URL-on-Hover] Initializing core systems...');
const configManager = new ConfigManager();
console.log('[Copy-URL-on-Hover] ConfigManager initialized');
const stateManager = new StateManager();
console.log('[Copy-URL-on-Hover] StateManager initialized');
const eventBus = new EventBus();
console.log('[Copy-URL-on-Hover] EventBus initialized');
const urlRegistry = new URLHandlerRegistry();
console.log('[Copy-URL-on-Hover] URLHandlerRegistry initialized');

// Feature managers (initialized after config is loaded)
let quickTabsManager = null;
let notificationManager = null;

// Load configuration
let CONFIG = { ...DEFAULT_CONFIG };

// Initialize extension
(async function initExtension() {
  try {
    console.log('[Copy-URL-on-Hover] STEP: Starting extension initialization...');

    console.log('[Copy-URL-on-Hover] STEP: Loading user configuration...');
    // Load user configuration with defensive error handling
    try {
      CONFIG = await configManager.load();
      console.log('[Copy-URL-on-Hover] ✓ Configuration loaded successfully');
      console.log('[Copy-URL-on-Hover] Config values:', {
        debugMode: CONFIG.debugMode,
        quickTabPersistAcrossTabs: CONFIG.quickTabPersistAcrossTabs,
        // Log a few key config values for debugging
        hasDefaultConfig: CONFIG !== null && CONFIG !== undefined
      });
    } catch (configErr) {
      console.error('[Copy-URL-on-Hover] ERROR: Failed to load configuration:', configErr);
      console.log('[Copy-URL-on-Hover] Falling back to DEFAULT_CONFIG');
      CONFIG = { ...DEFAULT_CONFIG };
    }

    console.log('[Copy-URL-on-Hover] STEP: Enabling debug mode if configured...');
    // Enable debug mode if configured
    if (CONFIG.debugMode) {
      try {
        enableDebug();
        eventBus.enableDebug();
        debug('Debug mode enabled');
        console.log('[Copy-URL-on-Hover] ✓ Debug mode activated');
      } catch (debugErr) {
        console.error('[Copy-URL-on-Hover] ERROR: Failed to enable debug mode:', debugErr);
      }
    }

    console.log('[Copy-URL-on-Hover] STEP: Initializing state...');
    // Initialize state
    try {
      stateManager.setState({
        quickTabZIndex: CONSTANTS.QUICK_TAB_BASE_Z_INDEX
      });
      console.log('[Copy-URL-on-Hover] ✓ State initialized');
    } catch (stateErr) {
      console.error('[Copy-URL-on-Hover] ERROR: Failed to initialize state:', stateErr);
      throw stateErr; // State is critical, re-throw
    }

    console.log('[Copy-URL-on-Hover] STEP: Initializing feature modules...');
    // Initialize Quick Tabs feature (v1.5.9.0 - CRITICAL FIX, v1.5.8.12 - Panel instead of sidebar)
    try {
      quickTabsManager = await initQuickTabs(eventBus, Events);
      console.log('[Copy-URL-on-Hover] ✓ Quick Tabs feature initialized');
    } catch (qtErr) {
      console.error('[Copy-URL-on-Hover] ERROR: Failed to initialize Quick Tabs:', qtErr);
      // Don't throw - allow other features to work
    }

    // Initialize Notifications feature (v1.5.9.0)
    try {
      notificationManager = initNotifications(CONFIG, stateManager);
      console.log('[Copy-URL-on-Hover] ✓ Notifications feature initialized');
    } catch (notifErr) {
      console.error('[Copy-URL-on-Hover] ERROR: Failed to initialize Notifications:', notifErr);
      // Don't throw - allow other features to work
    }

    debug('Extension initialized successfully');

    console.log('[Copy-URL-on-Hover] STEP: Starting main features...');
    // Start main functionality
    await initMainFeatures();
    console.log('[Copy-URL-on-Hover] ✓✓✓ EXTENSION FULLY INITIALIZED ✓✓✓');

    // Set success marker
    window.CUO_initialized = true;
    console.log('[Copy-URL-on-Hover] Extension is ready for use!');
  } catch (err) {
    console.error('[Copy-URL-on-Hover] ❌ CRITICAL INITIALIZATION ERROR ❌');
    console.error('[Copy-URL-on-Hover] Error details:', {
      message: err.message,
      stack: err.stack,
      name: err.name
    });

    // Try to show user-friendly error
    try {
      const errorMsg = `Copy-URL-on-Hover failed to initialize.\n\nError: ${err.message}\n\nPlease check the browser console (F12) for details.`;
      console.error('[Copy-URL-on-Hover] User will see alert:', errorMsg);
      // Uncomment for production debugging:
      // alert(errorMsg);
    } catch (alertErr) {
      console.error('[Copy-URL-on-Hover] Could not show error alert:', alertErr);
    }
  }
})();

/**
 * Initialize main features
 */
async function initMainFeatures() {
  debug('Loading main features...');

  // Note: Notification styles now injected by notifications module (v1.5.9.0)

  // Track mouse position for Quick Tab placement
  document.addEventListener(
    'mousemove',
    event => {
      stateManager.set('lastMouseX', event.clientX);
      stateManager.set('lastMouseY', event.clientY);
    },
    true
  );

  // Set up hover detection
  setupHoverDetection();

  // Set up keyboard shortcuts
  setupKeyboardShortcuts();

  // Note: Quick Tabs now initialized in main initExtension (v1.5.9.0)
  // Note: Panel Manager is separate feature - not reimplemented in modular architecture yet
}

/**
 * Get domain type from current URL
 */
function getDomainType() {
  const hostname = window.location.hostname.toLowerCase();

  // Check against all supported domains
  const domainMappings = {
    'twitter.com': 'twitter',
    'x.com': 'twitter',
    'reddit.com': 'reddit',
    'linkedin.com': 'linkedin',
    'instagram.com': 'instagram',
    'facebook.com': 'facebook',
    'tiktok.com': 'tiktok',
    'threads.net': 'threads',
    'bsky.app': 'bluesky',
    'youtube.com': 'youtube',
    'vimeo.com': 'vimeo',
    'github.com': 'github',
    'gitlab.com': 'gitlab',
    'stackoverflow.com': 'stackoverflow',
    'medium.com': 'medium',
    'amazon.com': 'amazon',
    'ebay.com': 'ebay',
    'pinterest.com': 'pinterest',
    'wikipedia.org': 'wikipedia',
    'netflix.com': 'netflix',
    'spotify.com': 'spotify',
    'twitch.tv': 'twitch',
    steam: 'steam'
    // Add more mappings as needed
  };

  // Check for exact matches
  for (const [domain, type] of Object.entries(domainMappings)) {
    if (hostname.includes(domain)) {
      return type;
    }
  }

  return 'generic';
}

/**
 * Set up hover detection
 */
function setupHoverDetection() {
  document.addEventListener('mouseover', event => {
    const domainType = getDomainType();
    const element = event.target;

    // Find URL using the modular URL registry
    const url = urlRegistry.findURL(element, domainType);

    // Always set element, URL can be null
    stateManager.setState({
      currentHoveredLink: url || null, // Set to null if not found
      currentHoveredElement: element
    });

    if (url) {
      eventBus.emit(Events.HOVER_START, { url, element, domainType });
    }
  });

  document.addEventListener('mouseout', event => {
    stateManager.setState({
      currentHoveredLink: null,
      currentHoveredElement: null
    });

    eventBus.emit(Events.HOVER_END);
  });
}

/**
 * Check if element is an input field or editable
 */
function isInputField(element) {
  return (
    element &&
    (element.tagName === 'INPUT' ||
      element.tagName === 'TEXTAREA' ||
      element.isContentEditable ||
      element.closest('[contenteditable="true"]'))
  );
}

/**
 * Set up keyboard shortcuts
 */
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', async event => {
    // Ignore if typing in an interactive field
    if (isInputField(event.target)) {
      return;
    }

    const hoveredLink = stateManager.get('currentHoveredLink');
    const hoveredElement = stateManager.get('currentHoveredElement');

    // Don't exit early - some shortcuts don't need a URL!

    // Check for copy URL shortcut (needs URL)
    if (
      checkShortcut(
        event,
        CONFIG.copyUrlKey,
        CONFIG.copyUrlCtrl,
        CONFIG.copyUrlAlt,
        CONFIG.copyUrlShift
      )
    ) {
      if (!hoveredLink) return; // Only check for this specific shortcut
      event.preventDefault();
      await handleCopyURL(hoveredLink);
    }

    // Check for copy text shortcut (doesn't need URL)
    else if (
      checkShortcut(
        event,
        CONFIG.copyTextKey,
        CONFIG.copyTextCtrl,
        CONFIG.copyTextAlt,
        CONFIG.copyTextShift
      )
    ) {
      if (!hoveredElement) return; // Only needs element
      event.preventDefault();
      await handleCopyText(hoveredElement);
    }

    // Check for Quick Tab shortcut (needs URL)
    else if (
      checkShortcut(
        event,
        CONFIG.quickTabKey,
        CONFIG.quickTabCtrl,
        CONFIG.quickTabAlt,
        CONFIG.quickTabShift
      )
    ) {
      if (!hoveredLink) return;
      event.preventDefault();
      await handleCreateQuickTab(hoveredLink, hoveredElement);
    }

    // Check for open in new tab shortcut (needs URL)
    else if (
      checkShortcut(
        event,
        CONFIG.openNewTabKey,
        CONFIG.openNewTabCtrl,
        CONFIG.openNewTabAlt,
        CONFIG.openNewTabShift
      )
    ) {
      if (!hoveredLink) return;
      event.preventDefault();
      await handleOpenInNewTab(hoveredLink);
    }
  });
}

/**
 * Check if keyboard shortcut matches configuration
 */
function checkShortcut(event, key, needCtrl, needAlt, needShift) {
  return (
    event.key.toLowerCase() === key.toLowerCase() &&
    event.ctrlKey === needCtrl &&
    event.altKey === needAlt &&
    event.shiftKey === needShift
  );
}

/**
 * Handle copy URL action
 */
async function handleCopyURL(url) {
  try {
    const success = await copyToClipboard(url);

    if (success) {
      eventBus.emit(Events.URL_COPIED, { url });
      showNotification('✓ URL copied!', 'success');
      debug('Copied URL:', url);
    } else {
      showNotification('✗ Failed to copy URL', 'error');
    }
  } catch (err) {
    console.error('[Copy URL] Failed:', err);
    showNotification('✗ Failed to copy URL', 'error');
  }
}

/**
 * Handle copy text action
 */
async function handleCopyText(element) {
  try {
    const text = getLinkText(element);
    const success = await copyToClipboard(text);

    if (success) {
      eventBus.emit(Events.TEXT_COPIED, { text });
      showNotification('✓ Text copied!', 'success');
      debug('Copied text:', text);
    } else {
      showNotification('✗ Failed to copy text', 'error');
    }
  } catch (err) {
    console.error('[Copy Text] Failed:', err);
    showNotification('✗ Failed to copy text', 'error');
  }
}

/**
 * Handle create Quick Tab action
 */
async function handleCreateQuickTab(url, targetElement = null) {
  if (!url) {
    console.warn('[Quick Tab] Missing URL for creation');
    return;
  }

  debug('Creating Quick Tab for:', url);
  eventBus.emit(Events.QUICK_TAB_REQUESTED, { url });

  const width = CONFIG.quickTabDefaultWidth || 800;
  const height = CONFIG.quickTabDefaultHeight || 600;
  const position = calculateQuickTabPosition(targetElement, width, height);

  const canUseManagerSaveId = Boolean(
    quickTabsManager && typeof quickTabsManager.generateSaveId === 'function'
  );
  const quickTabId =
    quickTabsManager && typeof quickTabsManager.generateId === 'function'
      ? quickTabsManager.generateId()
      : generateQuickTabId();
  const saveId = canUseManagerSaveId ? quickTabsManager.generateSaveId() : generateSaveTrackingId();

  try {
    // v1.5.9.11 FIX: Create Quick Tab LOCALLY FIRST (originating tab renders immediately)
    // This ensures the tab appears in the originating tab without waiting for background sync
    if (quickTabsManager && typeof quickTabsManager.createQuickTab === 'function') {
      // Track pending save to prevent duplicate processing from storage events
      if (canUseManagerSaveId && quickTabsManager.trackPendingSave) {
        quickTabsManager.trackPendingSave(saveId);
      }

      // Create locally - this will also broadcast to other tabs via BroadcastChannel
      quickTabsManager.createQuickTab({
        id: quickTabId,
        url,
        left: position.left,
        top: position.top,
        width,
        height,
        title: targetElement?.textContent?.trim() || 'Quick Tab',
        cookieStoreId: 'firefox-default',
        minimized: false,
        pinnedToUrl: null
      });

      // THEN notify background for persistence (storage sync as backup)
      await sendMessageToBackground({
        action: 'CREATE_QUICK_TAB',
        url,
        id: quickTabId,
        left: position.left,
        top: position.top,
        width,
        height,
        title: targetElement?.textContent?.trim() || 'Quick Tab',
        cookieStoreId: 'firefox-default',
        minimized: false,
        saveId
      });

      showNotification('✓ Quick Tab created!', 'success');
      debug('Quick Tab created successfully');
    } else {
      // Fallback for when manager isn't available (shouldn't happen in normal operation)
      console.warn('[Quick Tab] Manager not available, using legacy creation path');
      await sendMessageToBackground({
        action: 'CREATE_QUICK_TAB',
        url,
        id: quickTabId,
        left: position.left,
        top: position.top,
        width,
        height,
        title: targetElement?.textContent?.trim() || 'Quick Tab',
        cookieStoreId: 'firefox-default',
        minimized: false,
        saveId
      });

      showNotification('✓ Quick Tab created!', 'success');
      debug('Quick Tab created successfully');
    }
  } catch (err) {
    console.error('[Quick Tab] Failed:', err);
    if (canUseManagerSaveId && quickTabsManager?.releasePendingSave) {
      quickTabsManager.releasePendingSave(saveId);
    }
    showNotification('✗ Failed to create Quick Tab', 'error');
  }
}

function calculateQuickTabPosition(targetElement, width, height) {
  const padding = 16;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || width;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || height;

  let left = stateManager.get('lastMouseX') ?? padding;
  let top = stateManager.get('lastMouseY') ?? padding;

  if (targetElement?.getBoundingClientRect) {
    try {
      const rect = targetElement.getBoundingClientRect();
      left = rect.right + padding;
      top = rect.top;
    } catch (error) {
      console.warn('[Quick Tab] Failed to read target bounds:', error);
    }
  }

  const maxLeft = Math.max(padding, viewportWidth - width - padding);
  const maxTop = Math.max(padding, viewportHeight - height - padding);

  left = Math.min(Math.max(left, padding), maxLeft);
  top = Math.min(Math.max(top, padding), maxTop);

  return {
    left: Math.round(left),
    top: Math.round(top)
  };
}

/**
 * Helper function to generate unique Quick Tab ID
 */
function generateQuickTabId() {
  return `qt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function generateSaveTrackingId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Handle open in new tab action
 */
async function handleOpenInNewTab(url) {
  try {
    await sendMessageToBackground({
      action: 'openTab',
      url: url,
      switchFocus: CONFIG.openNewTabSwitchFocus
    });

    eventBus.emit(Events.LINK_OPENED, { url });
    showNotification('✓ Opened in new tab', 'success');
    debug('Opened in new tab:', url);
  } catch (err) {
    console.error('[Open Tab] Failed:', err);
    showNotification('✗ Failed to open tab', 'error');
  }
}

/**
 * Show notification to user
 * v1.5.9.0 - Now delegates to notification manager
 */
function showNotification(message, type = 'info') {
  debug('Notification:', message, type);

  // Delegate to notification manager
  if (notificationManager) {
    notificationManager.showNotification(message, type);
  } else {
    console.warn('[Content] Notification manager not initialized, skipping notification');
  }
}

// ==================== LOG EXPORT MESSAGE HANDLER ====================
// Listen for log export requests from popup
if (typeof browser !== 'undefined' && browser.runtime) {
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'GET_CONTENT_LOGS') {
      console.log('[Content] Received GET_CONTENT_LOGS request');

      try {
        // ✅ NEW: Get logs from console interceptor (captures ALL console calls)
        const consoleLogs = getConsoleLogs();

        // ✅ NEW: Also get logs from debug.js (if any code uses debug() functions)
        const debugLogs = getLogBuffer();

        // ✅ NEW: Merge both sources
        const allLogs = [...consoleLogs, ...debugLogs];

        // Sort by timestamp
        allLogs.sort((a, b) => a.timestamp - b.timestamp);

        console.log(`[Content] Sending ${allLogs.length} logs to popup`);
        console.log(
          `[Content] Console logs: ${consoleLogs.length}, Debug logs: ${debugLogs.length}`
        );

        // ✅ NEW: Get buffer stats for debugging
        const stats = getBufferStats();
        console.log('[Content] Buffer stats:', stats);

        sendResponse({
          logs: allLogs,
          stats: stats
        });
      } catch (error) {
        console.error('[Content] Error getting log buffer:', error);
        sendResponse({ logs: [], error: error.message });
      }

      return true; // Keep message channel open for async response
    }

    if (message.action === 'CLEAR_CONTENT_LOGS') {
      try {
        clearConsoleLogs();
        clearLogBuffer();
        sendResponse({ success: true, clearedAt: Date.now() });
      } catch (error) {
        console.error('[Content] Error clearing log buffer:', error);
        sendResponse({ success: false, error: error.message });
      }

      return true;
    }
  });
}
// ==================== END LOG EXPORT MESSAGE HANDLER ====================

// Export for testing and module access
if (typeof window !== 'undefined') {
  window.CopyURLExtension = {
    configManager,
    stateManager,
    eventBus,
    urlRegistry,
    quickTabsManager,
    notificationManager,
    CONFIG
  };
}
