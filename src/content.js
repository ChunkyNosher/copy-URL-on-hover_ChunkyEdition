/**
 * Copy URL on Hover - Enhanced with Quick Tabs
 * Main Content Script Entry Point (Modular Architecture v1.5.8.2)
 *
 * This file serves as the main entry point and coordinates between modules.
 * URL handlers have been extracted to features/url-handlers/ for better maintainability.
 */

// Verify content script is loading
// Import core modules
import { ConfigManager, DEFAULT_CONFIG, CONSTANTS } from "./core/config.js";
import { StateManager } from "./core/state.js";
import { EventBus, Events } from "./core/events.js";
import { debug, enableDebug, disableDebug } from "./utils/debug.js";
import {
  copyToClipboard,
  getStorage,
  setStorage,
  sendMessageToBackground,
} from "./utils/browser-api.js";
import { createElement } from "./utils/dom.js";

// Import URL handlers
import { URLHandlerRegistry } from "./features/url-handlers/index.js";
import { getLinkText } from "./features/url-handlers/generic.js";

console.log(
  "[Copy-URL-on-Hover] Content script loaded at:",
  new Date().toISOString(),
);

// Initialize core systems
console.log("[Copy-URL-on-Hover] Initializing core systems...");
const configManager = new ConfigManager();
console.log("[Copy-URL-on-Hover] ConfigManager initialized");
const stateManager = new StateManager();
console.log("[Copy-URL-on-Hover] StateManager initialized");
const eventBus = new EventBus();
console.log("[Copy-URL-on-Hover] EventBus initialized");
const urlRegistry = new URLHandlerRegistry();
console.log("[Copy-URL-on-Hover] URLHandlerRegistry initialized");

// Load configuration
let CONFIG = { ...DEFAULT_CONFIG };

// Initialize extension
(async function initExtension() {
  try {
    console.log("[Copy-URL-on-Hover] Starting extension initialization...");

    // Load user configuration
    CONFIG = await configManager.load();
    console.log("[Copy-URL-on-Hover] Configuration loaded");

    // Enable debug mode if configured
    if (CONFIG.debugMode) {
      enableDebug();
      eventBus.enableDebug();
      debug("Debug mode enabled");
    }

    // Initialize state
    stateManager.setState({
      quickTabZIndex: CONSTANTS.QUICK_TAB_BASE_Z_INDEX,
    });
    console.log("[Copy-URL-on-Hover] State initialized");

    debug("Extension initialized successfully");

    // Start main functionality
    await initMainFeatures();
    console.log("[Copy-URL-on-Hover] Main features initialized successfully");
  } catch (err) {
    console.error("[Copy-URL-on-Hover] Critical Init Error:", err);
    alert("Copy-URL-on-Hover failed to initialize. Check console for details.");
  }
})();

/**
 * Initialize main features
 */
async function initMainFeatures() {
  // This function will be populated with the remaining content.js functionality
  // For now, we'll load it from the legacy content file
  debug("Loading main features...");

  // Track mouse position for Quick Tab placement
  document.addEventListener(
    "mousemove",
    function (event) {
      stateManager.set("lastMouseX", event.clientX);
      stateManager.set("lastMouseY", event.clientY);
    },
    true,
  );

  // Set up hover detection
  setupHoverDetection();

  // Set up keyboard shortcuts
  setupKeyboardShortcuts();

  // Initialize Quick Tabs if enabled
  if (CONFIG.quickTabPersistAcrossTabs) {
    await initQuickTabs();
  }

  // Initialize Panel Manager
  await initPanelManager();
}

/**
 * Get domain type from current URL
 */
function getDomainType() {
  const hostname = window.location.hostname.toLowerCase();

  // Check against all supported domains
  const domainMappings = {
    "twitter.com": "twitter",
    "x.com": "twitter",
    "reddit.com": "reddit",
    "linkedin.com": "linkedin",
    "instagram.com": "instagram",
    "facebook.com": "facebook",
    "tiktok.com": "tiktok",
    "threads.net": "threads",
    "bsky.app": "bluesky",
    "youtube.com": "youtube",
    "vimeo.com": "vimeo",
    "github.com": "github",
    "gitlab.com": "gitlab",
    "stackoverflow.com": "stackoverflow",
    "medium.com": "medium",
    "amazon.com": "amazon",
    "ebay.com": "ebay",
    "pinterest.com": "pinterest",
    "wikipedia.org": "wikipedia",
    "netflix.com": "netflix",
    "spotify.com": "spotify",
    "twitch.tv": "twitch",
    steam: "steam",
    // Add more mappings as needed
  };

  // Check for exact matches
  for (const [domain, type] of Object.entries(domainMappings)) {
    if (hostname.includes(domain)) {
      return type;
    }
  }

  return "generic";
}

/**
 * Set up hover detection
 */
