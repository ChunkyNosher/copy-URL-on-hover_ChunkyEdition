/**
 * Test Bridge Background Script Handler
 * 
 * Handles TEST_BRIDGE_CALL messages from content scripts and forwards to test bridge API
 * 
 * SECURITY: Only included in test builds (TEST_MODE=true)
 * REQUIREMENT: Must be included AFTER test-bridge.js in background.js
 * 
 * @version 1.0.0
 */

console.log('[Test Bridge Background Handler] Initializing...');

// Add message listener for test bridge calls
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TEST_BRIDGE_CALL') {
    console.log('[Test Bridge Background Handler] Received call:', message.data);
    
    const { method, data } = message.data;
    
    // Validate test bridge is available
    if (typeof window.__COPILOT_TEST_BRIDGE__ === 'undefined') {
      console.error('[Test Bridge Background Handler] Test bridge not available');
      sendResponse({
        success: false,
        error: 'Test bridge not available'
      });
      return true;
    }
    
    // Call test bridge method
    const testBridge = window.__COPILOT_TEST_BRIDGE__;
    
    if (typeof testBridge[method] !== 'function') {
      console.error('[Test Bridge Background Handler] Unknown method:', method);
      sendResponse({
        success: false,
        error: `Unknown test bridge method: ${method}`
      });
      return true;
    }
    
    // Execute method with proper parameter unpacking
    let methodPromise;
    try {
      // Different methods have different signatures
      switch (method) {
        case 'createQuickTab':
          methodPromise = testBridge[method](data.url, data.options);
          break;
        case 'getQuickTabById':
        case 'minimizeQuickTab':
        case 'restoreQuickTab':
        case 'pinQuickTab':
        case 'unpinQuickTab':
        case 'closeQuickTab':
        case 'getQuickTabGeometry':
          methodPromise = testBridge[method](data.id);
          break;
        case 'verifyZIndexOrder':
          methodPromise = testBridge[method](data.ids);
          break;
        case 'getQuickTabs':
        case 'clearAllQuickTabs':
          methodPromise = testBridge[method]();
          break;
        default:
          throw new Error(`Unhandled method: ${method}`);
      }
      
      methodPromise
        .then(result => {
          console.log('[Test Bridge Background Handler] Method succeeded:', { method, result });
          sendResponse({
            success: true,
            data: result
          });
        })
        .catch(error => {
          console.error('[Test Bridge Background Handler] Method failed:', { method, error });
          sendResponse({
            success: false,
            error: error.message
          });
        });
    } catch (error) {
      console.error('[Test Bridge Background Handler] Method execution error:', { method, error });
      sendResponse({
        success: false,
        error: error.message
      });
    }
    
    // Return true to indicate async response
    return true;
  }
  
  // Not a test bridge call, let other handlers process it
  return false;
});

console.log('[Test Bridge Background Handler] ✓ Ready to handle TEST_BRIDGE_CALL messages');
