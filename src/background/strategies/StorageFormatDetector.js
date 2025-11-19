/**
 * StorageFormatDetector - Strategy for detecting storage format versions
 * 
 * Reduces complexity by extracting format detection logic from initializeGlobalState.
 * Uses table-driven approach to avoid nested conditionals.
 * 
 * @class StorageFormatDetector
 */
export class StorageFormatDetector {
  /**
   * Detect the storage format version from data structure
   * 
   * @param {any} data - The storage data to analyze
   * @returns {string} Format identifier: 'v1.5.8.15', 'v1.5.8.14', 'legacy', or 'empty'
   */
  detect(data) {
    // Guard: No data
    if (!data) {
      return 'empty';
    }

    // Guard: Not an object
    if (typeof data !== 'object') {
      return 'empty';
    }

    // v1.5.8.15: Has containers wrapper
    if (data.containers) {
      return 'v1.5.8.15';
    }

    // v1.5.8.14: Object format without tabs array or containers
    if (!Array.isArray(data.tabs) && !data.containers) {
      return 'v1.5.8.14';
    }

    // Legacy: Has tabs array
    if (data.tabs) {
      return 'legacy';
    }

    // Unknown format
    return 'empty';
  }
}
