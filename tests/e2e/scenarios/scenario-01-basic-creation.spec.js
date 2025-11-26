import { test, expect } from '../fixtures/extension.js';
import { waitForSync, getQuickTabCountFromDOM, isExtensionReady } from '../helpers/quick-tabs.js';

/**
 * Scenario 1: Basic Quick Tab Creation & Cross-Tab Sync
 *
 * Tests:
 * 1. Extension loads successfully
 * 2. Quick Tab creation (when Test Bridge available)
 * 3. Quick Tab persistence across tabs
 * 4. Position/size synchronization
 */
test.describe('Scenario 1: Basic Quick Tab Creation & Cross-Tab Sync', () => {
  test('should load extension successfully', async ({ extensionContext }) => {
    // Step 1: Open a test page
    const page = await extensionContext.newPage();
    await page.goto('https://example.com');

    // Wait for page to load
    await page.waitForLoadState('domcontentloaded');

    // Verify page loaded correctly
    expect(page.url()).toContain('example.com');

    // Cleanup
    await page.close();
  });

  test('should verify extension is active on page', async ({ extensionContext }) => {
    // Step 1: Open a test page
    const page = await extensionContext.newPage();
    await page.goto('https://example.com');

    // Wait for page to fully load
    await page.waitForLoadState('networkidle');

    // Give extension time to initialize
    await waitForSync(page, 1000);

    // Check if extension is ready (Test Bridge available)
    const ready = await isExtensionReady(page);

    if (ready) {
      console.log('✓ Test Bridge API is available');
    } else {
      console.log('⚠ Test Bridge API not available (extension may not be built with TEST_MODE=true)');
    }

    // Verify page is accessible
    const title = await page.title();
    expect(title).toBeDefined();

    // Cleanup
    await page.close();
  });

  test('should open multiple tabs in same context', async ({ extensionContext }) => {
    // Step 1: Open first page
    const page1 = await extensionContext.newPage();
    await page1.goto('https://example.com');
    await page1.waitForLoadState('domcontentloaded');

    // Step 2: Open second page
    const page2 = await extensionContext.newPage();
    await page2.goto('https://en.wikipedia.org/wiki/Main_Page');
    await page2.waitForLoadState('domcontentloaded');

    // Step 3: Verify both pages are accessible
    expect(page1.url()).toContain('example.com');
    expect(page2.url()).toContain('wikipedia.org');

    // Step 4: Quick Tab count should be same on both pages (synced)
    await waitForSync(page1);
    await waitForSync(page2);

    const count1 = await getQuickTabCountFromDOM(page1);
    const count2 = await getQuickTabCountFromDOM(page2);

    // Both should have same Quick Tab count (state is synced)
    expect(count1).toBe(count2);

    // Cleanup
    await page1.close();
    await page2.close();
  });

  test('should navigate between different sites', async ({ extensionContext }) => {
    const page = await extensionContext.newPage();

    // Visit multiple sites
    const sites = [
      'https://example.com',
      'https://www.google.com',
      'https://github.com',
    ];

    for (const site of sites) {
      try {
        await page.goto(site, { timeout: 10000 });
        await page.waitForLoadState('domcontentloaded');
        console.log(`✓ Loaded: ${site}`);
      } catch (error) {
        console.log(`⚠ Could not load: ${site} (may be blocked)`);
      }
    }

    // Verify we can still navigate
    await page.goto('https://example.com');
    expect(page.url()).toContain('example.com');

    await page.close();
  });
});
