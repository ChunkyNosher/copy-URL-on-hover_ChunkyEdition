import { TextDecoder, TextEncoder } from 'util';
import { afterEach, expect, vi } from 'vitest';

globalThis.jest = vi;

let rafIdCounter = 0;
globalThis.requestAnimationFrame = callback => {
  const id = ++rafIdCounter;
  callback(performance.now());
  return id;
};
globalThis.cancelAnimationFrame = _id => {};

globalThis.browser = {
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn()
    },
    sync: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn()
    },
    session: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn()
    }
  },
  runtime: {
    sendMessage: vi.fn().mockResolvedValue({ success: true }),
    onMessage: {
      addListener: vi.fn()
    }
  },
  tabs: {
    query: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue({ success: true }),
    create: vi.fn()
  },
  contextualIdentities: {
    query: vi.fn(),
    get: vi.fn()
  },
  commands: {
    onCommand: {
      addListener: vi.fn()
    }
  }
};

globalThis.console = {
  ...console,
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
};

Object.defineProperty(globalThis.navigator, 'clipboard', {
  value: {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue('')
  },
  writable: true,
  configurable: true
});

if (typeof globalThis.PointerEvent === 'undefined') {
  globalThis.PointerEvent = class PointerEvent extends MouseEvent {
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

if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
}

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

afterEach(() => {
  vi.clearAllMocks();
});
