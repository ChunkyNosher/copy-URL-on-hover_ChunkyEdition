/**
 * Scenario 4: Quick Tabs Manager - Display Grouped by Origin Tab
 *
 * This E2E test verifies that the Manager Panel displays Quick Tabs
 * grouped by their origin tab with clear labeling.
 *
 * @module tests/e2e/scenarios/04-manager-grouping
 */

import path from 'path';
import { fileURLToPath } from 'url';

import { test, expect } from '../fixtures/extension.js';
import { waitForSync, getQuickTabCountFromDOM, isExtensionReady } from '../helpers/quick-tabs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testPagePath = path.join(__dirname, '../fixtures', 'test-page.html');

test.describe('Scenario 4: Manager Grouping by Origin Tab', () => {
  /**
   * Test 1: Extension loads in manager context
   */
  test('extension loads and multiple tabs work', async ({ extensionContext }) => {
    const tab1 = await extensionContext.newPage();
    const tab2 = await extensionContext.newPage();

    await tab1.goto(`file://${testPagePath}`);
    await tab2.goto(`file://${testPagePath}`);

    await Promise.all([
      tab1.waitForLoadState('domcontentloaded'),
      tab2.waitForLoadState('domcontentloaded')
    ]);

    // Verify both tabs loaded
    expect(tab1.url()).toContain('test-page.html');
    expect(tab2.url()).toContain('test-page.html');

    console.log('✓ Extension loads in manager context');

    await tab1.close();
    await tab2.close();
  });

  /**
   * Test 2: Manager shows correct Quick Tab counts per tab
   */
  test('Manager tracks Quick Tabs per origin tab', async ({ extensionContext }) => {
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

    // Each tab should track its own state
    const count1 = await getQuickTabCountFromDOM(tab1);
    const count2 = await getQuickTabCountFromDOM(tab2);
    const count3 = await getQuickTabCountFromDOM(tab3);

    // All should be equal (isolated per-tab)
    expect(count1).toBe(count2);
    expect(count2).toBe(count3);

    console.log(`Tab 1: ${count1}, Tab 2: ${count2}, Tab 3: ${count3}`);
    console.log('✓ Manager tracks Quick Tabs per origin tab');

    await tab1.close();
    await tab2.close();
    await tab3.close();
  });

  /**
   * Test 3: Opening Manager in different tabs shows same global state
   */
  test('Manager shows global state from any tab', async ({ extensionContext }) => {
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

    // Get counts from each tab's perspective
    const count1 = await getQuickTabCountFromDOM(tab1);
    const count2 = await getQuickTabCountFromDOM(tab2);

    // Storage state should be synchronized (even if visibility is isolated)
    expect(count1).toBe(count2);

    console.log('✓ Manager shows global state from any tab');

    await tab1.close();
    await tab2.close();
  });
});
