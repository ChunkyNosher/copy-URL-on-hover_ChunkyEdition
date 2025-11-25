/**
 * @fileoverview VisibilityHandler - Handles Quick Tab visibility operations
 * Extracted from QuickTabsManager Phase 2.1 refactoring
 * v1.6.2 - MIGRATION: Removed BroadcastManager, uses storage.onChanged for cross-tab sync
 *
 * Responsibilities:
 * - Handle solo toggle (show only on specific tabs)
 * - Handle mute toggle (hide on specific tabs)
 * - Handle minimize operation
 * - Handle focus operation (bring to front)
 * - Update button appearances
 * - Emit events for coordinators
 *
 * Migration Notes (v1.6.2):
 * - Removed BroadcastManager dependency
 * - Writing to storage via background triggers storage.onChanged in other tabs
 * - Local UI updates happen immediately (no storage event for self)
 *
 * @version 1.6.2
 * @author refactor-specialist
 */

/**
 * VisibilityHandler class
 * Manages Quick Tab visibility states (solo, mute, minimize, focus) with storage-based cross-tab sync
 */
export class VisibilityHandler {
  /**
   * @param {Object} options - Configuration options
   * @param {Map} options.quickTabsMap - Map of Quick Tab instances
   * @param {StorageManager} options.storageManager - Storage manager for persistence
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
   * v1.6.2 - MIGRATION: Uses storage for cross-tab sync
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
      updateButton: this._updateSoloButton.bind(this)
    });
  }

  /**
   * Handle mute toggle from Quick Tab window or panel
   * v1.6.2 - MIGRATION: Uses storage for cross-tab sync
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
      updateButton: this._updateMuteButton.bind(this)
    });
  }

  /**
   * Common handler for solo/mute visibility toggles
   * v1.6.2 - MIGRATION: Removed BroadcastManager calls
   * @private
   * @param {string} quickTabId - Quick Tab ID
   * @param {Object} config - Configuration for toggle operation
   * @returns {Promise<void>}
   */
  async _handleVisibilityToggle(quickTabId, config) {
    const { mode, newTabs, tabsProperty, clearProperty, updateButton } = config;

    console.log(`[VisibilityHandler] Toggling ${mode.toLowerCase()} for ${quickTabId}:`, newTabs);

    const tab = this.quickTabsMap.get(quickTabId);
    if (!tab) return;

    // Update visibility state (mutually exclusive)
    tab[tabsProperty] = newTabs;
    tab[clearProperty] = [];

    // Update button states if tab has them
    updateButton(tab, newTabs);

    // v1.6.2 - Save to background (triggers storage.onChanged in other tabs)
    const data = { [tabsProperty]: newTabs };
    await this._sendToBackground(quickTabId, tab, mode, data);
  }

  /**
   * Handle Quick Tab minimize
   * v1.6.2 - MIGRATION: Uses storage for cross-tab sync
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

    // Emit minimize event
    if (this.eventBus && this.Events) {
      this.eventBus.emit(this.Events.QUICK_TAB_MINIMIZED, { id });
    }

    // Update storage (triggers storage.onChanged in other tabs)
    const saveId = this.generateSaveId();
    this.trackPendingSave(saveId);

    const cookieStoreId = tabWindow.cookieStoreId || 'firefox-default';

    if (typeof browser !== 'undefined' && browser.runtime) {
      try {
        await browser.runtime.sendMessage({
          action: 'UPDATE_QUICK_TAB_MINIMIZE',
          id: id,
          minimized: true,
          cookieStoreId: cookieStoreId,
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
   * Handle restore of minimized Quick Tab
   * v1.6.2 - MIGRATION: Uses storage for cross-tab sync
   * @param {string} id - Quick Tab ID
   */
  async handleRestore(id) {
    console.log('[VisibilityHandler] Handling restore for:', id);

    // Restore from minimized manager
    const restored = this.minimizedManager.restore(id);
    if (!restored) {
      console.warn('[VisibilityHandler] Tab not found in minimized manager:', id);
      return;
    }

    // Emit restore event
    if (this.eventBus && this.Events) {
      this.eventBus.emit(this.Events.QUICK_TAB_RESTORED, { id });
    }

    // Update storage (triggers storage.onChanged in other tabs)
    const saveId = this.generateSaveId();
    this.trackPendingSave(saveId);

    const tabWindow = this.quickTabsMap.get(id);
    const cookieStoreId = tabWindow?.cookieStoreId || 'firefox-default';

    if (typeof browser !== 'undefined' && browser.runtime) {
      try {
        await browser.runtime.sendMessage({
          action: 'UPDATE_QUICK_TAB_MINIMIZE',
          id: id,
          minimized: false,
          cookieStoreId: cookieStoreId,
          saveId: saveId,
          timestamp: Date.now()
        });
        this.releasePendingSave(saveId);
      } catch (err) {
        console.error('[VisibilityHandler] Error updating restore state:', err);
        this.releasePendingSave(saveId);
      }
    } else {
      this.releasePendingSave(saveId);
    }
  }

  /**
   * Restore Quick Tab from minimized state (alias for handleRestore)
   * @param {string} id - Quick Tab ID
   */
  restoreQuickTab(id) {
    return this.handleRestore(id);
  }

  /**
   * Restore Quick Tab by ID (backward compat alias)
   * @param {string} id - Quick Tab ID
   */
  restoreById(id) {
    return this.handleRestore(id);
  }

  /**
   * Handle Quick Tab focus (bring to front)
   * v1.6.2 - MIGRATION: Uses storage for cross-tab sync
   *
   * @param {string} id - Quick Tab ID
   */
  async handleFocus(id) {
    console.log('[VisibilityHandler] Bringing to front:', id);

    const tabWindow = this.quickTabsMap.get(id);
    if (!tabWindow) return;

    // Increment z-index and update tab UI
    this.currentZIndex.value++;
    const newZIndex = this.currentZIndex.value;
    tabWindow.updateZIndex(newZIndex);

    // Save z-index to background for cross-tab sync
    const cookieStoreId = tabWindow.cookieStoreId || 'firefox-default';
    if (typeof browser !== 'undefined' && browser.runtime) {
      try {
        await browser.runtime.sendMessage({
          action: 'UPDATE_QUICK_TAB_ZINDEX',
          id: id,
          zIndex: newZIndex,
          cookieStoreId: cookieStoreId
        });
        console.log(`[VisibilityHandler] Saved z-index ${newZIndex} to background for ${id}`);
      } catch (err) {
        console.error('[VisibilityHandler] Error saving z-index to background:', err);
      }
    }

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
   * v1.6.2 - Triggers storage.onChanged in other tabs
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
