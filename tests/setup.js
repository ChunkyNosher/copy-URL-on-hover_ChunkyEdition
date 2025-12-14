// Jest setup file for browser extension testing
// This file runs before each test suite

// v1.6.3.7 - Mock requestAnimationFrame to run synchronously in tests
// This is needed because our ResizeHandle now uses rAF for throttling
// We run the callback immediately (synchronously) to allow tests to work without async handling
let rafIdCounter = 0;
global.requestAnimationFrame = callback => {
  const id = ++rafIdCounter;
  // Run immediately/synchronously for tests
  callback(performance.now());
  return id;
};
global.cancelAnimationFrame = _id => {
  // No-op since callback already executed
};

// Mock browser API
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
    },
    session: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
      clear: jest.fn()
    }
  },
  runtime: {
    // v1.6.3.8-v12 GAP-2 fix: Make sendMessage return a Promise for message routing tests
    sendMessage: jest.fn().mockResolvedValue({ success: true }),
    onMessage: {
      addListener: jest.fn()
    }
  },
  tabs: {
    query: jest.fn(),
    // v1.6.3.8-v12 GAP-5 fix: Make tabs.sendMessage return a Promise for broadcast tests
    sendMessage: jest.fn().mockResolvedValue({ success: true }),
    create: jest.fn()
  },
  contextualIdentities: {
    query: jest.fn(),
    get: jest.fn()
  },
  commands: {
    onCommand: {
      addListener: jest.fn()
    }
  }
};

// Mock console methods to reduce noise
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

// Mock navigator.clipboard (not provided by JSDOM)
Object.defineProperty(global.navigator, 'clipboard', {
  value: {
    writeText: jest.fn().mockResolvedValue(undefined),
    readText: jest.fn().mockResolvedValue('')
  },
  writable: true,
  configurable: true
});

// v1.6.0 Phase 2.9 - Mock PointerEvent for Drag/Resize tests
// JSDOM doesn't provide PointerEvent, so we polyfill it
if (typeof global.PointerEvent === 'undefined') {
  global.PointerEvent = class PointerEvent extends MouseEvent {
    constructor(type, params = {}) {
      super(type, params);
      this.pointerId = params.pointerId || 0;
      this.width = params.width || 1;
      this.height = params.height || 1;
      this.pressure = params.pressure || 0;
      this.tangentialPressure = params.tangentialPressure || 0;
      this.tiltX = params.tiltX || 0;
      this.tiltY = params.tiltY || 0;
      this.twist = params.twist || 0;
      this.pointerType = params.pointerType || 'mouse';
      this.isPrimary = params.isPrimary !== undefined ? params.isPrimary : true;
    }
  };
}

// Add TextEncoder and TextDecoder polyfills for JSDOM
// Required for cross-tab simulator tests that use JSDOM
if (typeof global.TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util');
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
}

// Add custom matchers if needed
expect.extend({
  toBeValidURL(received) {
    try {
      new URL(received);
      return {
        pass: true,
        message: () => `Expected ${received} not to be a valid URL`
      };
    } catch {
      return {
        pass: false,
        message: () => `Expected ${received} to be a valid URL`
      };
    }
  }
});
