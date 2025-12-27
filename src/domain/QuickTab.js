/**
 * QuickTab Domain Entity
 * v1.6.0 - Pure business logic, no browser APIs or UI dependencies
 * v1.6.3 - Added slot property for global ID persistence
 * v1.6.3.12 - Removed Solo/Mute visibility control (always visible on all tabs)
 *
 * Represents a Quick Tab with its state and behavior.
 * Extracted from QuickTabsManager to separate domain logic from infrastructure.
 */

/**
 * Validate string parameter
 * @private
 */
function _validateString(value, name) {
  if (!value || typeof value !== 'string') {
    throw new Error(`QuickTab requires a valid string ${name}`);
  }
}

/**
 * Validate position object
 * @private
 */
function _validatePosition(position) {
  if (!position || typeof position.left !== 'number' || typeof position.top !== 'number') {
    throw new Error('QuickTab requires valid position {left, top}');
  }
}

/**
 * Validate size object
 * @private
 */
function _validateSize(size) {
  if (!size || typeof size.width !== 'number' || typeof size.height !== 'number') {
    throw new Error('QuickTab requires valid size {width, height}');
  }
}

/**
 * Validate QuickTab constructor parameters
 * @private
 */
function _validateParams({ id, url, position, size }) {
  _validateString(id, 'id');
  _validateString(url, 'url');
  _validatePosition(position);
  _validateSize(size);
}

export class QuickTab {
  /**
   * Create a new QuickTab instance
   * v1.6.2.2 - ISSUE #35/#51 FIX: Removed container parameter for global visibility
   * v1.6.3 - Added slot property for global ID persistence
   *
   * @param {Object} params - QuickTab parameters
   * @param {string} params.id - Unique identifier
   * @param {string} params.url - URL of the Quick Tab
   * @param {Object} params.position - {left, top} position
   * @param {Object} params.size - {width, height} size
   * @param {Object} params.visibility - Visibility state
   * @param {number} [params.createdAt] - Creation timestamp
   * @param {string} [params.title] - Tab title
   * @param {number} [params.zIndex] - Z-index for stacking
   * @param {number} [params.lastModified] - Last modification timestamp (v1.6.1.5)
   * @param {number} [params.slot] - Global slot number for consistent labeling (v1.6.3)
   */
  constructor({
    id,
    url,
    position,
    size,
    visibility,
    createdAt = Date.now(),
    title = 'Quick Tab',
    zIndex = 1000,
    lastModified = Date.now(),
    slot = null
  }) {
    // Validation
    _validateParams({ id, url, position, size });

    // Immutable core properties
    this.id = id;
    this.url = url;
    this.createdAt = createdAt;

    // Mutable properties
    this.title = title;
    this.position = { ...position }; // Clone to prevent external mutation
    this.size = { ...size };
    this.zIndex = zIndex;

    // v1.6.1.5 - Track last modification time for conflict resolution
    this.lastModified = lastModified;

    // v1.6.3 - Global slot number for consistent labeling across all tabs
    // Slot is a positive integer (1, 2, 3, ...) that uniquely identifies this Quick Tab
    // "Quick Tab 1" always refers to the Quick Tab with slot=1
    this.slot = slot;

    // Visibility state (v1.6.3.12 - Solo/Mute removed, only minimized state remains)
    this.visibility = {
      minimized: visibility?.minimized || false
    };
  }

  /**
   * Determine if this Quick Tab should be visible on a specific tab
   * v1.6.3.12 - Simplified: Only checks minimized state (Solo/Mute removed)
   *
   * Business Rules:
   * 1. If minimized, never visible
   * 2. Otherwise, visible on all tabs
   *
   * @param {number} _tabId - Browser tab ID (unused after Solo/Mute removal)
   * @returns {boolean} - True if Quick Tab should be visible
   */
  shouldBeVisible(_tabId) {
    // Rule 1: Minimized tabs are never visible
    if (this.visibility.minimized) {
      return false;
    }

    // Default: visible everywhere (Solo/Mute removed in v1.6.3.12)
    return true;
  }

  /**
   * Toggle minimized state
   * v1.6.1.5 - Track lastModified timestamp
   *
   * @returns {boolean} - New minimized state
   */
  toggleMinimized() {
    this.visibility.minimized = !this.visibility.minimized;
    this.lastModified = Date.now(); // v1.6.1.5
    return this.visibility.minimized;
  }

  /**
   * Set minimized state
   * v1.6.1.5 - Track lastModified timestamp
   *
   * @param {boolean} minimized - New minimized state
   */
  setMinimized(minimized) {
    this.visibility.minimized = minimized;
    this.lastModified = Date.now(); // v1.6.1.5
  }

  /**
   * Update position
   * v1.6.1.5 - Track lastModified timestamp
   *
   * @param {number} left - New left position
   * @param {number} top - New top position
   */
  updatePosition(left, top) {
    if (typeof left !== 'number' || typeof top !== 'number') {
      throw new Error('Position must be numeric {left, top}');
    }
    this.position = { left, top };
    this.lastModified = Date.now(); // v1.6.1.5
  }

