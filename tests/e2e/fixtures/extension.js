import fs from 'fs';
import path from 'path';
import playwright from 'playwright/test';
import { withExtension } from 'playwright-webextext';
import { fileURLToPath } from 'url';

// Destructure from the default import to work around ESM resolution issues
const { test: base, firefox, expect } = playwright;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Custom test fixture that loads the Firefox extension
 * and provides access to extension-enabled browser context
 */
export const test = base.extend({
  /**
   * Extension-enabled browser context
   * Automatically loads the extension before tests
   */
  // eslint-disable-next-line no-empty-pattern
  extensionContext: async ({}, use) => {
    // Path to built extension
    const extPath = path.join(__dirname, '../../../dist');

    // Verify extension build exists
    if (!fs.existsSync(path.join(extPath, 'manifest.json'))) {
      throw new Error(
        `Extension not found at ${extPath}. Run 'npm run build:prod' first.`
      );
    }

    // Create Firefox browser with extension loaded
    const browserTypeWithExt = withExtension(firefox, extPath);

    // Launch browser in TRUE HEADLESS mode (no Xvfb needed!)
    const browser = await browserTypeWithExt.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });

    // Create new context
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });

    // Provide context to test
    await use(context);

    // Cleanup
    await context.close();
    await browser.close();
  },

  /**
   * Page with extension loaded
   * Waits for Test Bridge API to be available
   */
  page: async ({ extensionContext }, use) => {
    const page = await extensionContext.newPage();

    // Navigate to a test page to trigger content script
    await page.goto('https://example.com');

    // Wait for Test Bridge API to be available (optional - may not exist in all builds)
    try {
      await page.waitForFunction(
        () => typeof window.__COPILOT_TEST_BRIDGE__ !== 'undefined',
        { timeout: 5000 }
      );
    } catch (error) {
      // Test Bridge API is optional - extension may work without it
      console.log(
        'Note: Test Bridge API not found. Extension may not be built with TEST_MODE=true'
      );
    }

    await use(page);
    await page.close();
  },
});

// Re-export expect
export { expect };
