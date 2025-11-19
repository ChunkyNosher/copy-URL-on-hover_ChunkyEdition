/**
 * LegacyMigrator - Handles legacy storage format
 *
 * Format: { tabs: [...], timestamp: ... }
 * This format has a flat tabs array without container isolation.
 * Migrates to default container.
 *
 * @class LegacyMigrator
 */
export class LegacyMigrator {
  /**
   * Migrate legacy format to global state
   *
   * @param {Object} data - Storage data with tabs array
   * @param {Object} globalState - Target state object to populate
   * @returns {Object} Updated global state
   */
  migrate(data, globalState) {
    // Convert flat tabs array to default container structure
    globalState.containers['firefox-default'] = {
      tabs: data.tabs || [],
      lastUpdate: data.timestamp || Date.now()
    };

    return globalState;
  }

  /**
   * Get format name for logging
   *
   * @returns {string} Format identifier
   */
  getFormatName() {
    return 'legacy (flat tabs array)';
  }
}
