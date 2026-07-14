/**
 * Basic Quick Tabs Tests using Test Bridge
 *
 * These tests demonstrate the Test Bridge pattern for autonomous testing
 * of browser extension features without keyboard shortcuts.
 *
 * @see .github/COPILOT-TESTING-GUIDE.md
 */

import { test, expect } from './fixtures.js';
import { ExtensionTestHelper } from './helpers/extension-test-utils.js';

/**
 * Test Suite: Quick Tabs - Basic Operations
 *
 * Tests basic Quick Tab functionality using the Test Bridge API:
 * - Creation (bypasses "Q" keyboard shortcut)
 * - Retrieval from storage
 * - Cleanup
 */
test.describe('Quick Tabs - Basic Operations', () => {
  let helper;

  test.beforeEach(async ({ page }) => {
    helper = new ExtensionTestHelper(page);

    // Navigate to test page
    await page.goto('https://example.com');

    // Wait for test bridge to be available
    const bridgeAvailable = await helper.waitForTestBridge(15000);

    if (!bridgeAvailable) {
      // Take screenshot for debugging
      await helper.takeScreenshot('test-bridge-not-available');
      throw new Error('Test bridge not available - extension may not be loaded');
    }

    // Clear any existing Quick Tabs
    await helper.clearAllQuickTabs();
  });

  test.afterEach(async () => {
    // Cleanup after each test
    if (helper) {
      await helper.clearAllQuickTabs();
    }
  });

  test('should create a Quick Tab programmatically', async () => {
    // Create Quick Tab (bypasses "Q" keyboard shortcut)
    const result = await helper.createQuickTab('https://github.com', {
      title: 'GitHub'
    });

    // Verify creation was successful
    expect(result.success).toBe(true);

    // Verify Quick Tab exists in storage
    const quickTabs = await helper.getQuickTabs();
    expect(quickTabs).toHaveLength(1);
    expect(quickTabs[0].url).toBe('https://github.com');

    // Take screenshot for documentation
    await helper.takeScreenshot('quick-tab-created');
  });

  test('should retrieve Quick Tabs from storage', async () => {
    // Create two Quick Tabs
    await helper.createQuickTab('https://wikipedia.org');
    await helper.createQuickTab('https://youtube.com');

    // Retrieve all Quick Tabs
    const quickTabs = await helper.getQuickTabs();

    // Verify count
    expect(quickTabs).toHaveLength(2);

    // Verify URLs
    const urls = quickTabs.map(tab => tab.url);
    expect(urls).toContain('https://wikipedia.org');
    expect(urls).toContain('https://youtube.com');
  });

  test('should get specific Quick Tab by ID', async () => {
    // Create Quick Tab
    await helper.createQuickTab('https://example.com/test');

    // Get all tabs to get the ID
    const quickTabs = await helper.getQuickTabs();
    expect(quickTabs).toHaveLength(1);

    const tabId = quickTabs[0].id;

    // Retrieve specific tab by ID
    const tab = await helper.getQuickTabById(tabId);

    // Verify correct tab was retrieved
    expect(tab).not.toBeNull();
    expect(tab.id).toBe(tabId);
    expect(tab.url).toBe('https://example.com/test');
  });

  test('should wait for Quick Tab count', async () => {
    // Create Quick Tab
    const createPromise = helper.createQuickTab('https://example.com');

    // Wait for count to reach 1
    const countReached = await helper.waitForQuickTabCount(1, 5000);

    expect(countReached).toBe(true);

    // Verify creation completed
    await createPromise;
    const quickTabs = await helper.getQuickTabs();
    expect(quickTabs).toHaveLength(1);
  });

  test('should clear all Quick Tabs', async () => {
    // Create multiple Quick Tabs
    await helper.createQuickTab('https://example.com/1');
    await helper.createQuickTab('https://example.com/2');
    await helper.createQuickTab('https://example.com/3');

    // Verify created
    let quickTabs = await helper.getQuickTabs();
    expect(quickTabs.length).toBeGreaterThan(0);

    // Clear all
    const result = await helper.clearAllQuickTabs();
    expect(result.success).toBe(true);

    // Verify cleared
    quickTabs = await helper.getQuickTabs();
    expect(quickTabs).toHaveLength(0);
  });

  test('should handle minimize and restore', async () => {
    // Create Quick Tab
    await helper.createQuickTab('https://example.com/minimize-test');

    // Get tab ID
    const quickTabs = await helper.getQuickTabs();
    const tabId = quickTabs[0].id;

    // Minimize
    const minimizeResult = await helper.minimizeQuickTab(tabId);
    expect(minimizeResult.success).toBe(true);

    // Verify minimized state
    let tab = await helper.getQuickTabById(tabId);
    expect(tab.minimized).toBe(true);

    // Restore
    const restoreResult = await helper.restoreQuickTab(tabId);
    expect(restoreResult.success).toBe(true);

    // Verify restored state
    tab = await helper.getQuickTabById(tabId);
    expect(tab.minimized).toBe(false);
  });

  test('should handle pin and unpin', async () => {
    // Create Quick Tab
    await helper.createQuickTab('https://example.com/pin-test');

    // Get tab ID
    const quickTabs = await helper.getQuickTabs();
    const tabId = quickTabs[0].id;

    // Pin
    const pinResult = await helper.pinQuickTab(tabId);
    expect(pinResult.success).toBe(true);

    // Verify pinned state
    let tab = await helper.getQuickTabById(tabId);
    expect(tab.pinnedToUrl).not.toBeNull();

    // Unpin
    const unpinResult = await helper.unpinQuickTab(tabId);
    expect(unpinResult.success).toBe(true);

    // Verify unpinned state
    tab = await helper.getQuickTabById(tabId);
    expect(tab.pinnedToUrl).toBeNull();
  });

  test('should close specific Quick Tab', async () => {
    // Create multiple Quick Tabs
    await helper.createQuickTab('https://example.com/1');
    await helper.createQuickTab('https://example.com/2');

    // Get tabs
    let quickTabs = await helper.getQuickTabs();
    expect(quickTabs).toHaveLength(2);

    const tabIdToClose = quickTabs[0].id;

    // Close first tab
    const result = await helper.closeQuickTab(tabIdToClose);
    expect(result.success).toBe(true);

    // Verify only one tab remains
    quickTabs = await helper.getQuickTabs();
    expect(quickTabs).toHaveLength(1);
    expect(quickTabs[0].id).not.toBe(tabIdToClose);
  });
});

