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

/**
 * Method signature handlers for test bridge methods
 * Maps method name to function that extracts parameters from data
 * v1.6.4 - J2: Added container isolation and Manager state verification methods
 */
const METHOD_HANDLERS = {
  createQuickTab: (testBridge, data) => testBridge.createQuickTab(data.url, data.options),
  getQuickTabById: (testBridge, data) => testBridge.getQuickTabById(data.id),
  minimizeQuickTab: (testBridge, data) => testBridge.minimizeQuickTab(data.id),
  restoreQuickTab: (testBridge, data) => testBridge.restoreQuickTab(data.id),
  pinQuickTab: (testBridge, data) => testBridge.pinQuickTab(data.id),
  unpinQuickTab: (testBridge, data) => testBridge.unpinQuickTab(data.id),
  closeQuickTab: (testBridge, data) => testBridge.closeQuickTab(data.id),
  getQuickTabGeometry: (testBridge, data) => testBridge.getQuickTabGeometry(data.id),
  verifyZIndexOrder: (testBridge, data) => testBridge.verifyZIndexOrder(data.ids),
  getQuickTabs: testBridge => testBridge.getQuickTabs(),
  clearAllQuickTabs: testBridge => testBridge.clearAllQuickTabs(),
  // v1.6.4 - J2: Manager state verification
  getManagerState: testBridge => testBridge.getManagerState(),
  // v1.6.4 - J2: Container isolation verification
  getContainerInfo: testBridge => testBridge.getContainerInfo(),
  verifyContainerIsolation: (testBridge, data) => testBridge.verifyContainerIsolation(data.id1, data.id2),
  verifyContainerIsolationById: (testBridge, data) => testBridge.verifyContainerIsolationById(data.containerId),
  getContainerLabel: (testBridge, data) => testBridge.getContainerLabel(data.containerId),
  verifyCrossTabIsolation: (testBridge, data) => testBridge.verifyCrossTabIsolation(data.originTabId)
};

/**
 * Route test bridge method calls based on method name and data
 * @param {Object} testBridge - Test bridge API
 * @param {string} method - Method name
 * @param {Object} data - Method parameters
 * @returns {Promise} Method result promise
 */
function routeTestBridgeMethod(testBridge, method, data) {
  const handler = METHOD_HANDLERS[method];
  if (!handler) {
    throw new Error(`Unhandled method: ${method}`);
  }
  return handler(testBridge, data);
}

/**
 * Handle test bridge call result and send response
 * @param {string} method - Method name
 * @param {Promise} methodPromise - Method promise
 * @param {Function} sendResponse - Response callback
 */
function handleTestBridgeResult(method, methodPromise, sendResponse) {
  methodPromise
    .then(result => {
      console.log('[Test Bridge Background Handler] Method succeeded:', { method, result });
      sendResponse({ success: true, data: result });
    })
    .catch(error => {
      console.error('[Test Bridge Background Handler] Method failed:', { method, error });
      sendResponse({ success: false, error: error.message });
    });
}

// Add message listener for test bridge calls
browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'TEST_BRIDGE_CALL') {
    return false; // Not a test bridge call, let other handlers process it
  }

  console.log('[Test Bridge Background Handler] Received call:', message.data);

  const { method, data } = message.data;

  // Validate test bridge is available
  if (typeof window.__COPILOT_TEST_BRIDGE__ === 'undefined') {
    console.error('[Test Bridge Background Handler] Test bridge not available');
    sendResponse({ success: false, error: 'Test bridge not available' });
    return true;
  }

  const testBridge = window.__COPILOT_TEST_BRIDGE__;

  if (typeof testBridge[method] !== 'function') {
    console.error('[Test Bridge Background Handler] Unknown method:', method);
    sendResponse({ success: false, error: `Unknown test bridge method: ${method}` });
    return true;
  }

  // Execute method with proper parameter unpacking
  try {
    const methodPromise = routeTestBridgeMethod(testBridge, method, data);
    handleTestBridgeResult(method, methodPromise, sendResponse);
  } catch (error) {
    console.error('[Test Bridge Background Handler] Method execution error:', { method, error });
    sendResponse({ success: false, error: error.message });
  }

  // Return true to indicate async response
  return true;
});

console.log('[Test Bridge Background Handler] ✓ Ready to handle TEST_BRIDGE_CALL messages');
