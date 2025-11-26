/**
 * QuickTab Domain Entity
 * v1.6.0 - Pure business logic, no browser APIs or UI dependencies
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
    lastModified = Date.now()
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

    // Visibility state (v1.5.9.13 - Solo/Mute feature)
    this.visibility = {
      minimized: visibility?.minimized || false,
      soloedOnTabs: visibility?.soloedOnTabs || [],
      mutedOnTabs: visibility?.mutedOnTabs || []
    };
  }

  /**
   * Determine if this Quick Tab should be visible on a specific tab
   * v1.5.9.13 - Implements Solo/Mute visibility logic
   *
   * Business Rules:
   * 1. If minimized, never visible
   * 2. If soloedOnTabs has entries, only visible on those tabs
   * 3. If mutedOnTabs has entries, NOT visible on those tabs
   * 4. Solo takes precedence over mute
   *
   * @param {number} tabId - Browser tab ID to check visibility for
   * @returns {boolean} - True if Quick Tab should be visible on this tab
   */
  shouldBeVisible(tabId) {
    // Rule 1: Minimized tabs are never visible
    if (this.visibility.minimized) {
      return false;
    }

    // Rule 2: Solo mode - only visible on specific tabs
    if (this.visibility.soloedOnTabs.length > 0) {
      return this.visibility.soloedOnTabs.includes(tabId);
    }

    // Rule 3: Mute mode - NOT visible on specific tabs
    if (this.visibility.mutedOnTabs.length > 0) {
      return !this.visibility.mutedOnTabs.includes(tabId);
    }

    // Default: visible everywhere
    return true;
  }

  /**
   * Toggle solo mode for a specific tab
   * v1.5.9.13 - Solo: Show ONLY on this tab
   *
   * @param {number} tabId - Tab ID to solo on
   * @returns {boolean} - True if tab was added to solo list, false if removed
   */
  toggleSolo(tabId) {
    const index = this.visibility.soloedOnTabs.indexOf(tabId);

    if (index === -1) {
      // Add to solo list
      this.visibility.soloedOnTabs.push(tabId);
      // Clear mute list (mutual exclusivity)
      this.visibility.mutedOnTabs = [];
      return true;
    } else {
      // Remove from solo list
      this.visibility.soloedOnTabs.splice(index, 1);
      return false;
    }
  }

  /**
   * Add tab to solo list (make visible ONLY on this tab)
   * v1.5.9.13
   *
   * @param {number} tabId - Tab ID to solo on
   */
  solo(tabId) {
    if (!this.visibility.soloedOnTabs.includes(tabId)) {
      this.visibility.soloedOnTabs.push(tabId);
    }
    // Clear mute list (mutual exclusivity)
    this.visibility.mutedOnTabs = [];
  }

  /**
   * Remove tab from solo list
   * v1.5.9.13
   *
   * @param {number} tabId - Tab ID to remove from solo list
   */
  unsolo(tabId) {
    this.visibility.soloedOnTabs = this.visibility.soloedOnTabs.filter(id => id !== tabId);
  }

  /**
   * Clear all solo tabs
   * v1.5.9.13
   */
  clearSolo() {
    this.visibility.soloedOnTabs = [];
  }

  /**
   * Toggle mute mode for a specific tab
   * v1.5.9.13 - Mute: Hide ONLY on this tab
   *
   * @param {number} tabId - Tab ID to mute on
   * @returns {boolean} - True if tab was added to mute list, false if removed
   */
  toggleMute(tabId) {
    const index = this.visibility.mutedOnTabs.indexOf(tabId);

    if (index === -1) {
      // Add to mute list
      this.visibility.mutedOnTabs.push(tabId);
      // Clear solo list (mutual exclusivity)
      this.visibility.soloedOnTabs = [];
      return true;
    } else {
      // Remove from mute list
      this.visibility.mutedOnTabs.splice(index, 1);
      return false;
    }
  }

  /**
   * Add tab to mute list (hide ONLY on this tab)
   * v1.5.9.13
   *
   * @param {number} tabId - Tab ID to mute on
   */
  mute(tabId) {
    if (!this.visibility.mutedOnTabs.includes(tabId)) {
      this.visibility.mutedOnTabs.push(tabId);
    }
    // Clear solo list (mutual exclusivity)
    this.visibility.soloedOnTabs = [];
  }

  /**
   * Remove tab from mute list
   * v1.5.9.13
   *
   * @param {number} tabId - Tab ID to remove from mute list
   */
  unmute(tabId) {
    this.visibility.mutedOnTabs = this.visibility.mutedOnTabs.filter(id => id !== tabId);
  }

  /**
   * Clear all muted tabs
   * v1.5.9.13
   */
  clearMute() {
    this.visibility.mutedOnTabs = [];
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

  /**
   * Clean up dead tab IDs from solo/mute arrays
   * Should be called when tabs are closed
   *
   * @param {number[]} activeTabIds - Array of currently active tab IDs
   */
  cleanupDeadTabs(activeTabIds) {
    const activeSet = new Set(activeTabIds);

    this.visibility.soloedOnTabs = this.visibility.soloedOnTabs.filter(id => activeSet.has(id));

    this.visibility.mutedOnTabs = this.visibility.mutedOnTabs.filter(id => activeSet.has(id));
  }

  // v1.6.2.2 - REMOVED: belongsToContainer() method
  // Container isolation removed for global visibility (Issue #35, #51, #47)

  /**
   * Serialize to storage format
   * Converts domain entity to plain object for storage
   * v1.6.1.5 - Include lastModified timestamp
   * v1.6.2.2 - Removed container field for global visibility
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
        minimized: this.visibility.minimized,
        soloedOnTabs: [...this.visibility.soloedOnTabs],
        mutedOnTabs: [...this.visibility.mutedOnTabs]
      },
      zIndex: this.zIndex,
      createdAt: this.createdAt,
      lastModified: this.lastModified // v1.6.1.5
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
   * 
   * @private
   * @param {Object} data - Raw storage data
   * @returns {Object} - Normalized parameters
   */
  static _normalizeStorageData(data) {
    const now = Date.now();
    const defaults = {
      title: 'Quick Tab',
      position: { left: 100, top: 100 },
      size: { width: 800, height: 600 },
      visibility: { minimized: false, soloedOnTabs: [], mutedOnTabs: [] },
      zIndex: 1000
    };

    return {
      id: data.id,
      url: data.url,
      title: data.title ?? defaults.title,
      position: data.position ?? defaults.position,
      size: data.size ?? defaults.size,
      visibility: data.visibility ?? defaults.visibility,
      zIndex: data.zIndex ?? defaults.zIndex,
      createdAt: data.createdAt ?? now,
      lastModified: data.lastModified ?? data.createdAt ?? now
    };
  }

  /**
   * Create QuickTab with defaults
   * Convenience factory method for creating new Quick Tabs
   * v1.6.2.2 - Removed container parameter for global visibility
   *
   * @param {Object} params - Partial parameters
   * @returns {QuickTab} - QuickTab domain entity with defaults
   */
  static create({ id, url, left = 100, top = 100, width = 800, height = 600, title }) {
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
        minimized: false,
        soloedOnTabs: [],
        mutedOnTabs: []
      },
      zIndex: 1000,
      createdAt: Date.now()
    });
  }
}
