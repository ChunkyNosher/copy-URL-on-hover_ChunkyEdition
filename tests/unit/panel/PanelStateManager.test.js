/**
 * Unit tests for PanelStateManager
 * Part of Phase 2.10 - Panel component extraction
 */

import { PanelStateManager } from '../../../src/features/quick-tabs/panel/PanelStateManager.js';

// Mock browser API
global.browser = {
  tabs: {
    query: jest.fn()
  },
  runtime: {
    sendMessage: jest.fn()
  },
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn()
    }
  }
};

// Mock BroadcastChannel
const mockBroadcastChannel = {
  postMessage: jest.fn(),
  close: jest.fn(),
  onmessage: null
};
global.BroadcastChannel = jest.fn(() => mockBroadcastChannel);

describe('PanelStateManager', () => {
  let manager;
  let mockCallbacks;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset BroadcastChannel mock
    mockBroadcastChannel.postMessage = jest.fn();
    mockBroadcastChannel.close = jest.fn();
    mockBroadcastChannel.onmessage = null;

    // Reset global.BroadcastChannel
    global.BroadcastChannel = jest.fn(() => mockBroadcastChannel);

    mockCallbacks = {
      onStateLoaded: jest.fn(),
      onBroadcastReceived: jest.fn()
    };

    // Default mock implementations
    browser.tabs.query.mockResolvedValue([{ cookieStoreId: 'firefox-container-1' }]);
    browser.runtime.sendMessage.mockResolvedValue({ success: true, cookieStoreId: 'firefox-container-1' });
    browser.storage.local.get.mockResolvedValue({
      quick_tabs_panel_state: { left: 200, top: 200, width: 400, height: 600, isOpen: false }
    });
    browser.storage.local.set.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (manager) {
      // Manually cleanup broadcastChannel if it exists
      if (manager.broadcastChannel) {
        manager.broadcastChannel = null;
      }
      manager.broadcastDebounce.clear();
    }
    delete global.BroadcastChannel;
  });

  describe('Construction', () => {
    test('should create manager with callbacks', () => {
      manager = new PanelStateManager(mockCallbacks);

      expect(manager.callbacks).toBe(mockCallbacks);
      expect(manager.currentContainerId).toBe('firefox-default');
      expect(manager.panelState).toEqual({
        left: 100,
        top: 100,
        width: 350,
        height: 500,
        isOpen: false
      });
    });

    test('should work with empty callbacks', () => {
      expect(() => {
        manager = new PanelStateManager({});
      }).not.toThrow();
    });
  });

  describe('Container Detection', () => {
    test('should detect container context from background', async () => {
      manager = new PanelStateManager(mockCallbacks);
      browser.runtime.sendMessage.mockResolvedValue({
        success: true,
        cookieStoreId: 'firefox-container-1'
      });

      const containerId = await manager.detectContainerContext();

      expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'GET_CONTAINER_CONTEXT'
      });
      expect(containerId).toBe('firefox-container-1');
      expect(manager.currentContainerId).toBe('firefox-container-1');
    });

    test('should use default container if no cookieStoreId', async () => {
      browser.runtime.sendMessage.mockResolvedValue({ success: false }); // No cookieStoreId
      manager = new PanelStateManager(mockCallbacks);

      const containerId = await manager.detectContainerContext();

      expect(containerId).toBe('firefox-default');
      expect(manager.currentContainerId).toBe('firefox-default');
    });

    test('should use default container if message fails', async () => {
      browser.runtime.sendMessage.mockRejectedValue(new Error('API error'));
      manager = new PanelStateManager(mockCallbacks);

      const containerId = await manager.detectContainerContext();

      expect(containerId).toBe('firefox-default');
      expect(manager.currentContainerId).toBe('firefox-default');
    });

    test('should use default container if browser runtime not available', async () => {
      const originalRuntime = browser.runtime;
      delete browser.runtime;

      manager = new PanelStateManager(mockCallbacks);

      const containerId = await manager.detectContainerContext();

      expect(containerId).toBe('firefox-default');

      browser.runtime = originalRuntime;
    });
  });

  describe('BroadcastChannel Setup', () => {
    test('should create BroadcastChannel', () => {
      manager = new PanelStateManager(mockCallbacks);
      manager.setupBroadcastChannel();

      expect(BroadcastChannel).toHaveBeenCalledWith('quick-tabs-panel-sync');
      expect(manager.broadcastChannel).toBeTruthy();
    });

    test('should handle BroadcastChannel not available', () => {
      const originalBC = global.BroadcastChannel;
      delete global.BroadcastChannel;

      manager = new PanelStateManager(mockCallbacks);
      manager.setupBroadcastChannel();

      expect(manager.broadcastChannel).toBeNull();

      global.BroadcastChannel = originalBC;
    });
  });

  describe('State Loading', () => {
    test('should load state from storage', async () => {
      manager = new PanelStateManager(mockCallbacks);

      await manager.loadPanelState();

      expect(browser.storage.local.get).toHaveBeenCalledWith('quick_tabs_panel_state');
      expect(manager.panelState).toEqual({
        left: 200,
        top: 200,
        width: 400,
        height: 600,
        isOpen: false
      });
    });

    test('should call onStateLoaded callback', async () => {
      manager = new PanelStateManager(mockCallbacks);

      await manager.loadPanelState();

      expect(mockCallbacks.onStateLoaded).toHaveBeenCalledWith({
        left: 200,
        top: 200,
        width: 400,
        height: 600,
        isOpen: false
      });
    });

    test('should use defaults if storage is empty', async () => {
      browser.storage.local.get.mockResolvedValue({});
      manager = new PanelStateManager(mockCallbacks);

      await manager.loadPanelState();

      expect(manager.panelState).toEqual({
        left: 100,
        top: 100,
        width: 350,
        height: 500,
        isOpen: false
      });
    });

    test('should handle storage load error', async () => {
      browser.storage.local.get.mockRejectedValue(new Error('Storage error'));
      manager = new PanelStateManager(mockCallbacks);

      await expect(manager.loadPanelState()).resolves.toBeDefined();
    });
  });

  describe('State Saving', () => {
    test('should save state to storage', async () => {
      manager = new PanelStateManager(mockCallbacks);

      const mockPanel = {
        getBoundingClientRect: jest.fn(() => ({
          left: 150,
          top: 150,
          width: 300,
          height: 400
        }))
      };

      await manager.savePanelState(mockPanel);

      expect(browser.storage.local.set).toHaveBeenCalledWith({
        quick_tabs_panel_state: {
          left: 150,
          top: 150,
          width: 300,
          height: 400,
          isOpen: false
        }
      });
    });

    test('should not save if panel is null', async () => {
      manager = new PanelStateManager(mockCallbacks);

      await manager.savePanelState(null);

      expect(browser.storage.local.set).not.toHaveBeenCalled();
    });

    test('should handle storage save error', async () => {
      browser.storage.local.set.mockRejectedValue(new Error('Storage error'));
      manager = new PanelStateManager(mockCallbacks);

      const mockPanel = {
        getBoundingClientRect: jest.fn(() => ({
          left: 150,
          top: 150,
          width: 300,
          height: 400
        }))
      };

      await expect(manager.savePanelState(mockPanel)).resolves.toBeUndefined();
    });
  });

  describe('Local State Update (v1.5.9.8)', () => {
    test('should update state locally without storage write', () => {
      manager = new PanelStateManager(mockCallbacks);

      const mockPanel = {
        getBoundingClientRect: jest.fn(() => ({
          left: 250,
          top: 250,
          width: 500,
          height: 700
        }))
      };

      manager.savePanelStateLocal(mockPanel);

      expect(manager.panelState).toEqual({
        left: 250,
        top: 250,
        width: 500,
        height: 700,
        isOpen: false
      });
      expect(browser.storage.local.set).not.toHaveBeenCalled();
    });

    test('should not update if panel is null', () => {
      manager = new PanelStateManager(mockCallbacks);
      const originalState = { ...manager.panelState };

      manager.savePanelStateLocal(null);

      expect(manager.panelState).toEqual(originalState);
    });
  });

  describe('Broadcasting', () => {
    test('should broadcast message', () => {
      manager = new PanelStateManager(mockCallbacks);
      manager.setupBroadcastChannel();

      const postMessageSpy = manager.broadcastChannel.postMessage;
      manager.broadcast('PANEL_OPENED', { timestamp: Date.now() });

      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'PANEL_OPENED',
          data: expect.any(Object),
          timestamp: expect.any(Number)
        })
      );
    });

    test('should not broadcast if channel not setup', () => {
      manager = new PanelStateManager(mockCallbacks);

      manager.broadcast('PANEL_OPENED', {});

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('Broadcast Message Handling', () => {
    test('should handle broadcast message via callback', () => {
      manager = new PanelStateManager(mockCallbacks);
      manager.setupBroadcastChannel();

      const testData = { left: 100, top: 100 };
      manager.broadcastChannel.onmessage({
        data: { type: 'PANEL_POSITION_UPDATED', data: testData }
      });

      expect(mockCallbacks.onBroadcastReceived).toHaveBeenCalledWith(
        'PANEL_POSITION_UPDATED',
        testData
      );
    });

    test('should debounce rapid broadcast messages', () => {
      manager = new PanelStateManager(mockCallbacks);
      manager.setupBroadcastChannel();

      const testData = { width: 400, height: 500 };

      // Send same message twice within debounce window
      manager.broadcastChannel.onmessage({
        data: { type: 'PANEL_SIZE_UPDATED', data: testData }
      });
      manager.broadcastChannel.onmessage({
        data: { type: 'PANEL_SIZE_UPDATED', data: testData }
      });

      // Should only process once
      expect(mockCallbacks.onBroadcastReceived).toHaveBeenCalledTimes(1);
    });

    test('should process message after debounce window', done => {
      manager = new PanelStateManager(mockCallbacks);
      manager.setupBroadcastChannel();

      const testData = { width: 400, height: 500 };

      manager.broadcastChannel.onmessage({
        data: { type: 'PANEL_SIZE_UPDATED', data: testData }
      });

      // Wait for debounce window to expire
      setTimeout(() => {
        manager.broadcastChannel.onmessage({
          data: { type: 'PANEL_SIZE_UPDATED', data: testData }
        });

        expect(mockCallbacks.onBroadcastReceived).toHaveBeenCalledTimes(2);
        done();
      }, 60); // > BROADCAST_DEBOUNCE_MS (50ms)
    });
  });

  describe('State Accessors', () => {
    test('should set isOpen state', () => {
      manager = new PanelStateManager(mockCallbacks);

      manager.setIsOpen(true);

      expect(manager.panelState.isOpen).toBe(true);
    });

    test('should get current state', () => {
      manager = new PanelStateManager(mockCallbacks);
      manager.panelState = { left: 300, top: 300, width: 600, height: 800, isOpen: true };

      const state = manager.getState();

      expect(state).toEqual({ left: 300, top: 300, width: 600, height: 800, isOpen: true });
      expect(state).not.toBe(manager.panelState); // Should be a copy
    });
  });

  describe('Initialization', () => {
    test('should initialize all components', async () => {
      manager = new PanelStateManager(mockCallbacks);

      await manager.init();

      expect(browser.runtime.sendMessage).toHaveBeenCalled();
      expect(BroadcastChannel).toHaveBeenCalled();
      expect(browser.storage.local.get).toHaveBeenCalled();
    });
  });

  describe('Cleanup', () => {
    test('should close broadcast channel on destroy', () => {
      manager = new PanelStateManager(mockCallbacks);
      manager.setupBroadcastChannel();

      const closeSpy = manager.broadcastChannel.close;
      manager.destroy();

      expect(closeSpy).toHaveBeenCalled();
      expect(manager.broadcastChannel).toBeNull();
    });

    test('should clear debounce map on destroy', () => {
      manager = new PanelStateManager(mockCallbacks);
      manager.broadcastDebounce.set('TEST', Date.now());

      manager.destroy();

      expect(manager.broadcastDebounce.size).toBe(0);
    });
  });
});
