/**
 * @fileoverview Unit tests for LRUMapGuard
 * v1.6.3.10-v11 - FIX Issue #21: Test LRU eviction and map size monitoring
 */

import {
  LRUMapGuard,
  MAX_MAP_SIZE,
  EVICTION_PERCENT,
  STALE_ENTRY_AGE_MS,
  CLEANUP_INTERVAL_MS
} from '../../../src/utils/lru-map-guard.js';

describe('LRUMapGuard', () => {
  let targetMap;
  let guard;

  beforeEach(() => {
    targetMap = new Map();
    guard = new LRUMapGuard(targetMap, {
      maxSize: 10,
      evictionPercent: 0.2, // 20% = 2 entries
      staleAgeMs: 1000, // 1 second for testing
      cleanupIntervalMs: 100,
      logPrefix: '[Test]'
    });
  });

  afterEach(() => {
    guard.destroy();
  });

  describe('Constants', () => {
    it('should export default constants', () => {
      expect(MAX_MAP_SIZE).toBe(500);
      expect(EVICTION_PERCENT).toBe(0.1);
      expect(STALE_ENTRY_AGE_MS).toBe(24 * 60 * 60 * 1000);
      expect(CLEANUP_INTERVAL_MS).toBe(30 * 1000);
    });
  });

  describe('Constructor', () => {
    it('should initialize with target map', () => {
      expect(guard._targetMap).toBe(targetMap);
    });

    it('should accept custom options', () => {
      expect(guard._maxSize).toBe(10);
      expect(guard._evictionPercent).toBe(0.2);
      expect(guard._staleAgeMs).toBe(1000);
      expect(guard._logPrefix).toBe('[Test]');
    });

    it('should initialize access times map', () => {
      expect(guard._accessTimes).toBeInstanceOf(Map);
      expect(guard._accessTimes.size).toBe(0);
    });

    it('should not be destroyed initially', () => {
      expect(guard._isDestroyed).toBe(false);
    });
  });

  describe('trackAccess', () => {
    it('should record access time for key', () => {
      const before = Date.now();
      guard.trackAccess('qt-1');
      const after = Date.now();

      const accessTime = guard._accessTimes.get('qt-1');
      expect(accessTime).toBeGreaterThanOrEqual(before);
      expect(accessTime).toBeLessThanOrEqual(after);
    });

    it('should update access time on subsequent calls', async () => {
      guard.trackAccess('qt-1');
      const firstAccess = guard._accessTimes.get('qt-1');

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10));

      guard.trackAccess('qt-1');
      const secondAccess = guard._accessTimes.get('qt-1');

      expect(secondAccess).toBeGreaterThan(firstAccess);
    });

    it('should not track after destroy', () => {
      guard.destroy();
      guard.trackAccess('qt-1');
      expect(guard._accessTimes.has('qt-1')).toBe(false);
    });
  });

  describe('recordCreation', () => {
    it('should be alias for trackAccess', () => {
      guard.recordCreation('qt-1');
      expect(guard._accessTimes.has('qt-1')).toBe(true);
    });
  });

  describe('recordDeletion', () => {
    it('should remove access time for key', () => {
      guard.trackAccess('qt-1');
      expect(guard._accessTimes.has('qt-1')).toBe(true);

      guard.recordDeletion('qt-1');
      expect(guard._accessTimes.has('qt-1')).toBe(false);
    });

    it('should not throw for non-existent key', () => {
      expect(() => guard.recordDeletion('qt-nonexistent')).not.toThrow();
    });
  });

  describe('checkAndEvict', () => {
    it('should not evict when below threshold', () => {
      // Add 5 entries (below max of 10)
      for (let i = 0; i < 5; i++) {
        targetMap.set(`qt-${i}`, { id: `qt-${i}` });
        guard.trackAccess(`qt-${i}`);
      }

      const result = guard.checkAndEvict();
      expect(result.evicted).toBe(false);
      expect(result.evictedCount).toBe(0);
      expect(targetMap.size).toBe(5);
    });

    it('should evict when above threshold (110%)', () => {
      // Add 11 entries (110% of max 10)
      for (let i = 0; i < 11; i++) {
        targetMap.set(`qt-${i}`, { id: `qt-${i}` });
        guard.trackAccess(`qt-${i}`);
      }

      const result = guard.checkAndEvict();
      expect(result.evicted).toBe(true);
      // Should evict 20% of 10 = 2 entries
      expect(result.evictedCount).toBe(2);
      expect(targetMap.size).toBe(9);
    });

    it('should evict oldest entries first (LRU)', async () => {
      // Add entries with staggered access times
      targetMap.set('qt-old-1', { id: 'qt-old-1' });
      guard.trackAccess('qt-old-1');

      await new Promise(resolve => setTimeout(resolve, 5));

      targetMap.set('qt-old-2', { id: 'qt-old-2' });
      guard.trackAccess('qt-old-2');

      await new Promise(resolve => setTimeout(resolve, 5));

      // Add remaining entries
      for (let i = 3; i <= 11; i++) {
        targetMap.set(`qt-${i}`, { id: `qt-${i}` });
        guard.trackAccess(`qt-${i}`);
      }

      const result = guard.checkAndEvict();

      // Oldest entries (qt-old-1, qt-old-2) should be evicted
      expect(result.evictedIds).toContain('qt-old-1');
      expect(result.evictedIds).toContain('qt-old-2');
      expect(targetMap.has('qt-old-1')).toBe(false);
      expect(targetMap.has('qt-old-2')).toBe(false);
    });

    it('should return empty result after destroy', () => {
      guard.destroy();
      const result = guard.checkAndEvict();
      expect(result.evicted).toBe(false);
      expect(result.evictedCount).toBe(0);
    });
  });

  describe('cleanupStaleEntries', () => {
    it('should remove stale entries', async () => {
      targetMap.set('qt-stale', { id: 'qt-stale' });
      guard.trackAccess('qt-stale');

      // Wait for entry to become stale (1 second + buffer)
      await new Promise(resolve => setTimeout(resolve, 1100));

      targetMap.set('qt-fresh', { id: 'qt-fresh' });
      guard.trackAccess('qt-fresh');

      const result = guard.cleanupStaleEntries({});

      expect(result.cleanedIds).toContain('qt-stale');
      expect(result.cleanedIds).not.toContain('qt-fresh');
      expect(targetMap.has('qt-stale')).toBe(false);
      expect(targetMap.has('qt-fresh')).toBe(true);
    });

    it('should remove closed entries via isClosedChecker', () => {
      targetMap.set('qt-closed', { id: 'qt-closed', minimizeState: 'closed' });
      guard.trackAccess('qt-closed');

      targetMap.set('qt-open', { id: 'qt-open', minimizeState: 'open' });
      guard.trackAccess('qt-open');

      const result = guard.cleanupStaleEntries({
        isClosedChecker: (_key, entry) => entry.minimizeState === 'closed'
      });

      expect(result.cleanedIds).toContain('qt-closed');
      expect(result.cleanedIds).not.toContain('qt-open');
    });

    it('should return empty result after destroy', () => {
      guard.destroy();
      const result = guard.cleanupStaleEntries({});
      expect(result.cleaned).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return statistics about the map', () => {
      targetMap.set('qt-1', { id: 'qt-1' });
      targetMap.set('qt-2', { id: 'qt-2' });
      guard.trackAccess('qt-1');
      guard.trackAccess('qt-2');

      const stats = guard.getStats();

      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(10);
      expect(stats.trackedCount).toBe(2);
      expect(stats.percentFull).toBe('20.0');
    });

    it('should handle empty map', () => {
      const stats = guard.getStats();

      expect(stats.size).toBe(0);
      expect(stats.percentFull).toBe('0.0');
    });
  });

  describe('estimateMemoryBytes', () => {
    it('should estimate memory usage', () => {
      targetMap.set('qt-1', { id: 'qt-1' });
      targetMap.set('qt-2', { id: 'qt-2' });

      const bytes = guard.estimateMemoryBytes();

      // 2 entries * 500 bytes = 1000 bytes
      expect(bytes).toBe(1000);
    });
  });

  describe('startPeriodicCleanup / stopPeriodicCleanup', () => {
    it('should start cleanup timer', () => {
      guard.startPeriodicCleanup({});
      expect(guard._cleanupTimerId).not.toBeNull();
    });

    it('should stop cleanup timer', () => {
      guard.startPeriodicCleanup({});
      guard.stopPeriodicCleanup();
      expect(guard._cleanupTimerId).toBeNull();
    });

    it('should not start after destroy', () => {
      guard.destroy();
      guard.startPeriodicCleanup({});
      expect(guard._cleanupTimerId).toBeNull();
    });
  });

  describe('destroy', () => {
    it('should mark guard as destroyed', () => {
      guard.destroy();
      expect(guard._isDestroyed).toBe(true);
    });

    it('should stop periodic cleanup', () => {
      guard.startPeriodicCleanup({});
      guard.destroy();
      expect(guard._cleanupTimerId).toBeNull();
    });

    it('should clear access times', () => {
      guard.trackAccess('qt-1');
      guard.destroy();
      expect(guard._accessTimes.size).toBe(0);
    });

    it('should be idempotent', () => {
      guard.destroy();
      expect(() => guard.destroy()).not.toThrow();
    });
  });
});
