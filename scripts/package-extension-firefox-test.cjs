#!/usr/bin/env node

/**
 * Package Extension for Firefox Playwright Testing
 *
 * Creates a temporary XPI package for loading the extension in Firefox tests.
 * Uses web-ext to build the extension and places it in a known location.
 *
 * @see docs/issue-47-revised-scenarios.md
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIST_DIR = path.join(__dirname, '../dist');
const TEST_ARTIFACTS_DIR = path.join(__dirname, '../test-results/firefox-extension');
const XPI_OUTPUT_NAME = 'extension.xpi';

console.log('[Package Firefox Extension] Starting...');

// Ensure test artifacts directory exists
if (!fs.existsSync(TEST_ARTIFACTS_DIR)) {
  fs.mkdirSync(TEST_ARTIFACTS_DIR, { recursive: true });
  console.log('[Package Firefox Extension] Created artifacts directory');
}

// Clean up old XPI if it exists
const xpiPath = path.join(TEST_ARTIFACTS_DIR, XPI_OUTPUT_NAME);
if (fs.existsSync(xpiPath)) {
  fs.unlinkSync(xpiPath);
  console.log('[Package Firefox Extension] Removed old XPI');
}

// Build XPI using web-ext
try {
  console.log('[Package Firefox Extension] Building XPI with web-ext...');

  // web-ext build creates artifacts in web-ext-artifacts/ by default
  execSync(
    `npx web-ext build --source-dir="${DIST_DIR}" --artifacts-dir="${TEST_ARTIFACTS_DIR}" --overwrite-dest`,
    {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..')
    }
  );

  // Find the generated XPI file (web-ext names it with version)
  const files = fs.readdirSync(TEST_ARTIFACTS_DIR);
  const xpiFile = files.find(f => f.endsWith('.zip'));

  if (xpiFile) {
    const generatedXpiPath = path.join(TEST_ARTIFACTS_DIR, xpiFile);

    // Rename to standard name for tests
    fs.renameSync(generatedXpiPath, xpiPath);
    console.log(`[Package Firefox Extension] ✓ XPI created: ${xpiPath}`);
    console.log(`[Package Firefox Extension] File size: ${fs.statSync(xpiPath).size} bytes`);
  } else {
    throw new Error('web-ext did not generate XPI file');
  }
} catch (error) {
  console.error('[Package Firefox Extension] ✗ Failed to build XPI:', error.message);
  process.exit(1);
}

console.log('[Package Firefox Extension] Complete!');
