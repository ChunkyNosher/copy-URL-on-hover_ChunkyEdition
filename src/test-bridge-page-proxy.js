/**
 * Test Bridge Page Proxy for GitHub Copilot Autonomous Testing
 * 
 * This script is injected into the page context (window) to provide test access
 * to the extension's test bridge API. It communicates with the content script
 * which then forwards messages to the background script.
 * 
 * SECURITY: Only injected in test builds (TEST_MODE=true)
 * USAGE: Tests access via window.__COPILOT_TEST_BRIDGE__
 * 
 * @version 1.0.0
 */

// Inject test bridge proxy into page context
(() => {
  'use strict';
  
  console.log('[TEST BRIDGE PAGE PROXY] Starting execution');
  console.log('[TEST BRIDGE PAGE PROXY] typeof window:', typeof window);
  console.log('[TEST BRIDGE PAGE PROXY] document.readyState:', document.readyState);
  console.log('[TEST BRIDGE PAGE PROXY] location.href:', window.location.href);
  
  /**
   * Test Bridge Page Proxy
   * Forwards test API calls from page context to extension via custom events
   */
  const TestBridgeProxy = {
    /**
     * Call a test bridge method
     * @param {string} method - Method name
     * @param {Object} data - Method parameters
     * @returns {Promise<any>} Method result
     */
    _call(method, data) {
      return new Promise((resolve, reject) => {
        const requestId = `test-bridge-${Date.now()}-${Math.random()}`;
        
        // Listen for response
        const responseHandler = (event) => {
          if (event.detail.requestId === requestId) {
            window.removeEventListener('TEST_BRIDGE_RESPONSE', responseHandler);
            
            if (event.detail.success) {
              resolve(event.detail.data);
            } else {
              reject(new Error(event.detail.error || 'Test bridge method failed'));
            }
          }
        };
        
        window.addEventListener('TEST_BRIDGE_RESPONSE', responseHandler);
        
        // Send request to content script
        window.dispatchEvent(new CustomEvent('TEST_BRIDGE_REQUEST', {
          detail: { requestId, method, data }
        }));
        
        // Timeout after 30 seconds
        setTimeout(() => {
          window.removeEventListener('TEST_BRIDGE_RESPONSE', responseHandler);
          reject(new Error(`Test bridge timeout for method: ${method}`));
        }, 30000);
      });
    },
    
    createQuickTab(url, options = {}) {
      return this._call('createQuickTab', { url, options });
    },
    
    getQuickTabs() {
      return this._call('getQuickTabs', {});
    },
    
    getQuickTabById(id) {
      return this._call('getQuickTabById', { id });
    },
    
    minimizeQuickTab(id) {
      return this._call('minimizeQuickTab', { id });
    },
    
    restoreQuickTab(id) {
      return this._call('restoreQuickTab', { id });
    },
    
    pinQuickTab(id) {
      return this._call('pinQuickTab', { id });
    },
    
    unpinQuickTab(id) {
      return this._call('unpinQuickTab', { id });
    },
    
    closeQuickTab(id) {
      return this._call('closeQuickTab', { id });
    },
    
    clearAllQuickTabs() {
      return this._call('clearAllQuickTabs', {});
    },
    
    async waitForQuickTabCount(count, timeoutMs = 5000) {
      const startTime = Date.now();
      while (Date.now() - startTime < timeoutMs) {
        const tabs = await this.getQuickTabs();
        if (tabs.length === count) {
          return true;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error(`Timeout waiting for ${count} Quick Tabs`);
    },
    
    getQuickTabGeometry(id) {
      return this._call('getQuickTabGeometry', { id });
    },
    
    verifyZIndexOrder(ids) {
      return this._call('verifyZIndexOrder', { ids });
    }
  };
  
  // Expose test bridge on window
  window.__COPILOT_TEST_BRIDGE__ = TestBridgeProxy;
  
  console.log('[TEST BRIDGE PAGE PROXY] ✓ Bridge exposed to window');
  console.log('[TEST BRIDGE PAGE PROXY] typeof window.__COPILOT_TEST_BRIDGE__:', 
              typeof window.__COPILOT_TEST_BRIDGE__);
  console.log('[TEST BRIDGE PAGE PROXY] Bridge methods:', 
              Object.keys(window.__COPILOT_TEST_BRIDGE__));
  
  // Dispatch event to signal bridge is ready (helps with timing)
  window.dispatchEvent(new CustomEvent('copilot-bridge-ready', {
    detail: { timestamp: Date.now() }
  }));
  
  console.log('[TEST BRIDGE PAGE PROXY] ✓ Initialization complete');
})();
