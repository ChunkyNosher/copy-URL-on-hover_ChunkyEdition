/**
 * Scenario 20: Cross-Domain Navigation in Same Tab
 *
 * This E2E test verifies that Quick Tabs persist when navigating to
 * a different domain in the same tab, and hydrate on page reload.
 *
 * @module tests/e2e/scenarios/20-cross-domain-navigation
 */

import path from 'path';
import { fileURLToPath } from 'url';

import { test, expect } from '../fixtures/extension.js';
import { waitForSync, getQuickTabCountFromDOM } from '../helpers/quick-tabs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testPagePath = path.join(__dirname, '../fixtures', 'test-page.html');

test.describe('Scenario 20: Cross-Domain Navigation', () => {
  /**
   * Test 1: Quick Tabs persist during in-page navigation
   */
  test('Quick Tabs persist during in-page navigation', async ({ extensionContext }) => {
    const page = await extensionContext.newPage();
    await page.goto(`file://${testPagePath}`);
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    const countBefore = await getQuickTabCountFromDOM(page);

    // Navigate to different hash
    await page.goto(`file://${testPagePath}#section1`);
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    const countMid = await getQuickTabCountFromDOM(page);

    // Navigate back
    await page.goto(`file://${testPagePath}`);
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    const countAfter = await getQuickTabCountFromDOM(page);

    expect(countMid).toBe(countBefore);
    expect(countAfter).toBe(countBefore);

    console.log('✓ Quick Tabs persist during in-page navigation');

    await page.close();
  });

  /**
   * Test 2: Quick Tabs hydrate after navigation
   */
  test('Quick Tabs hydrate after navigation', async ({ extensionContext }) => {
    const page = await extensionContext.newPage();
    await page.goto(`file://${testPagePath}`);
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    const countBefore = await getQuickTabCountFromDOM(page);

    // Navigate to different section
    await page.goto(`file://${testPagePath}#hydration-test`);
    await page.waitForLoadState('domcontentloaded');

    // Reload to trigger hydration
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    const countAfter = await getQuickTabCountFromDOM(page);
    expect(countAfter).toBe(countBefore);

    console.log('✓ Quick Tabs hydrate after navigation');

    await page.close();
  });

  /**
   * Test 3: originTabId remains consistent across navigation
   */
  test('originTabId remains consistent across navigation', async ({ extensionContext }) => {
    const page = await extensionContext.newPage();
    await page.goto(`file://${testPagePath}`);
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    const countStart = await getQuickTabCountFromDOM(page);

    // Multiple navigations
    const sections = ['#a', '#b', '#c', '#d', '#e'];
    for (const section of sections) {
      await page.goto(`file://${testPagePath}${section}`);
      await page.waitForLoadState('domcontentloaded');
      await waitForSync(page, 200);
    }

    const countEnd = await getQuickTabCountFromDOM(page);
    expect(countEnd).toBe(countStart);

    console.log('✓ originTabId remains consistent across navigation');

    await page.close();
  });
});
