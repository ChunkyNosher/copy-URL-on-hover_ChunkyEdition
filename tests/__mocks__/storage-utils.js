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

export function persistStateToStorage(_state, _logPrefix) {
  // No-op in tests
}
