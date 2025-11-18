import { EventEmitter } from 'eventemitter3';

import { QuickTab } from '../../../src/domain/QuickTab.js';
import { UICoordinator } from '../../../src/features/quick-tabs/coordinators/UICoordinator.js';

/* global createQuickTabWindow */

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

// Mock the window creation function
global.createQuickTabWindow = jest.fn(() => createMockQuickTabWindow());

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
    
    // Re-mock the global function after clearing
    global.createQuickTabWindow = jest.fn(() => createMockQuickTabWindow());
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
    beforeEach(() => {
      uiCoordinator = new UICoordinator(
        mockStateManager,
        mockMinimizedManager,
        mockPanelManager,
        mockEventBus
      );
    });

    test('should setup state listeners', async () => {
      const spy = jest.spyOn(uiCoordinator, 'setupStateListeners');

      await uiCoordinator.init();

      expect(spy).toHaveBeenCalled();
    });

    test('should render all visible tabs', async () => {
      const mockQuickTab = QuickTab.create({
        id: 'qt-1',
        url: 'https://example.com',
        container: 'firefox-default'
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
    beforeEach(() => {
      uiCoordinator = new UICoordinator(
        mockStateManager,
        mockMinimizedManager,
        mockPanelManager,
        mockEventBus
      );
    });

    test('should create QuickTabWindow from QuickTab entity', () => {
      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        container: 'firefox-default',
        left: 100,
        top: 200,
        width: 400,
        height: 300,
        title: 'Test Tab'
      });

      const result = uiCoordinator.render(quickTab);

      expect(createQuickTabWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'qt-123',
          url: 'https://example.com',
          left: 100,
          top: 200,
          width: 400,
          height: 300,
          title: 'Test Tab',
          cookieStoreId: 'firefox-default'
        })
      );
      expect(result).toBeDefined();
    });

    test('should add tab to renderedTabs map', () => {
      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        container: 'firefox-default'
      });

      uiCoordinator.render(quickTab);

      expect(uiCoordinator.renderedTabs.has('qt-123')).toBe(true);
    });

    test('should skip if already rendered', () => {
      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        container: 'firefox-default'
      });

      const firstResult = uiCoordinator.render(quickTab);
      jest.clearAllMocks();

      const secondResult = uiCoordinator.render(quickTab);

      expect(createQuickTabWindow).not.toHaveBeenCalled();
      expect(secondResult).toBe(firstResult);
    });

    test('should include visibility properties', () => {
      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        container: 'firefox-default'
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
      uiCoordinator = new UICoordinator(
        mockStateManager,
        mockMinimizedManager,
        mockPanelManager,
        mockEventBus
      );

      const quickTab = QuickTab.create({
        id: 'qt-124',
        url: 'https://example.com',
        container: 'firefox-default'
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
      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        container: 'firefox-default'
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
    beforeEach(() => {
      uiCoordinator = new UICoordinator(
        mockStateManager,
        mockMinimizedManager,
        mockPanelManager,
        mockEventBus
      );
    });

    test('should update existing tab window', () => {
      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        container: 'firefox-default'
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
      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        container: 'firefox-default'
      });

      const spy = jest.spyOn(uiCoordinator, 'render');

      uiCoordinator.update(quickTab);

      expect(spy).toHaveBeenCalledWith(quickTab);
    });

    test('should handle non-existent tab gracefully', () => {
      const quickTab = QuickTab.create({
        id: 'qt-nonexistent',
        url: 'https://example.com',
        container: 'firefox-default'
      });

      expect(() => uiCoordinator.update(quickTab)).not.toThrow();
    });
  });

  describe('destroy()', () => {
    beforeEach(() => {
      uiCoordinator = new UICoordinator(
        mockStateManager,
        mockMinimizedManager,
        mockPanelManager,
        mockEventBus
      );
    });

    test('should call tab destroy method', () => {
      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        container: 'firefox-default'
      });

      uiCoordinator.render(quickTab);
      
      // Get the mock window that was created
      const tabWindow = createQuickTabWindow.mock.results[0].value;

      uiCoordinator.destroy('qt-123');

      expect(tabWindow.destroy).toHaveBeenCalled();
    });

    test('should remove tab from renderedTabs map', () => {
      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        container: 'firefox-default'
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
      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        container: 'firefox-default'
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
    beforeEach(() => {
      uiCoordinator = new UICoordinator(
        mockStateManager,
        mockMinimizedManager,
        mockPanelManager,
        mockEventBus
      );
    });

    test('should render all visible tabs from state', async () => {
      const tab1 = QuickTab.create({ id: 'qt-1', url: 'https://example.com', container: 'firefox-default' });
      const tab2 = QuickTab.create({ id: 'qt-2', url: 'https://test.com', container: 'firefox-default' });

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
    beforeEach(() => {
      uiCoordinator = new UICoordinator(
        mockStateManager,
        mockMinimizedManager,
        mockPanelManager,
        mockEventBus
      );
    });

    test('should listen to state:added events', () => {
      uiCoordinator.setupStateListeners();
      const spy = jest.spyOn(uiCoordinator, 'render');

      const quickTab = QuickTab.create({ id: 'qt-1', url: 'https://example.com', container: 'firefox-default' });
      mockEventBus.emit('state:added', { quickTab });

      expect(spy).toHaveBeenCalledWith(quickTab);
    });

    test('should listen to state:updated events', () => {
      uiCoordinator.setupStateListeners();
      const spy = jest.spyOn(uiCoordinator, 'update');

      const quickTab = QuickTab.create({ id: 'qt-1', url: 'https://example.com', container: 'firefox-default' });
      mockEventBus.emit('state:updated', { quickTab });

      expect(spy).toHaveBeenCalledWith(quickTab);
    });

    test('should listen to state:deleted events', () => {
      uiCoordinator.setupStateListeners();
      const spy = jest.spyOn(uiCoordinator, 'destroy');

      mockEventBus.emit('state:deleted', { id: 'qt-123' });

      expect(spy).toHaveBeenCalledWith('qt-123');
    });
  });

  describe('Integration', () => {
    test('should handle full lifecycle', async () => {
      uiCoordinator = new UICoordinator(
        mockStateManager,
        mockMinimizedManager,
        mockPanelManager,
        mockEventBus
      );

      const quickTab = QuickTab.create({
        id: 'qt-123',
        url: 'https://example.com',
        container: 'firefox-default'
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
