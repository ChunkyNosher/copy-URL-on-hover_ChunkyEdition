/* eslint-disable import/order */
import { EventEmitter } from 'eventemitter3';

import { QuickTab } from '../../../src/domain/QuickTab.js';
import { UICoordinator } from '../../../src/features/quick-tabs/coordinators/UICoordinator.js';
/* eslint-enable import/order */

// v1.6.3.6-v5 - FIX: Helper to create QuickTab with originTabId for cross-tab filtering tests
// QuickTab.create() doesn't support originTabId, so we add it as a runtime property
// This mimics the behavior of CreateHandler which sets originTabId during creation
const createQuickTabWithOriginTabId = (params) => {
  // Extract originTabId from params (it's not supported by QuickTab.create)
  const { originTabId, ...quickTabParams } = params;
  const quickTab = QuickTab.create(quickTabParams);
  quickTab.originTabId = originTabId;
  return quickTab;
};

// Mock dependencies
const createMockStateManager = () => ({
  getVisible: jest.fn(() => []),
  get: jest.fn()
});

const createMockMinimizedManager = () => ({
  add: jest.fn(),
  remove: jest.fn(),
  has: jest.fn(() => false)
});

const createMockPanelManager = () => ({
  update: jest.fn(),
  show: jest.fn(),
  hide: jest.fn()
});

const createMockQuickTabWindow = () => ({
  id: 'qt-123',
  updatePosition: jest.fn(),
  updateSize: jest.fn(),
  updateZIndex: jest.fn(),
  destroy: jest.fn(),
  isRendered: jest.fn(() => true)
});

// Mock the createQuickTabWindow function from the window.js module
jest.mock('../../../src/features/quick-tabs/window.js', () => ({
  createQuickTabWindow: jest.fn()
}));

// Import the mocked function for assertions
import { createQuickTabWindow } from '../../../src/features/quick-tabs/window.js';

