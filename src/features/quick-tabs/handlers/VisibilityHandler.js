/**
 * @fileoverview VisibilityHandler - Handles Quick Tab visibility operations
 * Extracted from QuickTabsManager Phase 2.1 refactoring
 *
 * Responsibilities:
 * - Handle solo toggle (show only on specific tabs)
 * - Handle mute toggle (hide on specific tabs)
 * - Handle minimize operation
 * - Handle focus operation (bring to front)
 * - Update button appearances
 * - Emit events for coordinators
 *
 * @version 1.6.0
 * @author refactor-specialist
 */

/**
 * VisibilityHandler class
 * Manages Quick Tab visibility states (solo, mute, minimize, focus)
 */
export class VisibilityHandler {
  /**
   * @param {Object} options - Configuration options
   * @param {Map} options.quickTabsMap - Map of Quick Tab instances
   * @param {BroadcastManager} options.broadcastManager - Broadcast manager for cross-tab sync
   * @param {StorageManager} options.storageManager - Storage manager (currently unused, kept for future use)
   * @param {MinimizedManager} options.minimizedManager - Manager for minimized Quick Tabs
   * @param {EventEmitter} options.eventBus - Event bus for internal communication
   * @param {Object} options.currentZIndex - Reference object with value property for z-index
   * @param {Function} options.generateSaveId - Function to generate saveId for transaction tracking
   * @param {Function} options.trackPendingSave - Function to track pending saveId
   * @param {Function} options.releasePendingSave - Function to release pending saveId
   * @param {number} options.currentTabId - Current browser tab ID
   * @param {Object} options.Events - Events constants object
   */
  constructor(options) {
    this.quickTabsMap = options.quickTabsMap;
    this.broadcastManager = options.broadcastManager;
    this.storageManager = options.storageManager;
    this.minimizedManager = options.minimizedManager;
    this.eventBus = options.eventBus;
    this.currentZIndex = options.currentZIndex;
    this.generateSaveId = options.generateSaveId;
    this.trackPendingSave = options.trackPendingSave;
    this.releasePendingSave = options.releasePendingSave;
    this.currentTabId = options.currentTabId;
    this.Events = options.Events;
  }

  /**
   * Handle solo toggle from Quick Tab window or panel
   * v1.5.9.13 - Solo feature: show Quick Tab ONLY on specific tabs
   *
   * @param {string} quickTabId - Quick Tab ID
   * @param {number[]} newSoloedTabs - Array of tab IDs where Quick Tab should be visible
   * @returns {Promise<void>}
   */
  async handleSoloToggle(quickTabId, newSoloedTabs) {
    await this._handleVisibilityToggle(quickTabId, {
      mode: 'SOLO',
      newTabs: newSoloedTabs,
      tabsProperty: 'soloedOnTabs',
      clearProperty: 'mutedOnTabs',
      updateButton: this._updateSoloButton.bind(this),
      broadcastNotify: tabs => this.broadcastManager.notifySolo(quickTabId, tabs)
    });
  }

  /**
   * Handle mute toggle from Quick Tab window or panel
   * v1.5.9.13 - Mute feature: hide Quick Tab ONLY on specific tabs
   *
   * @param {string} quickTabId - Quick Tab ID
   * @param {number[]} newMutedTabs - Array of tab IDs where Quick Tab should be hidden
   * @returns {Promise<void>}
   */
  async handleMuteToggle(quickTabId, newMutedTabs) {
    await this._handleVisibilityToggle(quickTabId, {
      mode: 'MUTE',
      newTabs: newMutedTabs,
      tabsProperty: 'mutedOnTabs',
      clearProperty: 'soloedOnTabs',
      updateButton: this._updateMuteButton.bind(this),
      broadcastNotify: tabs => this.broadcastManager.notifyMute(quickTabId, tabs)
    });
  }

  /**
   * Common handler for solo/mute visibility toggles
   * Extracts shared logic to reduce duplication
   * @private
   * @param {string} quickTabId - Quick Tab ID
   * @param {Object} config - Configuration for toggle operation
   * @returns {Promise<void>}
   */
  async _handleVisibilityToggle(quickTabId, config) {
    const { mode, newTabs, tabsProperty, clearProperty, updateButton, broadcastNotify } = config;
    
    console.log(`[VisibilityHandler] Toggling ${mode.toLowerCase()} for ${quickTabId}:`, newTabs);

    const tab = this.quickTabsMap.get(quickTabId);
    if (!tab) return;

    // Update visibility state (mutually exclusive)
    tab[tabsProperty] = newTabs;
    tab[clearProperty] = [];

    // Update button states if tab has them
    updateButton(tab, newTabs);

    // Broadcast to other tabs
    broadcastNotify(newTabs);

    // Save to background
    const data = { [tabsProperty]: newTabs };
    await this._sendToBackground(quickTabId, tab, mode, data);
  }

