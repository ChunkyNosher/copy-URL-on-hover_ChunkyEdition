/**
 * Quick minimal test for bridge availability
 */

import { test, expect } from './fixtures.js';
import { ExtensionTestHelper } from './helpers/extension-test-utils.js';

test.describe('Quick Bridge Test', () => {
  test('bridge should be available quickly', async ({ context }) => {
    const page = await context.newPage();
    
    try {
      await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
      console.log('Page loaded');
      
      const helper = new ExtensionTestHelper(page);
      
      const bridgeReady = await helper.waitForTestBridge(5000);
      console.log('Bridge ready:', bridgeReady);
      
      expect(bridgeReady).toBe(true);
      
      console.log('Test passed!');
    } finally {
      await page.close();
    }
  });
});
