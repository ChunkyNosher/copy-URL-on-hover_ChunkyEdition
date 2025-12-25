/**
 * BroadcastMessageSchema - Message validation schemas and utilities
 *
 * Responsibilities:
 * - Define expected structure for each message type
 * - Validate message structure and data types
 * - Sanitize and coerce message fields
 * - Provide detailed validation error reporting
 *
 * Related: Gap 3 - Malformed Message Validation
 */

/**
 * Known broadcast message types
 * v1.6.3.11-v12 - Removed SOLO, MUTE, UPDATE_MUTE message types (Solo/Mute feature removed)
 */
export const MESSAGE_TYPES = {
  CREATE: 'CREATE',
  UPDATE_POSITION: 'UPDATE_POSITION',
  UPDATE_SIZE: 'UPDATE_SIZE',
  MINIMIZE: 'MINIMIZE',
  RESTORE: 'RESTORE',
  CLOSE: 'CLOSE',
  DELETE: 'DELETE', // Remove Quick Tab (used in tests)
  CLOSE_ALL: 'CLOSE_ALL', // Close all Quick Tabs
  CLOSE_MINIMIZED: 'CLOSE_MINIMIZED', // Close only minimized Quick Tabs
  UPDATE_MINIMIZE: 'UPDATE_MINIMIZE', // Update minimize state (used in scenario-13)
  DESTROY: 'DESTROY' // Destroy Quick Tab (used in scenario-15)
};

/**
 * Field validators
 */
const validators = {
  /**
   * Validate string field
   */
  string: (value, field) => {
    if (typeof value !== 'string') {
      return { valid: false, error: `${field} must be a string, got ${typeof value}` };
    }
    return { valid: true, value };
  },

  /**
   * Validate number field with optional range
   */
  number: (value, field, { min = -Infinity, max = Infinity } = {}) => {
    const num = Number(value);
    if (isNaN(num)) {
      return { valid: false, error: `${field} must be a number, got ${typeof value}` };
    }
    if (num < min) {
      return { valid: false, error: `${field} must be >= ${min}, got ${num}` };
    }
    if (num > max) {
      return { valid: false, error: `${field} must be <= ${max}, got ${num}` };
    }
    return { valid: true, value: num };
  },

  /**
   * Validate positive number
   */
  positiveNumber: (value, field) => {
    return validators.number(value, field, { min: 0 });
  },

  /**
   * Validate array field
   */
  array: (value, field, { maxLength = 1000 } = {}) => {
    if (!Array.isArray(value)) {
      return { valid: false, error: `${field} must be an array, got ${typeof value}` };
    }
    if (value.length > maxLength) {
      // Truncate oversized arrays
      return {
        valid: true,
        value: value.slice(0, maxLength),
        warning: `${field} truncated to ${maxLength} items`
      };
    }
    return { valid: true, value };
  },

  /**
   * Validate optional field
   */
  optional: (value, field, validator) => {
    if (value === undefined || value === null) {
      return { valid: true, value: undefined };
    }
    return validator(value, field);
  }
};

/**
 * Common optional fields for all message types (Gap 6, Gap 5)
 */
const commonOptionalFields = {
  cookieStoreId: validators.string, // Gap 6: Container boundary validation
  senderId: validators.string, // Gap 5: Loop prevention
  sequence: validators.number // Gap 5: Sequence tracking
};

/**
 * Message schemas defining required and optional fields
 */
export const MESSAGE_SCHEMAS = {
  [MESSAGE_TYPES.CREATE]: {
    required: {
      id: validators.string,
      url: validators.string,
      left: validators.number,
      top: validators.number,
      width: (v, f) => validators.positiveNumber(v, f),
      height: (v, f) => validators.positiveNumber(v, f)
    },
    optional: {
      ...commonOptionalFields,
      isMinimized: v => ({ valid: true, value: Boolean(v) })
    }
  },

  [MESSAGE_TYPES.UPDATE_POSITION]: {
    required: {
      id: validators.string,
      left: validators.number,
      top: validators.number
    },
    optional: {
      ...commonOptionalFields
    }
  },

  [MESSAGE_TYPES.UPDATE_SIZE]: {
    required: {
      id: validators.string,
      width: (v, f) => validators.positiveNumber(v, f),
      height: (v, f) => validators.positiveNumber(v, f)
    },
    optional: {
      ...commonOptionalFields
    }
  },

  [MESSAGE_TYPES.MINIMIZE]: {
    required: {
      id: validators.string
    },
    optional: {
      ...commonOptionalFields
    }
  },

  [MESSAGE_TYPES.RESTORE]: {
    required: {
      id: validators.string
    },
    optional: {
      ...commonOptionalFields
    }
  },

  [MESSAGE_TYPES.CLOSE]: {
    required: {
      id: validators.string
    },
    optional: {
      ...commonOptionalFields
    }
  },

  [MESSAGE_TYPES.DELETE]: {
    required: {
      id: validators.string
    },
    optional: {
      ...commonOptionalFields
    }
  },

  [MESSAGE_TYPES.CLOSE_ALL]: {
    required: {},
    optional: {
      ...commonOptionalFields
    }
  },

  [MESSAGE_TYPES.CLOSE_MINIMIZED]: {
    required: {},
    optional: {
      ...commonOptionalFields
    }
  },

  [MESSAGE_TYPES.DESTROY]: {
    required: {
      id: validators.string
    },
    optional: {
      ...commonOptionalFields,
      container: validators.string
    }
  },

  [MESSAGE_TYPES.UPDATE_MINIMIZE]: {
    required: {
      id: validators.string,
      minimized: v => ({ valid: true, value: Boolean(v) })
    },
    optional: {
      ...commonOptionalFields
    }
  }
};

