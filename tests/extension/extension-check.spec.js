import { test, expect } from './fixtures.js';

test('check if extension is loaded', async ({ context, extensionId }) => {
  console.log('Extension ID:', extensionId);
  
  const page = await context.newPage();
  
  // Navigate to the extension's background page or popup
  if (extensionId && extensionId !== 'unknown-extension-id') {
    try {
      await page.goto(`chrome-extension://${extensionId}/popup.html`);
      console.log('Successfully navigated to popup.html');
      const title = await page.title();
      console.log('Popup title:', title);
    } catch (error) {
      console.error('Error loading popup:', error.message);
    }
  }
  
  // Try navigating to a simple file URL instead
  await page.goto('file:///tmp/test.html');
  await page.setContent('<html><body><h1>Test</h1></body></html>');
  
  // Wait a bit for content script
  await page.waitForTimeout(3000);
  
  // Check if test bridge exists
  const hasBridge = await page.evaluate(() => {
    return typeof window.__COPILOT_TEST_BRIDGE__ !== 'undefined';
  });
  
  console.log('Test bridge available:', hasBridge);
  
  // Check console logs
  const logs = [];
  page.on('console', msg => logs.push(msg.text()));
  
  // Get service workers info
  const serviceWorkers = context.serviceWorkers();
  console.log('Service workers count:', serviceWorkers.length);
  for (const sw of serviceWorkers) {
    console.log('Service worker URL:', sw.url());
  }
  
  expect(extensionId).not.toBe('unknown-extension-id');
});
