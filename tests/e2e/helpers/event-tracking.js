/**
 * Event Tracking Helper for Playwright E2E Testing
 *
 * Provides event tracking capabilities for monitoring Quick Tabs
 * extension lifecycle events during E2E tests.
 *
 * @module tests/e2e/helpers/event-tracking
 */

/**
 * @typedef {Object} TrackedEvent
 * @property {string} event - Event type name
 * @property {Object} args - Event arguments/data
 * @property {number} time - Timestamp when event occurred
 */

/**
 * Event Tracker class for capturing extension events during E2E tests
 *
 * Hooks into the Test Bridge API to track Quick Tab lifecycle events
 * including creation, destruction, manager operations, and storage changes.
 *
 * @example
 * ```javascript
 * const tracker = new EventTracker(page);
 * await tracker.startTracking();
 *
 * // ... perform actions that trigger events ...
 *
 * const events = await tracker.getEvents();
 * console.log('Captured events:', events);
 * ```
 */
export class EventTracker {
  /**
   * Creates a new EventTracker instance
   *
   * @param {import('@playwright/test').Page} page - Playwright page object
   */
  constructor(page) {
    /** @type {import('@playwright/test').Page} */
    this.page = page;

    /** @type {TrackedEvent[]} */
    this.events = [];
  }

  /**
   * Starts tracking extension events on the page
   *
   * Injects event logging hooks into the Test Bridge API to capture:
   * - Quick Tab creation events
   * - Quick Tab destruction events
   * - Manager open/close events
   * - Storage change events
   *
   * @returns {Promise<void>}
   */
  async startTracking() {
    await this.page.evaluate(() => {
      // Initialize event log array on window
      window.__eventLog = [];

      // Helper to log events
      const logEvent = (eventType, args) => {
        window.__eventLog.push({
          event: eventType,
          args: args,
          time: Date.now()
        });
      };

      // Check if Test Bridge API is available
      if (typeof window.__COPILOT_TEST_BRIDGE__ !== 'undefined') {
        const testBridge = window.__COPILOT_TEST_BRIDGE__;

        // Wrap createQuickTab to track creation events
        if (testBridge.createQuickTab) {
          const originalCreate = testBridge.createQuickTab.bind(testBridge);
          testBridge.createQuickTab = async (...args) => {
            logEvent('quicktab:create', { args });
            const result = await originalCreate(...args);
            logEvent('quicktab:created', { args, result });
            return result;
          };
        }

        // Wrap closeQuickTab to track destruction events
        if (testBridge.closeQuickTab) {
          const originalClose = testBridge.closeQuickTab.bind(testBridge);
          testBridge.closeQuickTab = async (...args) => {
            logEvent('quicktab:destroy', { args });
            const result = await originalClose(...args);
            logEvent('quicktab:destroyed', { args, result });
            return result;
          };
        }

        // Track manager events if available
        if (testBridge.openManager) {
          const originalOpen = testBridge.openManager.bind(testBridge);
          testBridge.openManager = async (...args) => {
            logEvent('manager:open', { args });
            return originalOpen(...args);
          };
        }

        if (testBridge.closeManager) {
          const originalCloseManager = testBridge.closeManager.bind(testBridge);
          testBridge.closeManager = async (...args) => {
            logEvent('manager:close', { args });
            return originalCloseManager(...args);
          };
        }
      }

      // Track storage changes via browser storage API
      if (typeof browser !== 'undefined' && browser.storage) {
        browser.storage.onChanged.addListener((changes, areaName) => {
          logEvent('storage:changed', { changes, areaName });
        });
      }
    });
  }

  /**
   * Retrieves all captured events from the page
   *
   * @returns {Promise<TrackedEvent[]>} Array of tracked events
   */
  async getEvents() {
    return this.page.evaluate(() => {
      return window.__eventLog || [];
    });
  }

  /**
   * Clears all captured events
   *
   * @returns {Promise<void>}
   */
  async clearEvents() {
    await this.page.evaluate(() => {
      window.__eventLog = [];
    });
    this.events = [];
  }

  /**
   * Waits for a specific event type to be captured
   *
   * @param {string} eventType - Event type to wait for
   * @param {number} timeout - Maximum wait time in milliseconds
   * @returns {Promise<TrackedEvent|null>} The captured event or null if timeout
   */
  async waitForEvent(eventType, timeout = 5000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const events = await this.getEvents();
      const foundEvent = events.find(e => e.event === eventType);

      if (foundEvent) {
        return foundEvent;
      }

      // Wait a bit before checking again
      await this.page.waitForTimeout(100);
    }

    return null;
  }

  /**
   * Gets events filtered by type
   *
   * @param {string} eventType - Event type to filter by
   * @returns {Promise<TrackedEvent[]>} Filtered events
   */
  async getEventsByType(eventType) {
    const events = await this.getEvents();
    return events.filter(e => e.event === eventType);
  }

  /**
   * Gets count of events by type
   *
   * @param {string} eventType - Event type to count
   * @returns {Promise<number>} Number of events of the specified type
   */
  async getEventCount(eventType) {
    const events = await this.getEventsByType(eventType);
    return events.length;
  }
}

/**
 * Creates a new EventTracker instance for the given page
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @returns {EventTracker} New EventTracker instance
 */
export function createEventTracker(page) {
  return new EventTracker(page);
}
