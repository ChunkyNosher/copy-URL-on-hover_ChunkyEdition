/**
 * Additional E2E Tests for Quick Tabs Behaviors
 *
 * These tests cover additional behaviors inferred from the issue-47 document
 * and general extension functionality.
 *
 * @module tests/e2e/scenarios/additional-behaviors
 */

import path from 'path';
import { fileURLToPath } from 'url';

import { test, expect } from '../fixtures/extension.js';
import { waitForSync, getQuickTabCountFromDOM } from '../helpers/quick-tabs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testPagePath = path.join(__dirname, '../fixtures', 'test-page.html');

test.describe('Additional Quick Tab Behaviors', () => {
  /**
   * Test 1: Extension doesn't crash with many tabs
   */
  test('extension handles 5+ tabs without crashing', async ({ extensionContext }) => {
    const tabs = [];

    // Create 5 tabs
    for (let i = 0; i < 5; i++) {
      const tab = await extensionContext.newPage();
      await tab.goto(`file://${testPagePath}`);
      await tab.waitForLoadState('domcontentloaded');
      tabs.push(tab);
    }

    await Promise.all(tabs.map(t => waitForSync(t, 500)));

    // All tabs should work
    for (const tab of tabs) {
      const count = await getQuickTabCountFromDOM(tab);
      expect(count).toBeGreaterThanOrEqual(0);
    }

    console.log('✓ Extension handles 5+ tabs without crashing');

    for (const tab of tabs) {
      await tab.close();
    }
  });

  /**
   * Test 2: State persists after browser idle
   */
  test('state persists after idle period', async ({ extensionContext }) => {
    const page = await extensionContext.newPage();
    await page.goto(`file://${testPagePath}`);
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    const countBefore = await getQuickTabCountFromDOM(page);

    // Simulate idle period
    await page.waitForTimeout(2000);

    const countAfter = await getQuickTabCountFromDOM(page);
    expect(countAfter).toBe(countBefore);

    console.log('✓ State persists after idle period');

    await page.close();
  });

  /**
   * Test 3: Page scroll doesn't affect Quick Tabs
   */
  test('page scroll does not affect Quick Tab state', async ({ extensionContext }) => {
    const page = await extensionContext.newPage();
    await page.goto(`file://${testPagePath}`);
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    const countBefore = await getQuickTabCountFromDOM(page);

    // Scroll page
    await page.evaluate(() => window.scrollTo(0, 500));
    await waitForSync(page, 200);
    await page.evaluate(() => window.scrollTo(0, 0));
    await waitForSync(page, 200);

    const countAfter = await getQuickTabCountFromDOM(page);
    expect(countAfter).toBe(countBefore);

    console.log('✓ Page scroll does not affect Quick Tab state');

    await page.close();
  });

  /**
   * Test 4: Clicking links on page doesn't break state
   */
  test('clicking links does not break Quick Tab state', async ({ extensionContext }) => {
    const page = await extensionContext.newPage();
    await page.goto(`file://${testPagePath}`);
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    const countBefore = await getQuickTabCountFromDOM(page);

    // Click on test links (should use file:// URLs)
    const links = await page.$$('a');
    if (links.length > 0) {
      // Click first link that won't navigate away
      const href = await links[0].getAttribute('href');
      if (href && href.startsWith('#')) {
        await links[0].click();
        await waitForSync(page, 300);
      }
    }

    const countAfter = await getQuickTabCountFromDOM(page);
    expect(countAfter).toBe(countBefore);

    console.log('✓ Clicking links does not break Quick Tab state');

    await page.close();
  });

  /**
   * Test 5: Form interactions don't affect Quick Tabs
   */
  test('form interactions do not affect Quick Tabs', async ({ extensionContext }) => {
    const page = await extensionContext.newPage();
    await page.goto(`file://${testPagePath}`);
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    const countBefore = await getQuickTabCountFromDOM(page);

    // Type in any input fields
    const inputs = await page.$$('input');
    if (inputs.length > 0) {
      await inputs[0].type('test input');
      await waitForSync(page, 200);
    }

    const countAfter = await getQuickTabCountFromDOM(page);
    expect(countAfter).toBe(countBefore);

    console.log('✓ Form interactions do not affect Quick Tabs');

    await page.close();
  });

  /**
   * Test 6: Browser back/forward navigation preserves state
   */
  test('browser back/forward preserves Quick Tab state', async ({ extensionContext }) => {
    const page = await extensionContext.newPage();
    await page.goto(`file://${testPagePath}`);
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    const countInitial = await getQuickTabCountFromDOM(page);

    // Navigate to different section
    await page.goto(`file://${testPagePath}#section1`);
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 300);

    // Go back
    await page.goBack();
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 300);

    // Go forward
    await page.goForward();
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 300);

    const countFinal = await getQuickTabCountFromDOM(page);
    expect(countFinal).toBe(countInitial);

    console.log('✓ Browser back/forward preserves Quick Tab state');

    await page.close();
  });

  /**
   * Test 7: State is isolated between different pages in same tab
   */
  test('state isolation during page changes', async ({ extensionContext }) => {
    const page = await extensionContext.newPage();
    await page.goto(`file://${testPagePath}`);
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    const countPage1 = await getQuickTabCountFromDOM(page);

    // Navigate to different section
    await page.goto(`file://${testPagePath}#different`);
    await page.waitForLoadState('domcontentloaded');
    await waitForSync(page, 500);

    const countPage2 = await getQuickTabCountFromDOM(page);

    // State should be consistent (same tab)
    expect(countPage2).toBe(countPage1);

    console.log('✓ State isolation during page changes');

    await page.close();
  });
});
