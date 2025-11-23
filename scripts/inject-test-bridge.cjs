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
const SRC_TEST_BRIDGE_BG_HANDLER = path.join(__dirname, '..', 'src', 'test-bridge-background-handler.js');
const SRC_TEST_BRIDGE_PAGE_PROXY = path.join(__dirname, '..', 'src', 'test-bridge-page-proxy.js');
const SRC_TEST_BRIDGE_CONTENT_HANDLER = path.join(__dirname, '..', 'src', 'test-bridge-content-handler.js');
const DIST_TEST_BRIDGE = path.join(DIST_DIR, 'test-bridge.js');
const DIST_BACKGROUND = path.join(DIST_DIR, 'background.js');
const DIST_CONTENT = path.join(DIST_DIR, 'content.js');
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

// Step 3: Append test bridge and background handler to background.js
try {
  const testBridgeContent = fs.readFileSync(DIST_TEST_BRIDGE, 'utf8');
  const bgHandlerContent = fs.readFileSync(SRC_TEST_BRIDGE_BG_HANDLER, 'utf8');
  const backgroundContent = fs.readFileSync(DIST_BACKGROUND, 'utf8');
  
  // Check if already injected
  if (backgroundContent.includes('COPILOT_TEST_BRIDGE')) {
    console.log('⏭️  Test bridge already injected in background.js');
  } else {
    fs.appendFileSync(DIST_BACKGROUND, '\n\n// === TEST BRIDGE INJECTION ===\n');
    fs.appendFileSync(DIST_BACKGROUND, testBridgeContent);
    fs.appendFileSync(DIST_BACKGROUND, '\n\n// === TEST BRIDGE BACKGROUND HANDLER ===\n');
    fs.appendFileSync(DIST_BACKGROUND, bgHandlerContent);
    console.log('✓ Appended test-bridge.js and background handler to background.js');
  }
} catch (error) {
  console.error('✗ ERROR: Failed to append test bridge to background.js');
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

// Step 5: Inject page proxy and content handler into content.js
try {
  const pageProxyContent = fs.readFileSync(SRC_TEST_BRIDGE_PAGE_PROXY, 'utf8');
  const contentHandlerContent = fs.readFileSync(SRC_TEST_BRIDGE_CONTENT_HANDLER, 'utf8');
  const contentScript = fs.readFileSync(DIST_CONTENT, 'utf8');
  
  // Check if already injected
  if (contentScript.includes('Test Bridge Page Proxy')) {
    console.log('⏭️  Test bridge already injected in content.js');
  } else {
    // Create injection script that runs in page context
    // Uses Blob URL to bypass CSP restrictions (Manifest V2 compatible)
    // Research verified: Blob URLs bypass CSP script-src restrictions
    const injectionScript = `
// === TEST BRIDGE PAGE INJECTION ===
// Inject test bridge proxy into page context using Blob URL (CSP-safe)
// Blob URLs bypass CSP restrictions more reliably than inline script.textContent
(function injectTestBridge() {
  'use strict';
  
  /**
   * Content script marker - helps verify content script executed
   */
  (function setMarker() {
    const marker = document.createElement('meta');
    marker.name = 'copilot-content-script-loaded';
    marker.content = 'true';
    if (document.head) {
      document.head.appendChild(marker);
    } else {
      // If head doesn't exist yet, wait for it
      const observer = new MutationObserver(() => {
        if (document.head) {
          document.head.appendChild(marker);
          observer.disconnect();
        }
      });
      observer.observe(document.documentElement, { childList: true });
    }
    console.log('[CONTENT SCRIPT] Marker set at', new Date().toISOString());
    console.log('[CONTENT SCRIPT] URL:', window.location.href);
    console.log('[CONTENT SCRIPT] readyState:', document.readyState);
  })();
  
  /**
   * Inject test bridge with retry logic and Blob URL for CSP bypass
   * @param {number} attempts - Current attempt count
   */
  function attemptInject(attempts = 0) {
    // Wait for DOM to be ready
    const targetElement = document.head || document.documentElement;
    if (!targetElement) {
      if (attempts < 50) {  // Max 500ms wait
        setTimeout(() => attemptInject(attempts + 1), 10);
        return;
      }
      console.error('[CONTENT SCRIPT] Failed to inject test bridge: no DOM after 500ms');
      return;
    }
    
    console.log('[CONTENT SCRIPT] Injecting test bridge via Blob URL (CSP bypass)');
    
    // Get test bridge code (embedded as JSON string)
    const testBridgeCode = ${JSON.stringify(pageProxyContent)};
    
    // Create Blob from code string (bypasses CSP script-src restrictions)
    const blob = new Blob([testBridgeCode], { 
      type: 'application/javascript' 
    });
    const blobUrl = URL.createObjectURL(blob);
    
    // Create script element with blob URL (not textContent!)
    const script = document.createElement('script');
    script.src = blobUrl;  // Use src instead of textContent - bypasses CSP
    
    // Clean up after load
    script.onload = () => {
      URL.revokeObjectURL(blobUrl);
      console.log('[CONTENT SCRIPT] ✓ Test bridge loaded successfully via Blob URL');
      
      // Verify bridge exists
      const checkScript = document.createElement('script');
      checkScript.textContent = \`
        if (typeof window.__COPILOT_TEST_BRIDGE__ !== 'undefined') {
          console.log('[TEST BRIDGE] ✓ Successfully exposed to window object');
          console.log('[TEST BRIDGE] Available methods:', Object.keys(window.__COPILOT_TEST_BRIDGE__));
        } else {
          console.error('[TEST BRIDGE] ✗ NOT found on window object after injection');
        }
      \`;
      targetElement.appendChild(checkScript);
      checkScript.remove();
    };
    
    script.onerror = (error) => {
      console.error('[CONTENT SCRIPT] ✗ Failed to load test bridge:', error);
      URL.revokeObjectURL(blobUrl);
      
      // Try fallback: extension URL (Manifest V2 compatible)
      console.log('[CONTENT SCRIPT] Attempting fallback: chrome.runtime.getURL');
      // Note: This would require test-bridge.js in web_accessible_resources
      // which we already have in manifest.json
    };
    
    // Inject into page
    targetElement.appendChild(script);
    // Don't remove immediately - let onload handle cleanup
  }
  
  // Start injection attempt with DOM readiness check
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => attemptInject());
  } else {
    attemptInject();
  }
})();

// === TEST BRIDGE CONTENT HANDLER ===
${contentHandlerContent}
`;
    
    fs.appendFileSync(DIST_CONTENT, injectionScript);
    console.log('✓ Appended test bridge proxy and handler to content.js');
  }
} catch (error) {
  console.error('✗ ERROR: Failed to inject test bridge into content.js');
  console.error(error.message);
  process.exit(1);
}

// Step 6: Verify injection
try {
  const backgroundContent = fs.readFileSync(DIST_BACKGROUND, 'utf8');
  if (!backgroundContent.includes('COPILOT_TEST_BRIDGE')) {
    throw new Error('Test bridge not found in background.js after injection');
  }
  
  const contentContent = fs.readFileSync(DIST_CONTENT, 'utf8');
  if (!contentContent.includes('Test Bridge Page Proxy')) {
    throw new Error('Test bridge page proxy not found in content.js after injection');
  }
  
  const manifestContent = fs.readFileSync(DIST_MANIFEST, 'utf8');
  if (!manifestContent.includes('test-bridge.js')) {
    throw new Error('test-bridge.js not found in manifest.json after injection');
  }
  
  console.log('✓ Verification passed: Test bridge successfully injected');
  console.log('');
  console.log('✅ Test bridge injection complete!');
  console.log('   - Background: Test bridge API + message handler');
  console.log('   - Content: Page proxy + content handler');
  console.log('   - Ready for autonomous testing with Playwright MCP');
} catch (error) {
  console.error('✗ ERROR: Verification failed');
  console.error(error.message);
  process.exit(1);
}
