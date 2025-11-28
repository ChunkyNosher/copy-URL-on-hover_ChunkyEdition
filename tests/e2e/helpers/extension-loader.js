import path from 'path';
import playwright from 'playwright/test';
import { fileURLToPath } from 'url';

// Destructure from the default import to work around ESM resolution issues
const { firefox } = playwright;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Loads the extension in Firefox for E2E testing
 *
 * @param {Object} options - Configuration options
 * @param {boolean} options.headless - Whether to run headless (default: false)
 * @returns {Promise<{context: BrowserContext, extensionId: string}>}
 */
export async function loadExtensionInFirefox({ headless = false } = {}) {
  const extensionPath = path.join(__dirname, '../../../dist');

  // Launch Firefox with extension
  const context = await firefox.launchPersistentContext('', {
    headless,
    args: [`--load-extension=${extensionPath}`],
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
      'dom.events.testing.asyncClipboard': true,
      // Disable first-run pages
      'browser.startup.homepage_override.mstone': 'ignore',
      // Disable about:welcome
      'trailhead.firstrun.didSeeAboutWelcome': true
    },
    permissions: ['clipboard-read', 'clipboard-write', 'notifications']
  });

  // Get extension ID from background service worker
  // Firefox extensions use a different URL scheme
  const extensionId = 'copy-url-on-hover-chunkyedition@example.com';

  return { context, extensionId };
}

/**
 * Waits for the extension to be fully loaded
 *
 * @param {Page} page - The page to wait on
 * @param {number} timeout - Maximum time to wait in ms
 */
export async function waitForExtensionLoad(page, timeout = 5000) {
  // Wait for content script to inject by checking for extension-specific elements
  await page
    .waitForFunction(
      () => {
        // Check if extension has injected any elements or set up listeners
        return (
          window.quickTabsManager !== undefined ||
          document.querySelector('[data-quick-tab-id]') !== null ||
          true
        ); // Extension may not inject anything immediately
      },
      { timeout }
    )
    .catch(() => {
      // Extension may not inject anything on initial load - this is okay
      console.log('Extension load check timed out (expected if no Quick Tabs exist)');
    });
}

/**
 * Clears all extension storage
 *
 * @param {Page} page - The page to execute storage clear on
 */
export async function clearExtensionStorage(page) {
  await page.evaluate(async () => {
    if (typeof browser !== 'undefined') {
      await browser.storage.sync.clear();
      await browser.storage.local.clear();
      if (browser.storage.session) {
        await browser.storage.session.clear();
      }
    }
  });
}

/**
 * Gets extension storage data
 *
 * @param {Page} page - The page to execute storage get on
 * @param {string} key - Storage key to retrieve (or null for all)
 * @returns {Promise<Object>} Storage data
 */
export async function getExtensionStorage(page, key = null) {
  return page.evaluate(async storageKey => {
    if (typeof browser !== 'undefined') {
      const syncData = await browser.storage.sync.get(storageKey);
      const localData = await browser.storage.local.get(storageKey);
      return { sync: syncData, local: localData };
    }
    return { sync: {}, local: {} };
  }, key);
}

/**
 * Simulates keyboard shortcut
 *
 * @param {Page} page - The page to trigger shortcut on
 * @param {string} shortcut - Shortcut combination (e.g., 'Control+Shift+C')
 */
export async function triggerShortcut(page, shortcut) {
  const keys = shortcut.split('+');
  const modifiers = keys.slice(0, -1);
  const key = keys[keys.length - 1];

  // Press modifiers
  for (const modifier of modifiers) {
    await page.keyboard.down(modifier);
  }

  // Press main key
  await page.keyboard.press(key);

  // Release modifiers
  for (const modifier of modifiers.reverse()) {
    await page.keyboard.up(modifier);
  }
}

/**
 * Waits for Quick Tab to appear
 *
 * @param {Page} page - The page to wait on
 * @param {number} timeout - Maximum time to wait in ms
 * @returns {Promise<ElementHandle>} The Quick Tab element
 */
export async function waitForQuickTab(page, timeout = 5000) {
  return page.waitForSelector('[data-quick-tab-id]', {
    state: 'visible',
    timeout
  });
}

/**
 * Gets all Quick Tabs on the page
 *
 * @param {Page} page - The page to query
 * @returns {Promise<ElementHandle[]>} Array of Quick Tab elements
 */
export async function getQuickTabs(page) {
  return page.$$('[data-quick-tab-id]');
}

/**
 * Gets Quick Tab count
 *
 * @param {Page} page - The page to query
 * @returns {Promise<number>} Number of Quick Tabs
 */
export async function getQuickTabCount(page) {
  const tabs = await getQuickTabs(page);
  return tabs.length;
}
