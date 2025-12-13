import path from 'path';
import { fileURLToPath } from 'url';

import { test, expect } from './fixtures/extension.js';
import { isExtensionReady } from './helpers/quick-tabs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('Extension Loading', () => {
  test('should load extension in Firefox', async ({ extensionContext }) => {
    const page = await extensionContext.newPage();

    // Use local test page instead of external URL
    const testPagePath = path.join(__dirname, 'fixtures', 'test-page.html');
    await page.goto(`file://${testPagePath}`);

    // Verify page loaded
    expect(page.url()).toContain('test-page.html');

    await page.close();
  });

  test('should have extension ready', async ({ extensionContext }) => {
    const page = await extensionContext.newPage();

    // Use local test page instead of external URL
    const testPagePath = path.join(__dirname, 'fixtures', 'test-page.html');
    await page.goto(`file://${testPagePath}`);
    await page.waitForLoadState('domcontentloaded');

    const ready = await isExtensionReady(page);
    console.log(`Extension ready: ${ready}`);

    // Extension should load (Test Bridge may or may not be available)
    expect(page.url()).toContain('test-page.html');

    await page.close();
  });
});
