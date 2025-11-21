#!/usr/bin/env node

/**
 * Helper script to load the extension in Chrome for testing with Playwright MCP
 * 
 * This script launches Chrome/Chromium with the extension pre-loaded from the
 * dist/ directory, making it available for interactive testing with Playwright MCP.
 * 
 * Usage:
 *   node scripts/load-extension-chrome.js
 * 
 * Prerequisites:
 *   - Extension must be built in dist/ directory
 *   - Chrome or Chromium must be installed
 */

import { spawn } from 'child_process';
import fs from 'fs';
import { platform } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

// Paths
const distPath = path.join(projectRoot, 'dist');
const profilePath = path.join(projectRoot, 'chrome-profile');

// Verify dist exists
if (!fs.existsSync(distPath)) {
  console.error('❌ Error: dist/ directory not found!');
  console.error('   Please run: npm run build:prod');
  process.exit(1);
}

// Verify manifest exists
const manifestPath = path.join(distPath, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('❌ Error: dist/manifest.json not found!');
  console.error('   Please run: npm run build:prod');
  process.exit(1);
}

// Create profile directory if it doesn't exist
if (!fs.existsSync(profilePath)) {
  fs.mkdirSync(profilePath, { recursive: true });
  console.log('✓ Created Chrome profile directory');
}

// Find Chrome executable in Linux
function findLinuxChrome() {
  const chromePaths = [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium'
  ];
  
  for (const chromePath of chromePaths) {
    if (fs.existsSync(chromePath)) {
      return chromePath;
    }
  }
  
  return 'google-chrome';
}

// Determine Chrome executable based on platform
function getChromePath() {
  const os = platform();
  
  if (os === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  
  if (os === 'win32') {
    return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  }
  
  return findLinuxChrome();
}

const chromePath = getChromePath();

console.log('🌐 Starting Chrome with extension loaded...');
console.log(`   Chrome path: ${chromePath}`);
console.log(`   Extension path: ${distPath}`);
console.log(`   Profile path: ${profilePath}`);
console.log('');
console.log('📝 Instructions:');
console.log('   1. Chrome will open with the extension installed');
console.log('   2. The extension should appear in your toolbar');
console.log('   3. You can now use Playwright MCP to interact with the browser');
console.log('   4. Test Quick Tabs features using keyboard shortcuts (Ctrl+Alt+Z)');
console.log('   5. Press Q while hovering over links to create Quick Tabs');
console.log('');
console.log('   To stop: Close Chrome or press Ctrl+C in this terminal');
console.log('');

// Launch Chrome with extension
const chrome = spawn(chromePath, [
  `--disable-extensions-except=${distPath}`,
  `--load-extension=${distPath}`,
  `--user-data-dir=${profilePath}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-blink-features=AutomationControlled',
  'chrome://extensions/'
], {
  stdio: 'inherit',
  detached: false
});

chrome.on('error', (err) => {
  console.error('❌ Error launching Chrome:', err.message);
  console.error('   Make sure Chrome is installed and the path is correct');
  console.error(`   Tried path: ${chromePath}`);
  process.exit(1);
});

chrome.on('close', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`❌ Chrome exited with code ${code}`);
  } else {
    console.log('✓ Chrome closed');
  }
  process.exit(code || 0);
});

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n🛑 Stopping Chrome...');
  chrome.kill('SIGTERM');
  setTimeout(() => {
    process.exit(0);
  }, 1000);
});
