/**
 * FormatMigrator - Strategy pattern for detecting and migrating legacy storage formats
 *
 * Handles migration from v1.5.8.13-15 storage formats to current format.
 * Uses strategy pattern for extensibility - adding new format = add one class.
 *
 * Supported Formats:
 * - V1_5_8_15_Format: Container-aware with containers key (current)
 * - V1_5_8_14_Format: Unwrapped container format
 * - LegacyFormat: Flat tabs array
 * - EmptyFormat: Fallback for unrecognized/empty data
 */

/**
 * Base format strategy
 * @abstract
 */
/* eslint-disable require-await */
class FormatStrategy {
  /**
   * Check if data matches this format
   * @param {Object} data - Raw storage data
   * @returns {boolean}
   */
  matches(_data) {
    throw new Error('FormatStrategy.matches() must be implemented');
  }

  /**
   * Parse data into standard container-aware format
   * @param {Object} data - Raw storage data
   * @returns {Object.<string, {tabs: Array, lastUpdate: number}>}
   */
  parse(_data) {
    throw new Error('FormatStrategy.parse() must be implemented');
  }

  /**
   * Get format version identifier
   * @returns {string}
   */
  getVersion() {
    throw new Error('FormatStrategy.getVersion() must be implemented');
  }
}

/**
 * V1.5.8.15+ Format (Current)
 *
 * Format:
 * {
 *   containers: {
 *     'firefox-default': {
 *       tabs: [QuickTab, ...],
 *       lastUpdate: timestamp
 *     }
 *   },
 *   saveId: 'timestamp-random',
 *   timestamp: timestamp
 * }
 */
export class V1_5_8_15_Format extends FormatStrategy {
  matches(data) {
    return data && typeof data === 'object' && data.containers !== undefined;
  }

  parse(data) {
    // Already in correct format
    return data.containers || {};
  }

  getVersion() {
    return 'v1.5.8.15+';
  }
}

/**
 * V1.5.8.14 Format
 *
 * Format (unwrapped containers):
 * {
 *   'firefox-default': {
 *     tabs: [QuickTab, ...],
 *     lastUpdate: timestamp
 *   },
 *   'firefox-container-1': {
 *     tabs: [QuickTab, ...],
 *     lastUpdate: timestamp
 *   }
 * }
 */
export class V1_5_8_14_Format extends FormatStrategy {
  matches(data) {
    if (!data || typeof data !== 'object') {
      return false;
    }

    // Has container-like keys but no wrapping containers object
    const hasContainerKeys = Object.keys(data).some(key => key.startsWith('firefox-'));

    const hasNoWrapping = !data.containers && !data.tabs;

    return hasContainerKeys && hasNoWrapping;
  }

  parse(data) {
    // Data is already in container format, just unwrapped
    const containers = {};

    for (const [key, value] of Object.entries(data)) {
      // Skip metadata keys
      if (key === 'saveId' || key === 'timestamp') {
        continue;
      }

      // Only process container keys
      if (key.startsWith('firefox-')) {
        containers[key] = value;
      }
    }

    return containers;
  }

  getVersion() {
    return 'v1.5.8.14';
  }
}

/**
 * Legacy Format (v1.5.8.13 and earlier)
 *
 * Format (flat tabs array):
 * {
 *   tabs: [QuickTab, ...],
 *   timestamp: timestamp
 * }
 */
export class LegacyFormat extends FormatStrategy {
  matches(data) {
    return data && typeof data === 'object' && Array.isArray(data.tabs) && !data.containers;
  }

  parse(data) {
    // Migrate to container-aware format
    // All tabs go into default container
    return {
      'firefox-default': {
        tabs: data.tabs || [],
        lastUpdate: data.timestamp || Date.now()
      }
    };
  }

  getVersion() {
    return 'v1.5.8.13-legacy';
  }
}

/**
 * Empty Format (fallback)
 *
 * Used when data is null, undefined, or unrecognized
 */
export class EmptyFormat extends FormatStrategy {
  matches(_data) {
    // Matches anything (fallback)
    return true;
  }

  parse(_data) {
    // Return empty containers
    return {};
  }

  getVersion() {
    return 'empty';
  }
}

/**
 * FormatMigrator - Main class for format detection and migration
 *
 * Usage:
 * const migrator = new FormatMigrator();
 * const format = migrator.detect(rawData);
 * const containers = format.parse(rawData);
 */
export class FormatMigrator {
  constructor() {
    // Order matters - check specific formats before fallback
    this.formats = [
      new V1_5_8_15_Format(),
      new V1_5_8_14_Format(),
      new LegacyFormat(),
      new EmptyFormat() // Fallback - must be last
    ];
  }

  /**
   * Detect storage format from raw data
   *
   * @param {Object} data - Raw storage data
   * @returns {FormatStrategy} Detected format strategy
   */
  detect(data) {
    for (const format of this.formats) {
      if (format.matches(data)) {
        console.log(`[FormatMigrator] Detected format: ${format.getVersion()}`);
        return format;
      }
    }

    // Should never reach here (EmptyFormat always matches)
    return new EmptyFormat();
  }

  /**
   * Parse data using detected format
   *
   * @param {Object} data - Raw storage data
   * @returns {Object.<string, {tabs: Array, lastUpdate: number}>} Container-aware format
   */
  parse(data) {
    const format = this.detect(data);
    const containers = format.parse(data);

    console.log(`[FormatMigrator] Migrated ${format.getVersion()} to current format`);
    console.log(`[FormatMigrator] Loaded ${Object.keys(containers).length} containers`);

    return containers;
  }

  /**
   * Check if data needs migration
   *
   * @param {Object} data - Raw storage data
   * @returns {boolean} True if data is not in current format
   */
  needsMigration(data) {
    const format = this.detect(data);
    return !(format instanceof V1_5_8_15_Format);
  }

  /**
   * Get list of supported format versions
   *
   * @returns {string[]} Array of version identifiers
   */
  getSupportedVersions() {
    return this.formats.map(f => f.getVersion());
  }
}
