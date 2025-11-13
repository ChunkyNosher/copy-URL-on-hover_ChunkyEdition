/**
 * Copy URL on Hover - Enhanced with Quick Tabs
 * Main Content Script Entry Point (Hybrid Architecture v1.5.8.10)
 *
 * This file serves as the main entry point and coordinates between modules.
 * URL handlers have been extracted to features/url-handlers/ for better maintainability.
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

// CRITICAL: Early detection marker - must execute first
console.log('[Copy-URL-on-Hover] Script loaded! @', new Date().toISOString());
try {
  window.CUO_debug_marker = 'JS executed to top of file!';
  console.log('[Copy-URL-on-Hover] Debug marker set successfully');
} catch (e) {
  console.error('[Copy-URL-on-Hover] CRITICAL: Failed to set window marker', e);
}

// Global error handler to catch all unhandled errors
window.addEventListener('error', function (event) {
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
window.addEventListener('unhandledrejection', function (event) {
  console.error('[Copy-URL-on-Hover] UNHANDLED PROMISE REJECTION:', {
    reason: event.reason,
    promise: event.promise
  });
});

console.log('[Copy-URL-on-Hover] Global error handlers installed');

// Import core modules
console.log('[Copy-URL-on-Hover] Starting module imports...');
import { ConfigManager, DEFAULT_CONFIG, CONSTANTS } from './core/config.js';
console.log('[Copy-URL-on-Hover] ✓ Imported: config.js');
import { StateManager } from './core/state.js';
console.log('[Copy-URL-on-Hover] ✓ Imported: state.js');
import { EventBus, Events } from './core/events.js';
console.log('[Copy-URL-on-Hover] ✓ Imported: events.js');
import { debug, enableDebug } from './utils/debug.js';
console.log('[Copy-URL-on-Hover] ✓ Imported: debug.js');
import { copyToClipboard, sendMessageToBackground } from './core/browser-api.js';
console.log('[Copy-URL-on-Hover] ✓ Imported: browser-api.js from core');

// Import URL handlers
import { URLHandlerRegistry } from './features/url-handlers/index.js';
console.log('[Copy-URL-on-Hover] ✓ Imported: url-handlers/index.js');
import { getLinkText } from './features/url-handlers/generic.js';
console.log('[Copy-URL-on-Hover] ✓ Imported: url-handlers/generic.js');

// Import Quick Tabs feature (v1.5.9.0 - CRITICAL FIX)
import { initQuickTabs } from './features/quick-tabs/index.js';
console.log('[Copy-URL-on-Hover] ✓ Imported: quick-tabs/index.js');

// Import Notifications feature (v1.5.9.0)
import { initNotifications } from './features/notifications/index.js';
console.log('[Copy-URL-on-Hover] ✓ Imported: notifications/index.js');

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
    // Initialize Quick Tabs feature (v1.5.9.0 - CRITICAL FIX)
    try {
      quickTabsManager = initQuickTabs(eventBus, Events);
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
    function (event) {
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
  document.addEventListener('mouseover', function (event) {
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

  document.addEventListener('mouseout', function (event) {
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
  document.addEventListener('keydown', async function (event) {
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
      await handleCreateQuickTab(hoveredLink);
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
async function handleCreateQuickTab(url) {
  debug('Creating Quick Tab for:', url);
  eventBus.emit(Events.QUICK_TAB_REQUESTED, { url });

  // ACTUAL IMPLEMENTATION - send to background script
  try {
    await sendMessageToBackground({
      action: 'CREATE_QUICK_TAB',
      url: url,
      id: generateQuickTabId(),
      left: stateManager.get('lastMouseX') || 100,
      top: stateManager.get('lastMouseY') || 100,
      width: CONFIG.quickTabDefaultWidth || 800,
      height: CONFIG.quickTabDefaultHeight || 600,
      title: 'Quick Tab',
      cookieStoreId: 'firefox-default',
      minimized: false
    });

    showNotification('✓ Quick Tab created!', 'success');
    debug('Quick Tab created successfully');
  } catch (err) {
    console.error('[Quick Tab] Failed:', err);
    showNotification('✗ Failed to create Quick Tab', 'error');
  }
}

/**
 * Helper function to generate unique Quick Tab ID
 */
function generateQuickTabId() {
  return `qt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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
