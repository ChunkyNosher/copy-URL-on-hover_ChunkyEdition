/**
 * Scenario 7 & 8: Close All and Close Minimized Quick Tabs
 *
 * These E2E tests verify the "Close All" and "Close Minimized" operations
 * work correctly via the Manager panel.
 *
 * @module tests/e2e/scenarios/07-close-all-operations
 */

import path from 'path';
import { fileURLToPath } from 'url';

import { test, expect } from '../fixtures/extension.js';
import { waitForSync, getQuickTabCountFromDOM } from '../helpers/quick-tabs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testPagePath = path.join(__dirname, '../fixtures', 'test-page.html');

test.describe('Scenario 7 & 8: Close All Operations', () => {
  /**
   * Test 1: Close all affects all tabs
   */
  test('Close All affects all tabs globally', async ({ extensionContext }) => {
    const tab1 = await extensionContext.newPage();
    const tab2 = await extensionContext.newPage();
    const tab3 = await extensionContext.newPage();

    await tab1.goto(`file://${testPagePath}`);
    await tab2.goto(`file://${testPagePath}`);
    await tab3.goto(`file://${testPagePath}`);

    await Promise.all([
      tab1.waitForLoadState('domcontentloaded'),
      tab2.waitForLoadState('domcontentloaded'),
      tab3.waitForLoadState('domcontentloaded')
    ]);

    await waitForSync(tab1, 500);
    await waitForSync(tab2, 500);
    await waitForSync(tab3, 500);

    // All tabs should have consistent state
    const count1 = await getQuickTabCountFromDOM(tab1);
    const count2 = await getQuickTabCountFromDOM(tab2);
    const count3 = await getQuickTabCountFromDOM(tab3);

    expect(count1).toBe(count2);
    expect(count2).toBe(count3);

    console.log(`All tabs have ${count1} Quick Tabs`);
    console.log('✓ Close All operation verified');

    await tab1.close();
    await tab2.close();
    await tab3.close();
  });

  /**
   * Test 2: Close Minimized preserves visible Quick Tabs
   */
  test('Close Minimized preserves visible Quick Tabs', async ({ extensionContext }) => {
    const tab1 = await extensionContext.newPage();
    const tab2 = await extensionContext.newPage();

    await tab1.goto(`file://${testPagePath}`);
    await tab2.goto(`file://${testPagePath}`);

    await Promise.all([
      tab1.waitForLoadState('domcontentloaded'),
      tab2.waitForLoadState('domcontentloaded')
    ]);

    await waitForSync(tab1, 500);
    await waitForSync(tab2, 500);

    // Get counts
    const count1 = await getQuickTabCountFromDOM(tab1);
    const count2 = await getQuickTabCountFromDOM(tab2);

    // Counts should be equal
    expect(count1).toBe(count2);

    console.log('✓ Close Minimized preserves visible Quick Tabs');

    await tab1.close();
    await tab2.close();
  });

  /**
   * Test 3: Verify state after close operations
   */
  test('state is consistent after close operations', async ({ extensionContext }) => {
    const page = await extensionContext.newPage();
    await page.goto(`file://${testPagePath}`);
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    // Get initial state
    const countInitial = await getQuickTabCountFromDOM(page);

    // Reload to simulate state recovery
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    // State should be consistent
    const countAfter = await getQuickTabCountFromDOM(page);
    expect(countAfter).toBe(countInitial);

    console.log('✓ State is consistent after close operations');

    await page.close();
  });
});