  /**
   * Update size
   * v1.6.1.5 - Track lastModified timestamp
   *
   * @param {number} width - New width
   * @param {number} height - New height
   */
  updateSize(width, height) {
    if (typeof width !== 'number' || typeof height !== 'number') {
      throw new Error('Size must be numeric {width, height}');
    }
    if (width <= 0 || height <= 0) {
      throw new Error('Size must be positive');
    }
    this.size = { width, height };
    this.lastModified = Date.now(); // v1.6.1.5
  }

  /**
   * Update z-index for stacking order
   * v1.6.1.5 - Track lastModified timestamp
   *
   * @param {number} zIndex - New z-index
   */
  updateZIndex(zIndex) {
    if (typeof zIndex !== 'number') {
      throw new Error('zIndex must be a number');
    }
    this.zIndex = zIndex;
    this.lastModified = Date.now(); // v1.6.1.5
  }

  /**
   * Update title
   * v1.6.1.5 - Track lastModified timestamp
   *
   * @param {string} title - New title
   */
  updateTitle(title) {
    if (typeof title !== 'string') {
      throw new Error('Title must be a string');
    }
    this.title = title;
    this.lastModified = Date.now(); // v1.6.1.5
  }

  // v1.6.2.2 - REMOVED: belongsToContainer() method
  // Container isolation removed for global visibility (Issue #35, #51, #47)

  /**
   * Serialize to storage format
   * Converts domain entity to plain object for storage
   * v1.6.1.5 - Include lastModified timestamp
   * v1.6.2.2 - Removed container field for global visibility
   * v1.6.3 - Include slot for global ID persistence
   * v1.6.3.12 - Removed soloedOnTabs/mutedOnTabs (Solo/Mute removed)
   *
   * @returns {Object} - Plain object suitable for storage
   */
  serialize() {
    return {
      id: this.id,
      url: this.url,
      title: this.title,
      position: { ...this.position },
      size: { ...this.size },
      visibility: {
        minimized: this.visibility.minimized
      },
      zIndex: this.zIndex,
      createdAt: this.createdAt,
      lastModified: this.lastModified, // v1.6.1.5
      slot: this.slot // v1.6.3 - Global slot number
    };
  }

  /**
   * Create QuickTab from storage format
   * Static factory method to hydrate from plain object
   * v1.6.1.5 - Include lastModified timestamp
   *
   * @param {Object} data - Plain object from storage
   * @returns {QuickTab} - QuickTab domain entity
   */
  static fromStorage(data) {
    const params = QuickTab._normalizeStorageData(data);
    return new QuickTab(params);
  }

  /**
   * Normalize storage data with defaults
   * v1.6.1.5 - Extract to reduce complexity
   * v1.6.2.2 - Removed container field for global visibility
   * v1.6.3 - Include slot for global ID persistence
   * v1.6.3.12 - Removed soloedOnTabs/mutedOnTabs (Solo/Mute removed)
   *
   * @private
   * @param {Object} data - Raw storage data
   * @returns {Object} - Normalized parameters
   */
  static _normalizeStorageData(data) {
    const now = Date.now();

    // Extract timestamp values with fallbacks
    const createdAt = data.createdAt ?? now;
    const lastModified = data.lastModified ?? createdAt;

    return {
      id: data.id,
      url: data.url,
      title: data.title ?? 'Quick Tab',
      position: data.position ?? { left: 100, top: 100 },
      size: data.size ?? { width: 800, height: 600 },
      visibility: data.visibility ?? { minimized: false },
      zIndex: data.zIndex ?? 1000,
      createdAt,
      lastModified,
      slot: data.slot ?? null
    };
  }

  /**
   * Create QuickTab with defaults
   * Convenience factory method for creating new Quick Tabs
   * v1.6.2.2 - Removed container parameter for global visibility
   * v1.6.3 - Added slot parameter for global ID persistence
   * v1.6.3.12 - Removed soloedOnTabs/mutedOnTabs (Solo/Mute removed)
   *
   * @param {Object} params - Partial parameters
   * @param {number} [params.slot] - Global slot number (should be assigned by StateManager)
   * @returns {QuickTab} - QuickTab domain entity with defaults
   */
  static create({ id, url, left = 100, top = 100, width = 800, height = 600, title, slot = null }) {
    if (!id) {
      throw new Error('QuickTab.create requires id');
    }
    if (!url) {
      throw new Error('QuickTab.create requires url');
    }

    return new QuickTab({
      id,
      url,
      title: title || 'Quick Tab',
      position: { left, top },
      size: { width, height },
      visibility: {
        minimized: false
      },
      zIndex: 1000,
      createdAt: Date.now(),
      slot
    });
  }
}
