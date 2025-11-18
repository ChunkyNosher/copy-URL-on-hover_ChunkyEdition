/**
 * Test data builders using the Fluent Builder pattern
 * These help create test fixtures with minimal setup
 */

/**
 * Fluent builder for QuickTab domain entities
 * Usage:
 *   const qt = quickTabBuilder()
 *     .url('https://example.com')
 *     .minimized(true)
 *     .build();
 */
export function quickTabBuilder() {
  const defaults = {
    id: `qt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    url: 'https://example.com',
    position: { left: 100, top: 100 },
    size: { width: 400, height: 300 },
    visibility: {
      minimized: false,
      soloedOnTabs: [],
      mutedOnTabs: []
    },
    container: 'firefox-default',
    createdAt: Date.now()
  };

  const builder = {
    id(value) {
      defaults.id = value;
      return builder;
    },
    url(value) {
      defaults.url = value;
      return builder;
    },
    position(left, top) {
      defaults.position = { left, top };
      return builder;
    },
    size(width, height) {
      defaults.size = { width, height };
      return builder;
    },
    minimized(value) {
      defaults.visibility.minimized = value;
      return builder;
    },
    soloedOnTabs(tabs) {
      defaults.visibility.soloedOnTabs = tabs;
      return builder;
    },
    mutedOnTabs(tabs) {
      defaults.visibility.mutedOnTabs = tabs;
      return builder;
    },
    container(value) {
      defaults.container = value;
      return builder;
    },
    build() {
      // For now, return plain object until QuickTab class is created
      return { ...defaults };
    },
    buildMultiple(count) {
      const items = [];
      for (let i = 0; i < count; i++) {
        items.push({
          ...defaults,
          id: `qt-${Date.now()}-${i}`,
          url: `${defaults.url}/${i}`
        });
      }
      return items;
    }
  };

  return builder;
}

/**
 * Fluent builder for container data
 */
export function containerBuilder() {
  const defaults = {
    cookieStoreId: 'firefox-default',
    tabs: [],
    lastUpdate: Date.now()
  };

  const builder = {
    cookieStoreId(value) {
      defaults.cookieStoreId = value;
      return builder;
    },
    tabs(value) {
      defaults.tabs = value;
      return builder;
    },
    lastUpdate(value) {
      defaults.lastUpdate = value;
      return builder;
    },
    build() {
      return { ...defaults };
    }
  };

  return builder;
}

/**
 * Fluent builder for storage state
 */
export function storageStateBuilder() {
  const defaults = {
    containers: {},
    saveId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: Date.now()
  };

  const builder = {
    addContainer(cookieStoreId, tabs) {
      defaults.containers[cookieStoreId] = {
        tabs,
        lastUpdate: Date.now()
      };
      return builder;
    },
    saveId(value) {
      defaults.saveId = value;
      return builder;
    },
    timestamp(value) {
      defaults.timestamp = value;
      return builder;
    },
    build() {
      return { ...defaults };
    }
  };

  return builder;
}
