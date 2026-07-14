/**
 * QuickTabWindow Tests - v1.6.0 Phase 4.5
 *
 * Comprehensive tests for QuickTabWindow component
 * Target: 70%+ coverage (render method is complex, focus on critical paths)
 * v1.6.3.12 - Removed Solo/Mute tests (functionality removed)
 *
 * @created 2025-11-19
 * @refactoring Phase 4.5 - Feature Layer Test Coverage
 */

import { DragController } from '../../../src/features/quick-tabs/window/DragController.js';
import { ResizeController } from '../../../src/features/quick-tabs/window/ResizeController.js';
import { TitlebarBuilder } from '../../../src/features/quick-tabs/window/TitlebarBuilder.js';
import { QuickTabWindow, createQuickTabWindow } from '../../../src/features/quick-tabs/window.js';

// Mock dependencies
jest.mock('../../../src/features/quick-tabs/window/DragController.js');
jest.mock('../../../src/features/quick-tabs/window/ResizeController.js');
jest.mock('../../../src/features/quick-tabs/window/TitlebarBuilder.js');
jest.mock('webextension-polyfill', () => ({
  runtime: {
    sendMessage: jest.fn()
  }
}));

describe('QuickTabWindow', () => {
  let options;
  let mockTitlebarBuilder;
  let mockDragController;
  let mockResizeController;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Setup default options (v1.6.3.12 - Removed soloedOnTabs/mutedOnTabs and onSolo/onMute)
    options = {
      id: 'test-tab-1',
      url: 'https://example.com',
      title: 'Test Page',
      cookieStoreId: 'firefox-default',
      left: 100,
      top: 100,
      width: 800,
      height: 600,
      minimized: false,
      onDestroy: jest.fn(),
      onMinimize: jest.fn(),
      onFocus: jest.fn(),
      onPositionChange: jest.fn(),
      onPositionChangeEnd: jest.fn(),
      onSizeChange: jest.fn(),
      onSizeChangeEnd: jest.fn()
    };

    // Mock TitlebarBuilder (v1.6.3.12 - Removed soloButton/muteButton)
    mockTitlebarBuilder = {
      config: {},
      build: jest.fn(() => {
        const titlebar = document.createElement('div');
        titlebar.className = 'quick-tab-titlebar';
        return titlebar;
      }),
      updateTitle: jest.fn(),
      titleElement: document.createElement('div')
    };
    TitlebarBuilder.mockImplementation(() => mockTitlebarBuilder);

    // Mock DragController
    mockDragController = {
      destroy: jest.fn()
    };
    DragController.mockImplementation(() => mockDragController);

    // Mock ResizeController
    mockResizeController = {
      attachHandles: jest.fn(),
      detachAll: jest.fn()
    };
    ResizeController.mockImplementation(() => mockResizeController);

    // Mock requestAnimationFrame
    global.requestAnimationFrame = jest.fn(cb => {
      cb();
      return 1;
    });

    // Clear document body
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('Constructor and Initialization', () => {
    describe('Basic Properties', () => {
      test('should initialize basic properties correctly', () => {
        const window = new QuickTabWindow(options);

        expect(window.id).toBe('test-tab-1');
        expect(window.url).toBe('https://example.com');
        expect(window.title).toBe('Test Page');
        expect(window.cookieStoreId).toBe('firefox-default');
      });

      test('should use defaults for missing basic properties', () => {
        const minimalOptions = {
          id: 'test-tab-1',
          url: 'https://example.com'
        };

        const window = new QuickTabWindow(minimalOptions);

        expect(window.title).toBe('Quick Tab'); // Default title
        expect(window.cookieStoreId).toBe('firefox-default'); // Default container
      });
    });

    describe('Position and Size', () => {
      test('should initialize position and size from options', () => {
        const window = new QuickTabWindow(options);

        expect(window.left).toBe(100);
        expect(window.top).toBe(100);
        expect(window.width).toBe(800);
        expect(window.height).toBe(600);
        expect(window.zIndex).toBe(1000000); // CONSTANTS.QUICK_TAB_BASE_Z_INDEX
      });

      test('should use defaults for missing position/size', () => {
        const minimalOptions = {
          id: 'test-tab-1',
          url: 'https://example.com'
        };

        const window = new QuickTabWindow(minimalOptions);

        expect(window.left).toBe(100);
        expect(window.top).toBe(100);
        expect(window.width).toBe(800);
        expect(window.height).toBe(600);
      });

      test('should accept custom zIndex', () => {
        const customOptions = {
          ...options,
          zIndex: 5000000
        };

        const window = new QuickTabWindow(customOptions);

        expect(window.zIndex).toBe(5000000);
      });
    });

    // v1.6.3.12 - Solo/Mute Visibility Properties tests removed
    describe('Visibility Properties', () => {
      test('should initialize visibility properties', () => {
        const window = new QuickTabWindow(options);

        expect(window.minimized).toBe(false);
      });

      test('should initialize minimized state', () => {
        const minimizedOptions = {
          ...options,
          minimized: true
        };

        const window = new QuickTabWindow(minimizedOptions);

        expect(window.minimized).toBe(true);
      });
    });

    // v1.6.3.12 - Removed onSolo/onMute callbacks tests
    describe('Callbacks', () => {
      test('should assign all callbacks from options', () => {
        const window = new QuickTabWindow(options);

        expect(window.onDestroy).toBe(options.onDestroy);
        expect(window.onMinimize).toBe(options.onMinimize);
        expect(window.onFocus).toBe(options.onFocus);
        expect(window.onPositionChange).toBe(options.onPositionChange);
        expect(window.onPositionChangeEnd).toBe(options.onPositionChangeEnd);
        expect(window.onSizeChange).toBe(options.onSizeChange);
        expect(window.onSizeChangeEnd).toBe(options.onSizeChangeEnd);
      });

      test('should use noop for missing callbacks', () => {
        const minimalOptions = {
          id: 'test-tab-1',
          url: 'https://example.com'
        };

        const window = new QuickTabWindow(minimalOptions);

        // Should not throw when calling missing callbacks
        expect(() => window.onDestroy()).not.toThrow();
        expect(() => window.onMinimize()).not.toThrow();
        expect(() => window.onFocus()).not.toThrow();
        expect(() => window.onPositionChange()).not.toThrow();
        expect(() => window.onPositionChangeEnd()).not.toThrow();
        expect(() => window.onSizeChange()).not.toThrow();
        expect(() => window.onSizeChangeEnd()).not.toThrow();
      });
    });

    // v1.6.3.12 - Removed soloButton/muteButton from internal state
    describe('Internal State', () => {
      test('should initialize internal state properties', () => {
        const window = new QuickTabWindow(options);

        expect(window.container).toBeNull();
        expect(window.iframe).toBeNull();
        expect(window.rendered).toBe(false);
        expect(window.isDragging).toBe(false);
        expect(window.isResizing).toBe(false);
        expect(window.resizeStartWidth).toBe(0);
        expect(window.resizeStartHeight).toBe(0);
        expect(window.dragController).toBeNull();
        expect(window.resizeController).toBeNull();
      });
    });
  });

  describe('render()', () => {
    test('should create container element', () => {
      const window = new QuickTabWindow(options);
      window.render();

      expect(window.container).toBeTruthy();
      expect(window.container.id).toBe('quick-tab-test-tab-1');
      expect(window.container.className).toBe('quick-tab-window');
    });

    test('should not render twice', () => {
      const window = new QuickTabWindow(options);
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      window.render();
      const firstContainer = window.container;

      window.render();
      const secondContainer = window.container;

      expect(firstContainer).toBe(secondContainer);
      expect(consoleSpy).toHaveBeenCalledWith('[QuickTabWindow] Already rendered:', 'test-tab-1');

      consoleSpy.mockRestore();
    });

    test('should apply styles to container', () => {
      const window = new QuickTabWindow(options);
      window.render();

      expect(window.container.style.position).toBe('fixed');
      expect(window.container.style.width).toBe('800px');
      expect(window.container.style.height).toBe('600px');
      expect(window.container.style.zIndex).toBe('1000000');
      expect(window.container.style.backgroundColor).toBe('rgb(30, 30, 30)');
      expect(window.container.style.display).toBe('flex');
      expect(window.container.style.flexDirection).toBe('column');
    });

    test('should hide container when minimized', () => {
      const minimizedOptions = {
        ...options,
        minimized: true
      };

      const window = new QuickTabWindow(minimizedOptions);
      window.render();

      expect(window.container.style.display).toBe('none');
    });

    test('should create titlebar using TitlebarBuilder', () => {
      const window = new QuickTabWindow(options);
      window.render();

      expect(TitlebarBuilder).toHaveBeenCalled();
      expect(mockTitlebarBuilder.build).toHaveBeenCalled();
    });

    test('should pass correct config to TitlebarBuilder', () => {
      const window = new QuickTabWindow(options);
      window.render();

      // v1.6.3.12 - Removed soloedOnTabs/mutedOnTabs from builderConfig
      const builderConfig = TitlebarBuilder.mock.calls[0][0];
      expect(builderConfig.title).toBe('Test Page');
      expect(builderConfig.url).toBe('https://example.com');
    });

    // v1.6.3.12 - Removed onSolo/onMute callbacks test
    test('should pass correct callbacks to TitlebarBuilder', () => {
      const window = new QuickTabWindow(options);
      window.render();

      const builderCallbacks = TitlebarBuilder.mock.calls[0][1];
      expect(builderCallbacks.onClose).toBeDefined();
      expect(builderCallbacks.onMinimize).toBeDefined();
      expect(builderCallbacks.onOpenInTab).toBeDefined();
    });

    // v1.6.3.12 - Removed soloButton/muteButton test

    test('should create iframe element', () => {
      const window = new QuickTabWindow(options);
      window.render();

      expect(window.iframe).toBeTruthy();
      expect(window.iframe.src).toBe('https://example.com/'); // Browser adds trailing slash
      expect(window.iframe.style.flex).toBe('1');
      // JSDOM doesn't parse shorthand CSS, check that it was set
      expect(window.iframe.style.border).toBeDefined();
    });

    test('should set iframe sandbox attribute', () => {
      const window = new QuickTabWindow(options);
      window.render();

      // JSDOM doesn't fully implement sandbox DOMTokenList, check attribute directly
      const sandboxAttr = window.iframe.getAttribute('sandbox');
      expect(sandboxAttr).toContain('allow-same-origin');
      expect(sandboxAttr).toContain('allow-scripts');
      expect(sandboxAttr).toContain('allow-forms');
    });

    test('should append container to document body', () => {
      const window = new QuickTabWindow(options);
      window.render();

      expect(document.body.contains(window.container)).toBe(true);
    });

    test('should mark as rendered', () => {
      const window = new QuickTabWindow(options);
      expect(window.rendered).toBe(false);

      window.render();
      expect(window.rendered).toBe(true);
    });

    test('should position container off-screen initially', () => {
      const window = new QuickTabWindow(options);

      // Mock RAF to not execute immediately so we can check initial state
      global.requestAnimationFrame = jest.fn();

      window.render();

      // Before requestAnimationFrame callback
      expect(window.container.style.visibility).toBe('hidden');
      expect(window.container.style.opacity).toBe('0');

      // Restore RAF mock
      global.requestAnimationFrame = jest.fn(cb => {
        cb();
        return 1;
      });
    });

    test('should use requestAnimationFrame to position container', () => {
      const window = new QuickTabWindow(options);
      window.render();

      expect(requestAnimationFrame).toHaveBeenCalled();
      // After RAF callback runs (mocked to execute immediately)
      expect(window.container.style.left).toBe('100px');
      expect(window.container.style.top).toBe('100px');
      expect(window.container.style.visibility).toBe('visible');
      expect(window.container.style.opacity).toBe('1');
    });

    test('should sanitize non-finite position values', () => {
      const badOptions = {
        ...options,
        left: NaN,
        top: Infinity
      };

      const window = new QuickTabWindow(badOptions);
      window.render();

      expect(window.left).toBe(100); // Default
      expect(window.top).toBe(100); // Default
    });

    test('should create DragController', () => {
      const window = new QuickTabWindow(options);
      window.render();

      expect(DragController).toHaveBeenCalled();
      expect(window.dragController).toBe(mockDragController);
    });

    test('should pass correct callbacks to DragController', () => {
      const window = new QuickTabWindow(options);
      window.render();

      const dragCallbacks = DragController.mock.calls[0][1];
      expect(dragCallbacks.onDragStart).toBeDefined();
      expect(dragCallbacks.onDrag).toBeDefined();
      expect(dragCallbacks.onDragEnd).toBeDefined();
      expect(dragCallbacks.onDragCancel).toBeDefined();
    });

    test('should create ResizeController', () => {
      const window = new QuickTabWindow(options);
      window.render();

      expect(ResizeController).toHaveBeenCalled();
      expect(window.resizeController).toBe(mockResizeController);
    });

    test('should call attachHandles on ResizeController', () => {
      const window = new QuickTabWindow(options);
      window.render();

      expect(mockResizeController.attachHandles).toHaveBeenCalled();
    });

    test('should setup focus handlers', () => {
      const window = new QuickTabWindow(options);
      window.render();

      // Verify focus handler works
      const mousedownEvent = new MouseEvent('mousedown', { bubbles: true });
      window.container.dispatchEvent(mousedownEvent);

      expect(options.onFocus).toHaveBeenCalledWith('test-tab-1');
    });

    test('should return container element', () => {
      const window = new QuickTabWindow(options);
      const result = window.render();

      expect(result).toBe(window.container);
    });
  });

  describe('Drag Event Handlers', () => {
    test('onDragStart should set isDragging and call onFocus', () => {
      const window = new QuickTabWindow(options);
      window.render();

      const onDragStart = DragController.mock.calls[0][1].onDragStart;
      onDragStart(150, 200);

      expect(window.isDragging).toBe(true);
      expect(options.onFocus).toHaveBeenCalledWith('test-tab-1');
    });

    test('onDrag should update position and call onPositionChange', () => {
      const window = new QuickTabWindow(options);
      window.render();

      const onDrag = DragController.mock.calls[0][1].onDrag;
      onDrag(250, 300);

      expect(window.left).toBe(250);
      expect(window.top).toBe(300);
      expect(window.container.style.left).toBe('250px');
      expect(window.container.style.top).toBe('300px');
      expect(options.onPositionChange).toHaveBeenCalledWith('test-tab-1', 250, 300);
    });

    test('onDragEnd should clear isDragging and call onPositionChangeEnd', () => {
      const window = new QuickTabWindow(options);
      window.render();

      window.isDragging = true;
      const onDragEnd = DragController.mock.calls[0][1].onDragEnd;
      onDragEnd(350, 400);

      expect(window.isDragging).toBe(false);
      expect(options.onPositionChangeEnd).toHaveBeenCalledWith('test-tab-1', 350, 400);
    });

    test('onDragCancel should save position and clear isDragging', () => {
      const window = new QuickTabWindow(options);
      window.render();

      window.isDragging = true;
      const onDragCancel = DragController.mock.calls[0][1].onDragCancel;
      onDragCancel(450, 500);

      expect(window.isDragging).toBe(false);
      expect(options.onPositionChangeEnd).toHaveBeenCalledWith('test-tab-1', 450, 500);
    });
  });

  describe('minimize()', () => {
    test('should set minimized state', () => {
      const window = new QuickTabWindow(options);
      window.render();

      window.minimize();

      expect(window.minimized).toBe(true);
    });

    test('should remove container from DOM (v1.6.3.4-v7)', () => {
      const window = new QuickTabWindow(options);
      window.render();

      window.minimize();

      // v1.6.3.4-v7 - minimize now removes DOM instead of display:none
      expect(window.container).toBeNull();
      expect(window.iframe).toBeNull();
      expect(window.rendered).toBe(false);
    });

    test('should call onMinimize callback', () => {
      const window = new QuickTabWindow(options);
      window.render();

      window.minimize();

      expect(options.onMinimize).toHaveBeenCalledWith('test-tab-1');
    });
  });

  describe('restore()', () => {
    test('should clear minimized state', () => {
      const window = new QuickTabWindow(options);
      window.render();
      window.minimized = true;

      window.restore();

      expect(window.minimized).toBe(false);
    });

    test('should NOT recreate container (v1.6.3.2 - UICoordinator is single render authority)', () => {
      const window = new QuickTabWindow(options);
      window.render();
      // Simulate minimize removing DOM
      window.container = null;
      window.iframe = null;
      window.rendered = false;
      window.minimized = true;

      window.restore();

      // v1.6.3.2 - restore() NO LONGER calls render()
      // UICoordinator is the single rendering authority and will call render() after restore()
      // This fixes Issue #1 (duplicate window on restore)
      expect(window.container).toBeNull();
      expect(window.rendered).toBe(false);
      expect(window.minimized).toBe(false); // Minimized flag is cleared
    });

    test('should restore existing container display if it exists', () => {
      const window = new QuickTabWindow(options);
      window.render();
      // Container exists, just hidden
      window.minimized = true;

      window.restore();

      // v1.6.3.2 - If container exists, just update display style
      expect(window.container.style.display).toBe('flex');
      expect(window.container.style.left).toBe('100px');
      expect(window.container.style.top).toBe('100px');
    });

    test('should restore position and size', () => {
      const window = new QuickTabWindow(options);
      window.render();

      window.restore();

      expect(window.container.style.left).toBe('100px');
      expect(window.container.style.top).toBe('100px');
      expect(window.container.style.width).toBe('800px');
      expect(window.container.style.height).toBe('600px');
    });

    test('should call onFocus callback', () => {
      const window = new QuickTabWindow(options);
      window.render();

      window.restore();

      expect(options.onFocus).toHaveBeenCalledWith('test-tab-1');
    });
  });

  describe('updateZIndex()', () => {
    test('should update zIndex property', () => {
      const window = new QuickTabWindow(options);
      window.render();

      window.updateZIndex(3000000);

      expect(window.zIndex).toBe(3000000);
    });

    test('should update container style', () => {
      const window = new QuickTabWindow(options);
      window.render();

      window.updateZIndex(3000000);

      expect(window.container.style.zIndex).toBe('3000000');
    });

    test('should handle call before rendering', () => {
      const window = new QuickTabWindow(options);

      window.updateZIndex(3000000);

      expect(window.zIndex).toBe(3000000);
      // Container doesn't exist yet, shouldn't throw
    });
  });

  describe('setPosition()', () => {
    test('should update position properties', () => {
      const window = new QuickTabWindow(options);
      window.render();

      window.setPosition(500, 600);

      expect(window.left).toBe(500);
      expect(window.top).toBe(600);
    });

    test('should update container style', () => {
      const window = new QuickTabWindow(options);
      window.render();

      window.setPosition(500, 600);

      expect(window.container.style.left).toBe('500px');
      expect(window.container.style.top).toBe('600px');
    });

    test('should handle call before rendering', () => {
      const window = new QuickTabWindow(options);

      window.setPosition(500, 600);

      expect(window.left).toBe(500);
      expect(window.top).toBe(600);
      // Container doesn't exist yet, shouldn't throw
    });
  });

  describe('setSize()', () => {
    test('should update size properties', () => {
      const window = new QuickTabWindow(options);
      window.render();

      window.setSize(1000, 700);

      expect(window.width).toBe(1000);
      expect(window.height).toBe(700);
    });

    test('should update container style', () => {
      const window = new QuickTabWindow(options);
      window.render();

      window.setSize(1000, 700);

      expect(window.container.style.width).toBe('1000px');
      expect(window.container.style.height).toBe('700px');
    });

    test('should handle call before rendering', () => {
      const window = new QuickTabWindow(options);

      window.setSize(1000, 700);

      expect(window.width).toBe(1000);
      expect(window.height).toBe(700);
      // Container doesn't exist yet, shouldn't throw
    });
  });

  describe('isRendered()', () => {
    test('should return false before render', () => {
      const window = new QuickTabWindow(options);

      expect(window.isRendered()).toBe(false);
    });

    test('should return true after render', () => {
      const window = new QuickTabWindow(options);
      window.render();

      // isRendered checks: rendered flag, container exists, and has parentNode
      expect(window.rendered).toBe(true);
      expect(window.container).toBeTruthy();
      expect(document.body.contains(window.container)).toBe(true);
      expect(window.isRendered()).toBeTruthy(); // Returns truthy value (parentNode)
    });

    test('should return false if container removed from DOM', () => {
      const window = new QuickTabWindow(options);
      window.render();

      // Manually remove from DOM using removeChild (JSDOM compatible)
      document.body.removeChild(window.container);

      // Still has rendered flag and container ref, but no parentNode
      expect(window.rendered).toBe(true);
      expect(window.container).toBeTruthy();
      expect(document.body.contains(window.container)).toBe(false);
      expect(window.isRendered()).toBeFalsy(); // Returns falsy (null parentNode)
    });

    test('should return false after destroy', () => {
      const window = new QuickTabWindow(options);
      window.render();

      window.destroy();

      expect(window.isRendered()).toBeFalsy(); // All conditions fail after destroy
    });
  });

  describe('destroy()', () => {
    test('should cleanup drag controller', () => {
      const window = new QuickTabWindow(options);
      window.render();

      window.destroy();

      expect(mockDragController.destroy).toHaveBeenCalled();
      expect(window.dragController).toBeNull();
    });

    test('should cleanup resize controller', () => {
      const window = new QuickTabWindow(options);
      window.render();

      window.destroy();

      expect(mockResizeController.detachAll).toHaveBeenCalled();
      expect(window.resizeController).toBeNull();
    });

    test('should remove container from DOM', () => {
      const window = new QuickTabWindow(options);
      window.render();

      window.destroy();

      expect(document.body.contains(window.container)).toBe(false);
    });

    test('should clear references', () => {
      const window = new QuickTabWindow(options);
      window.render();

      window.destroy();

      expect(window.container).toBeNull();
      expect(window.iframe).toBeNull();
      expect(window.rendered).toBe(false);
    });

    test('should call onDestroy callback', () => {
      const window = new QuickTabWindow(options);
      window.render();

      window.destroy();

      expect(options.onDestroy).toHaveBeenCalledWith('test-tab-1');
    });

    test('should handle destroy before render', () => {
      const window = new QuickTabWindow(options);

      expect(() => window.destroy()).not.toThrow();
      expect(options.onDestroy).toHaveBeenCalledWith('test-tab-1');
    });

    test('should handle multiple destroy calls', () => {
      const window = new QuickTabWindow(options);
      window.render();

      window.destroy();
      expect(() => window.destroy()).not.toThrow();
    });
  });

  describe('getState()', () => {
    test('should return complete state object', () => {
      const window = new QuickTabWindow(options);
      window.render();

      const state = window.getState();

      // v1.6.3.12 - Removed soloedOnTabs/mutedOnTabs from state
      expect(state).toEqual({
        id: 'test-tab-1',
        url: 'https://example.com',
        left: 100,
        top: 100,
        width: 800,
        height: 600,
        title: 'Test Page',
        cookieStoreId: 'firefox-default',
        minimized: false,
        zIndex: 1000000
      });
    });

    test('should include updated position/size', () => {
      const window = new QuickTabWindow(options);
      window.render();

      window.setPosition(300, 400);
      window.setSize(1200, 800);

      const state = window.getState();

      expect(state.left).toBe(300);
      expect(state.top).toBe(400);
      expect(state.width).toBe(1200);
      expect(state.height).toBe(800);
    });

    // v1.6.3.12 - Removed solo/mute arrays test

    test('should include minimized state', () => {
      const window = new QuickTabWindow(options);
      window.render();

      window.minimize();
      const state = window.getState();

      expect(state.minimized).toBe(true);
    });
  });

  // v1.6.3.12 - Removed entire Solo/Mute Functionality describe block

  describe('createQuickTabWindow() factory', () => {
    test('should create and render window', () => {
      const window = createQuickTabWindow(options);

      expect(window).toBeInstanceOf(QuickTabWindow);
      expect(window.rendered).toBe(true);
      expect(document.body.contains(window.container)).toBe(true);
    });

    test('should return QuickTabWindow instance', () => {
      const window = createQuickTabWindow(options);

      expect(window.id).toBe('test-tab-1');
      expect(window.url).toBe('https://example.com');
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle missing required options gracefully', () => {
      const minimalOptions = {
        id: 'test-tab-1',
        url: 'https://example.com'
      };

      expect(() => new QuickTabWindow(minimalOptions)).not.toThrow();
    });

    test('should handle destroy of non-rendered window', () => {
      const window = new QuickTabWindow(options);

      expect(() => window.destroy()).not.toThrow();
    });

    test('should handle method calls on destroyed window', () => {
      const window = new QuickTabWindow(options);
      window.render();
      window.destroy();

      // Note: minimize/restore will throw if called after destroy (expected behavior)
      // setPosition and setSize handle null container gracefully
      expect(() => window.setPosition(100, 100)).not.toThrow();
      expect(() => window.setSize(800, 600)).not.toThrow();
    });
  });
});
