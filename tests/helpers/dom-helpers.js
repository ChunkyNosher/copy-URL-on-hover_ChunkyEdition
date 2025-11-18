/**
 * DOM manipulation utilities for tests
 */

/**
 * Create a mock DOM element with attributes
 * @param {string} tagName - HTML tag name
 * @param {Object} attributes - Attributes to set
 * @param {string} textContent - Text content
 */
export function createMockElement(tagName, attributes = {}, textContent = '') {
  const element = document.createElement(tagName);

  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'style' && typeof value === 'object') {
      Object.assign(element.style, value);
    } else {
      element.setAttribute(key, value);
    }
  }

  if (textContent) {
    element.textContent = textContent;
  }

  return element;
}

/**
 * Create a mock shadow root
 */
export function createMockShadowRoot() {
  const host = document.createElement('div');
  const shadowRoot = host.attachShadow({ mode: 'open' });
  return { host, shadowRoot };
}

/**
 * Simulate a mouse event
 * @param {Element} element - Target element
 * @param {string} eventType - Event type (click, mousedown, etc.)
 * @param {Object} options - Event options
 */
export function simulateMouseEvent(element, eventType, options = {}) {
  const event = new MouseEvent(eventType, {
    bubbles: true,
    cancelable: true,
    clientX: options.clientX || 0,
    clientY: options.clientY || 0,
    button: options.button || 0,
    ...options
  });

  element.dispatchEvent(event);
  return event;
}

/**
 * Simulate a keyboard event
 * @param {Element} element - Target element
 * @param {string} eventType - Event type (keydown, keyup, etc.)
 * @param {Object} options - Event options
 */
export function simulateKeyboardEvent(element, eventType, options = {}) {
  const event = new KeyboardEvent(eventType, {
    bubbles: true,
    cancelable: true,
    key: options.key || '',
    code: options.code || '',
    ctrlKey: options.ctrlKey || false,
    altKey: options.altKey || false,
    shiftKey: options.shiftKey || false,
    metaKey: options.metaKey || false,
    ...options
  });

  element.dispatchEvent(event);
  return event;
}

/**
 * Clean up DOM after tests
 */
export function cleanupDOM() {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
}

/**
 * Get element bounds
 */
export function getElementBounds(element) {
  return element.getBoundingClientRect();
}
