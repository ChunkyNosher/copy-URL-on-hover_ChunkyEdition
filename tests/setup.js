// Jest setup file for browser extension testing
// This file runs before each test suite

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
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn()
    }
  },
  tabs: {
    query: jest.fn(),
    sendMessage: jest.fn(),
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

// ===== ADD THIS SECTION =====
// Mock navigator.clipboard (not provided by JSDOM)
Object.defineProperty(global.navigator, 'clipboard', {
  value: {
    writeText: jest.fn().mockResolvedValue(undefined),
    readText: jest.fn().mockResolvedValue('')
  },
  writable: true,
  configurable: true
});
// ===========================

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
