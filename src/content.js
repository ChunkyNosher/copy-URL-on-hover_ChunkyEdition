// =============================================================================
// CRITICAL: Quick Tab Iframe Recursion Guard (Bug #2 Fix)
// =============================================================================
// This guard MUST be at the very top of the file to prevent browser crashes
// from infinite iframe nesting when content script runs inside Quick Tab iframes.
// =============================================================================

/**
 * Check if parent frame is a Quick Tab window (helper to reduce nesting)
 * @param {Element} parentFrame - The parent frame element
 * @returns {boolean} - True if parent is a Quick Tab window
 */
function _isQuickTabParentFrame(parentFrame) {
  if (!parentFrame) return false;
  const quickTabSelectors = '.quick-tab-window, [data-quick-tab-id], [id^="quick-tab-"]';
  return parentFrame.closest(quickTabSelectors) !== null;
}

/**
 * Check if we should skip initialization (inside Quick Tab iframe)
 * @returns {boolean} - True if initialization should be skipped
 */
function _checkShouldSkipInitialization() {
  // Not in iframe - proceed normally
  if (window.self === window.top) {
    return false;
  }

  // In iframe - check if parent is Quick Tab
  try {
    const parentFrame = window.frameElement;
    if (_isQuickTabParentFrame(parentFrame)) {
      console.log('[Content] Skipping initialization - inside Quick Tab iframe');
      window.CUO_skipped = true;
      window.CUO_skip_reason = 'quick-tab-iframe';
      return true;
    }
    return false;
  } catch (_e) {
    // Cross-origin error - err on side of caution
    console.log('[Content] Skipping initialization - cross-origin iframe (safety measure)');
    window.CUO_skipped = true;
    window.CUO_skip_reason = 'cross-origin-iframe';
    return true;
  }
}

// GUARD: Do not run extension in Quick Tab iframes or nested frames
const _shouldSkipInitialization = _checkShouldSkipInitialization();

// If inside Quick Tab iframe, stop all execution here
if (_shouldSkipInitialization) {
  // Export minimal marker for debugging and stop
  window.CUO_debug_marker = 'CUO_QUICK_TAB_IFRAME_SKIPPED';
  // Throw to prevent further module loading (caught by module loader)
  throw new Error('[Content] Intentional halt - inside Quick Tab iframe');
}