  /**
   * Handle Quick Tab minimize
   * v1.5.8.13 - Broadcast minimize to other tabs
   * v1.5.9.8 - Update storage immediately to reflect minimized state
   *
   * @param {string} id - Quick Tab ID
   * @returns {Promise<void>}
   */
  async handleMinimize(id) {
    console.log('[VisibilityHandler] Handling minimize for:', id);

    const tabWindow = this.quickTabsMap.get(id);
    if (!tabWindow) return;

    // Add to minimized manager
    this.minimizedManager.add(id, tabWindow);

    // v1.5.8.13 - Broadcast minimize to other tabs
    this.broadcastManager.notifyMinimize(id);

    // Emit minimize event
    if (this.eventBus && this.Events) {
      this.eventBus.emit(this.Events.QUICK_TAB_MINIMIZED, { id });
    }

    // v1.5.9.8 - FIX: Update storage immediately to reflect minimized state
    const saveId = this.generateSaveId();
    this.trackPendingSave(saveId);

    // v1.5.9.12 - Get cookieStoreId from tab
    const cookieStoreId = tabWindow.cookieStoreId || 'firefox-default';

    if (typeof browser !== 'undefined' && browser.runtime) {
      try {
        await browser.runtime.sendMessage({
          action: 'UPDATE_QUICK_TAB_MINIMIZE',
          id: id,
          minimized: true,
          cookieStoreId: cookieStoreId, // v1.5.9.12 - Include container context
          saveId: saveId,
          timestamp: Date.now()
        });
        this.releasePendingSave(saveId);
      } catch (err) {
        console.error('[VisibilityHandler] Error updating minimize state:', err);
        this.releasePendingSave(saveId);
      }
    } else {
      this.releasePendingSave(saveId);
    }
  }

  /**
   * Handle Quick Tab focus (bring to front)
   *
   * @param {string} id - Quick Tab ID
   */
  handleFocus(id) {
    console.log('[VisibilityHandler] Bringing to front:', id);

    const tabWindow = this.quickTabsMap.get(id);
    if (!tabWindow) return;

    // Increment z-index and update tab
    this.currentZIndex.value++;
    tabWindow.updateZIndex(this.currentZIndex.value);

    // Emit focus event
    if (this.eventBus && this.Events) {
      this.eventBus.emit(this.Events.QUICK_TAB_FOCUSED, { id });
    }
  }

  /**
   * Update solo button appearance
   * @private
   * @param {Object} tab - Quick Tab instance
   * @param {number[]} soloedOnTabs - Array of tab IDs
   */
  _updateSoloButton(tab, soloedOnTabs) {
    if (!tab.soloButton) return;

    const isSoloed = soloedOnTabs.length > 0;
    tab.soloButton.textContent = isSoloed ? '🎯' : '⭕';
    tab.soloButton.title = isSoloed ? 'Un-solo (show on all tabs)' : 'Solo (show only on this tab)';
    tab.soloButton.style.background = isSoloed ? '#444' : 'transparent';
  }

  /**
   * Update mute button appearance
   * @private
   * @param {Object} tab - Quick Tab instance
   * @param {number[]} mutedOnTabs - Array of tab IDs
   */
  _updateMuteButton(tab, mutedOnTabs) {
    if (!tab.muteButton) return;

    const isMuted = mutedOnTabs.includes(this.currentTabId);
    tab.muteButton.textContent = isMuted ? '🔇' : '🔊';
    tab.muteButton.title = isMuted ? 'Unmute (show on this tab)' : 'Mute (hide on this tab)';
    tab.muteButton.style.background = isMuted ? '#c44' : 'transparent';
  }

  /**
   * Send message to background for persistence
   * @private
   * @param {string} quickTabId - Quick Tab ID
   * @param {Object} tab - Quick Tab instance
   * @param {string} action - Action type ('SOLO' or 'MUTE')
   * @param {Object} data - Additional data to send
   * @returns {Promise<void>}
   */
  async _sendToBackground(quickTabId, tab, action, data) {
    const saveId = this.generateSaveId();
    const cookieStoreId = tab?.cookieStoreId || 'firefox-default';

    if (typeof browser !== 'undefined' && browser.runtime) {
      try {
        await browser.runtime.sendMessage({
          action: `UPDATE_QUICK_TAB_${action}`,
          id: quickTabId,
          ...data,
          cookieStoreId: cookieStoreId,
          saveId: saveId,
          timestamp: Date.now()
        });
      } catch (err) {
        console.error(`[VisibilityHandler] ${action} update error:`, err);
        this.releasePendingSave(saveId);
      }
    } else {
      this.releasePendingSave(saveId);
    }
  }
}
