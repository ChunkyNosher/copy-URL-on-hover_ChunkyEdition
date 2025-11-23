/**
 * Test Bridge Content Script Handler
 * 
 * Handles communication between page context (test bridge proxy) and background script (test bridge)
 * Listens for custom events from page and forwards to background via browser.runtime.sendMessage
 * 
 * SECURITY: Only included in test builds (TEST_MODE=true)
 * 
 * @version 1.0.0
 */

console.log('[Test Bridge Content Handler] Initializing...');

// Listen for test bridge requests from page context
window.addEventListener('TEST_BRIDGE_REQUEST', async (event) => {
  const { requestId, method, data } = event.detail;
  console.log('[Test Bridge Content Handler] Request:', { requestId, method, data });
  
  try {
    // Forward to background script
    const response = await browser.runtime.sendMessage({
      type: 'TEST_BRIDGE_CALL',
      data: { method, data }
    });
    
    console.log('[Test Bridge Content Handler] Response:', response);
    
    // Send response back to page
    window.dispatchEvent(new CustomEvent('TEST_BRIDGE_RESPONSE', {
      detail: {
        requestId,
        success: response.success,
        data: response.data,
        error: response.error
      }
    }));
  } catch (error) {
    console.error('[Test Bridge Content Handler] Error:', error);
    
    // Send error response to page
    window.dispatchEvent(new CustomEvent('TEST_BRIDGE_RESPONSE', {
      detail: {
        requestId,
        success: false,
        error: error.message
      }
    }));
  }
});

console.log('[Test Bridge Content Handler] ✓ Ready to handle test bridge requests');
