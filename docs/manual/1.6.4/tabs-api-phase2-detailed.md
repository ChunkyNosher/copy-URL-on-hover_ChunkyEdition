# Tabs API Deep Implementation: Post-Port-Messaging Integration

## Detailed Specification for Quick Tabs Origin Tracking, Lifecycle Management & Smart Adoption

**Date:** December 17, 2025  
**Phase:** 2 (After port-based adoption messaging is working)  
**Status:** Ready for implementation after Issue #47 is fixed  
**Estimated Effort:** 10-15 hours

---

## Table of Contents

1. [Overview: What Tabs API Enables](#overview)
2. [Data Model Enhancement](#data-model-enhancement)
3. [Content Script Integration: Capturing Tab Context](#content-script-integration)
4. [Background Script: Tab Lifecycle Handler](#background-script-integration)
5. [Port Messaging: Broadcasting Tab Events](#port-messaging-extension)
6. [Sidebar Manager: Displaying Tab Context](#sidebar-manager-display)
7. [Advanced Features: Smart Adoption & Orphan Handling](#advanced-features)
8. [Storage Migration Strategy](#storage-migration)
9. [Testing & Verification](#testing-verification)

---

## Overview: What Tabs API Enables {#overview}

After port-based adoption messaging is working, Tabs API integration adds these
capabilities:

### User-Facing Features

1. **Origin Tab Context** - Display which tab created each Quick Tab
   - Favicon of origin site
   - Origin tab title
   - Link to "jump to origin tab"
   - Domain/site indicator

2. **Orphan Detection** - Automatically detect when origin tab is closed
   - Mark orphaned Quick Tabs
   - Show warning badge
   - Optionally auto-close or keep
   - Prevent adoption to closed tabs

3. **Tab-Scoped Organization** - Group and manage Quick Tabs by origin
   - Sidebar groups by origin tab
   - Show count of Quick Tabs per tab
   - Filter/show-hide by tab
   - Visual tab hierarchy

4. **Smart Adoption** - Better adoption logic based on real tab state
   - Can't adopt to non-existent tabs
   - Can't adopt between windows
   - Can't adopt across containers (optional enforcement)
   - Smarter z-index management

5. **Favicon Updates** - Dynamic favicon display
   - Show favicon next to Quick Tab title
   - Update if favicon loads asynchronously
   - Fallback to placeholder
   - Batch favicon requests

### Technical Benefits

- **Reduces Orphaned Quick Tabs** - System knows when to clean up
- **Improves Tab Safety** - Validates adoption targets
- **Smarter Filtering** - Show Quick Tabs relevant to active tab
- **Better Debugging** - Clear origin context in logs
- **Future-Proof** - Foundation for "pin to tab" and other features

---

## Data Model Enhancement {#data-model-enhancement}

### Current QuickTab Model

```javascript
class QuickTab {
  id: string                     // "qt-123-1765943899248-abc"
  url: string                    // "https://example.com"
  title: string                  // "Example Site"
  position: { left: number, top: number }
  size: { width: number, height: number }
  zIndex: number                 // Stacking order
  createdAt: number              // Timestamp
  lastModified: number           // Timestamp
  visibility: {
    minimized: boolean,
    soloedOnTabs: number[],      // Tab IDs where visible
    mutedOnTabs: number[]        // Tab IDs where hidden
  }
}
```

### New Properties to Add

```javascript
class QuickTab {
  // EXISTING PROPERTIES (unchanged)
  id: string
  url: string
  title: string
  position: { left, top }
  size: { width, height }
  zIndex: number
  createdAt: number
  lastModified: number
  visibility: { ... }

  // ===== NEW: TAB ORIGIN CONTEXT =====

  // Primary origin tracking
  originTabId: number | null     // ID of tab that created this
                                 // null = unknown or created before tracking added

  originTabTitle: string | null  // Title of origin tab when Quick Tab created
                                 // null = not captured yet

  originTabUrl: string | null    // URL of origin tab when Quick Tab created
                                 // null = not captured yet

  originDomain: string | null    // Domain extracted from originTabUrl
                                 // null = not captured yet

  originFavicon: string | null   // Favicon URL from origin tab
                                 // null = not available, will be loaded async

  // Lifecycle tracking
  isOrphaned: boolean            // true if origin tab was closed
                                 // Used to mark Quick Tabs for cleanup/warning

  orphanedAt: number | null      // Timestamp when origin tab closed
                                 // null = not orphaned

  originTabClosedTitle: string | null  // Title when closed (for context if needed)

  // Container context (from Tabs API)
  cookieStoreId: string          // "firefox-default" or "firefox-container-N"
                                 // Already exists, will be used with Tabs API
}
```

### Storage Schema Migration

**Version 1 → Version 2:**

```javascript
// Old Quick Tabs (v1) have no origin properties:
{
  id: "qt-123-123456-abc",
  url: "https://example.com",
  title: "Example",
  position: { left: 100, top: 100 },
  size: { width: 800, height: 600 },
  zIndex: 1000,
  ...
}

// New Quick Tabs (v2) include origin context:
{
  id: "qt-123-123456-abc",
  url: "https://example.com",
  title: "Example",
  position: { left: 100, top: 100 },
  size: { width: 800, height: 600 },
  zIndex: 1000,

  // NEW:
  originTabId: 42,
  originTabTitle: "StackOverflow - How to ...",
  originTabUrl: "https://stackoverflow.com/questions/...",
  originDomain: "stackoverflow.com",
  originFavicon: "https://stackoverflow.com/favicon.ico",
  isOrphaned: false,
  orphanedAt: null,
  originTabClosedTitle: null,
  cookieStoreId: "firefox-default",

  ...
}
```

**Migration Logic (transparent to user):**

```javascript
class StorageFormatMigrator {
  migrateToV2(oldQuickTab) {
    return {
      ...oldQuickTab,
      // Add default values for new properties
      originTabId: null,
      originTabTitle: null,
      originTabUrl: null,
      originDomain: null,
      originFavicon: null,
      isOrphaned: false,
      orphanedAt: null,
      originTabClosedTitle: null,
      // cookieStoreId might already exist
      cookieStoreId: oldQuickTab.cookieStoreId || 'firefox-default'
    };
  }
}
```

---

## Content Script Integration: Capturing Tab Context {#content-script-integration}

### What Happens When Quick Tab Created

When user copies/hovers URL or triggers Quick Tab creation, content script needs
to capture origin tab information.

### Implementation: Enhanced URL_COPIED Event

**File: `src/content.js`**

```javascript
// Current (before Tabs API integration):
eventBus.emit(Events.URL_COPIED, {
  url: 'https://example.com/article',
  timestamp: Date.now()
});

// Enhanced (after Tabs API integration):
async function handleCopyURL(url) {
  // Request current tab info from background
  const tabInfo = await browser.runtime.sendMessage({
    action: 'GET_CURRENT_TAB_FULL_INFO'
  });

  eventBus.emit(Events.URL_COPIED, {
    url,
    timestamp: Date.now(),

    // NEW: Tab origin context
    originTabId: tabInfo.id,
    originTabTitle: tabInfo.title,
    originTabUrl: tabInfo.url,
    originDomain: new URL(tabInfo.url).hostname,
    originFavicon: tabInfo.favIconUrl || null,

    // NEW: Container context
    cookieStoreId: tabInfo.cookieStoreId || 'firefox-default',

    // For debugging
    originTabContext: {
      tabId: tabInfo.id,
      title: tabInfo.title,
      url: tabInfo.url,
      active: tabInfo.active,
      status: tabInfo.status, // "loading" or "complete"
      favIconUrl: tabInfo.favIconUrl
    }
  });

  console.log('[CONTENT] URL copied with tab context', {
    url,
    originTabId: tabInfo.id,
    originTabTitle: tabInfo.title,
    originDomain: new URL(tabInfo.url).hostname
  });
}
```

### Background Message Handler

**File: `src/background/handlers/MessageRouter.js` or `browser-api.js`**

```javascript
messageRouter.register('GET_CURRENT_TAB_FULL_INFO', async (message, sender) => {
  // sender.tab is automatically populated by Firefox
  // Contains: id, title, url, favIconUrl, active, status, windowId, etc.

  try {
    const tabInfo = {
      id: sender.tab.id,
      title: sender.tab.title,
      url: sender.tab.url,
      favIconUrl: sender.tab.favIconUrl || null,
      active: sender.tab.active,
      status: sender.tab.status, // "loading" or "complete"
      windowId: sender.tab.windowId,
      index: sender.tab.index,
      pinned: sender.tab.pinned,
      audible: sender.tab.audible,
      muted: sender.tab.mutedInfo?.muted || false,
      cookieStoreId: sender.tab.cookieStoreId || 'firefox-default'
    };

    console.log('[BACKGROUND] GET_CURRENT_TAB_FULL_INFO', {
      tabId: tabInfo.id,
      title: tabInfo.title,
      url: tabInfo.url,
      cookieStoreId: tabInfo.cookieStoreId
    });

    return tabInfo;
  } catch (error) {
    console.error('[BACKGROUND] Error getting tab info:', error);
    return null;
  }
});
```

### Quick Tab Creation with Origin Context

**File: `src/background/handlers/QuickTabHandler.js` or `QuickTabFactory.js`**

```javascript
async function createQuickTabWithOriginContext(message, sender) {
  const {
    url,
    originTabId,
    originTabTitle,
    originTabUrl,
    originDomain,
    originFavicon,
    cookieStoreId
  } = message;

  const quickTab = new QuickTab({
    id: generateQuickTabId(),
    url,
    title: extractTitleFromUrl(url),

    // Position/size defaults (user can customize)
    position: { left: 100, top: 100 },
    size: { width: 800, height: 600 },
    zIndex: 1000,

    createdAt: Date.now(),
    lastModified: Date.now(),

    // NEW: Origin context from content script
    originTabId, // Which tab created this
    originTabTitle, // Title of origin tab
    originTabUrl, // URL of origin tab
    originDomain, // Domain for grouping
    originFavicon, // Favicon if available

    // NEW: Lifecycle tracking
    isOrphaned: false,
    orphanedAt: null,
    originTabClosedTitle: null,

    // Container context
    cookieStoreId,

    visibility: {
      minimized: false,
      soloedOnTabs: [originTabId], // Show on origin tab by default
      mutedOnTabs: []
    }
  });

  // Persist to storage
  await storage.saveQuickTab(quickTab);

  console.log('[QUICKTAB] Created with origin context', {
    quickTabId: quickTab.id,
    url: quickTab.url,
    originTabId: quickTab.originTabId,
    originDomain: quickTab.originDomain
  });

  return quickTab;
}
```

---

## Background Script: Tab Lifecycle Handler {#background-script-integration}

### New Component: TabLifecycleHandler

This handler listens to `browser.tabs` events and manages Quick Tab lifecycle.

**File: `src/background/handlers/TabLifecycleHandler.js` (new file)**

```javascript
/**
 * Manages Quick Tab lifecycle based on browser tab events
 * - Detects when origin tabs close → marks Quick Tabs as orphaned
 * - Broadcasts tab events to Manager via port
 * - Validates adoption targets
 * - Updates tab metadata (favicon, title)
 */
class TabLifecycleHandler {
  constructor(quickTabsManager, storage, portBroadcaster) {
    this.quickTabsManager = quickTabsManager;
    this.storage = storage;
    this.portBroadcaster = portBroadcaster;

    // Track which tabs are currently open
    this.openTabs = new Map(); // tabId -> { id, title, url, favIconUrl, ... }
  }

  async start() {
    console.log('[TAB_LIFECYCLE] Handler starting...');

    // Initialize open tabs snapshot
    await this.initializeOpenTabs();

    // Set up listeners
    browser.tabs.onCreated.addListener(this.handleTabCreated.bind(this));
    browser.tabs.onUpdated.addListener(this.handleTabUpdated.bind(this));
    browser.tabs.onActivated.addListener(this.handleTabActivated.bind(this));
    browser.tabs.onRemoved.addListener(this.handleTabRemoved.bind(this));

    console.log('[TAB_LIFECYCLE] Listeners registered');
  }

  async initializeOpenTabs() {
    try {
      const tabs = await browser.tabs.query({});
      for (const tab of tabs) {
        this.openTabs.set(tab.id, {
          id: tab.id,
          title: tab.title,
          url: tab.url,
          favIconUrl: tab.favIconUrl,
          active: tab.active,
          status: tab.status
        });
      }
      console.log(
        '[TAB_LIFECYCLE] Initialized with',
        this.openTabs.size,
        'open tabs'
      );
    } catch (error) {
      console.error('[TAB_LIFECYCLE] Error initializing:', error);
    }
  }

  async handleTabCreated(tab) {
    console.log('[TAB_LIFECYCLE] Tab created', {
      tabId: tab.id,
      title: tab.title
    });

    this.openTabs.set(tab.id, {
      id: tab.id,
      title: tab.title,
      url: tab.url,
      favIconUrl: tab.favIconUrl
    });

    // Broadcast to Manager for any UI updates
    this.portBroadcaster.broadcast({
      type: 'TAB_CREATED',
      tabId: tab.id,
      title: tab.title,
      url: tab.url,
      favIconUrl: tab.favIconUrl
    });
  }

  async handleTabUpdated(tabId, changeInfo, tab) {
    // Called frequently as page loads, focus changes, etc.
    // Only broadcast significant changes

    if (changeInfo.favIconUrl !== undefined) {
      console.log('[TAB_LIFECYCLE] Tab favicon updated', {
        tabId,
        favIconUrl: tab.favIconUrl
      });

      // Update our snapshot
      this.openTabs.get(tabId).favIconUrl = tab.favIconUrl;

      // Broadcast to Manager
      this.portBroadcaster.broadcast({
        type: 'TAB_FAVICON_UPDATED',
        tabId,
        favIconUrl: tab.favIconUrl
      });

      // Update Quick Tabs that originated from this tab
      await this.updateOriginTabInfo(tabId, { favIconUrl: tab.favIconUrl });
    }

    if (changeInfo.title !== undefined) {
      console.log('[TAB_LIFECYCLE] Tab title updated', {
        tabId,
        title: tab.title
      });

      // Update our snapshot
      this.openTabs.get(tabId).title = tab.title;

      // Broadcast to Manager
      this.portBroadcaster.broadcast({
        type: 'TAB_TITLE_UPDATED',
        tabId,
        title: tab.title
      });

      // Update Quick Tabs that originated from this tab
      await this.updateOriginTabInfo(tabId, { originTabTitle: tab.title });
    }

    if (changeInfo.status !== undefined) {
      console.log('[TAB_LIFECYCLE] Tab status changed', {
        tabId,
        status: changeInfo.status
      });

      this.openTabs.get(tabId).status = tab.status;

      // When tab finishes loading, favicon should be available
      if (changeInfo.status === 'complete') {
        this.portBroadcaster.broadcast({
          type: 'TAB_LOADED',
          tabId,
          favIconUrl: tab.favIconUrl
        });

        // Update Quick Tabs favicon if now available
        if (tab.favIconUrl) {
          await this.updateOriginTabInfo(tabId, {
            originFavicon: tab.favIconUrl
          });
        }
      }
    }
  }

  async handleTabActivated({ tabId, windowId }) {
    console.log('[TAB_LIFECYCLE] Tab activated', { tabId });

    try {
      const tab = await browser.tabs.get(tabId);

      // Update snapshot
      if (this.openTabs.has(tabId)) {
        this.openTabs.get(tabId).active = true;
      }

      // Broadcast to Manager
      // Manager can use this to filter/show Quick Tabs for active tab
      this.portBroadcaster.broadcast({
        type: 'TAB_ACTIVATED',
        tabId,
        windowId,
        title: tab.title,
        url: tab.url
      });
    } catch (error) {
      console.error('[TAB_LIFECYCLE] Error in handleTabActivated:', error);
    }
  }

  async handleTabRemoved(tabId, removeInfo) {
    console.log('[TAB_LIFECYCLE] Tab removed', { tabId });

    // Remove from snapshot
    this.openTabs.delete(tabId);

    // Find all Quick Tabs that originated from this tab
    const orphanedQuickTabs = [];
    for (const [quickTabId, quickTab] of this.quickTabsManager.tabs) {
      if (quickTab.originTabId === tabId) {
        orphanedQuickTabs.push(quickTabId);
      }
    }

    if (orphanedQuickTabs.length > 0) {
      console.log('[TAB_LIFECYCLE] Found orphaned Quick Tabs', {
        originTabId: tabId,
        orphanedCount: orphanedQuickTabs.length,
        orphanedIds: orphanedQuickTabs
      });

      // Mark them as orphaned in storage
      for (const quickTabId of orphanedQuickTabs) {
        const quickTab = this.quickTabsManager.tabs.get(quickTabId);
        quickTab.isOrphaned = true;
        quickTab.orphanedAt = Date.now();
        quickTab.originTabClosedTitle = quickTab.originTabTitle; // Preserve for context
        await this.storage.saveQuickTab(quickTab);
      }

      // Broadcast to Manager so it can show warning badges
      this.portBroadcaster.broadcast({
        type: 'ORIGIN_TAB_CLOSED',
        originTabId: tabId,
        orphanedQuickTabIds: orphanedQuickTabs,
        orphanedCount: orphanedQuickTabs.length
      });
    }

    // Also prevent future adoptions to this tab
    // (validation happens during adoption handler)
  }

  /**
   * Update Quick Tabs that originated from a specific tab
   * Called when origin tab's favicon or title changes
   */
  async updateOriginTabInfo(originTabId, updates) {
    try {
      for (const [quickTabId, quickTab] of this.quickTabsManager.tabs) {
        if (quickTab.originTabId === originTabId) {
          // Update the Quick Tab with new origin info
          Object.assign(quickTab, updates);
          await this.storage.saveQuickTab(quickTab);

          console.log('[TAB_LIFECYCLE] Updated Quick Tab origin info', {
            quickTabId,
            originTabId,
            updates
          });
        }
      }
    } catch (error) {
      console.error(
        '[TAB_LIFECYCLE] Error updating Quick Tab origin info:',
        error
      );
    }
  }

  /**
   * Validation: Check if a target tab is valid for adoption
   * Returns { valid: boolean, reason?: string }
   */
  async validateAdoptionTarget(targetTabId) {
    // Check if tab exists
    if (!this.openTabs.has(targetTabId)) {
      return {
        valid: false,
        reason: `Tab ${targetTabId} not found or closed`
      };
    }

    // Check if tab is in same window (optional constraint)
    // Could be relaxed depending on feature requirements

    return {
      valid: true
    };
  }

  /**
   * Get current tab metadata
   * Used by sidebar to display origin tab info
   */
  getTabMetadata(tabId) {
    return this.openTabs.get(tabId) || null;
  }
}

export default TabLifecycleHandler;
```

### Integration with Background Index

**File: `src/background/index.js` (or main background script)**

```javascript
import TabLifecycleHandler from './handlers/TabLifecycleHandler.js';

// ... existing code ...

// Initialize Tab Lifecycle Handler
const tabLifecycleHandler = new TabLifecycleHandler(
  quickTabsManager,
  storage,
  portBroadcaster
);

// Start listening to tab events
await tabLifecycleHandler.start();

console.log('[BACKGROUND] Tab lifecycle handler initialized');
```

---

## Port Messaging: Broadcasting Tab Events {#port-messaging-extension}

### New Message Types

Add to existing port message routing:

**File: `src/background/handlers/MessageRouter.js` or port broadcaster**

```javascript
// Existing message types (from port-based adoption fix):
// - HEARTBEAT_ACK
// - ADOPTION_COMPLETED
// - STATE_UPDATE

// NEW tab lifecycle message types:
const TAB_LIFECYCLE_MESSAGES = {
  TAB_CREATED: 'TAB_CREATED', // New tab opened
  TAB_REMOVED: 'ORIGIN_TAB_CLOSED', // Origin tab closed → Quick Tabs orphaned
  TAB_FAVICON_UPDATED: 'TAB_FAVICON_UPDATED', // Favicon loaded or changed
  TAB_TITLE_UPDATED: 'TAB_TITLE_UPDATED', // Tab title changed
  TAB_ACTIVATED: 'TAB_ACTIVATED', // User switched to this tab
  TAB_LOADED: 'TAB_LOADED' // Tab finished loading
};
```

### Broadcast Implementation

```javascript
class PortBroadcaster {
  constructor() {
    this.ports = new Map(); // connectionName -> Set of port instances
  }

  registerPort(connectionName, port) {
    if (!this.ports.has(connectionName)) {
      this.ports.set(connectionName, new Set());
    }
    this.ports.get(connectionName).add(port);

    // Clean up on disconnect
    port.onDisconnect.addListener(() => {
      this.ports.get(connectionName).delete(port);
      console.log(
        `[PORT_BROADCASTER] Port disconnected from ${connectionName}`
      );
    });
  }

  broadcast(message, connectionName = 'manager') {
    if (!this.ports.has(connectionName)) {
      console.warn(
        `[PORT_BROADCASTER] No ports connected for ${connectionName}`
      );
      return false;
    }

    const ports = this.ports.get(connectionName);
    let sentCount = 0;

    for (const port of ports) {
      try {
        port.postMessage({
          ...message,
          timestamp: Date.now(),
          broadcastedAt: new Date().toISOString()
        });
        sentCount++;
      } catch (error) {
        console.error(`[PORT_BROADCASTER] Failed to send message:`, error);
        ports.delete(port); // Remove dead port
      }
    }

    console.log(
      `[PORT_BROADCASTER] Broadcast ${message.type} to ${sentCount} ports`
    );
    return sentCount > 0;
  }
}
```

### Message Payload Examples

```javascript
// TAB_CREATED
{
  type: 'TAB_CREATED',
  tabId: 42,
  title: 'New Tab - Mozilla Firefox',
  url: 'about:home',
  favIconUrl: null,
  timestamp: 1703073000123
}

// ORIGIN_TAB_CLOSED
{
  type: 'ORIGIN_TAB_CLOSED',
  originTabId: 5,
  orphanedQuickTabIds: ['qt-1-123-abc', 'qt-1-456-def'],
  orphanedCount: 2,
  timestamp: 1703073000456
}

// TAB_FAVICON_UPDATED
{
  type: 'TAB_FAVICON_UPDATED',
  tabId: 42,
  favIconUrl: 'https://example.com/favicon.ico',
  timestamp: 1703073000789
}

// TAB_TITLE_UPDATED
{
  type: 'TAB_TITLE_UPDATED',
  tabId: 42,
  title: 'Example - Article Title',
  timestamp: 1703073001000
}

// TAB_ACTIVATED
{
  type: 'TAB_ACTIVATED',
  tabId: 42,
  windowId: 1,
  title: 'Example - Article Title',
  url: 'https://example.com/article',
  timestamp: 1703073001111
}
```

---

## Sidebar Manager: Displaying Tab Context {#sidebar-manager-display}

### Enhanced Port Message Handler

**File: `sidebar/quick-tabs-manager.js`**

```javascript
function handlePortMessage(message) {
  const { type, timestamp } = message;

  logPortLifecycle('message', { type, timestamp });

  // EXISTING HANDLERS
  if (message.type === 'HEARTBEAT_ACK') {
    handleAcknowledgment(message);
    return;
  }

  if (message.type === 'ADOPTION_COMPLETED') {
    handleAdoptionCompletion(message);
    return;
  }

  // ===== NEW: TAB LIFECYCLE HANDLERS =====

  if (message.type === 'ORIGIN_TAB_CLOSED') {
    handleOriginTabClosed(message);
    return;
  }

  if (message.type === 'TAB_FAVICON_UPDATED') {
    handleTabFaviconUpdated(message);
    return;
  }

  if (message.type === 'TAB_TITLE_UPDATED') {
    handleTabTitleUpdated(message);
    return;
  }

  if (message.type === 'TAB_ACTIVATED') {
    handleTabActivated(message);
    return;
  }

  if (message.type === 'TAB_LOADED') {
    handleTabLoaded(message);
    return;
  }

  console.log('[MANAGER] Unhandled port message type:', type);
}

// Handler: Origin tab closed → mark Quick Tabs as orphaned
function handleOriginTabClosed(message) {
  const { originTabId, orphanedQuickTabIds, orphanedCount } = message;

  console.log('[MANAGER] Origin tab closed', {
    originTabId,
    orphanedCount,
    quickTabIds: orphanedQuickTabIds
  });

  // Mark affected Quick Tabs as orphaned in UI
  for (const quickTabId of orphanedQuickTabIds) {
    const quickTabElement = document.querySelector(
      `[data-quick-tab-id="${quickTabId}"]`
    );
    if (quickTabElement) {
      quickTabElement.classList.add('orphaned');
      quickTabElement.title += ' (Origin tab closed)';

      // Show warning badge
      const badge = quickTabElement.querySelector('.orphan-badge');
      if (!badge) {
        const warningBadge = document.createElement('span');
        warningBadge.className = 'orphan-badge';
        warningBadge.textContent = '⚠️';
        warningBadge.title = 'Origin tab has been closed';
        quickTabElement.appendChild(warningBadge);
      }
    }
  }

  // Reload Quick Tabs state to sync orphan flags
  invalidateQuickTabStateCache();
  scheduleRender('tab-closed', { priority: 'HIGH' });
}

// Handler: Favicon updated → refresh display
function handleTabFaviconUpdated(message) {
  const { tabId, favIconUrl } = message;

  console.log('[MANAGER] Tab favicon updated', { tabId, favIconUrl });

  // Find and update all Quick Tabs that originated from this tab
  const quickTabElements = document.querySelectorAll(
    `[data-origin-tab-id="${tabId}"]`
  );
  for (const element of quickTabElements) {
    const faviconImg = element.querySelector('.origin-favicon');
    if (faviconImg && favIconUrl) {
      faviconImg.src = favIconUrl;
      faviconImg.style.display = 'inline';
    }
  }

  // Update cache for this origin tab
  originTabMetadataCache.set(tabId, {
    ...originTabMetadataCache.get(tabId),
    favIconUrl
  });
}

// Handler: Tab title updated → refresh display
function handleTabTitleUpdated(message) {
  const { tabId, title } = message;

  console.log('[MANAGER] Tab title updated', { tabId, title });

  // Find and update all Quick Tabs that originated from this tab
  const quickTabElements = document.querySelectorAll(
    `[data-origin-tab-id="${tabId}"]`
  );
  for (const element of quickTabElements) {
    const originLink = element.querySelector('.origin-tab-link');
    if (originLink) {
      originLink.textContent = title;
    }
  }

  // Update cache
  originTabMetadataCache.set(tabId, {
    ...originTabMetadataCache.get(tabId),
    title
  });
}

// Handler: Tab activated → optionally filter Quick Tabs for active tab
function handleTabActivated(message) {
  const { tabId, windowId, title, url } = message;

  console.log('[MANAGER] Tab activated', { tabId, title });

  // Store current active tab
  currentActiveTab = { tabId, windowId, title, url };

  // Optional: Filter Quick Tabs to show only those for active tab
  if (manager.config.filterByActiveTab) {
    scheduleRender('tab-activated', { priority: 'MEDIUM' });
  }
}

// Handler: Tab loaded → update favicon if now available
function handleTabLoaded(message) {
  const { tabId, favIconUrl } = message;

  console.log('[MANAGER] Tab loaded', { tabId, favIconUrl });

  // If favicon is now available, update Quick Tabs
  if (favIconUrl) {
    handleTabFaviconUpdated({ tabId, favIconUrl });
  }
}
```

### Rendering Origin Context

**File: `sidebar/quick-tabs-manager.js` - Render Logic**

```javascript
function renderQuickTabItem(quickTab) {
  const item = document.createElement('div');
  item.className = 'quick-tab-item';
  item.dataset.quickTabId = quickTab.id;
  item.dataset.originTabId = quickTab.originTabId;

  // Quick Tab title and info
  const titleSection = document.createElement('div');
  titleSection.className = 'quick-tab-title-section';

  // Favicon from origin tab
  if (quickTab.originFavicon) {
    const faviconImg = document.createElement('img');
    faviconImg.className = 'origin-favicon';
    faviconImg.src = quickTab.originFavicon;
    faviconImg.alt = 'Origin site';
    faviconImg.width = 16;
    faviconImg.height = 16;
    faviconImg.onerror = () => {
      faviconImg.style.display = 'none';
    };
    titleSection.appendChild(faviconImg);
  }

  // Quick Tab title
  const titleSpan = document.createElement('span');
  titleSpan.className = 'quick-tab-title';
  titleSpan.textContent = quickTab.title;
  titleSection.appendChild(titleSpan);

  item.appendChild(titleSection);

  // Origin tab context (if available)
  if (quickTab.originTabId) {
    const originSection = document.createElement('div');
    originSection.className = 'quick-tab-origin-section';

    // "Created from [Tab Name]" link
    const originLabel = document.createElement('span');
    originLabel.className = 'origin-label';
    originLabel.textContent = 'From: ';

    const originLink = document.createElement('a');
    originLink.className = 'origin-tab-link';
    originLink.href = '#';
    originLink.textContent =
      quickTab.originTabTitle || `Tab #${quickTab.originTabId}`;

    originLink.addEventListener('click', e => {
      e.preventDefault();
      // Activate the origin tab
      browser.tabs.update(quickTab.originTabId, { active: true });
    });

    originSection.appendChild(originLabel);
    originSection.appendChild(originLink);

    // Domain indicator
    if (quickTab.originDomain) {
      const domainSpan = document.createElement('span');
      domainSpan.className = 'origin-domain';
      domainSpan.textContent = ` (${quickTab.originDomain})`;
      originSection.appendChild(domainSpan);
    }

    item.appendChild(originSection);
  }

  // Orphan warning (if applicable)
  if (quickTab.isOrphaned) {
    const orphanWarning = document.createElement('div');
    orphanWarning.className = 'orphan-warning';
    orphanWarning.innerHTML = `
      <span class="orphan-badge">⚠️</span>
      <span class="orphan-text">Origin tab closed</span>
    `;
    item.appendChild(orphanWarning);

    item.classList.add('orphaned');
  }

  // Action buttons
  const actionsSection = document.createElement('div');
  actionsSection.className = 'quick-tab-actions';

  // Minimize button
  const minimizeBtn = document.createElement('button');
  minimizeBtn.className = 'action-btn minimize-btn';
  minimizeBtn.textContent = quickTab.visibility.minimized ? '📌' : '📋';
  minimizeBtn.title = quickTab.visibility.minimized ? 'Restore' : 'Minimize';
  minimizeBtn.addEventListener('click', () => {
    toggleMinimize(quickTab.id);
  });
  actionsSection.appendChild(minimizeBtn);

  // Adopt button (if not orphaned)
  if (!quickTab.isOrphaned && currentActiveTab) {
    const adoptBtn = document.createElement('button');
    adoptBtn.className = 'action-btn adopt-btn';
    adoptBtn.textContent = '→';
    adoptBtn.title = `Adopt to "${currentActiveTab.title}"`;
    adoptBtn.addEventListener('click', () => {
      adoptQuickTab(quickTab.id, currentActiveTab.tabId);
    });
    actionsSection.appendChild(adoptBtn);
  }

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'action-btn close-btn';
  closeBtn.textContent = '✕';
  closeBtn.title = 'Close Quick Tab';
  closeBtn.addEventListener('click', () => {
    closeQuickTab(quickTab.id);
  });
  actionsSection.appendChild(closeBtn);

  item.appendChild(actionsSection);

  return item;
}
```

### CSS Styling for Origin Context

**File: `sidebar/styles.css` (or similar)**

```css
/* Origin tab context section */
.quick-tab-origin-section {
  font-size: 12px;
  color: #666;
  margin-top: 4px;
  padding-left: 4px;
  border-left: 2px solid #ccc;
}

.origin-label {
  font-weight: 500;
}

.origin-tab-link {
  color: #0066cc;
  text-decoration: none;
  cursor: pointer;
}

.origin-tab-link:hover {
  text-decoration: underline;
}

.origin-domain {
  color: #999;
  font-size: 11px;
}

/* Origin favicon */
.origin-favicon {
  display: inline-block;
  margin-right: 4px;
  vertical-align: middle;
}

/* Orphan warning */
.orphan-warning {
  background-color: #fff3cd;
  border: 1px solid #ffc107;
  border-radius: 4px;
  padding: 6px 8px;
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}

.orphan-badge {
  font-size: 14px;
}

.orphan-text {
  color: #856404;
}

/* Orphaned Quick Tab */
.quick-tab-item.orphaned {
  opacity: 0.7;
  background-color: #f5f5f5;
}

.quick-tab-item.orphaned .adopt-btn {
  display: none; /* Can't adopt orphaned tabs */
}
```

---

## Advanced Features: Smart Adoption & Orphan Handling {#advanced-features}

### Smart Adoption Validation

**File: `src/background/handlers/QuickTabHandler.js` - Enhanced adoption
handler**

```javascript
async function handleAdoptTab(message) {
  const { adoptedTabId, targetTabId } = message;

  console.log('[ADOPTTAB] Handling adoption', {
    adoptedTabId,
    targetTabId
  });

  // NEW: Validate target tab exists and is suitable
  const validation =
    await tabLifecycleHandler.validateAdoptionTarget(targetTabId);
  if (!validation.valid) {
    console.error('[ADOPTTAB] Adoption validation failed:', validation.reason);
    return {
      success: false,
      error: validation.reason,
      adoptedTabId,
      targetTabId
    };
  }

  // Get Quick Tab to adopt
  const quickTab = quickTabsManager.tabs.get(adoptedTabId);
  if (!quickTab) {
    return {
      success: false,
      error: 'Quick Tab not found',
      adoptedTabId
    };
  }

  // Orphaned Quick Tabs cannot be adopted
  if (quickTab.isOrphaned) {
    return {
      success: false,
      error: 'Cannot adopt orphaned Quick Tab (origin closed)',
      adoptedTabId
    };
  }

  // NEW: Get target tab metadata for validation
  const targetTabMetadata = tabLifecycleHandler.getTabMetadata(targetTabId);
  if (!targetTabMetadata) {
    return {
      success: false,
      error: 'Target tab not found',
      adoptedTabId,
      targetTabId
    };
  }

  // Store old origin for later notification
  const oldOriginTabId = quickTab.originTabId;

  // Perform adoption
  const oldZIndex = quickTab.zIndex;
  quickTab.originTabId = targetTabId;
  quickTab.originTabTitle = targetTabMetadata.title;
  quickTab.originTabUrl = targetTabMetadata.url;
  quickTab.originDomain = new URL(targetTabMetadata.url).hostname;
  quickTab.originFavicon = targetTabMetadata.favIconUrl || null;
  quickTab.zIndex =
    Math.max(...quickTabsManager.tabs.values().map(qt => qt.zIndex)) + 1;
  quickTab.lastModified = Date.now();

  // Update visibility to show on new tab
  if (!quickTab.visibility.soloedOnTabs.includes(targetTabId)) {
    quickTab.visibility.soloedOnTabs.push(targetTabId);
  }

  // Persist adoption
  await storage.saveQuickTab(quickTab);

  console.log('[ADOPTTAB] Adoption successful', {
    adoptedTabId,
    oldOriginTabId,
    newOriginTabId: targetTabId,
    oldZIndex,
    newZIndex: quickTab.zIndex
  });

  // Send adoption notification to Manager via port
  adoptionPort.postMessage({
    type: 'ADOPTION_COMPLETED',
    adoptedQuickTabId: adoptedTabId,
    oldOriginTabId,
    newOriginTabId: targetTabId,
    oldZIndex,
    newZIndex: quickTab.zIndex,
    timestamp: Date.now()
  });

  return {
    success: true,
    adoptedTabId,
    oldOriginTabId,
    newOriginTabId: targetTabId,
    newZIndex: quickTab.zIndex
  };
}
```

### Auto-Cleanup of Orphaned Quick Tabs

**File: `src/background/handlers/OrphanCleanupHandler.js` (new file)**

```javascript
class OrphanCleanupHandler {
  constructor(quickTabsManager, storage) {
    this.quickTabsManager = quickTabsManager;
    this.storage = storage;

    // Configuration
    this.autoCleanupEnabled = true;
    this.orphanRetentionMs = 24 * 60 * 60 * 1000; // Keep for 24 hours
  }

  async start() {
    // Clean up orphans every 1 hour
    setInterval(() => this.cleanupOrphanedQuickTabs(), 60 * 60 * 1000);

    // Also clean on startup
    await this.cleanupOrphanedQuickTabs();
  }

  async cleanupOrphanedQuickTabs() {
    if (!this.autoCleanupEnabled) return;

    console.log('[ORPHAN_CLEANUP] Checking for orphaned Quick Tabs...');

    const now = Date.now();
    const toDelete = [];

    for (const [quickTabId, quickTab] of this.quickTabsManager.tabs) {
      if (quickTab.isOrphaned && quickTab.orphanedAt) {
        const ageMs = now - quickTab.orphanedAt;

        if (ageMs > this.orphanRetentionMs) {
          console.log('[ORPHAN_CLEANUP] Deleting old orphaned Quick Tab', {
            quickTabId,
            ageHours: Math.round(ageMs / (60 * 60 * 1000))
          });

          toDelete.push(quickTabId);
        }
      }
    }

    // Delete old orphans
    for (const quickTabId of toDelete) {
      this.quickTabsManager.tabs.delete(quickTabId);
      await this.storage.deleteQuickTab(quickTabId);
    }

    if (toDelete.length > 0) {
      console.log(
        '[ORPHAN_CLEANUP] Cleaned up',
        toDelete.length,
        'old orphaned Quick Tabs'
      );
    }
  }

  /**
   * Keep orphaned Quick Tab for user visibility
   * They can decide to delete or keep
   */
  async keepOrphan(quickTabId) {
    const quickTab = this.quickTabsManager.tabs.get(quickTabId);
    if (quickTab && quickTab.isOrphaned) {
      // Reset orphan timer
      quickTab.orphanedAt = Date.now();
      await this.storage.saveQuickTab(quickTab);
    }
  }

  /**
   * Manually delete orphaned Quick Tab
   */
  async deleteOrphan(quickTabId) {
    this.quickTabsManager.tabs.delete(quickTabId);
    await this.storage.deleteQuickTab(quickTabId);
  }
}

export default OrphanCleanupHandler;
```

---

## Storage Migration Strategy {#storage-migration}

### Version Detection

**File: `src/storage/StorageManager.js`**

```javascript
class StorageManager {
  // Add version field to storage
  static readonly STORAGE_VERSION = 2;  // Bump when schema changes
  static readonly VERSION_KEY = '__storage_version__';

  async getStorageVersion() {
    const data = await browser.storage.local.get(this.VERSION_KEY);
    return data[this.VERSION_KEY] || 1;
  }

  async setStorageVersion(version) {
    await browser.storage.local.set({ [this.VERSION_KEY]: version });
  }

  async loadQuickTabs() {
    const version = await this.getStorageVersion();

    if (version < 2) {
      console.log('[STORAGE] Migrating from v1 to v2...');
      await this.migrateV1toV2();
      await this.setStorageVersion(2);
    }

    // Load Quick Tabs normally
    return this._loadQuickTabsV2();
  }

  async migrateV1toV2() {
    // Get all Quick Tabs in v1 format
    const v1Tabs = await this._loadQuickTabsV1();

    console.log('[STORAGE] Found', v1Tabs.size, 'Quick Tabs to migrate');

    // Add new properties to each
    const v2Tabs = new Map();
    for (const [id, tab] of v1Tabs) {
      const v2Tab = {
        ...tab,

        // Add new Tabs API properties with defaults
        originTabId: null,
        originTabTitle: null,
        originTabUrl: null,
        originDomain: null,
        originFavicon: null,
        isOrphaned: false,
        orphanedAt: null,
        originTabClosedTitle: null,

        // cookieStoreId might already exist
        cookieStoreId: tab.cookieStoreId || 'firefox-default'
      };

      v2Tabs.set(id, v2Tab);
    }

    // Save migrated Quick Tabs back to storage
    for (const [id, tab] of v2Tabs) {
      await browser.storage.local.set({ [id]: tab });
    }

    console.log('[STORAGE] Migration complete');
  }

  async _loadQuickTabsV1() {
    // Load all items and filter Quick Tabs (keys starting with 'qt-')
    const allItems = await browser.storage.local.get(null);
    const quickTabs = new Map();

    for (const [key, value] of Object.entries(allItems)) {
      if (key.startsWith('qt-')) {
        quickTabs.set(key, value);
      }
    }

    return quickTabs;
  }

  async _loadQuickTabsV2() {
    const allItems = await browser.storage.local.get(null);
    const quickTabs = new Map();

    for (const [key, value] of Object.entries(allItems)) {
      if (key.startsWith('qt-')) {
        quickTabs.set(key, value);
      }
    }

    return quickTabs;
  }
}
```

### Backward Compatibility

```javascript
// When loading old Quick Tabs, fill in defaults
function deserializeQuickTab(data) {
  return new QuickTab({
    ...data,

    // Ensure new properties exist (for v1 Quick Tabs)
    originTabId: data.originTabId ?? null,
    originTabTitle: data.originTabTitle ?? null,
    originTabUrl: data.originTabUrl ?? null,
    originDomain: data.originDomain ?? null,
    originFavicon: data.originFavicon ?? null,
    isOrphaned: data.isOrphaned ?? false,
    orphanedAt: data.orphanedAt ?? null,
    originTabClosedTitle: data.originTabClosedTitle ?? null,
    cookieStoreId: data.cookieStoreId ?? 'firefox-default'
  });
}
```

---

## Testing & Verification {#testing-verification}

### Unit Tests

```javascript
// tests/TabLifecycleHandler.test.js
describe('TabLifecycleHandler', () => {
  test('marks Quick Tab as orphaned when origin tab closes', async () => {
    const handler = new TabLifecycleHandler(manager, storage, broadcaster);

    // Create Quick Tab with originTabId = 5
    const quickTab = { id: 'qt-1', originTabId: 5, isOrphaned: false };
    manager.tabs.set('qt-1', quickTab);

    // Simulate tab 5 being removed
    await handler.handleTabRemoved(5);

    // Verify Quick Tab marked as orphaned
    expect(quickTab.isOrphaned).toBe(true);
    expect(quickTab.orphanedAt).toBeDefined();
  });

  test('broadcasts ORIGIN_TAB_CLOSED message when tab closes', async () => {
    const handler = new TabLifecycleHandler(manager, storage, broadcaster);
    const broadcastSpy = jest.spyOn(broadcaster, 'broadcast');

    // Create Quick Tabs with same origin
    const qt1 = { id: 'qt-1', originTabId: 5 };
    const qt2 = { id: 'qt-2', originTabId: 5 };
    manager.tabs.set('qt-1', qt1);
    manager.tabs.set('qt-2', qt2);

    // Simulate tab 5 closing
    await handler.handleTabRemoved(5);

    // Verify broadcast
    expect(broadcastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ORIGIN_TAB_CLOSED',
        originTabId: 5,
        orphanedQuickTabIds: ['qt-1', 'qt-2'],
        orphanedCount: 2
      })
    );
  });

  test('updates Quick Tab favicon when tab favicon updates', async () => {
    const handler = new TabLifecycleHandler(manager, storage, broadcaster);
    const saveSpy = jest.spyOn(storage, 'saveQuickTab');

    // Create Quick Tab with orphanage tracking
    const quickTab = {
      id: 'qt-1',
      originTabId: 5,
      originFavicon: 'http://old.ico'
    };
    manager.tabs.set('qt-1', quickTab);

    // Simulate tab favicon updating
    await handler.handleTabUpdated(
      5,
      { favIconUrl: 'http://new.ico' },
      {
        id: 5,
        favIconUrl: 'http://new.ico'
      }
    );

    // Verify favicon updated
    expect(quickTab.originFavicon).toBe('http://new.ico');
    expect(saveSpy).toHaveBeenCalledWith(quickTab);
  });
});
```

### Integration Tests

```javascript
// tests/integration/TabsAPI.integration.test.js
describe('Tabs API Integration (End-to-End)', () => {
  test('Complete flow: Create Quick Tab → Tab closes → Adoption prevented', async () => {
    // 1. Create Quick Tab with origin context
    const quickTab = await createQuickTabWithOriginContext({
      url: 'https://example.com/article',
      originTabId: 5,
      originTabTitle: 'Example Article',
      originTabUrl: 'https://example.com',
      originFavicon: 'https://example.com/favicon.ico'
    });

    // 2. Verify stored correctly
    const stored = await storage.getQuickTab(quickTab.id);
    expect(stored.originTabId).toBe(5);
    expect(stored.originDomain).toBe('example.com');

    // 3. Simulate origin tab closing
    await tabLifecycleHandler.handleTabRemoved(5);

    // 4. Verify orphaned
    const orphaned = await storage.getQuickTab(quickTab.id);
    expect(orphaned.isOrphaned).toBe(true);

    // 5. Try to adopt to different tab
    const result = await handleAdoptTab({
      adoptedTabId: quickTab.id,
      targetTabId: 10
    });

    // 6. Adoption should fail
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/orphaned/i);
  });

  test('Port messaging: Orphan detection broadcasts to Manager', async () => {
    // Setup port connection mock
    const portMock = {
      postMessage: jest.fn(),
      onDisconnect: { addListener: jest.fn() }
    };

    portBroadcaster.registerPort('manager', portMock);

    // Create and orphan Quick Tab
    const qt = { id: 'qt-1', originTabId: 5 };
    manager.tabs.set('qt-1', qt);

    // Close origin tab
    await tabLifecycleHandler.handleTabRemoved(5);

    // Verify port message sent
    expect(portMock.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ORIGIN_TAB_CLOSED',
        originTabId: 5
      })
    );
  });
});
```

### Manual Testing Checklist

- [ ] **Create Quick Tab with Origin Context**
  - [ ] Copy URL from page → Quick Tab created
  - [ ] Origin tab ID stored correctly
  - [ ] Origin favicon displayed in Manager
  - [ ] "Created from [Tab Name]" shown

- [ ] **Origin Tab Closes → Orphan Detection**
  - [ ] Close origin tab
  - [ ] Manager shows orphan warning ⚠️
  - [ ] Quick Tab styling changes (muted/grayed)
  - [ ] Adopt button disabled

- [ ] **Adopt Quick Tab**
  - [ ] Before origin closes: adoption works
  - [ ] After origin closes: adoption blocked with error
  - [ ] Adopted Quick Tab appears in new tab's section
  - [ ] Z-index updated correctly

- [ ] **Favicon Async Loading**
  - [ ] Create Quick Tab on page with loading favicon
  - [ ] Initially shown as blank/placeholder
  - [ ] After page loads, favicon appears
  - [ ] Manager updates without refresh

- [ ] **Tab Metadata Updates**
  - [ ] Tab title changes → origin context updates
  - [ ] Tab URL changes → origin domain updates
  - [ ] Changes reflect in Manager immediately

---

## Summary: Phase 2 Deliverables

### What Gets Built

1. ✅ **Origin Tab Context** - Which tab created each Quick Tab
2. ✅ **Orphan Detection** - Automatic detection when origin closes
3. ✅ **Tab Lifecycle Handler** - Listens to browser tab events
4. ✅ **Port Broadcasting** - New message types for tab changes
5. ✅ **Smart Adoption** - Validation prevents adopting to closed tabs
6. ✅ **Manager Display** - Shows origin info, orphan warnings, context
7. ✅ **Storage Migration** - Seamless v1 → v2 upgrade
8. ✅ **Logging** - Comprehensive Tabs API diagnostics

### Files Modified/Created

**New Files:**

- `src/background/handlers/TabLifecycleHandler.js`
- `src/background/handlers/OrphanCleanupHandler.js`
- Tests: `tests/TabLifecycleHandler.test.js`, integration tests

**Modified Files:**

- `src/domain/QuickTab.js` - Add origin properties
- `src/content.js` - Enhanced URL_COPIED event
- `src/background/handlers/QuickTabHandler.js` - Smart adoption validation
- `src/background/handlers/MessageRouter.js` - New message types
- `sidebar/quick-tabs-manager.js` - Display origin context, handle events
- `sidebar/styles.css` - Styling for origin info
- `src/storage/StorageManager.js` - Migration logic

### Effort Breakdown

- Tab Lifecycle Handler: 2-3 hours
- Port Broadcasting: 1 hour
- Manager Display Updates: 2-3 hours
- Storage Migration: 1-2 hours
- Testing: 2-3 hours
- Documentation: 1 hour

**Total: 10-15 hours** (realistic for thorough implementation)

### Success Criteria

✅ All tests pass  
✅ No console errors  
✅ Adoption blocked for orphaned Quick Tabs  
✅ Origin context displays correctly  
✅ Manager responds to tab lifecycle events <200ms  
✅ Old Quick Tabs migrate automatically  
✅ Can adopt Quick Tabs to new tabs immediately after creation