/**
 * Validation result structure
 */
class ValidationResult {
  constructor() {
    this.valid = true;
    this.errors = [];
    this.warnings = [];
    this.sanitizedData = null;
  }

  addError(error) {
    this.valid = false;
    this.errors.push(error);
  }

  addWarning(warning) {
    this.warnings.push(warning);
  }

  isValid() {
    return this.valid;
  }
}

/**
 * Validate message structure (type and data fields)
 * @private
 */
function validateMessageStructure(message, result) {
  if (!message || typeof message !== 'object') {
    result.addError('Message must be an object');
    return null;
  }

  const { type, data } = message;

  if (!type || typeof type !== 'string') {
    result.addError('Message must have a "type" field (string)');
    return null;
  }

  if (!MESSAGE_TYPES[type]) {
    result.addError(`Unknown message type: ${type}`);
    return null;
  }

  if (!data || typeof data !== 'object') {
    result.addError('Message must have a "data" field (object)');
    return null;
  }

  const schema = MESSAGE_SCHEMAS[type];
  if (!schema) {
    result.addError(`No schema defined for message type: ${type}`);
    return null;
  }

  return { type, data, schema };
}

/**
 * Validate and sanitize a single field
 * @private
 */
function validateField(data, field, validator, result) {
  const validationResult = validator(data[field], field);

  if (!validationResult.valid) {
    result.addError(validationResult.error);
    return null;
  }

  if (validationResult.warning) {
    result.addWarning(validationResult.warning);
  }

  return validationResult.value;
}

/**
 * Validate required fields
 * @private
 */
function validateRequiredFields(data, schema, result) {
  const sanitizedData = {};

  for (const [field, validator] of Object.entries(schema.required)) {
    if (!(field in data)) {
      result.addError(`Missing required field: ${field}`);
      continue;
    }

    const value = validateField(data, field, validator, result);
    if (value !== null) {
      sanitizedData[field] = value;
    }
  }

  return sanitizedData;
}

/**
 * Validate optional fields
 * @private
 */
function validateOptionalFields(data, schema, result, sanitizedData) {
  for (const [field, validator] of Object.entries(schema.optional)) {
    if (!(field in data)) {
      continue;
    }

    const value = validateField(data, field, validator, result);
    if (value !== null) {
      sanitizedData[field] = value;
    }
  }
}

/**
 * Validate broadcast message structure and data
 * @param {Object} message - Message to validate
 * @returns {ValidationResult} Validation result with sanitized data
 */
export function validateMessage(message) {
  const result = new ValidationResult();

  // Validate message structure
  const structure = validateMessageStructure(message, result);
  if (!structure) {
    return result;
  }

  const { data, schema } = structure;

  // Validate required fields
  const sanitizedData = validateRequiredFields(data, schema, result);

  // Validate optional fields
  validateOptionalFields(data, schema, result, sanitizedData);

  // If validation passed, set sanitized data
  if (result.isValid()) {
    result.sanitizedData = sanitizedData;
  }

  return result;
}

/**
 * Validate and sanitize message, throwing error if invalid
 * @param {Object} message - Message to validate
 * @returns {Object} Sanitized message data
 * @throws {Error} If validation fails
 */
export function validateMessageStrict(message) {
  const result = validateMessage(message);

  if (!result.isValid()) {
    const errorMsg = `Message validation failed: ${result.errors.join(', ')}`;
    throw new Error(errorMsg);
  }

  if (result.warnings.length > 0) {
    console.warn('[BroadcastMessageSchema] Validation warnings:', result.warnings);
  }

  return result.sanitizedData;
}

/**
 * Check if message type is valid
 * @param {string} type - Message type to check
 * @returns {boolean} True if valid message type
 */
export function isValidMessageType(type) {
  return Boolean(type && typeof type === 'string' && MESSAGE_TYPES[type] !== undefined);
}

/**
 * Get list of all valid message types
 * @returns {string[]} Array of valid message type names
 */
export function getValidMessageTypes() {
  return Object.values(MESSAGE_TYPES);
}
