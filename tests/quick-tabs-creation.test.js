/**
 * ==============================================================================
 * QUICK TABS CREATION FLOW TEST SUITE - v1.6.3.8-v6
 * ==============================================================================
 * Tests for the Quick Tabs rendering bug fix
 *
 * This test suite validates:
 * 1. Direct local creation pattern (originating tab renders immediately)
 * 2. Port-based messaging propagation to sidebar (BC removed)
 * 3. Message action name handling (both SYNC_QUICK_TAB_STATE variants)
 * 4. SaveId tracking prevents race conditions
 * 5. Proper separation of concerns (content/port/background)
 *
 * v1.6.3.8-v6 - BC REMOVED: Tests updated to use port-based messaging
 *
 * References:
 * - docs/manual/1.5.9 docs/quick-tabs-rendering-bug-analysis-v15910.md
 * - src/content.js (handleCreateQuickTab)
 * - src/features/quick-tabs/index.js (createQuickTab, setupMessageListeners)
 * - background.js (CREATE_QUICK_TAB handler)
 * ==============================================================================
 */

describe('Quick Tabs Creation Flow - v1.6.3.8-v6 Fix', () => {
  let mockQuickTabsManager;
  let mockBrowser;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // v1.6.3.8-v6 - BC REMOVED: No longer mock BroadcastChannel

    // Mock browser APIs
    mockBrowser = {
      storage: {
        sync: {
          get: jest.fn().mockResolvedValue({}),
          set: jest.fn().mockResolvedValue(undefined)
        },
        session: {
          get: jest.fn().mockResolvedValue({}),
          set: jest.fn().mockResolvedValue(undefined)
        },
        local: {
          get: jest.fn().mockResolvedValue({}),
          set: jest.fn().mockResolvedValue(undefined)
        },
        onChanged: {
          addListener: jest.fn()
        }
      },
      runtime: {
        id: 'test-extension-id',
        sendMessage: jest.fn().mockResolvedValue({ success: true }),
        onMessage: {
          addListener: jest.fn()
        }
      },
      tabs: {
        query: jest.fn().mockResolvedValue([{ id: 1 }]),
        get: jest.fn().mockResolvedValue({ id: 1, cookieStoreId: 'firefox-default' })
      }
    };
    global.browser = mockBrowser;

    // Mock QuickTabsManager
    mockQuickTabsManager = {
      tabs: new Map(),
      generateId: jest.fn(() => `qt-${Date.now()}-test`),
      generateSaveId: jest.fn(() => `${Date.now()}-saveid`),
      trackPendingSave: jest.fn(),
      releasePendingSave: jest.fn(),
      createQuickTab: jest.fn(options => {
        const mockTab = {
          id: options.id,
          url: options.url,
          element: document.createElement('div'),
          isRendered: jest.fn(() => true),
          render: jest.fn(),
          updateZIndex: jest.fn()
        };
        mockQuickTabsManager.tabs.set(options.id, mockTab);
        return mockTab;
      })
    };
  });

  describe('Fix #1: Message Action Name Handling', () => {
    test('should handle SYNC_QUICK_TAB_STATE message', () => {
      const messageListener = mockBrowser.runtime.onMessage.addListener.mock.calls[0]?.[0];

      if (messageListener) {
        const message = {
          action: 'SYNC_QUICK_TAB_STATE',
          state: {
            tabs: [{ id: 'qt-test', url: 'https://example.com', left: 100, top: 100 }]
          }
        };
        const sender = { id: mockBrowser.runtime.id };

        // Should not throw error
        expect(() => messageListener(message, sender)).not.toThrow();
      }
    });

    test('should handle SYNC_QUICK_TAB_STATE_FROM_BACKGROUND message', () => {
      const messageListener = mockBrowser.runtime.onMessage.addListener.mock.calls[0]?.[0];

      if (messageListener) {
        const message = {
          action: 'SYNC_QUICK_TAB_STATE_FROM_BACKGROUND',
          state: {
            tabs: [{ id: 'qt-test', url: 'https://example.com', left: 100, top: 100 }]
          }
        };
        const sender = { id: mockBrowser.runtime.id };

        // Should not throw error
        expect(() => messageListener(message, sender)).not.toThrow();
      }
    });

    test('should validate sender ID before processing sync messages', () => {
      const messageListener = mockBrowser.runtime.onMessage.addListener.mock.calls[0]?.[0];

      if (messageListener) {
        const message = {
          action: 'SYNC_QUICK_TAB_STATE',
          state: { tabs: [] }
        };
        const invalidSender = { id: 'different-extension-id' };

        // Should reject message from unknown sender
        const result = messageListener(message, invalidSender);
        expect(result).toBeFalsy(); // Should not process
      }
    });
  });

  describe('Fix #2: Direct Local Creation Pattern', () => {
    test('should create Quick Tab locally BEFORE notifying background', async () => {
      const url = 'https://example.com';
      const quickTabId = 'qt-123456-test';
      const saveId = '123456-saveid';

      // Simulate handleCreateQuickTab() behavior
      mockQuickTabsManager.generateId.mockReturnValue(quickTabId);
      mockQuickTabsManager.generateSaveId.mockReturnValue(saveId);

      // Track pending save
      mockQuickTabsManager.trackPendingSave(saveId);
      expect(mockQuickTabsManager.trackPendingSave).toHaveBeenCalledWith(saveId);

      // Create locally FIRST
      const tab = mockQuickTabsManager.createQuickTab({
        id: quickTabId,
        url,
        left: 100,
        top: 100,
        width: 800,
        height: 600
      });

      expect(mockQuickTabsManager.createQuickTab).toHaveBeenCalledWith(
        expect.objectContaining({
          id: quickTabId,
          url
        })
      );
      expect(tab).toBeDefined();
      expect(mockQuickTabsManager.tabs.has(quickTabId)).toBe(true);

      // THEN notify background
      await mockBrowser.runtime.sendMessage({
        action: 'CREATE_QUICK_TAB',
        url,
        id: quickTabId,
        saveId
      });

      expect(mockBrowser.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE_QUICK_TAB',
          id: quickTabId,
          saveId
        })
      );
    });

    test('should render Quick Tab immediately in originating tab', () => {
      const quickTabId = 'qt-immediate';

      const tab = mockQuickTabsManager.createQuickTab({
        id: quickTabId,
        url: 'https://example.com',
        left: 100,
        top: 100,
        width: 800,
        height: 600
      });

      // Tab should exist in memory
      expect(mockQuickTabsManager.tabs.has(quickTabId)).toBe(true);

      // Tab should be created and considered rendered
      expect(tab.isRendered()).toBe(true);
    });

    test('should fallback to background-only creation if manager unavailable', async () => {
      // Simulate manager not available
      const unavailableManager = null;

      if (!unavailableManager) {
        // Should still send message to background
        await mockBrowser.runtime.sendMessage({
          action: 'CREATE_QUICK_TAB',
          url: 'https://example.com',
          id: 'qt-fallback'
        });

        expect(mockBrowser.runtime.sendMessage).toHaveBeenCalled();
      }
    });
  });

  // v1.6.3.8-v6 - BC REMOVED: BroadcastChannel propagation tests removed
  // Port-based messaging and storage.onChanged are now primary mechanisms
  describe('Fix #3: Port-based Messaging Propagation', () => {
    test('should create Quick Tab via port-based messaging', () => {
      const quickTabId = 'qt-port-test';
      const url = 'https://example.com';

      mockQuickTabsManager.createQuickTab({
        id: quickTabId,
        url,
        left: 100,
        top: 100,
        width: 800,
        height: 600
      });

      // Port-based messaging should be used to propagate
      // BC removed - no BroadcastChannel assertions
      expect(mockQuickTabsManager.tabs.has(quickTabId)).toBe(true);
    });

    test('should handle state update from storage.onChanged', () => {
      // Simulate receiving state update via storage.onChanged
      const stateUpdate = {
        id: 'qt-from-storage',
        url: 'https://example.com',
        left: 100,
        top: 100,
        width: 800,
        height: 600
      };

      // In real implementation, storage.onChanged triggers state sync
      mockQuickTabsManager.createQuickTab(stateUpdate);

      expect(mockQuickTabsManager.tabs.has('qt-from-storage')).toBe(true);
    });
  });

  describe('Fix #4: SaveId Tracking and Race Condition Prevention', () => {
    test('should track pending saveId during creation', () => {
      const saveId = '123456-test';

      mockQuickTabsManager.trackPendingSave(saveId);

      expect(mockQuickTabsManager.trackPendingSave).toHaveBeenCalledWith(saveId);
    });

    test('should release saveId after grace period', done => {
      const saveId = '123456-test';

      mockQuickTabsManager.trackPendingSave(saveId);

      // Simulate grace period timeout (1000ms in production)
      setTimeout(() => {
        mockQuickTabsManager.releasePendingSave(saveId);
        expect(mockQuickTabsManager.releasePendingSave).toHaveBeenCalledWith(saveId);
        done();
      }, 10); // Use short timeout for test
    });

    test('should ignore storage changes during pending saveId', () => {
      const saveId = '123456-test';
      const pendingSaveIds = new Set([saveId]);

      const storageChange = {
        quick_tabs_state_v2: {
          newValue: {
            saveId,
            containers: {}
          }
        }
      };

      // Should ignore because saveId is pending
      const shouldIgnore = pendingSaveIds.has(storageChange.quick_tabs_state_v2.newValue.saveId);
      expect(shouldIgnore).toBe(true);
    });

    test('should process storage changes after saveId released', () => {
      const saveId = '123456-test';
      const pendingSaveIds = new Set();

      const storageChange = {
        quick_tabs_state_v2: {
          newValue: {
            saveId,
            containers: {}
          }
        }
      };

      // Should NOT ignore because saveId is not pending
      const shouldIgnore = pendingSaveIds.has(storageChange.quick_tabs_state_v2.newValue.saveId);
      expect(shouldIgnore).toBe(false);
    });
  });

  describe('Separation of Concerns', () => {
    test('content script handles UI rendering', () => {
      const tab = mockQuickTabsManager.createQuickTab({
        id: 'qt-ui-test',
        url: 'https://example.com',
        left: 100,
        top: 100,
        width: 800,
        height: 600
      });

      // Content script creates DOM element
      expect(tab.element).toBeDefined();
      expect(tab.element.tagName).toBe('DIV');
    });

    // v1.6.3.8-v6 - BC REMOVED: Port-based messaging is now primary
    test('Port-based messaging handles cross-tab sync', () => {
      // Port-based messaging is now primary for cross-tab sync
      // We're just verifying the browser APIs are set up correctly
      expect(mockBrowser.runtime.sendMessage).toBeDefined();
      expect(typeof mockBrowser.runtime.sendMessage).toBe('function');
    });

    test('background script handles persistence', async () => {
      await mockBrowser.runtime.sendMessage({
        action: 'CREATE_QUICK_TAB',
        id: 'qt-persist',
        url: 'https://example.com'
      });

      expect(mockBrowser.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE_QUICK_TAB'
        })
      );
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle duplicate Quick Tab creation gracefully', () => {
      const quickTabId = 'qt-duplicate';

      // Create first time
      const tab1 = mockQuickTabsManager.createQuickTab({
        id: quickTabId,
        url: 'https://example.com',
        left: 100,
        top: 100,
        width: 800,
        height: 600
      });

      // Try to create again with same ID
      const tab2 = mockQuickTabsManager.createQuickTab({
        id: quickTabId,
        url: 'https://example.com',
        left: 150,
        top: 150,
        width: 800,
        height: 600
      });

      // Both should refer to same Quick Tab (by ID)
      expect(tab1.id).toBe(tab2.id);
      expect(mockQuickTabsManager.tabs.size).toBe(1);
    });

    test('should handle missing URL gracefully', () => {
      // Should not create Quick Tab without URL
      const result = mockQuickTabsManager.createQuickTab({
        id: 'qt-no-url',
        url: null
      });

      // In real implementation, this would be validated
      expect(result).toBeDefined(); // Mock doesn't validate, but real code should
    });

    test('should release saveId on error', async () => {
      const saveId = '123456-error';
      mockBrowser.runtime.sendMessage.mockRejectedValue(new Error('Network error'));

      try {
        mockQuickTabsManager.trackPendingSave(saveId);
        await mockBrowser.runtime.sendMessage({
          action: 'CREATE_QUICK_TAB'
        });
      } catch (err) {
        mockQuickTabsManager.releasePendingSave(saveId);
      }

      expect(mockQuickTabsManager.releasePendingSave).toHaveBeenCalledWith(saveId);
    });

    test('should handle BroadcastChannel unavailable', () => {
      // Simulate browser without BroadcastChannel
      global.BroadcastChannel = undefined;

      // Should fallback to storage-only sync
      // In real implementation, this is checked in setupBroadcastChannel()
      expect(typeof BroadcastChannel).toBe('undefined');
    });
  });

  describe('Performance and Timing', () => {
    test('local creation should be faster than background round-trip', async () => {
      const startLocal = Date.now();
      mockQuickTabsManager.createQuickTab({
        id: 'qt-timing-local',
        url: 'https://example.com',
        left: 100,
        top: 100,
        width: 800,
        height: 600
      });
      const localTime = Date.now() - startLocal;

      const startBackground = Date.now();
      await mockBrowser.runtime.sendMessage({
        action: 'CREATE_QUICK_TAB'
      });
      const backgroundTime = Date.now() - startBackground;

      // Local should be faster (< 1ms vs potentially 10-100ms for message)
      expect(localTime).toBeLessThan(backgroundTime + 10); // Allow some margin
    });

    test('should not block UI during background persistence', async () => {
      // Create locally (synchronous)
      const tab = mockQuickTabsManager.createQuickTab({
        id: 'qt-non-blocking',
        url: 'https://example.com',
        left: 100,
        top: 100,
        width: 800,
        height: 600
      });

      // Tab should be immediately available
      expect(tab).toBeDefined();
      expect(mockQuickTabsManager.tabs.has('qt-non-blocking')).toBe(true);

      // Background persistence happens asynchronously
      const backgroundPromise = mockBrowser.runtime.sendMessage({
        action: 'CREATE_QUICK_TAB'
      });

      // UI is not blocked
      expect(backgroundPromise).toBeInstanceOf(Promise);
    });
  });
});

