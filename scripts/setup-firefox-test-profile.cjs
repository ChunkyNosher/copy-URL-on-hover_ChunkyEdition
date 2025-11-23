#!/usr/bin/env node

/**
 * Setup Firefox Profile for Playwright Testing
 * 
 * Creates a Firefox profile with the extension pre-installed for testing.
 * This script must be run before executing Firefox Playwright tests.
 * 
 * Strategy:
 * 1. Launch Firefox with a clean profile
 * 2. Manually install the extension as temporary
 * 3. Save the profile for test reuse
 * 
 * Note: This is a one-time setup that requires manual intervention due to
 * Firefox's security restrictions on automated extension installation.
 * 
 * @see docs/issue-47-revised-scenarios.md
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const PROFILE_DIR = path.join(__dirname, '../firefox-test-profile');
const DIST_DIR = path.join(__dirname, '../dist');
const MANIFEST_PATH = path.join(DIST_DIR, 'manifest.json');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  Firefox Test Profile Setup');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');

// Check if extension is built
if (!fs.existsSync(MANIFEST_PATH)) {
  console.error('✗ Extension not built!');
  console.error('  Please run: npm run build:test');
  process.exit(1);
}

console.log('✓ Extension found in dist/');

// Create profile directory if it doesn't exist
if (!fs.existsSync(PROFILE_DIR)) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  console.log('✓ Created profile directory');
}

// Create prefs.js with required preferences
const prefsContent = `// Firefox preferences for Playwright testing
user_pref("xpinstall.signatures.required", false);
user_pref("extensions.autoDisableScopes", 0);
user_pref("extensions.enabledScopes", 15);
user_pref("devtools.chrome.enabled", true);
user_pref("devtools.debugger.remote-enabled", true);
user_pref("dom.events.testing.asyncClipboard", true);
user_pref("extensions.update.enabled", false);
user_pref("extensions.update.autoUpdateDefault", false);
user_pref("app.update.auto", false);
user_pref("app.update.enabled", false);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.startup.page", 0);
user_pref("browser.tabs.warnOnClose", false);
`;

fs.writeFileSync(path.join(PROFILE_DIR, 'prefs.js'), prefsContent);
console.log('✓ Created prefs.js with test preferences');

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  Manual Extension Installation Required');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('Firefox will now open. Please follow these steps:');
console.log('');
console.log('1. Wait for Firefox to fully load');
console.log('2. Navigate to: about:debugging#/runtime/this-firefox');
console.log('3. Click "Load Temporary Add-on..."');
console.log(`4. Select the manifest.json file from: ${DIST_DIR}`);
console.log('5. Verify the extension appears in the list');
console.log('6. Close Firefox (the profile will be saved)');
console.log('');
console.log('Press Enter when ready to launch Firefox...');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('', () => {
  rl.close();
  
  console.log('');
  console.log('🦊 Launching Firefox...');
  console.log('');
  
  try {
    // Launch Firefox with the profile
    // Using web-ext run for easier profile management
    const firefoxProcess = spawn('npx', [
      'web-ext',
      'run',
      '--source-dir', DIST_DIR,
      '--profile', PROFILE_DIR,
      '--keep-profile-changes',
      '--no-reload',
      '--firefox', 'firefox'
    ], {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..')
    });
    
    firefoxProcess.on('close', (code) => {
      console.log('');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('  Profile Setup Complete!');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('');
      console.log('✓ Firefox profile saved to:', PROFILE_DIR);
      console.log('');
      console.log('You can now run Playwright tests with:');
      console.log('  npm run test:extension:firefox');
      console.log('');
      process.exit(code || 0);
    });
    
    firefoxProcess.on('error', (error) => {
      console.error('✗ Failed to launch Firefox:', error.message);
      console.error('');
      console.error('Make sure Firefox is installed and accessible via PATH');
      process.exit(1);
    });
    
  } catch (error) {
    console.error('✗ Error:', error.message);
    process.exit(1);
  }
});
