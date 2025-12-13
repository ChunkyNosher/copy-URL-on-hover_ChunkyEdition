/**
 * Multi-Tab Test Fixture for Playwright E2E Testing
 *
 * Provides a custom Playwright test extension with multi-tab fixture
 * for testing cross-tab synchronization in the Quick Tabs extension.
 *
 * @module tests/e2e/helpers/multi-tab-fixture
 */

import playwright from 'playwright/test';

// Destructure from the default import to work around ESM resolution issues
const { test: base, expect } = playwright;

/**
 * @typedef {Object} MultiTabFixture
 * @property {import('@playwright/test').Page} tab1 - First tab page instance
 * @property {import('@playwright/test').Page} tab2 - Second tab page instance
 * @property {import('@playwright/test').Page} tab3 - Third tab page instance
 * @property {import('@playwright/test').BrowserContext} context - Browser context
 */

/**
 * Custom Playwright test extension with multi-tab fixture
 *
 * Creates multiple pages representing different browser tabs,
 * sharing the same browser context for cross-tab communication testing.
 *
 * @example
 * ```javascript
 * import { multiTabTest as test, expect } from './helpers/multi-tab-fixture.js';
 *
 * test('multi-tab scenario', async ({ multiTab }) => {
 *   const { tab1, tab2, tab3 } = multiTab;
 *   await tab1.goto('https://example.com');
 *   await tab2.goto('https://wikipedia.org');
 *   // Test cross-tab sync...
 * });
 * ```
 */
export const multiTabTest = base.extend({
  /**
   * Multi-tab fixture providing three pages in the same context
   *
   * @param {Object} param0 - Playwright test args
   * @param {import('@playwright/test').BrowserContext} param0.context - Browser context
   * @param {Function} use - Playwright use function
   */
  multiTab: async ({ context }, use) => {
    // Create multiple pages representing different browser tabs
    const tab1 = await context.newPage();
    const tab2 = await context.newPage();
    const tab3 = await context.newPage();

    /** @type {MultiTabFixture} */
    const fixture = {
      tab1,
      tab2,
      tab3,
      context
    };

    await use(fixture);

    // Cleanup - close all tabs after test completes
    await tab1.close();
    await tab2.close();
    await tab3.close();
  }
});

export { expect };
