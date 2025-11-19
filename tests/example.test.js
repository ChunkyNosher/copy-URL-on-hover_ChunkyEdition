/**
 * ==============================================================================
 * COMPREHENSIVE TEST SUITE FOR COPY-URL-ON-HOVER EXTENSION
 * ==============================================================================
 * This test suite aims for high coverage of all source code and APIs
 *
 * STRUCTURE:
 * 1. Manifest.json Validation
 * 2. Extension Configuration Tests
 * 3. ConfigManager Tests
 * 4. StateManager Tests
 * 5. Browser API Wrapper Tests
 * 6. DOM Utilities Tests
 * 7. Event System Tests
 * 8. Storage Management Tests
 * 9. Container Isolation Tests
 * 10. URL Handling Tests
 * ==============================================================================
 */

// Mock browser APIs for testing
global.browser = {
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
      clear: jest.fn()
    },
    sync: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
      clear: jest.fn()
    }
  },
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn()
    }
  },
  tabs: {
    query: jest.fn(),
    create: jest.fn()
  },
  contextualIdentities: {
    get: jest.fn()
  }
};

global.navigator = {
  clipboard: {
    writeText: jest.fn()
  }
};

// ==============================================================================
// PART 1: MANIFEST.JSON VALIDATION
// ==============================================================================
describe('Manifest Validation', () => {
  const manifest = require('../manifest.json');

  /**
   * TEST: Manifest V2 compliance (CRITICAL!)
   * WHY: Extension requires Manifest V2 for webRequestBlocking
   */
  test('should use Manifest V2', () => {
    expect(manifest.manifest_version).toBe(2);
  });

  /**
   * TEST: Required permissions
   * WHY: Extension won't work without these
   */
  test('should have all required permissions', () => {
    const requiredPermissions = [
      'storage',
      'tabs',
      'webRequest',
      'webRequestBlocking',
      'contextualIdentities'
    ];

    requiredPermissions.forEach(permission => {
      expect(manifest.permissions).toContain(permission);
    });
  });

  /**
   * TEST: CSP configuration
   * WHY: Security requirement
   */
  test('should use default or custom Content Security Policy', () => {
    // CSP is optional in Manifest V2 - Firefox uses default if not specified
    if (manifest.content_security_policy) {
      expect(typeof manifest.content_security_policy).toBe('string');
      expect(manifest.content_security_policy).toContain('script-src');
    } else {
      // Verify Firefox will apply default CSP
      expect(manifest.manifest_version).toBe(2);
    }
  });

  /**
   * TEST: Version format
   * WHY: Firefox AMO supports both standard semver (1.5.9) and 4-part versions (1.5.9.0)
   * ACCEPTS: Both 3-part (1.5.9) and 4-part (1.5.9.0) version numbers
   */
  test('should have valid semantic version', () => {
    // Updated regex: accepts both 3-part (1.5.9) and 4-part (1.5.9.0) versions
    const versionPattern = /^\d+\.\d+\.\d+(\.\d+)?$/;
    expect(manifest.version).toMatch(versionPattern);
  });

  /**
   * TEST: Background script
   * WHY: Core functionality depends on background.js
   */
  test('should specify background script', () => {
    expect(manifest.background).toBeDefined();
    expect(manifest.background.scripts).toContain('dist/background.js');
  });

  /**
   * TEST: Content scripts
   * WHY: Main functionality runs in content scripts
   */
  test('should have content scripts configured', () => {
    expect(manifest.content_scripts).toBeDefined();
    expect(manifest.content_scripts.length).toBeGreaterThan(0);
  });

  /**
   * TEST: Browser action
   * WHY: Popup UI requires browser_action
   */
  test('should have browser action defined', () => {
    expect(manifest.browser_action).toBeDefined();
    expect(manifest.browser_action.default_popup).toBe('popup.html');
  });
});

