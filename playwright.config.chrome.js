
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Playwright configuration for Chrome extension E2E testing
 *
 * This config loads the extension from the dist/ directory and runs tests
 * in Chromium browser with the extension installed.
 *
 * Note: This extension is primarily designed for Firefox, but we test
 * Chrome compatibility where applicable.
 */
export default {
  testDir: './tests/extension',
  testMatch: '**/*.spec.js',

  /* Maximum time one test can run for */
  timeout: 180 * 1000, // Increased to 180s (3 minutes) for CI

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,

  /* Opt out of parallel tests on CI - always use 1 worker for extension tests */
  workers: 1,
  
  /* Increase teardown timeout for extension cleanup */
  globalTimeout: 5 * 60 * 1000, // 5 minutes for entire test run

  /* Reporter to use */
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report-chrome' }],
    ['json', { outputFile: 'test-results/chrome-results.json' }]
  ],

  /* Shared settings for all the projects below */
  use: {
    /* Collect trace when retrying the failed test */
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },

  /* Configure projects for Chrome/Chromium */
  projects: [
    {
      name: 'chromium-extension',
      use: {
        // Chrome-specific launch options for loading extension
        launchOptions: {
          args: [
            `--disable-extensions-except=${path.join(__dirname, 'dist')}`,
            `--load-extension=${path.join(__dirname, 'dist')}`,
            '--no-sandbox',
            '--disable-setuid-sandbox'
          ]
        }
      }
    }
  ],

  /* Folder for test artifacts such as screenshots, videos, traces, etc. */
  outputDir: 'test-results/chrome'
};
