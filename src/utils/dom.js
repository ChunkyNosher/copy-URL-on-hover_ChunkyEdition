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
    if (key === "className") {
      element.className = value;
    } else if (key === "style" && typeof value === "object") {
      Object.assign(element.style, value);
    } else if (key.startsWith("on") && typeof value === "function") {
      const eventName = key.substring(2).toLowerCase();
      element.addEventListener(eventName, value);
    } else {
      element.setAttribute(key, value);
    }
  });

  // Add children
  if (children) {
    if (typeof children === "string") {
      element.textContent = children;
    } else if (Array.isArray(children)) {
      children.forEach((child) => {
        if (child instanceof Element) {
          element.appendChild(child);
        } else if (typeof child === "string") {
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
    typeof elementOrSelector === "string"
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
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.opacity !== "0"
  );
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
    height: rect.height,
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
