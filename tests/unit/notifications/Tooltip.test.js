/**
 * Unit tests for Tooltip notifications (notifications/tooltip.js)
 * Tests tooltip creation, positioning, animations, and mouse tracking
 */

import { CONSTANTS } from '../../../src/core/config.js';
import * as domModule from '../../../src/core/dom.js';
import { showTooltip } from '../../../src/features/notifications/tooltip.js';

// Mock createElement from dom.js
jest.mock('../../../src/core/dom.js');

// Mock CONSTANTS
jest.mock('../../../src/core/config.js', () => ({
  CONSTANTS: {
    TOOLTIP_OFFSET_X: 10,
    TOOLTIP_OFFSET_Y: 10,
    TOOLTIP_FADE_OUT_MS: 200
  }
}));

describe('Tooltip Notifications', () => {
  let mockConfig;
  let mockStateManager;
  let mockElement;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Mock console
    jest.spyOn(console, 'log').mockImplementation();

    // Mock config
    mockConfig = {
      tooltipColor: '#333',
      tooltipAnimation: 'fade',
      tooltipDuration: 1000
    };

    // Mock state manager with mouse position
    mockStateManager = {
      get: jest.fn(key => {
        if (key === 'lastMouseX') return 150;
        if (key === 'lastMouseY') return 250;
        return null;
      })
    };

    // Mock DOM element
    mockElement = {
      id: 'copy-url-tooltip',
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

    // Clean up any existing tooltip
    const existing = document.getElementById('copy-url-tooltip');
    if (existing) {
      existing.remove();
    }
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('Tooltip Creation', () => {
    test('should create tooltip element with correct structure', () => {
      showTooltip('Copied!', mockConfig, mockStateManager);

      expect(domModule.createElement).toHaveBeenCalledWith(
        'div',
        expect.objectContaining({
          id: 'copy-url-tooltip',
          className: expect.any(String)
        }),
        'Copied!'
      );
    });

    test('should append tooltip to document body', () => {
      showTooltip('Copied!', mockConfig, mockStateManager);

      expect(document.body.appendChild).toHaveBeenCalledWith(mockElement);
    });

    test('should apply correct styles from config', () => {
      showTooltip('Copied!', mockConfig, mockStateManager);

      const call = domModule.createElement.mock.calls[0];
      const props = call[1];

      expect(props.style.backgroundColor).toBe('#333');
    });

    test('should use default color when config missing', () => {
      showTooltip('Copied!', {}, mockStateManager);

      const call = domModule.createElement.mock.calls[0];
      expect(call[1].style.backgroundColor).toBe('#333');
    });
  });

  describe('Mouse Position Tracking', () => {
    test('should position tooltip at mouse coordinates with offset', () => {
      showTooltip('Copied!', mockConfig, mockStateManager);

      const call = domModule.createElement.mock.calls[0];
      const style = call[1].style;

      // Mouse at 150,250 + offset 10,10 = 160,260
      expect(style.left).toBe('160px');
      expect(style.top).toBe('260px');
    });

    test('should apply TOOLTIP_OFFSET_X and TOOLTIP_OFFSET_Y', () => {
      showTooltip('Copied!', mockConfig, mockStateManager);

      expect(mockStateManager.get).toHaveBeenCalledWith('lastMouseX');
      expect(mockStateManager.get).toHaveBeenCalledWith('lastMouseY');

      const call = domModule.createElement.mock.calls[0];
      const style = call[1].style;

      expect(style.left).toBe(`${150 + CONSTANTS.TOOLTIP_OFFSET_X}px`);
      expect(style.top).toBe(`${250 + CONSTANTS.TOOLTIP_OFFSET_Y}px`);
    });

    test('should default to 0,0 when stateManager is null', () => {
      showTooltip('Copied!', mockConfig, null);

      const call = domModule.createElement.mock.calls[0];
      const style = call[1].style;

      expect(style.left).toBe(`${0 + CONSTANTS.TOOLTIP_OFFSET_X}px`);
      expect(style.top).toBe(`${0 + CONSTANTS.TOOLTIP_OFFSET_Y}px`);
    });

    test('should handle missing mouse position in stateManager', () => {
      mockStateManager.get.mockReturnValue(null);

      showTooltip('Copied!', mockConfig, mockStateManager);

      const call = domModule.createElement.mock.calls[0];
      const style = call[1].style;

      // Should default to 0 for missing coordinates
      expect(style.left).toBe('10px'); // 0 + OFFSET_X
      expect(style.top).toBe('10px'); // 0 + OFFSET_Y
    });

    test('should handle stateManager.get returning undefined', () => {
      mockStateManager.get.mockReturnValue(undefined);

      showTooltip('Copied!', mockConfig, mockStateManager);

      const call = domModule.createElement.mock.calls[0];
      const style = call[1].style;

      expect(style.left).toBe('10px');
      expect(style.top).toBe('10px');
    });

    test('should use fixed positioning', () => {
      showTooltip('Copied!', mockConfig, mockStateManager);

      const call = domModule.createElement.mock.calls[0];
      expect(call[1].style.position).toBe('fixed');
    });

    test('should have highest z-index', () => {
      showTooltip('Copied!', mockConfig, mockStateManager);

      const call = domModule.createElement.mock.calls[0];
      expect(call[1].style.zIndex).toBe('999999999');
    });
  });

  describe('Animations', () => {
    test('should use fade animation class when configured', () => {
      mockConfig.tooltipAnimation = 'fade';

      showTooltip('Copied!', mockConfig, mockStateManager);

      const call = domModule.createElement.mock.calls[0];
      expect(call[1].className).toBe('cuo-anim-fade');
    });

    test('should use bounce animation class when configured', () => {
      mockConfig.tooltipAnimation = 'bounce';

      showTooltip('Copied!', mockConfig, mockStateManager);

      const call = domModule.createElement.mock.calls[0];
      expect(call[1].className).toBe('cuo-anim-bounce');
    });

    test('should default to fade animation for unknown types', () => {
      mockConfig.tooltipAnimation = 'unknown';

      showTooltip('Copied!', mockConfig, mockStateManager);

      const call = domModule.createElement.mock.calls[0];
      expect(call[1].className).toBe('cuo-anim-fade');
    });

    test('should handle missing animation config', () => {
      delete mockConfig.tooltipAnimation;

      showTooltip('Copied!', mockConfig, mockStateManager);

      const call = domModule.createElement.mock.calls[0];
      expect(call[1].className).toBe('cuo-anim-fade');
    });
  });

  describe('Styling', () => {
    test('should apply custom tooltip color', () => {
      mockConfig.tooltipColor = '#ff0000';

      showTooltip('Copied!', mockConfig, mockStateManager);

      const call = domModule.createElement.mock.calls[0];
      expect(call[1].style.backgroundColor).toBe('#ff0000');
    });

    test('should set text color to white', () => {
      showTooltip('Copied!', mockConfig, mockStateManager);

      const call = domModule.createElement.mock.calls[0];
      expect(call[1].style.color).toBe('white');
    });

    test('should apply padding', () => {
      showTooltip('Copied!', mockConfig, mockStateManager);

      const call = domModule.createElement.mock.calls[0];
      expect(call[1].style.padding).toBe('8px 12px');
    });

    test('should apply border radius', () => {
      showTooltip('Copied!', mockConfig, mockStateManager);

      const call = domModule.createElement.mock.calls[0];
      expect(call[1].style.borderRadius).toBe('4px');
    });

    test('should set font size', () => {
      showTooltip('Copied!', mockConfig, mockStateManager);

      const call = domModule.createElement.mock.calls[0];
      expect(call[1].style.fontSize).toBe('14px');
    });

    test('should set pointer-events to none', () => {
      showTooltip('Copied!', mockConfig, mockStateManager);

      const call = domModule.createElement.mock.calls[0];
      expect(call[1].style.pointerEvents).toBe('none');
    });

    test('should set initial opacity to 1', () => {
      showTooltip('Copied!', mockConfig, mockStateManager);

      const call = domModule.createElement.mock.calls[0];
      expect(call[1].style.opacity).toBe('1');
    });
  });

  describe('Auto-Dismiss', () => {
    test('should start fade out after configured duration', () => {
      mockConfig.tooltipDuration = 1000;

      showTooltip('Copied!', mockConfig, mockStateManager);

      // Fast-forward to just before duration
      jest.advanceTimersByTime(999);
      expect(mockElement.style.opacity).not.toBe('0');

      // Fast-forward past duration
      jest.advanceTimersByTime(1);
      expect(mockElement.style.opacity).toBe('0');
    });

    test('should remove element after fade out completes', () => {
      mockConfig.tooltipDuration = 1000;

      showTooltip('Copied!', mockConfig, mockStateManager);

      // Fast-forward through duration and fade
      jest.advanceTimersByTime(1000); // Duration
      jest.advanceTimersByTime(CONSTANTS.TOOLTIP_FADE_OUT_MS); // Fade out

      expect(mockElement.remove).toHaveBeenCalled();
    });

    test('should use default duration if not configured', () => {
      delete mockConfig.tooltipDuration;

      showTooltip('Copied!', mockConfig, mockStateManager);

      jest.advanceTimersByTime(1000);
      expect(mockElement.style.opacity).toBe('0');
    });

    test('should apply fade transition with correct duration', () => {
      showTooltip('Copied!', mockConfig, mockStateManager);

      jest.advanceTimersByTime(mockConfig.tooltipDuration);

      expect(mockElement.style.transition).toBe('opacity 0.2s');
    });

    test('should use TOOLTIP_FADE_OUT_MS constant for fade timing', () => {
      showTooltip('Copied!', mockConfig, mockStateManager);

      jest.advanceTimersByTime(mockConfig.tooltipDuration);
      expect(mockElement.style.opacity).toBe('0');

      // Fade should complete after TOOLTIP_FADE_OUT_MS
      jest.advanceTimersByTime(CONSTANTS.TOOLTIP_FADE_OUT_MS);
      expect(mockElement.remove).toHaveBeenCalled();
    });

    test('should handle custom duration values', () => {
      mockConfig.tooltipDuration = 3000;

      showTooltip('Copied!', mockConfig, mockStateManager);

      jest.advanceTimersByTime(2999);
      expect(mockElement.style.opacity).not.toBe('0');

      jest.advanceTimersByTime(1);
      expect(mockElement.style.opacity).toBe('0');
    });
  });

  describe('Multiple Tooltips', () => {
    test('should remove existing tooltip before showing new one', () => {
      // Create first tooltip
      const firstElement = document.createElement('div');
      firstElement.id = 'copy-url-tooltip';
      firstElement.remove = jest.fn();
      jest.spyOn(document, 'getElementById').mockReturnValue(firstElement);

      showTooltip('First', mockConfig, mockStateManager);

      expect(firstElement.remove).toHaveBeenCalled();
    });

    test('should handle no existing tooltip gracefully', () => {
      jest.spyOn(document, 'getElementById').mockReturnValue(null);

      expect(() => {
        showTooltip('Copied!', mockConfig, mockStateManager);
      }).not.toThrow();
    });

    test('should handle rapid successive tooltips', () => {
      showTooltip('First', mockConfig, mockStateManager);
      showTooltip('Second', mockConfig, mockStateManager);
      showTooltip('Third', mockConfig, mockStateManager);

      // Should have created 3 tooltips
      expect(domModule.createElement).toHaveBeenCalledTimes(3);
    });
  });

  describe('Message Content', () => {
    test('should display provided message', () => {
      const message = 'URL copied!';

      showTooltip(message, mockConfig, mockStateManager);

      const call = domModule.createElement.mock.calls[0];
      expect(call[2]).toBe(message);
    });

    test('should handle empty message', () => {
      showTooltip('', mockConfig, mockStateManager);

      const call = domModule.createElement.mock.calls[0];
      expect(call[2]).toBe('');
    });

    test('should handle long messages', () => {
      const longMessage = 'A'.repeat(100);

      showTooltip(longMessage, mockConfig, mockStateManager);

      const call = domModule.createElement.mock.calls[0];
      expect(call[2]).toBe(longMessage);
    });

    test('should handle special characters', () => {
      const specialMessage = '<>&"\'';

      showTooltip(specialMessage, mockConfig, mockStateManager);

      const call = domModule.createElement.mock.calls[0];
      expect(call[2]).toBe(specialMessage);
    });
  });

  describe('Logging', () => {
    test('should log tooltip display', () => {
      showTooltip('Copied!', mockConfig, mockStateManager);

      expect(console.log).toHaveBeenCalledWith('[Tooltip] Displayed:', 'Copied!');
    });

    test('should log for all messages', () => {
      const messages = ['Copied!', 'Link copied!', 'URL copied!'];

      messages.forEach(message => {
        showTooltip(message, mockConfig, mockStateManager);
      });

      expect(console.log).toHaveBeenCalledTimes(messages.length);
    });
  });

  describe('Edge Cases', () => {
    test('should handle null config gracefully', () => {
      expect(() => {
        showTooltip('Copied!', null, mockStateManager);
      }).not.toThrow();
    });

    test('should handle undefined config gracefully', () => {
      expect(() => {
        showTooltip('Copied!', undefined, mockStateManager);
      }).not.toThrow();
    });

    test('should handle null stateManager', () => {
      expect(() => {
        showTooltip('Copied!', mockConfig, null);
      }).not.toThrow();

      const call = domModule.createElement.mock.calls[0];
      expect(call[1].style.left).toBe('10px'); // 0 + offset
      expect(call[1].style.top).toBe('10px');
    });

    test('should handle undefined stateManager', () => {
      expect(() => {
        showTooltip('Copied!', mockConfig, undefined);
      }).not.toThrow();
    });

    test('should handle null message', () => {
      showTooltip(null, mockConfig, mockStateManager);

      const call = domModule.createElement.mock.calls[0];
      expect(call[2]).toBeNull();
    });

    test('should handle zero duration', () => {
      mockConfig.tooltipDuration = 0;

      showTooltip('Copied!', mockConfig, mockStateManager);

      // Need to run timers to execute setTimeout with 0ms
      jest.runAllTimers();
      expect(mockElement.style.opacity).toBe('0');
    });

    test('should handle negative coordinates', () => {
      mockStateManager.get.mockImplementation(key => {
        if (key === 'lastMouseX') return -50;
        if (key === 'lastMouseY') return -100;
        return null;
      });

      showTooltip('Copied!', mockConfig, mockStateManager);

      const call = domModule.createElement.mock.calls[0];
      const style = call[1].style;

      // -50 + 10 = -40, -100 + 10 = -90
      expect(style.left).toBe('-40px');
      expect(style.top).toBe('-90px');
    });

    test('should handle very large coordinates', () => {
      mockStateManager.get.mockImplementation(key => {
        if (key === 'lastMouseX') return 9999;
        if (key === 'lastMouseY') return 8888;
        return null;
      });

      showTooltip('Copied!', mockConfig, mockStateManager);

      const call = domModule.createElement.mock.calls[0];
      const style = call[1].style;

      expect(style.left).toBe('10009px'); // 9999 + 10
      expect(style.top).toBe('8898px'); // 8888 + 10
    });

    test('should handle empty config object', () => {
      expect(() => {
        showTooltip('Copied!', {}, mockStateManager);
      }).not.toThrow();
    });

    test('should handle stateManager without get method', () => {
      const badStateManager = {};

      expect(() => {
        showTooltip('Copied!', mockConfig, badStateManager);
      }).not.toThrow();
    });
  });

  describe('Integration', () => {
    test('should complete full tooltip lifecycle', () => {
      showTooltip('Integration test', mockConfig, mockStateManager);

      // Verify creation
      expect(domModule.createElement).toHaveBeenCalled();
      expect(document.body.appendChild).toHaveBeenCalled();

      // Fast-forward through duration
      jest.advanceTimersByTime(mockConfig.tooltipDuration);
      expect(mockElement.style.opacity).toBe('0');

      // Fast-forward through fade
      jest.advanceTimersByTime(CONSTANTS.TOOLTIP_FADE_OUT_MS);
      expect(mockElement.remove).toHaveBeenCalled();
    });

    test('should use mouse position from state manager', () => {
      mockStateManager.get.mockImplementation(key => {
        if (key === 'lastMouseX') return 500;
        if (key === 'lastMouseY') return 600;
        return null;
      });

      showTooltip('Test', mockConfig, mockStateManager);

      expect(mockStateManager.get).toHaveBeenCalledWith('lastMouseX');
      expect(mockStateManager.get).toHaveBeenCalledWith('lastMouseY');

      const call = domModule.createElement.mock.calls[0];
      expect(call[1].style.left).toBe('510px');
      expect(call[1].style.top).toBe('610px');
    });

    test('should apply all config options together', () => {
      mockConfig = {
        tooltipColor: '#ff0000',
        tooltipAnimation: 'bounce',
        tooltipDuration: 2500
      };

      showTooltip('Full config test', mockConfig, mockStateManager);

      const call = domModule.createElement.mock.calls[0];
      expect(call[1].style.backgroundColor).toBe('#ff0000');
      expect(call[1].className).toBe('cuo-anim-bounce');

      jest.advanceTimersByTime(2500);
      expect(mockElement.style.opacity).toBe('0');
    });
  });
});
