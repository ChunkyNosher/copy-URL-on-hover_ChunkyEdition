import { test, expect } from './fixtures.js';

test('check if test bridge is available', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('data:text/html,<html><head><title>Test Page</title></head><body><h1>Test Page</h1></body></html>');
  
  // Wait for page to load
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  
  // Check if test bridge exists
  const hasBridge = await page.evaluate(() => {
    console.log('Checking for test bridge...');
    console.log('window.__COPILOT_TEST_BRIDGE__:', typeof window.__COPILOT_TEST_BRIDGE__);
    return typeof window.__COPILOT_TEST_BRIDGE__ !== 'undefined';
  });
  
  console.log('Test bridge available:', hasBridge);
  
  // Get console messages
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  
  // Get all window keys that might be test-related
  const windowKeys = await page.evaluate(() => {
    return Object.keys(window).filter(k => 
      k.includes('TEST') || k.includes('COPILOT') || k.includes('bridge')
    );
  });
  
  console.log('Relevant window keys:', windowKeys);
  
  expect(hasBridge).toBe(true);
});
