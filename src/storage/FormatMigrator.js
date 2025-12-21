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
 * 
 * v1.6.4.16 - FIX Issue #26: FormatMigrator Schema Evolution Bugs
 * - Added migration logging with [MIGRATION] prefix
 * - Validate migrated data structure
 * - Handle partial migration failure
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
 * 
 * v1.6.4.16 - FIX Issue #26: Enhanced migration logging and validation
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
   * v1.6.4.16 - FIX Issue #26: Enhanced logging
   *
   * @param {Object} data - Raw storage data
   * @returns {FormatStrategy} Detected format strategy
   */
  detect(data) {
    console.log('[MIGRATION] Detecting storage format:', {
      hasData: !!data,
      dataType: typeof data,
      keys: data ? Object.keys(data).slice(0, 5) : []
    });
    
    for (const format of this.formats) {
      if (format.matches(data)) {
        console.log(`[MIGRATION] Detected format: ${format.getVersion()}`);
        return format;
      }
    }

    // Should never reach here (EmptyFormat always matches)
    console.warn('[MIGRATION] No format matched, using EmptyFormat fallback');
    return new EmptyFormat();
  }

  /**
   * Parse data using detected format
   * v1.6.4.16 - FIX Issue #26: Enhanced migration logging and validation
   *
   * @param {Object} data - Raw storage data
   * @returns {Object.<string, {tabs: Array, lastUpdate: number}>} Container-aware format
   */
  parse(data) {
    const migrationStartTime = Date.now();
    const format = this.detect(data);
    const sourceVersion = format.getVersion();
    
    console.log('[MIGRATION] Starting migration:', {
      sourceVersion,
      timestamp: new Date().toISOString()
    });
    
    let containers;
    try {
      containers = format.parse(data);
    } catch (err) {
      console.error('[MIGRATION] Migration failed:', {
        sourceVersion,
        error: err.message,
        stack: err.stack
      });
      // Return empty containers on failure to prevent data loss
      return {};
    }
    
    // Validate migrated data structure
    const validationResult = this._validateMigratedData(containers);
    
    const migrationDurationMs = Date.now() - migrationStartTime;
    console.log('[MIGRATION] Migration completed:', {
      sourceVersion,
      targetVersion: 'v1.5.8.15+',
      containerCount: Object.keys(containers).length,
      totalTabs: validationResult.totalTabs,
      isValid: validationResult.isValid,
      durationMs: migrationDurationMs
    });
    
    if (!validationResult.isValid) {
      console.warn('[MIGRATION] Validation warnings:', validationResult.warnings);
    }

    return containers;
  }
  
  /**
   * Check container structure and add warnings
   * v1.6.3.11 - FIX Code Health: Extracted to reduce _validateMigratedData complexity
   * @private
   */
  _validateContainerStructure(key, value, warnings, context) {
    if (!value || typeof value !== 'object') {
      warnings.push(`Container "${key}" is not an object`);
      return { valid: false, tabCount: 0 };
    }
    
    if (!Array.isArray(value.tabs)) {
      warnings.push(`Container "${key}" missing tabs array`);
      // v1.6.3.11 - FIX Issue #32: Check if this might be a flat-style entry
      if (value.url || value.id) {
        context.hasFlatStyle = true;
      }
      return { valid: false, tabCount: 0 };
    }
    
    context.hasContainerStyle = true;
    return { valid: true, tabCount: value.tabs.length };
  }

  /**
   * Validate migrated data structure
   * v1.6.4.16 - FIX Issue #26: Validate migrated data
   * v1.6.3.11 - FIX Issue #32: Detect hybrid format
   * @private
   * @param {Object} containers - Migrated container data
   * @returns {{ isValid: boolean, warnings: string[], totalTabs: number, isHybridFormat: boolean }}
   */
  _validateMigratedData(containers) {
    const warnings = [];
    let totalTabs = 0;
    const context = { hasContainerStyle: false, hasFlatStyle: false };
    
    if (!containers || typeof containers !== 'object') {
      warnings.push('Containers is not an object');
      return { isValid: false, warnings, totalTabs: 0, isHybridFormat: false };
    }
    
    for (const [key, value] of Object.entries(containers)) {
      const result = this._validateContainerStructure(key, value, warnings, context);
      if (!result.valid) continue;
      
      totalTabs += result.tabCount;
      
      // Check each tab has required fields
      this._validateTabFields(key, value.tabs, warnings);
    }
    
    // v1.6.3.11 - FIX Issue #32: Log hybrid format detection
    const isHybridFormat = context.hasContainerStyle && context.hasFlatStyle;
    if (isHybridFormat) {
      console.warn('[MIGRATION] HYBRID_FORMAT_DETECTED: Data contains mixed container and flat structures', {
        containerKeys: Object.keys(containers).slice(0, 10),
        recommendation: 'Migration may be partial - review data structure'
      });
    }
    
    return { isValid: warnings.length === 0, warnings, totalTabs, isHybridFormat };
  }
  
  /**
   * Validate tab fields in a container
   * v1.6.3.11 - FIX Code Health: Extracted to reduce _validateMigratedData complexity
   * @private
   */
  _validateTabFields(containerKey, tabs, warnings) {
    tabs.forEach((tab, index) => {
      if (!tab.id) warnings.push(`Container "${containerKey}" tab[${index}] missing id`);
      if (!tab.url) warnings.push(`Container "${containerKey}" tab[${index}] missing url`);
    });
  }

  /**
   * Check if data needs migration
   * v1.6.4.16 - FIX Issue #26: Enhanced logging
   *
   * @param {Object} data - Raw storage data
   * @returns {boolean} True if data is not in current format
   */
  needsMigration(data) {
    const format = this.detect(data);
    const needsMigration = !(format instanceof V1_5_8_15_Format);
    
    console.log('[MIGRATION] Migration check:', {
      currentFormat: format.getVersion(),
      needsMigration
    });
    
    return needsMigration;
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
