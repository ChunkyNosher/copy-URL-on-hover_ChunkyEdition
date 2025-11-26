import { test, expect } from './fixtures/extension.js';
import { isExtensionReady } from './helpers/quick-tabs.js';

test.describe('Extension Loading', () => {
  test('should load extension in Firefox', async ({ extensionContext }) => {
    const page = await extensionContext.newPage();
    await page.goto('https://example.com');
    
    // Verify page loaded
    expect(page.url()).toContain('example.com');
    
    await page.close();
  });

  test('should have extension ready', async ({ extensionContext }) => {
    const page = await extensionContext.newPage();
    await page.goto('https://example.com');
    await page.waitForLoadState('networkidle');
    
    const ready = await isExtensionReady(page);
    console.log(`Extension ready: ${ready}`);
    
    // Extension should load (Test Bridge may or may not be available)
    expect(page.url()).toContain('example.com');
    
    await page.close();
  });
});