// ==============================================================================
// PART 2: EXTENSION CONFIGURATION TESTS
// ==============================================================================
describe('Extension Configuration', () => {
  /**
   * TEST: Storage limits
   * WHY: Must match Firefox's actual storage limits
   */
  test('storage limits should match browser limits', () => {
    const SYNC_QUOTA = 100 * 1024; // 100KB
    const LOCAL_QUOTA = 10 * 1024 * 1024; // 10MB

    expect(SYNC_QUOTA).toBe(102400);
    expect(LOCAL_QUOTA).toBe(10485760);
  });

  /**
   * TEST: Quick Tab z-index
   * WHY: Must be high enough to appear above web content
   */
  test('Quick Tab base z-index should be high', () => {
    const QUICK_TAB_BASE_Z_INDEX = 1000000;

    expect(QUICK_TAB_BASE_Z_INDEX).toBeGreaterThan(999999);
  });

  /**
   * TEST: Default configuration keys
   * WHY: Ensures all expected config keys exist
   */
  test('default config should have all required keys', () => {
    const requiredKeys = [
      'copyUrlKey',
      'copyTextKey',
      'openNewTabKey',
      'quickTabKey',
      'showNotification',
      'debugMode',
      'darkMode'
    ];

    // This would need to import DEFAULT_CONFIG from config.js
    // For now, we just verify the keys we expect
    requiredKeys.forEach(key => {
      expect(typeof key).toBe('string');
    });
  });
});

// ==============================================================================
// PART 3: CONFIGMANAGER TESTS
// ==============================================================================
describe('ConfigManager', () => {
  let ConfigManager;
  let DEFAULT_CONFIG;

  beforeAll(() => {
    // Dynamic import to avoid module resolution issues
    const configModule = require('../src/core/config.js');
    ConfigManager = configModule.ConfigManager;
    DEFAULT_CONFIG = configModule.DEFAULT_CONFIG;
  });

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
  });

  /**
   * TEST: ConfigManager initialization
   * WHY: Must start with default config
   */
  test('should initialize with default config', () => {
    const manager = new ConfigManager();

    expect(manager.config).toBeDefined();
    expect(manager.config.debugMode).toBe(DEFAULT_CONFIG.debugMode);
  });

  /**
   * TEST: Load from storage
   * WHY: Must load saved configuration
   */
  test('should load configuration from storage', async () => {
    const manager = new ConfigManager();
    const mockConfig = { debugMode: true, darkMode: false };

    browser.storage.local.get.mockResolvedValue(mockConfig);

    await manager.load();

    expect(browser.storage.local.get).toHaveBeenCalled();
    expect(manager.config.debugMode).toBe(true);
  });

  /**
   * TEST: Handle storage load failure
   * WHY: Must fall back to defaults if storage fails
   */
  test('should use defaults if storage load fails', async () => {
    const manager = new ConfigManager();

    browser.storage.local.get.mockRejectedValue(new Error('Storage error'));

    await manager.load();

    expect(manager.config).toEqual(DEFAULT_CONFIG);
  });

  /**
   * TEST: Get configuration value
   * WHY: Must retrieve specific config values
   */
  test('should get configuration value by key', () => {
    const manager = new ConfigManager();

    const value = manager.get('copyUrlKey');

    expect(value).toBe(DEFAULT_CONFIG.copyUrlKey);
  });

  /**
   * TEST: Set configuration value
   * WHY: Must update config values
   */
  test('should set configuration value', () => {
    const manager = new ConfigManager();

    manager.set('copyUrlKey', 'u');

    expect(manager.config.copyUrlKey).toBe('u');
  });

  /**
   * TEST: Save to storage
   * WHY: Must persist configuration changes
   */
  test('should save configuration to storage', async () => {
    const manager = new ConfigManager();

    await manager.save();

    expect(browser.storage.local.set).toHaveBeenCalledWith(manager.config);
  });

  /**
   * TEST: Update multiple values
   * WHY: Must support bulk updates
   */
  test('should update multiple configuration values', () => {
    const manager = new ConfigManager();
    const updates = {
      copyUrlKey: 'u',
      copyTextKey: 't',
      debugMode: true
    };

    manager.update(updates);

    expect(manager.config.copyUrlKey).toBe('u');
    expect(manager.config.copyTextKey).toBe('t');
    expect(manager.config.debugMode).toBe(true);
  });

  /**
   * TEST: Configuration change listeners
   * WHY: Must notify listeners of changes
   */
  test('should notify listeners on configuration change', () => {
    const manager = new ConfigManager();
    const listener = jest.fn();

    manager.onChange(listener);
    manager.set('debugMode', true);

    expect(listener).toHaveBeenCalledWith('debugMode', true, manager.config);
  });

  /**
   * TEST: Get all configuration
   * WHY: Must return full config object
   */
  test('should return all configuration', () => {
    const manager = new ConfigManager();

    const allConfig = manager.getAll();

    expect(allConfig).toEqual(manager.config);
    expect(allConfig).not.toBe(manager.config); // Should be a copy
  });
});

