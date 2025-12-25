/**
 * TitlebarBuilder Tests - v1.6.0 Phase 2.9 Task 4
 *
 * Tests for TitlebarBuilder component extracted from QuickTabWindow
 * Ensures all titlebar functionality is preserved during refactoring
 * v1.6.4 - Removed Solo/Mute tests (functionality removed)
 *
 * @created 2025-11-19
 * @refactoring Phase 2.9 Task 4
 */

import { TitlebarBuilder } from '../../../src/features/quick-tabs/window/TitlebarBuilder.js';

// Mock browser API
jest.mock('webextension-polyfill', () => ({
  runtime: {
    sendMessage: jest.fn()
  }
}));

describe('TitlebarBuilder', () => {
  let config;
  let callbacks;
  let mockIframe;

  beforeEach(() => {
    // Create mock iframe
    mockIframe = document.createElement('iframe');
    mockIframe.src = 'https://example.com/page';

    // v1.6.4 - Removed soloedOnTabs/mutedOnTabs from config
    config = {
      title: 'Test Page',
      url: 'https://example.com/page',
      currentTabId: 123,
      iframe: mockIframe
    };

    // v1.6.4 - Removed onSolo/onMute callbacks
    callbacks = {
      onClose: jest.fn(),
      onMinimize: jest.fn(),
      onOpenInTab: jest.fn()
    };

    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    // v1.6.4 - Removed Solo/Mute button tests
    test('should initialize with config and callbacks', () => {
      const builder = new TitlebarBuilder(config, callbacks);

      expect(builder.config).toBe(config);
      expect(builder.callbacks).toBe(callbacks);
      expect(builder.titlebar).toBeNull();
      expect(builder.titleElement).toBeNull();
      expect(builder.faviconElement).toBeNull();
    });

    test('should initialize zoom state to 100%', () => {
      const builder = new TitlebarBuilder(config, callbacks);

      expect(builder.currentZoom).toBe(100);
      expect(builder.zoomDisplay).toBeNull();
    });
  });

  describe('build()', () => {
    test('should create titlebar container', () => {
      const builder = new TitlebarBuilder(config, callbacks);
      const titlebar = builder.build();

      expect(titlebar).toBeTruthy();
      expect(titlebar.className).toBe('quick-tab-titlebar');
      expect(titlebar.style.height).toBe('40px');
      expect(titlebar.style.cursor).toBe('move');
    });

    test('should create left section with navigation and title', () => {
      const builder = new TitlebarBuilder(config, callbacks);
      const titlebar = builder.build();

      const leftSection = titlebar.children[0];
      expect(leftSection).toBeTruthy();
      expect(leftSection.style.display).toBe('flex');
    });

    test('should create right section with control buttons', () => {
      const builder = new TitlebarBuilder(config, callbacks);
      const titlebar = builder.build();

      const rightSection = titlebar.children[1];
      expect(rightSection).toBeTruthy();
      expect(rightSection.style.display).toBe('flex');
    });

    test('should create favicon element', () => {
      const builder = new TitlebarBuilder(config, callbacks);
      builder.build();

      expect(builder.faviconElement).toBeTruthy();
      expect(builder.faviconElement.tagName).toBe('IMG');
      expect(builder.faviconElement.className).toBe('quick-tab-favicon');
    });

    test('should create title element', () => {
      const builder = new TitlebarBuilder(config, callbacks);
      builder.build();

      expect(builder.titleElement).toBeTruthy();
      expect(builder.titleElement.className).toBe('quick-tab-title');
      expect(builder.titleElement.textContent).toBe('Test Page');
    });

    // v1.6.4 - Solo/Mute button tests removed

    test('should create navigation buttons', () => {
      const builder = new TitlebarBuilder(config, callbacks);
      const titlebar = builder.build();

      // Navigation buttons are in left section
      const leftSection = titlebar.children[0];
      const buttons = leftSection.querySelectorAll('button');

      // Should have: back, forward, reload, zoom out, zoom in = 5 nav buttons minimum
      expect(buttons.length).toBeGreaterThanOrEqual(5);
    });

    test('should create zoom display element', () => {
      const builder = new TitlebarBuilder(config, callbacks);
      builder.build();

      expect(builder.zoomDisplay).toBeTruthy();
      expect(builder.zoomDisplay.textContent).toBe('100%');
    });
  });

  describe('updateTitle()', () => {
    test('should update title text', () => {
      const builder = new TitlebarBuilder(config, callbacks);
      builder.build();

      builder.updateTitle('New Title');

      expect(builder.titleElement.textContent).toBe('New Title');
    });

    test('should handle update before build', () => {
      const builder = new TitlebarBuilder(config, callbacks);

      // Should not throw
      expect(() => builder.updateTitle('New Title')).not.toThrow();
    });
  });

  // v1.6.4 - updateSoloButton() and updateMuteButton() tests removed
  // v1.6.4 - Solo/Mute State Detection tests removed

  describe('Button Callbacks', () => {
    test('should call onClose when close button clicked', () => {
      const builder = new TitlebarBuilder(config, callbacks);
      const titlebar = builder.build();

      const closeBtn = Array.from(titlebar.querySelectorAll('button')).find(
        btn => btn.title === 'Close'
      );

      closeBtn.click();

      expect(callbacks.onClose).toHaveBeenCalledTimes(1);
    });

    test('should call onMinimize when minimize button clicked', () => {
      const builder = new TitlebarBuilder(config, callbacks);
      const titlebar = builder.build();

      const minimizeBtn = Array.from(titlebar.querySelectorAll('button')).find(
        btn => btn.title === 'Minimize'
      );

      minimizeBtn.click();

      expect(callbacks.onMinimize).toHaveBeenCalledTimes(1);
    });

    // v1.6.4 - onSolo/onMute tests removed

    test('should call onOpenInTab when open button clicked', () => {
      const builder = new TitlebarBuilder(config, callbacks);
      const titlebar = builder.build();

      const openBtn = Array.from(titlebar.querySelectorAll('button')).find(
        btn => btn.title === 'Open in New Tab'
      );

      openBtn.click();

      expect(callbacks.onOpenInTab).toHaveBeenCalledTimes(1);
    });
  });

  describe('Zoom Controls', () => {
    test('should increment zoom when zoom in button clicked', () => {
      const builder = new TitlebarBuilder(config, callbacks);
      const titlebar = builder.build();

      const zoomInBtn = Array.from(titlebar.querySelectorAll('button')).find(
        btn => btn.title === 'Zoom In'
      );

      zoomInBtn.click();

      expect(builder.currentZoom).toBe(110);
      expect(builder.zoomDisplay.textContent).toBe('110%');
    });

    test('should decrement zoom when zoom out button clicked', () => {
      const builder = new TitlebarBuilder(config, callbacks);
      const titlebar = builder.build();

      const zoomOutBtn = Array.from(titlebar.querySelectorAll('button')).find(
        btn => btn.title === 'Zoom Out'
      );

      zoomOutBtn.click();

      expect(builder.currentZoom).toBe(90);
      expect(builder.zoomDisplay.textContent).toBe('90%');
    });

    test('should not zoom below 50%', () => {
      const builder = new TitlebarBuilder(config, callbacks);
      const titlebar = builder.build();

      const zoomOutBtn = Array.from(titlebar.querySelectorAll('button')).find(
        btn => btn.title === 'Zoom Out'
      );

      // Click 6 times to go below 50%
      for (let i = 0; i < 6; i++) {
        zoomOutBtn.click();
      }

      expect(builder.currentZoom).toBe(50);
      expect(builder.zoomDisplay.textContent).toBe('50%');
    });

    test('should not zoom above 200%', () => {
      const builder = new TitlebarBuilder(config, callbacks);
      const titlebar = builder.build();

      const zoomInBtn = Array.from(titlebar.querySelectorAll('button')).find(
        btn => btn.title === 'Zoom In'
      );

      // Click 11 times to go above 200%
      for (let i = 0; i < 11; i++) {
        zoomInBtn.click();
      }

      expect(builder.currentZoom).toBe(200);
      expect(builder.zoomDisplay.textContent).toBe('200%');
    });

    test('should apply zoom to iframe content window when accessible', () => {
      const mockBody = { style: {} };
      const mockDocument = { body: mockBody };
      Object.defineProperty(mockIframe, 'contentWindow', {
        value: { document: mockDocument },
        configurable: true
      });

      const builder = new TitlebarBuilder(config, callbacks);
      builder.build();

      const zoomInBtn = Array.from(builder.titlebar.querySelectorAll('button')).find(
        btn => btn.title === 'Zoom In'
      );

      zoomInBtn.click();

      expect(mockBody.style.zoom).toBe(1.1); // 110%
    });

    test('should use CSS transform fallback for cross-origin iframes', () => {
      const mockDocument = {
        get body() {
          throw new Error('Cross-origin restriction');
        }
      };
      Object.defineProperty(mockIframe, 'contentWindow', {
        value: { document: mockDocument },
        configurable: true
      });

      const builder = new TitlebarBuilder(config, callbacks);
      builder.build();

      const zoomInBtn = Array.from(builder.titlebar.querySelectorAll('button')).find(
        btn => btn.title === 'Zoom In'
      );

      zoomInBtn.click();

      // Should apply CSS transform fallback
      expect(mockIframe.style.transform).toBe('scale(1.1)');
      expect(mockIframe.style.transformOrigin).toBe('top left');
      expect(mockIframe.style.width).toContain('%');
      expect(mockIframe.style.height).toContain('%');
    });
  });

  describe('Favicon Handling', () => {
    test('should use Google favicon service', () => {
      const builder = new TitlebarBuilder(config, callbacks);
      builder.build();

      expect(builder.faviconElement.src).toContain('google.com/s2/favicons');
      expect(builder.faviconElement.src).toContain('example.com');
    });

    test('should hide favicon on error', () => {
      const builder = new TitlebarBuilder(config, callbacks);
      builder.build();

      // Trigger error event
      const errorEvent = new Event('error');
      builder.faviconElement.dispatchEvent(errorEvent);

      expect(builder.faviconElement.style.display).toBe('none');
    });

    test('should hide favicon for invalid URLs', () => {
      config.url = 'not-a-url';
      const builder = new TitlebarBuilder(config, callbacks);
      builder.build();

      expect(builder.faviconElement.style.display).toBe('none');
    });
  });

  describe('Navigation Buttons', () => {
    test('should attempt to navigate back when back button clicked', () => {
      const mockHistory = { back: jest.fn() };
      // Mock contentWindow with a getter that returns our mock
      Object.defineProperty(mockIframe, 'contentWindow', {
        value: { history: mockHistory },
        configurable: true
      });

      const builder = new TitlebarBuilder(config, callbacks);
      const titlebar = builder.build();

      const backBtn = Array.from(titlebar.querySelectorAll('button')).find(
        btn => btn.title === 'Back'
      );

      backBtn.click();

      expect(mockHistory.back).toHaveBeenCalledTimes(1);
    });

    test('should handle cross-origin error on back navigation', () => {
      const mockHistory = {
        back: jest.fn(() => {
          throw new Error('Cross-origin restriction');
        })
      };
      // Mock contentWindow with a getter that returns our mock
      Object.defineProperty(mockIframe, 'contentWindow', {
        value: { history: mockHistory },
        configurable: true
      });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const builder = new TitlebarBuilder(config, callbacks);
      const titlebar = builder.build();

      const backBtn = Array.from(titlebar.querySelectorAll('button')).find(
        btn => btn.title === 'Back'
      );

      // Should not throw
      expect(() => backBtn.click()).not.toThrow();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Cannot navigate back'));

      consoleSpy.mockRestore();
    });

    test('should attempt to navigate forward when forward button clicked', () => {
      const mockHistory = { forward: jest.fn() };
      // Mock contentWindow with a getter that returns our mock
      Object.defineProperty(mockIframe, 'contentWindow', {
        value: { history: mockHistory },
        configurable: true
      });

      const builder = new TitlebarBuilder(config, callbacks);
      const titlebar = builder.build();

      const forwardBtn = Array.from(titlebar.querySelectorAll('button')).find(
        btn => btn.title === 'Forward'
      );

      forwardBtn.click();

      expect(mockHistory.forward).toHaveBeenCalledTimes(1);
    });

    test('should handle cross-origin error on forward navigation', () => {
      const mockHistory = {
        forward: jest.fn(() => {
          throw new Error('Cross-origin restriction');
        })
      };
      // Mock contentWindow with a getter that returns our mock
      Object.defineProperty(mockIframe, 'contentWindow', {
        value: { history: mockHistory },
        configurable: true
      });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const builder = new TitlebarBuilder(config, callbacks);
      const titlebar = builder.build();

      const forwardBtn = Array.from(titlebar.querySelectorAll('button')).find(
        btn => btn.title === 'Forward'
      );

      // Should not throw
      expect(() => forwardBtn.click()).not.toThrow();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Cannot navigate forward'));

      consoleSpy.mockRestore();
    });

    test('should reload iframe when reload button clicked', () => {
      jest.useFakeTimers();

      const builder = new TitlebarBuilder(config, callbacks);
      const titlebar = builder.build();

      const reloadBtn = Array.from(titlebar.querySelectorAll('button')).find(
        btn => btn.title === 'Reload'
      );

      const originalSrc = mockIframe.src;
      reloadBtn.click();

      // Should set to blank first
      expect(mockIframe.src).toBe('about:blank');

      // Should restore after timeout
      jest.advanceTimersByTime(10);
      expect(mockIframe.src).toBe(originalSrc);

      jest.useRealTimers();
    });
  });

  describe('Button Styling', () => {
    test('buttons should have hover effect on mouseenter', () => {
      const builder = new TitlebarBuilder(config, callbacks);
      const titlebar = builder.build();

      const button = titlebar.querySelector('button');

      // Initial state
      expect(button.style.backgroundColor).toBe('transparent');

      // Trigger mouseenter
      const mouseenterEvent = new Event('mouseenter');
      button.dispatchEvent(mouseenterEvent);

      expect(button.style.backgroundColor).toBe('rgb(68, 68, 68)'); // #444 as RGB
    });

    test('buttons should reset style on mouseleave', () => {
      const builder = new TitlebarBuilder(config, callbacks);
      const titlebar = builder.build();

      const button = titlebar.querySelector('button');

      // Trigger mouseenter then mouseleave
      button.dispatchEvent(new Event('mouseenter'));
      button.dispatchEvent(new Event('mouseleave'));

      expect(button.style.backgroundColor).toBe('transparent');
    });

    test('button clicks should stop propagation', () => {
      const builder = new TitlebarBuilder(config, callbacks);
      const titlebar = builder.build();
      
      // Get the close button (a button that always exists after Solo/Mute removal)
      const closeBtn = Array.from(titlebar.querySelectorAll('button')).find(
        btn => btn.title === 'Close'
      );

      const clickEvent = new Event('click', { bubbles: true });
      const stopPropagationSpy = jest.spyOn(clickEvent, 'stopPropagation');

      closeBtn.dispatchEvent(clickEvent);

      expect(stopPropagationSpy).toHaveBeenCalled();
    });
  });

  describe('Integration', () => {
    // v1.6.4 - Updated for Solo/Mute removal
    test('should build complete functional titlebar', () => {
      const builder = new TitlebarBuilder(config, callbacks);
      const titlebar = builder.build();

      // Verify structure
      expect(titlebar.children).toHaveLength(2); // Left + Right sections

      // Verify all elements accessible (Solo/Mute buttons removed in v1.6.4)
      expect(builder.titleElement).toBeTruthy();
      expect(builder.faviconElement).toBeTruthy();
      expect(builder.zoomDisplay).toBeTruthy();

      // Verify initial state
      expect(builder.titleElement.textContent).toBe('Test Page');
      expect(builder.currentZoom).toBe(100);
      expect(builder.zoomDisplay.textContent).toBe('100%');
    });

    // v1.6.4 - Updated for Solo/Mute removal
    test('should handle all callbacks correctly', () => {
      const builder = new TitlebarBuilder(config, callbacks);
      const titlebar = builder.build();

      const minimizeBtn = Array.from(titlebar.querySelectorAll('button')).find(
        btn => btn.title === 'Minimize'
      );
      const closeBtn = Array.from(titlebar.querySelectorAll('button')).find(
        btn => btn.title === 'Close'
      );

      minimizeBtn.click();
      closeBtn.click();

      // Verify all callbacks invoked (Solo/Mute callbacks removed in v1.6.4)
      expect(callbacks.onMinimize).toHaveBeenCalled();
      expect(callbacks.onClose).toHaveBeenCalled();
    });
  });
});
