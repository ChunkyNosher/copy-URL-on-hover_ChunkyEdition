/**
 * Mock implementation of browser.storage API for testing
 */

class MockStorage {
  constructor() {
    this.data = {};
    this.listeners = [];
  }

  async get(keys) {
    if (typeof keys === 'string') {
      return { [keys]: this.data[keys] };
    }

    if (Array.isArray(keys)) {
      const result = {};
      for (const key of keys) {
        if (!(key in this.data)) continue;
        result[key] = this.data[key];
      }
      return result;
    }

    if (keys === null || keys === undefined) {
      return { ...this.data };
    }

    return {};
  }

  async set(items) {
    const changes = {};

    for (const [key, value] of Object.entries(items)) {
      const oldValue = this.data[key];
      this.data[key] = value;

      changes[key] = {
        oldValue,
        newValue: value
      };
    }

    // Notify listeners
    this.listeners.forEach(listener => {
      listener(changes, 'sync');
    });

    return Promise.resolve();
  }

  async remove(keys) {
    const keysArray = Array.isArray(keys) ? keys : [keys];
    const changes = {};

    for (const key of keysArray) {
      if (key in this.data) {
        const oldValue = this.data[key];
        delete this.data[key];

        changes[key] = {
          oldValue,
          newValue: undefined
        };
      }
    }

    // Notify listeners
    if (Object.keys(changes).length > 0) {
      this.listeners.forEach(listener => {
        listener(changes, 'sync');
      });
    }

    return Promise.resolve();
  }

  async clear() {
    const changes = {};

    for (const key of Object.keys(this.data)) {
      changes[key] = {
        oldValue: this.data[key],
        newValue: undefined
      };
    }

    this.data = {};

    // Notify listeners
    if (Object.keys(changes).length > 0) {
      this.listeners.forEach(listener => {
        listener(changes, 'sync');
      });
    }

    return Promise.resolve();
  }

  addListener(listener) {
    this.listeners.push(listener);
  }

  removeListener(listener) {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  // Test helper methods
  _reset() {
    this.data = {};
    this.listeners = [];
  }

  _setData(data) {
    this.data = { ...data };
  }

  _getData() {
    return { ...this.data };
  }
}

const mockSyncStorage = new MockStorage();
const mockLocalStorage = new MockStorage();
const mockSessionStorage = new MockStorage();

export const browserStorageMock = {
  sync: mockSyncStorage,
  local: mockLocalStorage,
  session: mockSessionStorage,
  onChanged: {
    addListener: mockSyncStorage.addListener.bind(mockSyncStorage),
    removeListener: mockSyncStorage.removeListener.bind(mockSyncStorage)
  },
  // Test helpers
  _reset() {
    mockSyncStorage._reset();
    mockLocalStorage._reset();
    mockSessionStorage._reset();
  }
};

export default browserStorageMock;
