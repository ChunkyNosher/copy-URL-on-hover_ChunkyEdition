/**
 * Tests for Console Interceptor error serialization
 * Verifies that Error objects preserve stack traces and non-enumerable properties
 */

describe('Console Interceptor Error Serialization', () => {
  let consoleInterceptor;
  let originalConsole;

  beforeAll(async () => {
    // Save original console before importing interceptor
    originalConsole = {
      log: console.log,
      error: console.error,
      warn: console.warn
    };
  });

  beforeEach(async () => {
    // Clear any previous module cache
    jest.resetModules();
    
    // Import fresh interceptor for each test
    consoleInterceptor = await import('../../src/utils/console-interceptor.js');
    
    // Clear log buffer
    consoleInterceptor.clearConsoleLogs();
  });

  afterAll(() => {
    // Restore original console methods
    if (consoleInterceptor && consoleInterceptor.restoreConsole) {
      consoleInterceptor.restoreConsole();
    }
  });

  test('captures Error stack traces in console.error', () => {
    const testError = new Error('Test error message');
    
    // Log the error
    console.error('Error occurred:', testError);
    
    // Get captured logs
    const logs = consoleInterceptor.getConsoleLogs();
    
    // Verify error was captured
    expect(logs.length).toBeGreaterThan(0);
    
    const lastLog = logs[logs.length - 1];
    expect(lastLog.type).toBe('ERROR');
    expect(lastLog.message).toContain('Test error message');
    expect(lastLog.message).toContain('stack');
  });

  test('preserves Error.stack property', () => {
    const testError = new Error('Stack test');
    testError.stack = 'Error: Stack test\n    at testFunction (file.js:10:5)';
    
    console.error(testError);
    
    const logs = consoleInterceptor.getConsoleLogs();
    const lastLog = logs[logs.length - 1];
    
    expect(lastLog.message).toContain('Stack test');
    expect(lastLog.message).toContain('testFunction');
    expect(lastLog.message).toContain('file.js:10:5');
  });

  test('captures Error.cause chain', () => {
    const rootCause = new Error('Root cause');
    const mainError = new Error('Main error');
    mainError.cause = rootCause;
    
    console.error(mainError);
    
    const logs = consoleInterceptor.getConsoleLogs();
    const lastLog = logs[logs.length - 1];
    
    expect(lastLog.message).toContain('Main error');
    expect(lastLog.message).toContain('Root cause');
    expect(lastLog.message).toContain('cause');
  });

  test('captures Error with custom properties', () => {
    const customError = new Error('Custom error');
    customError.code = 'ERR_CUSTOM';
    customError.details = { foo: 'bar' };
    
    console.error(customError);
    
    const logs = consoleInterceptor.getConsoleLogs();
    const lastLog = logs[logs.length - 1];
    
    expect(lastLog.message).toContain('Custom error');
    expect(lastLog.message).toContain('ERR_CUSTOM');
  });

  test('handles TypeError with proper serialization', () => {
    const typeError = new TypeError('Cannot read property of undefined');
    typeError.stack = 'TypeError: Cannot read property\n    at handler (content.js:100:10)';
    
    console.error('Type error:', typeError);
    
    const logs = consoleInterceptor.getConsoleLogs();
    const lastLog = logs[logs.length - 1];
    
    expect(lastLog.message).toContain('TypeError');
    expect(lastLog.message).toContain('Cannot read property');
    expect(lastLog.message).toContain('content.js:100:10');
  });

  test('handles regular objects without Error properties', () => {
    const regularObject = { message: 'Not an error', data: [1, 2, 3] };
    
    console.log('Regular object:', regularObject);
    
    const logs = consoleInterceptor.getConsoleLogs();
    const lastLog = logs[logs.length - 1];
    
    expect(lastLog.type).toBe('LOG');
    expect(lastLog.message).toContain('Not an error');
    expect(lastLog.message).toContain('1');
    expect(lastLog.message).toContain('2');
    expect(lastLog.message).toContain('3');
  });

  test('preserves Firefox-specific error properties', () => {
    const firefoxError = new Error('Firefox error');
    firefoxError.fileName = 'moz-extension://abc123/content.js';
    firefoxError.lineNumber = 42;
    firefoxError.columnNumber = 15;
    
    console.error(firefoxError);
    
    const logs = consoleInterceptor.getConsoleLogs();
    const lastLog = logs[logs.length - 1];
    
    expect(lastLog.message).toContain('Firefox error');
    expect(lastLog.message).toContain('moz-extension://abc123/content.js');
    expect(lastLog.message).toContain('42');
    expect(lastLog.message).toContain('15');
  });

  test('buffer statistics include captured logs', () => {
    console.log('Test log 1');
    console.error(new Error('Test error'));
    console.warn('Test warning');
    
    const stats = consoleInterceptor.getBufferStats();
    
    expect(stats.totalLogs).toBeGreaterThanOrEqual(3);
    expect(stats.maxSize).toBe(5000);
    expect(stats.oldestTimestamp).toBeDefined();
    expect(stats.newestTimestamp).toBeDefined();
  });
});
