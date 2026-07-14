#!/usr/bin/env node

/**
 * Helper script to load the extension in Firefox for testing with Playwright MCP
 *
 * This script uses web-ext to launch Firefox with the extension pre-loaded,
 * which is necessary because Firefox doesn't support loading extensions via
 * command-line args in the same way Chrome does.
 *
 * Usage:
 *   node scripts/load-extension-firefox.js
 *
 * Prerequisites:
 *   - Extension must be built in dist/ directory
 *   - web-ext must be installed (npm install -g web-ext)
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

// Paths
const distPath = path.join(projectRoot, 'dist');
const profilePath = path.join(projectRoot, 'firefox-profile');

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
  console.log('✓ Created Firefox profile directory');
}

console.log('🦊 Starting Firefox with extension loaded...');
console.log(`   Extension path: ${distPath}`);
console.log(`   Profile path: ${profilePath}`);
console.log('');
console.log('📝 Instructions:');
console.log('   1. Firefox will open with the extension installed');
console.log('   2. You can now use Playwright MCP to interact with the browser');
console.log('   3. Test Quick Tabs features using keyboard shortcuts (Ctrl+Alt+Z)');
console.log('   4. Press Q while hovering over links to create Quick Tabs');
console.log('');
console.log('   To stop: Press Ctrl+C in this terminal');
console.log('');

// Launch Firefox with web-ext
const webExt = spawn(
  'web-ext',
  [
    'run',
    `--source-dir=${distPath}`,
    '--firefox=firefox',
    `--firefox-profile=${profilePath}`,
    '--keep-profile-changes',
    '--no-reload',
    '--url=about:debugging#/runtime/this-firefox'
  ],
  {
    stdio: 'inherit',
    cwd: projectRoot
  }
);

webExt.on('error', err => {
  console.error('❌ Error launching Firefox:', err.message);
  console.error('   Make sure web-ext is installed: npm install -g web-ext');
  process.exit(1);
});

webExt.on('close', code => {
  if (code !== 0) {
    console.error(`❌ Firefox exited with code ${code}`);
    process.exit(code);
  } else {
    console.log('✓ Firefox closed');
  }
});

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n🛑 Stopping Firefox...');
  webExt.kill('SIGTERM');
  setTimeout(() => {
    process.exit(0);
  }, 1000);
});
