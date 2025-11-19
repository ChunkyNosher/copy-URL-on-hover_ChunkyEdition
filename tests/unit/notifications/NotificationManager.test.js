/**
 * Unit tests for NotificationManager (notifications/index.js)
 * Tests notification routing, initialization, and config management
 */

import {
  initNotifications,
  notificationManager
} from '../../../src/features/notifications/index.js';
import { showToast } from '../../../src/features/notifications/toast.js';
import { showTooltip } from '../../../src/features/notifications/tooltip.js';

// Mock the toast and tooltip modules
jest.mock('../../../src/features/notifications/toast.js');
jest.mock('../../../src/features/notifications/tooltip.js');

describe('NotificationManager', () => {
  let mockConfig;
  let mockStateManager;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Mock console methods
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();

    // Mock config
    mockConfig = {
      showNotification: true,
      notifDisplayMode: 'toast',
      notifPosition: 'bottom-right',
      notifAnimation: 'slide',
      notifDuration: 2000,
      notifColor: '#333',
      notifBorderColor: '#444',
      notifBorderWidth: 1,
      tooltipColor: '#333',
      tooltipAnimation: 'fade',
      tooltipDuration: 1000
    };

    // Mock state manager
    mockStateManager = {
      get: jest.fn(key => {
        if (key === 'lastMouseX') return 100;
        if (key === 'lastMouseY') return 200;
        return null;
      })
    };

    // Reset notification manager state
    notificationManager.config = null;
    notificationManager.stateManager = null;
    notificationManager.styleInjected = false;

    // Clean up any existing style elements
    const existingStyle = document.getElementById('cuo-notification-styles');
    if (existingStyle) {
      existingStyle.remove();
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('initNotifications()', () => {
    test('should initialize notification manager with config and state manager', () => {
      const manager = initNotifications(mockConfig, mockStateManager);

      expect(manager).toBe(notificationManager);
      expect(notificationManager.config).toBe(mockConfig);
      expect(notificationManager.stateManager).toBe(mockStateManager);
    });

    test('should inject CSS styles on initialization', () => {
      initNotifications(mockConfig, mockStateManager);

      const styleElement = document.getElementById('cuo-notification-styles');
      expect(styleElement).toBeDefined();
      expect(styleElement.tagName).toBe('STYLE');
      expect(styleElement.textContent).toContain('@keyframes slideInRight');
    });

    test('should log initialization messages', () => {
      initNotifications(mockConfig, mockStateManager);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Initializing'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('initialized'));
    });

    test('should return notificationManager instance', () => {
      const result = initNotifications(mockConfig, mockStateManager);

      expect(result).toBe(notificationManager);
    });
  });

  describe('injectStyles()', () => {
    test('should inject CSS styles into document head', () => {
      notificationManager.injectStyles();

      const styleElement = document.getElementById('cuo-notification-styles');
      expect(styleElement).toBeDefined();
      expect(styleElement.parentElement).toBe(document.head);
    });

    test('should set styleInjected flag to true', () => {
      expect(notificationManager.styleInjected).toBe(false);

      notificationManager.injectStyles();

      expect(notificationManager.styleInjected).toBe(true);
    });

    test('should not inject styles multiple times', () => {
      notificationManager.injectStyles();
      const firstElement = document.getElementById('cuo-notification-styles');

      notificationManager.injectStyles();
      const secondElement = document.getElementById('cuo-notification-styles');

      expect(firstElement).toBe(secondElement);
      expect(document.querySelectorAll('#cuo-notification-styles').length).toBe(1);
    });

    test('should inject notification CSS with animations', () => {
      notificationManager.injectStyles();

      const styleElement = document.getElementById('cuo-notification-styles');
      const css = styleElement.textContent;

      expect(css).toContain('@keyframes slideInRight');
      expect(css).toContain('@keyframes slideInLeft');
      expect(css).toContain('@keyframes fadeIn');
      expect(css).toContain('@keyframes bounce');
    });

    test('should inject CSS classes for animations', () => {
      notificationManager.injectStyles();

      const styleElement = document.getElementById('cuo-notification-styles');
      const css = styleElement.textContent;

      expect(css).toContain('.cuo-anim-slide');
      expect(css).toContain('.cuo-anim-fade');
      expect(css).toContain('.cuo-anim-bounce');
    });

    test('should inject base styles for tooltip and toast', () => {
      notificationManager.injectStyles();

      const styleElement = document.getElementById('cuo-notification-styles');
      const css = styleElement.textContent;

      expect(css).toContain('.cuo-tooltip');
      expect(css).toContain('.cuo-toast');
    });
  });

  describe('showNotification()', () => {
    beforeEach(() => {
      notificationManager.init(mockConfig, mockStateManager);
    });

    test('should route to toast when notifDisplayMode is toast', () => {
      mockConfig.notifDisplayMode = 'toast';

      notificationManager.showNotification('Test message', 'info');

      expect(showToast).toHaveBeenCalledWith('Test message', 'info', mockConfig);
      expect(showTooltip).not.toHaveBeenCalled();
    });

    test('should route to tooltip when notifDisplayMode is tooltip', () => {
      mockConfig.notifDisplayMode = 'tooltip';

      notificationManager.showNotification('Test message');

      expect(showTooltip).toHaveBeenCalledWith('Test message', mockConfig, mockStateManager);
      expect(showToast).not.toHaveBeenCalled();
    });

    test('should use default type "info" if not provided', () => {
      notificationManager.showNotification('Test message');

      // When type not provided, it defaults to 'info'
      expect(showToast).toHaveBeenCalledWith('Test message', 'info', mockConfig);
    });

    test('should pass custom type to toast', () => {
      notificationManager.showNotification('Error message', 'error');

      expect(showToast).toHaveBeenCalledWith('Error message', 'error', mockConfig);
    });

    test('should not show notification when showNotification is false', () => {
      mockConfig.showNotification = false;

      notificationManager.showNotification('Test message');

      expect(showToast).not.toHaveBeenCalled();
      expect(showTooltip).not.toHaveBeenCalled();
    });

    test('should not show notification when config is null', () => {
      notificationManager.config = null;

      notificationManager.showNotification('Test message');

      expect(showToast).not.toHaveBeenCalled();
      expect(showTooltip).not.toHaveBeenCalled();
    });

    test('should log when notifications are disabled', () => {
      mockConfig.showNotification = false;

      notificationManager.showNotification('Test message');

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('disabled'));
    });

    test('should log notification details when showing', () => {
      notificationManager.showNotification('Test message', 'warning');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Showing notification'),
        'Test message',
        'warning'
      );
    });
  });

  describe('showTooltip()', () => {
    beforeEach(() => {
      notificationManager.init(mockConfig, mockStateManager);
    });

    test('should call showTooltip with message, config, and stateManager', () => {
      notificationManager.showTooltip('Tooltip message');

      expect(showTooltip).toHaveBeenCalledWith('Tooltip message', mockConfig, mockStateManager);
    });

    test('should work without initialization (graceful degradation)', () => {
      // Create a fresh manager without init
      const freshManager = new notificationManager.constructor();
      freshManager.config = mockConfig;
      freshManager.stateManager = mockStateManager;

      freshManager.showTooltip('Test');

      expect(showTooltip).toHaveBeenCalled();
    });
  });

  describe('showToast()', () => {
    beforeEach(() => {
      notificationManager.init(mockConfig, mockStateManager);
    });

    test('should call showToast with message, type, and config', () => {
      notificationManager.showToast('Toast message', 'success');

      expect(showToast).toHaveBeenCalledWith('Toast message', 'success', mockConfig);
    });

    test('should use default type "info" if not provided', () => {
      notificationManager.showToast('Toast message');

      expect(showToast).toHaveBeenCalledWith('Toast message', 'info', mockConfig);
    });

    test('should work with custom types', () => {
      const types = ['info', 'success', 'warning', 'error'];

      types.forEach(type => {
        notificationManager.showToast(`Message ${type}`, type);
        expect(showToast).toHaveBeenCalledWith(`Message ${type}`, type, mockConfig);
      });
    });
  });

  describe('updateConfig()', () => {
    beforeEach(() => {
      notificationManager.init(mockConfig, mockStateManager);
    });

    test('should update config reference', () => {
      const newConfig = { ...mockConfig, notifDuration: 3000 };

      notificationManager.updateConfig(newConfig);

      expect(notificationManager.config).toBe(newConfig);
      expect(notificationManager.config.notifDuration).toBe(3000);
    });

    test('should log configuration update', () => {
      const newConfig = { ...mockConfig };

      notificationManager.updateConfig(newConfig);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Configuration updated'));
    });

    test('should accept partial config updates', () => {
      const partialConfig = { showNotification: false };

      notificationManager.updateConfig(partialConfig);

      expect(notificationManager.config).toBe(partialConfig);
    });

    test('should accept null config', () => {
      notificationManager.updateConfig(null);

      expect(notificationManager.config).toBeNull();
    });
  });

  describe('Singleton Pattern', () => {
    test('should export the same instance', () => {
      const manager1 = initNotifications(mockConfig, mockStateManager);
      const manager2 = initNotifications(mockConfig, mockStateManager);

      expect(manager1).toBe(manager2);
      expect(manager1).toBe(notificationManager);
    });

    test('should maintain state across imports', () => {
      notificationManager.init(mockConfig, mockStateManager);

      expect(notificationManager.config).toBe(mockConfig);

      // Simulate another import
      const {
        notificationManager: imported
      } = require('../../../src/features/notifications/index.js');

      expect(imported.config).toBe(mockConfig);
    });
  });

  describe('Edge Cases', () => {
    test('should handle null config gracefully', () => {
      expect(() => {
        notificationManager.init(null, mockStateManager);
      }).not.toThrow();

      expect(notificationManager.config).toBeNull();
    });

    test('should handle null stateManager gracefully', () => {
      expect(() => {
        notificationManager.init(mockConfig, null);
      }).not.toThrow();

      expect(notificationManager.stateManager).toBeNull();
    });

    test('should handle showNotification with empty message', () => {
      notificationManager.init(mockConfig, mockStateManager);

      notificationManager.showNotification('');

      expect(showToast).toHaveBeenCalledWith('', 'info', mockConfig);
    });

    test('should handle showNotification with null message', () => {
      notificationManager.init(mockConfig, mockStateManager);

      notificationManager.showNotification(null);

      expect(showToast).toHaveBeenCalledWith(null, 'info', mockConfig);
    });

    test('should handle undefined notifDisplayMode', () => {
      mockConfig.notifDisplayMode = undefined;
      notificationManager.init(mockConfig, mockStateManager);

      notificationManager.showNotification('Test');

      // Should default to toast (else branch)
      expect(showToast).toHaveBeenCalled();
    });

    test('should handle multiple initializations', () => {
      initNotifications(mockConfig, mockStateManager);
      initNotifications(mockConfig, mockStateManager);
      initNotifications(mockConfig, mockStateManager);

      // Should still only inject styles once
      const styleElements = document.querySelectorAll('#cuo-notification-styles');
      expect(styleElements.length).toBe(1);
    });
  });

  describe('Integration', () => {
    test('should coordinate notification display flow', () => {
      // Initialize
      const manager = initNotifications(mockConfig, mockStateManager);

      // Show notification
      manager.showNotification('Integration test', 'success');

      // Verify the flow
      expect(showToast).toHaveBeenCalledWith('Integration test', 'success', mockConfig);
    });

    test('should switch between toast and tooltip based on config', () => {
      notificationManager.init(mockConfig, mockStateManager);

      // Start with toast
      mockConfig.notifDisplayMode = 'toast';
      notificationManager.showNotification('Test 1');
      expect(showToast).toHaveBeenCalledTimes(1);

      // Switch to tooltip
      mockConfig.notifDisplayMode = 'tooltip';
      notificationManager.showNotification('Test 2');
      expect(showTooltip).toHaveBeenCalledTimes(1);

      // Back to toast
      mockConfig.notifDisplayMode = 'toast';
      notificationManager.showNotification('Test 3');
      expect(showToast).toHaveBeenCalledTimes(2);
    });

    test('should properly inject styles before showing notifications', () => {
      notificationManager.init(mockConfig, mockStateManager);

      expect(document.getElementById('cuo-notification-styles')).toBeDefined();

      notificationManager.showNotification('Test');

      expect(showToast).toHaveBeenCalled();
    });
  });
});
