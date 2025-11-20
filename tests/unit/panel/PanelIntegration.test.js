/**
 * Integration tests for PanelManager facade
 * Tests component delegation, lifecycle, and coordination
 *
 * Phase 7.2 - Priority 1
 * Target: 60%+ coverage on panel.js (408 lines, currently 0%)
 */

import { PanelContentManager } from '../../../src/features/quick-tabs/panel/PanelContentManager.js';
import { PanelDragController } from '../../../src/features/quick-tabs/panel/PanelDragController.js';
import { PanelResizeController } from '../../../src/features/quick-tabs/panel/PanelResizeController.js';
import { PanelStateManager } from '../../../src/features/quick-tabs/panel/PanelStateManager.js';
import { PanelUIBuilder } from '../../../src/features/quick-tabs/panel/PanelUIBuilder.js';
import { PanelManager } from '../../../src/features/quick-tabs/panel.js';

// Mock all components
jest.mock('../../../src/features/quick-tabs/panel/PanelUIBuilder.js');
jest.mock('../../../src/features/quick-tabs/panel/PanelDragController.js');
jest.mock('../../../src/features/quick-tabs/panel/PanelResizeController.js');
jest.mock('../../../src/features/quick-tabs/panel/PanelStateManager.js');
jest.mock('../../../src/features/quick-tabs/panel/PanelContentManager.js');
jest.mock('../../../src/utils/debug.js');

