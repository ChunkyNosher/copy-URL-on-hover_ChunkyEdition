import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Firefox extension testing
 * Uses playwright-webextext for native Firefox extension support
 *
 * This config is designed for TRUE HEADLESS testing - no Xvfb required!
 */
export default defineConfig({
  // Test directory
  testDir: './tests/e2e',

  // Maximum time one test can run
  timeout: 30 * 1000, // 30 seconds per test

  // Test execution settings
  fullyParallel: false, // Run tests sequentially (extensions share state)
  forbidOnly: !!process.env.CI, // Fail CI if test.only() left in code
  retries: process.env.CI ? 2 : 0, // Retry flaky tests in CI
  workers: 1, // Single worker (extension state isolation)

  // Reporter configuration
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['list'],
  ],

  // Global test settings
  use: {
    // Base URL for navigation
    baseURL: 'about:blank',

    // Capture trace on first retry
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on failure
    video: 'retain-on-failure',

    // Browser viewport
    viewport: { width: 1920, height: 1080 },

    // Action timeout
    actionTimeout: 10 * 1000, // 10 seconds
  },

  // Projects (browser configurations)
  projects: [
    {
      name: 'firefox-extension',
      use: {
        ...devices['Desktop Firefox'],
        // CRITICAL: Firefox extensions work in true headless mode
        headless: true,
      },
    },
  ],

  // Output directories
  outputDir: 'test-results',
});
