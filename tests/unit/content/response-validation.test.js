/**
 * Response Field Validation Tests
 * v1.6.3.11-v6 - Tests for handler response schema validation
 *
 * Test Categories:
 * - Schema validation for required response fields
 * - CREATE_QUICK_TAB requires quickTabId
 * - Warning logged when fields missing
 */

describe('Response Field Validation', () => {
  let warnings;
  let originalConsoleWarn;

  beforeEach(() => {
    warnings = [];
    originalConsoleWarn = console.warn;
    console.warn = jest.fn((...args) => {
      warnings.push(args);
    });
  });

  afterEach(() => {
    console.warn = originalConsoleWarn;
  });

  // Response schema definitions
  const RESPONSE_SCHEMAS = {
    CREATE_QUICK_TAB: {
      required: ['success', 'quickTabId'],
      optional: ['timestamp', 'originTabId']
    },
    CLOSE_QUICK_TAB: {
      required: ['success'],
      optional: ['quickTabId']
    },
    MINIMIZE_QUICK_TAB: {
      required: ['success'],
      optional: ['quickTabId', 'minimized']
    },
    RESTORE_QUICK_TAB: {
      required: ['success'],
      optional: ['quickTabId', 'restored']
    },
    GET_CURRENT_TAB_ID: {
      required: ['success', 'tabId'],
      optional: []
    },
    SYNC_STATE: {
      required: ['success'],
      optional: ['tabs', 'timestamp']
    }
  };

  /**
   * Helper: Validate response against schema
   */
  const validateResponse = (operationType, response) => {
    const schema = RESPONSE_SCHEMAS[operationType];
    if (!schema) {
      return { valid: true, warnings: [], errors: [] };
    }

    // Handle null/undefined response
    if (response === null || response === undefined) {
      const errors = schema.required.map(field => ({
        type: 'MISSING_REQUIRED_FIELD',
        field,
        operationType
      }));
      return { valid: false, errors, warnings: [] };
    }

    const errors = [];
    const fieldWarnings = [];

    // Check required fields
    schema.required.forEach(field => {
      if (response[field] === undefined) {
        errors.push({
          type: 'MISSING_REQUIRED_FIELD',
          field,
          operationType
        });
      }
    });

    // Check for success field type
    if (response.success !== undefined && typeof response.success !== 'boolean') {
      fieldWarnings.push({
        type: 'INVALID_FIELD_TYPE',
        field: 'success',
        expected: 'boolean',
        actual: typeof response.success
      });
    }

    const valid = errors.length === 0;

    return {
      valid,
      errors,
      warnings: fieldWarnings
    };
  };

  /**
   * Helper: Log validation warnings
   */
  const logValidationWarnings = (operationType, result) => {
    if (!result.valid) {
      result.errors.forEach(error => {
        console.warn('[Content] RESPONSE_VALIDATION_ERROR:', {
          operationType,
          error: error.type,
          field: error.field,
          timestamp: Date.now()
        });
      });
    }

    result.warnings.forEach(warning => {
      console.warn('[Content] RESPONSE_VALIDATION_WARNING:', {
        operationType,
        warning: warning.type,
        field: warning.field,
        expected: warning.expected,
        actual: warning.actual
      });
    });
  };

  /**
   * Helper: Validate and log
   */
  const validateAndLog = (operationType, response) => {
    const result = validateResponse(operationType, response);
    logValidationWarnings(operationType, result);
    return result;
  };

  describe('Schema Validation for Required Fields', () => {
    test('should validate response has all required fields', () => {
      const response = {
        success: true,
        quickTabId: 'qt-123',
        timestamp: Date.now()
      };

      const result = validateResponse('CREATE_QUICK_TAB', response);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('should fail validation when required field is missing', () => {
      const response = {
        success: true
        // missing quickTabId
      };

      const result = validateResponse('CREATE_QUICK_TAB', response);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe('quickTabId');
    });

    test('should fail validation when multiple required fields missing', () => {
      const response = {
        // missing success and tabId
        timestamp: Date.now()
      };

      const result = validateResponse('GET_CURRENT_TAB_ID', response);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors.map(e => e.field)).toContain('success');
      expect(result.errors.map(e => e.field)).toContain('tabId');
    });

    test('should pass validation when only required fields present', () => {
      const response = {
        success: true,
        quickTabId: 'qt-123'
      };

      const result = validateResponse('CREATE_QUICK_TAB', response);

      expect(result.valid).toBe(true);
    });

    test('should pass validation with required and optional fields', () => {
      const response = {
        success: true,
        quickTabId: 'qt-123',
        timestamp: Date.now(),
        originTabId: 100
      };

      const result = validateResponse('CREATE_QUICK_TAB', response);

      expect(result.valid).toBe(true);
    });

    test('should allow extra fields not in schema', () => {
      const response = {
        success: true,
        quickTabId: 'qt-123',
        extraField: 'extra-value',
        anotherExtra: 42
      };

      const result = validateResponse('CREATE_QUICK_TAB', response);

      expect(result.valid).toBe(true);
    });
  });

  describe('CREATE_QUICK_TAB Requires quickTabId', () => {
    test('should require quickTabId field for CREATE_QUICK_TAB', () => {
      const response = {
        success: true
      };

      const result = validateResponse('CREATE_QUICK_TAB', response);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'quickTabId')).toBe(true);
    });

    test('should pass with valid quickTabId', () => {
      const response = {
        success: true,
        quickTabId: 'qt-abc-123'
      };

      const result = validateResponse('CREATE_QUICK_TAB', response);

      expect(result.valid).toBe(true);
    });

    test('should accept quickTabId as any truthy value', () => {
      const testCases = [
        { quickTabId: 'qt-1', expected: true },
        { quickTabId: 123, expected: true },
        { quickTabId: '', expected: true }, // Empty string is still defined
        { quickTabId: 0, expected: true }, // 0 is still defined
        { quickTabId: null, expected: true }, // null is still defined
        { quickTabId: undefined, expected: false } // undefined means missing
      ];

      testCases.forEach(({ quickTabId, expected }) => {
        const response = { success: true, quickTabId };
        const result = validateResponse('CREATE_QUICK_TAB', response);
        expect(result.valid).toBe(expected);
      });
    });

    test('should require both success and quickTabId', () => {
      const testCases = [
        { response: {}, expectedErrors: 2 },
        { response: { success: true }, expectedErrors: 1 },
        { response: { quickTabId: 'qt-1' }, expectedErrors: 1 },
        { response: { success: true, quickTabId: 'qt-1' }, expectedErrors: 0 }
      ];

      testCases.forEach(({ response, expectedErrors }) => {
        const result = validateResponse('CREATE_QUICK_TAB', response);
        expect(result.errors.length).toBe(expectedErrors);
      });
    });
  });

  describe('Warning Logged When Fields Missing', () => {
    test('should log warning for missing required field', () => {
      const response = { success: true };

      validateAndLog('CREATE_QUICK_TAB', response);

      expect(console.warn).toHaveBeenCalled();
      // warnings[0] is an array of args: [string, object]
      expect(warnings[0][0]).toContain('RESPONSE_VALIDATION_ERROR:');
    });

    test('should include operation type in warning', () => {
      const response = { success: true };

      validateAndLog('CREATE_QUICK_TAB', response);

      const warningArg = warnings[0][1];
      expect(warningArg.operationType).toBe('CREATE_QUICK_TAB');
    });

    test('should include missing field name in warning', () => {
      const response = { success: true };

      validateAndLog('CREATE_QUICK_TAB', response);

      const warningArg = warnings[0][1];
      expect(warningArg.field).toBe('quickTabId');
    });

    test('should include timestamp in warning', () => {
      const response = { success: true };

      validateAndLog('CREATE_QUICK_TAB', response);

      const warningArg = warnings[0][1];
      expect(warningArg.timestamp).toBeDefined();
      expect(typeof warningArg.timestamp).toBe('number');
    });

    test('should not log warning when all required fields present', () => {
      const response = {
        success: true,
        quickTabId: 'qt-123'
      };

      validateAndLog('CREATE_QUICK_TAB', response);

      expect(console.warn).not.toHaveBeenCalled();
    });

    test('should log multiple warnings for multiple missing fields', () => {
      const response = {}; // Missing both success and tabId

      validateAndLog('GET_CURRENT_TAB_ID', response);

      expect(warnings.length).toBe(2);
    });

    test('should warn about invalid success field type', () => {
      const response = {
        success: 'true', // Should be boolean, not string
        quickTabId: 'qt-123'
      };

      validateAndLog('CREATE_QUICK_TAB', response);

      // Should have type warning
      expect(warnings.some(w => w[0].includes('RESPONSE_VALIDATION_WARNING'))).toBe(true);
    });
  });

  describe('Various Operation Types', () => {
    test('should validate CLOSE_QUICK_TAB requires success', () => {
      const result = validateResponse('CLOSE_QUICK_TAB', {});
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'success')).toBe(true);
    });

    test('should validate MINIMIZE_QUICK_TAB requires success', () => {
      const result = validateResponse('MINIMIZE_QUICK_TAB', {});
      expect(result.valid).toBe(false);
    });

    test('should validate RESTORE_QUICK_TAB requires success', () => {
      const result = validateResponse('RESTORE_QUICK_TAB', { quickTabId: 'qt-1' });
      expect(result.valid).toBe(false);
    });

    test('should validate GET_CURRENT_TAB_ID requires tabId', () => {
      const result = validateResponse('GET_CURRENT_TAB_ID', { success: true });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'tabId')).toBe(true);
    });

    test('should validate SYNC_STATE requires only success', () => {
      const result = validateResponse('SYNC_STATE', { success: true });
      expect(result.valid).toBe(true);
    });
  });

  describe('Unknown Operation Types', () => {
    test('should pass validation for unknown operation type', () => {
      const result = validateResponse('UNKNOWN_OPERATION', {
        anything: 'goes'
      });

      expect(result.valid).toBe(true);
    });

    test('should not log warnings for unknown operation type', () => {
      validateAndLog('UNKNOWN_OPERATION', {});

      expect(console.warn).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    test('should handle null response', () => {
      const result = validateResponse('CREATE_QUICK_TAB', null);

      // null has no properties, so all required fields are missing
      expect(result.valid).toBe(false);
    });

    test('should handle undefined response', () => {
      const result = validateResponse('CREATE_QUICK_TAB', undefined);

      expect(result.valid).toBe(false);
    });

    test('should handle response with undefined values', () => {
      const response = {
        success: undefined,
        quickTabId: undefined
      };

      const result = validateResponse('CREATE_QUICK_TAB', response);

      // undefined values should be treated as missing
      expect(result.valid).toBe(false);
    });

    test('should handle response with null values', () => {
      const response = {
        success: null,
        quickTabId: null
      };

      const result = validateResponse('CREATE_QUICK_TAB', response);

      // null values are defined, so validation passes
      expect(result.valid).toBe(true);
    });

    test('should handle deeply nested response', () => {
      const response = {
        success: true,
        quickTabId: 'qt-1',
        nested: {
          deep: {
            value: 'test'
          }
        }
      };

      const result = validateResponse('CREATE_QUICK_TAB', response);

      expect(result.valid).toBe(true);
    });
  });

  describe('Error Details', () => {
    test('should include error type in validation result', () => {
      const response = { success: true };
      const result = validateResponse('CREATE_QUICK_TAB', response);

      expect(result.errors[0].type).toBe('MISSING_REQUIRED_FIELD');
    });

    test('should include operation type in error details', () => {
      const response = { success: true };
      const result = validateResponse('CREATE_QUICK_TAB', response);

      expect(result.errors[0].operationType).toBe('CREATE_QUICK_TAB');
    });

    test('should report all missing fields in single validation', () => {
      const response = {};
      const result = validateResponse('GET_CURRENT_TAB_ID', response);

      const missingFields = result.errors.map(e => e.field);
      expect(missingFields).toContain('success');
      expect(missingFields).toContain('tabId');
    });
  });
});
