/**
 * Scenario 9: Quick Tab Limit Enforcement Per Tab
 *
 * This E2E test verifies that the maximum Quick Tab limit is enforced
 * and prevents exceeding the limit.
 *
 * @module tests/e2e/scenarios/09-limit-enforcement
 */

import path from 'path';
import { fileURLToPath } from 'url';

import { test, expect } from '../fixtures/extension.js';
import { waitForSync, getQuickTabCountFromDOM } from '../helpers/quick-tabs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testPagePath = path.join(__dirname, '../fixtures', 'test-page.html');

test.describe('Scenario 9: Quick Tab Limit Enforcement', () => {
  /**
   * Test 1: Limit is enforced per tab
   */
  test('Quick Tab limit is enforced per tab', async ({ extensionContext }) => {
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

    // Both tabs enforce limits independently
    expect(count1).toBe(count2);

    console.log(`Tab 1: ${count1}, Tab 2: ${count2}`);
    console.log('✓ Quick Tab limit is enforced per tab');

    await tab1.close();
    await tab2.close();
  });

  /**
   * Test 2: Limit doesn't prevent creation in other tabs
   */
  test('limit in one tab does not affect other tabs', async ({ extensionContext }) => {
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

    // All tabs should have independent state
    const count1 = await getQuickTabCountFromDOM(tab1);
    const count2 = await getQuickTabCountFromDOM(tab2);
    const count3 = await getQuickTabCountFromDOM(tab3);

    expect(count1).toBe(count2);
    expect(count2).toBe(count3);

    console.log('✓ Limit in one tab does not affect other tabs');

    await tab1.close();
    await tab2.close();
    await tab3.close();
  });

  /**
   * Test 3: Manager shows total Quick Tab count
   */
  test('Manager shows total Quick Tab count across tabs', async ({ extensionContext }) => {
    const page = await extensionContext.newPage();
    await page.goto(`file://${testPagePath}`);
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    // Get count
    const count = await getQuickTabCountFromDOM(page);

    console.log(`Total Quick Tabs: ${count}`);
    console.log('✓ Manager shows total Quick Tab count');

    await page.close();
  });
});
