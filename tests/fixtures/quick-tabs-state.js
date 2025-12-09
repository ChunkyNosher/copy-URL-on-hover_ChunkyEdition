/**
 * Quick Tabs Test Fixtures
 *
 * Standard test data fixtures for Quick Tab testing
 *
 * Related Documentation:
 * - docs/manual/comprehensive-unit-testing-strategy.md (Section 8.2)
 */

/**
 * Default Quick Tab state
 */
export const defaultQuickTab = {
  id: 'qt-default-1',
  url: 'https://example.com',
  position: {
    left: 100,
    top: 100
  },
  size: {
    width: 800,
    height: 600
  },
  zIndex: 100000,
  isMinimized: false,
  soloTabId: null,
  mutedTabs: [],
  cookieStoreId: 'firefox-default',
  createdAt: Date.now()
};

/**
 * Quick Tab with solo mode active
 */
export const soloQuickTab = {
  id: 'qt-solo-1',
  url: 'https://example.com/solo',
  position: {
    left: 200,
    top: 200
  },
  size: {
    width: 800,
    height: 600
  },
  zIndex: 100001,
  isMinimized: false,
  soloTabId: 123, // Only visible on tab 123
  mutedTabs: [],
  cookieStoreId: 'firefox-default',
  createdAt: Date.now()
};

/**
 * Quick Tab with mute mode active for specific tabs
 */
export const mutedQuickTab = {
  id: 'qt-muted-1',
  url: 'https://example.com/muted',
  position: {
    left: 150,
    top: 150
  },
  size: {
    width: 800,
    height: 600
  },
  zIndex: 100002,
  isMinimized: false,
  soloTabId: null,
  mutedTabs: [456, 789], // Hidden on tabs 456 and 789
  cookieStoreId: 'firefox-default',
  createdAt: Date.now()
};

/**
 * Minimized Quick Tab
 */
export const minimizedQuickTab = {
  id: 'qt-minimized-1',
  url: 'https://example.com/minimized',
  position: {
    left: 300,
    top: 300
  },
  size: {
    width: 800,
    height: 600
  },
  zIndex: 100003,
  isMinimized: true,
  soloTabId: null,
  mutedTabs: [],
  cookieStoreId: 'firefox-default',
  createdAt: Date.now()
};

/**
 * Quick Tab in Personal container
 */
export const personalContainerQuickTab = {
  id: 'qt-personal-1',
  url: 'https://example.com/personal',
  position: {
    left: 400,
    top: 400
  },
  size: {
    width: 800,
    height: 600
  },
  zIndex: 100004,
  isMinimized: false,
  soloTabId: null,
  mutedTabs: [],
  cookieStoreId: 'firefox-container-1',
  createdAt: Date.now()
};

/**
 * Quick Tab in Work container
 */
export const workContainerQuickTab = {
  id: 'qt-work-1',
  url: 'https://example.com/work',
  position: {
    left: 500,
    top: 500
  },
  size: {
    width: 800,
    height: 600
  },
  zIndex: 100005,
  isMinimized: false,
  soloTabId: null,
  mutedTabs: [],
  cookieStoreId: 'firefox-container-2',
  createdAt: Date.now()
};

/**
 * Multiple Quick Tabs for testing cross-tab sync
 */
export const multipleQuickTabs = [
  {
    id: 'qt-multi-1',
    url: 'https://example.com/1',
    position: { left: 100, top: 100 },
    size: { width: 800, height: 600 },
    zIndex: 100010,
    isMinimized: false,
    soloTabId: null,
    mutedTabs: [],
    cookieStoreId: 'firefox-default',
    createdAt: Date.now()
  },
  {
    id: 'qt-multi-2',
    url: 'https://example.com/2',
    position: { left: 200, top: 200 },
    size: { width: 700, height: 500 },
    zIndex: 100011,
    isMinimized: false,
    soloTabId: null,
    mutedTabs: [],
    cookieStoreId: 'firefox-default',
    createdAt: Date.now() + 1000
  },
  {
    id: 'qt-multi-3',
    url: 'https://example.com/3',
    position: { left: 300, top: 300 },
    size: { width: 600, height: 400 },
    zIndex: 100012,
    isMinimized: true,
    soloTabId: null,
    mutedTabs: [],
    cookieStoreId: 'firefox-default',
    createdAt: Date.now() + 2000
  }
];

/**
 * Quick Tabs across different containers
 */
