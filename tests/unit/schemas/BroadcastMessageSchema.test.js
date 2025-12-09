/**
 * BroadcastMessageSchema Unit Tests
 *
 * Tests message validation, sanitization, and error handling
 * Related: Gap 3 - Malformed Message Validation
 */

import {
  validateMessage,
  validateMessageStrict,
  isValidMessageType,
  getValidMessageTypes,
  MESSAGE_TYPES
} from '../../../src/features/quick-tabs/schemas/BroadcastMessageSchema.js';

describe('BroadcastMessageSchema', () => {
  describe('Message Type Validation', () => {
    test('isValidMessageType returns true for valid types', () => {
      expect(isValidMessageType('CREATE')).toBe(true);
      expect(isValidMessageType('UPDATE_POSITION')).toBe(true);
      expect(isValidMessageType('CLOSE')).toBe(true);
    });

    test('isValidMessageType returns false for invalid types', () => {
      expect(isValidMessageType('INVALID')).toBe(false);
      expect(isValidMessageType(null)).toBe(false);
      expect(isValidMessageType(undefined)).toBe(false);
      expect(isValidMessageType(123)).toBe(false);
    });

    test('getValidMessageTypes returns all message types', () => {
      const types = getValidMessageTypes();
      expect(types).toContain('CREATE');
      expect(types).toContain('UPDATE_POSITION');
      expect(types).toContain('CLOSE');
      expect(types.length).toBe(Object.keys(MESSAGE_TYPES).length);
    });
  });

  describe('CREATE Message Validation', () => {
    test('validates valid CREATE message', () => {
      const message = {
        type: 'CREATE',
        data: {
          id: 'qt-123',
          url: 'https://example.com',
          left: 100,
          top: 200,
          width: 300,
          height: 400
        }
      };

      const result = validateMessage(message);
      expect(result.isValid()).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.sanitizedData).toEqual({
        id: 'qt-123',
        url: 'https://example.com',
        left: 100,
        top: 200,
        width: 300,
        height: 400
      });
    });

    test('rejects CREATE message missing required fields', () => {
      const message = {
        type: 'CREATE',
        data: {
          id: 'qt-123',
          url: 'https://example.com'
          // Missing: left, top, width, height
        }
      };

      const result = validateMessage(message);
      expect(result.isValid()).toBe(false);
      expect(result.errors).toContain('Missing required field: left');
      expect(result.errors).toContain('Missing required field: top');
      expect(result.errors).toContain('Missing required field: width');
      expect(result.errors).toContain('Missing required field: height');
    });

    test('coerces numeric strings to numbers', () => {
      const message = {
        type: 'CREATE',
        data: {
          id: 'qt-123',
          url: 'https://example.com',
          left: '100',
          top: '200',
          width: '300',
          height: '400'
        }
      };

      const result = validateMessage(message);
      expect(result.isValid()).toBe(true);
      expect(result.sanitizedData.left).toBe(100);
      expect(result.sanitizedData.top).toBe(200);
      expect(result.sanitizedData.width).toBe(300);
      expect(result.sanitizedData.height).toBe(400);
    });

    test('rejects negative width/height', () => {
      const message = {
        type: 'CREATE',
        data: {
          id: 'qt-123',
          url: 'https://example.com',
          left: 100,
          top: 200,
          width: -10,
          height: -20
        }
      };

      const result = validateMessage(message);
      expect(result.isValid()).toBe(false);
      expect(result.errors.some(e => e.includes('width'))).toBe(true);
      expect(result.errors.some(e => e.includes('height'))).toBe(true);
    });

    test('handles optional fields (soloedOnTabs, mutedOnTabs)', () => {
      const message = {
        type: 'CREATE',
        data: {
          id: 'qt-123',
          url: 'https://example.com',
          left: 100,
          top: 200,
          width: 300,
          height: 400,
          soloedOnTabs: [1, 2, 3],
          mutedOnTabs: [4, 5]
        }
      };

      const result = validateMessage(message);
      expect(result.isValid()).toBe(true);
      expect(result.sanitizedData.soloedOnTabs).toEqual([1, 2, 3]);
      expect(result.sanitizedData.mutedOnTabs).toEqual([4, 5]);
    });
  });

  describe('UPDATE_POSITION Message Validation', () => {
    test('validates valid UPDATE_POSITION message', () => {
      const message = {
        type: 'UPDATE_POSITION',
        data: {
          id: 'qt-123',
          left: 150,
          top: 250
        }
      };

      const result = validateMessage(message);
      expect(result.isValid()).toBe(true);
      expect(result.sanitizedData).toEqual({
        id: 'qt-123',
        left: 150,
        top: 250
      });
    });

    test('rejects UPDATE_POSITION missing id', () => {
      const message = {
        type: 'UPDATE_POSITION',
        data: {
          left: 150,
          top: 250
        }
      };

      const result = validateMessage(message);
      expect(result.isValid()).toBe(false);
      expect(result.errors).toContain('Missing required field: id');
    });
  });

  describe('UPDATE_SIZE Message Validation', () => {
    test('validates valid UPDATE_SIZE message', () => {
      const message = {
        type: 'UPDATE_SIZE',
        data: {
          id: 'qt-123',
          width: 400,
          height: 500
        }
      };

      const result = validateMessage(message);
      expect(result.isValid()).toBe(true);
      expect(result.sanitizedData).toEqual({
        id: 'qt-123',
        width: 400,
        height: 500
      });
    });
  });

  describe('Simple Message Types (MINIMIZE, RESTORE, CLOSE)', () => {
    test.each(['MINIMIZE', 'RESTORE', 'CLOSE'])('validates %s message', type => {
      const message = {
        type,
        data: {
          id: 'qt-123'
        }
      };

      const result = validateMessage(message);
      expect(result.isValid()).toBe(true);
      expect(result.sanitizedData).toEqual({ id: 'qt-123' });
    });

    test.each(['MINIMIZE', 'RESTORE', 'CLOSE'])('rejects %s message without id', type => {
      const message = {
        type,
        data: {}
      };

      const result = validateMessage(message);
      expect(result.isValid()).toBe(false);
      expect(result.errors).toContain('Missing required field: id');
    });
  });

  describe('SOLO/MUTE Message Validation', () => {
    test('validates SOLO message', () => {
      const message = {
        type: 'SOLO',
        data: {
          id: 'qt-123',
          soloedOnTabs: [1, 2, 3]
        }
      };

      const result = validateMessage(message);
      expect(result.isValid()).toBe(true);
      expect(result.sanitizedData).toEqual({
        id: 'qt-123',
        soloedOnTabs: [1, 2, 3]
      });
    });

    test('validates MUTE message', () => {
      const message = {
        type: 'MUTE',
        data: {
          id: 'qt-123',
          mutedOnTabs: [4, 5]
        }
      };

      const result = validateMessage(message);
      expect(result.isValid()).toBe(true);
      expect(result.sanitizedData).toEqual({
        id: 'qt-123',
        mutedOnTabs: [4, 5]
      });
    });

    test('rejects non-array soloedOnTabs', () => {
      const message = {
        type: 'SOLO',
        data: {
          id: 'qt-123',
          soloedOnTabs: 'not-an-array'
        }
      };

      const result = validateMessage(message);
      expect(result.isValid()).toBe(false);
      expect(result.errors.some(e => e.includes('array'))).toBe(true);
    });
  });

  describe('Malformed Message Handling', () => {
    test('rejects null message', () => {
      const result = validateMessage(null);
      expect(result.isValid()).toBe(false);
      expect(result.errors).toContain('Message must be an object');
    });

    test('rejects undefined message', () => {
      const result = validateMessage(undefined);
      expect(result.isValid()).toBe(false);
      expect(result.errors).toContain('Message must be an object');
    });

    test('rejects message without type field', () => {
      const message = {
        data: { id: 'qt-123' }
      };

      const result = validateMessage(message);
      expect(result.isValid()).toBe(false);
      expect(result.errors.some(e => e.includes('type'))).toBe(true);
    });

    test('rejects message without data field', () => {
      const message = {
        type: 'CLOSE'
      };

      const result = validateMessage(message);
      expect(result.isValid()).toBe(false);
      expect(result.errors.some(e => e.includes('data'))).toBe(true);
    });

    test('rejects message with unknown type', () => {
      const message = {
        type: 'UNKNOWN_TYPE',
        data: { id: 'qt-123' }
      };

      const result = validateMessage(message);
      expect(result.isValid()).toBe(false);
      expect(result.errors).toContain('Unknown message type: UNKNOWN_TYPE');
    });

    test('rejects message with non-string id', () => {
      const message = {
        type: 'CLOSE',
        data: { id: 123 }
      };

      const result = validateMessage(message);
      expect(result.isValid()).toBe(false);
      expect(result.errors.some(e => e.includes('id') && e.includes('string'))).toBe(true);
    });

    test('rejects message with non-numeric position values', () => {
      const message = {
        type: 'UPDATE_POSITION',
        data: {
          id: 'qt-123',
          left: 'not-a-number',
          top: 'also-not-a-number'
        }
      };

      const result = validateMessage(message);
      expect(result.isValid()).toBe(false);
      expect(result.errors.some(e => e.includes('left'))).toBe(true);
      expect(result.errors.some(e => e.includes('top'))).toBe(true);
    });
  });

  describe('validateMessageStrict', () => {
    test('returns sanitized data for valid message', () => {
      const message = {
        type: 'CLOSE',
        data: { id: 'qt-123' }
      };

      const sanitized = validateMessageStrict(message);
      expect(sanitized).toEqual({ id: 'qt-123' });
    });

    test('throws error for invalid message', () => {
      const message = {
        type: 'CLOSE',
        data: {}
      };

      expect(() => validateMessageStrict(message)).toThrow('Message validation failed');
    });
  });

  describe('Array Truncation', () => {
    test('truncates oversized arrays with warning', () => {
      const largeArray = Array.from({ length: 2000 }, (_, i) => i);
      const message = {
        type: 'SOLO',
        data: {
          id: 'qt-123',
          soloedOnTabs: largeArray
        }
      };

      const result = validateMessage(message);
      expect(result.isValid()).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.sanitizedData.soloedOnTabs.length).toBe(1000); // Max length
    });
  });
});
