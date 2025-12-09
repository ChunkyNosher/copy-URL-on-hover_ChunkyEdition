/**
 * Firefox Extension Installer for Playwright Tests
 *
 * Programmatically installs a Firefox extension into a profile directory
 * using the about:debugging temporary extension API.
 *
 * @see https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/
 */

import fs from 'fs';
import path from 'path';

/**
 * Install extension in Firefox context via about:debugging
 * @param {import('@playwright/test').BrowserContext} context - Firefox persistent context
 * @param {string} extensionPath - Path to unpacked extension directory
 * @returns {Promise<string>} Extension ID
 */
export async function installFirefoxExtension(context, extensionPath) {
  console.log('[Firefox Installer] Installing extension from:', extensionPath);

  // Verify extension path exists
  if (!fs.existsSync(extensionPath)) {
    throw new Error(`Extension path does not exist: ${extensionPath}`);
  }

  // Verify manifest.json exists
  const manifestPath = path.join(extensionPath, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest.json not found in: ${extensionPath}`);
  }

  // Read manifest to get extension details
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  console.log(`[Firefox Installer] Extension: ${manifest.name} v${manifest.version}`);

  // Create a new page for about:debugging
  const page = await context.newPage();

  try {
    // Navigate to about:debugging
    await page.goto('about:debugging#/runtime/this-firefox');
    console.log('[Firefox Installer] Navigated to about:debugging');

    // Wait for the page to load
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000); // Give time for UI to render

    // Click "Load Temporary Add-on" button
    // Note: This approach requires headed mode and user interaction simulation
    const loadButton = page.locator('button:has-text("Load Temporary Add-on")');

    // Check if button exists
    const buttonExists = (await loadButton.count()) > 0;

    if (!buttonExists) {
      console.warn('[Firefox Installer] Load Temporary Add-on button not found');
      console.warn('[Firefox Installer] This may indicate about:debugging UI has changed');

      // Alternative approach: Direct file system installation
      return await installViaFileSystem(context, extensionPath, manifest);
    }

    await loadButton.click();
    console.log('[Firefox Installer] Clicked Load Temporary Add-on button');

    // Handle file picker (this is tricky in automated tests)
    // Firefox file picker cannot be automated directly
    // We need to use a workaround

    console.warn('[Firefox Installer] File picker automation not possible in Firefox');
    console.warn('[Firefox Installer] Falling back to file system installation');

    await page.close();
    return await installViaFileSystem(context, extensionPath, manifest);
  } catch (error) {
    console.error('[Firefox Installer] Error during installation:', error.message);
    await page.close().catch(() => {});
    throw error;
  }
}

/**
 * Install extension by copying to profile's extensions directory
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} extensionPath
 * @param {Object} manifest
 * @returns {Promise<string>}
 */
async function installViaFileSystem(context, extensionPath, manifest) {
  console.log('[Firefox Installer] Using file system installation method');

  // Get extension ID from manifest
  // For Manifest V2, check browser_specific_settings.gecko.id
  let extensionId =
    manifest.browser_specific_settings?.gecko?.id || manifest.applications?.gecko?.id;

  if (!extensionId) {
    // Generate a temporary ID if none specified
    extensionId = `temp-extension-${Date.now()}@playwright.test`;
    console.warn(`[Firefox Installer] No extension ID in manifest, using: ${extensionId}`);
  }

  console.log(`[Firefox Installer] Extension ID: ${extensionId}`);

  // Note: This method requires the profile directory path
  // which is not directly accessible from the context object
  // This is a limitation of the current approach

  throw new Error(
    'File system installation requires profile directory access. ' +
      'Use pre-packaged XPI or manual profile preparation instead.'
  );
}

/**
 * Wait for extension to load in Firefox
 * @param {import('@playwright/test').Page} page
 * @param {number} timeout
 * @returns {Promise<boolean>}
 */
export async function waitForExtensionLoad(page, timeout = 10000) {
  console.log('[Firefox Installer] Waiting for extension to load...');

  try {
    await page.waitForFunction(() => typeof window.__COPILOT_TEST_BRIDGE__ !== 'undefined', {
      timeout
    });
    console.log('[Firefox Installer] ✓ Extension loaded successfully');
    return true;
  } catch (error) {
    console.error('[Firefox Installer] ✗ Extension did not load within timeout');
    return false;
  }
}
