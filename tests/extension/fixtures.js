// tests/extension/fixtures.js
import path from 'path';
import playwright from 'playwright/test';
import { fileURLToPath } from 'url';
import fs from 'fs';

const { test: base, chromium, firefox, expect: baseExpect } = playwright;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Extension testing fixture
 * Supports both Chromium and Firefox with browser detection
 */
export const test = base.extend({
  // eslint-disable-next-line no-empty-pattern
  context: async ({ browserName }, use) => {
    const pathToExtension = path.join(__dirname, '../../dist');
    let context;

    if (browserName === 'firefox') {
      // Firefox extension loading requires different approach
      // Using persistent context with Firefox profile
      const firefoxUserDataDir = path.join(__dirname, '../../firefox-test-profile');
      
      // Ensure directory exists
      if (!fs.existsSync(firefoxUserDataDir)) {
        fs.mkdirSync(firefoxUserDataDir, { recursive: true });
      }

      context = await firefox.launchPersistentContext(firefoxUserDataDir, {
        headless: false, // Firefox extensions require headed mode
        firefoxUserPrefs: {
          // Disable extension signing requirement
          'xpinstall.signatures.required': false,
          // Enable all extension scopes
          'extensions.autoDisableScopes': 0,
          'extensions.enabledScopes': 15,
          // Enable devtools
          'devtools.chrome.enabled': true,
          'devtools.debugger.remote-enabled': true,
          // Allow clipboard access
          'dom.events.testing.asyncClipboard': true
        }
      });

      // For Firefox, we need to manually install the extension
      // This is a limitation of Playwright - Firefox extensions must be installed
      // programmatically via the WebExtensions API or manually in the profile
      console.log('[Fixture] Firefox context created');
      console.log('[Fixture] Note: Extension must be manually loaded in Firefox profile');
      
    } else {
      // Chromium extension loading
      // Use unique temp directory for each test to avoid conflicts
      const tmpDir = fs.mkdtempSync(path.join('/tmp', 'playwright-chrome-'));
      
      context = await chromium.launchPersistentContext(tmpDir, {
        channel: 'chromium', // Required for headless extension support
        headless: false, // Changed to false for consistency
        args: [
          `--disable-extensions-except=${pathToExtension}`,
          `--load-extension=${pathToExtension}`,
          '--no-sandbox',
          '--disable-setuid-sandbox'
        ]
      });
      console.log('[Fixture] Chromium context created with extension');
    }

    await use(context);
    
    // Ensure proper cleanup with timeout handling
    try {
      await context.close();
      console.log('[Fixture] Context closed successfully');
    } catch (error) {
      console.error('[Fixture] Error closing context:', error);
      // Force close if regular close fails
      try {
        await context.close({ runBeforeUnload: false });
      } catch (e) {
        console.error('[Fixture] Force close also failed:', e);
      }
    }
  },

  extensionId: async ({ context, browserName }, use) => {
    if (browserName === 'firefox') {
      // Firefox extension IDs are UUIDs assigned at install time
      // For now, we'll use a placeholder since the extension must be manually loaded
      console.log('[Fixture] Firefox extension ID detection not implemented');
      await use('firefox-extension-id');
    } else {
      // Chromium extension ID extraction from service worker
      let [background] = context.serviceWorkers();
      if (!background) background = await context.waitForEvent('serviceworker');

      const extensionId = background.url().split('/')[2];
      await use(extensionId);
    }
  }
});

export const expect = baseExpect;
