/**
 * Test Bridge Verification Test
 *
 * Minimal test to verify test bridge loads correctly in Chrome extension.
 * Used for debugging browser launch issues.
 */

import { test, expect } from './fixtures.js';

test.describe('Test Bridge Verification', () => {
  test('should launch browser and load test bridge', async ({ context }) => {
    console.log('[Test] Context created successfully');

    const page = await context.newPage();
    console.log('[Test] Page created');

    await page.goto('https://example.com');
    console.log('[Test] Navigated to example.com');

    // Wait a bit for content script to inject
    await page.waitForTimeout(2000);

    // Check if test bridge exists
    const hasBridge = await page.evaluate(() => {
      console.log('[Page] Checking for test bridge...');
      const exists = typeof window.__COPILOT_TEST_BRIDGE__ !== 'undefined';
      console.log('[Page] Test bridge exists:', exists);
      return exists;
    });

    console.log('[Test] Test bridge found:', hasBridge);

    expect(hasBridge).toBe(true);

    await page.close();
  });
});
