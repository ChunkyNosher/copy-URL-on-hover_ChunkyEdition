/**
 * VirtualScrollList - Virtual Scrolling Component for Large Tab Lists
 *
 * Phase 3C Optimization #7: Virtual Scrolling for Large Tab Lists
 *
 * Problem: Rendering 100+ Quick Tab UI elements as DOM nodes causes
 * layout thrashing and jank.
 *
 * Solution: Render only visible tabs in viewport; create/destroy
 * elements as user scrolls.
 *
 * Expected Impact:
 * - 60+ FPS scrolling with 100+ tabs (vs 15-30 FPS without virtualization)
 * - Constant DOM node count regardless of tab count
 * - O(1) rendering time instead of O(n)
 *
 * @version 1.6.4
 * @author Phase 3C UI Performance Optimization
 */

/**
 * Default configuration for virtual scrolling
 * @constant {Object}
 */
const DEFAULT_CONFIG = {
  /** Height of each item in pixels */
  itemHeight: 40,
  /** Number of items to render above viewport */
  bufferAbove: 5,
  /** Number of items to render below viewport */
  bufferBelow: 5,
  /** Scroll event debounce delay in ms */
  scrollDebounceMs: 16, // ~60fps
  /** CSS class for the container */
  containerClass: 'virtual-scroll-container',
  /** CSS class for the viewport */
  viewportClass: 'virtual-scroll-viewport',
  /** CSS class for the content wrapper */
  contentClass: 'virtual-scroll-content',
  /** CSS class for rendered items */
  itemClass: 'virtual-scroll-item'
};

/**
 * VirtualScrollList provides efficient rendering for large lists
 * by only creating DOM elements for visible items plus a small buffer.
 *
 * @example
 * const virtualList = new VirtualScrollList({
 *   container: document.getElementById('tab-list'),
 *   itemHeight: 40,
 *   renderItem: (data, index) => createTabElement(data),
 *   bufferAbove: 5,
 *   bufferBelow: 5
 * });
 *
 * // Update data
 * virtualList.setData(quickTabs);
 *
 * // Cleanup when done
 * virtualList.destroy();
 */
class VirtualScrollList {
  /**
   * Create a new VirtualScrollList instance
   *
   * @param {Object} options - Configuration options
   * @param {HTMLElement} options.container - Container element to render into
   * @param {Function} options.renderItem - Function to render each item: (data, index) => HTMLElement
   * @param {number} [options.itemHeight=40] - Fixed height of each item in pixels
   * @param {number} [options.bufferAbove=5] - Number of items to render above viewport
   * @param {number} [options.bufferBelow=5] - Number of items to render below viewport
   * @param {number} [options.scrollDebounceMs=16] - Scroll debounce delay
   * @param {Function} [options.onItemClick] - Optional click handler for items
   * @param {Function} [options.onVisibleRangeChange] - Optional callback when visible range changes
   */
  constructor(options) {
    this._validateOptions(options);

    // Merge with defaults
    this._config = { ...DEFAULT_CONFIG, ...options };

    // Core state
    this._container = options.container;
    this._renderItem = options.renderItem;
    this._data = [];
    this._renderedItems = new Map(); // index -> { element, data }
    this._visibleRange = { start: 0, end: 0 };
    this._isDestroyed = false;

    // Scroll handling
    this._scrollTop = 0;
    this._scrollDebounceTimer = null;
    this._boundScrollHandler = this._onScroll.bind(this);
    this._boundResizeHandler = this._onResize.bind(this);

    // Callbacks
    this._onItemClick = options.onItemClick || null;
    this._onVisibleRangeChange = options.onVisibleRangeChange || null;

    // Initialize DOM structure
    this._initializeDOM();
  }

  /**
   * Validate constructor options
   * @private
   * @param {Object} options - Options to validate
   * @throws {Error} If required options are missing
   */
  _validateOptions(options) {
    if (!options.container || !(options.container instanceof HTMLElement)) {
      throw new Error('VirtualScrollList: container must be a valid HTMLElement');
    }
    if (typeof options.renderItem !== 'function') {
      throw new Error('VirtualScrollList: renderItem must be a function');
    }
  }