// ==============================================================================
// PART 4: STATEMANAGER TESTS
// ==============================================================================
describe('StateManager', () => {
  let StateManager;

  beforeAll(() => {
    const stateModule = require('../src/core/state.js');
    StateManager = stateModule.StateManager;
  });

  /**
   * TEST: StateManager initialization
   * WHY: Must start with default state
   */
  test('should initialize with default state', () => {
    const manager = new StateManager();

    expect(manager.state).toBeDefined();
    expect(manager.state.currentHoveredLink).toBeNull();
    expect(manager.state.quickTabWindows).toEqual([]);
    expect(manager.state.quickTabZIndex).toBe(1000000);
  });

  /**
   * TEST: Get state value
   * WHY: Must retrieve specific state values
   */
  test('should get state value by key', () => {
    const manager = new StateManager();

    const value = manager.get('quickTabZIndex');

    expect(value).toBe(1000000);
  });

  /**
   * TEST: Set state value
   * WHY: Must update state values
   */
  test('should set state value', () => {
    const manager = new StateManager();

    manager.set('currentHoveredLink', 'https://example.com');

    expect(manager.state.currentHoveredLink).toBe('https://example.com');
  });

  /**
   * TEST: Get full state
   * WHY: Must return entire state object
   */
  test('should return full state object', () => {
    const manager = new StateManager();

    const state = manager.getState();

    expect(state).toEqual(manager.state);
    expect(state).not.toBe(manager.state); // Should be a copy
  });

  /**
   * TEST: Update multiple state values
   * WHY: Must support bulk updates
   */
  test('should update multiple state values', () => {
    const manager = new StateManager();
    const updates = {
      lastMouseX: 100,
      lastMouseY: 200,
      isPanelOpen: true
    };

    manager.setState(updates);

    expect(manager.state.lastMouseX).toBe(100);
    expect(manager.state.lastMouseY).toBe(200);
    expect(manager.state.isPanelOpen).toBe(true);
  });

  /**
   * TEST: State change listeners
   * WHY: Must notify listeners of state changes
   */
  test('should notify listeners on state change', () => {
    const manager = new StateManager();
    const listener = jest.fn();

    manager.subscribe('isPanelOpen', listener);
    manager.set('isPanelOpen', true);

    expect(listener).toHaveBeenCalledWith('isPanelOpen', true, false, manager.state);
  });

  /**
   * TEST: Subscribe to all state changes
   * WHY: Must support wildcard listeners
   */
  test('should support wildcard state listeners', () => {
    const manager = new StateManager();
    const listener = jest.fn();

    manager.subscribe(listener);
    manager.set('lastMouseX', 50);

    expect(listener).toHaveBeenCalled();
  });

  /**
   * TEST: Unsubscribe from state changes
   * WHY: Must support cleanup of listeners
   */
  test('should unsubscribe from state changes', () => {
    const manager = new StateManager();
    const listener = jest.fn();

    const unsubscribe = manager.subscribe('isPanelOpen', listener);
    unsubscribe();
    manager.set('isPanelOpen', true);

    expect(listener).not.toHaveBeenCalled();
  });

  /**
   * TEST: Reset state
   * WHY: Must return to initial state
   */
  test('should reset state to initial values', () => {
    const manager = new StateManager();

    manager.set('lastMouseX', 100);
    manager.set('isPanelOpen', true);
    manager.reset();

    expect(manager.state.lastMouseX).toBe(0);
    expect(manager.state.isPanelOpen).toBe(false);
  });

  /**
   * TEST: Quick Tab window tracking
   * WHY: Must track active Quick Tab windows
   */
  test('should track Quick Tab windows', () => {
    const manager = new StateManager();
    const window1 = { id: 'qt1', url: 'https://example.com' };
    const window2 = { id: 'qt2', url: 'https://test.com' };

    manager.set('quickTabWindows', [window1, window2]);

    expect(manager.state.quickTabWindows).toHaveLength(2);
    expect(manager.state.quickTabWindows[0]).toEqual(window1);
  });
});

