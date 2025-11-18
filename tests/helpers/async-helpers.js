/**
 * Async test utilities
 */

/**
 * Wait for all pending promises to resolve
 * Useful for testing async operations
 */
export async function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Wait for a condition to be true
 * @param {Function} condition - Function that returns boolean
 * @param {number} timeout - Max time to wait in ms
 * @param {number} interval - Check interval in ms
 */
export async function waitFor(condition, timeout = 5000, interval = 50) {
  const startTime = Date.now();

  while (!condition()) {
    if (Date.now() - startTime > timeout) {
      throw new Error('Timeout waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/**
 * Wait for a specific time
 * @param {number} ms - Milliseconds to wait
 */
export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a mock async function that resolves after delay
 * @param {*} returnValue - Value to return
 * @param {number} delay - Delay in ms
 */
export function mockAsyncFunction(returnValue, delay = 0) {
  return jest.fn(async (...args) => {
    if (delay > 0) {
      await wait(delay);
    }
    return returnValue;
  });
}

/**
 * Create a mock async function that rejects after delay
 * @param {Error} error - Error to throw
 * @param {number} delay - Delay in ms
 */
export function mockAsyncRejection(error, delay = 0) {
  return jest.fn(async (...args) => {
    if (delay > 0) {
      await wait(delay);
    }
    throw error;
  });
}
