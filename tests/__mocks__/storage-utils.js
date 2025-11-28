/**
 * Mock for storage-utils module
 * Used in unit tests to prevent actual storage operations
 */

export const STATE_KEY = 'quick_tabs_state_v2';

export function generateSaveId() {
  return `test-${Date.now()}-mockid`;
}

export function getBrowserStorageAPI() {
  // Return null in tests to skip storage operations
  return null;
}

export function buildStateForStorage(quickTabsMap, minimizedManager) {
  const tabs = [];
  for (const tab of quickTabsMap.values()) {
    const isMinimized = minimizedManager?.isMinimized?.(tab.id) || false;
    tabs.push({
      id: tab.id,
      url: tab.url,
      title: tab.title,
      left: tab.left,
      top: tab.top,
      width: tab.width,
      height: tab.height,
      minimized: isMinimized,
      soloedOnTabs: tab.soloedOnTabs || [],
      mutedOnTabs: tab.mutedOnTabs || []
    });
  }
  return {
    tabs: tabs,
    timestamp: Date.now(),
    saveId: generateSaveId()
  };
}

export function persistStateToStorage(_state, _logPrefix) {
  // No-op in tests
}
