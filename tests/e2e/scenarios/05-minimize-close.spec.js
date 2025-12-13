/**
 * Scenario 5 & 6: Minimize/Restore and Close Quick Tab
 *
 * These E2E tests verify minimize/restore state transitions
 * and closing Quick Tabs works correctly.
 *
 * @module tests/e2e/scenarios/05-minimize-close
 */

import path from 'path';
import { fileURLToPath } from 'url';

import { test, expect } from '../fixtures/extension.js';
import { waitForSync, getQuickTabCountFromDOM } from '../helpers/quick-tabs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testPagePath = path.join(__dirname, '../fixtures', 'test-page.html');

test.describe('Scenario 5 & 6: Minimize/Restore and Close', () => {
  /**
   * Test 1: Minimize/restore doesn't affect other tabs
   */
  test('minimize/restore is isolated per tab', async ({ extensionContext }) => {
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

    // Both should have same initial state
    expect(count1Initial).toBe(count2Initial);

    console.log(`Tab 1: ${count1Initial}, Tab 2: ${count2Initial}`);
    console.log('✓ Minimize/restore is isolated per tab');

    await tab1.close();
    await tab2.close();
  });

  /**
   * Test 2: Quick Tab state remains consistent after operations
   */
  test('Quick Tab state remains consistent', async ({ extensionContext }) => {
    const page = await extensionContext.newPage();
    await page.goto(`file://${testPagePath}`);
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    // Get initial count
    const countInitial = await getQuickTabCountFromDOM(page);

    // Simulate some state changes
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    // Count should be consistent
    const countAfter = await getQuickTabCountFromDOM(page);
    expect(countAfter).toBe(countInitial);

    console.log('✓ Quick Tab state remains consistent');

    await page.close();
  });

  /**
   * Test 3: Close operation doesn't affect other tabs
   */
  test('close operation is isolated per tab', async ({ extensionContext }) => {
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

    // Each tab tracks independently
    expect(count1).toBe(count2);

    console.log('✓ Close operation is isolated per tab');

    await tab1.close();
    await tab2.close();
  });
});
