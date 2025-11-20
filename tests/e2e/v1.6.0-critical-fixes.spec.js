/**
 * E2E Tests for v1.6.0 Critical Bug Fixes
 *
 * Tests verify:
 * 1. Content script loads correctly from dist/content.js
 * 2. Quick Tabs panel toggle via keyboard shortcut (Ctrl+Alt+Z)
 * 3. Log export functionality
 * 4. Log clear functionality
 *
 * Related: docs/manual/v1.6.0/v1.6.0-critical-bugs-diagnosis.md
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  loadExtensionInFirefox,
  waitForExtensionLoad,
  clearExtensionStorage,
  triggerShortcut
} from './helpers/extension-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('v1.6.0 Critical Fixes - Content Script Loading', () => {
  let context;
  let page;

  test.beforeEach(async () => {
    // Load extension with Firefox context
    const result = await loadExtensionInFirefox({ headless: false });
    context = result.context;

    // Create a new page
    page = await context.newPage();

    // Navigate to test page
    const testPagePath = path.join(__dirname, 'fixtures', 'test-page.html');
    await page.goto(`file://${testPagePath}`);

    // Wait for extension to load
    await waitForExtensionLoad(page, 10000);
  });

  test.afterEach(async () => {
    if (page) await page.close();
    if (context) await context.close();
  });

  test('content script should be loaded from dist/content.js', async () => {
    // Check that content script is injected by looking for extension markers
    const hasExtensionMarker = await page.evaluate(() => {
      return typeof window.CopyURLExtension !== 'undefined';
    });

    expect(hasExtensionMarker).toBe(true);
  });

  test('content script should initialize core systems', async () => {
    // Verify that core extension objects are initialized
    const coreSystemsInitialized = await page.evaluate(() => {
      const ext = window.CopyURLExtension;
      return (
        ext &&
        ext.configManager !== null &&
        ext.stateManager !== null &&
        ext.eventBus !== null &&
        ext.urlRegistry !== null
      );
    });

    expect(coreSystemsInitialized).toBe(true);
  });

  test('content script should not produce console errors on load', async () => {
    // Collect console errors
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    // Wait a bit for any delayed errors
    await page.waitForTimeout(2000);

    // Filter out known non-critical errors
    const criticalErrors = errors.filter(
      err =>
        !err.includes('favicon') && // Ignore favicon errors
        !err.includes('Could not establish connection') // Initial connection attempts are OK
    );

    expect(criticalErrors).toHaveLength(0);
  });
});

test.describe('v1.6.0 Critical Fixes - Keyboard Shortcut (Ctrl+Alt+Z)', () => {
  let context;
  let page;

  test.beforeEach(async () => {
    const result = await loadExtensionInFirefox({ headless: false });
    context = result.context;
    page = await context.newPage();

    const testPagePath = path.join(__dirname, 'fixtures', 'test-page.html');
    await page.goto(`file://${testPagePath}`);
    await waitForExtensionLoad(page, 10000);

    // Clear any existing Quick Tabs state
    await clearExtensionStorage(page);
  });

  test.afterEach(async () => {
    if (page) await page.close();
    if (context) await context.close();
  });

  test('Ctrl+Alt+Z should trigger TOGGLE_QUICK_TABS_PANEL message', async () => {
    // Set up message listener to capture the toggle action
    const messagePromise = page.evaluate(() => {
      return new Promise(resolve => {
        let toggleReceived = false;

        // Intercept messages
        browser.runtime.onMessage.addListener(message => {
          if (message.action === 'TOGGLE_QUICK_TABS_PANEL') {
            toggleReceived = true;
            resolve(true);
          }
        });

        // Timeout after 5 seconds
        setTimeout(() => {
          if (!toggleReceived) {
            resolve(false);
          }
        }, 5000);
      });
    });

    // Trigger keyboard shortcut
    await triggerShortcut(page, 'Control+Alt+Z');

    // Wait for message to be received
    const toggleReceived = await messagePromise;

    expect(toggleReceived).toBe(true);
  });

  test('Ctrl+Alt+Z should not produce console errors', async () => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    // Trigger keyboard shortcut
    await triggerShortcut(page, 'Control+Alt+Z');

    // Wait for any errors to appear
    await page.waitForTimeout(1000);

    // Should not have "Could not establish connection" errors
    const connectionErrors = errors.filter(err =>
      err.includes('Could not establish connection')
    );

    expect(connectionErrors).toHaveLength(0);
  });

  test('panel toggle handler should handle uninitialized manager gracefully', async () => {
    // Send toggle message directly before manager is initialized
    const response = await page.evaluate(async () => {
      try {
        const resp = await browser.runtime.sendMessage({
          action: 'TOGGLE_QUICK_TABS_PANEL'
        });
        return resp;
      } catch (error) {
        return { error: error.message };
      }
    });

    // Should get a proper error response, not a crash
    expect(response).toBeDefined();
    expect(response.success).toBeDefined();
  });
});

test.describe('v1.6.0 Critical Fixes - Log Export Functionality', () => {
  let context;
  let page;

  test.beforeEach(async () => {
    const result = await loadExtensionInFirefox({ headless: false });
    context = result.context;
    page = await context.newPage();

    const testPagePath = path.join(__dirname, 'fixtures', 'test-page.html');
    await page.goto(`file://${testPagePath}`);
    await waitForExtensionLoad(page, 10000);
  });

  test.afterEach(async () => {
    if (page) await page.close();
    if (context) await context.close();
  });

  test('EXPORT_LOGS message should be handled by LogHandler', async () => {
    // Send EXPORT_LOGS message
    const response = await page.evaluate(async () => {
      try {
        const resp = await browser.runtime.sendMessage({
          action: 'EXPORT_LOGS',
          logText: 'Test log content',
          filename: 'test-logs.txt'
        });
        return { success: true, response: resp };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Should not get "Could not establish connection" error
    expect(response.success).toBe(true);
    expect(response.error).toBeUndefined();
  });

  test('GET_CONTENT_LOGS should return log data', async () => {
    // Generate some logs first
    await page.evaluate(() => {
      console.log('Test log 1');
      console.log('Test log 2');
      console.error('Test error 1');
    });

    // Request logs
    const response = await page.evaluate(async () => {
      try {
        const resp = await browser.runtime.sendMessage({
          action: 'GET_CONTENT_LOGS'
        });
        return resp;
      } catch (error) {
        return { error: error.message };
      }
    });

    expect(response.logs).toBeDefined();
    expect(Array.isArray(response.logs)).toBe(true);
    expect(response.logs.length).toBeGreaterThan(0);
  });

  test('GET_BACKGROUND_LOGS message should be handled', async () => {
    const response = await page.evaluate(async () => {
      try {
        const resp = await browser.runtime.sendMessage({
          action: 'GET_BACKGROUND_LOGS'
        });
        return { success: true, response: resp };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Should successfully get background logs
    expect(response.success).toBe(true);
    expect(response.error).toBeUndefined();
  });
});

test.describe('v1.6.0 Critical Fixes - Log Clear Functionality', () => {
  let context;
  let page;

  test.beforeEach(async () => {
    const result = await loadExtensionInFirefox({ headless: false });
    context = result.context;
    page = await context.newPage();

    const testPagePath = path.join(__dirname, 'fixtures', 'test-page.html');
    await page.goto(`file://${testPagePath}`);
    await waitForExtensionLoad(page, 10000);
  });

  test.afterEach(async () => {
    if (page) await page.close();
    if (context) await context.close();
  });

  test('CLEAR_CONTENT_LOGS should clear content script logs', async () => {
    // Generate some logs
    await page.evaluate(() => {
      console.log('Test log before clear');
    });

    // Get initial log count
    const initialResponse = await page.evaluate(async () => {
      return browser.runtime.sendMessage({ action: 'GET_CONTENT_LOGS' });
    });
    const initialCount = initialResponse.logs.length;

    // Clear logs
    await page.evaluate(async () => {
      return browser.runtime.sendMessage({ action: 'CLEAR_CONTENT_LOGS' });
    });

    // Get log count after clear
    const afterResponse = await page.evaluate(async () => {
      return browser.runtime.sendMessage({ action: 'GET_CONTENT_LOGS' });
    });
    const afterCount = afterResponse.logs.length;

    // Count should be less after clearing
    expect(afterCount).toBeLessThan(initialCount);
  });

  test('CLEAR_CONSOLE_LOGS message should be handled', async () => {
    const response = await page.evaluate(async () => {
      try {
        const resp = await browser.runtime.sendMessage({
          action: 'CLEAR_CONSOLE_LOGS'
        });
        return { success: true, response: resp };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Should not get connection error
    expect(response.success).toBe(true);
    expect(response.error).toBeUndefined();
  });
});

test.describe('v1.6.0 Architecture Verification', () => {
  let context;
  let page;

  test.beforeEach(async () => {
    const result = await loadExtensionInFirefox({ headless: false });
    context = result.context;
    page = await context.newPage();

    const testPagePath = path.join(__dirname, 'fixtures', 'test-page.html');
    await page.goto(`file://${testPagePath}`);
    await waitForExtensionLoad(page, 10000);
  });

  test.afterEach(async () => {
    if (page) await page.close();
    if (context) await context.close();
  });

  test('MessageRouter should be properly initialized', async () => {
    // Check that MessageRouter is handling messages
    const handlerCount = await page.evaluate(async () => {
      // Try sending a known message and see if it's handled
      try {
        await browser.runtime.sendMessage({ action: 'GET_BACKGROUND_LOGS' });
        return true; // If no error, MessageRouter is working
      } catch (error) {
        return false;
      }
    });

    expect(handlerCount).toBe(true);
  });

  test('all critical handlers should be registered', async () => {
    // Test each critical handler by sending messages
    const handlers = [
      'GET_BACKGROUND_LOGS',
      'EXPORT_LOGS',
      'CLEAR_CONSOLE_LOGS',
      'GET_CONTENT_LOGS',
      'CLEAR_CONTENT_LOGS'
    ];

    for (const action of handlers) {
      const response = await page.evaluate(async actionName => {
        try {
          // Send minimal valid payload for each action
          const payload = { action: actionName };
          if (actionName === 'EXPORT_LOGS') {
            payload.logText = 'test';
            payload.filename = 'test.txt';
          }

          await browser.runtime.sendMessage(payload);
          return { handled: true };
        } catch (error) {
          return { handled: false, error: error.message };
        }
      }, action);

      // Should not get "Could not establish connection" error
      expect(response.handled).toBe(true);
    }
  });

  test('no duplicate command listeners should exist', async () => {
    // This test verifies that only one command listener is active
    // by checking console logs for duplicate handler warnings
    const warnings = [];
    page.on('console', msg => {
      if (msg.type() === 'warning' && msg.text().includes('duplicate')) {
        warnings.push(msg.text());
      }
    });

    // Trigger shortcut
    await triggerShortcut(page, 'Control+Alt+Z');
    await page.waitForTimeout(1000);

    // Should not have any duplicate handler warnings
    expect(warnings).toHaveLength(0);
  });
});
