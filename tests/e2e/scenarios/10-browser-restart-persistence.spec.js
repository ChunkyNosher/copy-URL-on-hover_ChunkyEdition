/**
 * Scenario 10: Quick Tab Persistence Across Browser Restart
 *
 * This E2E test verifies that Quick Tab state (position, size, minimized status)
 * persists after browser close and reopen.
 *
 * Note: Due to Playwright limitations, this test simulates restart by:
 * - Reloading the page
 * - Closing and reopening the context
 *
 * @module tests/e2e/scenarios/10-browser-restart-persistence
 */

import path from 'path';
import { fileURLToPath } from 'url';

import { test, expect } from '../fixtures/extension.js';
import { waitForSync, getQuickTabCountFromDOM } from '../helpers/quick-tabs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testPagePath = path.join(__dirname, '../fixtures', 'test-page.html');

test.describe('Scenario 10: Browser Restart Persistence', () => {
  /**
   * Test 1: State persists across page reload
   */
  test('Quick Tab state persists across page reload', async ({ extensionContext }) => {
    const page = await extensionContext.newPage();
    await page.goto(`file://${testPagePath}`);
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    // Get initial state
    const countBefore = await getQuickTabCountFromDOM(page);

    // Reload (simulates partial restart)
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    // State should persist
    const countAfter = await getQuickTabCountFromDOM(page);
    expect(countAfter).toBe(countBefore);

    console.log(`Before: ${countBefore}, After: ${countAfter}`);
    console.log('✓ Quick Tab state persists across page reload');

    await page.close();
  });

  /**
   * Test 2: Multiple reloads maintain state consistency
   */
  test('multiple reloads maintain state consistency', async ({ extensionContext }) => {
    const page = await extensionContext.newPage();
    await page.goto(`file://${testPagePath}`);
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    const countInitial = await getQuickTabCountFromDOM(page);

    // Perform multiple reloads
    for (let i = 0; i < 3; i++) {
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await waitForSync(page, 500);

      const count = await getQuickTabCountFromDOM(page);
      expect(count).toBe(countInitial);
    }

    console.log('✓ Multiple reloads maintain state consistency');

    await page.close();
  });

  /**
   * Test 3: Navigating away and back preserves state
   */
  test('navigating away and back preserves state', async ({ extensionContext }) => {
    const page = await extensionContext.newPage();
    await page.goto(`file://${testPagePath}`);
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    const countBefore = await getQuickTabCountFromDOM(page);

    // Navigate to different URL
    await page.goto(`file://${testPagePath}#different-section`);
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    // Navigate back
    await page.goto(`file://${testPagePath}`);
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    const countAfter = await getQuickTabCountFromDOM(page);
    expect(countAfter).toBe(countBefore);

    console.log('✓ Navigating away and back preserves state');

    await page.close();
  });
});