export const multiContainerQuickTabs = [
  {
    id: 'qt-container-default',
    url: 'https://example.com/default',
    position: { left: 100, top: 100 },
    size: { width: 800, height: 600 },
    zIndex: 100020,
    isMinimized: false,
    soloTabId: null,
    mutedTabs: [],
    cookieStoreId: 'firefox-default',
    createdAt: Date.now()
  },
  {
    id: 'qt-container-personal',
    url: 'https://example.com/personal',
    position: { left: 200, top: 200 },
    size: { width: 800, height: 600 },
    zIndex: 100021,
    isMinimized: false,
    soloTabId: null,
    mutedTabs: [],
    cookieStoreId: 'firefox-container-1',
    createdAt: Date.now() + 1000
  },
  {
    id: 'qt-container-work',
    url: 'https://example.com/work',
    position: { left: 300, top: 300 },
    size: { width: 800, height: 600 },
    zIndex: 100022,
    isMinimized: false,
    soloTabId: null,
    mutedTabs: [],
    cookieStoreId: 'firefox-container-2',
    createdAt: Date.now() + 2000
  }
];

/**
 * Corrupted storage entries for error handling tests
 */
export const corruptedStorageEntries = {
  // Valid entry
  'qt_firefox-default_valid-1': {
    id: 'valid-1',
    url: 'https://example.com',
    position: { left: 100, top: 100 },
    size: { width: 800, height: 600 },
    zIndex: 100030,
    isMinimized: false,
    soloTabId: null,
    mutedTabs: [],
    cookieStoreId: 'firefox-default',
    createdAt: Date.now()
  },

  // Missing required fields
  'qt_firefox-default_missing-fields': {
    id: 'missing-fields',
    url: 'https://example.com'
    // Missing position, size, etc.
  },

  // Invalid position data
  'qt_firefox-default_invalid-position': {
    id: 'invalid-position',
    url: 'https://example.com',
    position: 'not-an-object', // Should be object
    size: { width: 800, height: 600 },
    zIndex: 100031,
    isMinimized: false,
    soloTabId: null,
    mutedTabs: [],
    cookieStoreId: 'firefox-default',
    createdAt: Date.now()
  },

  // Invalid size data
  'qt_firefox-default_invalid-size': {
    id: 'invalid-size',
    url: 'https://example.com',
    position: { left: 100, top: 100 },
    size: { width: 'not-a-number', height: -100 }, // Invalid
    zIndex: 100032,
    isMinimized: false,
    soloTabId: null,
    mutedTabs: [],
    cookieStoreId: 'firefox-default',
    createdAt: Date.now()
  },

  // Completely invalid JSON structure
  'qt_firefox-default_invalid-json': 'not-a-json-object'
};

/**
 * Broadcast message fixtures
 */
export const broadcastMessages = {
  create: {
    action: 'CREATE',
    data: {
      id: 'qt-broadcast-1',
      url: 'https://example.com',
      position: { left: 100, top: 100 },
      size: { width: 800, height: 600 },
      zIndex: 100040,
      isMinimized: false,
      soloTabId: null,
      mutedTabs: [],
      cookieStoreId: 'firefox-default',
      createdAt: Date.now()
    }
  },

  updatePosition: {
    action: 'UPDATE_POSITION',
    data: {
      id: 'qt-broadcast-1',
      position: { left: 200, top: 200 }
    }
  },

  updateSize: {
    action: 'UPDATE_SIZE',
    data: {
      id: 'qt-broadcast-1',
      size: { width: 900, height: 700 }
    }
  },

  solo: {
    action: 'SOLO',
    data: {
      id: 'qt-broadcast-1',
      soloTabId: 123
    }
  },

  mute: {
    action: 'MUTE',
    data: {
      id: 'qt-broadcast-1',
      tabId: 456
    }
  },

  minimize: {
    action: 'MINIMIZE',
    data: {
      id: 'qt-broadcast-1'
    }
  },

  restore: {
    action: 'RESTORE',
    data: {
      id: 'qt-broadcast-1'
    }
  },

  close: {
    action: 'CLOSE',
    data: {
      id: 'qt-broadcast-1'
    }
  }
};

/**
 * Storage state for browser restart persistence tests
 */
export const persistentStorageState = {
  'qt_firefox-default_persistent-1': {
    id: 'persistent-1',
    url: 'https://example.com/persistent',
    position: { left: 100, top: 200 },
    size: { width: 650, height: 450 },
    zIndex: 100050,
    isMinimized: false,
    soloTabId: 123,
    mutedTabs: [],
    cookieStoreId: 'firefox-default',
    createdAt: Date.now()
  },
  'qt_firefox-default_persistent-2': {
    id: 'persistent-2',
    url: 'https://example.com/persistent2',
    position: { left: 500, top: 400 },
    size: { width: 900, height: 700 },
    zIndex: 100051,
    isMinimized: true,
    soloTabId: null,
    mutedTabs: [456],
    cookieStoreId: 'firefox-default',
    createdAt: Date.now() + 1000
  }
};
