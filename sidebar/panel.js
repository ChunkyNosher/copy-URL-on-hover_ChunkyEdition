// Sidebar panel JavaScript for Quick Tabs live state debugging

// Storage keys
const STATE_KEY = "quick_tabs_state_v2";
const SESSION_KEY = "quick_tabs_session";

// Auto-refresh interval
let refreshInterval;

// Initialize panel
document.addEventListener("DOMContentLoaded", () => {
  checkSessionStorageAvailability();
  displayAllQuickTabs();
  setupEventListeners();

  // Auto-refresh every 2 seconds
  refreshInterval = setInterval(displayAllQuickTabs, 2000);
});

// Clean up on unload
window.addEventListener("unload", () => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
});

/**
 * Check if session storage is available
 */
function checkSessionStorageAvailability() {
  const hasSessionStorage =
    typeof browser !== "undefined" &&
    browser.storage &&
    typeof browser.storage.session !== "undefined";

  const statusElement = document.getElementById("sessionStatus");
  if (hasSessionStorage) {
    statusElement.textContent = "✓ Available";
    statusElement.style.color = "#155724";
  } else {
    statusElement.textContent = "✗ Not Available";
    statusElement.style.color = "#856404";
  }
}

/**
 * Display all Quick Tabs from storage
 */
async function displayAllQuickTabs() {
  try {
    // Try session storage first, fall back to sync
    let state = null;

    if (typeof browser.storage.session !== "undefined") {
      const sessionResult = await browser.storage.session.get(SESSION_KEY);
      if (sessionResult && sessionResult[SESSION_KEY]) {
        state = sessionResult[SESSION_KEY];
      }
    }

    if (!state) {
      const syncResult = await browser.storage.sync.get(STATE_KEY);
      if (syncResult && syncResult[STATE_KEY]) {
        state = syncResult[STATE_KEY];
      }
    }

    const container = document.getElementById("quickTabsList");
    const tabCountElement = document.getElementById("tabCount");
    const lastSyncElement = document.getElementById("lastSync");

    if (!state || !state.tabs || state.tabs.length === 0) {
      container.innerHTML = '<div class="no-tabs">No Quick Tabs open</div>';
      tabCountElement.textContent = "0";
      lastSyncElement.textContent = "Never";
      return;
    }

    // Update tab count
    tabCountElement.textContent = state.tabs.length;

    // Update last sync time
    if (state.timestamp) {
      const date = new Date(state.timestamp);
      lastSyncElement.textContent = date.toLocaleTimeString();
    }

    // Display all tabs
    container.innerHTML = "";
    state.tabs.forEach((tab, index) => {
      const tabElement = createTabElement(tab, index);
      container.appendChild(tabElement);
    });
  } catch (err) {
    console.error("Error displaying Quick Tabs:", err);
    showStatus("Error loading Quick Tabs", "error");
  }
}

/**
 * Create a tab element for display
 */
function createTabElement(tab, index) {
  const div = document.createElement("div");
  div.className = "quick-tab-item";

  if (tab.pinnedToUrl) {
    div.classList.add("pinned");
  }

  // Create URL display
  const urlDiv = document.createElement("div");
  urlDiv.className = "tab-url";
  urlDiv.textContent = tab.url;
  div.appendChild(urlDiv);

  // Create details
  const detailsDiv = document.createElement("div");
  detailsDiv.className = "tab-details";

  // Position and size
  const posSize = `${Math.round(tab.left)}px, ${Math.round(tab.top)}px • ${Math.round(tab.width)}×${Math.round(tab.height)}px`;
  detailsDiv.textContent = posSize;
  div.appendChild(detailsDiv);

  // Badges
  const badgesDiv = document.createElement("div");

  if (tab.pinnedToUrl) {
    const pinnedBadge = document.createElement("span");
    pinnedBadge.className = "tab-badge pinned";
    pinnedBadge.textContent = `📌 Pinned to: ${new URL(tab.pinnedToUrl).hostname}`;
    badgesDiv.appendChild(pinnedBadge);
  }

  const indexBadge = document.createElement("span");
  indexBadge.className = "tab-badge";
  indexBadge.textContent = `#${index + 1}`;
  badgesDiv.appendChild(indexBadge);

  div.appendChild(badgesDiv);

  return div;
}

/**
 * Clear all Quick Tabs
 */
async function clearAllQuickTabs() {
  if (
    !confirm(
      "Clear all Quick Tabs? This will close all Quick Tabs in all tabs.",
    )
  ) {
    return;
  }

  try {
    // Clear from sync storage
    await browser.storage.sync.remove(STATE_KEY);

    // Clear from session storage if available
    if (typeof browser.storage.session !== "undefined") {
      await browser.storage.session.remove(SESSION_KEY);
    }

    showStatus("All Quick Tabs cleared!", "success");
    await displayAllQuickTabs();

    // Notify all tabs to close Quick Tabs
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      browser.tabs
        .sendMessage(tab.id, {
          action: "CLEAR_ALL_QUICK_TABS",
        })
        .catch(() => {
          // Ignore errors for tabs where content script isn't loaded
        });
    }
  } catch (err) {
    console.error("Error clearing Quick Tabs:", err);
    showStatus("Error clearing Quick Tabs", "error");
  }
}

/**
 * Show status message
 */
function showStatus(message, type) {
  const statusElement = document.getElementById("status");
  statusElement.textContent = message;
  statusElement.className = `status ${type}`;
  statusElement.style.display = "block";

  // Auto-hide after 3 seconds
  setTimeout(() => {
    statusElement.style.display = "none";
  }, 3000);
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  document
    .getElementById("refreshBtn")
    .addEventListener("click", displayAllQuickTabs);
  document
    .getElementById("clearAllBtn")
    .addEventListener("click", clearAllQuickTabs);
}

// Listen for storage changes to auto-update
browser.storage.onChanged.addListener((changes, areaName) => {
  if (
    (areaName === "sync" && changes[STATE_KEY]) ||
    (areaName === "session" && changes[SESSION_KEY])
  ) {
    displayAllQuickTabs();
  }
});
