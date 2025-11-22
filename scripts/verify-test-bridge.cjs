#!/usr/bin/env node

/**
 * Verification script for test bridge implementation
 * 
 * Checks that all required components are in place according to the gap analysis
 * document: docs/manual/v1.6.0/copilot-testing-readiness-gap-analysis-revised.md
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Test Bridge Verification');
console.log('============================\n');

const checks = [];

// Check 1: Test bridge source file exists
console.log('1. Checking test bridge source file...');
const testBridgePath = path.join(__dirname, '..', 'src', 'test-bridge.js');
if (fs.existsSync(testBridgePath)) {
  console.log('   ✓ src/test-bridge.js exists');
  checks.push(true);
} else {
  console.log('   ✗ src/test-bridge.js NOT FOUND');
  checks.push(false);
}

// Check 2: Test utilities exist
console.log('2. Checking test utilities...');
const testUtilsPath = path.join(__dirname, '..', 'tests', 'extension', 'helpers', 'extension-test-utils.js');
if (fs.existsSync(testUtilsPath)) {
  console.log('   ✓ tests/extension/helpers/extension-test-utils.js exists');
  checks.push(true);
} else {
  console.log('   ✗ Test utilities NOT FOUND');
  checks.push(false);
}

// Check 3: Injection script exists
console.log('3. Checking injection script...');
const injectionScriptPath = path.join(__dirname, 'inject-test-bridge.cjs');
if (fs.existsSync(injectionScriptPath)) {
  console.log('   ✓ scripts/inject-test-bridge.cjs exists');
  checks.push(true);
} else {
  console.log('   ✗ Injection script NOT FOUND');
  checks.push(false);
}

// Check 4: Build script includes test bridge
console.log('4. Checking package.json build scripts...');
const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
if (packageJson.scripts && packageJson.scripts['build:test']) {
  console.log('   ✓ build:test script exists');
  if (packageJson.scripts['build:test'].includes('inject-test-bridge')) {
    console.log('   ✓ build:test includes test bridge injection');
    checks.push(true);
  } else {
    console.log('   ✗ build:test does NOT include test bridge injection');
    checks.push(false);
  }
} else {
  console.log('   ✗ build:test script NOT FOUND');
  checks.push(false);
}

// Check 5: Test bridge is in dist (if built)
console.log('5. Checking built extension...');
const distTestBridgePath = path.join(__dirname, '..', 'dist', 'test-bridge.js');
const distBackgroundPath = path.join(__dirname, '..', 'dist', 'background.js');
const distManifestPath = path.join(__dirname, '..', 'dist', 'manifest.json');

if (fs.existsSync(distTestBridgePath)) {
  console.log('   ✓ dist/test-bridge.js exists');
  checks.push(true);
} else {
  console.log('   ⚠ dist/test-bridge.js not found (run build:test to generate)');
  checks.push(null);
}

if (fs.existsSync(distBackgroundPath)) {
  const backgroundContent = fs.readFileSync(distBackgroundPath, 'utf8');
  if (backgroundContent.includes('COPILOT_TEST_BRIDGE')) {
    console.log('   ✓ Test bridge injected in dist/background.js');
    checks.push(true);
  } else {
    console.log('   ⚠ Test bridge NOT injected in dist/background.js (run build:test)');
    checks.push(null);
  }
} else {
  console.log('   ⚠ dist/background.js not found (run build:test)');
  checks.push(null);
}

if (fs.existsSync(distManifestPath)) {
  const manifestContent = fs.readFileSync(distManifestPath, 'utf8');
  if (manifestContent.includes('test-bridge.js')) {
    console.log('   ✓ test-bridge.js in manifest.json web_accessible_resources');
    checks.push(true);
  } else {
    console.log('   ⚠ test-bridge.js NOT in manifest.json (run build:test)');
    checks.push(null);
  }
} else {
  console.log('   ⚠ dist/manifest.json not found (run build:test)');
  checks.push(null);
}

// Check 6: Test files exist
console.log('6. Checking test files...');
const basicTestPath = path.join(__dirname, '..', 'tests', 'extension', 'quick-tabs-basic.spec.js');
if (fs.existsSync(basicTestPath)) {
  console.log('   ✓ tests/extension/quick-tabs-basic.spec.js exists');
  checks.push(true);
} else {
  console.log('   ✗ Basic test file NOT FOUND');
  checks.push(false);
}

// Check 7: Playwright configs exist
console.log('7. Checking Playwright configurations...');
const firefoxConfigPath = path.join(__dirname, '..', 'playwright.config.firefox.js');
const chromeConfigPath = path.join(__dirname, '..', 'playwright.config.chrome.js');

let configsExist = 0;
if (fs.existsSync(firefoxConfigPath)) {
  console.log('   ✓ playwright.config.firefox.js exists');
  configsExist++;
}
if (fs.existsSync(chromeConfigPath)) {
  console.log('   ✓ playwright.config.chrome.js exists');
  configsExist++;
}
checks.push(configsExist === 2);

// Check 8: Test bridge API methods
console.log('8. Checking test bridge API completeness...');
if (fs.existsSync(testBridgePath)) {
  const testBridgeContent = fs.readFileSync(testBridgePath, 'utf8');
  const requiredMethods = [
    'createQuickTab',
    'getQuickTabs',
    'getQuickTabById',
    'minimizeQuickTab',
    'restoreQuickTab',
    'pinQuickTab',
    'unpinQuickTab',
    'closeQuickTab',
    'waitForQuickTabCount',
    'clearAllQuickTabs'
  ];
  
  const missingMethods = requiredMethods.filter(method => 
    !testBridgeContent.includes(`async ${method}`)
  );
  
  if (missingMethods.length === 0) {
    console.log('   ✓ All required API methods present');
    checks.push(true);
  } else {
    console.log(`   ✗ Missing methods: ${missingMethods.join(', ')}`);
    checks.push(false);
  }
} else {
  checks.push(false);
}

// Summary
console.log('\n📊 Summary');
console.log('==========');
const passed = checks.filter(c => c === true).length;
const failed = checks.filter(c => c === false).length;
const warnings = checks.filter(c => c === null).length;
const total = passed + failed;

console.log(`✓ Passed: ${passed}/${total}`);
if (failed > 0) {
  console.log(`✗ Failed: ${failed}/${total}`);
}
if (warnings > 0) {
  console.log(`⚠ Warnings: ${warnings} (run TEST_MODE=true npm run build:test)`);
}

if (failed === 0) {
  console.log('\n✅ All critical checks passed!');
  if (warnings > 0) {
    console.log('   Run TEST_MODE=true npm run build:test to resolve warnings');
  }
  process.exit(0);
} else {
  console.log('\n❌ Some checks failed. Please fix the issues above.');
  process.exit(1);
}