// =============================================================================
// End of Iframe Recursion Guard - Normal extension initialization below
// =============================================================================

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
 *
 * v1.6.2.3 Changes:
 * - Added critical iframe recursion guard at top of file (Bug #2 fix)
 * - Prevents browser crashes from infinite Quick Tab nesting
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
import { logNormal, logWarn, refreshLiveConsoleSettings } from './utils/logger.js';
// Import filter settings initialization promise
import { settingsReady } from './utils/filter-settings.js';

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

/**
 * v1.6.0 Phase 2.4 - Extracted helper for config loading
 */
async function loadConfiguration() {
  console.log('[Copy-URL-on-Hover] STEP: Loading user configuration...');
  try {
    const config = await configManager.load();
    console.log('[Copy-URL-on-Hover] ✓ Configuration loaded successfully');
    console.log('[Copy-URL-on-Hover] Config values:', {
      debugMode: config.debugMode,
      quickTabPersistAcrossTabs: config.quickTabPersistAcrossTabs,
      hasDefaultConfig: config !== null && config !== undefined
    });
    return config;
  } catch (configErr) {
    console.error('[Copy-URL-on-Hover] ERROR: Failed to load configuration:', configErr);
    console.log('[Copy-URL-on-Hover] Falling back to DEFAULT_CONFIG');
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * v1.6.0 Phase 2.4 - Extracted helper for debug mode setup
 */
function setupDebugMode() {
  if (!CONFIG.debugMode) return;

  console.log('[Copy-URL-on-Hover] STEP: Enabling debug mode...');
  try {
    enableDebug();
    eventBus.enableDebug();
    debug('Debug mode enabled');
    console.log('[Copy-URL-on-Hover] ✓ Debug mode activated');
  } catch (debugErr) {
    console.error('[Copy-URL-on-Hover] ERROR: Failed to enable debug mode:', debugErr);
  }
}

/**
 * v1.6.0 Phase 2.4 - Extracted helper for state initialization
 */
function initializeState() {
  console.log('[Copy-URL-on-Hover] STEP: Initializing state...');
  stateManager.setState({
    quickTabZIndex: CONSTANTS.QUICK_TAB_BASE_Z_INDEX
  });
  console.log('[Copy-URL-on-Hover] ✓ State initialized');
}

/**
 * v1.6.0 Phase 2.4 - Extracted helper for feature initialization
 */
/**
 * v1.6.0.3 - Helper to log Quick Tabs initialization error details
 */
function logQuickTabsInitError(qtErr) {
  console.error('[Copy-URL-on-Hover] ❌ EXCEPTION during Quick Tabs initialization:', {
    message: qtErr?.message || 'No message',
    name: qtErr?.name || 'No name',
    stack: qtErr?.stack || 'No stack',
    type: typeof qtErr,
    stringified: JSON.stringify(qtErr),
    keys: Object.keys(qtErr || {}),
    error: qtErr
  });
  // Log error properties explicitly (helps debug empty error objects)
  if (qtErr) {
    for (const key in qtErr) {
      console.error(`[Copy-URL-on-Hover] Error property "${key}":`, qtErr[key]);
    }
  }
}

/**
 * v1.6.0.3 - Helper to initialize Quick Tabs
 */
async function initializeQuickTabsFeature() {
  console.log('[Copy-URL-on-Hover] About to initialize Quick Tabs...');
  quickTabsManager = await initQuickTabs(eventBus, Events);

  if (quickTabsManager) {
    console.log('[Copy-URL-on-Hover] ✓ Quick Tabs feature initialized successfully');
    console.log(
      '[Copy-URL-on-Hover] Manager has createQuickTab:',
      typeof quickTabsManager.createQuickTab
    );
  } else {
    console.error('[Copy-URL-on-Hover] ✗ Quick Tabs manager is null after initialization!');
  }
}

/**
 * v1.6.0 Phase 2.4 - Extracted helper for feature initialization
 * v1.6.0.3 - Extracted Quick Tabs init to reduce complexity
 */
async function initializeFeatures() {
  console.log('[Copy-URL-on-Hover] STEP: Initializing feature modules...');

  // Quick Tabs feature
  try {
    await initializeQuickTabsFeature();
  } catch (qtErr) {
    logQuickTabsInitError(qtErr);
  }

  // Notifications feature
  try {
    notificationManager = initNotifications(CONFIG, stateManager);
    console.log('[Copy-URL-on-Hover] ✓ Notifications feature initialized');
  } catch (notifErr) {
    console.error('[Copy-URL-on-Hover] ERROR: Failed to initialize Notifications:', notifErr);
  }
}

/**
 * v1.6.0 Phase 2.4 - Extracted helper for error reporting
 */
function reportInitializationError(err) {
  console.error('[Copy-URL-on-Hover] ❌ CRITICAL INITIALIZATION ERROR ❌');
  console.error('[Copy-URL-on-Hover] Error details:', {
    message: err.message,
    stack: err.stack,
    name: err.name
  });

  try {
    const errorMsg = `Copy-URL-on-Hover failed to initialize.\n\nError: ${err.message}\n\nPlease check the browser console (F12) for details.`;
    console.error('[Copy-URL-on-Hover] User will see alert:', errorMsg);
    // Uncomment for production debugging: alert(errorMsg);
  } catch (alertErr) {
    console.error('[Copy-URL-on-Hover] Could not show error alert:', alertErr);
  }
}

/**
 * v1.6.0 Phase 2.4 - Refactored to reduce complexity from 10 to <9
 * v1.6.1 - Added explicit filter settings initialization before logging starts
 * v1.6.2.3 - Iframe guard moved to top of file (halts execution before reaching here)
 */
(async function initExtension() {
  try {
    // v1.6.1: Wait for filter settings to load from storage BEFORE starting extension logs
    // This ensures user's filter preferences are active from the very first log
    const settingsResult = await settingsReady;
    if (settingsResult.success) {
      console.log(`[Copy-URL-on-Hover] ✓ Filter settings loaded (source: ${settingsResult.source})`);
    } else {
      console.warn(`[Copy-URL-on-Hover] ⚠ Using default filter settings (${settingsResult.source})`);
    }
    
    console.log('[Copy-URL-on-Hover] STEP: Starting extension initialization...');

    // Load configuration
    CONFIG = await loadConfiguration();

    // Setup debug mode
    setupDebugMode();

    // Initialize state (critical - will throw on error)
    initializeState();

    // Initialize features
    await initializeFeatures();

    debug('Extension initialized successfully');

    // Start main functionality
    console.log('[Copy-URL-on-Hover] STEP: Starting main features...');
    await initMainFeatures();
    console.log('[Copy-URL-on-Hover] ✓✓✓ EXTENSION FULLY INITIALIZED ✓✓✓');

    // Set success marker
    window.CUO_initialized = true;
    console.log('[Copy-URL-on-Hover] Extension is ready for use!');
  } catch (err) {
    reportInitializationError(err);
  }
})();

/**
 * Initialize main features
 */
function initMainFeatures() {
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
 * v1.6.0.7 - Enhanced logging for hover lifecycle and URL detection
 */
function setupHoverDetection() {
  // Track hover start time for duration calculation
  let hoverStartTime = null;

  document.addEventListener('mouseover', event => {
    hoverStartTime = performance.now();
    const domainType = getDomainType();
    const element = event.target;

    // Log hover start with element context
    logNormal('hover', 'Start', 'Mouse entered element', {
      elementTag: element.tagName,
      elementClasses: element.className || '<none>',
      elementId: element.id || '<none>',
      elementText: element.textContent?.substring(0, 100) || '<empty>',
      domainType: domainType
    });

    // Find URL using the modular URL registry
    const urlDetectionStart = performance.now();
    const url = urlRegistry.findURL(element, domainType);
    const urlDetectionDuration = performance.now() - urlDetectionStart;

    // Log URL detection result
    if (url) {
      logNormal('url-detection', 'Success', 'URL found', {
        url: url,
        domainType: domainType,
        detectionTime: `${urlDetectionDuration.toFixed(2)}ms`
      });
    } else {
      logNormal('url-detection', 'Failure', 'No URL found', {
        elementTag: element.tagName,
        elementClasses: element.className || '<none>',
        domainType: domainType,
        detectionTime: `${urlDetectionDuration.toFixed(2)}ms`
      });
    }

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
    const hoverDuration = hoverStartTime ? performance.now() - hoverStartTime : 0;
    const wasURLDetected = !!stateManager.get('currentHoveredLink');

    // Log hover end with duration and context
    logNormal('hover', 'End', 'Mouse left element', {
      duration: `${hoverDuration.toFixed(2)}ms`,
      urlWasDetected: wasURLDetected,
      elementTag: event.target.tagName
    });

    stateManager.setState({
      currentHoveredLink: null,
      currentHoveredElement: null
    });

    eventBus.emit(Events.HOVER_END);
    hoverStartTime = null;
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
 * v1.6.0 Phase 2.4 - Table-driven shortcut handling
 */
const SHORTCUT_HANDLERS = [
  {
    name: 'copyUrl',
    needsLink: true,
    needsElement: false,
    handler: handleCopyURL
  },
  {
    name: 'copyText',
    needsLink: false,
    needsElement: true,
    handler: handleCopyText
  },
  {
    name: 'quickTab',
    needsLink: true,
    needsElement: true,
    handler: handleCreateQuickTab
  },
  {
    name: 'openNewTab',
    needsLink: true,
    needsElement: false,
    handler: handleOpenInNewTab
  }
];

/**
 * v1.6.0 Phase 2.4 - Check if shortcut matches and prerequisites are met
 */
function matchesShortcut(event, shortcut, hoveredLink, hoveredElement) {
  const keyConfig = `${shortcut.name}Key`;
  const ctrlConfig = `${shortcut.name}Ctrl`;
  const altConfig = `${shortcut.name}Alt`;
  const shiftConfig = `${shortcut.name}Shift`;

  if (
    !checkShortcut(
      event,
      CONFIG[keyConfig],
      CONFIG[ctrlConfig],
      CONFIG[altConfig],
      CONFIG[shiftConfig]
    )
  ) {
    return false;
  }

  // Check prerequisites
  if (shortcut.needsLink && !hoveredLink) return false;
  if (shortcut.needsElement && !hoveredElement) return false;

  return true;
}

/**
 * Execute matched shortcut handler
 * v1.6.0.10 - Added logging for matched shortcuts only
 */
async function executeShortcutHandler(shortcut, hoveredLink, hoveredElement, event) {
  const executionStart = performance.now();

  // Log matched shortcut execution
  logNormal('keyboard', 'Matched', 'Keyboard shortcut matched and executing', {
    shortcutName: shortcut.name,
    key: event.key,
    modifiers: `Ctrl:${event.ctrlKey} Alt:${event.altKey} Shift:${event.shiftKey}`,
    hasLink: !!hoveredLink,
    hasElement: !!hoveredElement
  });

  // Pass correct parameters based on handler's requirements
  if (shortcut.needsLink && shortcut.needsElement) {
    await shortcut.handler(hoveredLink, hoveredElement);
  } else if (shortcut.needsLink) {
    await shortcut.handler(hoveredLink);
  } else if (shortcut.needsElement) {
    await shortcut.handler(hoveredElement);
  }

  const executionDuration = performance.now() - executionStart;

  logNormal('keyboard', 'Complete', 'Handler execution finished', {
    shortcutName: shortcut.name,
    executionTime: `${executionDuration.toFixed(2)}ms`
  });
}

/**
 * v1.6.0 Phase 2.4 - Extracted handler for keyboard shortcuts
 * Reduced complexity and nesting using table-driven pattern with guard clauses
 * v1.6.0.3 - Fixed parameter passing: pass correct args based on handler's needs
 * v1.6.0.7 - Enhanced logging for keyboard event detection and shortcut matching
 * v1.6.0.10 - ARCHITECTURAL FIX: Only log matched shortcuts, not every keystroke
 *             Removes noise from console by logging only when shortcuts are executed
 */
async function handleKeyboardShortcut(event) {
  // Check if in input field first - silently ignore
  const isInInputField = isInputField(event.target);
  if (isInInputField) {
    return;
  }

  const hoveredLink = stateManager.get('currentHoveredLink');
  const hoveredElement = stateManager.get('currentHoveredElement');

  // Check each shortcut using table-driven approach
  for (const shortcut of SHORTCUT_HANDLERS) {
    const matches = matchesShortcut(event, shortcut, hoveredLink, hoveredElement);

    if (!matches) continue;

    // Shortcut matched - prevent default and execute
    event.preventDefault();

    // Execute with logging (logging happens inside executeShortcutHandler)
    await executeShortcutHandler(shortcut, hoveredLink, hoveredElement, event);

    return;
  }

  // No shortcut matched - silently ignore (no noise in console)
}

/**
 * Set up keyboard shortcuts
 * v1.6.0 Phase 2.4 - Extracted handler to reduce complexity
 */
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', handleKeyboardShortcut);
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
 * v1.6.0.7 - Enhanced logging for clipboard operations and action context
 */
async function handleCopyURL(url) {
  logNormal('clipboard', 'Action', 'Copy URL requested', {
    url: url,
    urlLength: url?.length || 0,
    currentPage: window.location.href,
    triggeredBy: 'keyboard-shortcut'
  });

  try {
    const copyStart = performance.now();
    const success = await copyToClipboard(url);
    const copyDuration = performance.now() - copyStart;

    logNormal('clipboard', 'Result', 'Copy operation completed', {
      success: success,
      url: url,
      duration: `${copyDuration.toFixed(2)}ms`
    });

    if (success) {
      eventBus.emit(Events.URL_COPIED, { url });
      showNotification('✓ URL copied!', 'success');
      debug('Copied URL:', url);
    } else {
      console.error('[Clipboard] [Failure] Copy operation returned false', {
        url: url,
        timestamp: Date.now()
      });
      showNotification('✗ Failed to copy URL', 'error');
    }
  } catch (err) {
    console.error('[Copy URL] Failed:', err);
    showNotification('✗ Failed to copy URL', 'error');
  }
}

/**
 * Handle copy text action
 * v1.6.0.1 - Added validation for empty text
 * v1.6.0.7 - Enhanced logging for text extraction and clipboard operations
 */
async function handleCopyText(element) {
  logNormal('clipboard', 'Action', 'Copy text requested', {
    elementTag: element?.tagName || '<none>',
    elementText: element?.textContent?.substring(0, 100) || '<empty>',
    triggeredBy: 'keyboard-shortcut'
  });

  try {
    const extractStart = performance.now();
    const text = getLinkText(element);
    const extractDuration = performance.now() - extractStart;

    logNormal('clipboard', 'Extract', 'Text extraction completed', {
      textLength: text?.length || 0,
      textPreview: text?.substring(0, 100) || '<empty>',
      extractionTime: `${extractDuration.toFixed(2)}ms`
    });

    // Validate text is not empty
    if (!text || text.trim().length === 0) {
      logWarn('clipboard', 'Validation', 'No text found to copy', {
        element: element
      });
      showNotification('✗ No text found', 'error');
      return;
    }

    const copyStart = performance.now();
    const success = await copyToClipboard(text);
    const copyDuration = performance.now() - copyStart;

    logNormal('clipboard', 'Result', 'Copy operation completed', {
      success: success,
      textLength: text.length,
      duration: `${copyDuration.toFixed(2)}ms`
    });

    if (success) {
      eventBus.emit(Events.TEXT_COPIED, { text });
      showNotification('✓ Text copied!', 'success');
      debug('Copied text:', text);
    } else {
      showNotification('✗ Failed to copy text', 'error');
      console.error('[Copy Text] [Failure] Clipboard operation returned false', {
        textLength: text.length,
        timestamp: Date.now()
      });
    }
  } catch (err) {
    console.error('[Copy Text] Failed:', {
      message: err.message,
      name: err.name,
      stack: err.stack,
      error: err
    });
    showNotification('✗ Failed to copy text', 'error');
  }
}

/**
 * Handle create Quick Tab action
 */
/**
 * v1.6.0 Phase 2.4 - Extracted helper for Quick Tab data structure
 */
function buildQuickTabData(url, quickTabId, position, width, height, title) {
  return {
    id: quickTabId,
    url,
    left: position.left,
    top: position.top,
    width,
    height,
    title,
    cookieStoreId: 'firefox-default',
    minimized: false,
    pinnedToUrl: null
  };
}

/**
 * v1.6.0 Phase 2.4 - Extracted helper for Quick Tab IDs
 */
function generateQuickTabIds() {
  const canUseManagerSaveId = Boolean(
    quickTabsManager && typeof quickTabsManager.generateSaveId === 'function'
  );
  const quickTabId =
    quickTabsManager && typeof quickTabsManager.generateId === 'function'
      ? quickTabsManager.generateId()
      : generateQuickTabId();
  const saveId = canUseManagerSaveId ? quickTabsManager.generateSaveId() : generateSaveTrackingId();

  return { quickTabId, saveId, canUseManagerSaveId };
}

/**
 * v1.6.0 Phase 2.4 - Extracted helper for local Quick Tab creation
 */
function createQuickTabLocally(quickTabData, saveId, canUseManagerSaveId) {
  if (canUseManagerSaveId && quickTabsManager.trackPendingSave) {
    quickTabsManager.trackPendingSave(saveId);
  }
  quickTabsManager.createQuickTab(quickTabData);
}

/**
 * v1.6.0 Phase 2.4 - Extracted helper for background persistence
 */
async function persistQuickTabToBackground(quickTabData, saveId) {
  await sendMessageToBackground({
    action: 'CREATE_QUICK_TAB',
    ...quickTabData,
    saveId
  });
}

/**
 * v1.6.0 Phase 2.4 - Create Quick Tab (handle success)
 */
async function executeQuickTabCreation(quickTabData, saveId, canUseManagerSaveId) {
  const hasManager = quickTabsManager && typeof quickTabsManager.createQuickTab === 'function';

  if (hasManager) {
    createQuickTabLocally(quickTabData, saveId, canUseManagerSaveId);
  } else {
    console.warn('[Quick Tab] Manager not available, using legacy creation path');
  }

  await persistQuickTabToBackground(quickTabData, saveId);
  showNotification('✓ Quick Tab created!', 'success');
  debug('Quick Tab created successfully');
}

/**
 * v1.6.0 Phase 2.4 - Handle Quick Tab creation failure
 */
function handleQuickTabCreationError(err, saveId, canUseManagerSaveId) {
  console.error('[Quick Tab] Failed:', err);
  if (canUseManagerSaveId && quickTabsManager?.releasePendingSave) {
    quickTabsManager.releasePendingSave(saveId);
  }
  showNotification('✗ Failed to create Quick Tab', 'error');
}

/**
 * v1.6.0 Phase 2.4 - Refactored to reduce complexity from 18 to <9
 */
async function handleCreateQuickTab(url, targetElement = null) {
  // Early validation
  if (!url) {
    console.warn('[Quick Tab] Missing URL for creation');
    return;
  }

  // Setup and emit event
  debug('Creating Quick Tab for:', url);
  eventBus.emit(Events.QUICK_TAB_REQUESTED, { url });

  // Prepare Quick Tab data
  const width = CONFIG.quickTabDefaultWidth || 800;
  const height = CONFIG.quickTabDefaultHeight || 600;
  const position = calculateQuickTabPosition(targetElement, width, height);
  const title = targetElement?.textContent?.trim() || 'Quick Tab';
  const { quickTabId, saveId, canUseManagerSaveId } = generateQuickTabIds();
  const quickTabData = buildQuickTabData(url, quickTabId, position, width, height, title);

  // Execute creation with error handling
  try {
    await executeQuickTabCreation(quickTabData, saveId, canUseManagerSaveId);
  } catch (err) {
    handleQuickTabCreationError(err, saveId, canUseManagerSaveId);
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

/**
 * v1.6.0 - Helper function to handle Quick Tabs panel toggle
 * Extracted to meet max-depth=2 ESLint requirement
 *
 * @param {Function} sendResponse - Response callback from message listener
 */
function _handleQuickTabsPanelToggle(sendResponse) {
  console.log('[Content] Received TOGGLE_QUICK_TABS_PANEL request');

  try {
    // Guard: Quick Tabs manager not initialized
    if (!quickTabsManager) {
      console.error('[Content] Quick Tabs manager not initialized');
      sendResponse({
        success: false,
        error: 'Quick Tabs manager not initialized'
      });
      return;
    }

    // Guard: Panel manager not available
    if (!quickTabsManager.panelManager) {
      console.error('[Content] Quick Tabs panel manager not available');
      sendResponse({
        success: false,
        error: 'Panel manager not available'
      });
      return;
    }

    // Toggle the panel
    quickTabsManager.panelManager.toggle();
    console.log('[Content] ✓ Quick Tabs panel toggled successfully');

    sendResponse({ success: true });
  } catch (error) {
    console.error('[Content] Error toggling Quick Tabs panel:', error);
    sendResponse({
      success: false,
      error: error.message
    });
  }
}

/**
 * v1.6.2 - Handle storage.onChanged sync from background script
 * This is the critical handler for cross-tab Quick Tabs synchronization.
 * 
 * Flow:
 * 1. Background script detects storage.onChanged (from another tab's write)
 * 2. Background broadcasts SYNC_QUICK_TAB_STATE_FROM_BACKGROUND to all tabs
 * 3. This handler receives the message and routes to SyncCoordinator
 * 4. SyncCoordinator calls StateManager.hydrate() which emits state events
 * 5. UICoordinator listens to state events and renders/updates/destroys UI
 *
 * @param {Object} message - Message with state property
 * @param {Function} sendResponse - Response callback from message listener
 */
function _handleQuickTabStorageSync(message, sendResponse) {
  console.log('[Content] Received SYNC_QUICK_TAB_STATE_FROM_BACKGROUND');

  try {
    // Guard: Quick Tabs manager not initialized
    if (!quickTabsManager) {
      console.warn('[Content] Quick Tabs manager not initialized, ignoring sync');
      sendResponse({ success: false, error: 'Quick Tabs manager not initialized' });
      return;
    }

    // Guard: SyncCoordinator not available
    if (!quickTabsManager.syncCoordinator) {
      console.warn('[Content] SyncCoordinator not available, ignoring sync');
      sendResponse({ success: false, error: 'SyncCoordinator not available' });
      return;
    }

    // Route to SyncCoordinator which will hydrate state and emit events
    // The UICoordinator listens to state events and handles rendering
    const state = message.state;
    if (state) {
      console.log('[Content] Routing storage sync to SyncCoordinator');
      quickTabsManager.syncCoordinator.handleStorageChange(state);
      sendResponse({ success: true });
    } else {
      console.warn('[Content] No state in sync message');
      sendResponse({ success: false, error: 'No state in message' });
    }
  } catch (error) {
    console.error('[Content] Error handling Quick Tab storage sync:', error);
    sendResponse({ success: false, error: error.message });
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

    // ==================== LIVE CONSOLE FILTER REFRESH HANDLER ====================
    // v1.6.0.9 - Added to refresh filter settings when changed in popup
    if (message.action === 'REFRESH_LIVE_CONSOLE_FILTERS') {
      try {
        refreshLiveConsoleSettings();
        sendResponse({ success: true, refreshedAt: Date.now() });
      } catch (error) {
        console.error('[Content] Error refreshing live console filters:', error);
        sendResponse({ success: false, error: error.message });
      }

      return true;
    }
    // ==================== END LIVE CONSOLE FILTER REFRESH HANDLER ====================

    // ==================== QUICK TABS PANEL TOGGLE HANDLER ====================
    // v1.6.0 - Added to support keyboard shortcut (Ctrl+Alt+Z)
    // Refactored with early returns to meet max-depth=2 requirement
    if (message.action === 'TOGGLE_QUICK_TABS_PANEL') {
      _handleQuickTabsPanelToggle(sendResponse);
      return true; // Keep message channel open for async response
    }
    // ==================== END QUICK TABS PANEL TOGGLE HANDLER ====================

    // ==================== QUICK TABS CROSS-TAB SYNC HANDLER ====================
    // v1.6.2 - Handle storage.onChanged events broadcasted from background script
    // This is the critical bridge for cross-tab Quick Tabs synchronization
    // Background writes to storage → storage.onChanged fires → background broadcasts → content handles here
    if (message.action === 'SYNC_QUICK_TAB_STATE_FROM_BACKGROUND') {
      _handleQuickTabStorageSync(message, sendResponse);
      return true;
    }
    // ==================== END QUICK TABS CROSS-TAB SYNC HANDLER ====================

    // ==================== TEST BRIDGE MESSAGE HANDLERS ====================
    // v1.6.0.13 - Added for autonomous testing with Playwright MCP
    // Only active when TEST_MODE environment variable is true
    // See: docs/manual/v1.6.0/copilot-testing-implementation.md
    // eslint-disable-next-line max-depth
    if (message.type === 'TEST_CREATE_QUICK_TAB') {
      console.log('[Test Bridge Handler] TEST_CREATE_QUICK_TAB:', message.data);
      try {
        if (!quickTabsManager) {
          throw new Error('QuickTabsManager not initialized');
        }
        
        const { url, options = {} } = message.data;
        
        // Create Quick Tab using the manager
        // Note: This bypasses keyboard shortcut and creates directly
        quickTabsManager.createQuickTab({
          url,
          title: options.title || 'Test Quick Tab',
          ...options
        });
        
        sendResponse({
          success: true,
          message: 'Quick Tab created',
          data: { url, options }
        });
      } catch (error) {
        console.error('[Test Bridge Handler] TEST_CREATE_QUICK_TAB error:', error);
        sendResponse({
          success: false,
          error: error.message
        });
      }
      return true;
    }

    // eslint-disable-next-line max-depth
    if (message.type === 'TEST_MINIMIZE_QUICK_TAB') {
      console.log('[Test Bridge Handler] TEST_MINIMIZE_QUICK_TAB:', message.data);
      try {
        if (!quickTabsManager || !quickTabsManager.panelManager) {
          throw new Error('QuickTabsManager or PanelManager not initialized');
        }
        
        const { id } = message.data;
        quickTabsManager.panelManager.minimizeTab(id);
        
        sendResponse({
          success: true,
          message: 'Quick Tab minimized',
          data: { id }
        });
      } catch (error) {
        console.error('[Test Bridge Handler] TEST_MINIMIZE_QUICK_TAB error:', error);
        sendResponse({
          success: false,
          error: error.message
        });
      }
      return true;
    }

    // eslint-disable-next-line max-depth
    if (message.type === 'TEST_RESTORE_QUICK_TAB') {
      console.log('[Test Bridge Handler] TEST_RESTORE_QUICK_TAB:', message.data);
      try {
        if (!quickTabsManager || !quickTabsManager.panelManager) {
          throw new Error('QuickTabsManager or PanelManager not initialized');
        }
        
        const { id } = message.data;
        quickTabsManager.panelManager.restoreTab(id);
        
        sendResponse({
          success: true,
          message: 'Quick Tab restored',
          data: { id }
        });
      } catch (error) {
        console.error('[Test Bridge Handler] TEST_RESTORE_QUICK_TAB error:', error);
        sendResponse({
          success: false,
          error: error.message
        });
      }
      return true;
    }

    // eslint-disable-next-line max-depth
    if (message.type === 'TEST_PIN_QUICK_TAB') {
      console.log('[Test Bridge Handler] TEST_PIN_QUICK_TAB:', message.data);
      (async () => {
        try {
          if (!quickTabsManager) {
            throw new Error('QuickTabsManager not initialized');
          }
          
          const { id } = message.data;
          const tab = quickTabsManager.tabs.get(id);
          
          if (!tab) {
            throw new Error(`Quick Tab not found: ${id}`);
          }
          
          // Get current tab URL for pinning
          const currentUrl = window.location.href;
          tab.pinnedToUrl = currentUrl;
          
          // Update in storage
          await quickTabsManager.storage.saveQuickTab(tab);
          
          sendResponse({
            success: true,
            message: 'Quick Tab pinned',
            data: { id, pinnedToUrl: currentUrl }
          });
        } catch (error) {
          console.error('[Test Bridge Handler] TEST_PIN_QUICK_TAB error:', error);
          sendResponse({
            success: false,
            error: error.message
          });
        }
      })();
      return true;
    }

    // eslint-disable-next-line max-depth
    if (message.type === 'TEST_UNPIN_QUICK_TAB') {
      console.log('[Test Bridge Handler] TEST_UNPIN_QUICK_TAB:', message.data);
      (async () => {
        try {
          if (!quickTabsManager) {
            throw new Error('QuickTabsManager not initialized');
          }
          
          const { id } = message.data;
          const tab = quickTabsManager.tabs.get(id);
          
          if (!tab) {
            throw new Error(`Quick Tab not found: ${id}`);
          }
          
          // Unpin by setting to null
          tab.pinnedToUrl = null;
          
          // Update in storage
          await quickTabsManager.storage.saveQuickTab(tab);
          
          sendResponse({
            success: true,
            message: 'Quick Tab unpinned',
            data: { id }
          });
        } catch (error) {
          console.error('[Test Bridge Handler] TEST_UNPIN_QUICK_TAB error:', error);
          sendResponse({
            success: false,
            error: error.message
          });
        }
      })();
      return true;
    }

    // eslint-disable-next-line max-depth
    if (message.type === 'TEST_CLOSE_QUICK_TAB') {
      console.log('[Test Bridge Handler] TEST_CLOSE_QUICK_TAB:', message.data);
      try {
        if (!quickTabsManager) {
          throw new Error('QuickTabsManager not initialized');
        }
        
        const { id } = message.data;
        quickTabsManager.closeQuickTab(id);
        
        sendResponse({
          success: true,
          message: 'Quick Tab closed',
          data: { id }
        });
      } catch (error) {
        console.error('[Test Bridge Handler] TEST_CLOSE_QUICK_TAB error:', error);
        sendResponse({
          success: false,
          error: error.message
        });
      }
      return true;
    }

    // eslint-disable-next-line max-depth
    if (message.type === 'TEST_CLEAR_ALL_QUICK_TAB') {
      console.log('[Test Bridge Handler] TEST_CLEAR_ALL_QUICK_TABS');
      try {
        if (!quickTabsManager) {
          throw new Error('QuickTabsManager not initialized');
        }
        
        // Close all Quick Tabs
        const tabIds = Array.from(quickTabsManager.tabs.keys());
        for (const id of tabIds) {
          quickTabsManager.closeQuickTab(id);
        }
        
        sendResponse({
          success: true,
          message: 'All Quick Tabs cleared',
          data: { count: tabIds.length }
        });
      } catch (error) {
        console.error('[Test Bridge Handler] TEST_CLEAR_ALL_QUICK_TABS error:', error);
        sendResponse({
          success: false,
          error: error.message
        });
      }
      return true;
    }

    // ==================== SOLO/MUTE HANDLERS ====================

    // eslint-disable-next-line max-depth
    if (message.type === 'TEST_TOGGLE_SOLO') {
      console.log('[Test Bridge Handler] TEST_TOGGLE_SOLO:', message.data);
      (async () => {
        try {
          if (!quickTabsManager) {
            throw new Error('QuickTabsManager not initialized');
          }
          
          const { id, tabId } = message.data;
          const tab = quickTabsManager.tabs.get(id);
          
          if (!tab) {
            throw new Error(`Quick Tab not found: ${id}`);
          }
          
          // Get the domain model
          const domainTab = tab.domainTab;
          if (!domainTab) {
            throw new Error(`Domain model not found for Quick Tab: ${id}`);
          }
          
          // Toggle solo on the domain model
          const isNowSoloed = domainTab.toggleSolo(tabId);
          
          // Update in storage
          await quickTabsManager.storage.saveQuickTab(domainTab);
          
          // Broadcast to other tabs
          if (quickTabsManager.broadcast) {
            quickTabsManager.broadcast.broadcastMessage('SOLO', {
              id,
              tabId,
              isNowSoloed,
              soloedOnTabs: domainTab.visibility.soloedOnTabs
            });
          }
          
          sendResponse({
            success: true,
            message: isNowSoloed ? 'Solo enabled' : 'Solo disabled',
            data: {
              id,
              tabId,
              isNowSoloed,
              soloedOnTabs: domainTab.visibility.soloedOnTabs,
              mutedOnTabs: domainTab.visibility.mutedOnTabs
            }
          });
        } catch (error) {
          console.error('[Test Bridge Handler] TEST_TOGGLE_SOLO error:', error);
          sendResponse({
            success: false,
            error: error.message
          });
        }
      })();
      return true;
    }

    // eslint-disable-next-line max-depth
    if (message.type === 'TEST_TOGGLE_MUTE') {
      console.log('[Test Bridge Handler] TEST_TOGGLE_MUTE:', message.data);
      (async () => {
        try {
          if (!quickTabsManager) {
            throw new Error('QuickTabsManager not initialized');
          }
          
          const { id, tabId } = message.data;
          const tab = quickTabsManager.tabs.get(id);
          
          if (!tab) {
            throw new Error(`Quick Tab not found: ${id}`);
          }
          
          // Get the domain model
          const domainTab = tab.domainTab;
          if (!domainTab) {
            throw new Error(`Domain model not found for Quick Tab: ${id}`);
          }
          
          // Toggle mute on the domain model
          const isNowMuted = domainTab.toggleMute(tabId);
          
          // Update in storage
          await quickTabsManager.storage.saveQuickTab(domainTab);
          
          // Broadcast to other tabs
          if (quickTabsManager.broadcast) {
            quickTabsManager.broadcast.broadcastMessage('MUTE', {
              id,
              tabId,
              isNowMuted,
              mutedOnTabs: domainTab.visibility.mutedOnTabs
            });
          }
          
          sendResponse({
            success: true,
            message: isNowMuted ? 'Mute enabled' : 'Mute disabled',
            data: {
              id,
              tabId,
              isNowMuted,
              soloedOnTabs: domainTab.visibility.soloedOnTabs,
              mutedOnTabs: domainTab.visibility.mutedOnTabs
            }
          });
        } catch (error) {
          console.error('[Test Bridge Handler] TEST_TOGGLE_MUTE error:', error);
          sendResponse({
            success: false,
            error: error.message
          });
        }
      })();
      return true;
    }

    // eslint-disable-next-line max-depth
    if (message.type === 'TEST_GET_VISIBILITY_STATE') {
      console.log('[Test Bridge Handler] TEST_GET_VISIBILITY_STATE:', message.data);
      (async () => {
        try {
          if (!quickTabsManager) {
            throw new Error('QuickTabsManager not initialized');
          }
          
          const { tabId } = message.data;
          const visibilityState = {
            tabId,
            visible: [],
            hidden: [],
            quickTabs: {}
          };
          
          // Check each Quick Tab
          for (const [id, tab] of quickTabsManager.tabs) {
            const domainTab = tab.domainTab;
            if (!domainTab) continue;
            
            const shouldBeVisible = domainTab.shouldBeVisible(tabId);
            const isSoloed = domainTab.visibility.soloedOnTabs.includes(tabId);
            const isMuted = domainTab.visibility.mutedOnTabs.includes(tabId);
            
            visibilityState.quickTabs[id] = {
              id,
              url: domainTab.url,
              title: domainTab.title,
              shouldBeVisible,
              isSoloed,
              isMuted,
              soloedOnTabs: domainTab.visibility.soloedOnTabs,
              mutedOnTabs: domainTab.visibility.mutedOnTabs
            };
            
            if (shouldBeVisible) {
              visibilityState.visible.push(id);
            } else {
              visibilityState.hidden.push(id);
            }
          }
          
          sendResponse({
            success: true,
            data: visibilityState
          });
        } catch (error) {
          console.error('[Test Bridge Handler] TEST_GET_VISIBILITY_STATE error:', error);
          sendResponse({
            success: false,
            error: error.message
          });
        }
      })();
      return true;
    }

    // ==================== MANAGER PANEL HANDLERS ====================

    // eslint-disable-next-line max-depth
    if (message.type === 'TEST_GET_MANAGER_STATE') {
      console.log('[Test Bridge Handler] TEST_GET_MANAGER_STATE');
      try {
        if (!quickTabsManager || !quickTabsManager.panelManager) {
          throw new Error('QuickTabsManager or PanelManager not initialized');
        }
        
        const panelManager = quickTabsManager.panelManager;
        const stateManager = panelManager.stateManager;
        
        // Get current panel state
        const panelState = stateManager ? stateManager.panelState : null;
        const isVisible = panelManager.panel ? (panelManager.panel.style.display !== 'none') : false;
        
        // Get minimized tabs
        const minimizedTabs = Array.from(quickTabsManager.tabs.values())
          .filter(tab => tab.domainTab && tab.domainTab.isMinimized)
          .map(tab => ({
            id: tab.id,
            url: tab.domainTab.url,
            title: tab.domainTab.title
          }));
        
        sendResponse({
          success: true,
          data: {
            visible: isVisible,
            position: panelState ? { left: panelState.left, top: panelState.top } : null,
            size: panelState ? { width: panelState.width, height: panelState.height } : null,
            minimizedTabs,
            minimizedCount: minimizedTabs.length
          }
        });
      } catch (error) {
        console.error('[Test Bridge Handler] TEST_GET_MANAGER_STATE error:', error);
        sendResponse({
          success: false,
          error: error.message
        });
      }
      return true;
    }

    // eslint-disable-next-line max-depth
    if (message.type === 'TEST_SET_MANAGER_POSITION') {
      console.log('[Test Bridge Handler] TEST_SET_MANAGER_POSITION:', message.data);
      try {
        if (!quickTabsManager || !quickTabsManager.panelManager) {
          throw new Error('QuickTabsManager or PanelManager not initialized');
        }
        
        const { x, y } = message.data;
        const panelManager = quickTabsManager.panelManager;
        
        // Update panel position
        if (panelManager.panel) {
          panelManager.panel.style.left = `${x}px`;
          panelManager.panel.style.top = `${y}px`;
          
          // Update state
          if (panelManager.stateManager) {
            panelManager.stateManager.panelState.left = x;
            panelManager.stateManager.panelState.top = y;
          }
        }
        
        sendResponse({
          success: true,
          message: 'Manager position updated',
          data: { x, y }
        });
      } catch (error) {
        console.error('[Test Bridge Handler] TEST_SET_MANAGER_POSITION error:', error);
        sendResponse({
          success: false,
          error: error.message
        });
      }
      return true;
    }

    // eslint-disable-next-line max-depth
    if (message.type === 'TEST_SET_MANAGER_SIZE') {
      console.log('[Test Bridge Handler] TEST_SET_MANAGER_SIZE:', message.data);
      try {
        if (!quickTabsManager || !quickTabsManager.panelManager) {
          throw new Error('QuickTabsManager or PanelManager not initialized');
        }
        
        const { width, height } = message.data;
        const panelManager = quickTabsManager.panelManager;
        
        // Update panel size
        if (panelManager.panel) {
          panelManager.panel.style.width = `${width}px`;
          panelManager.panel.style.height = `${height}px`;
          
          // Update state
          if (panelManager.stateManager) {
            panelManager.stateManager.panelState.width = width;
            panelManager.stateManager.panelState.height = height;
          }
        }
        
        sendResponse({
          success: true,
          message: 'Manager size updated',
          data: { width, height }
        });
      } catch (error) {
        console.error('[Test Bridge Handler] TEST_SET_MANAGER_SIZE error:', error);
        sendResponse({
          success: false,
          error: error.message
        });
      }
      return true;
    }

    // eslint-disable-next-line max-depth
    if (message.type === 'TEST_CLOSE_ALL_MINIMIZED') {
      console.log('[Test Bridge Handler] TEST_CLOSE_ALL_MINIMIZED');
      try {
        if (!quickTabsManager) {
          throw new Error('QuickTabsManager not initialized');
        }
        
        // Find all minimized tabs
        const minimizedIds = Array.from(quickTabsManager.tabs.values())
          .filter(tab => tab.domainTab && tab.domainTab.isMinimized)
          .map(tab => tab.id);
        
        // Close each minimized tab
        for (const id of minimizedIds) {
          quickTabsManager.closeQuickTab(id);
        }
        
        sendResponse({
          success: true,
          message: 'All minimized Quick Tabs closed',
          data: { count: minimizedIds.length, closedIds: minimizedIds }
        });
      } catch (error) {
        console.error('[Test Bridge Handler] TEST_CLOSE_ALL_MINIMIZED error:', error);
        sendResponse({
          success: false,
          error: error.message
        });
      }
      return true;
    }

    // ==================== CONTAINER ISOLATION HANDLERS ====================

    // eslint-disable-next-line max-depth
    if (message.type === 'TEST_GET_CONTAINER_INFO') {
      console.log('[Test Bridge Handler] TEST_GET_CONTAINER_INFO');
      (async () => {
        try {
          if (!quickTabsManager) {
            throw new Error('QuickTabsManager not initialized');
          }
          
          const containerInfo = {
            currentContainer: quickTabsManager.cookieStoreId || 'firefox-default',
            containers: {}
          };
          
          // Group Quick Tabs by container
          for (const [id, tab] of quickTabsManager.tabs) {
            const domainTab = tab.domainTab;
            if (!domainTab) continue;
            
            const containerId = domainTab.cookieStoreId || 'firefox-default';
            
            if (!containerInfo.containers[containerId]) {
              containerInfo.containers[containerId] = {
                id: containerId,
                quickTabs: []
              };
            }
            
            containerInfo.containers[containerId].quickTabs.push({
              id,
              url: domainTab.url,
              title: domainTab.title,
              cookieStoreId: domainTab.cookieStoreId
            });
          }
          
          sendResponse({
            success: true,
            data: containerInfo
          });
        } catch (error) {
          console.error('[Test Bridge Handler] TEST_GET_CONTAINER_INFO error:', error);
          sendResponse({
            success: false,
            error: error.message
          });
        }
      })();
      return true;
    }

    // eslint-disable-next-line max-depth
    if (message.type === 'TEST_CREATE_QUICK_TAB_IN_CONTAINER') {
      console.log('[Test Bridge Handler] TEST_CREATE_QUICK_TAB_IN_CONTAINER:', message.data);
      (async () => {
        try {
          if (!quickTabsManager) {
            throw new Error('QuickTabsManager not initialized');
          }
          
          const { url, cookieStoreId } = message.data;
          
          // Create Quick Tab with explicit container
          quickTabsManager.createQuickTab({
            url,
            title: 'Test Quick Tab',
            cookieStoreId
          });
          
          sendResponse({
            success: true,
            message: 'Quick Tab created in container',
            data: { url, cookieStoreId }
          });
        } catch (error) {
          console.error('[Test Bridge Handler] TEST_CREATE_QUICK_TAB_IN_CONTAINER error:', error);
          sendResponse({
            success: false,
            error: error.message
          });
        }
      })();
      return true;
    }

    // eslint-disable-next-line max-depth
    if (message.type === 'TEST_VERIFY_CONTAINER_ISOLATION') {
      console.log('[Test Bridge Handler] TEST_VERIFY_CONTAINER_ISOLATION:', message.data);
      (async () => {
        try {
          if (!quickTabsManager) {
            throw new Error('QuickTabsManager not initialized');
          }
          
          const { id1, id2 } = message.data;
          const tab1 = quickTabsManager.tabs.get(id1);
          const tab2 = quickTabsManager.tabs.get(id2);
          
          if (!tab1 || !tab1.domainTab) {
            throw new Error(`Quick Tab not found: ${id1}`);
          }
          if (!tab2 || !tab2.domainTab) {
            throw new Error(`Quick Tab not found: ${id2}`);
          }
          
          const container1 = tab1.domainTab.cookieStoreId || 'firefox-default';
          const container2 = tab2.domainTab.cookieStoreId || 'firefox-default';
          const isIsolated = container1 !== container2;
          
          sendResponse({
            success: true,
            data: {
              id1,
              id2,
              container1,
              container2,
              isIsolated
            }
          });
        } catch (error) {
          console.error('[Test Bridge Handler] TEST_VERIFY_CONTAINER_ISOLATION error:', error);
          sendResponse({
            success: false,
            error: error.message
          });
        }
      })();
      return true;
    }

    // ==================== DEBUG MODE HANDLERS ====================

    // eslint-disable-next-line max-depth
    if (message.type === 'TEST_GET_SLOT_NUMBERING') {
      console.log('[Test Bridge Handler] TEST_GET_SLOT_NUMBERING');
      (async () => {
        try {
          if (!quickTabsManager) {
            throw new Error('QuickTabsManager not initialized');
          }
          
          // Get slot numbering info from minimized manager
          const slotInfo = {
            slots: []
          };
          
          if (quickTabsManager.minimizedManager) {
            const slots = quickTabsManager.minimizedManager.slots || [];
            slotInfo.slots = slots.map((slot, index) => ({
              slotNumber: index + 1,
              isOccupied: slot !== null,
              quickTabId: slot ? slot.id : null
            }));
          }
          
          sendResponse({
            success: true,
            data: slotInfo
          });
        } catch (error) {
          console.error('[Test Bridge Handler] TEST_GET_SLOT_NUMBERING error:', error);
          sendResponse({
            success: false,
            error: error.message
          });
        }
      })();
      return true;
    }

    // eslint-disable-next-line max-depth
    if (message.type === 'TEST_SET_DEBUG_MODE') {
      console.log('[Test Bridge Handler] TEST_SET_DEBUG_MODE:', message.data);
      (async () => {
        try {
          const { enabled } = message.data;
          
          // Update debug mode in storage
          await browser.storage.local.set({ debugMode: enabled });
          
          sendResponse({
            success: true,
            message: enabled ? 'Debug mode enabled' : 'Debug mode disabled',
            data: { enabled }
          });
        } catch (error) {
          console.error('[Test Bridge Handler] TEST_SET_DEBUG_MODE error:', error);
          sendResponse({
            success: false,
            error: error.message
          });
        }
      })();
      return true;
    }

    // ==================== GEOMETRY/Z-INDEX HANDLERS ====================

    // eslint-disable-next-line max-depth
    if (message.type === 'TEST_GET_QUICK_TAB_GEOMETRY') {
      console.log('[Test Bridge Handler] TEST_GET_QUICK_TAB_GEOMETRY:', message.data);
      try {
        if (!quickTabsManager) {
          throw new Error('QuickTabsManager not initialized');
        }
        
        const { id } = message.data;
        const tab = quickTabsManager.tabs.get(id);
        
        if (!tab) {
          throw new Error(`Quick Tab not found: ${id}`);
        }
        
        // Get geometry from DOM element
        const element = tab.element;
        if (!element) {
          throw new Error(`DOM element not found for Quick Tab: ${id}`);
        }
        
        const rect = element.getBoundingClientRect();
        const computedStyle = window.getComputedStyle(element);
        
        sendResponse({
          success: true,
          data: {
            id,
            position: {
              left: parseFloat(element.style.left) || rect.left,
              top: parseFloat(element.style.top) || rect.top
            },
            size: {
              width: parseFloat(element.style.width) || rect.width,
              height: parseFloat(element.style.height) || rect.height
            },
            zIndex: parseInt(computedStyle.zIndex, 10) || 0
          }
        });
      } catch (error) {
        console.error('[Test Bridge Handler] TEST_GET_QUICK_TAB_GEOMETRY error:', error);
        sendResponse({
          success: false,
          error: error.message
        });
      }
      return true;
    }

    // eslint-disable-next-line max-depth
    if (message.type === 'TEST_VERIFY_ZINDEX_ORDER') {
      console.log('[Test Bridge Handler] TEST_VERIFY_ZINDEX_ORDER:', message.data);
      try {
        if (!quickTabsManager) {
          throw new Error('QuickTabsManager not initialized');
        }
        
        const { ids } = message.data;
        const zIndexData = [];
        
        // Get z-index for each Quick Tab
        for (const id of ids) {
          const tab = quickTabsManager.tabs.get(id);
          if (!tab || !tab.element) {
            throw new Error(`Quick Tab or element not found: ${id}`);
          }
          
          const computedStyle = window.getComputedStyle(tab.element);
          const zIndex = parseInt(computedStyle.zIndex, 10) || 0;
          
          zIndexData.push({ id, zIndex });
        }
        
        // Verify order (higher z-index = front)
        let isCorrectOrder = true;
        for (let i = 0; i < zIndexData.length - 1; i++) {
          if (zIndexData[i].zIndex <= zIndexData[i + 1].zIndex) {
            isCorrectOrder = false;
            break;
          }
        }
        
        sendResponse({
          success: true,
          data: {
            ids,
            zIndexData,
            isCorrectOrder
          }
        });
      } catch (error) {
        console.error('[Test Bridge Handler] TEST_VERIFY_ZINDEX_ORDER error:', error);
        sendResponse({
          success: false,
          error: error.message
        });
      }
      return true;
    }

    // ==================== END TEST BRIDGE MESSAGE HANDLERS ====================
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
