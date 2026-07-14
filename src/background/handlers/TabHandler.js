/**
 * TabHandler - Handles browser tab operations
 *
 * Actions handled:
 * - openTab: Open URL in new tab
 * - saveQuickTabState: Save Quick Tab state for specific browser tab
 * - getQuickTabState: Get Quick Tab state for specific browser tab
 * - clearQuickTabState: Clear Quick Tab state for specific browser tab
 * - createQuickTab: Legacy create action (redirects to CREATE_QUICK_TAB)
 */

export class TabHandler {
  constructor(quickTabStates, browserAPI) {
    this.quickTabStates = quickTabStates; // Map of tabId -> state
    this.browserAPI = browserAPI;
  }

  /**
   * Open URL in new tab
   * v1.6.4 - FIX BUG #2: Support both 'active' and 'switchFocus' parameters
   *   - Content script sends `switchFocus: true` from Quick Tab UI
   *   - This handler now maps `switchFocus` to `active` for browser.tabs.create
   */
  async handleOpenTab(message, _sender) {
    if (!message.url) {
      throw new Error('URL is required');
    }

    const createProperties = {
      url: message.url
    };

    // v1.6.4 - FIX BUG #2: Support both 'active' and 'switchFocus' parameter names
    // Content scripts may send 'switchFocus' while this API expects 'active'
    if (typeof message.active !== 'undefined') {
      createProperties.active = message.active;
    } else if (typeof message.switchFocus !== 'undefined') {
      createProperties.active = message.switchFocus;
    }

    console.log('[TabHandler] handleOpenTab: Creating new tab', {
      url: message.url,
      active: createProperties.active,
      timestamp: Date.now()
    });

    const tab = await this.browserAPI.tabs.create(createProperties);
    return { success: true, tabId: tab.id };
  }

  /**
   * Save Quick Tab state for browser tab
   */
  handleSaveState(message, sender) {
    const tabId = sender.tab?.id;

    if (!tabId) {
      throw new Error('Tab ID not available');
    }

    this.quickTabStates.set(tabId, message.state);
    return { success: true };
  }

  /**
   * Get Quick Tab state for browser tab
   */
  handleGetState(_message, sender) {
    const tabId = sender.tab?.id;

    if (!tabId) {
      throw new Error('Tab ID not available');
    }

    const state = this.quickTabStates.get(tabId);
    return { success: true, state: state || null };
  }

  /**
   * Clear Quick Tab state for browser tab
   */
  handleClearState(_message, sender) {
    const tabId = sender.tab?.id;

    if (!tabId) {
      throw new Error('Tab ID not available');
    }

    this.quickTabStates.delete(tabId);
    return { success: true };
  }

  /**
   * Legacy create handler (redirects to modern handler)
   */
  handleLegacyCreate(_message, _sender) {
    console.log('[TabHandler] Legacy createQuickTab action - use CREATE_QUICK_TAB instead');

    // Just acknowledge - actual creation should use CREATE_QUICK_TAB
    return { success: true, message: 'Use CREATE_QUICK_TAB action' };
  }
}