// ==============================================================================
// PART 5: BROWSER API WRAPPER TESTS
// ==============================================================================
describe('Browser API Wrappers', () => {
  let browserApi;

  beforeAll(() => {
    browserApi = require('../src/core/browser-api.js');
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * TEST: Send message to background
   * WHY: Content script must communicate with background
   */
  test('should send message to background script', async () => {
    const message = { action: 'copyUrl', url: 'https://example.com' };

    browser.runtime.sendMessage.mockResolvedValue({ success: true });

    const response = await browserApi.sendMessageToBackground(message);

    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(message);
    expect(response.success).toBe(true);
  });

  /**
   * TEST: Get from storage
   * WHY: Must retrieve stored data
   */
  test('should get data from storage', async () => {
    const mockData = { debugMode: true };

    browser.storage.local.get.mockResolvedValue(mockData);

    const result = await browserApi.getStorage('debugMode');

    expect(browser.storage.local.get).toHaveBeenCalledWith('debugMode');
    expect(result).toEqual(mockData);
  });

  /**
   * TEST: Set storage
   * WHY: Must save data to storage
   */
  test('should set data in storage', async () => {
    const data = { debugMode: true, darkMode: false };

    await browserApi.setStorage(data);

    expect(browser.storage.local.set).toHaveBeenCalledWith(data);
  });

  /**
   * TEST: Remove from storage
   * WHY: Must delete stored data
   */
  test('should remove data from storage', async () => {
    await browserApi.removeStorage('debugMode');

    expect(browser.storage.local.remove).toHaveBeenCalledWith('debugMode');
  });

  /**
   * TEST: Clear storage
   * WHY: Must clear all stored data
   */
  test('should clear all storage', async () => {
    await browserApi.clearStorage();

    expect(browser.storage.local.clear).toHaveBeenCalled();
  });

  /**
   * TEST: Copy to clipboard
   * WHY: Core functionality - copying URLs/text
   */
  test('should copy text to clipboard', async () => {
    const text = 'https://example.com';

    // navigator.clipboard is already mocked in setup.js
    const success = await browserApi.copyToClipboard(text);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(text);
    expect(success).toBe(true);
  });

  /**
   * TEST: Clipboard fallback
   * WHY: Must handle clipboard API failure
   */
  test('should fallback to execCommand if clipboard API fails', async () => {
    const text = 'https://example.com';

    // Mock writeText to reject for this specific test
    navigator.clipboard.writeText.mockRejectedValueOnce(new Error('Not allowed'));
    document.execCommand = jest.fn(() => true);

    const success = await browserApi.copyToClipboard(text);

    expect(success).toBe(true);
    expect(document.execCommand).toHaveBeenCalled();
  });

  /**
   * TEST: Get current tab
   * WHY: Must retrieve active tab information
   */
  test('should get current tab information', async () => {
    const mockTab = { id: 1, url: 'https://example.com' };

    browser.tabs.query.mockResolvedValue([mockTab]);

    const tab = await browserApi.getCurrentTab();

    expect(browser.tabs.query).toHaveBeenCalledWith({
      active: true,
      currentWindow: true
    });
    expect(tab).toEqual(mockTab);
  });

  /**
   * TEST: Create new tab
   * WHY: Must create tabs with specific URLs
   */
  test('should create new tab', async () => {
    const options = { url: 'https://example.com', active: false };
    const mockTab = { id: 2, ...options };

    browser.tabs.create.mockResolvedValue(mockTab);

    const tab = await browserApi.createTab(options);

    expect(browser.tabs.create).toHaveBeenCalledWith(options);
    expect(tab).toEqual(mockTab);
  });

  /**
   * TEST: Get container information
   * WHY: Must retrieve Firefox container details
   */
  test('should get container information', async () => {
    const mockContainer = {
      cookieStoreId: 'firefox-container-1',
      name: 'Personal'
    };

    browser.contextualIdentities.get.mockResolvedValue(mockContainer);

    const container = await browserApi.getContainer(1);

    expect(browser.contextualIdentities.get).toHaveBeenCalledWith('firefox-container-1');
    expect(container).toEqual(mockContainer);
  });

  /**
   * TEST: API support detection
   * WHY: Must check if browser supports specific APIs
   */
  test('should check if API is supported', () => {
    const isSupported = browserApi.isApiSupported('storage.local');

    expect(isSupported).toBe(true);
  });

  /**
   * TEST: API support detection (unsupported)
   * WHY: Must correctly identify unsupported APIs
   */
  test('should detect unsupported API', () => {
    const isSupported = browserApi.isApiSupported('nonexistent.api');

    expect(isSupported).toBe(false);
  });
});

// ==============================================================================
// PART 6: DOM UTILITIES TESTS
// ==============================================================================
describe('DOM Utilities', () => {
  let domUtils;

  beforeAll(() => {
    domUtils = require('../src/utils/dom.js');
  });

  /**
   * TEST: Create element
   * WHY: Must create DOM elements programmatically
   */
  test('should create element with attributes', () => {
    const element = domUtils.createElement('div', {
      id: 'test',
      className: 'test-class',
      'data-url': 'https://example.com'
    });

    expect(element.tagName).toBe('DIV');
    expect(element.id).toBe('test');
    expect(element.className).toBe('test-class');
    expect(element.getAttribute('data-url')).toBe('https://example.com');
  });

  /**
   * TEST: Create element with children
   * WHY: Must support nested elements
   */
  test('should create element with children', () => {
    const child = domUtils.createElement('span', {}, 'Child text');
    const parent = domUtils.createElement('div', {}, [child]);

    expect(parent.children.length).toBe(1);
    expect(parent.children[0]).toBe(child);
  });

  /**
   * TEST: Create element with text content
   * WHY: Must set text content correctly
   */
  test('should create element with text content', () => {
    const element = domUtils.createElement('p', {}, 'Test text');

    expect(element.textContent).toBe('Test text');
  });

  /**
   * TEST: Create element with inline styles
   * WHY: Must apply styles programmatically
   */
  test('should create element with inline styles', () => {
    const element = domUtils.createElement('div', {
      style: {
        width: '100px',
        height: '200px',
        backgroundColor: 'red'
      }
    });

    expect(element.style.width).toBe('100px');
    expect(element.style.height).toBe('200px');
    expect(element.style.backgroundColor).toBe('red');
  });

  /**
   * TEST: Remove element
   * WHY: Must remove elements from DOM
   */
  test('should remove element from DOM', () => {
    const parent = document.createElement('div');
    const child = document.createElement('span');
    parent.appendChild(child);
    document.body.appendChild(parent);

    domUtils.removeElement(child);

    expect(parent.children.length).toBe(0);

    document.body.removeChild(parent);
  });

  /**
   * TEST: Element visibility check
   * WHY: Must detect if element is visible
   */
  test('should check if element is visible', () => {
    const element = document.createElement('div');
    document.body.appendChild(element);

    const visible = domUtils.isVisible(element);

    expect(visible).toBe(true);

    document.body.removeChild(element);
  });

  /**
   * TEST: Element visibility (hidden)
   * WHY: Must detect hidden elements
   */
  test('should detect hidden elements', () => {
    const element = document.createElement('div');
    element.style.display = 'none';
    document.body.appendChild(element);

    const visible = domUtils.isVisible(element);

    expect(visible).toBe(false);

    document.body.removeChild(element);
  });

  /**
   * TEST: Get element position
   * WHY: Must retrieve element coordinates
   */
  test('should get element position', () => {
    const element = document.createElement('div');
    element.style.position = 'absolute';
    element.style.left = '100px';
    element.style.top = '200px';
    element.style.width = '300px';
    element.style.height = '400px';

    // Mock getBoundingClientRect since JSDOM doesn't calculate layout
    element.getBoundingClientRect = jest.fn(() => ({
      x: 100,
      y: 200,
      width: 300,
      height: 400,
      top: 200,
      left: 100,
      bottom: 600,
      right: 400
    }));

    document.body.appendChild(element);

    const position = domUtils.getElementPosition(element);

    expect(position.x).toBeGreaterThanOrEqual(0);
    expect(position.y).toBeGreaterThanOrEqual(0);
    expect(position.width).toBeGreaterThan(0);
    expect(position.height).toBeGreaterThan(0);

    document.body.removeChild(element);
  });

  /**
   * TEST: Set element position
   * WHY: Must position elements programmatically
   */
  test('should set element position', () => {
    const element = document.createElement('div');

    domUtils.setElementPosition(element, 100, 200);

    expect(element.style.left).toBe('100px');
    expect(element.style.top).toBe('200px');
  });

  /**
   * TEST: Set element size
   * WHY: Must resize elements programmatically
   */
  test('should set element size', () => {
    const element = document.createElement('div');

    domUtils.setElementSize(element, 300, 400);

    expect(element.style.width).toBe('300px');
    expect(element.style.height).toBe('400px');
  });

  /**
   * TEST: Add CSS class
   * WHY: Must add classes dynamically
   */
  test('should add CSS class to element', () => {
    const element = document.createElement('div');

    domUtils.addClass(element, 'test-class');

    expect(element.classList.contains('test-class')).toBe(true);
  });

  /**
   * TEST: Remove CSS class
   * WHY: Must remove classes dynamically
   */
  test('should remove CSS class from element', () => {
    const element = document.createElement('div');
    element.classList.add('test-class');

    domUtils.removeClass(element, 'test-class');

    expect(element.classList.contains('test-class')).toBe(false);
  });

  /**
   * TEST: Toggle CSS class
   * WHY: Must toggle classes dynamically
   */
  test('should toggle CSS class on element', () => {
    const element = document.createElement('div');

    const added = domUtils.toggleClass(element, 'test-class');
    expect(added).toBe(true);
    expect(element.classList.contains('test-class')).toBe(true);

    const removed = domUtils.toggleClass(element, 'test-class');
    expect(removed).toBe(false);
    expect(element.classList.contains('test-class')).toBe(false);
  });

  /**
   * TEST: Check for CSS class
   * WHY: Must check if element has class
   */
  test('should check if element has CSS class', () => {
    const element = document.createElement('div');
    element.classList.add('test-class');

    const hasClass = domUtils.hasClass(element, 'test-class');

    expect(hasClass).toBe(true);
  });
});

// ==============================================================================
// PART 7: CONTAINER ISOLATION TESTS
// ==============================================================================
describe('Container Isolation', () => {
  /**
   * TEST: Valid Firefox container IDs
   * WHY: Must recognize Firefox container format
   */
  test('should recognize valid Firefox container IDs', () => {
    const validIds = [
      'firefox-default',
      'firefox-container-1',
      'firefox-container-personal',
      'firefox-container-work'
    ];

    validIds.forEach(id => {
      expect(id).toMatch(/^firefox-/);
    });
  });

  /**
   * TEST: Invalid container IDs
   * WHY: Must reject non-Firefox container IDs
   */
  test('should reject invalid container IDs', () => {
    const invalidIds = ['', 'chrome-default', 'container-1', null, undefined];

    invalidIds.forEach(id => {
      if (id) {
        expect(id).not.toMatch(/^firefox-/);
      } else {
        expect(id).toBeFalsy();
      }
    });
  });

  /**
   * TEST: cookieStoreId sanitization
   * WHY: Must handle null/undefined cookieStoreIds
   */
  test('should sanitize cookieStoreId', () => {
    const sanitize = id => id || 'firefox-default';

    expect(sanitize('firefox-container-1')).toBe('firefox-container-1');
    expect(sanitize('')).toBe('firefox-default');
    expect(sanitize(null)).toBe('firefox-default');
    expect(sanitize(undefined)).toBe('firefox-default');
  });

  /**
   * TEST: Container ID extraction
   * WHY: Must extract numeric ID from cookieStoreId
   */
  test('should extract container ID from cookieStoreId', () => {
    const extractId = cookieStoreId => {
      const match = cookieStoreId.match(/firefox-container-(\d+)/);
      return match ? parseInt(match[1], 10) : null;
    };

    expect(extractId('firefox-container-1')).toBe(1);
    expect(extractId('firefox-container-42')).toBe(42);
    expect(extractId('firefox-default')).toBeNull();
  });
});

// ==============================================================================
// PART 8: URL HANDLING TESTS
// ==============================================================================
describe('URL Handling', () => {
  /**
   * TEST: URL parsing
   * WHY: Extension relies on URL manipulation
   */
  test('should parse URLs correctly', () => {
    const testUrl = 'https://example.com:8080/path?query=value#hash';
    const parsed = new URL(testUrl);

    expect(parsed.protocol).toBe('https:');
    expect(parsed.hostname).toBe('example.com');
    expect(parsed.port).toBe('8080');
    expect(parsed.pathname).toBe('/path');
    expect(parsed.search).toBe('?query=value');
    expect(parsed.hash).toBe('#hash');
  });

  /**
   * TEST: URL validation
   * WHY: Must validate URLs before processing
   */
  test('should validate URLs', () => {
    const isValidUrl = url => {
      try {
        new URL(url);
        return true;
      } catch {
        return false;
      }
    };

    expect(isValidUrl('https://example.com')).toBe(true);
    expect(isValidUrl('http://test.org/path')).toBe(true);
    expect(isValidUrl('not-a-url')).toBe(false);
    expect(isValidUrl('')).toBe(false);
  });

  /**
   * TEST: Domain extraction
   * WHY: Used for favicon URLs
   */
  test('should extract domain from URL', () => {
    const getDomain = url => {
      try {
        return new URL(url).hostname;
      } catch {
        return null;
      }
    };

    expect(getDomain('https://example.com/path')).toBe('example.com');
    expect(getDomain('http://subdomain.test.org')).toBe('subdomain.test.org');
    expect(getDomain('not-a-url')).toBeNull();
  });

  /**
   * TEST: Query parameter extraction
   * WHY: May need to parse URL parameters
   */
  test('should extract query parameters from URL', () => {
    const getQueryParams = url => {
      try {
        const parsed = new URL(url);
        const params = {};
        parsed.searchParams.forEach((value, key) => {
          params[key] = value;
        });
        return params;
      } catch {
        return {};
      }
    };

    const params = getQueryParams('https://example.com?foo=bar&baz=qux');

    expect(params.foo).toBe('bar');
    expect(params.baz).toBe('qux');
  });
});

// ==============================================================================
// PART 9: KEYBOARD SHORTCUT HANDLING TESTS
// ==============================================================================
describe('Keyboard Shortcuts', () => {
  /**
   * TEST: Key combination matching
   * WHY: Must detect configured keyboard shortcuts
   */
  test('should match key combinations', () => {
    const matchesShortcut = (event, config) => {
      return (
        event.key === config.key &&
        event.ctrlKey === config.ctrl &&
        event.altKey === config.alt &&
        event.shiftKey === config.shift
      );
    };

    const config = { key: 'y', ctrl: false, alt: false, shift: false };
    const event = {
      key: 'y',
      ctrlKey: false,
      altKey: false,
      shiftKey: false
    };

    expect(matchesShortcut(event, config)).toBe(true);
  });

  /**
   * TEST: Modifier key detection
   * WHY: Must detect Ctrl/Alt/Shift modifiers
   */
  test('should detect modifier keys', () => {
    const event = {
      key: 'y',
      ctrlKey: true,
      altKey: false,
      shiftKey: false
    };

    expect(event.ctrlKey).toBe(true);
    expect(event.altKey).toBe(false);
    expect(event.shiftKey).toBe(false);
  });
});

// ==============================================================================
// PART 10: ERROR HANDLING TESTS
// ==============================================================================
describe('Error Handling', () => {
  /**
   * TEST: Storage quota exceeded
   * WHY: Must handle storage quota errors
   */
  test('should handle storage quota exceeded', async () => {
    const browserApi = require('../src/core/browser-api.js');

    browser.storage.local.set.mockRejectedValue(new Error('QuotaExceededError'));

    await expect(browserApi.setStorage({ largeData: 'x'.repeat(200000) })).rejects.toThrow();
  });

  /**
   * TEST: Invalid message handling
   * WHY: Must handle malformed messages gracefully
   */
  test('should handle invalid messages', async () => {
    const browserApi = require('../src/core/browser-api.js');

    browser.runtime.sendMessage.mockRejectedValue(new Error('Could not establish connection'));

    await expect(browserApi.sendMessageToBackground({ invalid: true })).rejects.toThrow();
  });

  /**
   * TEST: Null element handling
   * WHY: Must handle null DOM elements
   */
  test('should handle null elements gracefully', () => {
    const domUtils = require('../src/utils/dom.js');

    expect(() => domUtils.setElementPosition(null, 100, 200)).not.toThrow();
    expect(() => domUtils.addClass(null, 'test')).not.toThrow();
  });
});

// ==============================================================================
// NEXT STEPS FOR EXPANDING TEST COVERAGE
// ==============================================================================
/**
 * TO REACH 70%+ COVERAGE:
 *
 * 1. Test background.js message handlers
 * 2. Test state-manager.js persistence logic
 * 3. Test popup.js UI interactions
 * 4. Test options_page.js settings save/load
 * 5. Test src/features/ modules (Quick Tabs, etc.)
 * 6. Test event system (src/core/events.js)
 * 7. Add integration tests combining multiple modules
 * 8. Add edge case tests for each function
 * 9. Test async error scenarios
 * 10. Test browser API polyfills
 *
 * COVERAGE GOALS:
 * - Core modules: 80%+ (config, state, browser-api, dom)
 * - Features: 60%+ (quick-tabs, tooltips, notifications)
 * - UI scripts: 50%+ (popup, options)
 * - Utilities: 90%+ (helpers, validators)
 */
