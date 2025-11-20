/**
 * EventManager - Manages window-level DOM event listeners
 *
 * Responsibilities:
 * - Setup emergency save handlers (beforeunload, visibilitychange, pagehide)
 * - Coordinate window event listeners
 * - Clean up event listeners on teardown
 *
 * @module EventManager
 */

export class EventManager {
  /**
   * @param {EventEmitter} eventBus - Event bus for inter-component communication
   * @param {Map} quickTabsMap - Reference to Quick Tabs map for size checking
   */
  constructor(eventBus, quickTabsMap) {
    this.eventBus = eventBus;
    this.quickTabsMap = quickTabsMap;

    // Store bound handlers for cleanup
    this.boundHandlers = {
      visibilityChange: null,
      beforeUnload: null,
      pageHide: null
    };
  }

  /**
   * Setup emergency save handlers for tab visibility and page unload
   * These ensure Quick Tabs state is preserved when:
   * - User switches tabs (visibilitychange)
   * - User closes tab or navigates away (beforeunload)
   * - Page is hidden (pagehide)
   * 
   * CRITICAL FIX for Issue #35 and #51: Also refresh state when tab becomes visible
   * This ensures position/size updates from other tabs are loaded
   */
  setupEmergencySaveHandlers() {
    // Emergency save when tab becomes hidden (user switches tabs)
    // AND refresh state when tab becomes visible (fixes Issue #35 and #51)
    this.boundHandlers.visibilityChange = () => {
      if (document.hidden) {
        // Tab hidden - save current state
        if (this.quickTabsMap.size > 0) {
          console.log('[EventManager] Tab hidden - triggering emergency save');
          this.eventBus?.emit('event:emergency-save', { trigger: 'visibilitychange' });
        }
      } else {
        // Tab visible - refresh state from background
        console.log('[EventManager] Tab visible - triggering state refresh');
        this.eventBus?.emit('event:tab-visible', { trigger: 'visibilitychange' });
      }
    };

    // Emergency save before page unload
    this.boundHandlers.beforeUnload = () => {
      if (this.quickTabsMap.size > 0) {
        console.log('[EventManager] Page unloading - triggering emergency save');
        this.eventBus?.emit('event:emergency-save', { trigger: 'beforeunload' });
      }
    };

    // Emergency save before page is hidden (more reliable than beforeunload in some browsers)
    this.boundHandlers.pageHide = () => {
      if (this.quickTabsMap.size > 0) {
        console.log('[EventManager] Page hiding - triggering emergency save');
        this.eventBus?.emit('event:emergency-save', { trigger: 'pagehide' });
      }
    };

    // Attach listeners
    document.addEventListener('visibilitychange', this.boundHandlers.visibilityChange);
    window.addEventListener('beforeunload', this.boundHandlers.beforeUnload);
    window.addEventListener('pagehide', this.boundHandlers.pageHide);

    console.log('[EventManager] Emergency save handlers attached');
  }

  /**
   * Teardown all event listeners
   * Call this when QuickTabsManager is being destroyed
   */
  teardown() {
    if (this.boundHandlers.visibilityChange) {
      document.removeEventListener('visibilitychange', this.boundHandlers.visibilityChange);
    }

    if (this.boundHandlers.beforeUnload) {
      window.removeEventListener('beforeunload', this.boundHandlers.beforeUnload);
    }

    if (this.boundHandlers.pageHide) {
      window.removeEventListener('pagehide', this.boundHandlers.pageHide);
    }

    console.log('[EventManager] Event handlers removed');
  }
}
