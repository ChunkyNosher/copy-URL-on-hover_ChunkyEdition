/**
 * Simple test to check if test bridge is available
 */

import { test, expect } from './fixtures.js';

test('test bridge should be available', async ({ context }) => {
  console.log('=== Starting test bridge availability check ===');
  
  const page = await context.newPage();
  await page.goto('https://example.com');
  console.log('✓ Navigated to example.com');
  
  // Wait a bit for content script to load
  await page.waitForTimeout(5000);
  console.log('✓ Waited 5 seconds');
  
  // Check if test bridge is available
  const bridgeAvailable = await page.evaluate(() => {
    console.log('Checking for window.__COPILOT_TEST_BRIDGE__...');
    console.log('typeof:', typeof window.__COPILOT_TEST_BRIDGE__);
    console.log('window keys:', Object.keys(window).filter(k => k.includes('COPILOT')));
    return typeof window.__COPILOT_TEST_BRIDGE__ !== 'undefined';
  });
  
  console.log('Bridge available:', bridgeAvailable);
  
  expect(bridgeAvailable).toBe(true);
  
  if (bridgeAvailable) {
    // Try calling a method
    const tabs = await page.evaluate(async () => {
      try {
        const result = await window.__COPILOT_TEST_BRIDGE__.getQuickTabs();
        console.log('getQuickTabs result:', result);
        return result;
      } catch (error) {
        console.error('getQuickTabs error:', error);
        throw error;
      }
    });
    
    console.log('Quick Tabs:', tabs);
    expect(Array.isArray(tabs)).toBe(true);
  }
  
  await page.close();
  console.log('=== Test complete ===');
});