/**
 * Test Suite: Test Bridge Availability
 *
 * Tests to verify the test bridge is properly loaded and accessible.
 */
test.describe('Test Bridge Availability', () => {
  test('should expose test bridge on window object', async ({ page }) => {
    await page.goto('https://example.com');

    const helper = new ExtensionTestHelper(page);
    const available = await helper.waitForTestBridge(15000);

    expect(available).toBe(true);

    // Verify test bridge has expected methods
    const hasMethods = await page.evaluate(() => {
      const bridge = window.__COPILOT_TEST_BRIDGE__;
      return (
        bridge &&
        typeof bridge.createQuickTab === 'function' &&
        typeof bridge.getQuickTabs === 'function' &&
        typeof bridge.minimizeQuickTab === 'function' &&
        typeof bridge.restoreQuickTab === 'function' &&
        typeof bridge.pinQuickTab === 'function' &&
        typeof bridge.unpinQuickTab === 'function' &&
        typeof bridge.closeQuickTab === 'function' &&
        typeof bridge.clearAllQuickTabs === 'function' &&
        typeof bridge.waitForQuickTabCount === 'function'
      );
    });

    expect(hasMethods).toBe(true);
  });

  test('should log test bridge loading', async ({ page }) => {
    const consoleLogs = [];

    page.on('console', msg => {
      if (msg.text().includes('Test Bridge')) {
        consoleLogs.push(msg.text());
      }
    });

    await page.goto('https://example.com');

    // Wait a bit for console logs
    await page.waitForTimeout(2000);

    // Should have test bridge log messages
    const hasTestBridgeLogs = consoleLogs.some(
      log => log.includes('Test Bridge') || log.includes('COPILOT_TEST_BRIDGE')
    );

    expect(hasTestBridgeLogs).toBe(true);
  });
});
