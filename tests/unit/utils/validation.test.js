/**
 * ValidationUtils Unit Tests
 * Phase 6: Tests for shared validation utilities
 *
 * @version 1.6.0
 */

import {
  isValidUrl,
  isValidHexColor,
  isValidContainerId,
  sanitizeContainerId,
  extractContainerNumber,
  isValidDimensions,
  isValidPosition,
  isValidPositionObject,
  isValidSizeObject,
  isValidTabId,
  isValidTabIdArray,
  isValidString,
  isValidNumber,
  isValidZIndex,
  isValidQuickTabId,
  isValidBoolean,
  isValidObject,
  isValidArray
} from '../../../src/utils/validation.js';

describe('ValidationUtils', () => {
  describe('isValidUrl()', () => {
    test('should return true for valid HTTP URLs', () => {
      expect(isValidUrl('http://example.com')).toBe(true);
      expect(isValidUrl('http://example.com/path')).toBe(true);
      expect(isValidUrl('http://example.com:8080')).toBe(true);
    });

    test('should return true for valid HTTPS URLs', () => {
      expect(isValidUrl('https://example.com')).toBe(true);
      expect(isValidUrl('https://example.com/path/to/page')).toBe(true);
      expect(isValidUrl('https://example.com?query=param')).toBe(true);
    });

    test('should return false for invalid URLs', () => {
      expect(isValidUrl('not-a-url')).toBe(false);
      expect(isValidUrl('ftp://example.com')).toBe(false);
      expect(isValidUrl('file:///path/to/file')).toBe(false);
    });

    test('should return false for non-string values', () => {
      expect(isValidUrl(null)).toBe(false);
      expect(isValidUrl(undefined)).toBe(false);
      expect(isValidUrl(123)).toBe(false);
      expect(isValidUrl({})).toBe(false);
    });

    test('should return false for empty string', () => {
      expect(isValidUrl('')).toBe(false);
    });
  });

  describe('isValidHexColor()', () => {
    test('should return true for valid 3-digit hex colors', () => {
      expect(isValidHexColor('#fff')).toBe(true);
      expect(isValidHexColor('#000')).toBe(true);
      expect(isValidHexColor('#abc')).toBe(true);
    });

    test('should return true for valid 6-digit hex colors', () => {
      expect(isValidHexColor('#ffffff')).toBe(true);
      expect(isValidHexColor('#000000')).toBe(true);
      expect(isValidHexColor('#FF5733')).toBe(true);
    });

    test('should return true for valid 8-digit hex colors (with alpha)', () => {
      expect(isValidHexColor('#ffffffff')).toBe(true);
      expect(isValidHexColor('#FF5733AA')).toBe(true);
    });

    test('should return false for invalid hex colors', () => {
      expect(isValidHexColor('ffffff')).toBe(false); // Missing #
      expect(isValidHexColor('#gg0000')).toBe(false); // Invalid characters
      expect(isValidHexColor('#ff')).toBe(false); // Too short
      expect(isValidHexColor('#fffffffff')).toBe(false); // Too long
    });

    test('should return false for non-string values', () => {
      expect(isValidHexColor(null)).toBe(false);
      expect(isValidHexColor(undefined)).toBe(false);
      expect(isValidHexColor(123)).toBe(false);
    });
  });

  describe('isValidContainerId()', () => {
    test('should return true for firefox-default', () => {
      expect(isValidContainerId('firefox-default')).toBe(true);
    });

    test('should return true for firefox-container-N', () => {
      expect(isValidContainerId('firefox-container-1')).toBe(true);
      expect(isValidContainerId('firefox-container-999')).toBe(true);
    });

    test('should return true for firefox-private', () => {
      expect(isValidContainerId('firefox-private')).toBe(true);
      expect(isValidContainerId('firefox-private-1')).toBe(true);
    });

    test('should return false for invalid container IDs', () => {
      expect(isValidContainerId('chrome-container-1')).toBe(false);
      expect(isValidContainerId('invalid-id')).toBe(false);
      expect(isValidContainerId('')).toBe(false);
    });

    test('should return false for non-string values', () => {
      expect(isValidContainerId(null)).toBe(false);
      expect(isValidContainerId(undefined)).toBe(false);
      expect(isValidContainerId(123)).toBe(false);
    });
  });

  describe('sanitizeContainerId()', () => {
    test('should return valid IDs unchanged', () => {
      expect(sanitizeContainerId('firefox-default')).toBe('firefox-default');
      expect(sanitizeContainerId('firefox-container-1')).toBe('firefox-container-1');
      expect(sanitizeContainerId('firefox-private')).toBe('firefox-private');
    });

    test('should return firefox-default for invalid IDs', () => {
      expect(sanitizeContainerId('invalid-id')).toBe('firefox-default');
      expect(sanitizeContainerId('')).toBe('firefox-default');
      expect(sanitizeContainerId(null)).toBe('firefox-default');
      expect(sanitizeContainerId(undefined)).toBe('firefox-default');
    });
  });

  describe('extractContainerNumber()', () => {
    test('should extract number from firefox-container-N', () => {
      expect(extractContainerNumber('firefox-container-1')).toBe(1);
      expect(extractContainerNumber('firefox-container-42')).toBe(42);
      expect(extractContainerNumber('firefox-container-999')).toBe(999);
    });

    test('should return null for non-numbered containers', () => {
      expect(extractContainerNumber('firefox-default')).toBeNull();
      expect(extractContainerNumber('firefox-private')).toBeNull();
      expect(extractContainerNumber('invalid-id')).toBeNull();
    });

    test('should return null for non-string values', () => {
      expect(extractContainerNumber(null)).toBeNull();
      expect(extractContainerNumber(undefined)).toBeNull();
      expect(extractContainerNumber(123)).toBeNull();
    });
  });

  describe('isValidDimensions()', () => {
    test('should return true for valid dimensions', () => {
      expect(isValidDimensions(100, 200)).toBe(true);
      expect(isValidDimensions(0, 0)).toBe(true);
      expect(isValidDimensions(1920, 1080)).toBe(true);
    });

    test('should respect min constraint', () => {
      expect(isValidDimensions(50, 50, { min: 100 })).toBe(false);
      expect(isValidDimensions(100, 100, { min: 100 })).toBe(true);
      expect(isValidDimensions(150, 150, { min: 100 })).toBe(true);
    });

    test('should respect max constraint', () => {
      expect(isValidDimensions(500, 500, { max: 400 })).toBe(false);
      expect(isValidDimensions(400, 400, { max: 400 })).toBe(true);
      expect(isValidDimensions(300, 300, { max: 400 })).toBe(true);
    });

    test('should respect both min and max constraints', () => {
      expect(isValidDimensions(50, 50, { min: 100, max: 200 })).toBe(false);
      expect(isValidDimensions(150, 150, { min: 100, max: 200 })).toBe(true);
      expect(isValidDimensions(250, 250, { min: 100, max: 200 })).toBe(false);
    });

    test('should return false for non-numeric values', () => {
      expect(isValidDimensions('100', 200)).toBe(false);
      expect(isValidDimensions(100, '200')).toBe(false);
      expect(isValidDimensions(null, 200)).toBe(false);
    });

    test('should return false for NaN values', () => {
      expect(isValidDimensions(NaN, 200)).toBe(false);
      expect(isValidDimensions(100, NaN)).toBe(false);
    });
  });

  describe('isValidPosition()', () => {
    test('should return true for valid positions', () => {
      expect(isValidPosition(100, 200)).toBe(true);
      expect(isValidPosition(0, 0)).toBe(true);
      expect(isValidPosition(-10, -20)).toBe(true);
    });

    test('should validate against viewport when provided', () => {
      const viewport = { width: 1920, height: 1080 };
      expect(isValidPosition(100, 200, viewport)).toBe(true);
      expect(isValidPosition(1920, 1080, viewport)).toBe(true);
      expect(isValidPosition(2000, 500, viewport)).toBe(false);
      expect(isValidPosition(500, 1200, viewport)).toBe(false);
    });

    test('should return false for non-numeric values', () => {
      expect(isValidPosition('100', 200)).toBe(false);
      expect(isValidPosition(100, '200')).toBe(false);
      expect(isValidPosition(null, 200)).toBe(false);
    });

    test('should return false for NaN values', () => {
      expect(isValidPosition(NaN, 200)).toBe(false);
      expect(isValidPosition(100, NaN)).toBe(false);
    });
  });

  describe('isValidPositionObject()', () => {
    test('should return true for valid position objects', () => {
      expect(isValidPositionObject({ left: 100, top: 200 })).toBe(true);
      expect(isValidPositionObject({ left: 0, top: 0 })).toBe(true);
      expect(isValidPositionObject({ left: -10, top: -20 })).toBe(true);
    });

    test('should return false for invalid position objects', () => {
      expect(isValidPositionObject({ left: '100', top: 200 })).toBe(false);
      expect(isValidPositionObject({ left: 100 })).toBe(false);
      expect(isValidPositionObject({ top: 200 })).toBe(false);
      expect(isValidPositionObject({})).toBe(false);
    });

    test('should return false for non-object values', () => {
      expect(isValidPositionObject(null)).toBe(false);
      expect(isValidPositionObject(undefined)).toBe(false);
      expect(isValidPositionObject('position')).toBe(false);
      expect(isValidPositionObject(123)).toBe(false);
    });

    test('should return false for NaN values', () => {
      expect(isValidPositionObject({ left: NaN, top: 200 })).toBe(false);
      expect(isValidPositionObject({ left: 100, top: NaN })).toBe(false);
    });
  });

  describe('isValidSizeObject()', () => {
    test('should return true for valid size objects', () => {
      expect(isValidSizeObject({ width: 400, height: 300 })).toBe(true);
      expect(isValidSizeObject({ width: 0, height: 0 })).toBe(true);
    });

    test('should respect min constraint', () => {
      expect(isValidSizeObject({ width: 50, height: 50 }, { min: 100 })).toBe(false);
      expect(isValidSizeObject({ width: 100, height: 100 }, { min: 100 })).toBe(true);
    });

    test('should respect max constraint', () => {
      expect(isValidSizeObject({ width: 500, height: 500 }, { max: 400 })).toBe(false);
      expect(isValidSizeObject({ width: 400, height: 400 }, { max: 400 })).toBe(true);
    });

    test('should return false for invalid size objects', () => {
      expect(isValidSizeObject({ width: '400', height: 300 })).toBe(false);
      expect(isValidSizeObject({ width: 400 })).toBe(false);
      expect(isValidSizeObject({ height: 300 })).toBe(false);
      expect(isValidSizeObject({})).toBe(false);
    });

    test('should return false for non-object values', () => {
      expect(isValidSizeObject(null)).toBe(false);
      expect(isValidSizeObject(undefined)).toBe(false);
      expect(isValidSizeObject('size')).toBe(false);
    });
  });

  describe('isValidTabId()', () => {
    test('should return true for valid numeric tab IDs', () => {
      expect(isValidTabId(0)).toBe(true);
      expect(isValidTabId(1)).toBe(true);
      expect(isValidTabId(999)).toBe(true);
    });

    test('should return true for valid string tab IDs', () => {
      expect(isValidTabId('0')).toBe(true);
      expect(isValidTabId('1')).toBe(true);
      expect(isValidTabId('999')).toBe(true);
    });

    test('should return false for negative tab IDs', () => {
      expect(isValidTabId(-1)).toBe(false);
      expect(isValidTabId('-1')).toBe(false);
    });

    test('should return false for NaN values', () => {
      expect(isValidTabId(NaN)).toBe(false);
      expect(isValidTabId('not-a-number')).toBe(false);
    });

    test('should return false for invalid types', () => {
      expect(isValidTabId(null)).toBe(false);
      expect(isValidTabId(undefined)).toBe(false);
      expect(isValidTabId({})).toBe(false);
      expect(isValidTabId([])).toBe(false);
    });
  });

  describe('isValidTabIdArray()', () => {
    test('should return true for valid tab ID arrays', () => {
      expect(isValidTabIdArray([1, 2, 3])).toBe(true);
      expect(isValidTabIdArray(['1', '2', '3'])).toBe(true);
      expect(isValidTabIdArray([0])).toBe(true);
    });

    test('should return true for empty arrays', () => {
      expect(isValidTabIdArray([])).toBe(true);
    });

    test('should return false for arrays with invalid tab IDs', () => {
      expect(isValidTabIdArray([1, -1, 3])).toBe(false);
      expect(isValidTabIdArray([1, 'invalid', 3])).toBe(false);
      expect(isValidTabIdArray([null])).toBe(false);
    });

    test('should return false for non-array values', () => {
      expect(isValidTabIdArray(null)).toBe(false);
      expect(isValidTabIdArray(undefined)).toBe(false);
      expect(isValidTabIdArray('array')).toBe(false);
      expect(isValidTabIdArray(123)).toBe(false);
    });
  });

  describe('isValidString()', () => {
    test('should return true for valid strings', () => {
      expect(isValidString('hello')).toBe(true);
      expect(isValidString('test string')).toBe(true);
      expect(isValidString('a')).toBe(true);
    });

    test('should respect minLength constraint', () => {
      expect(isValidString('ab', { minLength: 3 })).toBe(false);
      expect(isValidString('abc', { minLength: 3 })).toBe(true);
      expect(isValidString('abcd', { minLength: 3 })).toBe(true);
    });

    test('should respect maxLength constraint', () => {
      expect(isValidString('abcdef', { maxLength: 5 })).toBe(false);
      expect(isValidString('abcde', { maxLength: 5 })).toBe(true);
      expect(isValidString('abcd', { maxLength: 5 })).toBe(true);
    });

    test('should handle allowEmpty option', () => {
      expect(isValidString('', { allowEmpty: false })).toBe(false);
      expect(isValidString('', { allowEmpty: true })).toBe(true);
    });

    test('should return false for non-string values', () => {
      expect(isValidString(null)).toBe(false);
      expect(isValidString(undefined)).toBe(false);
      expect(isValidString(123)).toBe(false);
      expect(isValidString({})).toBe(false);
    });
  });

  describe('isValidNumber()', () => {
    test('should return true for valid numbers', () => {
      expect(isValidNumber(0)).toBe(true);
      expect(isValidNumber(100)).toBe(true);
      expect(isValidNumber(-50)).toBe(true);
      expect(isValidNumber(3.14)).toBe(true);
    });

    test('should respect min constraint', () => {
      expect(isValidNumber(5, { min: 10 })).toBe(false);
      expect(isValidNumber(10, { min: 10 })).toBe(true);
      expect(isValidNumber(15, { min: 10 })).toBe(true);
    });

    test('should respect max constraint', () => {
      expect(isValidNumber(15, { max: 10 })).toBe(false);
      expect(isValidNumber(10, { max: 10 })).toBe(true);
      expect(isValidNumber(5, { max: 10 })).toBe(true);
    });

    test('should validate integer when required', () => {
      expect(isValidNumber(10, { integer: true })).toBe(true);
      expect(isValidNumber(3.14, { integer: true })).toBe(false);
      expect(isValidNumber(0, { integer: true })).toBe(true);
    });

    test('should return false for NaN', () => {
      expect(isValidNumber(NaN)).toBe(false);
    });

    test('should return false for non-numeric values', () => {
      expect(isValidNumber('100')).toBe(false);
      expect(isValidNumber(null)).toBe(false);
      expect(isValidNumber(undefined)).toBe(false);
    });
  });

  describe('isValidZIndex()', () => {
    test('should return true for valid z-index values', () => {
      expect(isValidZIndex(0)).toBe(true);
      expect(isValidZIndex(1)).toBe(true);
      expect(isValidZIndex(999999)).toBe(true);
    });

    test('should return false for negative z-index', () => {
      expect(isValidZIndex(-1)).toBe(false);
      expect(isValidZIndex(-100)).toBe(false);
    });

    test('should return false for non-integer z-index', () => {
      expect(isValidZIndex(3.14)).toBe(false);
      expect(isValidZIndex(1.5)).toBe(false);
    });

    test('should return false for non-numeric values', () => {
      expect(isValidZIndex('100')).toBe(false);
      expect(isValidZIndex(NaN)).toBe(false);
    });
  });

  describe('isValidQuickTabId()', () => {
    test('should return true for valid Quick Tab IDs', () => {
      expect(isValidQuickTabId('qt-123')).toBe(true);
      expect(isValidQuickTabId('qt-abc-def')).toBe(true);
      expect(isValidQuickTabId('custom-id')).toBe(true);
    });

    test('should return false for empty strings', () => {
      expect(isValidQuickTabId('')).toBe(false);
    });

    test('should return false for non-string values', () => {
      expect(isValidQuickTabId(null)).toBe(false);
      expect(isValidQuickTabId(undefined)).toBe(false);
      expect(isValidQuickTabId(123)).toBe(false);
    });
  });

  describe('isValidBoolean()', () => {
    test('should return true for boolean values', () => {
      expect(isValidBoolean(true)).toBe(true);
      expect(isValidBoolean(false)).toBe(true);
    });

    test('should return false for non-boolean values', () => {
      expect(isValidBoolean(1)).toBe(false);
      expect(isValidBoolean(0)).toBe(false);
      expect(isValidBoolean('true')).toBe(false);
      expect(isValidBoolean(null)).toBe(false);
    });
  });

  describe('isValidObject()', () => {
    test('should return true for valid objects', () => {
      expect(isValidObject({})).toBe(true);
      expect(isValidObject({ key: 'value' })).toBe(true);
    });

    test('should handle allowNull option', () => {
      expect(isValidObject(null, false)).toBe(false);
      expect(isValidObject(null, true)).toBe(true);
    });

    test('should return false for arrays', () => {
      expect(isValidObject([])).toBe(false);
      expect(isValidObject([1, 2, 3])).toBe(false);
    });

    test('should return false for primitives', () => {
      expect(isValidObject('string')).toBe(false);
      expect(isValidObject(123)).toBe(false);
      expect(isValidObject(true)).toBe(false);
    });
  });

  describe('isValidArray()', () => {
    test('should return true for valid arrays', () => {
      expect(isValidArray([])).toBe(true);
      expect(isValidArray([1, 2, 3])).toBe(true);
      expect(isValidArray(['a', 'b', 'c'])).toBe(true);
    });

    test('should respect minLength constraint', () => {
      expect(isValidArray([1], { minLength: 2 })).toBe(false);
      expect(isValidArray([1, 2], { minLength: 2 })).toBe(true);
      expect(isValidArray([1, 2, 3], { minLength: 2 })).toBe(true);
    });

    test('should respect maxLength constraint', () => {
      expect(isValidArray([1, 2, 3], { maxLength: 2 })).toBe(false);
      expect(isValidArray([1, 2], { maxLength: 2 })).toBe(true);
      expect(isValidArray([1], { maxLength: 2 })).toBe(true);
    });

    test('should return false for non-array values', () => {
      expect(isValidArray(null)).toBe(false);
      expect(isValidArray(undefined)).toBe(false);
      expect(isValidArray('array')).toBe(false);
      expect(isValidArray({})).toBe(false);
    });
  });
});
