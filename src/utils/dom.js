/**
 * DOM Utilities
 * Helper functions for DOM manipulation
 */

/**
 * Create an element with attributes
 * @param {string} tag - HTML tag name
 * @param {object} attributes - Element attributes
 * @param {string|Element|Element[]} children - Child content
 * @returns {Element} Created element
 */
export function createElement(tag, attributes = {}, children = null) {
  const element = document.createElement(tag);

  // Set attributes
  Object.entries(attributes).forEach(([key, value]) => {
    if (key === 'className') {
      element.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(element.style, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      const eventName = key.substring(2).toLowerCase();
      element.addEventListener(eventName, value);
    } else {
      element.setAttribute(key, value);
    }
  });

  // Add children
  if (children) {
    if (typeof children === 'string') {
      element.textContent = children;
    } else if (Array.isArray(children)) {
      children.forEach(child => {
        if (child instanceof Element) {
          element.appendChild(child);
        } else if (typeof child === 'string') {
          element.appendChild(document.createTextNode(child));
        }
      });
    } else if (children instanceof Element) {
      element.appendChild(children);
    }
  }

  return element;
}

/**
 * Find closest ancestor matching selector
 * @param {Element} element - Starting element
 * @param {string} selector - CSS selector
 * @returns {Element|null} Matching ancestor or null
 */
export function findClosest(element, selector) {
  return element ? element.closest(selector) : null;
}

/**
 * Remove an element from the DOM
 * @param {Element|string} elementOrSelector - Element or CSS selector
 */
export function removeElement(elementOrSelector) {
  const element =
    typeof elementOrSelector === 'string'
      ? document.querySelector(elementOrSelector)
      : elementOrSelector;

  if (element && element.parentNode) {
    element.parentNode.removeChild(element);
  }
}

/**
 * Check if element is visible
 * @param {Element} element - Element to check
 * @returns {boolean} True if visible
 */
export function isVisible(element) {
  if (!element) return false;

  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

/**
 * Get element position relative to viewport
 * @param {Element} element - Element
 * @returns {object} Position object with x, y, width, height
 */
export function getElementPosition(element) {
  if (!element) return { x: 0, y: 0, width: 0, height: 0 };

  const rect = element.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height
  };
}

/**
 * Set element position
 * @param {Element} element - Element
 * @param {number} x - X position
 * @param {number} y - Y position
 */
export function setElementPosition(element, x, y) {
  if (!element) return;

  element.style.left = `${x}px`;
  element.style.top = `${y}px`;
}

/**
 * Set element size
 * @param {Element} element - Element
 * @param {number} width - Width
 * @param {number} height - Height
 */
export function setElementSize(element, width, height) {
  if (!element) return;

  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
}

/**
 * Add CSS class to element
 * @param {Element} element - Element
 * @param {string} className - CSS class name
 */
export function addClass(element, className) {
  if (element) {
    element.classList.add(className);
  }
}

/**
 * Remove CSS class from element
 * @param {Element} element - Element
 * @param {string} className - CSS class name
 */
export function removeClass(element, className) {
  if (element) {
    element.classList.remove(className);
  }
}

/**
 * Toggle CSS class on element
 * @param {Element} element - Element
 * @param {string} className - CSS class name
 * @returns {boolean} True if class is now present
 */
export function toggleClass(element, className) {
  if (element) {
    return element.classList.toggle(className);
  }
  return false;
}

/**
 * Check if element has CSS class
 * @param {Element} element - Element
 * @param {string} className - CSS class name
 * @returns {boolean} True if element has class
 */
export function hasClass(element, className) {
  return element ? element.classList.contains(className) : false;
}

/**
 * Remove all Quick Tab window elements from DOM that are not in the valid set
 * v1.6.3.4-v5 - FIX Bug #3 & #7: Shared utility for comprehensive DOM cleanup
 * @param {Set<string>|null} validTabIds - Set of valid Quick Tab IDs to keep, or null to remove all
 * @returns {number} Number of elements removed
 */
export function cleanupOrphanedQuickTabElements(validTabIds = null) {
  const allQuickTabElements = document.querySelectorAll('.quick-tab-window');
  let removedCount = 0;

  for (const element of allQuickTabElements) {
    const shouldRemove = _shouldRemoveElement(element, validTabIds);
    if (shouldRemove) {
      element.remove();
      removedCount++;
    }
  }

  return removedCount;
}

/**
 * Helper to determine if a Quick Tab element should be removed
 * v1.6.3.4-v5 - Extracted to reduce nesting depth
 * @private
 * @param {Element} element - DOM element to check
 * @param {Set<string>|null} validTabIds - Set of valid Quick Tab IDs, or null to remove all
 * @returns {boolean} True if element should be removed
 */
function _shouldRemoveElement(element, validTabIds) {
  // If validTabIds is null, remove all elements
  if (validTabIds === null) {
    return true;
  }

  const elementId = element.id;

  // Extract Quick Tab ID from element ID (format: quick-tab-{id})
  if (elementId && elementId.startsWith('quick-tab-')) {
    const quickTabId = elementId.substring('quick-tab-'.length);
    // If this ID is not in the valid set, it's orphaned
    return !validTabIds.has(quickTabId);
  }

  // Element has no ID or invalid format - don't remove
  return false;
}

/**
 * Remove a specific Quick Tab element by ID
 * v1.6.3.4-v5 - FIX Bug #7: Utility for single element cleanup
 * @param {string} quickTabId - Quick Tab ID
 * @returns {boolean} True if element was found and removed
 */
export function removeQuickTabElement(quickTabId) {
  const elementId = `quick-tab-${quickTabId}`;
  const element = document.getElementById(elementId);
  if (element) {
    element.remove();
    return true;
  }
  return false;
}
