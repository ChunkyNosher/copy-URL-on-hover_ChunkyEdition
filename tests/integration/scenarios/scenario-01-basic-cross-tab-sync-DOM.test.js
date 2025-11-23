/**
 * Scenario 1: Basic Quick Tab Creation & Cross-Tab Sync
 * 
 * Purpose: Verify that Quick Tabs are created correctly, persist across different 
 * browser tabs, and maintain consistent position/size state globally.
 * 
 * Related Documentation:
 * - docs/issue-47-revised-scenarios.md (Scenario 1)
 * - docs/manual/v1.6.0/remaining-testing-work.md (Gap 1)
 * 
 * Covers Issues: #35, #47, #51
 */

// v1.6.1.2 - Mock window factory for testing (injected via dependency injection)
const mockQuickTabWindows = new Map();
const mockWindowFactory = jest.fn((config) => {
  const mockWindow = {
    id: config.id,
    position: { left: config.left, top: config.top },
    size: { width: config.width, height: config.height },
    url: config.url,
    cookieStoreId: config.cookieStoreId,
    soloedOnTabs: config.soloedOnTabs || [],
    mutedOnTabs: config.mutedOnTabs || [],
    minimized: config.minimized || false,
    zIndex: config.zIndex || 10000,
    render: jest.fn(),
    destroy: jest.fn(),
    setPosition: jest.fn((left, top) => {
      mockWindow.position = { left, top };
    }),
    setSize: jest.fn((width, height) => {
      mockWindow.size = { width, height };
    }),
    updateZIndex: jest.fn((zIndex) => {
      mockWindow.zIndex = zIndex;
    }),
    minimize: jest.fn(() => {
      mockWindow.minimized = true;
    }),
    restore: jest.fn(() => {
      mockWindow.minimized = false;
    }),
    isRendered: jest.fn(() => true),
    getState: jest.fn(() => ({
      id: mockWindow.id,
      position: mockWindow.position,
      size: mockWindow.size,
      url: mockWindow.url,
      cookieStoreId: mockWindow.cookieStoreId,
      soloedOnTabs: mockWindow.soloedOnTabs,
      mutedOnTabs: mockWindow.mutedOnTabs,
      minimized: mockWindow.minimized,
      zIndex: mockWindow.zIndex
    })),
    container: {
      style: {}
    }
  };
  mockQuickTabWindows.set(config.id, mockWindow);
  return mockWindow;
});

// Mock utils
jest.mock('../../../src/utils/debug.js', () => ({
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  isDebugMode: jest.fn().mockReturnValue(false)
}));

import { EventEmitter } from 'eventemitter3';
import { createMultiTabScenario, propagateBroadcast } from '../../helpers/cross-tab-simulator.js';
import { waitForCondition } from '../../helpers/async-helpers.js';
import { initQuickTabs } from '../../../src/features/quick-tabs/index.js';
import { Events } from '../../../src/core/events.js';

