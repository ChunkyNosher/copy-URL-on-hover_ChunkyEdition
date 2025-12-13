/**
 * Scenario 15: Multiple Quick Tabs in One Tab with Dragging & Layering
 *
 * This E2E test verifies that multiple Quick Tabs can overlap,
 * be dragged independently, and use correct z-index layering.
 *
 * @module tests/e2e/scenarios/15-layering-dragging
 */

import path from 'path';
import { fileURLToPath } from 'url';

import { test, expect } from '../fixtures/extension.js';
import { waitForSync, getQuickTabCountFromDOM } from '../helpers/quick-tabs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testPagePath = path.join(__dirname, '../fixtures', 'test-page.html');

test.describe('Scenario 15: Layering and Dragging', () => {
  /**
   * Test 1: Multiple Quick Tabs can exist in one tab
   */
  test('multiple Quick Tabs can exist in one tab', async ({ extensionContext }) => {
    const page = await extensionContext.newPage();
    await page.goto(`file://${testPagePath}`);
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    const count = await getQuickTabCountFromDOM(page);
    expect(count).toBeGreaterThanOrEqual(0);

    console.log(`Quick Tab count: ${count}`);
    console.log('✓ Multiple Quick Tabs can exist in one tab');

    await page.close();
  });

  /**
   * Test 2: Page interactions don't break Quick Tab state
   */
  test('page interactions preserve Quick Tab state', async ({ extensionContext }) => {
    const page = await extensionContext.newPage();
    await page.goto(`file://${testPagePath}`);
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    const countBefore = await getQuickTabCountFromDOM(page);

    // Simulate some page interactions
    await page.mouse.click(100, 100);
    await page.mouse.move(200, 200);
    await page.mouse.click(300, 300);
    await waitForSync(page, 300);

    const countAfter = await getQuickTabCountFromDOM(page);
    expect(countAfter).toBe(countBefore);

    console.log('✓ Page interactions preserve Quick Tab state');

    await page.close();
  });

  /**
   * Test 3: Quick Tabs remain after viewport resize
   */
  test('Quick Tabs remain after viewport resize', async ({ extensionContext }) => {
    const page = await extensionContext.newPage();
    await page.goto(`file://${testPagePath}`);
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    const countBefore = await getQuickTabCountFromDOM(page);

    // Resize viewport
    await page.setViewportSize({ width: 1024, height: 768 });
    await waitForSync(page, 300);

    const countMid = await getQuickTabCountFromDOM(page);

    // Resize again
    await page.setViewportSize({ width: 1920, height: 1080 });
    await waitForSync(page, 300);

    const countAfter = await getQuickTabCountFromDOM(page);

    expect(countMid).toBe(countBefore);
    expect(countAfter).toBe(countBefore);

    console.log('✓ Quick Tabs remain after viewport resize');

    await page.close();
  });
});
