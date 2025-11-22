#!/usr/bin/env node

/**
 * Inject Test Bridge for Local Testing
 * 
 * This script injects the test bridge into the built extension for local testing.
 * It's called during the build process when TEST_MODE=true is set.
 * 
 * @see docs/manual/v1.6.0/copilot-testing-readiness-gap-analysis-revised.md
 */

const fs = require('fs');
const path = require('path');

const TEST_MODE = process.env.TEST_MODE === 'true';
const DIST_DIR = path.join(__dirname, '..', 'dist');
const SRC_TEST_BRIDGE = path.join(__dirname, '..', 'src', 'test-bridge.js');
const DIST_TEST_BRIDGE = path.join(DIST_DIR, 'test-bridge.js');
const DIST_BACKGROUND = path.join(DIST_DIR, 'background.js');
const DIST_MANIFEST = path.join(DIST_DIR, 'manifest.json');

console.log('🔧 Test Bridge Injection Script');
console.log('================================');
console.log(`TEST_MODE: ${TEST_MODE}`);

if (!TEST_MODE) {
  console.log('⏭️  TEST_MODE is not true, skipping test bridge injection');
  process.exit(0);
}

// Check if dist directory exists
if (!fs.existsSync(DIST_DIR)) {
  console.error('✗ ERROR: dist/ directory not found');
  console.error('  Run "npm run build" first');
  process.exit(1);
}

// Step 1: Check if test bridge source exists
if (!fs.existsSync(SRC_TEST_BRIDGE)) {
  console.error('✗ ERROR: src/test-bridge.js not found');
  process.exit(1);
}
console.log('✓ Found src/test-bridge.js');

// Step 2: Copy test bridge to dist
try {
  fs.copyFileSync(SRC_TEST_BRIDGE, DIST_TEST_BRIDGE);
  console.log('✓ Copied test-bridge.js to dist/');
} catch (error) {
  console.error('✗ ERROR: Failed to copy test-bridge.js');
  console.error(error.message);
  process.exit(1);
}

// Step 3: Append test bridge to background.js
try {
  const testBridgeContent = fs.readFileSync(DIST_TEST_BRIDGE, 'utf8');
  const backgroundContent = fs.readFileSync(DIST_BACKGROUND, 'utf8');
  
  // Check if already injected
  if (backgroundContent.includes('COPILOT_TEST_BRIDGE')) {
    console.log('⏭️  Test bridge already injected in background.js');
  } else {
    fs.appendFileSync(DIST_BACKGROUND, '\n\n// === TEST BRIDGE INJECTION ===\n');
    fs.appendFileSync(DIST_BACKGROUND, testBridgeContent);
    console.log('✓ Appended test-bridge.js to background.js');
  }
} catch (error) {
  console.error('✗ ERROR: Failed to append test-bridge.js to background.js');
  console.error(error.message);
  process.exit(1);
}

// Step 4: Update manifest.json to add test-bridge.js to web_accessible_resources
try {
  const manifestContent = fs.readFileSync(DIST_MANIFEST, 'utf8');
  const manifest = JSON.parse(manifestContent);
  
  // Ensure web_accessible_resources exists
  if (!manifest.web_accessible_resources) {
    manifest.web_accessible_resources = [];
  }
  
  // Add test-bridge.js if not already present
  if (!manifest.web_accessible_resources.includes('test-bridge.js')) {
    manifest.web_accessible_resources.push('test-bridge.js');
    fs.writeFileSync(DIST_MANIFEST, JSON.stringify(manifest, null, 2));
    console.log('✓ Added test-bridge.js to manifest.json web_accessible_resources');
  } else {
    console.log('⏭️  test-bridge.js already in manifest.json');
  }
} catch (error) {
  console.error('✗ ERROR: Failed to update manifest.json');
  console.error(error.message);
  process.exit(1);
}

// Step 5: Verify injection
try {
  const backgroundContent = fs.readFileSync(DIST_BACKGROUND, 'utf8');
  if (!backgroundContent.includes('COPILOT_TEST_BRIDGE')) {
    throw new Error('Test bridge not found in background.js after injection');
  }
  
  const manifestContent = fs.readFileSync(DIST_MANIFEST, 'utf8');
  if (!manifestContent.includes('test-bridge.js')) {
    throw new Error('test-bridge.js not found in manifest.json after injection');
  }
  
  console.log('✓ Verification passed: Test bridge successfully injected');
  console.log('');
  console.log('✅ Test bridge injection complete!');
  console.log('   Extension is ready for autonomous testing with Playwright MCP');
} catch (error) {
  console.error('✗ ERROR: Verification failed');
  console.error(error.message);
  process.exit(1);
}
