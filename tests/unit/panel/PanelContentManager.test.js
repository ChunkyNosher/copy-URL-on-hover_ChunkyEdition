/**
 * Tests for PanelContentManager
 * v1.6.0 - Phase 2.10: Content management component tests
 */

import { jest } from '@jest/globals';

import { PanelContentManager } from '../../../src/features/quick-tabs/panel/PanelContentManager.js';

describe('PanelContentManager', () => {
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
  });

  afterEach(() => {
    contentManager.destroy();
    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with dependencies', () => {
      expect(contentManager.panel).toBe(panelElement);
      expect(contentManager.uiBuilder).toBe(mockUIBuilder);
      expect(contentManager.stateManager).toBe(mockStateManager);
      expect(contentManager.quickTabsManager).toBe(mockQuickTabsManager);
      expect(contentManager.currentContainerId).toBe('firefox-default');
      expect(contentManager.eventListeners).toEqual([]);
      expect(contentManager.isOpen).toBe(false);
    });
  });

  describe('setIsOpen()', () => {
    it('should update open state', () => {
      contentManager.setIsOpen(true);
      expect(contentManager.isOpen).toBe(true);

      contentManager.setIsOpen(false);
      expect(contentManager.isOpen).toBe(false);
    });
  });

  describe('updateContent()', () => {
    beforeEach(() => {
      contentManager.setIsOpen(true);
    });

    it('should not update when panel closed', async () => {
      contentManager.setIsOpen(false);
      await contentManager.updateContent();
      expect(mockBrowser.storage.sync.get).not.toHaveBeenCalled();
    });

    it('should fetch and render Quick Tabs', async () => {
      const mockState = {
        'firefox-default': {
          tabs: [{ id: '1', title: 'Tab 1', url: 'https://example.com' }],
          lastUpdate: Date.now()
        }
      };

      mockBrowser.storage.sync.get.mockResolvedValue({
        quick_tabs_state_v2: { containers: mockState }
      });

      await contentManager.updateContent();

      expect(mockBrowser.storage.sync.get).toHaveBeenCalledWith('quick_tabs_state_v2');
      expect(mockUIBuilder.renderContainerSection).toHaveBeenCalled();
    });

    it('should handle wrapped container format', async () => {
      const mockState = {
        containers: {
          'firefox-default': {
            tabs: [{ id: '1' }],
            lastUpdate: Date.now()
          }
        }
      };

      mockBrowser.storage.sync.get.mockResolvedValue({
        quick_tabs_state_v2: mockState
      });

      await contentManager.updateContent();

      expect(mockUIBuilder.renderContainerSection).toHaveBeenCalled();
    });

    it('should show empty state when no tabs', async () => {
      const mockState = {
        'firefox-default': {
          tabs: [],
          lastUpdate: Date.now()
        }
      };

      mockBrowser.storage.sync.get.mockResolvedValue({
        quick_tabs_state_v2: { containers: mockState }
      });

      await contentManager.updateContent();

      const emptyState = panelElement.querySelector('#panel-emptyState');
      const containersList = panelElement.querySelector('#panel-containersList');

      expect(emptyState.style.display).toBe('flex');
      expect(containersList.style.display).toBe('none');
    });

    it('should handle storage errors gracefully', async () => {
      mockBrowser.storage.sync.get.mockRejectedValue(new Error('Storage error'));
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      await contentManager.updateContent();

      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it('should update statistics correctly', async () => {
      const timestamp = Date.now();
      const mockState = {
        'firefox-default': {
          tabs: [{ id: '1' }, { id: '2' }],
          lastUpdate: timestamp
        }
      };

      mockBrowser.storage.sync.get.mockResolvedValue({
        quick_tabs_state_v2: { containers: mockState }
      });

      await contentManager.updateContent();

      const totalTabs = panelElement.querySelector('#panel-totalTabs');
      expect(totalTabs.textContent).toBe('2 Quick Tabs');
    });

    it('should fetch container info for non-default containers', async () => {
      contentManager.currentContainerId = 'firefox-container-1';

      const mockState = {
        'firefox-container-1': {
          tabs: [{ id: '1' }],
          lastUpdate: Date.now()
        }
      };

      mockBrowser.storage.sync.get.mockResolvedValue({
        quick_tabs_state_v2: { containers: mockState }
      });

      mockBrowser.contextualIdentities.query.mockResolvedValue([
        {
          cookieStoreId: 'firefox-container-1',
          name: 'Personal',
          icon: 'fingerprint',
          color: 'blue'
        }
      ]);

      await contentManager.updateContent();

      expect(mockBrowser.contextualIdentities.query).toHaveBeenCalled();
      expect(mockUIBuilder.renderContainerSection).toHaveBeenCalledWith(
        expect.any(HTMLElement),
        'firefox-container-1',
        expect.objectContaining({ name: 'Personal' }),
        mockState['firefox-container-1']
      );
    });
  });

  describe('setupEventListeners()', () => {
    it('should setup close button listener', () => {
      const mockOnClose = jest.fn();
      contentManager.setOnClose(mockOnClose);
      contentManager.setupEventListeners();

      const closeBtn = panelElement.querySelector('.panel-close');
      closeBtn.click();

      expect(mockOnClose).toHaveBeenCalled();
      expect(contentManager.eventListeners.length).toBeGreaterThan(0);
    });

    it('should setup minimize button listener', () => {
      const mockOnClose = jest.fn();
      contentManager.setOnClose(mockOnClose);
      contentManager.setupEventListeners();

      const minimizeBtn = panelElement.querySelector('.panel-minimize');
      minimizeBtn.click();

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('should setup close minimized button listener', async () => {
      contentManager.setupEventListeners();
      const handleCloseMinimized = jest
        .spyOn(contentManager, 'handleCloseMinimized')
        .mockResolvedValue();

      const closeMinimizedBtn = panelElement.querySelector('#panel-closeMinimized');
      closeMinimizedBtn.click();

      // Wait for async handler
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(handleCloseMinimized).toHaveBeenCalled();
      handleCloseMinimized.mockRestore();
    });

    it('should setup close all button listener', async () => {
      contentManager.setupEventListeners();
      const handleCloseAll = jest.spyOn(contentManager, 'handleCloseAll').mockResolvedValue();

      const closeAllBtn = panelElement.querySelector('#panel-closeAll');
      closeAllBtn.click();

      // Wait for async handler
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(handleCloseAll).toHaveBeenCalled();
      handleCloseAll.mockRestore();
    });

    it('should setup delegated action listener', async () => {
      contentManager.setupEventListeners();

      // Add a mock action button
      const containersList = panelElement.querySelector('#panel-containersList');
      const actionButton = document.createElement('button');
      actionButton.dataset.action = 'minimize';
      actionButton.dataset.quickTabId = '123';
      containersList.appendChild(actionButton);

      actionButton.click();

      // Wait for async handler
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(mockQuickTabsManager.minimizeById).toHaveBeenCalledWith('123');
    });
  });

  describe('handleCloseMinimized()', () => {
    it('should close minimized tabs', async () => {
      const mockState = {
        containers: {
          'firefox-default': {
            tabs: [
              { id: '1', minimized: false },
              { id: '2', minimized: true },
              { id: '3', minimized: true }
            ],
            lastUpdate: 1000
          }
        }
      };

      mockBrowser.storage.sync.get.mockResolvedValue({
        quick_tabs_state_v2: mockState
      });

      await contentManager.handleCloseMinimized();

      expect(mockBrowser.storage.sync.set).toHaveBeenCalled();
      const savedState = mockBrowser.storage.sync.set.mock.calls[0][0];
      expect(savedState.quick_tabs_state_v2.containers['firefox-default'].tabs).toHaveLength(1);
    });

    it('should not save if no changes', async () => {
      const mockState = {
        containers: {
          'firefox-default': {
            tabs: [{ id: '1', minimized: false }],
            lastUpdate: 1000
          }
        }
      };

      mockBrowser.storage.sync.get.mockResolvedValue({
        quick_tabs_state_v2: mockState
      });

      await contentManager.handleCloseMinimized();

      expect(mockBrowser.storage.sync.set).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockBrowser.storage.sync.get.mockRejectedValue(new Error('Storage error'));
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      await contentManager.handleCloseMinimized();

      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  describe('handleCloseAll()', () => {
    it('should clear all tabs', async () => {
      await contentManager.handleCloseAll();

      expect(mockBrowser.storage.sync.set).toHaveBeenCalled();
      const savedState = mockBrowser.storage.sync.set.mock.calls[0][0];
      expect(savedState.quick_tabs_state_v2.containers).toBeDefined();
      expect(savedState.quick_tabs_state_v2.containers['firefox-default'].tabs).toEqual([]);
    });

    it('should send message to background', async () => {
      await contentManager.handleCloseAll();

      expect(mockBrowser.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'CLEAR_ALL_QUICK_TABS'
      });
    });

    it('should handle session storage', async () => {
      await contentManager.handleCloseAll();

      expect(mockBrowser.storage.session.set).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockBrowser.storage.sync.set.mockRejectedValue(new Error('Storage error'));
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      await contentManager.handleCloseAll();

      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  describe('handleGoToTab()', () => {
    it('should activate tab', async () => {
      await contentManager.handleGoToTab(123);

      expect(mockBrowser.tabs.update).toHaveBeenCalledWith(123, {
        active: true
      });
    });

    it('should handle errors', async () => {
      mockBrowser.tabs.update.mockRejectedValue(new Error('Tab error'));
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      await contentManager.handleGoToTab(123);

      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  describe('handleMinimizeTab()', () => {
    it('should call QuickTabsManager.minimizeById', () => {
      contentManager.handleMinimizeTab('tab-123');

      expect(mockQuickTabsManager.minimizeById).toHaveBeenCalledWith('tab-123');
    });

    it('should handle missing QuickTabsManager', () => {
      contentManager.quickTabsManager = null;

      // Should not throw
      contentManager.handleMinimizeTab('tab-123');
    });
  });

  describe('handleRestoreTab()', () => {
    it('should call QuickTabsManager.restoreById', () => {
      contentManager.handleRestoreTab('tab-123');

      expect(mockQuickTabsManager.restoreById).toHaveBeenCalledWith('tab-123');
    });

    it('should handle missing QuickTabsManager', () => {
      contentManager.quickTabsManager = null;

      // Should not throw
      contentManager.handleRestoreTab('tab-123');
    });
  });

  describe('handleCloseTab()', () => {
    it('should call QuickTabsManager.closeById', () => {
      contentManager.handleCloseTab('tab-123');

      expect(mockQuickTabsManager.closeById).toHaveBeenCalledWith('tab-123');
    });

    it('should handle missing QuickTabsManager', () => {
      contentManager.quickTabsManager = null;

      // Should not throw
      contentManager.handleCloseTab('tab-123');
    });
  });

  describe('destroy()', () => {
    it('should remove all event listeners', () => {
      contentManager.setupEventListeners();
      const initialListenerCount = contentManager.eventListeners.length;

      expect(initialListenerCount).toBeGreaterThan(0);

      contentManager.destroy();

      expect(contentManager.eventListeners).toEqual([]);
    });

    it('should clear references', () => {
      contentManager.destroy();

      expect(contentManager.panel).toBeNull();
      expect(contentManager.uiBuilder).toBeNull();
      expect(contentManager.stateManager).toBeNull();
      expect(contentManager.quickTabsManager).toBeNull();
    });

    it('should handle destroy multiple times', () => {
      contentManager.destroy();
      contentManager.destroy();

      // Should not throw
      expect(contentManager.eventListeners).toEqual([]);
    });
  });

  describe('Integration', () => {
    it('should handle complete workflow', async () => {
      contentManager.setIsOpen(true);
      contentManager.setupEventListeners();

      // Mock state with tabs
      const mockState = {
        containers: {
          'firefox-default': {
            tabs: [
              { id: '1', title: 'Tab 1', minimized: false },
              { id: '2', title: 'Tab 2', minimized: true }
            ],
            lastUpdate: Date.now()
          }
        }
      };

      mockBrowser.storage.sync.get.mockResolvedValue({
        quick_tabs_state_v2: mockState
      });

      // Update content
      await contentManager.updateContent();

      expect(mockUIBuilder.renderContainerSection).toHaveBeenCalled();

      // Test action
      await contentManager.handleMinimizeTab('1');
      expect(mockQuickTabsManager.minimizeById).toHaveBeenCalledWith('1');

      // Cleanup
      contentManager.destroy();
      expect(contentManager.eventListeners).toEqual([]);
    });
  });
});
