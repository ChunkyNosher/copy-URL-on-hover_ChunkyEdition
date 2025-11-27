/**
 * @fileoverview VisibilityHandler - Handles Quick Tab visibility operations
 * Extracted from QuickTabsManager Phase 2.1 refactoring
 * v1.6.3 - Removed cross-tab sync (single-tab Quick Tabs only)
 *
 * Responsibilities:
 * - Handle solo toggle (show only on specific tabs)
 * - Handle mute toggle (hide on specific tabs)
 * - Handle minimize operation
 * - Handle focus operation (bring to front)
 * - Update button appearances
 * - Emit events for coordinators
 *
 * @version 1.6.3
 */

/**
 * VisibilityHandler class
 * Manages Quick Tab visibility states (solo, mute, minimize, focus)
 * v1.6.3 - Local only (no cross-tab sync or storage persistence)
 */
export class VisibilityHandler {
  /**
   * @param {Object} options - Configuration options
   * @param {Map} options.quickTabsMap - Map of Quick Tab instances
   * @param {MinimizedManager} options.minimizedManager - Manager for minimized Quick Tabs
   * @param {EventEmitter} options.eventBus - Event bus for internal communication
   * @param {Object} options.currentZIndex - Reference object with value property for z-index
   * @param {number} options.currentTabId - Current browser tab ID
   * @param {Object} options.Events - Events constants object
   */
  constructor(options) {
    this.quickTabsMap = options.quickTabsMap;
    this.minimizedManager = options.minimizedManager;
    this.eventBus = options.eventBus;
    this.currentZIndex = options.currentZIndex;
    this.currentTabId = options.currentTabId;
    this.Events = options.Events;
  }

  /**
   * Handle solo toggle from Quick Tab window or panel
   * v1.6.3 - Local only (no cross-tab sync)
   *
   * @param {string} quickTabId - Quick Tab ID
   * @param {number[]} newSoloedTabs - Array of tab IDs where Quick Tab should be visible
   */
  handleSoloToggle(quickTabId, newSoloedTabs) {
    this._handleVisibilityToggle(quickTabId, {
      mode: 'SOLO',
      newTabs: newSoloedTabs,
      tabsProperty: 'soloedOnTabs',
      clearProperty: 'mutedOnTabs',
      updateButton: this._updateSoloButton.bind(this)
    });
  }

  /**
   * Handle mute toggle from Quick Tab window or panel
   * v1.6.3 - Local only (no cross-tab sync)
   *
   * @param {string} quickTabId - Quick Tab ID
   * @param {number[]} newMutedTabs - Array of tab IDs where Quick Tab should be hidden
   */
  handleMuteToggle(quickTabId, newMutedTabs) {
    this._handleVisibilityToggle(quickTabId, {
      mode: 'MUTE',
      newTabs: newMutedTabs,
      tabsProperty: 'mutedOnTabs',
      clearProperty: 'soloedOnTabs',
      updateButton: this._updateMuteButton.bind(this)
    });
  }

  /**
   * Common handler for solo/mute visibility toggles
   * v1.6.3 - Local only (no storage writes)
   * @private
   * @param {string} quickTabId - Quick Tab ID
   * @param {Object} config - Configuration for toggle operation
   */
  _handleVisibilityToggle(quickTabId, config) {
    const { mode, newTabs, tabsProperty, clearProperty, updateButton } = config;

    console.log(`[VisibilityHandler] Toggling ${mode.toLowerCase()} for ${quickTabId}:`, newTabs);

    const tab = this.quickTabsMap.get(quickTabId);
    if (!tab) return;

    // Update visibility state (mutually exclusive)
    tab[tabsProperty] = newTabs;
    tab[clearProperty] = [];

    // Update button states if tab has them
    updateButton(tab, newTabs);
  }

  /**
   * Handle Quick Tab minimize
   * v1.6.3 - Local only (no cross-tab sync)
   *
   * @param {string} id - Quick Tab ID
   */
  handleMinimize(id) {
    console.log('[VisibilityHandler] Handling minimize for:', id);

    const tabWindow = this.quickTabsMap.get(id);
    if (!tabWindow) return;

    // Add to minimized manager
    this.minimizedManager.add(id, tabWindow);

    // Emit minimize event
    if (this.eventBus && this.Events) {
      this.eventBus.emit(this.Events.QUICK_TAB_MINIMIZED, { id });
    }
  }

  /**
   * Handle restore of minimized Quick Tab
   * v1.6.3 - Local only (no cross-tab sync)
   * @param {string} id - Quick Tab ID
   */
  handleRestore(id) {
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
   * v1.6.3 - Local only (no cross-tab sync)
   *
   * @param {string} id - Quick Tab ID
   */
  handleFocus(id) {
    console.log('[VisibilityHandler] Bringing to front:', id);

    const tabWindow = this.quickTabsMap.get(id);
    if (!tabWindow) return;

    // Increment z-index and update tab UI
    this.currentZIndex.value++;
    const newZIndex = this.currentZIndex.value;
    tabWindow.updateZIndex(newZIndex);

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
}
