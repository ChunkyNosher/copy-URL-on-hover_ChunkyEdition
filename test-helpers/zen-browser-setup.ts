import { Page, BrowserContext } from '@playwright/test';

// Properly typed parameters
export default async ({ page, context }: { page: Page; context: BrowserContext }) => {
  // Grant clipboard permissions (critical for your extension)
  await context.grantPermissions(['clipboard-read', 'clipboard-write', 'notifications']);

  // Set viewport for Zen's split view testing
  await page.setViewportSize({
    width: 1920,
    height: 1080
  });

  // Zen Browser specific user agent detection
  const userAgent = await page.evaluate(() => navigator.userAgent);
  console.log('[Zen Browser Setup] User Agent:', userAgent);

  // Wait for Zen UI to stabilize
  await page.waitForLoadState('networkidle');

  // Inject Zen-specific test utilities
  await page.addInitScript(() => {
    // Use type assertion to add custom property
    (window as any).zenTestMode = true;
    console.log('[Zen Browser] Test mode enabled');
  });
};
