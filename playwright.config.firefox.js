import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Playwright configuration for Firefox extension E2E testing
 *
 * This config loads the extension from the dist/ directory and runs tests
 * in a real Firefox browser with the extension installed.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.js',

  /* Maximum time one test can run for */
  timeout: 60 * 1000,

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,

  /* Opt out of parallel tests on CI */
  workers: process.env.CI ? 1 : undefined,

  /* Reporter to use */
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/results.json' }]
  ],

  /* Shared settings for all the projects below */
  use: {
    /* Collect trace when retrying the failed test */
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'firefox-extension',
      use: {
        ...devices['Desktop Firefox'],
        // Firefox-specific launch options for loading extension
        launchOptions: {
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
        }
      }
    }
  ],

  /* Folder for test artifacts such as screenshots, videos, traces, etc. */
  outputDir: 'test-results/firefox'
});
