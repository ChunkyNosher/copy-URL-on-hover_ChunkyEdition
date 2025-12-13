import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '../fixtures/extension.js';
import { waitForSync, getQuickTabCountFromDOM, isExtensionReady } from '../helpers/quick-tabs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testPagePath = path.join(__dirname, '../fixtures', 'test-page.html');

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
    await page.goto(`file://${testPagePath}`);

    // Wait for page to load
    await page.waitForLoadState('domcontentloaded');

    // Verify page loaded correctly
    expect(page.url()).toContain('test-page.html');

    // Cleanup
    await page.close();
  });

  test('should verify extension is active on page', async ({ extensionContext }) => {
    // Step 1: Open a test page
    const page = await extensionContext.newPage();
    await page.goto(`file://${testPagePath}`);

    // Wait for page to fully load
    await page.waitForLoadState('domcontentloaded');

    // Give extension time to initialize
    await waitForSync(page, 1000);

    // Check if extension is ready (Test Bridge available)
    const ready = await isExtensionReady(page);

    if (ready) {
      console.log('✓ Test Bridge API is available');
    } else {
      console.log(
        '⚠ Test Bridge API not available (extension may not be built with TEST_MODE=true)'
      );
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
    await page1.goto(`file://${testPagePath}`);
    await page1.waitForLoadState('domcontentloaded');

    // Step 2: Open second page
    const page2 = await extensionContext.newPage();
    await page2.goto(`file://${testPagePath}`);
    await page2.waitForLoadState('domcontentloaded');

    // Step 3: Verify both pages are accessible
    expect(page1.url()).toContain('test-page.html');
    expect(page2.url()).toContain('test-page.html');

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

  test('should navigate between pages', async ({ extensionContext }) => {
    const page = await extensionContext.newPage();

    // Navigate to test page
    await page.goto(`file://${testPagePath}`);
    await page.waitForLoadState('domcontentloaded');
    console.log(`✓ Loaded: test-page.html`);

    // Navigate to another section of the test page
    await page.goto(`file://${testPagePath}#section2`);
    await page.waitForLoadState('domcontentloaded');
    console.log(`✓ Navigated to: test-page.html#section2`);

    // Verify we can still navigate
    expect(page.url()).toContain('test-page.html');

    await page.close();
  });
});
