/**
 * Assertion Helpers for Playwright E2E Testing
 *
 * Provides reusable assertion functions for verifying Quick Tab
 * state, visibility, and positioning during E2E tests.
 *
 * @module tests/e2e/helpers/assertion-helpers
 */

import playwright from 'playwright/test';

// Destructure from the default import to work around ESM resolution issues
const { expect } = playwright;

/**
 * Asserts that a Quick Tab with the given test ID is visible on the page
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} testId - Data-testid attribute value of the Quick Tab
 * @returns {Promise<void>}
 *
 * @example
 * ```javascript
 * await assertQuickTabVisible(page, 'quick-tab-1');
 * ```
 */
export async function assertQuickTabVisible(page, testId) {
  const locator = page.locator(`[data-testid="${testId}"]`);
  await expect(locator).toBeVisible();
}

/**
 * Asserts that a Quick Tab with the given test ID is NOT visible on the page
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} testId - Data-testid attribute value of the Quick Tab
 * @returns {Promise<void>}
 *
 * @example
 * ```javascript
 * await assertQuickTabNotVisible(page, 'quick-tab-1');
 * ```
 */
export async function assertQuickTabNotVisible(page, testId) {
  const locator = page.locator(`[data-testid="${testId}"]`);
  await expect(locator).not.toBeVisible();
}

/**
 * Asserts that the Quick Tabs Manager is showing with the correct group and tab count
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} groupName - Expected group name in the manager
 * @param {number} qtCount - Expected number of Quick Tabs in the group
 * @returns {Promise<void>}
 *
 * @example
 * ```javascript
 * await assertManagerShowing(page, 'Wikipedia', 2);
 * ```
 */
export async function assertManagerShowing(page, groupName, qtCount) {
  // Wait for manager to be visible
  const managerSelector = '[data-testid="quick-tabs-manager"]';
  await expect(page.locator(managerSelector)).toBeVisible();

  // Find the group by name
  const groupSelector = `[data-testid="manager-group-${groupName}"]`;
  const groupLocator = page.locator(groupSelector);
  await expect(groupLocator).toBeVisible();

  // Count Quick Tab items in the group
  const itemsSelector = `${groupSelector} [data-testid="quick-tab-item"]`;
  const items = page.locator(itemsSelector);
  await expect(items).toHaveCount(qtCount);
}

/**
 * Asserts that a Quick Tab is positioned at the expected coordinates
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} testId - Data-testid attribute value of the Quick Tab
 * @param {number} expectedX - Expected X position in pixels
 * @param {number} expectedY - Expected Y position in pixels
 * @param {number} tolerance - Position tolerance in pixels (default: 5)
 * @returns {Promise<void>}
 *
 * @example
 * ```javascript
 * await assertQuickTabPosition(page, 'quick-tab-1', 100, 200);
 * ```
 */
export async function assertQuickTabPosition(page, testId, expectedX, expectedY, tolerance = 5) {
  const locator = page.locator(`[data-testid="${testId}"]`);
  const boundingBox = await locator.boundingBox();

  expect(boundingBox).not.toBeNull();

  if (boundingBox) {
    expect(Math.abs(boundingBox.x - expectedX)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(boundingBox.y - expectedY)).toBeLessThanOrEqual(tolerance);
  }
}

/**
 * Waits for a Quick Tab to be created and appear on the page
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {number} timeout - Maximum wait time in milliseconds (default: 5000)
 * @returns {Promise<import('@playwright/test').Locator>} Locator for the Quick Tab element
 *
 * @example
 * ```javascript
 * const quickTab = await waitForQuickTabCreation(page);
 * await expect(quickTab).toBeVisible();
 * ```
 */
export async function waitForQuickTabCreation(page, timeout = 5000) {
  const selector = '[data-quick-tab-id]';
  await page.waitForSelector(selector, {
    state: 'visible',
    timeout
  });
  return page.locator(selector).first();
}

/**
 * Gets the number of Quick Tabs currently visible on the page
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @returns {Promise<number>} Number of Quick Tabs on the page
 *
 * @example
 * ```javascript
 * const count = await getQuickTabCount(page);
 * expect(count).toBe(2);
 * ```
 */
export async function getQuickTabCount(page) {
  const quickTabs = await page.$$('[data-quick-tab-id]');
  return quickTabs.length;
}

/**
 * Asserts that the page has a specific number of Quick Tabs
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {number} expectedCount - Expected number of Quick Tabs
 * @returns {Promise<void>}
 *
 * @example
 * ```javascript
 * await assertQuickTabCount(page, 3);
 * ```
 */
export async function assertQuickTabCount(page, expectedCount) {
  const locator = page.locator('[data-quick-tab-id]');
  await expect(locator).toHaveCount(expectedCount);
}

/**
 * Asserts that the Quick Tabs Manager is not visible on the page
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @returns {Promise<void>}
 *
 * @example
 * ```javascript
 * await assertManagerNotShowing(page);
 * ```
 */
export async function assertManagerNotShowing(page) {
  const managerSelector = '[data-testid="quick-tabs-manager"]';
  await expect(page.locator(managerSelector)).not.toBeVisible();
}

/**
 * Gets the position of a Quick Tab element
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} testId - Data-testid attribute value of the Quick Tab
 * @returns {Promise<{x: number, y: number}|null>} Position object or null if not found
 *
 * @example
 * ```javascript
 * const position = await getQuickTabPosition(page, 'quick-tab-1');
 * console.log(`Position: ${position.x}, ${position.y}`);
 * ```
 */
export async function getQuickTabPosition(page, testId) {
  const locator = page.locator(`[data-testid="${testId}"]`);
  const boundingBox = await locator.boundingBox();

  if (boundingBox) {
    return { x: boundingBox.x, y: boundingBox.y };
  }

  return null;
}

/**
 * Gets the size of a Quick Tab element
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} testId - Data-testid attribute value of the Quick Tab
 * @returns {Promise<{width: number, height: number}|null>} Size object or null if not found
 *
 * @example
 * ```javascript
 * const size = await getQuickTabSize(page, 'quick-tab-1');
 * console.log(`Size: ${size.width}x${size.height}`);
 * ```
 */
export async function getQuickTabSize(page, testId) {
  const locator = page.locator(`[data-testid="${testId}"]`);
  const boundingBox = await locator.boundingBox();

  if (boundingBox) {
    return { width: boundingBox.width, height: boundingBox.height };
  }

  return null;
}

/**
 * Asserts that a Quick Tab has the expected size
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} testId - Data-testid attribute value of the Quick Tab
 * @param {number} expectedWidth - Expected width in pixels
 * @param {number} expectedHeight - Expected height in pixels
 * @param {number} tolerance - Size tolerance in pixels (default: 5)
 * @returns {Promise<void>}
 *
 * @example
 * ```javascript
 * await assertQuickTabSize(page, 'quick-tab-1', 400, 300);
 * ```
 */
export async function assertQuickTabSize(page, testId, expectedWidth, expectedHeight, tolerance = 5) {
  const locator = page.locator(`[data-testid="${testId}"]`);
  const boundingBox = await locator.boundingBox();

  expect(boundingBox).not.toBeNull();

  if (boundingBox) {
    expect(Math.abs(boundingBox.width - expectedWidth)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(boundingBox.height - expectedHeight)).toBeLessThanOrEqual(tolerance);
  }
}