describe('PanelManager Integration', () => {
  let panelManager;
  let mockQuickTabsManager;
  let mockPanel;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock setInterval/clearInterval BEFORE creating instance
    jest.useFakeTimers();

    // Create mock panel element
    mockPanel = document.createElement('div');
    mockPanel.className = 'quick-tabs-manager-panel';
    mockPanel.style.display = 'none';
    const header = document.createElement('div');
    header.className = 'panel-header';
    mockPanel.appendChild(header);

    // Mock QuickTabsManager
    mockQuickTabsManager = {
      getState: jest.fn().mockReturnValue(new Map()),
      createQuickTab: jest.fn(),
      closeQuickTab: jest.fn(),
      minimizeQuickTab: jest.fn(),
      restoreQuickTab: jest.fn()
    };

    // Mock PanelUIBuilder - return actual mock instance
    const mockUIBuilder = {
      injectStyles: jest.fn(),
      createPanel: jest.fn().mockReturnValue(mockPanel),
      updateContainer: jest.fn(),
      updateContent: jest.fn()
    };
    PanelUIBuilder.mockImplementation(() => mockUIBuilder);

    // Mock PanelStateManager - return actual mock instance
    const mockStateManager = {
      init: jest.fn().mockResolvedValue(undefined),
      getState: jest.fn().mockReturnValue({
        left: 100,
        top: 100,
        width: 400,
        height: 600,
        isOpen: false
      }),
      savePanelState: jest.fn(),
      setIsOpen: jest.fn(),
      broadcast: jest.fn()
    };
    PanelStateManager.mockImplementation(() => mockStateManager);

    // Mock PanelDragController - return actual mock instance
    const mockDragController = {
      destroy: jest.fn()
    };
    PanelDragController.mockImplementation(() => mockDragController);

    // Mock PanelResizeController - return actual mock instance
    const mockResizeController = {
      destroy: jest.fn()
    };
    PanelResizeController.mockImplementation(() => mockResizeController);

    // Mock PanelContentManager - return actual mock instance
    const mockContentManager = {
      setOnClose: jest.fn(),
      setupEventListeners: jest.fn(),
      setIsOpen: jest.fn(),
      updateContent: jest.fn()
    };
    PanelContentManager.mockImplementation(() => mockContentManager);

    // Mock browser APIs
    global.browser = {
      tabs: {
        query: jest.fn().mockResolvedValue([{ cookieStoreId: 'firefox-container-1', active: true }])
      },
      runtime: {
        sendMessage: jest.fn().mockResolvedValue({ success: true, cookieStoreId: 'firefox-container-1' }),
        onMessage: {
          addListener: jest.fn()
        }
      }
    };

    // Mock document.body
    document.body.innerHTML = '';
    jest.spyOn(document.body, 'appendChild');

    // Create PanelManager instance
    panelManager = new PanelManager(mockQuickTabsManager);
  });

  afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('Constructor', () => {
    test('should initialize with quickTabsManager', () => {
      expect(panelManager.quickTabsManager).toBe(mockQuickTabsManager);
      expect(panelManager.panel).toBeNull();
      expect(panelManager.isOpen).toBe(false);
      expect(panelManager.currentContainerId).toBe('firefox-default');
    });

    test('should initialize component references', () => {
      expect(panelManager.uiBuilder).toBeDefined();
      expect(panelManager.dragController).toBeNull();
      expect(panelManager.resizeController).toBeNull();
      expect(panelManager.stateManager).toBeNull();
      expect(panelManager.contentManager).toBeNull();
    });

    test('should initialize updateInterval to null', () => {
      expect(panelManager.updateInterval).toBeNull();
    });
  });

  describe('Panel Lifecycle Management', () => {
    describe('init()', () => {
      test('should detect container context', async () => {
        await panelManager.init();

        expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
          action: 'GET_CONTAINER_CONTEXT'
        });
        expect(panelManager.currentContainerId).toBe('firefox-container-1');
      });

      test('should use default container if message fails', async () => {
        browser.runtime.sendMessage.mockRejectedValueOnce(new Error('Message failed'));

        await panelManager.init();

        expect(panelManager.currentContainerId).toBe('firefox-default');
      });

      test('should use default container if query fails', async () => {
        browser.runtime.sendMessage.mockResolvedValueOnce({ success: false });

        await panelManager.init();

        expect(panelManager.currentContainerId).toBe('firefox-default');
      });

      test('should use default container if no cookieStoreId', async () => {
        browser.runtime.sendMessage.mockResolvedValueOnce({ success: true });

        await panelManager.init();

        expect(panelManager.currentContainerId).toBe('firefox-default');
      });

      test('should initialize state manager', async () => {
        await panelManager.init();

        expect(PanelStateManager).toHaveBeenCalledWith(
          expect.objectContaining({
            onStateLoaded: expect.any(Function),
            onBroadcastReceived: expect.any(Function)
          })
        );
        expect(panelManager.stateManager.init).toHaveBeenCalled();
      });

      test('should inject CSS styles', async () => {
        await panelManager.init();

        expect(panelManager.uiBuilder.injectStyles).toHaveBeenCalled();
      });

      test('should create panel with saved state', async () => {
        const savedState = {
          left: 200,
          top: 150,
          width: 500,
          height: 700,
          isOpen: false
        };
        // Mock stateManager BEFORE init() is called
        const mockStateManager = {
          init: jest.fn().mockResolvedValue(undefined),
          getState: jest.fn().mockReturnValue(savedState),
          savePanelState: jest.fn(),
          setIsOpen: jest.fn(),
          broadcast: jest.fn()
        };
        PanelStateManager.mockImplementationOnce(() => mockStateManager);

        await panelManager.init();

        expect(panelManager.uiBuilder.createPanel).toHaveBeenCalledWith(savedState);
        expect(document.body.appendChild).toHaveBeenCalledWith(mockPanel);
        expect(panelManager.panel).toBe(mockPanel);
      });

      test('should initialize controllers', async () => {
        await panelManager.init();

        expect(panelManager.dragController).toBeDefined();
        expect(panelManager.resizeController).toBeDefined();
        expect(panelManager.contentManager).toBeDefined();
      });

      test('should setup message listener', async () => {
        const addListenerSpy = jest.spyOn(panelManager, 'setupMessageListener');
        await panelManager.init();

        expect(addListenerSpy).toHaveBeenCalled();
      });
    });

    describe('open()', () => {
      beforeEach(async () => {
        await panelManager.init();
        panelManager.isOpen = false;
      });

      test('should show panel', () => {
        panelManager.open();

        expect(mockPanel.style.display).toBe('flex');
        expect(panelManager.isOpen).toBe(true);
      });

      test('should update state manager', () => {
        panelManager.open();

        expect(panelManager.stateManager.setIsOpen).toHaveBeenCalledWith(true);
      });

      test('should bring panel to front', () => {
        panelManager.open();

        expect(mockPanel.style.zIndex).toBe('999999999');
      });

      test('should update content manager', () => {
        panelManager.open();

        expect(panelManager.contentManager.setIsOpen).toHaveBeenCalledWith(true);
        expect(panelManager.contentManager.updateContent).toHaveBeenCalled();
      });

      test('should start auto-refresh interval', () => {
        panelManager.open();

        expect(panelManager.updateInterval).not.toBeNull();
        // useFakeTimers creates mock timers, so we can check they were created
        expect(panelManager.updateInterval).toEqual(expect.any(Number));
      });

      test('should not create multiple intervals', () => {
        panelManager.open();
        const firstInterval = panelManager.updateInterval;

        panelManager.open();
        expect(panelManager.updateInterval).toBe(firstInterval);
      });

      test('should save state and broadcast', () => {
        panelManager.open();

        expect(panelManager.stateManager.savePanelState).toHaveBeenCalledWith(mockPanel);
        expect(panelManager.stateManager.broadcast).toHaveBeenCalledWith('PANEL_OPENED', {});
      });

      test('should handle panel not initialized', () => {
        panelManager.panel = null;
        console.error = jest.fn();

        panelManager.open();

        expect(console.error).toHaveBeenCalledWith('[PanelManager] Panel not initialized');
      });
    });

    describe('close()', () => {
      beforeEach(async () => {
        await panelManager.init();
        panelManager.open();
      });

      test('should hide panel', () => {
        panelManager.close();

        expect(mockPanel.style.display).toBe('none');
        expect(panelManager.isOpen).toBe(false);
      });

      test('should update state manager', () => {
        panelManager.close();

        expect(panelManager.stateManager.setIsOpen).toHaveBeenCalledWith(false);
      });

      test('should update content manager', () => {
        panelManager.close();

        expect(panelManager.contentManager.setIsOpen).toHaveBeenCalledWith(false);
      });

      test('should stop auto-refresh interval', () => {
        panelManager.close();

        expect(panelManager.updateInterval).toBeNull();
      });

      test('should save state and broadcast', () => {
        panelManager.close();

        expect(panelManager.stateManager.savePanelState).toHaveBeenCalledWith(mockPanel);
        expect(panelManager.stateManager.broadcast).toHaveBeenCalledWith('PANEL_CLOSED', {});
      });

      test('should handle panel not initialized', () => {
        panelManager.panel = null;

        panelManager.close();

        // Should not throw error - close() returns early if panel is null
        // isOpen state is not modified in this case
      });
    });

    describe('toggle()', () => {
      beforeEach(async () => {
        await panelManager.init();
      });

      test('should open panel when closed', () => {
        const openSpy = jest.spyOn(panelManager, 'open');
        panelManager.isOpen = false;

        panelManager.toggle();

        expect(openSpy).toHaveBeenCalled();
      });

      test('should close panel when open', () => {
        const closeSpy = jest.spyOn(panelManager, 'close');
        panelManager.isOpen = true;

        panelManager.toggle();

        expect(closeSpy).toHaveBeenCalled();
      });

      test('should handle panel not initialized', () => {
        panelManager.panel = null;
        console.error = jest.fn();

        panelManager.toggle();

        expect(console.error).toHaveBeenCalledWith('[PanelManager] Panel not initialized');
      });
    });
  });

  describe('Component Delegation', () => {
    beforeEach(async () => {
      await panelManager.init();
    });

    test('should create PanelUIBuilder instance', () => {
      expect(panelManager.uiBuilder).toBeDefined();
      expect(panelManager.uiBuilder.injectStyles).toBeDefined();
      expect(panelManager.uiBuilder.createPanel).toBeDefined();
    });

    test('should create PanelStateManager with callbacks', () => {
      expect(PanelStateManager).toHaveBeenCalledWith(
        expect.objectContaining({
          onStateLoaded: expect.any(Function),
          onBroadcastReceived: expect.any(Function)
        })
      );
    });

    test('should create PanelDragController with panel and handle', () => {
      expect(PanelDragController).toHaveBeenCalledWith(
        mockPanel,
        mockPanel.querySelector('.panel-header'),
        expect.objectContaining({
          onDragEnd: expect.any(Function),
          onBroadcast: expect.any(Function)
        })
      );
    });

    test('should create PanelResizeController with panel', () => {
      expect(PanelResizeController).toHaveBeenCalledWith(
        mockPanel,
        expect.objectContaining({
          onSizeChange: expect.any(Function),
          onPositionChange: expect.any(Function),
          onResizeEnd: expect.any(Function),
          onBroadcast: expect.any(Function)
        })
      );
    });

    test('should create PanelContentManager with dependencies', () => {
      expect(PanelContentManager).toHaveBeenCalledWith(
        mockPanel,
        expect.objectContaining({
          uiBuilder: panelManager.uiBuilder,
          stateManager: panelManager.stateManager,
          quickTabsManager: mockQuickTabsManager,
          currentContainerId: 'firefox-container-1'
        })
      );
    });

    test('should setup content manager event listeners', () => {
      expect(panelManager.contentManager.setOnClose).toHaveBeenCalledWith(expect.any(Function));
      expect(panelManager.contentManager.setupEventListeners).toHaveBeenCalled();
    });
  });

  describe('Component Callbacks', () => {
    beforeEach(async () => {
      await panelManager.init();
    });

    test('drag controller onDragEnd should save state and broadcast', () => {
      const dragCallbacks = PanelDragController.mock.calls[0][2];

      dragCallbacks.onDragEnd(100, 200);

      expect(panelManager.stateManager.savePanelState).toHaveBeenCalledWith(mockPanel);
    });

    test('drag controller onBroadcast should delegate to state manager', () => {
      const dragCallbacks = PanelDragController.mock.calls[0][2];
      const data = { left: 150, top: 250 };

      dragCallbacks.onBroadcast(data);

      expect(panelManager.stateManager.broadcast).toHaveBeenCalledWith(
        'PANEL_POSITION_UPDATED',
        data
      );
    });

    test('resize controller onResizeEnd should save state', () => {
      const resizeCallbacks = PanelResizeController.mock.calls[0][1];

      resizeCallbacks.onResizeEnd(500, 700, 100, 200);

      expect(panelManager.stateManager.savePanelState).toHaveBeenCalledWith(mockPanel);
    });

    test('resize controller onBroadcast should broadcast size and position', () => {
      const resizeCallbacks = PanelResizeController.mock.calls[0][1];
      const data = { width: 600, height: 800, left: 150, top: 250 };

      resizeCallbacks.onBroadcast(data);

      expect(panelManager.stateManager.broadcast).toHaveBeenCalledWith('PANEL_SIZE_UPDATED', {
        width: 600,
        height: 800
      });
      expect(panelManager.stateManager.broadcast).toHaveBeenCalledWith('PANEL_POSITION_UPDATED', {
        left: 150,
        top: 250
      });
    });

    test('content manager onClose should close panel', async () => {
      const closeSpy = jest.spyOn(panelManager, 'close');
      const closeCallback = panelManager.contentManager.setOnClose.mock.calls[0][0];

      closeCallback();

      expect(closeSpy).toHaveBeenCalled();
    });
  });

  describe('Message Listener', () => {
    beforeEach(async () => {
      await panelManager.init();
    });

    test('should register message listener', () => {
      expect(browser.runtime.onMessage.addListener).toHaveBeenCalled();
    });

    test('should toggle panel on TOGGLE_QUICK_TABS_PANEL message', async () => {
      const toggleSpy = jest.spyOn(panelManager, 'toggle');
      const listener = browser.runtime.onMessage.addListener.mock.calls[0][0];

      const result = listener({ action: 'TOGGLE_QUICK_TABS_PANEL' }, {});

      expect(toggleSpy).toHaveBeenCalled();
      await expect(result).resolves.toEqual({ success: true });
    });

    test('should return false for unknown messages', () => {
      const listener = browser.runtime.onMessage.addListener.mock.calls[0][0];

      const result = listener({ action: 'UNKNOWN_ACTION' }, {});

      expect(result).toBe(false);
    });
  });

  describe('Auto-refresh Behavior', () => {
    beforeEach(async () => {
      await panelManager.init();
    });

    test('should call updateContent on interval', () => {
      panelManager.open();
      jest.advanceTimersByTime(2000);

      expect(panelManager.contentManager.updateContent).toHaveBeenCalledTimes(2); // Once on open, once on interval
    });

    test('should continue calling updateContent', () => {
      panelManager.open();
      jest.advanceTimersByTime(6000);

      expect(panelManager.contentManager.updateContent).toHaveBeenCalledTimes(4); // Once on open, 3 on intervals
    });

    test('should stop calling after close', () => {
      panelManager.open();
      jest.advanceTimersByTime(2000);
      panelManager.close();
      jest.advanceTimersByTime(4000);

      expect(panelManager.contentManager.updateContent).toHaveBeenCalledTimes(2); // Once on open, once before close
    });
  });

  describe('State Coordination', () => {
    beforeEach(async () => {
      await panelManager.init();
    });

    test('should apply state from state manager on load', () => {
      const stateCallbacks = PanelStateManager.mock.calls[0][0];
      const state = {
        left: 300,
        top: 400,
        width: 600,
        height: 800,
        isOpen: true
      };

      stateCallbacks.onStateLoaded(state);

      expect(mockPanel.style.left).toBe('300px');
      expect(mockPanel.style.top).toBe('400px');
      expect(mockPanel.style.width).toBe('600px');
      expect(mockPanel.style.height).toBe('800px');
    });

    test('should handle broadcast messages', () => {
      const stateCallbacks = PanelStateManager.mock.calls[0][0];

      stateCallbacks.onBroadcastReceived('PANEL_OPENED', {});

      // Handler implementation is minimal - just ensure no errors
    });
  });

  describe('Error Handling', () => {
    test('should handle init failure gracefully', async () => {
      PanelStateManager.mockImplementation(() => ({
        init: jest.fn().mockRejectedValue(new Error('Init failed'))
      }));

      await expect(panelManager.init()).rejects.toThrow('Init failed');
    });

    test('should handle missing panel element on open', () => {
      panelManager.panel = null;
      console.error = jest.fn();

      panelManager.open();

      expect(console.error).toHaveBeenCalled();
    });

    test('should handle missing panel element on toggle', () => {
      panelManager.panel = null;
      console.error = jest.fn();

      panelManager.toggle();

      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('Container Detection', () => {
    test('should detect Firefox container', async () => {
      browser.runtime.sendMessage.mockResolvedValueOnce({
        success: true,
        cookieStoreId: 'firefox-container-2'
      });

      await panelManager.init();

      expect(panelManager.currentContainerId).toBe('firefox-container-2');
    });

    test('should handle default container', async () => {
      browser.runtime.sendMessage.mockResolvedValueOnce({
        success: true,
        cookieStoreId: 'firefox-default'
      });

      await panelManager.init();

      expect(panelManager.currentContainerId).toBe('firefox-default');
    });

    test('should handle missing cookieStoreId', async () => {
      browser.runtime.sendMessage.mockResolvedValueOnce({
        success: false
      });

      await panelManager.init();

      expect(panelManager.currentContainerId).toBe('firefox-default');
    });

    test('should handle empty tabs array', async () => {
      browser.runtime.sendMessage.mockResolvedValueOnce({
        success: false
      });

      await panelManager.init();

      expect(panelManager.currentContainerId).toBe('firefox-default');
    });

    test('should handle null tabs result', async () => {
      browser.runtime.sendMessage.mockResolvedValueOnce(null);

      await panelManager.init();

      expect(panelManager.currentContainerId).toBe('firefox-default');
    });
  });

  describe('Multiple Open/Close Cycles', () => {
    beforeEach(async () => {
      await panelManager.init();
    });

    test('should handle multiple open/close cycles', () => {
      panelManager.open();
      expect(panelManager.isOpen).toBe(true);

      panelManager.close();
      expect(panelManager.isOpen).toBe(false);

      panelManager.open();
      expect(panelManager.isOpen).toBe(true);

      panelManager.close();
      expect(panelManager.isOpen).toBe(false);
    });

    test('should properly manage intervals across cycles', () => {
      panelManager.open();
      const firstInterval = panelManager.updateInterval;
      expect(firstInterval).not.toBeNull();

      panelManager.close();
      expect(panelManager.updateInterval).toBeNull();

      panelManager.open();
      const secondInterval = panelManager.updateInterval;
      expect(secondInterval).not.toBeNull();
      expect(secondInterval).not.toBe(firstInterval);
    });
  });
});