  /**
   * Initialize the DOM structure for virtual scrolling
   * @private
   */
  _initializeDOM() {
    // Create viewport (scrollable area with fixed height)
    this._viewport = document.createElement('div');
    this._viewport.className = this._config.viewportClass;
    this._viewport.style.cssText = `
      overflow-y: auto;
      overflow-x: hidden;
      height: 100%;
      position: relative;
    `;

    // Create content wrapper (full height to enable scrolling)
    this._content = document.createElement('div');
    this._content.className = this._config.contentClass;
    this._content.style.cssText = `
      position: relative;
      width: 100%;
    `;

    // Assemble DOM
    this._viewport.appendChild(this._content);
    this._container.appendChild(this._viewport);
    this._container.classList.add(this._config.containerClass);

    // Attach event listeners
    this._viewport.addEventListener('scroll', this._boundScrollHandler, { passive: true });
    window.addEventListener('resize', this._boundResizeHandler, { passive: true });
  }

  /**
   * Set the data array and trigger re-render
   *
   * @param {Array} data - Array of items to render
   */
  setData(data) {
    if (this._isDestroyed) {
      console.warn('VirtualScrollList: Cannot setData on destroyed instance');
      return;
    }

    this._data = Array.isArray(data) ? data : [];

    // Update content height for scrollbar
    this._updateContentHeight();

    // Re-render visible items
    this._render();
  }

  /**
   * Get the current data array
   * @returns {Array} Current data
   */
  getData() {
    return this._data;
  }

  /**
   * Get the current visible range
   * @returns {{ start: number, end: number }} Visible item indices
   */
  getVisibleRange() {
    return { ...this._visibleRange };
  }

  /**
   * Get the number of currently rendered DOM elements
   * @returns {number} Number of rendered items
   */
  getRenderedCount() {
    return this._renderedItems.size;
  }

  /**
   * Scroll to a specific item index
   *
   * @param {number} index - Index of item to scroll to
   * @param {string} [align='start'] - Alignment: 'start', 'center', or 'end'
   */
  scrollToIndex(index, align = 'start') {
    if (this._isDestroyed || index < 0 || index >= this._data.length) {
      return;
    }

    const viewportHeight = this._viewport.clientHeight;
    const itemTop = index * this._config.itemHeight;

    let scrollTop;
    switch (align) {
      case 'center':
        scrollTop = itemTop - viewportHeight / 2 + this._config.itemHeight / 2;
        break;
      case 'end':
        scrollTop = itemTop - viewportHeight + this._config.itemHeight;
        break;
      case 'start':
      default:
        scrollTop = itemTop;
    }

    this._viewport.scrollTop = Math.max(0, scrollTop);
  }

  /**
   * Force a re-render of visible items
   * Useful after item data changes
   */
  refresh() {
    if (this._isDestroyed) return;

    // Clear all rendered items
    this._clearRenderedItems();

    // Update height and re-render
    this._updateContentHeight();
    this._render();
  }

  /**
   * Update configuration options
   *
   * @param {Object} newConfig - New configuration values
   */
  updateConfig(newConfig) {
    if (this._isDestroyed) return;

    Object.assign(this._config, newConfig);

    // If item height changed, need full refresh
    if (newConfig.itemHeight !== undefined) {
      this.refresh();
    }
  }

  /**
   * Clean up and destroy the instance
   * Must be called to prevent memory leaks
   */
  destroy() {
    if (this._isDestroyed) return;

    this._isDestroyed = true;

    // Clear debounce timer
    if (this._scrollDebounceTimer) {
      cancelAnimationFrame(this._scrollDebounceTimer);
      this._scrollDebounceTimer = null;
    }

    // Remove event listeners
    this._viewport.removeEventListener('scroll', this._boundScrollHandler);
    window.removeEventListener('resize', this._boundResizeHandler);

    // Clear rendered items
    this._clearRenderedItems();

    // Remove DOM elements
    if (this._container.contains(this._viewport)) {
      this._container.removeChild(this._viewport);
    }
    this._container.classList.remove(this._config.containerClass);

    // Clear references
    this._data = [];
    this._renderedItems = null;
    this._container = null;
    this._viewport = null;
    this._content = null;
  }

  /**
   * Check if instance is destroyed
   * @returns {boolean} True if destroyed
   */
  isDestroyed() {
    return this._isDestroyed;
  }

  // ==================== PRIVATE METHODS ====================

  /**
   * Handle scroll events with debouncing
   * @private
   */
  _onScroll() {
    if (this._isDestroyed) return;

    // Use requestAnimationFrame for smooth 60fps scrolling
    // RAF naturally limits to once per frame (~16ms), which is optimal for virtual scrolling
    // Cancelling the previous RAF ensures only the latest scroll position is rendered
    // This is the industry-standard approach used by react-virtualized, react-window, etc.
    if (this._scrollDebounceTimer) {
      cancelAnimationFrame(this._scrollDebounceTimer);
    }

    this._scrollDebounceTimer = requestAnimationFrame(() => {
      this._scrollTop = this._viewport.scrollTop;
      this._render();
    });
  }

