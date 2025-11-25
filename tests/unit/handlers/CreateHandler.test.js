/**
 * CreateHandler Unit Tests
 * Tests for Quick Tab creation logic extracted from QuickTabsManager
 */

import { EventEmitter } from 'eventemitter3';

import { CreateHandler } from '../../../src/features/quick-tabs/handlers/CreateHandler.js';

// Mock createQuickTabWindow function
const mockCreateQuickTabWindow = jest.fn();
jest.mock('../../../src/features/quick-tabs/window.js', () => ({
  createQuickTabWindow: (...args) => mockCreateQuickTabWindow(...args)
}));

describe('CreateHandler', () => {
  let handler;
  let quickTabsMap;
  let currentZIndex;
  let cookieStoreId;
  let eventBus;
  let Events;
  let generateId;

  beforeEach(() => {
    quickTabsMap = new Map();
    currentZIndex = { value: 10000 };
    cookieStoreId = 'firefox-default';
    // v1.6.2 - BroadcastManager removed, cross-tab sync via storage.onChanged
    eventBus = new EventEmitter();
    Events = {
      QUICK_TAB_CREATED: 'QUICK_TAB_CREATED'
    };
    generateId = jest.fn(() => 'generated-id-123');

    // v1.6.2 - CreateHandler constructor: (quickTabsMap, currentZIndex, cookieStoreId, eventBus, Events, generateId, windowFactory)
    handler = new CreateHandler(
      quickTabsMap,
      currentZIndex,
      cookieStoreId,
      eventBus,
      Events,
      generateId
    );

    mockCreateQuickTabWindow.mockClear();
  });

  describe('Constructor', () => {
    test('should initialize with all dependencies', () => {
      expect(handler.quickTabsMap).toBe(quickTabsMap);
      expect(handler.currentZIndex).toBe(currentZIndex);
      expect(handler.cookieStoreId).toBe(cookieStoreId);
      // v1.6.2 - broadcastManager removed
      expect(handler.eventBus).toBe(eventBus);
      expect(handler.Events).toBe(Events);
      expect(handler.generateId).toBe(generateId);
    });
  });

  describe('create()', () => {
    test('should generate ID when not provided', () => {
      const options = { url: 'https://example.com' };
      const mockTabWindow = { id: 'generated-id-123', render: jest.fn(), isRendered: () => true };
      mockCreateQuickTabWindow.mockReturnValue(mockTabWindow);

      handler.create(options);

      expect(generateId).toHaveBeenCalled();
    });

    test('should use provided ID', () => {
      const options = { id: 'custom-id', url: 'https://example.com' };
      const mockTabWindow = { id: 'custom-id', render: jest.fn(), isRendered: () => true };
      mockCreateQuickTabWindow.mockReturnValue(mockTabWindow);

      handler.create(options);

      expect(generateId).not.toHaveBeenCalled();
    });

    test('should auto-assign cookieStoreId when not provided', () => {
      const options = { id: 'tab-1', url: 'https://example.com' };
      const mockTabWindow = { id: 'tab-1', render: jest.fn(), isRendered: () => true };
      mockCreateQuickTabWindow.mockReturnValue(mockTabWindow);

      handler.create(options);

      expect(mockCreateQuickTabWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          cookieStoreId: 'firefox-default'
        })
      );
    });

    test('should use provided cookieStoreId', () => {
      const options = {
        id: 'tab-1',
        url: 'https://example.com',
        cookieStoreId: 'firefox-container-1'
      };
      const mockTabWindow = { id: 'tab-1', render: jest.fn(), isRendered: () => true };
      mockCreateQuickTabWindow.mockReturnValue(mockTabWindow);

      handler.create(options);

      expect(mockCreateQuickTabWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          cookieStoreId: 'firefox-container-1'
        })
      );
    });

    test('should increment z-index for new tab', () => {
      const options = { id: 'tab-1', url: 'https://example.com' };
      const mockTabWindow = { id: 'tab-1', render: jest.fn(), isRendered: () => true };
      mockCreateQuickTabWindow.mockReturnValue(mockTabWindow);

      const result = handler.create(options);

      expect(result.newZIndex).toBe(10001);
    });

    test('should add tab to quickTabsMap', () => {
      const options = { id: 'tab-1', url: 'https://example.com' };
      const mockTabWindow = { id: 'tab-1', render: jest.fn(), isRendered: () => true };
      mockCreateQuickTabWindow.mockReturnValue(mockTabWindow);

      handler.create(options);

      expect(quickTabsMap.has('tab-1')).toBe(true);
      expect(quickTabsMap.get('tab-1')).toBe(mockTabWindow);
    });

    test('should save Quick Tab to storage via browser.runtime.sendMessage', async () => {
      // Setup browser mock
      global.browser = {
        runtime: {
          sendMessage: jest.fn().mockResolvedValue({})
        }
      };

      const options = {
        id: 'tab-1',
        url: 'https://example.com',
        left: 200,
        top: 150,
        width: 900,
        height: 700,
        title: 'Test Tab'
      };
      const mockTabWindow = { id: 'tab-1', render: jest.fn(), isRendered: () => true };
      mockCreateQuickTabWindow.mockReturnValue(mockTabWindow);

      handler.create(options);

      // v1.6.2 - Cross-tab sync via storage.onChanged, not BroadcastManager
      // Wait for async _saveToStorage call
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(browser.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        action: 'CREATE_QUICK_TAB',
        id: 'tab-1',
        url: 'https://example.com',
        left: 200,
        top: 150,
        width: 900,
        height: 700,
        title: 'Test Tab',
        cookieStoreId: 'firefox-default',
        minimized: false,
        soloedOnTabs: [],
        mutedOnTabs: []
      }));

      delete global.browser;
    });

    test('should emit QUICK_TAB_CREATED event', done => {
      const options = { id: 'tab-1', url: 'https://example.com' };
      const mockTabWindow = { id: 'tab-1', render: jest.fn(), isRendered: () => true };
      mockCreateQuickTabWindow.mockReturnValue(mockTabWindow);

      eventBus.on('QUICK_TAB_CREATED', data => {
        expect(data.id).toBe('tab-1');
        expect(data.url).toBe('https://example.com');
        done();
      });

      handler.create(options);
    });

    test('should handle existing tab that is not rendered', () => {
      const options = { id: 'tab-1', url: 'https://example.com' };
      const existingTab = {
        id: 'tab-1',
        render: jest.fn(),
        isRendered: () => false,
        updateZIndex: jest.fn()
      };
      quickTabsMap.set('tab-1', existingTab);

      const result = handler.create(options);

      expect(existingTab.render).toHaveBeenCalled();
      expect(existingTab.updateZIndex).toHaveBeenCalledWith(10001);
      expect(result.tabWindow).toBe(existingTab);
    });

    test('should handle existing tab that is already rendered', () => {
      const options = { id: 'tab-1', url: 'https://example.com' };
      const existingTab = {
        id: 'tab-1',
        render: jest.fn(),
        isRendered: () => true,
        updateZIndex: jest.fn()
      };
      quickTabsMap.set('tab-1', existingTab);

      const result = handler.create(options);

      expect(existingTab.render).not.toHaveBeenCalled();
      expect(existingTab.updateZIndex).toHaveBeenCalledWith(10001);
      expect(result.tabWindow).toBe(existingTab);
    });

    test('should use default values for missing options', () => {
      const options = { id: 'tab-1', url: 'https://example.com' };
      const mockTabWindow = { id: 'tab-1', render: jest.fn(), isRendered: () => true };
      mockCreateQuickTabWindow.mockReturnValue(mockTabWindow);

      handler.create(options);

      expect(mockCreateQuickTabWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          left: 100,
          top: 100,
          width: 800,
          height: 600,
          title: 'Quick Tab',
          minimized: false,
          soloedOnTabs: [],
          mutedOnTabs: []
        })
      );
    });

    test('should include solo/mute arrays in storage save', async () => {
      // Setup browser mock
      global.browser = {
        runtime: {
          sendMessage: jest.fn().mockResolvedValue({})
        }
      };

      const options = {
        id: 'tab-1',
        url: 'https://example.com',
        soloedOnTabs: [1, 2, 3],
        mutedOnTabs: [4, 5, 6]
      };
      const mockTabWindow = { id: 'tab-1', render: jest.fn(), isRendered: () => true };
      mockCreateQuickTabWindow.mockReturnValue(mockTabWindow);

      handler.create(options);

      // v1.6.2 - Cross-tab sync via storage.onChanged, not BroadcastManager
      // Wait for async _saveToStorage call
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(browser.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE_QUICK_TAB',
          soloedOnTabs: [1, 2, 3],
          mutedOnTabs: [4, 5, 6]
        })
      );

      delete global.browser;
    });

    test('should create QuickTabWindow with all callbacks', () => {
      const options = { id: 'tab-1', url: 'https://example.com' };
      const mockTabWindow = { id: 'tab-1', render: jest.fn(), isRendered: () => true };
      mockCreateQuickTabWindow.mockReturnValue(mockTabWindow);

      handler.create(options);

      const createArgs = mockCreateQuickTabWindow.mock.calls[0][0];
      expect(createArgs).toHaveProperty('onDestroy');
      expect(createArgs).toHaveProperty('onMinimize');
      expect(createArgs).toHaveProperty('onFocus');
      expect(createArgs).toHaveProperty('onPositionChange');
      expect(createArgs).toHaveProperty('onPositionChangeEnd');
      expect(createArgs).toHaveProperty('onSizeChange');
      expect(createArgs).toHaveProperty('onSizeChangeEnd');
      expect(createArgs).toHaveProperty('onSolo');
      expect(createArgs).toHaveProperty('onMute');
    });
  });
});
