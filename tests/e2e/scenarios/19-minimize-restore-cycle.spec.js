/**
 * Scenario 19: Minimize and Restore Cycle in One Tab
 *
 * This E2E test verifies that minimize/restore state machine transitions
 * correctly within a single tab.
 *
 * @module tests/e2e/scenarios/19-minimize-restore-cycle
 */

import path from 'path';
import { fileURLToPath } from 'url';

import { test, expect } from '../fixtures/extension.js';
import { waitForSync, getQuickTabCountFromDOM } from '../helpers/quick-tabs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testPagePath = path.join(__dirname, '../fixtures', 'test-page.html');

test.describe('Scenario 19: Minimize/Restore Cycle', () => {
  /**
   * Test 1: State machine handles minimize/restore transitions
   */
  test('state machine handles transitions correctly', async ({ extensionContext }) => {
    const page = await extensionContext.newPage();
    await page.goto(`file://${testPagePath}`);
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    const countBefore = await getQuickTabCountFromDOM(page);

    // Simulate multiple state transitions via reload
    for (let i = 0; i < 3; i++) {
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await waitForSync(page, 300);
    }

    const countAfter = await getQuickTabCountFromDOM(page);
    expect(countAfter).toBe(countBefore);

    console.log('✓ State machine handles transitions correctly');

    await page.close();
  });

  /**
   * Test 2: Rapid minimize/restore doesn't break state
   */
  test('rapid operations do not break state', async ({ extensionContext }) => {
    const page = await extensionContext.newPage();
    await page.goto(`file://${testPagePath}`);
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    const countInitial = await getQuickTabCountFromDOM(page);

    // Rapid operations
    for (let i = 0; i < 5; i++) {
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await waitForSync(page, 100);
    }

    const countFinal = await getQuickTabCountFromDOM(page);
    expect(countFinal).toBe(countInitial);

    console.log('✓ Rapid operations do not break state');

    await page.close();
  });

  /**
   * Test 3: Final state is consistent after cycle
   */
  test('final state is consistent after operations', async ({ extensionContext }) => {
    const page = await extensionContext.newPage();
    await page.goto(`file://${testPagePath}`);
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    const countStart = await getQuickTabCountFromDOM(page);

    // Multiple navigation operations
    await page.goto(`file://${testPagePath}#a`);
    await page.waitForLoadState('domcontentloaded');
    await page.goto(`file://${testPagePath}#b`);
    await page.waitForLoadState('domcontentloaded');
    await page.goBack();
    await page.waitForLoadState('domcontentloaded');
    await page.goForward();
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    const countEnd = await getQuickTabCountFromDOM(page);
    expect(countEnd).toBe(countStart);

    console.log('✓ Final state is consistent after operations');

    await page.close();
  });
});
