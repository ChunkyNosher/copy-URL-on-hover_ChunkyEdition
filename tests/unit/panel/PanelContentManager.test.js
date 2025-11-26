/**
 * Tests for PanelContentManager
 * v1.6.0 - Phase 2.10: Content management component tests
 */

import { jest } from '@jest/globals';

import { PanelContentManager } from '../../../src/features/quick-tabs/panel/PanelContentManager.js';
import { PanelUIBuilder } from '../../../src/features/quick-tabs/panel/PanelUIBuilder.js';

// Mock PanelUIBuilder static methods
jest.mock('../../../src/features/quick-tabs/panel/PanelUIBuilder.js');

describe('PanelContentManager', () => {
  let panelElement;
  let mockUIBuilder;
  let mockStateManager;
  let mockQuickTabsManager;
  let mockBrowser;
  let contentManager;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // v1.6.0.3 - Mock static methods of PanelUIBuilder
    PanelUIBuilder.renderContainerSection = jest
      .fn()
      .mockReturnValue(document.createElement('div'));
    PanelUIBuilder.getContainerIcon = jest.fn(icon => `icon-${icon}`);

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

    // Mock dependencies (kept for backward compatibility in constructor)
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
    // v1.6.2+ - MIGRATION: PanelContentManager uses storage.local
    // v1.6.2.x - Added onChanged mock for cross-tab sync
    mockBrowser = {
      storage: {
        sync: {
          get: jest.fn().mockResolvedValue({}),
          set: jest.fn().mockResolvedValue()
        },
        local: {
          get: jest.fn().mockResolvedValue({}),
          set: jest.fn().mockResolvedValue()
        },
        session: {
          set: jest.fn().mockResolvedValue()
        },
        onChanged: {
          addListener: jest.fn(),
          removeListener: jest.fn()
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

    it('should update content when opening if state changed while closed', async () => {
      // Simulate state changed while closed
      contentManager.stateChangedWhileClosed = true;
      contentManager.isOpen = false;
      
      // Spy on updateContent
      const updateContentSpy = jest.spyOn(contentManager, 'updateContent').mockResolvedValue();
      
      // Open the panel
      contentManager.setIsOpen(true);
      
      // Verify updateContent was called
      expect(updateContentSpy).toHaveBeenCalled();
      expect(contentManager.stateChangedWhileClosed).toBe(false);
      
      updateContentSpy.mockRestore();
    });

    it('should not update content when opening if no state changes', () => {
      contentManager.stateChangedWhileClosed = false;
      contentManager.isOpen = false;
      
      const updateContentSpy = jest.spyOn(contentManager, 'updateContent').mockResolvedValue();
      
      contentManager.setIsOpen(true);
      
      expect(updateContentSpy).not.toHaveBeenCalled();
      
      updateContentSpy.mockRestore();
    });
  });

  describe('updateContent()', () => {
    beforeEach(() => {
      contentManager.setIsOpen(true);
    });

    it('should not update when panel closed', async () => {
      contentManager.setIsOpen(false);
      await contentManager.updateContent();
      // v1.6.2+ - MIGRATION: fallback uses storage.local
      expect(mockBrowser.storage.local.get).not.toHaveBeenCalled();
    });

    it('should fetch and render Quick Tabs', async () => {
      const mockState = {
        'firefox-default': {
          tabs: [{ id: '1', title: 'Tab 1', url: 'https://example.com' }],
          lastUpdate: Date.now()
        }
      };

      // v1.6.2+ - MIGRATION: fallback uses storage.local
      mockBrowser.storage.local.get.mockResolvedValue({
        quick_tabs_state_v2: { containers: mockState }
      });

      await contentManager.updateContent();

      expect(mockBrowser.storage.local.get).toHaveBeenCalledWith('quick_tabs_state_v2');
      // v1.6.0.3 - Check static method instead
      expect(PanelUIBuilder.renderContainerSection).toHaveBeenCalled();
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

      // v1.6.2+ - MIGRATION: fallback uses storage.local
      mockBrowser.storage.local.get.mockResolvedValue({
        quick_tabs_state_v2: mockState
      });

      await contentManager.updateContent();

      // v1.6.0.3 - Check static method instead
      expect(PanelUIBuilder.renderContainerSection).toHaveBeenCalled();
    });

    it('should show empty state when no tabs', async () => {
      const mockState = {
        'firefox-default': {
          tabs: [],
          lastUpdate: Date.now()
        }
      };

      // v1.6.2+ - MIGRATION: fallback uses storage.local
      mockBrowser.storage.local.get.mockResolvedValue({
        quick_tabs_state_v2: { containers: mockState }
      });

      await contentManager.updateContent();

      const emptyState = panelElement.querySelector('#panel-emptyState');
      const containersList = panelElement.querySelector('#panel-containersList');

      expect(emptyState.style.display).toBe('flex');
      expect(containersList.style.display).toBe('none');
    });

    it('should handle storage errors gracefully', async () => {
      // v1.6.2+ - MIGRATION: fallback uses storage.local
      mockBrowser.storage.local.get.mockRejectedValue(new Error('Storage error'));
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

      // v1.6.2+ - MIGRATION: fallback uses storage.local
      mockBrowser.storage.local.get.mockResolvedValue({
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

      // v1.6.2+ - MIGRATION: fallback uses storage.local
      mockBrowser.storage.local.get.mockResolvedValue({
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
      // v1.6.2.3 - Check static method with expected container format
      // Note: _renderContainerSectionFromData creates a new containerState with tabs array
      expect(PanelUIBuilder.renderContainerSection).toHaveBeenCalledWith(
        'firefox-container-1',
        expect.objectContaining({ name: 'Personal' }),
        expect.objectContaining({
          tabs: expect.arrayContaining([expect.objectContaining({ id: '1' })]),
          lastUpdate: expect.any(Number)
        })
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

    it('should setup storage change listener for cross-tab sync', () => {
      contentManager.setupEventListeners();

      expect(mockBrowser.storage.onChanged.addListener).toHaveBeenCalled();
      expect(contentManager._storageListener).toBeDefined();
      expect(typeof contentManager._storageListener).toBe('function');
    });

    it('should update content when storage changes and panel is open', () => {
      contentManager.setupEventListeners();
      contentManager.isOpen = true;
      
      const updateContentSpy = jest.spyOn(contentManager, 'updateContent').mockResolvedValue();
      
      // Get the storage listener and call it
      const storageListener = contentManager._storageListener;
      storageListener({ quick_tabs_state_v2: { newValue: {} } }, 'local');
      
      expect(updateContentSpy).toHaveBeenCalled();
      
      updateContentSpy.mockRestore();
    });

    it('should track state changes when storage changes and panel is closed', () => {
      contentManager.setupEventListeners();
      contentManager.isOpen = false;
      contentManager.stateChangedWhileClosed = false;
      
      const updateContentSpy = jest.spyOn(contentManager, 'updateContent').mockResolvedValue();
      
      // Get the storage listener and call it
      const storageListener = contentManager._storageListener;
      storageListener({ quick_tabs_state_v2: { newValue: {} } }, 'local');
      
      expect(updateContentSpy).not.toHaveBeenCalled();
      expect(contentManager.stateChangedWhileClosed).toBe(true);
      
      updateContentSpy.mockRestore();
    });

    it('should ignore non-local storage changes', () => {
      contentManager.setupEventListeners();
      contentManager.isOpen = true;
      
      const updateContentSpy = jest.spyOn(contentManager, 'updateContent').mockResolvedValue();
      
      // Get the storage listener and call it with 'sync' area
      const storageListener = contentManager._storageListener;
      storageListener({ quick_tabs_state_v2: { newValue: {} } }, 'sync');
      
      expect(updateContentSpy).not.toHaveBeenCalled();
      
      updateContentSpy.mockRestore();
    });

    it('should ignore storage changes for other keys', () => {
      contentManager.setupEventListeners();
      contentManager.isOpen = true;
      
      const updateContentSpy = jest.spyOn(contentManager, 'updateContent').mockResolvedValue();
      
      // Get the storage listener and call it with a different key
      const storageListener = contentManager._storageListener;
      storageListener({ some_other_key: { newValue: {} } }, 'local');
      
      expect(updateContentSpy).not.toHaveBeenCalled();
      
      updateContentSpy.mockRestore();
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

      // v1.6.2+ - MIGRATION: Use storage.local
      mockBrowser.storage.local.get.mockResolvedValue({
        quick_tabs_state_v2: mockState
      });

      await contentManager.handleCloseMinimized();

      expect(mockBrowser.storage.local.set).toHaveBeenCalled();
      const savedState = mockBrowser.storage.local.set.mock.calls[0][0];
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

      // v1.6.2+ - MIGRATION: Use storage.local
      mockBrowser.storage.local.get.mockResolvedValue({
        quick_tabs_state_v2: mockState
      });

      await contentManager.handleCloseMinimized();

      expect(mockBrowser.storage.local.set).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      // v1.6.2+ - MIGRATION: Use storage.local
      mockBrowser.storage.local.get.mockRejectedValue(new Error('Storage error'));
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      await contentManager.handleCloseMinimized();

      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  describe('handleCloseAll()', () => {
    it('should clear all tabs', async () => {
      await contentManager.handleCloseAll();

      // v1.6.2+ - MIGRATION: Use storage.local
      // v1.6.2.2 - Updated for unified format (tabs array instead of containers)
      expect(mockBrowser.storage.local.set).toHaveBeenCalled();
      const savedState = mockBrowser.storage.local.set.mock.calls[0][0];
      expect(savedState.quick_tabs_state_v2.tabs).toBeDefined();
      expect(savedState.quick_tabs_state_v2.tabs).toEqual([]);
    });

    it('should NOT send message to background (v1.6.2+ uses storage.onChanged)', async () => {
      // v1.6.2+ - Cross-tab sync happens via storage.onChanged, not message passing
      await contentManager.handleCloseAll();

      // The CLEAR_ALL_QUICK_TABS message is no longer sent
      expect(mockBrowser.runtime.sendMessage).not.toHaveBeenCalledWith({
        action: 'CLEAR_ALL_QUICK_TABS'
      });
    });

    it('should handle session storage', async () => {
      await contentManager.handleCloseAll();

      expect(mockBrowser.storage.session.set).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      // v1.6.2+ - MIGRATION: Use storage.local
      mockBrowser.storage.local.set.mockRejectedValue(new Error('Storage error'));
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      await contentManager.handleCloseAll();

      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  describe('handleGoToTab()', () => {
    it('should activate tab', async () => {
      mockBrowser.runtime.sendMessage.mockResolvedValue({ success: true });

      await contentManager.handleGoToTab(123);

      expect(mockBrowser.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'SWITCH_TO_TAB',
        tabId: 123
      });
    });

    it('should handle errors', async () => {
      mockBrowser.runtime.sendMessage.mockRejectedValue(new Error('Tab error'));
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

    it('should remove storage change listener on destroy', () => {
      contentManager.setupEventListeners();
      
      // Verify listener was added
      expect(mockBrowser.storage.onChanged.addListener).toHaveBeenCalled();
      expect(contentManager._storageListener).toBeDefined();
      
      const storageListener = contentManager._storageListener;
      
      contentManager.destroy();
      
      // Verify listener was removed
      expect(mockBrowser.storage.onChanged.removeListener).toHaveBeenCalledWith(storageListener);
      expect(contentManager._storageListener).toBeNull();
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

      // v1.6.2+ - MIGRATION: fallback uses storage.local
      mockBrowser.storage.local.get.mockResolvedValue({
        quick_tabs_state_v2: mockState
      });

      // Update content
      await contentManager.updateContent();

      // v1.6.0.3 - Check static method instead
      expect(PanelUIBuilder.renderContainerSection).toHaveBeenCalled();

      // Test action
      await contentManager.handleMinimizeTab('1');
      expect(mockQuickTabsManager.minimizeById).toHaveBeenCalledWith('1');

      // Cleanup
      contentManager.destroy();
      expect(contentManager.eventListeners).toEqual([]);
    });
  });
});
