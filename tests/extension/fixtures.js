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
 * 
 * WORKAROUND: Uses regular browser.launch() + context.newContext() instead of
 * launchPersistentContext to avoid worker teardown timeout issues.
 * This approach provides faster cleanup and more reliable test execution.
 */
export const test = base.extend({
  // eslint-disable-next-line no-empty-pattern
  context: async ({ browserName }, use) => {
    const pathToExtension = path.join(__dirname, '../../dist');
    let browser;
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
      // Chromium extension loading - MUST use launchPersistentContext
      // Extensions ONLY work with persistent contexts in Playwright
      // Research confirms: browser.launch() + newContext() does NOT support extensions
      console.log('[Fixture] Using launchPersistentContext (required for extensions)');
      
      // Use unique temp directory for isolation
      const tmpDir = fs.mkdtempSync(path.join('/tmp', 'playwright-chrome-'));
      
      console.log('[Fixture] Extension path:', pathToExtension);
      console.log('[Fixture] Temp directory:', tmpDir);
      
      context = await chromium.launchPersistentContext(tmpDir, {
        headless: false, // Extensions require headed mode
        timeout: 90000, // Increased to 90s to match test timeout (critical for Xvfb)
        slowMo: 100, // Slow down operations slightly for CI stability
        args: [
          // Extension loading
          `--disable-extensions-except=${pathToExtension}`,
          `--load-extension=${pathToExtension}`,
          
          // Security/sandboxing (required for CI)
          '--no-sandbox',
          '--disable-setuid-sandbox',
          
          // Xvfb compatibility (CRITICAL for virtual display)
          '--disable-gpu', // Disable GPU acceleration
          '--use-gl=swiftshader', // Software renderer (bypasses GPU issues)
          '--disable-accelerated-2d-canvas', // Disable 2D acceleration
          '--disable-accelerated-video-decode', // Disable video decode acceleration
          '--disable-gl-drawing-for-tests', // Prevent OpenGL initialization
          '--disable-software-rasterizer', // Disable software rasterizer
          
          // CI environment optimizations
          '--disable-dev-shm-usage', // CRITICAL: Prevents /dev/shm exhaustion
          '--disable-dbus', // Disable DBus to prevent connection errors in CI
          '--disable-features=DevToolsDebuggingRestrictions', // Required for Chromium 136+
          '--disable-component-extensions-with-background-pages', // Optimize teardown
          '--disable-default-apps', // Optimize teardown
          '--disable-blink-features=AutomationControlled',
          
          // Display configuration
          '--window-size=1920,1080', // Match Xvfb screen size
          '--disable-web-security', // Helps with extension CSP issues
          '--allow-insecure-localhost'
        ]
      }).catch((error) => {
        console.error('[Fixture] Browser launch failed:', error.message);
        console.error('[Fixture] Full error:', error);
        throw error;
      });
      console.log('[Fixture] Chromium persistent context created with extension');
    }

    await use(context);
    
    // Aggressive cleanup with hard 5-second timeout (research-recommended)
    try {
      // Close all pages first (non-blocking)
      const pages = context.pages();
      await Promise.all(pages.map(page => page.close().catch(() => {})));
      
      // Force close context with 5-second hard timeout
      await Promise.race([
        context.close(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Context close timeout')), 5000)
        )
      ]);
      console.log('[Fixture] Context closed successfully');
    } catch (error) {
      console.warn('[Fixture] Context cleanup error:', error.message);
      // Don't rethrow - let the browser process die naturally
      // Worker will clean up remaining processes
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
      try {
        let [background] = context.serviceWorkers();
        if (!background) {
          // Wait for service worker with timeout
          background = await Promise.race([
            context.waitForEvent('serviceworker'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Service worker timeout')), 10000))
          ]);
        }

        const extensionId = background.url().split('/')[2];
        console.log('[Fixture] Extension ID:', extensionId);
        await use(extensionId);
      } catch (error) {
        console.log('[Fixture] Could not detect extension ID:', error.message);
        // Use a placeholder if service worker detection fails
        await use('unknown-extension-id');
      }
    }
  }
});

export const expect = baseExpect;