function setupHoverDetection() {
  document.addEventListener("mouseover", function (event) {
    const domainType = getDomainType();
    const element = event.target;

    // Find URL using the modular URL registry
    const url = urlRegistry.findURL(element, domainType);

    // Always set element, URL can be null
    stateManager.setState({
      currentHoveredLink: url || null, // Set to null if not found
      currentHoveredElement: element,
    });

    if (url) {
      eventBus.emit(Events.HOVER_START, { url, element, domainType });
    }
  });

  document.addEventListener("mouseout", function (event) {
    stateManager.setState({
      currentHoveredLink: null,
      currentHoveredElement: null,
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
    (element.tagName === "INPUT" ||
      element.tagName === "TEXTAREA" ||
      element.isContentEditable ||
      element.closest('[contenteditable="true"]'))
  );
}

/**
 * Set up keyboard shortcuts
 */
function setupKeyboardShortcuts() {
  document.addEventListener("keydown", async function (event) {
    // Ignore if typing in an interactive field
    if (isInputField(event.target)) {
      return;
    }

    const hoveredLink = stateManager.get("currentHoveredLink");
    const hoveredElement = stateManager.get("currentHoveredElement");

    // Don't exit early - some shortcuts don't need a URL!

    // Check for copy URL shortcut (needs URL)
    if (
      checkShortcut(
        event,
        CONFIG.copyUrlKey,
        CONFIG.copyUrlCtrl,
        CONFIG.copyUrlAlt,
        CONFIG.copyUrlShift,
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
        CONFIG.copyTextShift,
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
        CONFIG.quickTabShift,
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
        CONFIG.openNewTabShift,
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
      showNotification("✓ URL copied!", "success");
      debug("Copied URL:", url);
    } else {
      showNotification("✗ Failed to copy URL", "error");
    }
  } catch (err) {
    console.error("[Copy URL] Failed:", err);
    showNotification("✗ Failed to copy URL", "error");
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
      showNotification("✓ Text copied!", "success");
      debug("Copied text:", text);
    } else {
      showNotification("✗ Failed to copy text", "error");
    }
  } catch (err) {
    console.error("[Copy Text] Failed:", err);
    showNotification("✗ Failed to copy text", "error");
  }
}

/**
 * Handle create Quick Tab action
 */
async function handleCreateQuickTab(url) {
  debug("Creating Quick Tab for:", url);
  eventBus.emit(Events.QUICK_TAB_REQUESTED, { url });
  // Quick Tab creation logic will be implemented in quick-tabs module
}

/**
 * Handle open in new tab action
 */
async function handleOpenInNewTab(url) {
  try {
    await sendMessageToBackground({
      action: "openInNewTab",
      url,
      switchFocus: CONFIG.openNewTabSwitchFocus,
    });

    eventBus.emit(Events.LINK_OPENED, { url });
    showNotification("✓ Opened in new tab", "success");
    debug("Opened in new tab:", url);
  } catch (err) {
    console.error("[Open Tab] Failed:", err);
    showNotification("✗ Failed to open tab", "error");
  }
}

/**
 * Show notification to user
 */
function showNotification(message, type = "info") {
  if (!CONFIG.showNotification) return;

  // Simple notification implementation
  // Full implementation will be in ui/notifications.js module
  debug("Notification:", message, type);

  if (CONFIG.notifDisplayMode === "tooltip") {
    showTooltip(message);
  } else {
    showToast(message, type);
  }
}

/**
 * Show tooltip notification
 */
function showTooltip(message) {
  const existing = document.getElementById("copy-url-tooltip");
  if (existing) existing.remove();

  const mouseX = stateManager.get("lastMouseX") || 0;
  const mouseY = stateManager.get("lastMouseY") || 0;

  const tooltip = createElement(
    "div",
    {
      id: "copy-url-tooltip",
      style: {
        position: "fixed",
        left: `${mouseX + CONSTANTS.TOOLTIP_OFFSET_X}px`,
        top: `${mouseY + CONSTANTS.TOOLTIP_OFFSET_Y}px`,
        backgroundColor: CONFIG.tooltipColor,
        color: "white",
        padding: "8px 12px",
        borderRadius: "4px",
        fontSize: "14px",
        zIndex: "999999999",
        pointerEvents: "none",
        opacity: "1",
        transition: "opacity 0.2s",
      },
    },
    message,
  );

  document.body.appendChild(tooltip);

  setTimeout(() => {
    tooltip.style.opacity = "0";
    setTimeout(() => tooltip.remove(), CONSTANTS.TOOLTIP_FADE_OUT_MS);
  }, CONFIG.tooltipDuration);
}

/**
 * Show toast notification
 */
function showToast(message, type) {
  const existing = document.getElementById("copy-url-toast");
  if (existing) existing.remove();

  const positions = {
    "top-left": { top: "20px", left: "20px" },
    "top-right": { top: "20px", right: "20px" },
    "bottom-left": { bottom: "20px", left: "20px" },
    "bottom-right": { bottom: "20px", right: "20px" },
  };

  const pos = positions[CONFIG.notifPosition] || positions["bottom-right"];

  const toast = createElement(
    "div",
    {
      id: "copy-url-toast",
      style: {
        position: "fixed",
        ...pos,
        backgroundColor: CONFIG.notifColor,
        color: "white",
        padding: "12px 20px",
        borderRadius: "4px",
        fontSize: "14px",
        zIndex: "999999999",
        border: `${CONFIG.notifBorderWidth}px solid ${CONFIG.notifBorderColor}`,
        boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
        opacity: "1",
        transition: "opacity 0.3s",
      },
    },
    message,
  );

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, CONFIG.notifDuration);
}

/**
 * Initialize Quick Tabs functionality
 */
async function initQuickTabs() {
  debug("Initializing Quick Tabs...");
  // Quick Tabs implementation will be loaded from quick-tabs module
  // For now, this is a placeholder
}

/**
 * Initialize Panel Manager
 */
async function initPanelManager() {
  debug("Initializing Panel Manager...");
  // Panel implementation will be loaded from panel module
  // For now, this is a placeholder
}

// Export for testing and module access
if (typeof window !== "undefined") {
  window.CopyURLExtension = {
    configManager,
    stateManager,
    eventBus,
    urlRegistry,
    CONFIG,
  };
}
