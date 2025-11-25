/**
 * Additional coverage tests for PanelManager
 * Tests for uncovered edge cases and silent operations
 *
 * Phase 7.4 - Session 14
 * Target: Increase panel.js coverage from 69.53% to 75%+
 *
 * Uncovered lines: 276, 288-301, 333-335, 342-406
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

describe('PanelManager Additional Coverage', () => {
  let panelManager;
  let mockQuickTabsManager;
  let mockPanel;
  let mockStateManager;
  let mockContentManager;
  let mockDragController;
  let mockResizeController;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock timers
    jest.useFakeTimers();

    // Create mock panel element
    mockPanel = document.createElement('div');
    mockPanel.className = 'quick-tabs-manager-panel';
    mockPanel.style.display = 'none';
    mockPanel.style.left = '100px';
    mockPanel.style.top = '100px';
    mockPanel.style.width = '400px';
    mockPanel.style.height = '600px';
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

    // Mock PanelStateManager instance
    mockStateManager = {
      init: jest.fn().mockResolvedValue(undefined),
      getState: jest.fn().mockReturnValue({
        left: 100,
        top: 100,
        width: 400,
        height: 600,
        isOpen: false
      }),
      savePanelState: jest.fn(),
      savePanelStateLocal: jest.fn(),
      setIsOpen: jest.fn(),
      broadcast: jest.fn(),
      destroy: jest.fn()
    };
    PanelStateManager.mockImplementation(() => mockStateManager);

    // v1.6.0.3 - Mock static methods of PanelUIBuilder
    PanelUIBuilder.injectStyles = jest.fn();
    PanelUIBuilder.createPanel = jest.fn().mockReturnValue(mockPanel);
    PanelUIBuilder.renderContainerSection = jest
      .fn()
      .mockReturnValue(document.createElement('div'));
    PanelUIBuilder.getContainerIcon = jest.fn(icon => `icon-${icon}`);

    // Mock PanelDragController instance
    mockDragController = {
      destroy: jest.fn()
    };
    PanelDragController.mockImplementation(() => mockDragController);

    // Mock PanelResizeController instance
    mockResizeController = {
      destroy: jest.fn()
    };
    PanelResizeController.mockImplementation(() => mockResizeController);

    // Mock PanelContentManager instance
    mockContentManager = {
      setOnClose: jest.fn(),
      setupEventListeners: jest.fn(),
      setIsOpen: jest.fn(),
      updateContent: jest.fn(),
      destroy: jest.fn()
    };
    PanelContentManager.mockImplementation(() => mockContentManager);

    // Mock browser APIs
    global.browser = {
      runtime: {
        onMessage: {
          addListener: jest.fn()
        },
        sendMessage: jest.fn()
      },
      tabs: {
        query: jest.fn().mockResolvedValue([{ cookieStoreId: 'firefox-default', active: true }])
      }
    };

    // Mock document.body
    document.body.appendChild = jest.fn();

    // Create PanelManager instance
    panelManager = new PanelManager(mockQuickTabsManager);
  });

  afterEach(() => {
    // Clear all intervals before running timers
    if (panelManager && panelManager.updateInterval) {
      clearInterval(panelManager.updateInterval);
      panelManager.updateInterval = null;
    }
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('Silent Operations', () => {
    beforeEach(async () => {
      await panelManager.init();
      panelManager.isOpen = false;
    });

    describe('openSilent()', () => {
      test('should open panel without broadcasting', () => {
        panelManager.openSilent();

        expect(mockPanel.style.display).toBe('flex');
        expect(panelManager.isOpen).toBe(true);
        expect(mockStateManager.broadcast).not.toHaveBeenCalled();
      });

      test('should update content manager isOpen state', () => {
        panelManager.openSilent();

        expect(mockContentManager.setIsOpen).toHaveBeenCalledWith(true);
      });

      test('should update content', () => {
        panelManager.openSilent();

        expect(mockContentManager.updateContent).toHaveBeenCalled();
      });

      test('should start auto-refresh interval', () => {
        panelManager.openSilent();

        expect(panelManager.updateInterval).not.toBeNull();
        expect(panelManager.updateInterval).toEqual(expect.any(Number));
      });

      test('should not create duplicate intervals', () => {
        panelManager.openSilent();
        const firstInterval = panelManager.updateInterval;

        panelManager.openSilent();

        expect(panelManager.updateInterval).toBe(firstInterval);
      });

      // v1.6.2.3 - Interval changed from 2000ms to 10000ms for real-time event-based updates
      test('should update interval content every 10 seconds', () => {
        panelManager.openSilent();

        // Fast-forward 10 seconds
        jest.advanceTimersByTime(10000);
        expect(mockContentManager.updateContent).toHaveBeenCalledTimes(2); // initial + 1 interval

        // Fast-forward another 10 seconds
        jest.advanceTimersByTime(10000);
        expect(mockContentManager.updateContent).toHaveBeenCalledTimes(3); // initial + 2 intervals
      });

      test('should handle panel not initialized', () => {
        panelManager.panel = null;

        panelManager.openSilent();

        expect(mockContentManager.setIsOpen).not.toHaveBeenCalled();
      });
    });

    describe('closeSilent()', () => {
      beforeEach(() => {
        panelManager.openSilent();
        panelManager.isOpen = true;
      });

      test('should close panel without broadcasting', () => {
        panelManager.closeSilent();

        expect(mockPanel.style.display).toBe('none');
        expect(panelManager.isOpen).toBe(false);
        expect(mockStateManager.broadcast).not.toHaveBeenCalled();
      });

      test('should update state manager', () => {
        panelManager.closeSilent();

        expect(mockStateManager.setIsOpen).toHaveBeenCalledWith(false);
      });

      test('should update content manager', () => {
        panelManager.closeSilent();

        expect(mockContentManager.setIsOpen).toHaveBeenCalledWith(false);
      });

      test('should stop auto-refresh interval', () => {
        const intervalBefore = panelManager.updateInterval;
        expect(intervalBefore).not.toBeNull();

        panelManager.closeSilent();

        expect(panelManager.updateInterval).toBeNull();
      });

      test('should handle panel not initialized', () => {
        jest.clearAllMocks(); // Clear previous calls
        panelManager.panel = null;

        panelManager.closeSilent();

        // Should return early without calling state manager
        expect(mockStateManager.setIsOpen).not.toHaveBeenCalled();
      });

      test('should handle no active interval', () => {
        panelManager.updateInterval = null;

        expect(() => panelManager.closeSilent()).not.toThrow();
      });
    });
  });

  describe('Broadcast Handling', () => {
    beforeEach(async () => {
      await panelManager.init();
    });

    describe('_handleBroadcast()', () => {
      test('should handle PANEL_OPENED when closed', () => {
        panelManager.isOpen = false;
        const openSilentSpy = jest.spyOn(panelManager, 'openSilent');

        panelManager._handleBroadcast('PANEL_OPENED', {});

        expect(openSilentSpy).toHaveBeenCalled();
      });

      test('should not call openSilent when already open', () => {
        panelManager.isOpen = true;
        const openSilentSpy = jest.spyOn(panelManager, 'openSilent');

        panelManager._handleBroadcast('PANEL_OPENED', {});

        expect(openSilentSpy).not.toHaveBeenCalled();
      });

      test('should handle PANEL_CLOSED when open', () => {
        panelManager.isOpen = true;
        const closeSilentSpy = jest.spyOn(panelManager, 'closeSilent');

        panelManager._handleBroadcast('PANEL_CLOSED', {});

        expect(closeSilentSpy).toHaveBeenCalled();
      });

      test('should not call closeSilent when already closed', () => {
        panelManager.isOpen = false;
        const closeSilentSpy = jest.spyOn(panelManager, 'closeSilent');

        panelManager._handleBroadcast('PANEL_CLOSED', {});

        expect(closeSilentSpy).not.toHaveBeenCalled();
      });

      test('should handle PANEL_POSITION_UPDATED', () => {
        const updatePositionSpy = jest.spyOn(panelManager, '_updatePosition');
        const positionData = { left: 200, top: 150 };

        panelManager._handleBroadcast('PANEL_POSITION_UPDATED', positionData);

        expect(updatePositionSpy).toHaveBeenCalledWith(positionData);
      });

      test('should handle PANEL_SIZE_UPDATED', () => {
        const updateSizeSpy = jest.spyOn(panelManager, '_updateSize');
        const sizeData = { width: 500, height: 700 };

        panelManager._handleBroadcast('PANEL_SIZE_UPDATED', sizeData);

        expect(updateSizeSpy).toHaveBeenCalledWith(sizeData);
      });

      test('should handle unknown broadcast type', () => {
        // The handler map doesn't include this type, so it should be silently ignored
        expect(() => panelManager._handleBroadcast('UNKNOWN_TYPE', {})).not.toThrow();

        // The debug function will be called but we're mocking it globally
        // No need to verify debug calls in this test
      });

      test('should ignore null broadcast type', () => {
        expect(() => panelManager._handleBroadcast(null, {})).not.toThrow();
      });

      test('should ignore undefined broadcast type', () => {
        expect(() => panelManager._handleBroadcast(undefined, {})).not.toThrow();
      });
    });

    describe('_updatePosition()', () => {
      test('should update panel position', () => {
        const positionData = { left: 200, top: 150 };

        panelManager._updatePosition(positionData);

        expect(mockPanel.style.left).toBe('200px');
        expect(mockPanel.style.top).toBe('150px');
      });

      test('should save state locally after position update', () => {
        const positionData = { left: 200, top: 150 };

        panelManager._updatePosition(positionData);

        expect(mockStateManager.savePanelStateLocal).toHaveBeenCalledWith(mockPanel);
      });

      test('should handle missing left coordinate', () => {
        const positionData = { top: 150 };

        panelManager._updatePosition(positionData);

        // Should return early without updating
        expect(mockStateManager.savePanelStateLocal).not.toHaveBeenCalled();
      });

      test('should handle missing top coordinate', () => {
        const positionData = { left: 200 };

        panelManager._updatePosition(positionData);

        // Should return early without updating
        expect(mockStateManager.savePanelStateLocal).not.toHaveBeenCalled();
      });

      test('should throw on null data', () => {
        // The implementation doesn't handle null, it will throw
        expect(() => panelManager._updatePosition(null)).toThrow();
      });

      test('should throw on undefined data', () => {
        // The implementation doesn't handle undefined, it will throw
        expect(() => panelManager._updatePosition(undefined)).toThrow();
      });

      test('should handle empty object', () => {
        panelManager._updatePosition({});

        expect(mockStateManager.savePanelStateLocal).not.toHaveBeenCalled();
      });
    });

    describe('_updateSize()', () => {
      test('should update panel size', () => {
        const sizeData = { width: 500, height: 700 };

        panelManager._updateSize(sizeData);

        expect(mockPanel.style.width).toBe('500px');
        expect(mockPanel.style.height).toBe('700px');
      });

      test('should save state locally after size update', () => {
        const sizeData = { width: 500, height: 700 };

        panelManager._updateSize(sizeData);

        expect(mockStateManager.savePanelStateLocal).toHaveBeenCalledWith(mockPanel);
      });

      test('should handle missing width', () => {
        const sizeData = { height: 700 };

        panelManager._updateSize(sizeData);

        // Should return early without updating
        expect(mockStateManager.savePanelStateLocal).not.toHaveBeenCalled();
      });

      test('should handle missing height', () => {
        const sizeData = { width: 500 };

        panelManager._updateSize(sizeData);

        // Should return early without updating
        expect(mockStateManager.savePanelStateLocal).not.toHaveBeenCalled();
      });

      test('should throw on null data', () => {
        // The implementation doesn't handle null, it will throw
        expect(() => panelManager._updateSize(null)).toThrow();
      });

      test('should throw on undefined data', () => {
        // The implementation doesn't handle undefined, it will throw
        expect(() => panelManager._updateSize(undefined)).toThrow();
      });

      test('should handle empty object', () => {
        panelManager._updateSize({});

        expect(mockStateManager.savePanelStateLocal).not.toHaveBeenCalled();
      });
    });
  });

  describe('Destroy and Cleanup', () => {
    beforeEach(async () => {
      await panelManager.init();
      panelManager.openSilent();
    });

    test('should stop auto-refresh interval', () => {
      const intervalBefore = panelManager.updateInterval;
      expect(intervalBefore).not.toBeNull();

      panelManager.destroy();

      expect(panelManager.updateInterval).toBeNull();
    });

    test('should destroy drag controller', () => {
      panelManager.destroy();

      expect(mockDragController.destroy).toHaveBeenCalled();
      expect(panelManager.dragController).toBeNull();
    });

    test('should destroy resize controller', () => {
      panelManager.destroy();

      expect(mockResizeController.destroy).toHaveBeenCalled();
      expect(panelManager.resizeController).toBeNull();
    });

    test('should destroy content manager', () => {
      panelManager.destroy();

      expect(mockContentManager.destroy).toHaveBeenCalled();
      expect(panelManager.contentManager).toBeNull();
    });

    test('should destroy state manager', () => {
      panelManager.destroy();

      expect(mockStateManager.destroy).toHaveBeenCalled();
      expect(panelManager.stateManager).toBeNull();
    });

    test('should remove panel from DOM', () => {
      const removeSpy = jest.spyOn(mockPanel, 'remove');

      panelManager.destroy();

      expect(removeSpy).toHaveBeenCalled();
      expect(panelManager.panel).toBeNull();
    });

    test('should handle destroy when no interval exists', () => {
      panelManager.updateInterval = null;

      expect(() => panelManager.destroy()).not.toThrow();
    });

    test('should handle destroy when no drag controller', () => {
      panelManager.dragController = null;

      expect(() => panelManager.destroy()).not.toThrow();
    });

    test('should handle destroy when no resize controller', () => {
      panelManager.resizeController = null;

      expect(() => panelManager.destroy()).not.toThrow();
    });

    test('should handle destroy when no content manager', () => {
      panelManager.contentManager = null;

      expect(() => panelManager.destroy()).not.toThrow();
    });

    test('should handle destroy when no state manager', () => {
      panelManager.stateManager = null;

      expect(() => panelManager.destroy()).not.toThrow();
    });

    test('should handle destroy when no panel', () => {
      panelManager.panel = null;

      expect(() => panelManager.destroy()).not.toThrow();
    });

    test('should handle multiple destroy calls', () => {
      panelManager.destroy();

      expect(() => panelManager.destroy()).not.toThrow();
      expect(panelManager.panel).toBeNull();
    });

    test('should properly cleanup in correct order', () => {
      const calls = [];

      // Store original functions
      const originalDragDestroy = mockDragController.destroy;
      const originalResizeDestroy = mockResizeController.destroy;
      const originalContentDestroy = mockContentManager.destroy;
      const originalStateDestroy = mockStateManager.destroy;
      const originalPanelRemove = mockPanel.remove;

      // Mock functions to track call order
      mockDragController.destroy = jest.fn(() => calls.push('dragController'));
      mockResizeController.destroy = jest.fn(() => calls.push('resizeController'));
      mockContentManager.destroy = jest.fn(() => calls.push('contentManager'));
      mockStateManager.destroy = jest.fn(() => calls.push('stateManager'));
      mockPanel.remove = jest.fn(() => calls.push('panelRemove'));

      // Clear the interval to track its call
      const intervalBefore = panelManager.updateInterval;

      panelManager.destroy();

      // Verify clearInterval was called (interval should be null now)
      expect(panelManager.updateInterval).toBeNull();
      expect(intervalBefore).not.toBeNull();

      // Verify all destroy methods were called in correct order
      // Order: controllers → managers → panel (interval cleared first)
      expect(calls).toEqual([
        'dragController',
        'resizeController',
        'contentManager',
        'stateManager',
        'panelRemove'
      ]);

      // Restore
      mockDragController.destroy = originalDragDestroy;
      mockResizeController.destroy = originalResizeDestroy;
      mockContentManager.destroy = originalContentDestroy;
      mockStateManager.destroy = originalStateDestroy;
      mockPanel.remove = originalPanelRemove;
    });
  });

  describe('Integration with Silent Operations', () => {
    beforeEach(async () => {
      await panelManager.init();
    });

    test('should handle broadcast triggering openSilent when closed', () => {
      panelManager.isOpen = false;

      panelManager._handleBroadcast('PANEL_OPENED', {});

      expect(panelManager.isOpen).toBe(true);
      expect(mockPanel.style.display).toBe('flex');
      expect(panelManager.updateInterval).not.toBeNull();
    });

    test('should handle broadcast triggering closeSilent when open', () => {
      panelManager.isOpen = false;
      panelManager.openSilent();
      expect(panelManager.isOpen).toBe(true);

      panelManager._handleBroadcast('PANEL_CLOSED', {});

      expect(panelManager.isOpen).toBe(false);
      expect(mockPanel.style.display).toBe('none');
      expect(panelManager.updateInterval).toBeNull();
    });

    test('should handle position update from broadcast', () => {
      panelManager._handleBroadcast('PANEL_POSITION_UPDATED', { left: 300, top: 200 });

      expect(mockPanel.style.left).toBe('300px');
      expect(mockPanel.style.top).toBe('200px');
      expect(mockStateManager.savePanelStateLocal).toHaveBeenCalled();
    });

    test('should handle size update from broadcast', () => {
      panelManager._handleBroadcast('PANEL_SIZE_UPDATED', { width: 600, height: 800 });

      expect(mockPanel.style.width).toBe('600px');
      expect(mockPanel.style.height).toBe('800px');
      expect(mockStateManager.savePanelStateLocal).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    test('should handle init before destroy', async () => {
      await panelManager.init();
      expect(panelManager.panel).not.toBeNull();

      panelManager.destroy();

      expect(panelManager.panel).toBeNull();
    });

    test('should handle silent operations on destroyed panel', () => {
      panelManager.init().then(() => {
        panelManager.destroy();

        // These should handle gracefully
        expect(() => panelManager.openSilent()).not.toThrow();
        expect(() => panelManager.closeSilent()).not.toThrow();
      });
    });

    test('should handle broadcast handlers on destroyed panel', async () => {
      await panelManager.init();
      panelManager.destroy();

      // _handleBroadcast should handle gracefully (has early returns)
      expect(() => panelManager._handleBroadcast('PANEL_OPENED', {})).not.toThrow();

      // Note: _updatePosition and _updateSize don't have early returns for null panel
      // This is expected behavior - they would fail if called after destroy
      // The panel should not receive broadcasts after being destroyed
    });
  });
});
