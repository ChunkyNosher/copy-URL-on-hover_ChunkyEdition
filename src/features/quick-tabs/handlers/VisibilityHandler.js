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
   * @param {Map} quickTabsMap - Map of Quick Tab instances
   * @param {BroadcastManager} broadcastManager - Broadcast manager for cross-tab sync
   * @param {StorageManager} storageManager - Storage manager (currently unused, kept for future use)
   * @param {MinimizedManager} minimizedManager - Manager for minimized Quick Tabs
   * @param {EventEmitter} eventBus - Event bus for internal communication
   * @param {Object} currentZIndex - Reference object with value property for z-index
   * @param {Function} generateSaveId - Function to generate saveId for transaction tracking
   * @param {Function} trackPendingSave - Function to track pending saveId
   * @param {Function} releasePendingSave - Function to release pending saveId
   * @param {number} currentTabId - Current browser tab ID
   * @param {Object} Events - Events constants object
   */
  constructor(
    quickTabsMap,
    broadcastManager,
    storageManager,
    minimizedManager,
    eventBus,
    currentZIndex,
    generateSaveId,
    trackPendingSave,
    releasePendingSave,
    currentTabId,
    Events
  ) {
    this.quickTabsMap = quickTabsMap;
    this.broadcastManager = broadcastManager;
    this.storageManager = storageManager;
    this.minimizedManager = minimizedManager;
    this.eventBus = eventBus;
    this.currentZIndex = currentZIndex;
    this.generateSaveId = generateSaveId;
    this.trackPendingSave = trackPendingSave;
    this.releasePendingSave = releasePendingSave;
    this.currentTabId = currentTabId;
    this.Events = Events;
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
    console.log(`[VisibilityHandler] Toggling solo for ${quickTabId}:`, newSoloedTabs);

    const tab = this.quickTabsMap.get(quickTabId);
    if (!tab) return;

    // Update solo state
    tab.soloedOnTabs = newSoloedTabs;
    tab.mutedOnTabs = []; // Clear mute state (mutually exclusive)

    // Update button states if tab has them
    this._updateSoloButton(tab, newSoloedTabs);

    // Broadcast to other tabs
    this.broadcastManager.notifySolo(quickTabId, newSoloedTabs);

    // Save to background
    await this._sendToBackground(quickTabId, tab, 'SOLO', {
      soloedOnTabs: newSoloedTabs
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
    console.log(`[VisibilityHandler] Toggling mute for ${quickTabId}:`, newMutedTabs);

    const tab = this.quickTabsMap.get(quickTabId);
    if (!tab) return;

    // Update mute state
    tab.mutedOnTabs = newMutedTabs;
    tab.soloedOnTabs = []; // Clear solo state (mutually exclusive)

    // Update button states if tab has them
    this._updateMuteButton(tab, newMutedTabs);

    // Broadcast to other tabs
    this.broadcastManager.notifyMute(quickTabId, newMutedTabs);

    // Save to background
    await this._sendToBackground(quickTabId, tab, 'MUTE', {
      mutedOnTabs: newMutedTabs
    });
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
