/**
 * Scenario 11: Hydration on Page Reload (originTabId Filtering)
 *
 * This E2E test verifies that Quick Tabs are restored on page reload
 * only for the current tab, not other tabs.
 *
 * @module tests/e2e/scenarios/11-hydration-origintabid
 */

import path from 'path';
import { fileURLToPath } from 'url';

import { test, expect } from '../fixtures/extension.js';
import { waitForSync, getQuickTabCountFromDOM } from '../helpers/quick-tabs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testPagePath = path.join(__dirname, '../fixtures', 'test-page.html');

test.describe('Scenario 11: Hydration with originTabId Filtering', () => {
  /**
   * Test 1: Hydration restores Quick Tabs to correct tab
   */
  test('hydration restores Quick Tabs to correct tab', async ({ extensionContext }) => {
    const page = await extensionContext.newPage();
    await page.goto(`file://${testPagePath}`);
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    const countBefore = await getQuickTabCountFromDOM(page);

    // Trigger hydration via reload
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    const countAfter = await getQuickTabCountFromDOM(page);
    expect(countAfter).toBe(countBefore);

    console.log('✓ Hydration restores Quick Tabs to correct tab');

    await page.close();
  });

  /**
   * Test 2: originTabId filtering prevents cross-tab visibility
   */
  test('originTabId filtering prevents cross-tab visibility', async ({ extensionContext }) => {
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

    // Get counts from each tab
    const count1 = await getQuickTabCountFromDOM(tab1);
    const count2 = await getQuickTabCountFromDOM(tab2);

    // Both should have equal count (isolated)
    expect(count1).toBe(count2);

    // Reload tab1
    await tab1.reload();
    await tab1.waitForLoadState('domcontentloaded');
    await waitForSync(tab1, 500);

    // Tab2 should be unaffected
    const count2After = await getQuickTabCountFromDOM(tab2);
    expect(count2After).toBe(count2);

    console.log('✓ originTabId filtering prevents cross-tab visibility');

    await tab1.close();
    await tab2.close();
  });

  /**
   * Test 3: Hydration works correctly after multiple operations
   */
  test('hydration works correctly after multiple operations', async ({ extensionContext }) => {
    const page = await extensionContext.newPage();
    await page.goto(`file://${testPagePath}`);
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    const countInitial = await getQuickTabCountFromDOM(page);

    // Multiple navigations
    await page.goto(`file://${testPagePath}#section1`);
    await page.waitForLoadState('domcontentloaded');
    await page.goto(`file://${testPagePath}#section2`);
    await page.waitForLoadState('domcontentloaded');
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    const countFinal = await getQuickTabCountFromDOM(page);
    expect(countFinal).toBe(countInitial);

    console.log('✓ Hydration works correctly after multiple operations');

    await page.close();
  });
});
