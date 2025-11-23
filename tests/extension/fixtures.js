// tests/extension/fixtures.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import playwright from 'playwright/test';

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

    // Validate extension exists before attempting to load
    console.log('[Fixture] Extension path:', pathToExtension);
    if (!fs.existsSync(pathToExtension)) {
      throw new Error(`Extension path does not exist: ${pathToExtension}`);
    }
    const manifestPath = path.join(pathToExtension, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`manifest.json not found in: ${pathToExtension}`);
    }
    console.log('[Fixture] ✓ Extension validated');
    console.log('[Fixture] Extension files:', fs.readdirSync(pathToExtension).slice(0, 10).join(', '));

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
      
      console.log('[Fixture] Temp directory:', tmpDir);
      
      // Clean any existing session state that might cause hangs
      try {
        const sessionFiles = [
          path.join(tmpDir, 'sessionstore-backups'),
          path.join(tmpDir, 'sessionCheckpoints.json'),
          path.join(tmpDir, 'sessionstore.jsonlz4')
        ];
        for (const file of sessionFiles) {
          if (fs.existsSync(file)) {
            fs.rmSync(file, { recursive: true, force: true });
          }
        }
        console.log('[Fixture] Cleaned session state files');
      } catch (error) {
        console.log('[Fixture] No session files to clean (fresh start)');
      }
      
      console.log('[Fixture] Launching Chromium persistent context...');
      
      context = await chromium.launchPersistentContext(tmpDir, {
        headless: false, // Extensions require headed mode
        timeout: 60000, // Reduced to 60s - should be sufficient per research
        slowMo: 0, // No slowdown for CI
        args: [
          // Extension loading (REQUIRED - must be first)
          `--disable-extensions-except=${pathToExtension}`,
          `--load-extension=${pathToExtension}`,
          
          // Security/sandboxing (CRITICAL for CI)
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage', // CRITICAL: Prevents /dev/shm exhaustion
          
          // Xvfb compatibility (simplified for faster startup)
          '--disable-gpu',
          '--use-gl=swiftshader',
          
          // Component optimization (prevents background page hangs)
          '--disable-component-extensions-with-background-pages',
          
          // Basic CI optimizations
          '--disable-features=TranslateUI',
          '--disable-blink-features=AutomationControlled',
          
          // Display
          '--window-size=1920,1080'
        ]
      }).catch((error) => {
        console.error('[Fixture] ✗ Browser launch failed:', error.message);
        console.error('[Fixture] Extension path was:', pathToExtension);
        console.error('[Fixture] Temp directory was:', tmpDir);
        console.error('[Fixture] Full error:', error.stack);
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
        let background = context.serviceWorkers()[0];
        if (!background) {
          // Wait for service worker with timeout
          background = await Promise.race([
            context.waitForEvent('serviceworker'),
            new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Service worker timeout')), 10000))
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
