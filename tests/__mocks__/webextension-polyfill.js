// tests/__mocks__/webextension-polyfill.js
const browser = {
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    },
    getURL: jest.fn((path) => `moz-extension://fake-id/${path}`)
  },
  storage: {
    sync: {
      get: jest.fn().mockResolvedValue({}),
      set: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined)
    },
    local: {
      get: jest.fn().mockResolvedValue({}),
      set: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined)
    },
    onChanged: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    }
  },
  tabs: {
    query: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ id: 1 }),
    get: jest.fn().mockResolvedValue({ id: 1 }),
    remove: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue({ id: 1 }),
    onActivated: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    },
    onUpdated: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    }
  },
  contextualIdentities: {
    query: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue({
      cookieStoreId: 'firefox-container-1',
      name: 'Personal',
      color: 'blue',
      icon: 'fingerprint'
    }),
    create: jest.fn().mockResolvedValue({
      cookieStoreId: 'firefox-container-1',
      name: 'Personal',
      color: 'blue',
      icon: 'fingerprint'
    }),
    remove: jest.fn().mockResolvedValue({}),
    onCreated: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    },
    onRemoved: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    },
    onUpdated: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    }
  }
};

export default browser;
