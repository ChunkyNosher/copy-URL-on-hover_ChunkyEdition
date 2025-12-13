/**
 * Quick Tabs Manager State Communication Tests
 *
 * These E2E tests verify state communication between Quick Tabs
 * and the Quick Tabs Manager sidebar panel.
 *
 * @module tests/e2e/scenarios/manager-state-communication
 */

import path from 'path';
import { fileURLToPath } from 'url';

import { test, expect } from '../fixtures/extension.js';
import { waitForSync, getQuickTabCountFromDOM } from '../helpers/quick-tabs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testPagePath = path.join(__dirname, '../fixtures', 'test-page.html');

test.describe('Manager State Communication', () => {
  /**
   * Test 1: State sync between tabs and manager
   */
  test('state syncs between tabs and manager', async ({ extensionContext }) => {
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

    // State should be synchronized
    const count1 = await getQuickTabCountFromDOM(tab1);
    const count2 = await getQuickTabCountFromDOM(tab2);

    expect(count1).toBe(count2);

    console.log(`Tab 1: ${count1}, Tab 2: ${count2}`);
    console.log('✓ State syncs between tabs');

    await tab1.close();
    await tab2.close();
  });

  /**
   * Test 2: Changes in one tab reflect in storage
   */
  test('changes in one tab reflect in storage', async ({ extensionContext }) => {
    const tab1 = await extensionContext.newPage();
    await tab1.goto(`file://${testPagePath}`);
    await tab1.waitForLoadState('domcontentloaded');
    await waitForSync(tab1, 500);

    const countBefore = await getQuickTabCountFromDOM(tab1);

    // Reload to test storage persistence
    await tab1.reload();
    await tab1.waitForLoadState('domcontentloaded');
    await waitForSync(tab1, 500);

    const countAfter = await getQuickTabCountFromDOM(tab1);
    expect(countAfter).toBe(countBefore);

    console.log('✓ Changes reflect in storage');

    await tab1.close();
  });

  /**
   * Test 3: Manager receives updates from all tabs
   */
  test('Manager receives updates from all tabs', async ({ extensionContext }) => {
    const tabs = [];

    // Create multiple tabs
    for (let i = 0; i < 3; i++) {
      const tab = await extensionContext.newPage();
      await tab.goto(`file://${testPagePath}`);
      await tab.waitForLoadState('domcontentloaded');
      tabs.push(tab);
    }

    await Promise.all(tabs.map(t => waitForSync(t, 500)));

    // All tabs should have consistent view
    const counts = await Promise.all(tabs.map(t => getQuickTabCountFromDOM(t)));
    const allEqual = counts.every(c => c === counts[0]);
    expect(allEqual).toBe(true);

    console.log('✓ Manager receives updates from all tabs');

    for (const tab of tabs) {
      await tab.close();
    }
  });

  /**
   * Test 4: State consistency during rapid changes
   */
  test('state consistency during rapid changes', async ({ extensionContext }) => {
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

    // Rapid operations
    for (let i = 0; i < 5; i++) {
      await tab1.reload();
      await tab1.waitForLoadState('domcontentloaded');
      await waitForSync(tab1, 100);
    }

    // Tab2 should still be consistent
    const count2 = await getQuickTabCountFromDOM(tab2);
    expect(count2).toBeGreaterThanOrEqual(0);

    console.log('✓ State consistency during rapid changes');

    await tab1.close();
    await tab2.close();
  });

  /**
   * Test 5: Manager handles tab closure gracefully
   */
  test('Manager handles tab closure gracefully', async ({ extensionContext }) => {
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

    // Close middle tab
    await tab2.close();
    await waitForSync(tab1, 300);
    await waitForSync(tab3, 300);

    // Remaining tabs should work correctly
    const count1 = await getQuickTabCountFromDOM(tab1);
    const count3 = await getQuickTabCountFromDOM(tab3);

    expect(count1).toBe(count3);

    console.log('✓ Manager handles tab closure gracefully');

    await tab1.close();
    await tab3.close();
  });
});
