/**
 * V1_5_8_14_Migrator - Handles v1.5.8.14 storage format
 *
 * Format: { [cookieStoreId]: { tabs: [...], lastUpdate: ... }, ... }
 * This format has unwrapped containers (direct cookieStoreId keys).
 *
 * @class V1_5_8_14_Migrator
 */
export class V1_5_8_14_Migrator {
  /**
   * Migrate v1.5.8.14 format to global state
   *
   * @param {Object} data - Storage data with cookieStoreId keys
   * @param {Object} globalState - Target state object to populate
   * @returns {Object} Updated global state
   */
  migrate(data, globalState) {
    // Data is already in containers format, just unwrapped
    // Copy directly to containers
    globalState.containers = data;

    return globalState;
  }

  /**
   * Get format name for logging
   *
   * @returns {string} Format identifier
   */
  getFormatName() {
    return 'v1.5.8.14 (unwrapped containers)';
  }
}