describe('UICoordinator', () => {
  let uiCoordinator;
  let mockStateManager;
  let mockMinimizedManager;
  let mockPanelManager;
  let mockEventBus;

  beforeEach(() => {
    mockStateManager = createMockStateManager();
    mockMinimizedManager = createMockMinimizedManager();
    mockPanelManager = createMockPanelManager();
    mockEventBus = new EventEmitter();

    // Clear mocks but preserve implementation
    jest.clearAllMocks();

    // Re-setup the mock implementation after clearing
    createQuickTabWindow.mockImplementation(() => createMockQuickTabWindow());
  });

  describe('Constructor', () => {
    test('should initialize with all dependencies', () => {
      uiCoordinator = new UICoordinator(
        mockStateManager,
        mockMinimizedManager,
        mockPanelManager,
        mockEventBus
      );

      expect(uiCoordinator.stateManager).toBe(mockStateManager);
      expect(uiCoordinator.minimizedManager).toBe(mockMinimizedManager);
      expect(uiCoordinator.panelManager).toBe(mockPanelManager);
      expect(uiCoordinator.eventBus).toBe(mockEventBus);
      expect(uiCoordinator.renderedTabs).toBeInstanceOf(Map);
      expect(uiCoordinator.renderedTabs.size).toBe(0);
    });
  });

  describe('init()', () => {
    // v1.6.3.6-v5 - FIX: Add currentTabId for cross-tab isolation tests
    const MOCK_TAB_ID = 12345;
    
    beforeEach(() => {
      uiCoordinator = new UICoordinator(
        mockStateManager,
        mockMinimizedManager,
        mockPanelManager,
        mockEventBus,
        MOCK_TAB_ID
      );
    });

    test('should setup state listeners', async () => {
      const spy = jest.spyOn(uiCoordinator, 'setupStateListeners');

      await uiCoordinator.init();

      expect(spy).toHaveBeenCalled();
    });

    test('should render all visible tabs', async () => {
      const mockQuickTab = createQuickTabWithOriginTabId({
        id: 'qt-1',
        url: 'https://example.com',
        container: 'firefox-default',
        originTabId: MOCK_TAB_ID
      });

      mockStateManager.getVisible.mockReturnValue([mockQuickTab]);
      const spy = jest.spyOn(uiCoordinator, 'render');

      await uiCoordinator.init();

      expect(mockStateManager.getVisible).toHaveBeenCalled();
      expect(spy).toHaveBeenCalledWith(mockQuickTab);
    });

    test('should handle empty state', async () => {
      mockStateManager.getVisible.mockReturnValue([]);

      await uiCoordinator.init();

      expect(createQuickTabWindow).not.toHaveBeenCalled();
    });
  });

  describe('render()', () => {
    // v1.6.3.6-v5 - FIX: Add currentTabId for cross-tab isolation tests
    const MOCK_TAB_ID = 12345;
    
    beforeEach(() => {
      uiCoordinator = new UICoordinator(
        mockStateManager,
        mockMinimizedManager,
        mockPanelManager,
        mockEventBus,
        MOCK_TAB_ID // v1.6.3.6-v5 - Pass currentTabId for cross-tab filtering
      );
    });

    test('should create QuickTabWindow from QuickTab entity', () => {
      // v1.6.2.2 - Container field removed
      // v1.6.3.6-v5 - FIX: Add originTabId to match currentTabId
      const quickTab = createQuickTabWithOriginTabId({
        id: 'qt-123',
        url: 'https://example.com',
        left: 100,
        top: 200,
        width: 400,
        height: 300,
        title: 'Test Tab',
        originTabId: MOCK_TAB_ID
      });

      const result = uiCoordinator.render(quickTab);

      // v1.6.2.2 - cookieStoreId no longer expected
      expect(createQuickTabWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'qt-123',
          url: 'https://example.com',
          left: 100,
          top: 200,
          width: 400,
          height: 300,
          title: 'Test Tab'
        })
      );
      expect(result).toBeDefined();
    });

    test('should add tab to renderedTabs map', () => {
      // v1.6.3.6-v5 - FIX: Add originTabId for cross-tab filtering
      const quickTab = createQuickTabWithOriginTabId({
        id: 'qt-123',
        url: 'https://example.com',
        originTabId: MOCK_TAB_ID
      });

      uiCoordinator.render(quickTab);

      expect(uiCoordinator.renderedTabs.has('qt-123')).toBe(true);
    });

    test('should skip if already rendered', () => {
      // v1.6.3.6-v5 - FIX: Add originTabId for cross-tab filtering
      const quickTab = createQuickTabWithOriginTabId({
        id: 'qt-123',
        url: 'https://example.com',
        originTabId: MOCK_TAB_ID
      });

      const firstResult = uiCoordinator.render(quickTab);
      jest.clearAllMocks();

      const secondResult = uiCoordinator.render(quickTab);

      expect(createQuickTabWindow).not.toHaveBeenCalled();
      expect(secondResult).toBe(firstResult);
    });

    test('should include visibility properties', () => {
      // v1.6.3.6-v5 - FIX: Add originTabId for cross-tab filtering
      const quickTab = createQuickTabWithOriginTabId({
        id: 'qt-123',
        url: 'https://example.com',
        container: 'firefox-default',
        originTabId: MOCK_TAB_ID
      });

      // Note: solo() and mute() are mutually exclusive in QuickTab
      // solo() clears mute list, mute() clears solo list
      // Test solo separately
      quickTab.solo(100);

      uiCoordinator.render(quickTab);

      expect(createQuickTabWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          soloedOnTabs: [100],
          mutedOnTabs: [],
          minimized: false
        })
      );
    });

    test('should include mute visibility properties', () => {
      // v1.6.3.6-v5 - FIX: Recreate with currentTabId for cross-tab filtering
      uiCoordinator = new UICoordinator(
        mockStateManager,
        mockMinimizedManager,
        mockPanelManager,
        mockEventBus,
        MOCK_TAB_ID
      );

      const quickTab = createQuickTabWithOriginTabId({
        id: 'qt-124',
        url: 'https://example.com',
        container: 'firefox-default',
        originTabId: MOCK_TAB_ID
      });

      quickTab.mute(200);

      uiCoordinator.render(quickTab);

      expect(createQuickTabWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          soloedOnTabs: [],
          mutedOnTabs: [200],
          minimized: false
        })
      );
    });

    test('should include z-index', () => {
      // v1.6.3.6-v5 - FIX: Add originTabId for cross-tab filtering
      const quickTab = createQuickTabWithOriginTabId({
        id: 'qt-123',
        url: 'https://example.com',
        container: 'firefox-default',
        originTabId: MOCK_TAB_ID
      });

      // QuickTab uses default zIndex=1000
      uiCoordinator.render(quickTab);

      expect(createQuickTabWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          zIndex: 1000 // Default from QuickTab.create
        })
      );
    });
  });

  describe('update()', () => {
    // v1.6.3.6-v5 - FIX: Add currentTabId for cross-tab isolation tests
    const MOCK_TAB_ID = 12345;
    
    beforeEach(() => {
      uiCoordinator = new UICoordinator(
        mockStateManager,
        mockMinimizedManager,
        mockPanelManager,
        mockEventBus,
        MOCK_TAB_ID
      );
    });

    test('should update existing tab window', () => {
      // v1.6.3.6-v5 - FIX: Add originTabId for cross-tab filtering
      const quickTab = createQuickTabWithOriginTabId({
        id: 'qt-123',
        url: 'https://example.com',
        container: 'firefox-default',
        originTabId: MOCK_TAB_ID
      });

      // Render first
      uiCoordinator.render(quickTab);

      // Get the mock window that was created
      const tabWindow = createQuickTabWindow.mock.results[0].value;

      // Update position, size, z-index on the QuickTab entity
      quickTab.updatePosition(150, 250);
      quickTab.updateSize(500, 400);
      quickTab.updateZIndex(1600);

      // Trigger update
      uiCoordinator.update(quickTab);

      expect(tabWindow.updatePosition).toHaveBeenCalledWith(150, 250);
      expect(tabWindow.updateSize).toHaveBeenCalledWith(500, 400);
      expect(tabWindow.updateZIndex).toHaveBeenCalledWith(1600);
    });

    test('should render tab if not yet rendered', () => {
      // v1.6.3.6-v5 - FIX: Add originTabId for cross-tab filtering
      const quickTab = createQuickTabWithOriginTabId({
        id: 'qt-123',
        url: 'https://example.com',
        container: 'firefox-default',
        originTabId: MOCK_TAB_ID
      });

      const spy = jest.spyOn(uiCoordinator, 'render');

      uiCoordinator.update(quickTab);

      expect(spy).toHaveBeenCalledWith(quickTab);
    });

    test('should handle non-existent tab gracefully', () => {
      // v1.6.3.6-v5 - FIX: Add originTabId for cross-tab filtering
      const quickTab = createQuickTabWithOriginTabId({
        id: 'qt-nonexistent',
        url: 'https://example.com',
        container: 'firefox-default',
        originTabId: MOCK_TAB_ID
      });

      expect(() => uiCoordinator.update(quickTab)).not.toThrow();
    });
  });

  describe('destroy()', () => {
    // v1.6.3.6-v5 - FIX: Add currentTabId for cross-tab isolation tests
    const MOCK_TAB_ID = 12345;
    
    beforeEach(() => {
      uiCoordinator = new UICoordinator(
        mockStateManager,
        mockMinimizedManager,
        mockPanelManager,
        mockEventBus,
        MOCK_TAB_ID
      );
    });

    test('should call tab destroy method', () => {
      // v1.6.3.6-v5 - FIX: Add originTabId for cross-tab filtering
      const quickTab = createQuickTabWithOriginTabId({
        id: 'qt-123',
        url: 'https://example.com',
        container: 'firefox-default',
        originTabId: MOCK_TAB_ID
      });

      uiCoordinator.render(quickTab);

      // Get the mock window that was created
      const tabWindow = createQuickTabWindow.mock.results[0].value;

      uiCoordinator.destroy('qt-123');

      expect(tabWindow.destroy).toHaveBeenCalled();
    });

    test('should remove tab from renderedTabs map', () => {
      // v1.6.3.6-v5 - FIX: Add originTabId for cross-tab filtering
      const quickTab = createQuickTabWithOriginTabId({
        id: 'qt-123',
        url: 'https://example.com',
        container: 'firefox-default',
        originTabId: MOCK_TAB_ID
      });

      uiCoordinator.render(quickTab);
      expect(uiCoordinator.renderedTabs.has('qt-123')).toBe(true);

      uiCoordinator.destroy('qt-123');

      expect(uiCoordinator.renderedTabs.has('qt-123')).toBe(false);
    });

    test('should handle non-existent tab gracefully', () => {
      expect(() => uiCoordinator.destroy('qt-nonexistent')).not.toThrow();
    });

    test('should handle tab without destroy method', () => {
      // v1.6.3.6-v5 - FIX: Add originTabId for cross-tab filtering
      const quickTab = createQuickTabWithOriginTabId({
        id: 'qt-123',
        url: 'https://example.com',
        container: 'firefox-default',
        originTabId: MOCK_TAB_ID
      });

      uiCoordinator.render(quickTab);

      // Get the mock window and remove destroy method
      const tabWindow = uiCoordinator.renderedTabs.get('qt-123');
      delete tabWindow.destroy;

      expect(() => uiCoordinator.destroy('qt-123')).not.toThrow();
      expect(uiCoordinator.renderedTabs.has('qt-123')).toBe(false);
    });
  });

  describe('renderAll()', () => {
    // v1.6.3.6-v5 - FIX: Add currentTabId for cross-tab isolation tests
    const MOCK_TAB_ID = 12345;
    
    beforeEach(() => {
      uiCoordinator = new UICoordinator(
        mockStateManager,
        mockMinimizedManager,
        mockPanelManager,
        mockEventBus,
        MOCK_TAB_ID
      );
    });

    test('should render all visible tabs from state', async () => {
      // v1.6.3.6-v5 - FIX: Add originTabId for cross-tab filtering
      const tab1 = createQuickTabWithOriginTabId({
        id: 'qt-1',
        url: 'https://example.com',
        container: 'firefox-default',
        originTabId: MOCK_TAB_ID
      });
      const tab2 = createQuickTabWithOriginTabId({
        id: 'qt-2',
        url: 'https://test.com',
        container: 'firefox-default',
        originTabId: MOCK_TAB_ID
      });

      mockStateManager.getVisible.mockReturnValue([tab1, tab2]);
      const spy = jest.spyOn(uiCoordinator, 'render');

      await uiCoordinator.renderAll();

      expect(mockStateManager.getVisible).toHaveBeenCalled();
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenCalledWith(tab1);
      expect(spy).toHaveBeenCalledWith(tab2);
    });

    test('should handle empty state', async () => {
      mockStateManager.getVisible.mockReturnValue([]);

      await uiCoordinator.renderAll();

      expect(createQuickTabWindow).not.toHaveBeenCalled();
    });
  });

  describe('setupStateListeners()', () => {
    // v1.6.3.6-v5 - FIX: Add currentTabId for cross-tab isolation tests
    const MOCK_TAB_ID = 12345;
    
    beforeEach(() => {
      uiCoordinator = new UICoordinator(
        mockStateManager,
        mockMinimizedManager,
        mockPanelManager,
        mockEventBus,
        MOCK_TAB_ID
      );
    });

    test('should listen to state:added events', () => {
      uiCoordinator.setupStateListeners();
      const spy = jest.spyOn(uiCoordinator, 'render');

      // v1.6.3.6-v5 - FIX: Add originTabId for cross-tab filtering
      const quickTab = createQuickTabWithOriginTabId({
        id: 'qt-1',
        url: 'https://example.com',
        container: 'firefox-default',
        originTabId: MOCK_TAB_ID
      });
      mockEventBus.emit('state:added', { quickTab });

      expect(spy).toHaveBeenCalledWith(quickTab);
    });

    test('should listen to state:updated events', () => {
      uiCoordinator.setupStateListeners();
      const spy = jest.spyOn(uiCoordinator, 'update');

      // v1.6.3.6-v5 - FIX: Add originTabId for cross-tab filtering
      const quickTab = createQuickTabWithOriginTabId({
        id: 'qt-1',
        url: 'https://example.com',
        container: 'firefox-default',
        originTabId: MOCK_TAB_ID
      });
      mockEventBus.emit('state:updated', { quickTab });

      // v1.6.3.4-v2 - update() now takes source and isRestoreOperation parameters
      expect(spy).toHaveBeenCalledWith(quickTab, 'unknown', false);
    });

    test('should listen to state:deleted events', () => {
      uiCoordinator.setupStateListeners();
      const spy = jest.spyOn(uiCoordinator, 'destroy');

      mockEventBus.emit('state:deleted', { id: 'qt-123' });

      expect(spy).toHaveBeenCalledWith('qt-123');
    });
  });

  describe('Integration', () => {
    // v1.6.3.6-v5 - FIX: Add currentTabId for cross-tab isolation tests
    const MOCK_TAB_ID = 12345;
    
    test('should handle full lifecycle', async () => {
      uiCoordinator = new UICoordinator(
        mockStateManager,
        mockMinimizedManager,
        mockPanelManager,
        mockEventBus,
        MOCK_TAB_ID
      );

      // v1.6.3.6-v5 - FIX: Add originTabId for cross-tab filtering
      const quickTab = createQuickTabWithOriginTabId({
        id: 'qt-123',
        url: 'https://example.com',
        container: 'firefox-default',
        originTabId: MOCK_TAB_ID
      });

      mockStateManager.getVisible.mockReturnValue([quickTab]);

      // Initialize
      await uiCoordinator.init();
      expect(uiCoordinator.renderedTabs.has('qt-123')).toBe(true);

      // Get the mock window that was created
      const tabWindow = createQuickTabWindow.mock.results[0].value;

      // Update
      quickTab.updatePosition(200, 300);
      mockEventBus.emit('state:updated', { quickTab });
      expect(tabWindow.updatePosition).toHaveBeenCalledWith(200, 300);

      // Destroy
      mockEventBus.emit('state:deleted', { id: 'qt-123' });
      expect(uiCoordinator.renderedTabs.has('qt-123')).toBe(false);
    });
  });
});
