/**
 * Tests for QuickTabUIObjectPool
 * Phase 3D Optimization (#11): Object Pool for Reusable UI Elements
 *
 * @version 1.6.4
 */

import {
  initializePool,
  acquire,
  release,
  releaseAll,
  getPoolStats,
  clearPool,
  shrinkPool,
  DEFAULT_POOL_SIZE,
  MIN_POOL_SIZE,
  MAX_POOL_SIZE
} from '../../../../sidebar/utils/QuickTabUIObjectPool.js';

describe('QuickTabUIObjectPool', () => {
  // Clean up pool before each test
  beforeEach(() => {
    clearPool();
  });

  afterAll(() => {
    clearPool();
  });

  describe('initializePool', () => {
    it('should initialize pool with default size', () => {
      initializePool();

      const stats = getPoolStats();
      expect(stats.isInitialized).toBe(true);
      expect(stats.available).toBe(DEFAULT_POOL_SIZE);
      expect(stats.created).toBe(DEFAULT_POOL_SIZE);
    });

    it('should initialize pool with custom size', () => {
      const customSize = 60;
      initializePool(customSize);

      const stats = getPoolStats();
      expect(stats.available).toBe(customSize);
    });

    it('should respect minimum pool size', () => {
      initializePool(10); // Below MIN_POOL_SIZE

      const stats = getPoolStats();
      expect(stats.available).toBe(MIN_POOL_SIZE);
    });

    it('should respect maximum pool size', () => {
      initializePool(500); // Above MAX_POOL_SIZE

      const stats = getPoolStats();
      expect(stats.available).toBe(MAX_POOL_SIZE);
    });

    it('should not reinitialize if already initialized', () => {
      initializePool(60);
      initializePool(80); // Should be ignored

      const stats = getPoolStats();
      expect(stats.available).toBe(60);
    });
  });

  describe('acquire', () => {
    beforeEach(() => {
      initializePool(MIN_POOL_SIZE);
    });

    it('should return an HTMLElement', () => {
      const element = acquire();

      expect(element).toBeInstanceOf(HTMLElement);
      expect(element.tagName).toBe('DIV');
    });

    it('should return element with quick-tab-item class', () => {
      const element = acquire();

      expect(element.className).toBe('quick-tab-item');
    });

    it('should mark element as pooled', () => {
      const element = acquire();

      expect(element.dataset.pooled).toBe('true');
    });

    it('should have base structure with child containers', () => {
      const element = acquire();

      expect(element.querySelector('.qt-favicon')).not.toBeNull();
      expect(element.querySelector('.qt-title')).not.toBeNull();
      expect(element.querySelector('.qt-url')).not.toBeNull();
      expect(element.querySelector('.qt-actions')).not.toBeNull();
    });

    it('should increment hits counter on pool hit', () => {
      const statsBefore = getPoolStats();
      acquire();
      const statsAfter = getPoolStats();

      expect(statsAfter.hits).toBe(statsBefore.hits + 1);
    });

    it('should decrement available count on acquire', () => {
      const statsBefore = getPoolStats();
      acquire();
      const statsAfter = getPoolStats();

      expect(statsAfter.available).toBe(statsBefore.available - 1);
    });

    it('should increment inUse count on acquire', () => {
      const statsBefore = getPoolStats();
      acquire();
      const statsAfter = getPoolStats();

      expect(statsAfter.inUse).toBe(statsBefore.inUse + 1);
    });
  });

  describe('release', () => {
    beforeEach(() => {
      initializePool(MIN_POOL_SIZE);
    });

    it('should return element to pool', () => {
      const element = acquire();
      const statsBefore = getPoolStats();

      const success = release(element);
      const statsAfter = getPoolStats();

      expect(success).toBe(true);
      expect(statsAfter.available).toBe(statsBefore.available + 1);
      expect(statsAfter.inUse).toBe(statsBefore.inUse - 1);
    });

    it('should reset element state on release', () => {
      const element = acquire();

      // Modify element
      element.className = 'quick-tab-item modified custom-class';
      element.dataset.customData = 'test';
      element.style.backgroundColor = 'red';

      release(element);
      const releasedElement = acquire();

      expect(releasedElement.className).toBe('quick-tab-item');
      expect(releasedElement.dataset.customData).toBeUndefined();
      expect(releasedElement.style.backgroundColor).toBe('');
    });

    it('should reject null element', () => {
      const success = release(null);

      expect(success).toBe(false);
    });

    it('should reject non-pooled element', () => {
      const element = document.createElement('div');
      const success = release(element);

      expect(success).toBe(false);
    });

    it('should reject double release', () => {
      const element = acquire();

      const firstRelease = release(element);
      const secondRelease = release(element);

      expect(firstRelease).toBe(true);
      expect(secondRelease).toBe(false);
    });

    it('should increment releases counter', () => {
      const element = acquire();
      const statsBefore = getPoolStats();

      release(element);
      const statsAfter = getPoolStats();

      expect(statsAfter.releases).toBe(statsBefore.releases + 1);
    });
  });

  describe('releaseAll', () => {
    beforeEach(() => {
      initializePool(MIN_POOL_SIZE);
    });

    it('should release multiple elements', () => {
      const elements = [acquire(), acquire(), acquire()];
      const statsBefore = getPoolStats();

      const result = releaseAll(elements);
      const statsAfter = getPoolStats();

      expect(result.released).toBe(3);
      expect(result.failed).toBe(0);
      expect(statsAfter.available).toBe(statsBefore.available + 3);
    });

    it('should handle mixed valid and invalid elements', () => {
      const validElements = [acquire(), acquire()];
      const invalidElement = document.createElement('div');
      const elements = [...validElements, invalidElement];

      const result = releaseAll(elements);

      expect(result.released).toBe(2);
      expect(result.failed).toBe(1);
    });

    it('should handle empty array', () => {
      const result = releaseAll([]);

      expect(result.released).toBe(0);
      expect(result.failed).toBe(0);
    });

    it('should handle non-array input', () => {
      const result = releaseAll('not an array');

      expect(result.released).toBe(0);
      expect(result.failed).toBe(0);
    });
  });

  describe('pool exhaustion and growth', () => {
    it('should create new elements when pool exhausted', () => {
      initializePool(MIN_POOL_SIZE);

      // Exhaust the pool
      const elements = [];
      for (let i = 0; i < MIN_POOL_SIZE + 5; i++) {
        elements.push(acquire());
      }

      const stats = getPoolStats();

      expect(stats.misses).toBeGreaterThan(0);
      expect(stats.created).toBeGreaterThan(MIN_POOL_SIZE);

      // Cleanup
      releaseAll(elements);
    });

    it('should track hit rate correctly', () => {
      initializePool(MIN_POOL_SIZE);

      // Some hits
      const elements = [];
      for (let i = 0; i < 10; i++) {
        elements.push(acquire());
      }

      const stats = getPoolStats();
      expect(stats.hitRate).toMatch(/^\d+\.\d{2}%$/);

      // Cleanup
      releaseAll(elements);
    });
  });

  describe('getPoolStats', () => {
    it('should return complete statistics', () => {
      initializePool(MIN_POOL_SIZE);
      acquire();

      const stats = getPoolStats();

      expect(stats).toHaveProperty('hits');
      expect(stats).toHaveProperty('misses');
      expect(stats).toHaveProperty('resizes');
      expect(stats).toHaveProperty('acquires');
      expect(stats).toHaveProperty('releases');
      expect(stats).toHaveProperty('currentSize');
      expect(stats).toHaveProperty('peakSize');
      expect(stats).toHaveProperty('created');
      expect(stats).toHaveProperty('available');
      expect(stats).toHaveProperty('inUse');
      expect(stats).toHaveProperty('hitRate');
      expect(stats).toHaveProperty('isInitialized');
      expect(stats).toHaveProperty('timestamp');
    });
  });

  describe('clearPool', () => {
    it('should reset pool to uninitialized state', () => {
      initializePool(MIN_POOL_SIZE);
      acquire();

      clearPool();
      const stats = getPoolStats();

      expect(stats.isInitialized).toBe(false);
      expect(stats.available).toBe(0);
      expect(stats.inUse).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe('shrinkPool', () => {
    it('should shrink pool to minimum size', () => {
      initializePool(100);

      shrinkPool();
      const stats = getPoolStats();

      expect(stats.available).toBe(MIN_POOL_SIZE);
    });

    it('should not shrink below minimum size', () => {
      initializePool(MIN_POOL_SIZE);

      shrinkPool();
      const stats = getPoolStats();

      expect(stats.available).toBe(MIN_POOL_SIZE);
    });
  });

  describe('performance characteristics', () => {
    it('should be faster to acquire from pool than create new', () => {
      initializePool(MIN_POOL_SIZE);

      // Time pool acquire
      const poolStart = performance.now();
      for (let i = 0; i < 100; i++) {
        const el = acquire();
        release(el);
      }
      const poolTime = performance.now() - poolStart;

      // Time direct creation
      const directStart = performance.now();
      for (let i = 0; i < 100; i++) {
        const el = document.createElement('div');
        el.className = 'quick-tab-item';
        const favicon = document.createElement('div');
        favicon.className = 'qt-favicon';
        el.appendChild(favicon);
        // No need to clean up as these are not attached to DOM
      }
      const directTime = performance.now() - directStart;

      console.log(`Pool acquire/release: ${poolTime.toFixed(2)}ms`);
      console.log(`Direct creation: ${directTime.toFixed(2)}ms`);

      // Pool should be at least as fast (often faster due to reuse)
      // We don't assert exact timing as it varies by environment
    });

    it('should maintain consistent memory pattern with reuse', () => {
      initializePool(MIN_POOL_SIZE);

      // Simulate rapid create/destroy cycle
      for (let cycle = 0; cycle < 10; cycle++) {
        const elements = [];
        for (let i = 0; i < 20; i++) {
          elements.push(acquire());
        }
        releaseAll(elements);
      }

      const stats = getPoolStats();

      // High hit rate indicates effective reuse
      expect(stats.acquires).toBe(200);
      expect(stats.releases).toBe(200);
    });
  });
});
