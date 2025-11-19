// tests/extension/basic.test.js
const { test, expect } = require('./fixtures');

test.describe('Extension Basic Tests', () => {
  test('extension loads successfully', async ({ context, extensionId }) => {
    expect(extensionId).toBeTruthy();
    expect(extensionId).toMatch(/^[a-z]{32}$/);

    console.log('Extension ID:', extensionId);
  });

  test('extension popup opens', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    // Wait for popup to load
    await page.waitForLoadState('networkidle');

    // Check popup content
    const title = await page.title();
    expect(title).toBeTruthy();

    await page.close();
  });

  test('content script injects on web pages', async ({ context, page }) => {
    await page.goto('https://example.com');

    // Wait for content script to load
    await page.waitForTimeout(2000);

    // Check if extension modified the page
    const hasExtensionElement = await page.evaluate(() => {
      return document.querySelector('[data-extension-id]') !== null;
    });

    expect(hasExtensionElement).toBe(true);
  });

  test('Quick Tab can be created', async ({ context, page }) => {
    await page.goto('https://example.com');
    await page.waitForLoadState('networkidle');

    // Trigger Quick Tab creation (adjust selector based on your extension)
    await page.keyboard.press('Control+Shift+Q'); // Example hotkey

    // Wait for Quick Tab to appear
    const quickTab = await page.waitForSelector('[data-quick-tab]', { timeout: 5000 });
    expect(quickTab).toBeTruthy();

    // Verify Quick Tab is visible
    const isVisible = await quickTab.isVisible();
    expect(isVisible).toBe(true);
  });
});
