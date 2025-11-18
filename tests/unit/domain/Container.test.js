/**
 * Container Domain Entity Tests
 * v1.6.0 - Unit tests for Firefox container support
 *
 * Target: 100% coverage (branches, functions, lines, statements)
 */

import { Container } from '../../../src/domain/Container.js';

describe('Container Domain Entity', () => {
  describe('Construction', () => {
    test('should create Container with valid parameters', () => {
      const container = new Container({
        id: 'firefox-container-1',
        name: 'Work',
        color: 'blue',
        icon: 'briefcase'
      });

      expect(container.id).toBe('firefox-container-1');
      expect(container.name).toBe('Work');
      expect(container.color).toBe('blue');
      expect(container.icon).toBe('briefcase');
    });

    test('should use defaults for optional parameters', () => {
      const container = new Container({
        id: 'firefox-container-2'
      });

      expect(container.name).toBe('Container 2');
      expect(container.color).toBe('grey');
      expect(container.icon).toBe('circle');
    });

    test('should throw error if id is missing', () => {
      expect(() => {
        new Container({});
      }).toThrow('Container requires a valid string id');
    });

    test('should throw error if id is not a string', () => {
      expect(() => {
        new Container({ id: 123 });
      }).toThrow('Container requires a valid string id');
    });
  });

  describe('Default Names', () => {
    test('should use "Default" for firefox-default', () => {
      const container = new Container({ id: 'firefox-default' });
      expect(container.name).toBe('Default');
    });

    test('should use "Container N" for custom containers', () => {
      const container1 = new Container({ id: 'firefox-container-1' });
      const container2 = new Container({ id: 'firefox-container-42' });

      expect(container1.name).toBe('Container 1');
      expect(container2.name).toBe('Container 42');
    });

    test('should use "Private" for private containers', () => {
      const container = new Container({ id: 'firefox-private-1' });
      expect(container.name).toBe('Private');
    });

    test('should use "Unknown Container" for unrecognized IDs', () => {
      const container = new Container({ id: 'custom-unknown-id' });
      expect(container.name).toBe('Unknown Container');
    });
  });

  describe('Container Type Checks', () => {
    test('isDefault should return true for default container', () => {
      const container = new Container({ id: 'firefox-default' });
      expect(container.isDefault()).toBe(true);
    });

    test('isDefault should return false for non-default containers', () => {
      const container1 = new Container({ id: 'firefox-container-1' });
      const container2 = new Container({ id: 'firefox-private-1' });

      expect(container1.isDefault()).toBe(false);
      expect(container2.isDefault()).toBe(false);
    });

    test('isPrivate should return true for private containers', () => {
      const container = new Container({ id: 'firefox-private-1' });
      expect(container.isPrivate()).toBe(true);
    });

    test('isPrivate should return false for non-private containers', () => {
      const container1 = new Container({ id: 'firefox-default' });
      const container2 = new Container({ id: 'firefox-container-1' });

      expect(container1.isPrivate()).toBe(false);
      expect(container2.isPrivate()).toBe(false);
    });

    test('isCustom should return true for custom containers', () => {
      const container = new Container({ id: 'firefox-container-5' });
      expect(container.isCustom()).toBe(true);
    });

    test('isCustom should return false for non-custom containers', () => {
      const container1 = new Container({ id: 'firefox-default' });
      const container2 = new Container({ id: 'firefox-private-1' });

      expect(container1.isCustom()).toBe(false);
      expect(container2.isCustom()).toBe(false);
    });
  });

  describe('Container Number Extraction', () => {
    test('getContainerNumber should return number for custom containers', () => {
      const container1 = new Container({ id: 'firefox-container-1' });
      const container2 = new Container({ id: 'firefox-container-99' });

      expect(container1.getContainerNumber()).toBe(1);
      expect(container2.getContainerNumber()).toBe(99);
    });

    test('getContainerNumber should return null for non-custom containers', () => {
      const container1 = new Container({ id: 'firefox-default' });
      const container2 = new Container({ id: 'firefox-private-1' });

      expect(container1.getContainerNumber()).toBeNull();
      expect(container2.getContainerNumber()).toBeNull();
    });

    test('getContainerNumber should handle malformed custom container IDs', () => {
      // Edge case: ID starts with firefox-container- but doesn't have a number
      // This shouldn't happen in practice, but we test for robustness
      const container = new Container({ id: 'firefox-container-invalid' });
      
      // isCustom() will return true (starts with firefox-container-)
      // but the regex match will fail
      expect(container.isCustom()).toBe(true);
      expect(container.getContainerNumber()).toBeNull();
    });
  });

  describe('Static Validation Methods', () => {
    describe('isValidId', () => {
      test('should return true for firefox-default', () => {
        expect(Container.isValidId('firefox-default')).toBe(true);
      });

      test('should return true for custom containers', () => {
        expect(Container.isValidId('firefox-container-1')).toBe(true);
        expect(Container.isValidId('firefox-container-999')).toBe(true);
      });

      test('should return true for private containers', () => {
        expect(Container.isValidId('firefox-private-1')).toBe(true);
      });

      test('should return false for invalid IDs', () => {
        expect(Container.isValidId('')).toBe(false);
        expect(Container.isValidId(null)).toBe(false);
        expect(Container.isValidId(undefined)).toBe(false);
        expect(Container.isValidId(123)).toBe(false);
        expect(Container.isValidId('invalid-id')).toBe(false);
      });
    });

    describe('sanitize', () => {
      test('should return valid IDs unchanged', () => {
        expect(Container.sanitize('firefox-default')).toBe('firefox-default');
        expect(Container.sanitize('firefox-container-5')).toBe('firefox-container-5');
        expect(Container.sanitize('firefox-private-1')).toBe('firefox-private-1');
      });

      test('should return firefox-default for invalid IDs', () => {
        expect(Container.sanitize('')).toBe('firefox-default');
        expect(Container.sanitize(null)).toBe('firefox-default');
        expect(Container.sanitize(undefined)).toBe('firefox-default');
        expect(Container.sanitize('invalid-id')).toBe('firefox-default');
      });

      test('should return firefox-default for non-string values', () => {
        expect(Container.sanitize(123)).toBe('firefox-default');
        expect(Container.sanitize({})).toBe('firefox-default');
        expect(Container.sanitize([])).toBe('firefox-default');
      });
    });

    describe('extractNumber', () => {
      test('should extract number from custom container IDs', () => {
        expect(Container.extractNumber('firefox-container-1')).toBe(1);
        expect(Container.extractNumber('firefox-container-42')).toBe(42);
        expect(Container.extractNumber('firefox-container-999')).toBe(999);
      });

      test('should return null for non-custom containers', () => {
        expect(Container.extractNumber('firefox-default')).toBeNull();
        expect(Container.extractNumber('firefox-private-1')).toBeNull();
        expect(Container.extractNumber('invalid-id')).toBeNull();
      });

      test('should return null for invalid inputs', () => {
        expect(Container.extractNumber(null)).toBeNull();
        expect(Container.extractNumber(undefined)).toBeNull();
        expect(Container.extractNumber(123)).toBeNull();
      });
    });
  });

  describe('Static Factory Methods', () => {
    describe('fromContextualIdentity', () => {
      test('should create Container from Firefox API response', () => {
        const identity = {
          cookieStoreId: 'firefox-container-3',
          name: 'Shopping',
          color: 'green',
          icon: 'cart'
        };

        const container = Container.fromContextualIdentity(identity);

        expect(container.id).toBe('firefox-container-3');
        expect(container.name).toBe('Shopping');
        expect(container.color).toBe('green');
        expect(container.icon).toBe('cart');
      });
    });

    describe('default', () => {
      test('should create default container', () => {
        const container = Container.default();

        expect(container.id).toBe('firefox-default');
        expect(container.name).toBe('Default');
        expect(container.color).toBe('grey');
        expect(container.icon).toBe('circle');
      });
    });

    describe('fromStorage', () => {
      test('should hydrate from storage format', () => {
        const data = {
          id: 'firefox-container-7',
          name: 'Personal',
          color: 'purple',
          icon: 'fingerprint'
        };

        const container = Container.fromStorage(data);

        expect(container.id).toBe('firefox-container-7');
        expect(container.name).toBe('Personal');
        expect(container.color).toBe('purple');
        expect(container.icon).toBe('fingerprint');
      });

      test('should handle minimal data', () => {
        const data = {
          id: 'firefox-container-8'
        };

        const container = Container.fromStorage(data);

        expect(container.id).toBe('firefox-container-8');
        expect(container.name).toBe('Container 8');
        expect(container.color).toBe('grey');
        expect(container.icon).toBe('circle');
      });
    });
  });

  describe('Serialization', () => {
    test('should serialize to plain object', () => {
      const container = new Container({
        id: 'firefox-container-9',
        name: 'Banking',
        color: 'red',
        icon: 'dollar'
      });

      const serialized = container.serialize();

      expect(serialized).toEqual({
        id: 'firefox-container-9',
        name: 'Banking',
        color: 'red',
        icon: 'dollar'
      });
    });

    test('should serialize with defaults', () => {
      const container = new Container({
        id: 'firefox-default'
      });

      const serialized = container.serialize();

      expect(serialized).toEqual({
        id: 'firefox-default',
        name: 'Default',
        color: 'grey',
        icon: 'circle'
      });
    });
  });

  describe('Round-trip Serialization', () => {
    test('should maintain data through serialize/deserialize cycle', () => {
      const original = new Container({
        id: 'firefox-container-10',
        name: 'Test Container',
        color: 'orange',
        icon: 'fence'
      });

      const serialized = original.serialize();
      const deserialized = Container.fromStorage(serialized);

      expect(deserialized.id).toBe(original.id);
      expect(deserialized.name).toBe(original.name);
      expect(deserialized.color).toBe(original.color);
      expect(deserialized.icon).toBe(original.icon);
    });
  });
});
