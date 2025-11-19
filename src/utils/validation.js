/**
 * ValidationUtils - Shared validation utilities
 * Phase 6: Extracted from handlers and domain entities
 *
 * Responsibilities:
 * - URL validation
 * - Container ID validation
 * - Dimension and position validation
 * - Tab ID validation
 * - Type checking utilities
 *
 * @version 1.6.0
 * @author refactor-specialist
 */

/**
 * Check if value is a valid URL
 * @param {string} url - URL to validate
 * @returns {boolean} - True if valid URL
 */
export function isValidUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }

  try {
    const urlObj = new URL(url);
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Check if value is a valid hex color
 * @param {string} color - Color to validate (e.g., "#FF5733")
 * @returns {boolean} - True if valid hex color
 */
export function isValidHexColor(color) {
  if (!color || typeof color !== 'string') {
    return false;
  }

  // Match #RGB, #RRGGBB, #RRGGBBAA formats
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(color);
}

/**
 * Check if value is a valid Firefox container ID
 * @param {string} id - Container ID to validate
 * @returns {boolean} - True if valid container ID
 */
export function isValidContainerId(id) {
  if (!id || typeof id !== 'string') {
    return false;
  }

  return (
    id === 'firefox-default' ||
    id.startsWith('firefox-container-') ||
    id.startsWith('firefox-private')
  );
}

/**
 * Sanitize container ID to ensure validity
 * @param {string} id - Container ID to sanitize
 * @returns {string} - Sanitized container ID (defaults to 'firefox-default' if invalid)
 */
export function sanitizeContainerId(id) {
  if (isValidContainerId(id)) {
    return id;
  }
  return 'firefox-default';
}

/**
 * Extract container number from container ID
 * @param {string} id - Container ID (e.g., "firefox-container-1")
 * @returns {number|null} - Container number or null if not a numbered container
 */
export function extractContainerNumber(id) {
  if (!id || typeof id !== 'string') {
    return null;
  }

  const match = id.match(/firefox-container-(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Validate dimensions (width and height)
 * @param {number} width - Width value
 * @param {number} height - Height value
 * @param {Object} options - Validation options
 * @param {number} [options.min=0] - Minimum allowed value
 * @param {number} [options.max=Infinity] - Maximum allowed value
 * @returns {boolean} - True if dimensions are valid
 */
export function isValidDimensions(width, height, options = {}) {
  const { min = 0, max = Infinity } = options;

  if (typeof width !== 'number' || typeof height !== 'number') {
    return false;
  }

  if (isNaN(width) || isNaN(height)) {
    return false;
  }

  if (width < min || width > max || height < min || height > max) {
    return false;
  }

  return true;
}

/**
 * Validate position coordinates
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {Object} viewport - Viewport bounds (optional)
 * @param {number} [viewport.width] - Viewport width
 * @param {number} [viewport.height] - Viewport height
 * @returns {boolean} - True if position is valid
 */
export function isValidPosition(x, y, viewport = null) {
  if (typeof x !== 'number' || typeof y !== 'number') {
    return false;
  }

  if (isNaN(x) || isNaN(y)) {
    return false;
  }

  // If viewport provided, check bounds
  if (!viewport) {
    return true;
  }

  const withinWidth = !viewport.width || x <= viewport.width;
  const withinHeight = !viewport.height || y <= viewport.height;

  return withinWidth && withinHeight;
}

/**
 * Validate position object {left, top}
 * @param {Object} position - Position object
 * @param {number} position.left - Left coordinate
 * @param {number} position.top - Top coordinate
 * @returns {boolean} - True if position object is valid
 */
export function isValidPositionObject(position) {
  if (!position || typeof position !== 'object') {
    return false;
  }

  return (
    typeof position.left === 'number' &&
    typeof position.top === 'number' &&
    !isNaN(position.left) &&
    !isNaN(position.top)
  );
}

/**
 * Validate size object {width, height}
 * @param {Object} size - Size object
 * @param {number} size.width - Width value
 * @param {number} size.height - Height value
 * @param {Object} options - Validation options
 * @param {number} [options.min=0] - Minimum allowed value
 * @param {number} [options.max=Infinity] - Maximum allowed value
 * @returns {boolean} - True if size object is valid
 */
export function isValidSizeObject(size, options = {}) {
  if (!size || typeof size !== 'object') {
    return false;
  }

  return isValidDimensions(size.width, size.height, options);
}

/**
 * Validate tab ID
 * @param {number|string} tabId - Tab ID to validate
 * @returns {boolean} - True if valid tab ID
 */
export function isValidTabId(tabId) {
  // Tab IDs can be numbers or numeric strings
  if (typeof tabId === 'number') {
    return tabId >= 0 && !isNaN(tabId);
  }

  if (typeof tabId === 'string') {
    const parsed = parseInt(tabId, 10);
    return !isNaN(parsed) && parsed >= 0;
  }

  return false;
}

/**
 * Validate array of tab IDs
 * @param {Array} arr - Array to validate
 * @returns {boolean} - True if valid array of tab IDs
 */
export function isValidTabIdArray(arr) {
  if (!Array.isArray(arr)) {
    return false;
  }

  // Empty arrays are valid
  if (arr.length === 0) {
    return true;
  }

  // All elements must be valid tab IDs
  return arr.every(isValidTabId);
}

/**
 * Validate string parameter
 * @param {string} value - Value to validate
 * @param {Object} options - Validation options
 * @param {number} [options.minLength=1] - Minimum string length
 * @param {number} [options.maxLength=Infinity] - Maximum string length
 * @param {boolean} [options.allowEmpty=false] - Allow empty strings
 * @returns {boolean} - True if valid string
 */
export function isValidString(value, options = {}) {
  const { minLength = 1, maxLength = Infinity, allowEmpty = false } = options;

  if (typeof value !== 'string') {
    return false;
  }

  // If empty strings are allowed, bypass other checks for empty strings
  if (allowEmpty && value.length === 0) {
    return true;
  }

  if (!allowEmpty && value.length === 0) {
    return false;
  }

  if (value.length < minLength || value.length > maxLength) {
    return false;
  }

  return true;
}

/**
 * Validate numeric value
 * @param {number} value - Value to validate
 * @param {Object} options - Validation options
 * @param {number} [options.min=-Infinity] - Minimum allowed value
 * @param {number} [options.max=Infinity] - Maximum allowed value
 * @param {boolean} [options.integer=false] - Must be integer
 * @returns {boolean} - True if valid number
 */
export function isValidNumber(value, options = {}) {
  const { min = -Infinity, max = Infinity, integer = false } = options;

  if (typeof value !== 'number') {
    return false;
  }

  if (isNaN(value)) {
    return false;
  }

  if (integer && !Number.isInteger(value)) {
    return false;
  }

  if (value < min || value > max) {
    return false;
  }

  return true;
}

/**
 * Validate z-index value
 * @param {number} zIndex - Z-index to validate
 * @returns {boolean} - True if valid z-index
 */
export function isValidZIndex(zIndex) {
  return isValidNumber(zIndex, { min: 0, integer: true });
}

/**
 * Validate Quick Tab ID format
 * @param {string} id - Quick Tab ID to validate
 * @returns {boolean} - True if valid Quick Tab ID format
 */
export function isValidQuickTabId(id) {
  if (!id || typeof id !== 'string') {
    return false;
  }

  // Quick Tab IDs typically start with "qt-" followed by alphanumeric
  // But also accept any non-empty string for flexibility
  return id.length > 0;
}

/**
 * Validate boolean value
 * @param {*} value - Value to validate
 * @returns {boolean} - True if value is boolean
 */
export function isValidBoolean(value) {
  return typeof value === 'boolean';
}

/**
 * Validate object type
 * @param {*} value - Value to validate
 * @param {boolean} [allowNull=false] - Allow null values
 * @returns {boolean} - True if value is object
 */
export function isValidObject(value, allowNull = false) {
  if (value === null) {
    return allowNull;
  }

  return typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate array type
 * @param {*} value - Value to validate
 * @param {Object} options - Validation options
 * @param {number} [options.minLength=0] - Minimum array length
 * @param {number} [options.maxLength=Infinity] - Maximum array length
 * @returns {boolean} - True if valid array
 */
export function isValidArray(value, options = {}) {
  const { minLength = 0, maxLength = Infinity } = options;

  if (!Array.isArray(value)) {
    return false;
  }

  if (value.length < minLength || value.length > maxLength) {
    return false;
  }

  return true;
}
