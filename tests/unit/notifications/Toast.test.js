/**
 * Unit tests for Toast notifications (notifications/toast.js)
 * Tests toast creation, positioning, animations, and lifecycle
 */

import * as domModule from '../../../src/core/dom.js';
import { showToast } from '../../../src/features/notifications/toast.js';

// Mock createElement from dom.js
jest.mock('../../../src/core/dom.js');

describe('Toast Notifications', () => {
  let mockConfig;
  let mockElement;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Mock console
    jest.spyOn(console, 'log').mockImplementation();

    // Mock config
    mockConfig = {
      notifPosition: 'bottom-right',
      notifAnimation: 'slide',
      notifDuration: 2000,
      notifColor: '#333',
      notifBorderColor: '#444',
      notifBorderWidth: 1
    };

    // Mock DOM element
    mockElement = {
      id: 'copy-url-toast',
      style: {},
      remove: jest.fn(),
      classList: {
        add: jest.fn(),
        remove: jest.fn()
      }
    };

    // Mock createElement to return our mock element
    domModule.createElement.mockReturnValue(mockElement);

    // Mock document.body.appendChild
    jest.spyOn(document.body, 'appendChild').mockImplementation();

    // Clean up any existing toast
    const existing = document.getElementById('copy-url-toast');
    if (existing) {
      existing.remove();
    }
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('Toast Creation', () => {
    test('should create toast element with correct structure', () => {
      showToast('Test message', 'info', mockConfig);

      expect(domModule.createElement).toHaveBeenCalledWith(
        'div',
        expect.objectContaining({
          id: 'copy-url-toast',
          className: expect.any(String)
        }),
        'Test message'
      );
    });

    test('should append toast to document body', () => {
      showToast('Test message', 'info', mockConfig);

      expect(document.body.appendChild).toHaveBeenCalledWith(mockElement);
    });

    test('should apply correct styles from config', () => {
      showToast('Test message', 'info', mockConfig);

      const call = domModule.createElement.mock.calls[0];
      const props = call[1];

      expect(props.style.backgroundColor).toBe('#333');
      expect(props.style.border).toContain('#444');
    });

    test('should use default styles when config values missing', () => {
      const minimalConfig = {};

      showToast('Test', 'info', minimalConfig);

      const call = domModule.createElement.mock.calls[0];
      const props = call[1];

      expect(props.style.backgroundColor).toBe('#333');
      expect(props.style.border).toContain('#444');
    });
  });

  describe('Positioning', () => {
    test('should position toast at bottom-right by default', () => {
      mockConfig.notifPosition = 'bottom-right';

      showToast('Test', 'info', mockConfig);

      const call = domModule.createElement.mock.calls[0];
      const style = call[1].style;

      expect(style.bottom).toBe('20px');
      expect(style.right).toBe('20px');
      expect(style.top).toBeUndefined();
      expect(style.left).toBeUndefined();
    });

    test('should position toast at top-left', () => {
      mockConfig.notifPosition = 'top-left';

      showToast('Test', 'info', mockConfig);

      const call = domModule.createElement.mock.calls[0];
      const style = call[1].style;

      expect(style.top).toBe('20px');
      expect(style.left).toBe('20px');
      expect(style.bottom).toBeUndefined();
      expect(style.right).toBeUndefined();
    });

    test('should position toast at top-right', () => {
      mockConfig.notifPosition = 'top-right';

      showToast('Test', 'info', mockConfig);

      const call = domModule.createElement.mock.calls[0];
      const style = call[1].style;

      expect(style.top).toBe('20px');
      expect(style.right).toBe('20px');
    });

    test('should position toast at bottom-left', () => {
      mockConfig.notifPosition = 'bottom-left';

      showToast('Test', 'info', mockConfig);

      const call = domModule.createElement.mock.calls[0];
      const style = call[1].style;

      expect(style.bottom).toBe('20px');
      expect(style.left).toBe('20px');
    });

    test('should fallback to bottom-right for invalid position', () => {
      mockConfig.notifPosition = 'invalid-position';

      showToast('Test', 'info', mockConfig);

      const call = domModule.createElement.mock.calls[0];
      const style = call[1].style;

      expect(style.bottom).toBe('20px');
      expect(style.right).toBe('20px');
    });

    test('should use fixed positioning', () => {
      showToast('Test', 'info', mockConfig);

      const call = domModule.createElement.mock.calls[0];
      const style = call[1].style;

      expect(style.position).toBe('fixed');
    });

    test('should have high z-index', () => {
      showToast('Test', 'info', mockConfig);

      const call = domModule.createElement.mock.calls[0];
      const style = call[1].style;

      expect(style.zIndex).toBe('999999998');
    });
  });

  describe('Animations', () => {
    test('should use slide animation class when configured', () => {
      mockConfig.notifAnimation = 'slide';

      showToast('Test', 'info', mockConfig);

      const call = domModule.createElement.mock.calls[0];
      expect(call[1].className).toBe('cuo-anim-slide');
    });

    test('should use fade animation class when configured', () => {
      mockConfig.notifAnimation = 'fade';

      showToast('Test', 'info', mockConfig);

      const call = domModule.createElement.mock.calls[0];
      expect(call[1].className).toBe('cuo-anim-fade');
    });

    test('should use bounce animation class when configured', () => {
      mockConfig.notifAnimation = 'bounce';

      showToast('Test', 'info', mockConfig);

      const call = domModule.createElement.mock.calls[0];
      expect(call[1].className).toBe('cuo-anim-bounce');
    });

    test('should default to fade animation', () => {
      mockConfig.notifAnimation = 'unknown';

      showToast('Test', 'info', mockConfig);

      const call = domModule.createElement.mock.calls[0];
      expect(call[1].className).toBe('cuo-anim-fade');
    });

    test('should handle missing animation config', () => {
      delete mockConfig.notifAnimation;

      showToast('Test', 'info', mockConfig);

      const call = domModule.createElement.mock.calls[0];
      expect(call[1].className).toBe('cuo-anim-fade');
    });
  });

  describe('Styling', () => {
    test('should apply custom background color', () => {
      mockConfig.notifColor = '#ff0000';

      showToast('Test', 'info', mockConfig);

      const call = domModule.createElement.mock.calls[0];
      expect(call[1].style.backgroundColor).toBe('#ff0000');
    });

    test('should apply custom border color', () => {
      mockConfig.notifBorderColor = '#00ff00';

      showToast('Test', 'info', mockConfig);

      const call = domModule.createElement.mock.calls[0];
      expect(call[1].style.border).toContain('#00ff00');
    });

    test('should apply custom border width', () => {
      mockConfig.notifBorderWidth = 3;

      showToast('Test', 'info', mockConfig);

      const call = domModule.createElement.mock.calls[0];
      expect(call[1].style.border).toBe('3px solid #444');
    });

    test('should parse border width from string', () => {
      mockConfig.notifBorderWidth = '5';

      showToast('Test', 'info', mockConfig);

      const call = domModule.createElement.mock.calls[0];
      expect(call[1].style.border).toBe('5px solid #444');
    });

    test('should default border width to 1 if invalid', () => {
      mockConfig.notifBorderWidth = 'invalid';

      showToast('Test', 'info', mockConfig);

      const call = domModule.createElement.mock.calls[0];
      expect(call[1].style.border).toBe('1px solid #444');
    });

    test('should apply box shadow', () => {
      showToast('Test', 'info', mockConfig);

      const call = domModule.createElement.mock.calls[0];
      expect(call[1].style.boxShadow).toContain('rgba');
    });

    test('should set pointer-events to none', () => {
      showToast('Test', 'info', mockConfig);

      const call = domModule.createElement.mock.calls[0];
      expect(call[1].style.pointerEvents).toBe('none');
    });
  });

  describe('Auto-Dismiss', () => {
    test('should start fade out after configured duration', () => {
      mockConfig.notifDuration = 2000;

      showToast('Test', 'info', mockConfig);

      // Fast-forward to just before duration
      jest.advanceTimersByTime(1999);
      expect(mockElement.style.opacity).not.toBe('0');

      // Fast-forward past duration
      jest.advanceTimersByTime(1);
      expect(mockElement.style.opacity).toBe('0');
    });

    test('should remove element after fade out completes', () => {
      mockConfig.notifDuration = 2000;

      showToast('Test', 'info', mockConfig);

      // Fast-forward through duration and fade
      jest.advanceTimersByTime(2000); // Duration
      jest.advanceTimersByTime(300); // Fade out

      expect(mockElement.remove).toHaveBeenCalled();
    });

    test('should use default duration if not configured', () => {
      delete mockConfig.notifDuration;

      showToast('Test', 'info', mockConfig);

      jest.advanceTimersByTime(2000);
      expect(mockElement.style.opacity).toBe('0');
    });

    test('should apply fade transition', () => {
      showToast('Test', 'info', mockConfig);

      jest.advanceTimersByTime(mockConfig.notifDuration);

      expect(mockElement.style.transition).toBe('opacity 0.3s');
    });

    test('should handle custom duration values', () => {
      mockConfig.notifDuration = 5000;

      showToast('Test', 'info', mockConfig);

      jest.advanceTimersByTime(4999);
      expect(mockElement.style.opacity).not.toBe('0');

      jest.advanceTimersByTime(1);
      expect(mockElement.style.opacity).toBe('0');
    });
  });

  describe('Multiple Toasts', () => {
    test('should remove existing toast before showing new one', () => {
      // Create first toast
      const firstElement = document.createElement('div');
      firstElement.id = 'copy-url-toast';
      firstElement.remove = jest.fn();
      jest.spyOn(document, 'getElementById').mockReturnValue(firstElement);

      showToast('First', 'info', mockConfig);

      expect(firstElement.remove).toHaveBeenCalled();
    });

    test('should handle no existing toast gracefully', () => {
      jest.spyOn(document, 'getElementById').mockReturnValue(null);

      expect(() => {
        showToast('Test', 'info', mockConfig);
      }).not.toThrow();
    });
  });

  describe('Message Content', () => {
    test('should display provided message', () => {
      const message = 'URL copied to clipboard!';

      showToast(message, 'info', mockConfig);

      const call = domModule.createElement.mock.calls[0];
      expect(call[2]).toBe(message);
    });

    test('should handle empty message', () => {
      showToast('', 'info', mockConfig);

      const call = domModule.createElement.mock.calls[0];
      expect(call[2]).toBe('');
    });

    test('should handle long messages', () => {
      const longMessage = 'A'.repeat(200);

      showToast(longMessage, 'info', mockConfig);

      const call = domModule.createElement.mock.calls[0];
      expect(call[2]).toBe(longMessage);
    });

    test('should handle special characters', () => {
      const specialMessage = '<script>alert("xss")</script>';

      showToast(specialMessage, 'info', mockConfig);

      // createElement should receive the raw message
      // (XSS prevention happens in createElement implementation)
      const call = domModule.createElement.mock.calls[0];
      expect(call[2]).toBe(specialMessage);
    });
  });

  describe('Logging', () => {
    test('should log toast display', () => {
      showToast('Test message', 'info', mockConfig);

      expect(console.log).toHaveBeenCalledWith('[Toast] Displayed:', 'Test message');
    });

    test('should log for all message types', () => {
      const types = ['info', 'success', 'warning', 'error'];

      types.forEach(type => {
        showToast(`Message ${type}`, type, mockConfig);
      });

      expect(console.log).toHaveBeenCalledTimes(types.length);
    });
  });

  describe('Edge Cases', () => {
    test('should handle null config gracefully', () => {
      expect(() => {
        showToast('Test', 'info', null);
      }).not.toThrow();
    });

    test('should handle undefined config gracefully', () => {
      expect(() => {
        showToast('Test', 'info', undefined);
      }).not.toThrow();
    });

    test('should handle null message', () => {
      showToast(null, 'info', mockConfig);

      const call = domModule.createElement.mock.calls[0];
      expect(call[2]).toBeNull();
    });

    test('should handle undefined type', () => {
      expect(() => {
        showToast('Test', undefined, mockConfig);
      }).not.toThrow();
    });

    test('should handle zero duration', () => {
      mockConfig.notifDuration = 0;

      showToast('Test', 'info', mockConfig);

      // Need to run timers to execute setTimeout with 0ms
      jest.runAllTimers();
      expect(mockElement.style.opacity).toBe('0');
    });

    test('should handle negative duration', () => {
      mockConfig.notifDuration = -1000;

      showToast('Test', 'info', mockConfig);

      // Should still set timeout (setTimeout handles negative as 0)
      jest.advanceTimersByTime(0);
      expect(mockElement.style.opacity).toBe('0');
    });

    test('should handle empty config object', () => {
      expect(() => {
        showToast('Test', 'info', {});
      }).not.toThrow();
    });
  });

  describe('Integration', () => {
    test('should complete full toast lifecycle', () => {
      showToast('Integration test', 'success', mockConfig);

      // Verify creation
      expect(domModule.createElement).toHaveBeenCalled();
      expect(document.body.appendChild).toHaveBeenCalled();

      // Fast-forward through duration
      jest.advanceTimersByTime(mockConfig.notifDuration);
      expect(mockElement.style.opacity).toBe('0');

      // Fast-forward through fade
      jest.advanceTimersByTime(300);
      expect(mockElement.remove).toHaveBeenCalled();
    });

    test('should handle rapid successive toasts', () => {
      showToast('First', 'info', mockConfig);
      showToast('Second', 'info', mockConfig);
      showToast('Third', 'info', mockConfig);

      // Should have created 3 toasts
      expect(domModule.createElement).toHaveBeenCalledTimes(3);
    });
  });
});
