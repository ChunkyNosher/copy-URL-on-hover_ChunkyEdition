/**
 * Unit Tests for MemoryGuard
 * 
 * Tests the emergency shutdown mechanism that monitors JS heap memory
 * and triggers shutdown when thresholds are exceeded.
 * 
 * Part of memory leak fix - see: docs/manual/v1.6.0/quick-tab-memory-leak-catastrophic-analysis.md
 */

import { MemoryGuard } from '../../../src/features/quick-tabs/guards/MemoryGuard.js';

describe('MemoryGuard', () => {
  let memoryGuard;
  let mockEventBus;

  beforeEach(() => {
    mockEventBus = {
      emit: jest.fn()
    };
    
    memoryGuard = new MemoryGuard({
      eventBus: mockEventBus,
      extensionThresholdMB: 100, // Lower threshold for testing
      browserThresholdMB: 500,
      checkIntervalMs: 100
    });
  });

  afterEach(() => {
    memoryGuard.stopMonitoring();
    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with default values', () => {
      const defaultGuard = new MemoryGuard();
      
      expect(defaultGuard.extensionThresholdMB).toBe(1000);
      expect(defaultGuard.browserThresholdMB).toBe(20000);
      expect(defaultGuard.checkIntervalMs).toBe(1000);
      expect(defaultGuard.isMonitoring).toBe(false);
      expect(defaultGuard.shutdownTriggered).toBe(false);
    });

    it('should accept custom options', () => {
      expect(memoryGuard.extensionThresholdMB).toBe(100);
      expect(memoryGuard.browserThresholdMB).toBe(500);
      expect(memoryGuard.checkIntervalMs).toBe(100);
      expect(memoryGuard.eventBus).toBe(mockEventBus);
    });

    it('should detect performance.memory availability', () => {
      // The hasPerformanceMemory flag should be set based on environment
      expect(typeof memoryGuard.hasPerformanceMemory).toBe('boolean');
    });
  });

  describe('startMonitoring', () => {
    it('should start monitoring', () => {
      const _result = memoryGuard.startMonitoring();
      
      // In test environment, performance.memory may not be available
      // so result could be true or false
      expect(memoryGuard.isMonitoring).toBe(true);
    });

    it('should not start if already monitoring', () => {
      memoryGuard.startMonitoring();
      const result = memoryGuard.startMonitoring();
      
      expect(result).toBe(false);
    });
  });

  describe('stopMonitoring', () => {
    it('should stop monitoring', () => {
      memoryGuard.startMonitoring();
      memoryGuard.stopMonitoring();
      
      expect(memoryGuard.isMonitoring).toBe(false);
      expect(memoryGuard.monitoringInterval).toBeNull();
    });

    it('should be safe to call when not monitoring', () => {
      expect(() => memoryGuard.stopMonitoring()).not.toThrow();
    });
  });

  describe('checkMemoryLimits', () => {
    it('should return not exceeded when memory API unavailable', () => {
      // Force memory API to be unavailable
      memoryGuard.hasPerformanceMemory = false;
      
      const result = memoryGuard.checkMemoryLimits();
      
      expect(result.exceeded).toBe(false);
      expect(result.reason).toBe('Memory API not available');
    });

    it('should increment checkCount on each call', () => {
      // When hasPerformanceMemory is false, checkMemoryLimits returns early
      // We need to mock performance.memory or test differently
      
      // First set hasPerformanceMemory to true to enable counting
      memoryGuard.hasPerformanceMemory = true;
      
      // Mock performance.memory
      const originalPerformance = global.performance;
      global.performance = {
        ...originalPerformance,
        memory: {
          usedJSHeapSize: 50 * 1024 * 1024, // 50MB
          totalJSHeapSize: 100 * 1024 * 1024, // 100MB
          jsHeapSizeLimit: 500 * 1024 * 1024 // 500MB
        }
      };
      
      memoryGuard.checkMemoryLimits();
      memoryGuard.checkMemoryLimits();
      memoryGuard.checkMemoryLimits();
      
      expect(memoryGuard.checkCount).toBe(3);
      
      // Restore
      global.performance = originalPerformance;
    });

    it('should update lastCheckTime', () => {
      // First set hasPerformanceMemory to true
      memoryGuard.hasPerformanceMemory = true;
      
      // Mock performance.memory
      const originalPerformance = global.performance;
      global.performance = {
        ...originalPerformance,
        memory: {
          usedJSHeapSize: 50 * 1024 * 1024, // 50MB
          totalJSHeapSize: 100 * 1024 * 1024, // 100MB
          jsHeapSizeLimit: 500 * 1024 * 1024 // 500MB
        }
      };
      
      const before = Date.now();
      
      memoryGuard.checkMemoryLimits();
      
      expect(memoryGuard.lastCheckTime).toBeGreaterThanOrEqual(before);
      
      // Restore
      global.performance = originalPerformance;
    });
  });

  describe('triggerEmergencyShutdown', () => {
    it('should trigger shutdown and emit event', () => {
      memoryGuard.triggerEmergencyShutdown('Test reason', 999);
      
      expect(memoryGuard.shutdownTriggered).toBe(true);
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'memory:emergency-shutdown',
        expect.objectContaining({
          reason: 'Test reason',
          memoryMB: 999
        })
      );
    });

    it('should only trigger once', () => {
      memoryGuard.triggerEmergencyShutdown('First', 100);
      memoryGuard.triggerEmergencyShutdown('Second', 200);
      
      expect(mockEventBus.emit).toHaveBeenCalledTimes(1);
    });

    it('should call custom callback if set', () => {
      const callback = jest.fn();
      memoryGuard.onEmergencyShutdown = callback;
      
      memoryGuard.triggerEmergencyShutdown('Test', 500);
      
      expect(callback).toHaveBeenCalledWith('Test', 500);
    });

    it('should stop monitoring after shutdown', () => {
      memoryGuard.startMonitoring();
      memoryGuard.triggerEmergencyShutdown('Test', 500);
      
      expect(memoryGuard.isMonitoring).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return current statistics', () => {
      memoryGuard.startMonitoring();
      memoryGuard.checkCount = 10;
      memoryGuard.warningCount = 2;
      memoryGuard.peakMemoryMB = 75.5;
      
      const stats = memoryGuard.getStats();
      
      expect(stats).toEqual({
        isMonitoring: true,
        hasPerformanceMemory: expect.any(Boolean),
        checkCount: 10,
        warningCount: 2,
        peakMemoryMB: 75.5,
        shutdownTriggered: false,
        lastCheckTime: expect.any(Number),
        extensionThresholdMB: 100,
        browserThresholdMB: 500
      });
    });
  });

  describe('resetStats', () => {
    it('should reset all statistics', () => {
      memoryGuard.checkCount = 100;
      memoryGuard.warningCount = 50;
      memoryGuard.peakMemoryMB = 999;
      memoryGuard.shutdownTriggered = true;
      memoryGuard.lastCheckTime = 1234567890;
      
      memoryGuard.resetStats();
      
      expect(memoryGuard.checkCount).toBe(0);
      expect(memoryGuard.warningCount).toBe(0);
      expect(memoryGuard.peakMemoryMB).toBe(0);
      expect(memoryGuard.shutdownTriggered).toBe(false);
      expect(memoryGuard.lastCheckTime).toBe(0);
    });
  });
});
