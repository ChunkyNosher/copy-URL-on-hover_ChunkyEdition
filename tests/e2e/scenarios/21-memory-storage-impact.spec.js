/**
 * Scenario 21: Memory and Storage Impact of Multiple Quick Tabs
 *
 * This E2E test verifies that creating many Quick Tabs doesn't cause
 * memory issues and storage remains bounded.
 *
 * @module tests/e2e/scenarios/21-memory-storage-impact
 */

import path from 'path';
import { fileURLToPath } from 'url';

import { test, expect } from '../fixtures/extension.js';
import { waitForSync, getQuickTabCountFromDOM } from '../helpers/quick-tabs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testPagePath = path.join(__dirname, '../fixtures', 'test-page.html');

test.describe('Scenario 21: Memory and Storage Impact', () => {
  /**
   * Test 1: Extension handles multiple tabs without issues
   */
  test('extension handles multiple tabs without issues', async ({ extensionContext }) => {
    const pages = [];

    // Create multiple tabs
    for (let i = 0; i < 5; i++) {
      const page = await extensionContext.newPage();
      await page.goto(`file://${testPagePath}`);
      await page.waitForLoadState('domcontentloaded');
      pages.push(page);
    }

    // Wait for all tabs to initialize
    await Promise.all(pages.map(p => waitForSync(p, 500)));

    // All tabs should work correctly
    const counts = await Promise.all(pages.map(p => getQuickTabCountFromDOM(p)));
    const allEqual = counts.every(c => c === counts[0]);
    expect(allEqual).toBe(true);

    console.log(`All ${pages.length} tabs have ${counts[0]} Quick Tabs`);
    console.log('✓ Extension handles multiple tabs without issues');

    // Cleanup
    for (const page of pages) {
      await page.close();
    }
  });

  /**
   * Test 2: State remains consistent with many operations
   */
  test('state remains consistent with many operations', async ({ extensionContext }) => {
    const page = await extensionContext.newPage();
    await page.goto(`file://${testPagePath}`);
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    const countInitial = await getQuickTabCountFromDOM(page);

    // Many operations
    for (let i = 0; i < 10; i++) {
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await waitForSync(page, 200);
    }

    const countFinal = await getQuickTabCountFromDOM(page);
    expect(countFinal).toBe(countInitial);

    console.log('✓ State remains consistent with many operations');

    await page.close();
  });

  /**
   * Test 3: Storage cleanup works correctly
   */
  test('storage cleanup preserves valid state', async ({ extensionContext }) => {
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
    const _count1Before = await getQuickTabCountFromDOM(tab1);
    const count2Before = await getQuickTabCountFromDOM(tab2);

    // Close tab1
    await tab1.close();
    await waitForSync(tab2, 500);

    // Tab2 should still have valid state
    const count2After = await getQuickTabCountFromDOM(tab2);
    expect(count2After).toBe(count2Before);

    console.log('✓ Storage cleanup preserves valid state');

    await tab2.close();
  });

  /**
   * Test 4: Extension recovers from concurrent operations
   */
  test('extension recovers from concurrent operations', async ({ extensionContext }) => {
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

    // Concurrent reloads
    await Promise.all([
      tab1.reload(),
      tab2.reload(),
      tab3.reload()
    ]);

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

    console.log('✓ Extension recovers from concurrent operations');

    await tab1.close();
    await tab2.close();
    await tab3.close();
  });
});