  /**
   * Handle window resize
   * @private
   */
  _onResize() {
    if (this._isDestroyed) return;

    // Re-render on resize as viewport height may have changed
    this._render();
  }

  /**
   * Update the content wrapper height based on data length
   * @private
   */
  _updateContentHeight() {
    const totalHeight = this._data.length * this._config.itemHeight;
    this._content.style.height = `${totalHeight}px`;
  }

  /**
   * Calculate the visible range of items
   * @private
   * @returns {{ start: number, end: number }} Visible range with buffer
   */
  _calculateVisibleRange() {
    const viewportHeight = this._viewport.clientHeight;
    const { itemHeight, bufferAbove, bufferBelow } = this._config;

    // Calculate visible items without buffer
    const firstVisible = Math.floor(this._scrollTop / itemHeight);
    const visibleCount = Math.ceil(viewportHeight / itemHeight);

    // Apply buffer
    const start = Math.max(0, firstVisible - bufferAbove);
    const end = Math.min(this._data.length, firstVisible + visibleCount + bufferBelow);

    return { start, end };
  }

  /**
   * Main render method - updates DOM to show visible items
   * @private
   */
  _render() {
    if (this._isDestroyed || !this._data.length) {
      this._clearRenderedItems();
      return;
    }

    const newRange = this._calculateVisibleRange();
    const oldRange = this._visibleRange;

    // Check if range actually changed
    if (newRange.start === oldRange.start && newRange.end === oldRange.end) {
      return; // No change needed
    }

    // Remove items that are no longer visible
    this._removeOutOfRangeItems(newRange);

    // Add new items that became visible
    this._addNewVisibleItems(newRange);

    // Update visible range
    this._visibleRange = newRange;

    // Notify callback if provided
    if (this._onVisibleRangeChange) {
      this._onVisibleRangeChange(newRange);
    }
  }

  /**
   * Remove items outside the visible range
   * @private
   * @param {{ start: number, end: number }} newRange - New visible range
   */
  _removeOutOfRangeItems(newRange) {
    const toRemove = [];

    for (const [index, item] of this._renderedItems.entries()) {
      if (index < newRange.start || index >= newRange.end) {
        toRemove.push({ index, element: item.element });
      }
    }

    for (const { index, element } of toRemove) {
      if (element.parentNode) {
        element.parentNode.removeChild(element);
      }
      this._renderedItems.delete(index);
    }
  }

  /**
   * Add items that are now visible
   * @private
   * @param {{ start: number, end: number }} newRange - New visible range
   */
  _addNewVisibleItems(newRange) {
    for (let i = newRange.start; i < newRange.end; i++) {
      if (this._renderedItems.has(i)) {
        continue; // Already rendered
      }

      const data = this._data[i];
      if (!data) continue;

      const element = this._createItem(data, i);
      if (element) {
        this._positionItem(element, i);
        this._content.appendChild(element);
        this._renderedItems.set(i, { element, data });
      }
    }
  }

  /**
   * Create a DOM element for an item
   * @private
   * @param {*} data - Item data
   * @param {number} index - Item index
   * @returns {HTMLElement|null} Created element or null
   */
  _createItem(data, index) {
    try {
      const element = this._renderItem(data, index);

      if (!(element instanceof HTMLElement)) {
        console.warn('VirtualScrollList: renderItem must return an HTMLElement');
        return null;
      }

      // Add base class and click handler
      element.classList.add(this._config.itemClass);
      element.dataset.virtualIndex = index;

      if (this._onItemClick) {
        element.addEventListener('click', e => {
          this._onItemClick(data, index, e);
        });
      }

      return element;
    } catch (err) {
      console.error('VirtualScrollList: Error in renderItem:', err);
      return null;
    }
  }

  /**
   * Position an item at its correct offset
   * @private
   * @param {HTMLElement} element - Element to position
   * @param {number} index - Item index
   */
  _positionItem(element, index) {
    const top = index * this._config.itemHeight;
    element.style.cssText = `
      position: absolute;
      top: ${top}px;
      left: 0;
      right: 0;
      height: ${this._config.itemHeight}px;
      box-sizing: border-box;
    `;
  }

  /**
   * Clear all rendered items from DOM
   * @private
   */
  _clearRenderedItems() {
    if (!this._renderedItems) return;

    for (const { element } of this._renderedItems.values()) {
      if (element.parentNode) {
        element.parentNode.removeChild(element);
      }
    }
    this._renderedItems.clear();
    this._visibleRange = { start: 0, end: 0 };
  }
}

export default VirtualScrollList;
export { VirtualScrollList, DEFAULT_CONFIG };
