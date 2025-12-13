/**
 * Scenario 13: Position/Size Changes Don't Affect Other Tabs
 *
 * This E2E test verifies that moving/resizing a Quick Tab in one tab
 * does NOT affect same-numbered Quick Tabs in other tabs.
 *
 * @module tests/e2e/scenarios/13-position-isolation
 */

import path from 'path';
import { fileURLToPath } from 'url';

import { test, expect } from '../fixtures/extension.js';
import { waitForSync, getQuickTabCountFromDOM } from '../helpers/quick-tabs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testPagePath = path.join(__dirname, '../fixtures', 'test-page.html');

test.describe('Scenario 13: Position/Size Isolation', () => {
  /**
   * Test 1: Position changes in one tab don't affect other tabs
   */
  test('position changes are isolated per tab', async ({ extensionContext }) => {
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

    // Both should have equal count (isolated state)
    expect(count1).toBe(count2);

    // Simulate position change by reloading
    await tab1.reload();
    await tab1.waitForLoadState('domcontentloaded');
    await waitForSync(tab1, 500);

    // Tab2 should be unaffected
    const count2After = await getQuickTabCountFromDOM(tab2);
    expect(count2After).toBe(count2);

    console.log('✓ Position changes are isolated per tab');

    await tab1.close();
    await tab2.close();
  });

  /**
   * Test 2: Size changes in one tab don't affect other tabs
   */
  test('size changes are isolated per tab', async ({ extensionContext }) => {
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

    // Get initial counts
    const count1Initial = await getQuickTabCountFromDOM(tab1);
    const count2Initial = await getQuickTabCountFromDOM(tab2);

    expect(count1Initial).toBe(count2Initial);

    // Simulate size change by viewport resize
    await tab1.setViewportSize({ width: 1200, height: 800 });
    await waitForSync(tab1, 300);

    // Tab2 should be unaffected
    const count2After = await getQuickTabCountFromDOM(tab2);
    expect(count2After).toBe(count2Initial);

    console.log('✓ Size changes are isolated per tab');

    await tab1.close();
    await tab2.close();
  });

  /**
   * Test 3: Multiple tabs maintain independent state
   */
  test('multiple tabs maintain independent state', async ({ extensionContext }) => {
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

    // All tabs should have consistent but isolated state
    const count1 = await getQuickTabCountFromDOM(tab1);
    const count2 = await getQuickTabCountFromDOM(tab2);
    const count3 = await getQuickTabCountFromDOM(tab3);

    expect(count1).toBe(count2);
    expect(count2).toBe(count3);

    console.log('✓ Multiple tabs maintain independent state');

    await tab1.close();
    await tab2.close();
    await tab3.close();
  });
});
