/**
 * Tests for PanelUIBuilder Component
 * Phase 2.10 - Manager Panel UI Refactoring
 */

import { PanelUIBuilder } from '../../../src/features/quick-tabs/panel/PanelUIBuilder.js';

describe('PanelUIBuilder', () => {
  beforeEach(() => {
    // Clear document for each test
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  describe('injectStyles', () => {
    it('should inject styles into document head', () => {
      const result = PanelUIBuilder.injectStyles();

      expect(result).toBe(true);
      const styleEl = document.getElementById('quick-tabs-manager-panel-styles');
      expect(styleEl).not.toBeNull();
      expect(styleEl.tagName).toBe('STYLE');
      expect(styleEl.textContent).toContain('.quick-tabs-manager-panel');
    });

    it('should not inject styles twice', () => {
      PanelUIBuilder.injectStyles();
      const result = PanelUIBuilder.injectStyles();

      expect(result).toBe(false);
      const styleEls = document.querySelectorAll('#quick-tabs-manager-panel-styles');
      expect(styleEls.length).toBe(1);
    });

    it('should inject complete CSS with all panel styles', () => {
      PanelUIBuilder.injectStyles();
      
      const styleEl = document.getElementById('quick-tabs-manager-panel-styles');
      expect(styleEl.textContent).toContain('.panel-header');
      expect(styleEl.textContent).toContain('.panel-actions');
      expect(styleEl.textContent).toContain('.panel-quick-tab-item');
      expect(styleEl.textContent).toContain('.panel-resize-handle');
    });
  });

  describe('createPanel', () => {
    it('should create panel with default state', () => {
      const state = {
        left: 20,
        top: 100,
        width: 350,
        height: 500,
        isOpen: false
      };

      const panel = PanelUIBuilder.createPanel(state);

      expect(panel).not.toBeNull();
      expect(panel.id).toBe('quick-tabs-manager-panel');
      expect(panel.style.left).toBe('20px');
      expect(panel.style.top).toBe('100px');
      expect(panel.style.width).toBe('350px');
      expect(panel.style.height).toBe('500px');
      expect(panel.style.display).toBe('none');
    });

    it('should create panel with open state', () => {
      const state = {
        left: 50,
        top: 150,
        width: 400,
        height: 600,
        isOpen: true
      };

      const panel = PanelUIBuilder.createPanel(state);

      expect(panel.style.display).toBe('flex');
    });

    it('should create panel with all required sections', () => {
      const state = { left: 20, top: 100, width: 350, height: 500, isOpen: false };
      const panel = PanelUIBuilder.createPanel(state);

      expect(panel.querySelector('.panel-header')).not.toBeNull();
      expect(panel.querySelector('.panel-actions')).not.toBeNull();
      expect(panel.querySelector('.panel-stats')).not.toBeNull();
      expect(panel.querySelector('#panel-containersList')).not.toBeNull();
      expect(panel.querySelector('#panel-emptyState')).not.toBeNull();
    });

    it('should create panel with action buttons', () => {
      const state = { left: 20, top: 100, width: 350, height: 500, isOpen: false };
      const panel = PanelUIBuilder.createPanel(state);

      const closeMinBtn = panel.querySelector('#panel-closeMinimized');
      const closeAllBtn = panel.querySelector('#panel-closeAll');

      expect(closeMinBtn).not.toBeNull();
      expect(closeAllBtn).not.toBeNull();
      expect(closeMinBtn.textContent.trim()).toBe('Close Minimized');
      expect(closeAllBtn.textContent.trim()).toBe('Close All');
    });
  });

  describe('renderContainerSection', () => {
    it('should render container section with header', () => {
      const containerInfo = {
        name: 'Personal',
        icon: '🔒',
        color: 'blue'
      };
      const containerState = {
        tabs: [
          { id: '1', title: 'Tab 1', url: 'https://example.com', minimized: false }
        ]
      };

      const section = PanelUIBuilder.renderContainerSection(
        'firefox-container-1',
        containerInfo,
        containerState
      );

      expect(section).not.toBeNull();
      expect(section.className).toBe('panel-container-section');
      
      const header = section.querySelector('.panel-container-header');
      expect(header).not.toBeNull();
      expect(header.textContent).toContain('Personal');
      expect(header.textContent).toContain('🔒');
      expect(header.textContent).toContain('(1 tab)');
    });

    it('should render container section with multiple tabs (plural)', () => {
      const containerInfo = { name: 'Work', icon: '💼', color: 'red' };
      const containerState = {
        tabs: [
          { id: '1', title: 'Tab 1', url: 'https://example.com', minimized: false },
          { id: '2', title: 'Tab 2', url: 'https://test.com', minimized: false }
        ]
      };

      const section = PanelUIBuilder.renderContainerSection(
        'firefox-container-2',
        containerInfo,
        containerState
      );

      const header = section.querySelector('.panel-container-header');
      expect(header.textContent).toContain('(2 tabs)');
    });

    it('should separate active and minimized tabs', () => {
      const containerInfo = { name: 'Test', icon: '📁', color: 'green' };
      const containerState = {
        tabs: [
          { id: '1', title: 'Active 1', url: 'https://a.com', minimized: false },
          { id: '2', title: 'Min 1', url: 'https://b.com', minimized: true },
          { id: '3', title: 'Active 2', url: 'https://c.com', minimized: false },
          { id: '4', title: 'Min 2', url: 'https://d.com', minimized: true }
        ]
      };

      const section = PanelUIBuilder.renderContainerSection(
        'firefox-default',
        containerInfo,
        containerState
      );

      const items = section.querySelectorAll('.panel-quick-tab-item');
      expect(items.length).toBe(4);
      
      // First 2 should be active (not minimized)
      expect(items[0].classList.contains('active')).toBe(true);
      expect(items[1].classList.contains('active')).toBe(true);
      
      // Last 2 should be minimized
      expect(items[2].classList.contains('minimized')).toBe(true);
      expect(items[3].classList.contains('minimized')).toBe(true);
    });
  });

  describe('renderQuickTabItem', () => {
    it('should render active Quick Tab item', () => {
      const tab = {
        id: 'qt-123',
        title: 'Example Site',
        url: 'https://example.com',
        activeTabId: 42,
        width: 400,
        height: 300,
        minimized: false
      };

      const item = PanelUIBuilder.renderQuickTabItem(tab, false);

      expect(item).not.toBeNull();
      expect(item.className).toContain('panel-quick-tab-item');
      expect(item.className).toContain('active');
      expect(item.className).not.toContain('minimized');
    });

    it('should render minimized Quick Tab item', () => {
      const tab = {
        id: 'qt-456',
        title: 'Test Site',
        url: 'https://test.com',
        minimized: true
      };

      const item = PanelUIBuilder.renderQuickTabItem(tab, true);

      expect(item.className).toContain('minimized');
      expect(item.className).not.toContain('active');
    });

    it('should handle string "false" as minimized parameter', () => {
      const tab = { id: 'qt-1', title: 'Test', url: 'https://test.com' };
      
      // This tests v1.5.9.8 fix for defensive boolean conversion
      const item = PanelUIBuilder.renderQuickTabItem(tab, 'false');
      
      // String 'false' is truthy, so Boolean('false') === true
      expect(item.className).toContain('minimized');
    });

    it('should render status indicator correctly', () => {
      const activeTab = { id: '1', title: 'A', url: 'https://a.com' };
      const minTab = { id: '2', title: 'B', url: 'https://b.com' };

      const activeItem = PanelUIBuilder.renderQuickTabItem(activeTab, false);
      const minItem = PanelUIBuilder.renderQuickTabItem(minTab, true);

      const activeIndicator = activeItem.querySelector('.panel-status-indicator');
      const minIndicator = minItem.querySelector('.panel-status-indicator');

      expect(activeIndicator.classList.contains('green')).toBe(true);
      expect(minIndicator.classList.contains('yellow')).toBe(true);
    });

    it('should render favicon with correct URL', () => {
      const tab = { id: '1', title: 'GitHub', url: 'https://github.com' };
      const item = PanelUIBuilder.renderQuickTabItem(tab, false);

      const favicon = item.querySelector('.panel-favicon');
      expect(favicon).not.toBeNull();
      expect(favicon.src).toContain('google.com/s2/favicons');
      expect(favicon.src).toContain('domain=github.com');
    });

    it('should handle invalid URL for favicon', () => {
      const tab = { id: '1', title: 'Invalid', url: 'not-a-valid-url' };
      const item = PanelUIBuilder.renderQuickTabItem(tab, false);

      const favicon = item.querySelector('.panel-favicon');
      expect(favicon.style.display).toBe('none');
    });

    it('should render tab title correctly', () => {
      const tab = { id: '1', title: 'My Tab Title', url: 'https://example.com' };
      const item = PanelUIBuilder.renderQuickTabItem(tab, false);

      const title = item.querySelector('.panel-tab-title');
      expect(title.textContent).toBe('My Tab Title');
    });

    it('should use fallback title if missing', () => {
      const tab = { id: '1', url: 'https://example.com' };
      const item = PanelUIBuilder.renderQuickTabItem(tab, false);

      const title = item.querySelector('.panel-tab-title');
      expect(title.textContent).toBe('Quick Tab');
    });

    it('should render meta information for active tab', () => {
      const tab = {
        id: '1',
        title: 'Test',
        url: 'https://test.com',
        activeTabId: 42,
        width: 500,
        height: 400
      };
      const item = PanelUIBuilder.renderQuickTabItem(tab, false);

      const meta = item.querySelector('.panel-tab-meta');
      expect(meta.textContent).toContain('Tab 42');
      expect(meta.textContent).toContain('500×400');
    });

    it('should render meta information for minimized tab', () => {
      const tab = {
        id: '1',
        title: 'Test',
        url: 'https://test.com',
        activeTabId: 10
      };
      const item = PanelUIBuilder.renderQuickTabItem(tab, true);

      const meta = item.querySelector('.panel-tab-meta');
      expect(meta.textContent).toContain('Minimized');
      expect(meta.textContent).toContain('Tab 10');
    });
  });

  describe('Action Buttons', () => {
    it('should render Go to Tab button for active tab with activeTabId', () => {
      const tab = {
        id: 'qt-1',
        title: 'Test',
        url: 'https://test.com',
        activeTabId: 42
      };
      const item = PanelUIBuilder.renderQuickTabItem(tab, false);

      const goToBtn = Array.from(item.querySelectorAll('.panel-btn-icon'))
        .find(btn => btn.dataset.action === 'goToTab');

      expect(goToBtn).not.toBeNull();
      expect(goToBtn.textContent).toBe('🔗');
      expect(goToBtn.dataset.tabId).toBe('42');
    });

    it('should not render Go to Tab button without activeTabId', () => {
      const tab = { id: 'qt-1', title: 'Test', url: 'https://test.com' };
      const item = PanelUIBuilder.renderQuickTabItem(tab, false);

      const goToBtn = Array.from(item.querySelectorAll('.panel-btn-icon'))
        .find(btn => btn.dataset.action === 'goToTab');

      expect(goToBtn).toBeUndefined();
    });

    it('should render Minimize button for active tab', () => {
      const tab = { id: 'qt-1', title: 'Test', url: 'https://test.com' };
      const item = PanelUIBuilder.renderQuickTabItem(tab, false);

      const minBtn = Array.from(item.querySelectorAll('.panel-btn-icon'))
        .find(btn => btn.dataset.action === 'minimize');

      expect(minBtn).not.toBeNull();
      expect(minBtn.textContent).toBe('➖');
      expect(minBtn.dataset.quickTabId).toBe('qt-1');
    });

    it('should render Restore button for minimized tab', () => {
      const tab = { id: 'qt-2', title: 'Test', url: 'https://test.com' };
      const item = PanelUIBuilder.renderQuickTabItem(tab, true);

      const restoreBtn = Array.from(item.querySelectorAll('.panel-btn-icon'))
        .find(btn => btn.dataset.action === 'restore');

      expect(restoreBtn).not.toBeNull();
      expect(restoreBtn.textContent).toBe('↑');
      expect(restoreBtn.dataset.quickTabId).toBe('qt-2');
    });

    it('should always render Close button', () => {
      const activeTab = { id: 'qt-1', title: 'A', url: 'https://a.com' };
      const minTab = { id: 'qt-2', title: 'B', url: 'https://b.com' };

      const activeItem = PanelUIBuilder.renderQuickTabItem(activeTab, false);
      const minItem = PanelUIBuilder.renderQuickTabItem(minTab, true);

      const activeCloseBtn = Array.from(activeItem.querySelectorAll('.panel-btn-icon'))
        .find(btn => btn.dataset.action === 'close');
      const minCloseBtn = Array.from(minItem.querySelectorAll('.panel-btn-icon'))
        .find(btn => btn.dataset.action === 'close');

      expect(activeCloseBtn).not.toBeNull();
      expect(activeCloseBtn.textContent).toBe('✕');
      expect(activeCloseBtn.dataset.quickTabId).toBe('qt-1');

      expect(minCloseBtn).not.toBeNull();
      expect(minCloseBtn.dataset.quickTabId).toBe('qt-2');
    });

    it('should not render Minimize button for minimized tab', () => {
      const tab = { id: 'qt-1', title: 'Test', url: 'https://test.com' };
      const item = PanelUIBuilder.renderQuickTabItem(tab, true);

      const minBtn = Array.from(item.querySelectorAll('.panel-btn-icon'))
        .find(btn => btn.dataset.action === 'minimize');

      expect(minBtn).toBeUndefined();
    });

    it('should not render Restore button for active tab', () => {
      const tab = { id: 'qt-1', title: 'Test', url: 'https://test.com' };
      const item = PanelUIBuilder.renderQuickTabItem(tab, false);

      const restoreBtn = Array.from(item.querySelectorAll('.panel-btn-icon'))
        .find(btn => btn.dataset.action === 'restore');

      expect(restoreBtn).toBeUndefined();
    });
  });

  describe('getContainerIcon', () => {
    it('should return correct emoji for known icon names', () => {
      expect(PanelUIBuilder.getContainerIcon('fingerprint')).toBe('🔒');
      expect(PanelUIBuilder.getContainerIcon('briefcase')).toBe('💼');
      expect(PanelUIBuilder.getContainerIcon('dollar')).toBe('💰');
      expect(PanelUIBuilder.getContainerIcon('cart')).toBe('🛒');
      expect(PanelUIBuilder.getContainerIcon('gift')).toBe('🎁');
      expect(PanelUIBuilder.getContainerIcon('vacation')).toBe('🏖️');
    });

    it('should return default emoji for unknown icon names', () => {
      expect(PanelUIBuilder.getContainerIcon('unknown')).toBe('📁');
      expect(PanelUIBuilder.getContainerIcon('')).toBe('📁');
      expect(PanelUIBuilder.getContainerIcon(null)).toBe('📁');
    });

    it('should handle all mapped icon types', () => {
      const icons = [
        'fingerprint', 'briefcase', 'dollar', 'cart', 'circle', 'gift',
        'vacation', 'food', 'fruit', 'pet', 'tree', 'chill', 'fence'
      ];

      icons.forEach(icon => {
        const result = PanelUIBuilder.getContainerIcon(icon);
        expect(result).toBeTruthy();
        expect(result).not.toBe('📁'); // Should not be default
      });
    });
  });

  describe('Integration', () => {
    it('should create complete panel structure with styles', () => {
      PanelUIBuilder.injectStyles();
      const state = { left: 20, top: 100, width: 350, height: 500, isOpen: true };
      const panel = PanelUIBuilder.createPanel(state);
      document.body.appendChild(panel);

      const styleEl = document.getElementById('quick-tabs-manager-panel-styles');
      expect(styleEl).not.toBeNull();
      expect(panel.parentElement).toBe(document.body);
      expect(panel.style.display).toBe('flex');
    });

    it('should create panel with container section and tab items', () => {
      const state = { left: 20, top: 100, width: 350, height: 500, isOpen: true };
      const panel = PanelUIBuilder.createPanel(state);
      
      const containerInfo = { name: 'Test', icon: '📁', color: 'blue' };
      const containerState = {
        tabs: [
          { id: '1', title: 'Tab 1', url: 'https://a.com', minimized: false },
          { id: '2', title: 'Tab 2', url: 'https://b.com', minimized: true }
        ]
      };
      
      const section = PanelUIBuilder.renderContainerSection(
        'firefox-default',
        containerInfo,
        containerState
      );
      
      const containersList = panel.querySelector('#panel-containersList');
      containersList.appendChild(section);

      expect(containersList.children.length).toBe(1);
      expect(section.querySelectorAll('.panel-quick-tab-item').length).toBe(2);
    });
  });
});
