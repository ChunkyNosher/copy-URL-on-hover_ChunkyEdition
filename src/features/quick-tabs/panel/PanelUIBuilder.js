/**
 * PanelUIBuilder Component
 * Handles DOM creation and rendering for the Quick Tabs Manager Panel
 *
 * Extracted from panel.js as part of Phase 2.10 refactoring
 * Responsibilities:
 * - Inject CSS styles into document
 * - Create panel DOM structure from HTML template
 * - Render container sections with Quick Tabs
 * - Render individual Quick Tab items
 * - Get container icon emojis
 *
 * v1.6.0 - Phase 2.10: Extracted UI building logic
 */

// Panel HTML template
const PANEL_HTML = `
<div id="quick-tabs-manager-panel" class="quick-tabs-manager-panel" style="display: none;">
  <div class="panel-header">
    <span class="panel-drag-handle">≡</span>
    <h2 class="panel-title">Quick Tabs Manager</h2>
    <div class="panel-controls">
      <button class="panel-btn panel-minimize" title="Minimize Panel">−</button>
      <button class="panel-btn panel-close" title="Close Panel (Ctrl+Alt+Z)">✕</button>
    </div>
  </div>
  
  <div class="panel-actions">
    <button id="panel-closeMinimized" class="panel-btn-secondary" title="Close all minimized Quick Tabs">
      Close Minimized
    </button>
    <button id="panel-closeAll" class="panel-btn-danger" title="Close all Quick Tabs">
      Close All
    </button>
    <button id="panel-clearStorage" class="panel-btn-danger" title="Clear Quick Tab Storage (Debug)">
      Clear Storage
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

// Panel CSS styles
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
  color: #e0e0e0;
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

/**
 * PanelUIBuilder - Handles DOM creation and rendering for panel UI
 */
export class PanelUIBuilder {
  /**
   * Inject panel styles into the document
   * @returns {boolean} - True if styles were injected, false if already present
   */
  static injectStyles() {
    // Check if already injected
    if (document.getElementById('quick-tabs-manager-panel-styles')) {
      return false;
    }

    // Safety check: Ensure document.head exists
    if (!document.head) {
      console.error('[PanelUIBuilder] document.head is null - DOM not ready!');
      throw new Error('[PanelUIBuilder] Cannot inject styles - document.head is null');
    }

    const style = document.createElement('style');
    style.id = 'quick-tabs-manager-panel-styles';
    style.textContent = PANEL_CSS;
    document.head.appendChild(style);

    return true;
  }

  /**
   * Create panel DOM structure
   * @param {Object} state - Panel state with position and size
   * @returns {HTMLElement} - Panel element
   */
  static createPanel(state) {
    const container = document.createElement('div');
    container.innerHTML = PANEL_HTML;
    const panel = container.firstElementChild;

    // Apply saved position and size
    panel.style.left = `${state.left}px`;
    panel.style.top = `${state.top}px`;
    panel.style.width = `${state.width}px`;
    panel.style.height = `${state.height}px`;

    // Show panel if it was open before
    if (state.isOpen) {
      panel.style.display = 'flex';
    }

    return panel;
  }

  /**
   * Render a container section with Quick Tabs
   * @param {string} cookieStoreId - Container ID
   * @param {Object} containerInfo - Container display info
   * @param {Object} containerState - Container state with tabs
   * @returns {HTMLElement} - Container section element
   */
  static renderContainerSection(cookieStoreId, containerInfo, containerState) {
    const section = document.createElement('div');
    section.className = 'panel-container-section';

    // Header
    const header = PanelUIBuilder._createHeader(containerInfo, containerState);
    section.appendChild(header);

    // Tabs
    const activeTabs = containerState.tabs.filter(t => !t.minimized);
    const minimizedTabs = containerState.tabs.filter(t => t.minimized);

    activeTabs.forEach(tab => {
      section.appendChild(PanelUIBuilder.renderQuickTabItem(tab, false));
    });

    minimizedTabs.forEach(tab => {
      section.appendChild(PanelUIBuilder.renderQuickTabItem(tab, true));
    });

    return section;
  }

  /**
   * Create container header element
   * @param {Object} containerInfo - Container display info
   * @param {Object} containerState - Container state with tabs
   * @returns {HTMLElement} - Header element
   * @private
   */
  static _createHeader(containerInfo, containerState) {
    const header = document.createElement('h3');
    header.className = 'panel-container-header';

    const tabCount = containerState.tabs.length;
    const plural = tabCount !== 1 ? 's' : '';

    header.innerHTML = `
      <span class="panel-container-icon">${containerInfo.icon}</span>
      <span class="panel-container-name">${containerInfo.name}</span>
      <span class="panel-container-count">(${tabCount} tab${plural})</span>
    `;

    return header;
  }

  /**
   * Render a Quick Tab item element
   * @param {Object} tab - Quick Tab data
   * @param {boolean} isMinimized - Whether tab is minimized
   * @returns {HTMLElement} - Quick Tab item element
   */
  static renderQuickTabItem(tab, isMinimized) {
    // Convert to boolean explicitly to prevent string 'false' issues
    const minimized = Boolean(isMinimized);

    const item = document.createElement('div');
    item.className = `panel-quick-tab-item ${minimized ? 'minimized' : 'active'}`;

    // Indicator
    const indicator = PanelUIBuilder._createIndicator(minimized);
    item.appendChild(indicator);

    // Favicon
    const favicon = PanelUIBuilder._createFavicon(tab.url);
    item.appendChild(favicon);

    // Info
    const info = PanelUIBuilder._createInfo(tab, minimized);
    item.appendChild(info);

    // Actions
    const actions = PanelUIBuilder._createActions(tab, minimized);
    item.appendChild(actions);

    return item;
  }

  /**
   * Create status indicator element
   * @param {boolean} minimized - Whether tab is minimized
   * @returns {HTMLElement} - Indicator element
   * @private
   */
  static _createIndicator(minimized) {
    const indicator = document.createElement('span');
    indicator.className = `panel-status-indicator ${minimized ? 'yellow' : 'green'}`;
    return indicator;
  }

  /**
   * Create favicon element
   * @param {string} url - Tab URL
   * @returns {HTMLElement} - Favicon element
   * @private
   */
  static _createFavicon(url) {
    const favicon = document.createElement('img');
    favicon.className = 'panel-favicon';

    try {
      const urlObj = new URL(url);
      favicon.src = `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
      favicon.onerror = () => (favicon.style.display = 'none');
    } catch (e) {
      favicon.style.display = 'none';
    }

    return favicon;
  }

  /**
   * Create tab info element
   * @param {Object} tab - Tab data
   * @param {boolean} minimized - Whether tab is minimized
   * @returns {HTMLElement} - Info element
   * @private
   */
  static _createInfo(tab, minimized) {
    const info = document.createElement('div');
    info.className = 'panel-tab-info';

    const title = document.createElement('div');
    title.className = 'panel-tab-title';
    title.textContent = tab.title || 'Quick Tab';

    const meta = document.createElement('div');
    meta.className = 'panel-tab-meta';

    const metaParts = [];
    if (minimized) metaParts.push('Minimized');
    if (tab.activeTabId) metaParts.push(`Tab ${tab.activeTabId}`);
    
    // v1.6.2.2 - Solo/Mute visibility indicators
    if (tab.soloedOnTabs && tab.soloedOnTabs.length > 0) {
      const soloCount = tab.soloedOnTabs.length;
      metaParts.push(`🎯 Solo on ${soloCount} tab${soloCount !== 1 ? 's' : ''}`);
    }
    if (tab.mutedOnTabs && tab.mutedOnTabs.length > 0) {
      const muteCount = tab.mutedOnTabs.length;
      metaParts.push(`🔇 Muted on ${muteCount} tab${muteCount !== 1 ? 's' : ''}`);
    }
    
    if (tab.width && tab.height) {
      metaParts.push(`${Math.round(tab.width)}×${Math.round(tab.height)}`);
    }
    meta.textContent = metaParts.join(' • ');

    info.appendChild(title);
    info.appendChild(meta);

    return info;
  }

  /**
   * Create action buttons element
   * @param {Object} tab - Tab data
   * @param {boolean} minimized - Whether tab is minimized
   * @returns {HTMLElement} - Actions element
   * @private
   */
  static _createActions(tab, minimized) {
    const actions = document.createElement('div');
    actions.className = 'panel-tab-actions';

    if (!minimized) {
      // Go to Tab button
      if (tab.activeTabId) {
        const goToBtn = PanelUIBuilder._createButton('🔗', 'Go to Tab', 'goToTab', {
          tabId: tab.activeTabId
        });
        actions.appendChild(goToBtn);
      }

      // Minimize button
      const minBtn = PanelUIBuilder._createButton('➖', 'Minimize', 'minimize', {
        quickTabId: tab.id
      });
      actions.appendChild(minBtn);
    } else {
      // Restore button
      const restoreBtn = PanelUIBuilder._createButton('↑', 'Restore', 'restore', {
        quickTabId: tab.id
      });
      actions.appendChild(restoreBtn);
    }

    // Close button (always present)
    const closeBtn = PanelUIBuilder._createButton('✕', 'Close', 'close', {
      quickTabId: tab.id
    });
    actions.appendChild(closeBtn);

    return actions;
  }

  /**
   * Create action button element
   * @param {string} text - Button text
   * @param {string} title - Button tooltip
   * @param {string} action - Action type
   * @param {Object} data - Data attributes
   * @returns {HTMLElement} - Button element
   * @private
   */
  static _createButton(text, title, action, data) {
    const button = document.createElement('button');
    button.className = 'panel-btn-icon';
    button.textContent = text;
    button.title = title;
    button.dataset.action = action;

    // Set data attributes
    Object.entries(data).forEach(([key, value]) => {
      button.dataset[key] = value;
    });

    return button;
  }

  /**
   * Get container icon emoji
   * @param {string} icon - Icon name
   * @returns {string} - Icon emoji
   */
  static getContainerIcon(icon) {
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
}
