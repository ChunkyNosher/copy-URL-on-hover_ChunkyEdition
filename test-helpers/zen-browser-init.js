// Zen Browser Detection & Setup
window.isZenBrowser = navigator.userAgent.includes('Zen') || typeof browser !== 'undefined';

// Log Zen-specific environment
console.log('[Zen Browser Test] Environment initialized');
console.log('[Zen Browser Test] Extension loaded:', window.isZenBrowser);

// Zen Browser workspace detection
window.zenHelpers = {
  // Detect if Zen's split view is available
  detectSplitView: async () => {
    // Zen Browser specific DOM detection
    return document.querySelector('.zen-split-view') !== null;
  },

  // Detect Zen workspaces
  detectWorkspaces: async () => {
    return document.querySelector('.zen-workspace') !== null;
  },

  // Wait for Zen Browser UI to fully load
  waitForZenUI: async (timeout = 5000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const zenUI =
        document.querySelector('.zen-browser-ui') || document.querySelector('[data-zen-browser]');
      if (zenUI) return true;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
  },

  // Extension compatibility check
  checkExtensionCompatibility: async () => {
    // Verify WebExtensions API is available (same as Firefox)
    const apis = [
      typeof browser !== 'undefined',
      typeof browser?.tabs !== 'undefined',
      typeof browser?.runtime !== 'undefined',
      typeof browser?.storage !== 'undefined'
    ];
    return apis.every(Boolean);
  }
};

// Auto-detect Zen Browser features
(async () => {
  console.log('[Zen Browser] Split View available:', await window.zenHelpers.detectSplitView());
  console.log('[Zen Browser] Workspaces available:', await window.zenHelpers.detectWorkspaces());
  console.log(
    '[Zen Browser] Extension compatible:',
    await window.zenHelpers.checkExtensionCompatibility()
  );
})();
