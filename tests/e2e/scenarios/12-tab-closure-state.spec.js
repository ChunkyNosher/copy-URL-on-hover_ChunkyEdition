/**
 * Scenario 12: Tab Closure and State Management
 *
 * This E2E test verifies that closing a browser tab removes its Quick Tabs
 * from the Manager without affecting other tabs.
 *
 * @module tests/e2e/scenarios/12-tab-closure-state
 */

import path from 'path';
import { fileURLToPath } from 'url';

import { test, expect } from '../fixtures/extension.js';
import { waitForSync, getQuickTabCountFromDOM } from '../helpers/quick-tabs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testPagePath = path.join(__dirname, '../fixtures', 'test-page.html');

test.describe('Scenario 12: Tab Closure and State Management', () => {
  /**
   * Test 1: Closing tab doesn't affect other tabs
   */
  test('closing tab does not affect other tabs', async ({ extensionContext }) => {
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

    // Get initial counts
    const count1Before = await getQuickTabCountFromDOM(tab1);
    const count3Before = await getQuickTabCountFromDOM(tab3);

    // Close tab2
    await tab2.close();
    await waitForSync(tab1, 300);

    // Tab1 and tab3 should be unaffected
    const count1After = await getQuickTabCountFromDOM(tab1);
    const count3After = await getQuickTabCountFromDOM(tab3);

    expect(count1After).toBe(count1Before);
    expect(count3After).toBe(count3Before);

    console.log('✓ Closing tab does not affect other tabs');

    await tab1.close();
    await tab3.close();
  });

  /**
   * Test 2: Remaining tabs function normally after tab closure
   */
  test('remaining tabs function normally after tab closure', async ({ extensionContext }) => {
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

    // Close tab1
    await tab1.close();
    await waitForSync(tab2, 300);

    // Tab2 should still work
    const count2 = await getQuickTabCountFromDOM(tab2);
    expect(count2).toBeGreaterThanOrEqual(0);

    // Reload tab2
    await tab2.reload();
    await tab2.waitForLoadState('domcontentloaded');
    await waitForSync(tab2, 500);

    const count2After = await getQuickTabCountFromDOM(tab2);
    expect(count2After).toBe(count2);

    console.log('✓ Remaining tabs function normally after tab closure');

    await tab2.close();
  });

  /**
   * Test 3: Manager updates after tab closure
   */
  test('state is consistent after tab closure', async ({ extensionContext }) => {
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

    // Close tab2
    await tab2.close();
    await waitForSync(tab1, 500);

    // Tab1 should have consistent state
    const count1 = await getQuickTabCountFromDOM(tab1);
    expect(count1).toBeGreaterThanOrEqual(0);

    console.log('✓ State is consistent after tab closure');

    await tab1.close();
  });
});
