/**
 * Helper utilities for Quick Tabs testing
 *
 * These helpers use the Test Bridge API when available,
 * with fallback to direct DOM manipulation.
 */

/**
 * Create a Quick Tab via Test Bridge API
 * @param {Page} page - Playwright page object
 * @param {string} url - URL to load in Quick Tab
 * @returns {Promise<number>} - Slot number of created Quick Tab
 */
export async function createQuickTab(page, url) {
  const slotNumber = await page.evaluate(urlToLoad => {
    if (typeof window.__COPILOT_TEST_BRIDGE__ !== 'undefined') {
      return window.__COPILOT_TEST_BRIDGE__.createQuickTab(urlToLoad);
    }
    throw new Error('Test Bridge API not available. Ensure extension is built with TEST_MODE=true');
  }, url);

  // Wait for creation to complete
  await page.waitForTimeout(100);

  return slotNumber;
}

/**
 * Get all Quick Tabs from current page
 * @param {Page} page - Playwright page object
 * @returns {Promise<Array>} - Array of Quick Tab objects
 */
export async function getQuickTabs(page) {
  return page.evaluate(() => {
    if (typeof window.__COPILOT_TEST_BRIDGE__ !== 'undefined') {
      return window.__COPILOT_TEST_BRIDGE__.getQuickTabs();
    }
    return [];
  });
}

/**
 * Get specific Quick Tab by slot number
 * @param {Page} page - Playwright page object
 * @param {number} slotNumber - Slot number to retrieve
 * @returns {Promise<Object|null>} - Quick Tab object or null
 */
export async function getQuickTab(page, slotNumber) {
  const quickTabs = await getQuickTabs(page);
  return quickTabs.find(qt => qt.slotNumber === slotNumber) || null;
}

/**
 * Update Quick Tab position/size
 * @param {Page} page - Playwright page object
 * @param {number} slotNumber - Slot number to update
 * @param {Object} updates - Updates object { position?, size? }
 */
export async function updateQuickTab(page, slotNumber, updates) {
  await page.evaluate(
    ({ slot, data }) => {
      if (typeof window.__COPILOT_TEST_BRIDGE__ !== 'undefined') {
        return window.__COPILOT_TEST_BRIDGE__.updateQuickTab(slot, data);
      }
      throw new Error('Test Bridge API not available');
    },
    { slot: slotNumber, data: updates }
  );

  // Wait for update to propagate
  await page.waitForTimeout(100);
}

/**
 * Close Quick Tab
 * @param {Page} page - Playwright page object
 * @param {number} slotNumber - Slot number to close
 */
export async function closeQuickTab(page, slotNumber) {
  await page.evaluate(slot => {
    if (typeof window.__COPILOT_TEST_BRIDGE__ !== 'undefined') {
      return window.__COPILOT_TEST_BRIDGE__.closeQuickTab(slot);
    }
    throw new Error('Test Bridge API not available');
  }, slotNumber);

  await page.waitForTimeout(100);
}

/**
 * Set Quick Tab to Solo mode
 * @param {Page} page - Playwright page object
 * @param {number} slotNumber - Slot number
 * @param {number} tabId - Tab ID to solo on
 */
export async function setSoloMode(page, slotNumber, tabId) {
  await page.evaluate(
    ({ slot, tab }) => {
      if (typeof window.__COPILOT_TEST_BRIDGE__ !== 'undefined') {
        return window.__COPILOT_TEST_BRIDGE__.setSoloMode(slot, tab);
      }
      throw new Error('Test Bridge API not available');
    },
    { slot: slotNumber, tab: tabId }
  );

  await page.waitForTimeout(100);
}

/**
 * Set Quick Tab to Mute mode
 * @param {Page} page - Playwright page object
 * @param {number} slotNumber - Slot number
 * @param {number} tabId - Tab ID to mute on
 */
export async function setMuteMode(page, slotNumber, tabId) {
  await page.evaluate(
    ({ slot, tab }) => {
      if (typeof window.__COPILOT_TEST_BRIDGE__ !== 'undefined') {
        return window.__COPILOT_TEST_BRIDGE__.setMuteMode(slot, tab);
      }
      throw new Error('Test Bridge API not available');
    },
    { slot: slotNumber, tab: tabId }
  );

  await page.waitForTimeout(100);
}

/**
 * Verify Quick Tab visibility on current page
 * @param {Page} page - Playwright page object
 * @param {number} slotNumber - Slot number
 * @returns {Promise<boolean>} - True if visible
 */
export async function isQuickTabVisible(page, slotNumber) {
  return page.evaluate(slot => {
    if (typeof window.__COPILOT_TEST_BRIDGE__ !== 'undefined') {
      return window.__COPILOT_TEST_BRIDGE__.getQuickTabVisibility(slot);
    }
    // Fallback: check DOM
    const element = document.querySelector(`[data-slot="${slot}"]`);
    return element !== null && element.style.display !== 'none';
  }, slotNumber);
}

/**
 * Wait for cross-tab sync to complete
 * @param {Page} page - Playwright page object
 * @param {number} ms - Milliseconds to wait (default: 200ms)
 */
export async function waitForSync(page, ms = 200) {
  await page.waitForTimeout(ms);
}

/**
 * Get Quick Tab count from DOM (fallback method)
 * @param {Page} page - Playwright page object
 * @returns {Promise<number>} - Number of Quick Tabs
 */
export async function getQuickTabCountFromDOM(page) {
  return page.$$eval('[data-quick-tab-id]', elements => elements.length);
}

/**
 * Check if extension is loaded and ready
 * @param {Page} page - Playwright page object
 * @returns {Promise<boolean>} - True if extension is ready
 */
export async function isExtensionReady(page) {
  return page.evaluate(() => {
    return typeof window.__COPILOT_TEST_BRIDGE__ !== 'undefined';
  });
}
