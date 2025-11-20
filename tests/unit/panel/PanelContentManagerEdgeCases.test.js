/**
 * Edge Case Tests for PanelContentManager
 * v1.6.0 - Phase 7.6: Additional coverage for error paths and edge cases
 *
 * Target: Close coverage gap from 90.8% to 95%+
 * Uncovered lines: 132-133, 156, 290-291, 296-302, 331
 */

import { jest } from '@jest/globals';

import { PanelContentManager } from '../../../src/features/quick-tabs/panel/PanelContentManager.js';

describe('PanelContentManager - Edge Cases', () => {
  let panelElement;
  let mockUIBuilder;
  let mockStateManager;
  let mockQuickTabsManager;
  let mockBrowser;
  let contentManager;

  beforeEach(() => {
    // Create mock panel element
    panelElement = document.createElement('div');
    panelElement.innerHTML = `
      <div class="panel-header">
        <button class="panel-close">✕</button>
        <button class="panel-minimize">−</button>
      </div>
      <div class="panel-actions">
        <button id="panel-closeMinimized">Close Minimized</button>
        <button id="panel-closeAll">Close All</button>
      </div>
      <div class="panel-stats">
        <span id="panel-totalTabs">0 Quick Tabs</span>
        <span id="panel-lastSync">Last sync: Never</span>
      </div>
      <div id="panel-containersList"></div>
      <div id="panel-emptyState" style="display: none;"></div>
    `;

    // Mock dependencies
    mockUIBuilder = {
      renderContainerSection: jest.fn(),
      getContainerIcon: jest.fn(icon => `icon-${icon}`)
    };

    mockStateManager = {
      broadcast: jest.fn(),
      savePanelState: jest.fn()
    };

    mockQuickTabsManager = {
      minimizeById: jest.fn(),
      restoreById: jest.fn(),
      closeById: jest.fn()
    };

    // Mock browser APIs
    mockBrowser = {
      storage: {
        sync: {
          get: jest.fn().mockResolvedValue({}),
          set: jest.fn().mockResolvedValue()
        },
        session: {
          set: jest.fn().mockResolvedValue()
        }
      },
      tabs: {
        update: jest.fn().mockResolvedValue()
      },
      runtime: {
        sendMessage: jest.fn().mockResolvedValue()
      },
      contextualIdentities: {
        query: jest.fn().mockResolvedValue([])
      }
    };
    global.browser = mockBrowser;

    // Create content manager
    contentManager = new PanelContentManager(panelElement, {
      uiBuilder: mockUIBuilder,
      stateManager: mockStateManager,
      quickTabsManager: mockQuickTabsManager,
      currentContainerId: 'firefox-default'
    });
    contentManager.setIsOpen(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Error Handling - _fetchContainerInfo()', () => {
    test('should handle contextualIdentities.query throwing error', async () => {
      // Setup: Make query throw an error
      mockBrowser.contextualIdentities.query.mockRejectedValue(new Error('API not available'));

      // Mock console.error to suppress output
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      // Setup storage with non-default container
      mockBrowser.storage.sync.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {
            'firefox-container-1': {
              tabs: [
                {
                  id: 'qt-1',
                  url: 'https://example.com',
                  minimized: false,
                  soloedOnTabs: [],
                  mutedOnTabs: []
                }
              ],
              lastUpdate: Date.now()
            }
          }
        }
      });

      // Create manager with non-default container
      contentManager = new PanelContentManager(panelElement, {
        uiBuilder: mockUIBuilder,
        stateManager: mockStateManager,
        quickTabsManager: mockQuickTabsManager,
        currentContainerId: 'firefox-container-1'
      });
      contentManager.setIsOpen(true);

      // Execute
      await contentManager.updateContent();

      // Verify: Should use default info and log error
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[PanelContentManager] Error loading container:',
        expect.any(Error)
      );

      // Cleanup
      consoleErrorSpy.mockRestore();
    });

    test('should handle network error when fetching container info', async () => {
      // Setup: Network error
      mockBrowser.contextualIdentities.query.mockRejectedValue(
        new Error('NetworkError: Failed to fetch')
      );

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      // Setup storage
      mockBrowser.storage.sync.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {
            'firefox-container-2': {
              tabs: [
                {
                  id: 'qt-1',
                  url: 'https://example.com',
                  minimized: false
                }
              ],
              lastUpdate: Date.now()
            }
          }
        }
      });

      contentManager = new PanelContentManager(panelElement, {
        uiBuilder: mockUIBuilder,
        stateManager: mockStateManager,
        quickTabsManager: mockQuickTabsManager,
        currentContainerId: 'firefox-container-2'
      });
      contentManager.setIsOpen(true);

      // Execute
      await contentManager.updateContent();

      // Verify: Error logged, default info used
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(mockUIBuilder.renderContainerSection).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Statistics Display - Edge Cases', () => {
    test('should handle timestamp = 0 case', async () => {
      // Setup: Storage with timestamp = 0
      mockBrowser.storage.sync.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {
            'firefox-default': {
              tabs: [],
              lastUpdate: 0 // Edge case: timestamp = 0
            }
          }
        }
      });

      // Execute
      await contentManager.updateContent();

      // Verify: Should show "Never" for zero timestamp
      const lastSyncEl = panelElement.querySelector('#panel-lastSync');
      expect(lastSyncEl.textContent).toBe('Last sync: Never');
    });

    test('should handle missing timestamp element', async () => {
      // Setup: Remove lastSync element
      const lastSyncEl = panelElement.querySelector('#panel-lastSync');
      lastSyncEl.remove();

      // Setup storage
      mockBrowser.storage.sync.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {
            'firefox-default': {
              tabs: [
                {
                  id: 'qt-1',
                  url: 'https://example.com',
                  minimized: false
                }
              ],
              lastUpdate: Date.now()
            }
          }
        }
      });

      // Execute: Should not throw error
      await expect(contentManager.updateContent()).resolves.not.toThrow();
    });

    test('should handle missing totalTabs element', async () => {
      // Setup: Remove totalTabs element
      const totalTabsEl = panelElement.querySelector('#panel-totalTabs');
      totalTabsEl.remove();

      // Setup storage
      mockBrowser.storage.sync.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {
            'firefox-default': {
              tabs: [
                {
                  id: 'qt-1',
                  url: 'https://example.com',
                  minimized: false
                }
              ],
              lastUpdate: Date.now()
            }
          }
        }
      });

      // Execute: Should not throw error
      await expect(contentManager.updateContent()).resolves.not.toThrow();
    });
  });

  describe('Action Routing - _handleQuickTabAction()', () => {
    test('should handle unknown action type', async () => {
      // Mock console.warn
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      // Execute: Unknown action
      await contentManager._handleQuickTabAction('unknownAction', 'qt-1', '123');

      // Verify: Warning logged
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[PanelContentManager] Unknown action: unknownAction'
      );

      // Cleanup
      consoleWarnSpy.mockRestore();
    });

    test('should handle null action', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      // Execute
      await contentManager._handleQuickTabAction(null, 'qt-1', '123');

      // Verify
      expect(consoleWarnSpy).toHaveBeenCalledWith('[PanelContentManager] Unknown action: null');

      consoleWarnSpy.mockRestore();
    });

    test('should handle undefined action', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      // Execute
      await contentManager._handleQuickTabAction(undefined, 'qt-1', '123');

      // Verify
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[PanelContentManager] Unknown action: undefined'
      );

      consoleWarnSpy.mockRestore();
    });

    test('should handle restore action with valid ID', async () => {
      // Setup storage
      mockBrowser.storage.sync.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {
            'firefox-default': {
              tabs: [],
              lastUpdate: Date.now()
            }
          }
        }
      });

      // Execute
      await contentManager._handleQuickTabAction('restore', 'qt-123', '456');

      // Verify
      expect(mockQuickTabsManager.restoreById).toHaveBeenCalledWith('qt-123');
    });

    test('should handle goToTab action with valid tab ID', async () => {
      // Setup storage
      mockBrowser.storage.sync.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {
            'firefox-default': {
              tabs: [],
              lastUpdate: Date.now()
            }
          }
        }
      });

      // Mock successful tab switch response
      mockBrowser.runtime.sendMessage.mockResolvedValue({ success: true });

      // Execute
      await contentManager._handleQuickTabAction('goToTab', 'qt-1', '789');

      // Verify: message sent to background with tab ID as integer
      expect(mockBrowser.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'SWITCH_TO_TAB',
        tabId: 789
      });
    });
  });

  describe('Data Corruption - handleCloseMinimized()', () => {
    test('should handle corrupted container state with null tabs array', async () => {
      // Setup: Corrupted state
      mockBrowser.storage.sync.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {
            'firefox-default': {
              tabs: null, // Corrupted: null instead of array
              lastUpdate: Date.now()
            }
          }
        }
      });

      // Execute: Should handle gracefully
      await expect(contentManager.handleCloseMinimized()).resolves.not.toThrow();

      // Verify: No changes made to storage
      expect(mockBrowser.storage.sync.set).not.toHaveBeenCalled();
    });

    test('should handle container state with undefined tabs', async () => {
      // Setup: Missing tabs property
      mockBrowser.storage.sync.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {
            'firefox-default': {
              lastUpdate: Date.now()
              // tabs property missing
            }
          }
        }
      });

      // Execute: Should handle gracefully
      await expect(contentManager.handleCloseMinimized()).resolves.not.toThrow();

      // Verify: No changes
      expect(mockBrowser.storage.sync.set).not.toHaveBeenCalled();
    });

    test('should handle container state with non-array tabs', async () => {
      // Setup: tabs is object instead of array
      mockBrowser.storage.sync.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {
            'firefox-default': {
              tabs: { 0: { id: 'qt-1' } }, // Object, not array
              lastUpdate: Date.now()
            }
          }
        }
      });

      // Execute: Should handle gracefully
      await expect(contentManager.handleCloseMinimized()).resolves.not.toThrow();

      // Verify: No changes
      expect(mockBrowser.storage.sync.set).not.toHaveBeenCalled();
    });

    test('should skip saveId and timestamp keys when iterating containers', async () => {
      // Setup: Storage with metadata keys
      mockBrowser.storage.sync.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {
            saveId: 'some-uuid-12345', // Should be skipped
            timestamp: Date.now(), // Should be skipped
            'firefox-default': {
              tabs: [
                {
                  id: 'qt-1',
                  url: 'https://example.com',
                  minimized: true
                }
              ],
              lastUpdate: Date.now()
            }
          }
        }
      });

      // Execute
      await contentManager.handleCloseMinimized();

      // Verify: Storage saved (container was processed, minimized tab removed)
      expect(mockBrowser.storage.sync.set).toHaveBeenCalled();

      // Check that the saved state doesn't have the minimized tab
      const savedState = mockBrowser.storage.sync.set.mock.calls[0][0].quick_tabs_state_v2;
      const defaultContainerTabs = savedState.containers['firefox-default'].tabs;

      // Tab should be filtered out
      expect(defaultContainerTabs).toHaveLength(0);
    });
  });

  describe('Additional Edge Cases', () => {
    test('should handle empty string action', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      await contentManager._handleQuickTabAction('', 'qt-1', '123');

      expect(consoleWarnSpy).toHaveBeenCalledWith('[PanelContentManager] Unknown action: ');

      consoleWarnSpy.mockRestore();
    });

    test('should handle invalid tab ID in goToTab', async () => {
      mockBrowser.storage.sync.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {
            'firefox-default': {
              tabs: [],
              lastUpdate: Date.now()
            }
          }
        }
      });

      // Mock failed response for invalid tab ID
      mockBrowser.runtime.sendMessage.mockResolvedValue({
        success: false,
        error: 'Invalid tab ID'
      });

      // Execute with non-numeric tab ID
      await contentManager._handleQuickTabAction('goToTab', 'qt-1', 'invalid');

      // Verify: NaN passed to parseInt results in NaN being sent to background
      expect(mockBrowser.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'SWITCH_TO_TAB',
        tabId: NaN
      });
    });

    test('should handle concurrent action calls', async () => {
      mockBrowser.storage.sync.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {
            'firefox-default': {
              tabs: [],
              lastUpdate: Date.now()
            }
          }
        }
      });

      // Execute: Multiple actions simultaneously
      await Promise.all([
        contentManager._handleQuickTabAction('minimize', 'qt-1', '123'),
        contentManager._handleQuickTabAction('close', 'qt-2', '456'),
        contentManager._handleQuickTabAction('restore', 'qt-3', '789')
      ]);

      // Verify: All actions processed
      expect(mockQuickTabsManager.minimizeById).toHaveBeenCalledWith('qt-1');
      expect(mockQuickTabsManager.closeById).toHaveBeenCalledWith('qt-2');
      expect(mockQuickTabsManager.restoreById).toHaveBeenCalledWith('qt-3');
    });

    test('should handle action with special characters in ID', async () => {
      mockBrowser.storage.sync.get.mockResolvedValue({
        quick_tabs_state_v2: {
          containers: {
            'firefox-default': {
              tabs: [],
              lastUpdate: Date.now()
            }
          }
        }
      });

      const specialId = 'qt-<script>alert("xss")</script>';

      await contentManager._handleQuickTabAction('close', specialId, '123');

      // Verify: ID passed as-is (sanitization should happen elsewhere)
      expect(mockQuickTabsManager.closeById).toHaveBeenCalledWith(specialId);
    });
  });
});
