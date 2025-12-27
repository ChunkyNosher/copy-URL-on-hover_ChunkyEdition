import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Playwright configuration for Firefox extension E2E testing
 *
 * This config loads the extension from the dist/ directory and runs tests
 * in a real Firefox browser with the extension installed.
 *
 * v1.6.3.12 - J8: Added multi-container project for container isolation testing
 *
 * To run container isolation tests:
 *   npx playwright test --project=firefox-multicontainer
 *
 * To run all Firefox tests including multi-container:
 *   npx playwright test --config=playwright.config.firefox.js
 */
export default {
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
    },
    /**
     * v1.6.3.12 - J8: Multi-container project for container isolation testing
     *
     * This project enables Firefox Multi-Account Containers support for testing:
     * - Container isolation (Scenarios 14, 18, 20 from issue-47-revised.md)
     * - Cross-container Quick Tab behavior
     * - Container label verification
     *
     * Firefox Containers require the contextualIdentities API to be enabled.
     * Tests using this project should use Test Bridge methods:
     * - verifyContainerIsolationById(containerId)
     * - getContainerLabel(containerId)
     * - verifyCrossTabIsolation(originTabId)
     */
    {
      name: 'firefox-multicontainer',
      testMatch: '**/container*.spec.js',
      use: {
        launchOptions: {
          firefoxUserPrefs: {
            // Base extension prefs
            'xpinstall.signatures.required': false,
            'extensions.autoDisableScopes': 0,
            'extensions.enabledScopes': 15,
            'devtools.chrome.enabled': true,
            'devtools.debugger.remote-enabled': true,
            'dom.events.testing.asyncClipboard': true,
            // v1.6.3.12 - J8: Enable Firefox Multi-Account Containers
            // Required for contextualIdentities API
            'privacy.userContext.enabled': true,
            // Enable UI for containers in tabs
            'privacy.userContext.ui.enabled': true,
            // Allow extensions to access container APIs
            'privacy.userContext.extension': true,
            // Long press behavior: 0=disabled, 1=new tab, 2=new container tab
            // Value 2 enables opening links in new container tabs via long-press
            'privacy.userContext.longPressBehavior': 2
          }
        }
      }
    }
  ],

  /* Folder for test artifacts such as screenshots, videos, traces, etc. */
  outputDir: 'test-results/firefox'
};