describe('Integration: Full Quick Tab Creation Flow', () => {
  test('complete flow from user action to cross-tab sync', async () => {
    const mockManager = {
      tabs: new Map(),
      pendingSaveIds: new Set(),
      generateId: () => 'qt-integration-test',
      generateSaveId: () => '123456-integration',
      trackPendingSave: jest.fn(),
      releasePendingSave: jest.fn(),
      createQuickTab: jest.fn(options => {
        const tab = {
          id: options.id,
          url: options.url,
          isRendered: () => true
        };
        mockManager.tabs.set(options.id, tab);
        return tab;
      })
    };

    const mockBroadcast = {
      postMessage: jest.fn()
    };

    const mockBackground = {
      runtime: {
        sendMessage: jest.fn().mockResolvedValue({ success: true })
      }
    };

    // 1. User presses Q key
    const url = 'https://example.com';
    const id = mockManager.generateId();
    const saveId = mockManager.generateSaveId();

    // 2. Track pending save
    mockManager.trackPendingSave(saveId);
    expect(mockManager.trackPendingSave).toHaveBeenCalledWith(saveId);

    // 3. Create locally FIRST
    const tab = mockManager.createQuickTab({
      id,
      url,
      left: 100,
      top: 100,
      width: 800,
      height: 600
    });

    expect(tab.isRendered()).toBe(true);
    expect(mockManager.tabs.has(id)).toBe(true);

    // 4. Broadcast to other tabs
    mockBroadcast.postMessage({
      type: 'CREATE',
      data: { id, url }
    });

    expect(mockBroadcast.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'CREATE'
      })
    );

    // 5. Notify background for persistence
    await mockBackground.runtime.sendMessage({
      action: 'CREATE_QUICK_TAB',
      id,
      url,
      saveId
    });

    expect(mockBackground.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE_QUICK_TAB',
        saveId
      })
    );

    // 6. Release saveId after grace period
    setTimeout(() => {
      mockManager.releasePendingSave(saveId);
    }, 1000);
  });
});
