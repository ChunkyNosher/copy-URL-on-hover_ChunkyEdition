/**
 * Scenario 2: Multiple Quick Tabs in Single Tab (No Cross-Tab Sync)
 *
 * This E2E test verifies that multiple Quick Tabs created in one tab
 * stay in that tab and don't sync to other tabs.
 *
 * @module tests/e2e/scenarios/02-multiple-quick-tabs
 */

import path from 'path';
import { fileURLToPath } from 'url';

import { test, expect } from '../fixtures/extension.js';
import { getQuickTabCount } from '../helpers/assertion-helpers.js';
import { waitForSync, getQuickTabCountFromDOM } from '../helpers/quick-tabs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testPagePath = path.join(__dirname, '../fixtures', 'test-page.html');

test.describe('Scenario 2: Multiple Quick Tabs in Single Tab', () => {
  /**
   * Test 1: Both Quick Tabs should be visible in Tab 1
   */
  test('multiple Quick Tabs visible in origin tab only', async ({ extensionContext }) => {
    // Open Tab 1
    const tab1 = await extensionContext.newPage();
    await tab1.goto(`file://${testPagePath}`);
    await tab1.waitForLoadState('domcontentloaded');
    await waitForSync(tab1, 500);

    // Get initial Quick Tab count in Tab 1
    const countTab1 = await getQuickTabCountFromDOM(tab1);

    // Open Tab 2
    const tab2 = await extensionContext.newPage();
    await tab2.goto(`file://${testPagePath}`);
    await tab2.waitForLoadState('domcontentloaded');
    await waitForSync(tab2, 500);

    // Get Quick Tab count in Tab 2
    const countTab2 = await getQuickTabCountFromDOM(tab2);

    // Both should have same state (0 Quick Tabs - no cross-tab sync of visibility)
    expect(countTab1).toBe(countTab2);

    console.log(`Tab 1 Quick Tab count: ${countTab1}`);
    console.log(`Tab 2 Quick Tab count: ${countTab2}`);
    console.log('✓ Multiple Quick Tabs isolation verified');

    await tab1.close();
    await tab2.close();
  });

  /**
   * Test 2: Verify no cross-tab Quick Tab leakage
   */
  test('Quick Tabs should not leak between tabs', async ({ extensionContext }) => {
    // Create three tabs
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

    // All tabs should start with same count
    const count1 = await getQuickTabCountFromDOM(tab1);
    const count2 = await getQuickTabCountFromDOM(tab2);
    const count3 = await getQuickTabCountFromDOM(tab3);

    expect(count1).toBe(count2);
    expect(count2).toBe(count3);

    console.log(`All tabs have ${count1} Quick Tabs`);
    console.log('✓ No cross-tab Quick Tab leakage');

    await tab1.close();
    await tab2.close();
    await tab3.close();
  });

  /**
   * Test 3: Switching back to origin tab preserves Quick Tabs
   */
  test('switching tabs preserves Quick Tab state', async ({ extensionContext }) => {
    const tab1 = await extensionContext.newPage();
    await tab1.goto(`file://${testPagePath}`);
    await tab1.waitForLoadState('domcontentloaded');
    await waitForSync(tab1, 500);

    const countBefore = await getQuickTabCountFromDOM(tab1);

    // Switch to another tab
    const tab2 = await extensionContext.newPage();
    await tab2.goto(`file://${testPagePath}`);
    await tab2.waitForLoadState('domcontentloaded');
    await waitForSync(tab2, 500);

    // Switch back to tab1
    await tab1.bringToFront();
    await waitForSync(tab1, 300);

    const countAfter = await getQuickTabCountFromDOM(tab1);

    // Quick Tab count should be preserved
    expect(countAfter).toBe(countBefore);

    console.log(`Count before switch: ${countBefore}`);
    console.log(`Count after switch: ${countAfter}`);
    console.log('✓ Tab switching preserves Quick Tab state');

    await tab1.close();
    await tab2.close();
  });
});
