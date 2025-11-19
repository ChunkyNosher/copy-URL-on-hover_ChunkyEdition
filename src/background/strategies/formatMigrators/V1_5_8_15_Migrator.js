/**
 * V1_5_8_15_Migrator - Handles v1.5.8.15 storage format
 *
 * Format: { containers: {...}, saveId: '...', timestamp: ... }
 * This format has a containers wrapper with metadata.
 *
 * @class V1_5_8_15_Migrator
 */
export class V1_5_8_15_Migrator {
  /**
   * Migrate v1.5.8.15 format to global state
   *
   * @param {Object} data - Storage data with containers key
   * @param {Object} globalState - Target state object to populate
   * @returns {Object} Updated global state
   */
  migrate(data, globalState) {
    // Copy containers directly - already in correct format
    if (data.containers && typeof data.containers === 'object') {
      globalState.containers = data.containers;
    }

    return globalState;
  }

  /**
   * Get format name for logging
   *
   * @returns {string} Format identifier
   */
  getFormatName() {
    return 'v1.5.8.15 (containers wrapper)';
  }
}
