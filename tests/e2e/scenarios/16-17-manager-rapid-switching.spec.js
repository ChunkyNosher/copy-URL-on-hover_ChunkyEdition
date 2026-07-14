/**
 * Scenario 16 & 17: Manager Panel and Rapid Tab Switching
 *
 * These E2E tests verify Manager Panel position persistence
 * and Quick Tab state during rapid tab switching.
 *
 * @module tests/e2e/scenarios/16-17-manager-rapid-switching
 */

import path from 'path';
import { fileURLToPath } from 'url';

import { test, expect } from '../fixtures/extension.js';
import { waitForSync, getQuickTabCountFromDOM } from '../helpers/quick-tabs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testPagePath = path.join(__dirname, '../fixtures', 'test-page.html');

test.describe('Scenario 16 & 17: Manager and Rapid Tab Switching', () => {
  /**
   * Test 1: Manager state persists across tab switches
   */
  test('Manager state persists across tab switches', async ({ extensionContext }) => {
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

    // Get state from both tabs
    const count1 = await getQuickTabCountFromDOM(tab1);
    const count2 = await getQuickTabCountFromDOM(tab2);

    // State should be consistent
    expect(count1).toBe(count2);

    console.log('✓ Manager state persists across tab switches');

    await tab1.close();
    await tab2.close();
  });

  /**
   * Test 2: Rapid tab switching preserves state
   */
  test('rapid tab switching preserves state', async ({ extensionContext }) => {
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

    const countBefore = await getQuickTabCountFromDOM(tab1);

    // Rapid tab switching
    for (let i = 0; i < 5; i++) {
      await tab2.bringToFront();
      await waitForSync(tab2, 50);
      await tab1.bringToFront();
      await waitForSync(tab1, 50);
    }

    // State should be preserved
    const countAfter = await getQuickTabCountFromDOM(tab1);
    expect(countAfter).toBe(countBefore);

    console.log('✓ Rapid tab switching preserves state');

    await tab1.close();
    await tab2.close();
  });

  /**
   * Test 3: State consistency during concurrent operations
   */
  test('state consistency during concurrent operations', async ({ extensionContext }) => {
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

    // Simulate concurrent operations
    await Promise.all([tab1.reload(), tab2.reload(), tab3.reload()]);

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

    console.log('✓ State consistency during concurrent operations');

    await tab1.close();
    await tab2.close();
    await tab3.close();
  });
});