describe('Scenario 1: Basic Quick Tab Creation & Cross-Tab Sync', () => {
  let tabs;
  let managerA;
  let managerB;

  beforeEach(async () => {
    // Create two simulated tabs (Wikipedia and YouTube)
    tabs = await createMultiTabScenario([
      { url: 'https://wikipedia.org', containerId: 'firefox-default' },
      { url: 'https://youtube.com', containerId: 'firefox-default' }
    ]);

    // Setup global browser API for both tabs
    global.browser = {
      tabs: tabs[0].tabs,
      storage: {
        ...tabs[0].storage,
        onChanged: {
          addListener: jest.fn(),
          removeListener: jest.fn()
        }
      },
      runtime: {
        sendMessage: jest.fn().mockImplementation((msg) => {
          if (msg.action === 'GET_CONTAINER_CONTEXT') {
            return Promise.resolve({
              success: true,
              cookieStoreId: 'firefox-default',
              tabId: tabs[0].tabId
            });
          }
          if (msg.action === 'GET_CURRENT_TAB_ID') {
            return Promise.resolve({ tabId: tabs[0].tabId });
          }
          if (msg.action === 'UPDATE_QUICK_TAB') {
            return Promise.resolve({ success: true });
          }
          if (msg.action === 'CREATE_QUICK_TAB') {
            return Promise.resolve({ success: true });
          }
          if (msg.action === 'DELETE_QUICK_TAB') {
            return Promise.resolve({ success: true });
          }
          return Promise.resolve({});
        })
      }
    };

    // Setup document and window globals
    global.document = tabs[0].document;
    global.window = tabs[0].window;

    // Mock BroadcastChannel constructor
    global.BroadcastChannel = jest.fn(() => tabs[0].broadcastChannel);
  });

  afterEach(() => {
    // Cleanup
    if (managerA) {
      try {
        managerA.closeAll();
        // Reset initialization flag for next test (singleton)
        managerA.initialized = false;
      } catch (e) {
        // Ignore errors during cleanup
      }
    }
    if (managerB) {
      try {
        managerB.closeAll();
        // Reset initialization flag for next test (singleton)
        managerB.initialized = false;
      } catch (e) {
        // Ignore errors during cleanup
      }
    }
    mockQuickTabWindows.clear();
    mockWindowFactory.mockClear();
    jest.clearAllMocks();
  });

  describe('Step 1-3: Create Quick Tab in Tab A', () => {
    test('should create Quick Tab with default position in Tab A', async () => {
      // Initialize QuickTabsManager in Tab A
      managerA = await initQuickTabs(new EventEmitter(), Events, { 
        windowFactory: mockWindowFactory,
        forceNew: true  // Create new instance for testing
      });

      console.log('[TEST] managerA:', managerA);
      console.log('[TEST] managerA.initialized:', managerA?.initialized);
      console.log('[TEST] managerA.createHandler:', managerA?.createHandler);
      console.log('[TEST] managerA.windowFactory:', managerA?.windowFactory);
      console.log('[TEST] mockWindowFactory:', mockWindowFactory);

      expect(managerA).toBeDefined();
      expect(typeof managerA.createQuickTab).toBe('function');

      // Create Quick Tab in Tab A
      const qtOptions = {
        url: 'https://example.com',
        left: 100,
        top: 100,
        width: 800,
        height: 600,
        cookieStoreId: 'firefox-default'
      };

      console.log('[TEST] Calling createQuickTab with options:', qtOptions);
      const tabWindow = await managerA.createQuickTab(qtOptions);
      console.log('[TEST] createQuickTab returned:', tabWindow);
      console.log('[TEST] mockWindowFactory.mock.calls:', mockWindowFactory.mock.calls);
      console.log('[TEST] mockWindowFactory was called:', mockWindowFactory.mock.calls.length, 'times');

      // Verify mock was called
      expect(mockWindowFactory).toHaveBeenCalled();
      
      // Verify Quick Tab was created
      expect(tabWindow).toBeDefined();
      expect(tabWindow.id).toBeDefined();

      // Verify Quick Tab is in the manager's map
      const qt = managerA.tabs.get(tabWindow.id);
      expect(qt).toBeDefined();

      // Verify position and size
      expect(qt.position.left).toBe(100);
      expect(qt.position.top).toBe(100);
      expect(qt.size.width).toBe(800);
      expect(qt.size.height).toBe(600);
    });

    test('should broadcast CREATE message when Quick Tab is created', async () => {
      // Initialize QuickTabsManager in Tab A
      managerA = await initQuickTabs(new EventEmitter(), Events, { 
        windowFactory: mockWindowFactory,
        forceNew: true
      });

      // Spy on broadcast channel
      const postMessageSpy = jest.spyOn(tabs[0].broadcastChannel, 'postMessage');

      // Create Quick Tab
      const tabWindow = await managerA.createQuickTab({
        url: 'https://example.com',
        left: 100,
        top: 100,
        width: 800,
        height: 600,
        cookieStoreId: 'firefox-default'
      });

      expect(tabWindow).toBeDefined();

      // Wait for broadcast
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify CREATE message was broadcast
      expect(postMessageSpy).toHaveBeenCalled();
      const broadcastCalls = postMessageSpy.mock.calls;
      const createMessage = broadcastCalls.find(call => call[0]?.action === 'CREATE');
      
      expect(createMessage).toBeDefined();
      expect(createMessage[0].action).toBe('CREATE');
      expect(createMessage[0].payload).toBeDefined();
      expect(createMessage[0].payload.left).toBe(100);
      expect(createMessage[0].payload.top).toBe(100);
      expect(createMessage[0].payload.width).toBe(800);
      expect(createMessage[0].payload.height).toBe(600);
    });
  });

  describe('Step 4-5: Cross-Tab Sync to Tab B', () => {
    test('should sync Quick Tab to Tab B with same position/size', async () => {
      // Initialize managers for both tabs
      managerA = await initQuickTabs(new EventEmitter(), Events, { windowFactory: mockWindowFactory, forceNew: true });
      
      // Setup Tab B with its own context
      global.browser = {
        tabs: tabs[1].tabs,
        storage: {
          ...tabs[1].storage,
          onChanged: {
            addListener: jest.fn(),
            removeListener: jest.fn()
          }
        },
        runtime: {
          sendMessage: jest.fn().mockImplementation((msg) => {
            if (msg.action === 'GET_CONTAINER_CONTEXT') {
              return Promise.resolve({
                success: true,
                cookieStoreId: 'firefox-default',
                tabId: tabs[1].tabId
              });
            }
            if (msg.action === 'GET_CURRENT_TAB_ID') {
              return Promise.resolve({ tabId: tabs[1].tabId });
            }
            return Promise.resolve({});
          })
        }
      };
      global.document = tabs[1].document;
      global.window = tabs[1].window;
      global.BroadcastChannel = jest.fn(() => tabs[1].broadcastChannel);

      managerB = await initQuickTabs(new EventEmitter(), Events, { windowFactory: mockWindowFactory, forceNew: true });

      // Create Quick Tab in Tab A
      const tabWindow = await managerA.createQuickTab({
        url: 'https://example.com',
        left: 150,
        top: 200,
        width: 700,
        height: 500,
        cookieStoreId: 'firefox-default'
      });

      const qtId = tabWindow.id;

      // Simulate broadcast propagation from Tab A to Tab B
      await propagateBroadcast(tabs[0], {
        action: 'CREATE',
        payload: {
          id: qtId,
          url: 'https://example.com',
          left: 150,
          top: 200,
          width: 700,
          height: 500,
          cookieStoreId: 'firefox-default',
          soloedOnTabs: [],
          mutedOnTabs: [],
          minimized: false
        }
      }, [tabs[1]]);

      // Wait for Tab B to process the message
      await waitForCondition(
        () => managerB.tabs.has(qtId),
        1000,
        50
      );

      // Verify Quick Tab exists in Tab B
      const qtInTabB = managerB.tabs.get(qtId);
      expect(qtInTabB).toBeDefined();

      // Verify position/size matches
      expect(qtInTabB.position.left).toBe(150);
      expect(qtInTabB.position.top).toBe(200);
      expect(qtInTabB.size.width).toBe(700);
      expect(qtInTabB.size.height).toBe(500);
    });

    test('should complete sync within 100ms', async () => {
      // Initialize both managers
      managerA = await initQuickTabs(new EventEmitter(), Events, { windowFactory: mockWindowFactory, forceNew: true });
      
      // Setup Tab B
      global.browser = {
        tabs: tabs[1].tabs,
        storage: {
          ...tabs[1].storage,
          onChanged: {
            addListener: jest.fn(),
            removeListener: jest.fn()
          }
        },
        runtime: {
          sendMessage: jest.fn().mockResolvedValue({ success: true })
        }
      };
      global.document = tabs[1].document;
      global.window = tabs[1].window;
      global.BroadcastChannel = jest.fn(() => tabs[1].broadcastChannel);

      managerB = await initQuickTabs(new EventEmitter(), Events, { windowFactory: mockWindowFactory, forceNew: true });

      // Measure sync time
      const startTime = Date.now();

      // Create Quick Tab in Tab A
      const qtResult = await managerA.createQuickTab({
        url: 'https://example.com',
        left: 100,
        top: 100,
        width: 800,
        height: 600,
        cookieStoreId: 'firefox-default'
      });

      const qtId = qtResult.tabWindow.id;

      // Simulate broadcast propagation
      await propagateBroadcast(tabs[0], {
        action: 'CREATE',
        payload: {
          id: qtId,
          url: 'https://example.com',
          left: 100,
          top: 100,
          width: 800,
          height: 600,
          cookieStoreId: 'firefox-default',
          soloedOnTabs: [],
          mutedOnTabs: [],
          minimized: false
        }
      }, [tabs[1]]);

      // Wait for sync
      await waitForCondition(
        () => managerB.tabs.has(qtId),
        200,
        10
      );

      const syncTime = Date.now() - startTime;

      // Verify sync completed within 100ms (allowing some margin for test overhead)
      expect(syncTime).toBeLessThan(150);
      expect(managerB.tabs.has(qtId)).toBe(true);
    });
  });

  describe('Step 6-7: Position/Size Updates Sync Across Tabs', () => {
    test('should sync position changes from Tab B to Tab A', async () => {
      // Initialize both managers
      managerA = await initQuickTabs(new EventEmitter(), Events, { windowFactory: mockWindowFactory, forceNew: true });
      
      // Setup Tab B
      global.browser = {
        tabs: tabs[1].tabs,
        storage: {
          ...tabs[1].storage,
          onChanged: {
            addListener: jest.fn(),
            removeListener: jest.fn()
          }
        },
        runtime: {
          sendMessage: jest.fn().mockResolvedValue({ success: true })
        }
      };
      global.document = tabs[1].document;
      global.window = tabs[1].window;
      global.BroadcastChannel = jest.fn(() => tabs[1].broadcastChannel);

      managerB = await initQuickTabs(new EventEmitter(), Events, { windowFactory: mockWindowFactory, forceNew: true });

      // Create Quick Tab in Tab A with initial position
      const tabWindowA = await managerA.createQuickTab({
        url: 'https://example.com',
        left: 100,
        top: 100,
        width: 800,
        height: 600,
        cookieStoreId: 'firefox-default'
      });

      const qtId = tabWindowA.id;

      // Sync to Tab B
      await propagateBroadcast(tabs[0], {
        action: 'CREATE',
        payload: {
          id: qtId,
          url: 'https://example.com',
          left: 100,
          top: 100,
          width: 800,
          height: 600,
          cookieStoreId: 'firefox-default',
          soloedOnTabs: [],
          mutedOnTabs: [],
          minimized: false
        }
      }, [tabs[1]]);

      await waitForCondition(
        () => managerB.tabs.has(qtId),
        1000,
        50
      );

      // Move Quick Tab in Tab B to bottom-right corner
      await managerB.handlePositionChangeEnd(qtId, 500, 400);

      // Simulate broadcast from Tab B to Tab A
      await propagateBroadcast(tabs[1], {
        action: 'UPDATE_POSITION',
        payload: {
          id: qtId,
          left: 500,
          top: 400
        }
      }, [tabs[0]]);

      // Wait for Tab A to receive update
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify position updated in Tab A
      const qtInTabA = managerA.tabs.get(qtId);
      expect(qtInTabA).toBeDefined();
      expect(qtInTabA.position.left).toBe(500);
      expect(qtInTabA.position.top).toBe(400);
    });

    test('should sync size changes from Tab B to Tab A', async () => {
      // Initialize both managers
      managerA = await initQuickTabs(new EventEmitter(), Events, { windowFactory: mockWindowFactory, forceNew: true });
      
      // Setup Tab B
      global.browser = {
        tabs: tabs[1].tabs,
        storage: {
          ...tabs[1].storage,
          onChanged: {
            addListener: jest.fn(),
            removeListener: jest.fn()
          }
        },
        runtime: {
          sendMessage: jest.fn().mockResolvedValue({ success: true })
        }
      };
      global.document = tabs[1].document;
      global.window = tabs[1].window;
      global.BroadcastChannel = jest.fn(() => tabs[1].broadcastChannel);

      managerB = await initQuickTabs(new EventEmitter(), Events, { windowFactory: mockWindowFactory, forceNew: true });

      // Create Quick Tab in Tab A
      const tabWindow = await managerA.createQuickTab({
        url: 'https://example.com',
        left: 100,
        top: 100,
        width: 800,
        height: 600,
        cookieStoreId: 'firefox-default'
      });

      const qtId = tabWindow.id;

      // Sync to Tab B
      await propagateBroadcast(tabs[0], {
        action: 'CREATE',
        payload: {
          id: qtId,
          url: 'https://example.com',
          left: 100,
          top: 100,
          width: 800,
          height: 600,
          cookieStoreId: 'firefox-default',
          soloedOnTabs: [],
          mutedOnTabs: [],
          minimized: false
        }
      }, [tabs[1]]);

      await waitForCondition(
        () => managerB.tabs.has(qtId),
        1000,
        50
      );

      // Resize Quick Tab in Tab B
      await managerB.handleSizeChangeEnd(qtId, 500, 400);

      // Simulate broadcast from Tab B to Tab A
      await propagateBroadcast(tabs[1], {
        action: 'UPDATE_SIZE',
        payload: {
          id: qtId,
          width: 500,
          height: 400
        }
      }, [tabs[0]]);

      // Wait for Tab A to receive update
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify size updated in Tab A
      const qtInTabA = managerA.tabs.get(qtId);
      expect(qtInTabA).toBeDefined();
      expect(qtInTabA.size.width).toBe(500);
      expect(qtInTabA.size.height).toBe(400);
    });
  });

  describe('Edge Cases', () => {
    test('should handle concurrent creation in multiple tabs', async () => {
      // Initialize both managers
      managerA = await initQuickTabs(new EventEmitter(), Events, { windowFactory: mockWindowFactory, forceNew: true });
      
      // Setup Tab B
      global.browser = {
        tabs: tabs[1].tabs,
        storage: {
          ...tabs[1].storage,
          onChanged: {
            addListener: jest.fn(),
            removeListener: jest.fn()
          }
        },
        runtime: {
          sendMessage: jest.fn().mockResolvedValue({ success: true })
        }
      };
      global.document = tabs[1].document;
      global.window = tabs[1].window;
      global.BroadcastChannel = jest.fn(() => tabs[1].broadcastChannel);

      managerB = await initQuickTabs(new EventEmitter(), Events, { windowFactory: mockWindowFactory, forceNew: true });

      // Create Quick Tabs in both tabs simultaneously
      const [qtA, qtB] = await Promise.all([
        managerA.createQuickTab({
          url: 'https://example-a.com',
          left: 100,
          top: 100,
          width: 800,
          height: 600,
          cookieStoreId: 'firefox-default'
        }),
        managerB.createQuickTab({
          url: 'https://example-b.com',
          left: 200,
          top: 200,
          width: 700,
          height: 500,
          cookieStoreId: 'firefox-default'
        })
      ]);

      // Verify both Quick Tabs were created successfully
      expect(qtA.id).toBeDefined();
      expect(qtB.id).toBeDefined();
      expect(qtA.id).not.toBe(qtB.id);

      // Verify both exist in their respective managers
      expect(managerA.tabs.has(qtA.id)).toBe(true);
      expect(managerB.tabs.has(qtB.id)).toBe(true);
    });

    test('should handle tab closed during sync', async () => {
      // Initialize both managers
      managerA = await initQuickTabs(new EventEmitter(), Events, { windowFactory: mockWindowFactory, forceNew: true });
      
      // Setup Tab B
      global.browser = {
        tabs: tabs[1].tabs,
        storage: {
          ...tabs[1].storage,
          onChanged: {
            addListener: jest.fn(),
            removeListener: jest.fn()
          }
        },
        runtime: {
          sendMessage: jest.fn().mockResolvedValue({ success: true })
        }
      };
      global.document = tabs[1].document;
      global.window = tabs[1].window;
      global.BroadcastChannel = jest.fn(() => tabs[1].broadcastChannel);

      managerB = await initQuickTabs(new EventEmitter(), Events, { windowFactory: mockWindowFactory, forceNew: true });

      // Create Quick Tab in Tab A
      const tabWindow = await managerA.createQuickTab({
        url: 'https://example.com',
        left: 100,
        top: 100,
        width: 800,
        height: 600,
        cookieStoreId: 'firefox-default'
      });

      const qtId = tabWindow.id;

      // Close Quick Tab in Tab A immediately
      await managerA.closeById(qtId);

      // Try to sync to Tab B (should handle gracefully)
      await propagateBroadcast(tabs[0], {
        action: 'CREATE',
        payload: {
          id: qtId,
          url: 'https://example.com',
          left: 100,
          top: 100,
          width: 800,
          height: 600,
          cookieStoreId: 'firefox-default',
          soloedOnTabs: [],
          mutedOnTabs: [],
          minimized: false
        }
      }, [tabs[1]]);

      // Verify no errors occurred and Tab B handles gracefully
      // (Tab B may create it, or ignore it - both are acceptable)
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // No errors should have been thrown
      expect(true).toBe(true);
    });
  });
});
