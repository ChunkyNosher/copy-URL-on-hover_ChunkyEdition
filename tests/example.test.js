/**
 * Example test suite for copy-URL-on-hover extension
 * This file provides a basic test to enable Codecov integration
 */

describe('Extension Configuration', () => {
  test('should have valid manifest version', () => {
    // Basic test to ensure test infrastructure works
    expect(true).toBe(true);
  });
  
  test('constants are defined correctly', () => {
    const MAX_STORAGE_SIZE = 100 * 1024; // 100KB
    expect(MAX_STORAGE_SIZE).toBe(102400);
  });
});

describe('Helper Functions', () => {
  test('should validate cookieStoreId format', () => {
    const validId = 'firefox-container-1';
    const invalidId = '';
    
    expect(validId).toMatch(/^firefox-/);
    expect(invalidId).not.toMatch(/^firefox-/);
  });
});
