/**
 * EventManager - Manages window-level DOM event listeners
 *
 * Responsibilities:
 * - Setup emergency save handlers (beforeunload, visibilitychange, pagehide)
 * - Handle BFCache (Back/Forward Cache) page lifecycle events
 * - Coordinate window event listeners
 * - Clean up event listeners on teardown
 *
 * v1.6.3.8 - Issue #4 (arch): Added BFCache handling for zombie port prevention
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
      pageHide: null,
      pageShow: null // v1.6.3.8 - Issue #4 (arch): BFCache restore handler
    };
  }

  /**
   * Setup emergency save handlers for tab visibility and page unload
   * These ensure Quick Tabs state is preserved when:
   * - User switches tabs (visibilitychange)
   * - User closes tab or navigates away (beforeunload)
   * - Page is hidden or enters BFCache (pagehide)
   * - Page is restored from BFCache (pageshow) - v1.6.3.8
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

    // v1.6.3.8 - Issue #4 (arch): Enhanced pagehide to detect BFCache entry
    // Emergency save before page is hidden (more reliable than beforeunload in some browsers)
    this.boundHandlers.pageHide = (event) => {
      // Check if page is entering BFCache (persisted = true)
      if (event.persisted) {
        console.log('[EventManager] Page entering BFCache - triggering emergency save and port cleanup');
        this.eventBus?.emit('event:bfcache-enter', { trigger: 'pagehide', persisted: true });
      }
      
      if (this.quickTabsMap.size > 0) {
        console.log('[EventManager] Page hiding - triggering emergency save');
        this.eventBus?.emit('event:emergency-save', { trigger: 'pagehide' });
      }
    };

    // v1.6.3.8 - Issue #4 (arch): Handle BFCache restoration
    this.boundHandlers.pageShow = (event) => {
      // Check if page is restored from BFCache (persisted = true)
      if (event.persisted) {
        console.log('[EventManager] Page restored from BFCache - triggering full state sync');
        this.eventBus?.emit('event:bfcache-restore', { trigger: 'pageshow', persisted: true });
      }
    };

    // Attach listeners
    document.addEventListener('visibilitychange', this.boundHandlers.visibilityChange);
    window.addEventListener('beforeunload', this.boundHandlers.beforeUnload);
    window.addEventListener('pagehide', this.boundHandlers.pageHide);
    window.addEventListener('pageshow', this.boundHandlers.pageShow); // v1.6.3.8

    console.log('[EventManager] Emergency save handlers attached (including BFCache handlers)');
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

    // v1.6.3.8 - Issue #4 (arch): Clean up pageshow handler
    if (this.boundHandlers.pageShow) {
      window.removeEventListener('pageshow', this.boundHandlers.pageShow);
    }

    console.log('[EventManager] Event handlers removed');
  }
}
