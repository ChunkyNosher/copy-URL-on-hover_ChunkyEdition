/**
 * Unit tests for MapTransactionManager
 * v1.6.3.5 - New test file for Map transaction wrapper
 */

import { MapTransactionManager } from '../../../src/features/quick-tabs/map-transaction-manager.js';

describe('MapTransactionManager', () => {
  let map;
  let manager;

  beforeEach(() => {
    map = new Map();
    manager = new MapTransactionManager(map, 'testMap');
    console.log = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();
  });

  describe('constructor', () => {
    test('should throw if not given a Map', () => {
      expect(() => new MapTransactionManager(null)).toThrow(/received: object/);
      expect(() => new MapTransactionManager({})).toThrow(/received: object/);
    });

    test('should initialize with the given Map', () => {
      expect(manager.getMapSize()).toBe(0);
    });
  });

  describe('getMapKeys()', () => {
    test('should return array of keys', () => {
      map.set('key1', 'value1');
      map.set('key2', 'value2');

      const keys = manager.getMapKeys();
      expect(keys).toEqual(['key1', 'key2']);
    });
  });

  describe('beginTransaction()', () => {
    test('should start a transaction and capture snapshot', () => {
      map.set('key1', 'value1');

      const started = manager.beginTransaction('test reason');

      expect(started).toBe(true);
      expect(manager.isInTransaction()).toBe(true);
      expect(manager.getTransactionId()).toMatch(/^txn-\d+$/);
    });

    test('should not allow nested transactions', () => {
      manager.beginTransaction();
      const started = manager.beginTransaction();

      expect(started).toBe(false);
    });
  });

  describe('deleteEntry()', () => {
    test('should delete entry and log operation', () => {
      map.set('key1', 'value1');
      manager.beginTransaction();

      const deleted = manager.deleteEntry('key1', 'test delete');

      expect(deleted).toBe(true);
      expect(map.has('key1')).toBe(false);
    });

    test('should return false if entry does not exist', () => {
      manager.beginTransaction();

      const deleted = manager.deleteEntry('nonexistent', 'test');

      expect(deleted).toBe(false);
    });
  });

  describe('setEntry()', () => {
    test('should set entry and log operation', () => {
      manager.beginTransaction();

      const set = manager.setEntry('key1', 'value1', 'test set');

      expect(set).toBe(true);
      expect(map.get('key1')).toBe('value1');
    });
  });

  describe('commitTransaction()', () => {
    test('should successfully commit transaction', () => {
      map.set('key1', 'value1');
      manager.beginTransaction();
      manager.deleteEntry('key1', 'test');
      manager.setEntry('key2', 'value2', 'test');

      const result = manager.commitTransaction();

      expect(result.success).toBe(true);
      expect(manager.isInTransaction()).toBe(false);
    });

    test('should validate expected size if provided', () => {
      map.set('key1', 'value1');
      manager.beginTransaction();

      const result = manager.commitTransaction({ expectedSize: 999 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Size mismatch');
    });

    test('should return error if no active transaction', () => {
      const result = manager.commitTransaction();

      expect(result.success).toBe(false);
    });
  });

  describe('rollbackTransaction()', () => {
    test('should restore Map to snapshot state', async () => {
      map.set('key1', 'value1');
      manager.beginTransaction();
      manager.deleteEntry('key1', 'test');
      manager.setEntry('key2', 'value2', 'test');

      const rolled = await manager.rollbackTransaction();

      expect(rolled).toBe(true);
      expect(map.has('key1')).toBe(true);
      expect(map.has('key2')).toBe(false);
    });

    test('should return false if no active transaction', async () => {
      const rolled = await manager.rollbackTransaction();

      expect(rolled).toBe(false);
    });
  });

  describe('directDelete()', () => {
    test('should delete without transaction', () => {
      map.set('key1', 'value1');

      const deleted = manager.directDelete('key1', 'test');

      expect(deleted).toBe(true);
      expect(map.has('key1')).toBe(false);
    });

    test('should be blocked when transaction is active', () => {
      map.set('key1', 'value1');
      manager.beginTransaction();

      const deleted = manager.directDelete('key1', 'test');

      expect(deleted).toBe(false);
      expect(map.has('key1')).toBe(true);
    });
  });

  describe('directSet()', () => {
    test('should set without transaction', () => {
      const set = manager.directSet('key1', 'value1', 'test');

      expect(set).toBe(true);
      expect(map.get('key1')).toBe('value1');
    });

    test('should be blocked when transaction is active', () => {
      manager.beginTransaction();

      const set = manager.directSet('key1', 'value1', 'test');

      expect(set).toBe(false);
    });
  });

  describe('directClear()', () => {
    test('should clear without transaction', () => {
      map.set('key1', 'value1');
      map.set('key2', 'value2');

      const cleared = manager.directClear('test clear');

      expect(cleared).toBe(true);
      expect(map.size).toBe(0);
    });

    test('should be blocked when transaction is active', () => {
      map.set('key1', 'value1');
      manager.beginTransaction();

      const cleared = manager.directClear('test');

      expect(cleared).toBe(false);
      expect(map.size).toBe(1);
    });
  });

  describe('has() and get()', () => {
    test('should delegate to underlying Map', () => {
      map.set('key1', 'value1');

      expect(manager.has('key1')).toBe(true);
      expect(manager.get('key1')).toBe('value1');
      expect(manager.has('nonexistent')).toBe(false);
    });
  });

  describe('getStats()', () => {
    test('should return transaction statistics', () => {
      map.set('key1', 'value1');
      manager.beginTransaction();

      const stats = manager.getStats();

      expect(stats.mapName).toBe('testMap');
      expect(stats.mapSize).toBe(1);
      expect(stats.inTransaction).toBe(true);
      expect(stats.locked).toBe(true);
    });
  });
});
