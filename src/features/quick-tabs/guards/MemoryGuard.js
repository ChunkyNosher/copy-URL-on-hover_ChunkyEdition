/**
 * MemoryGuard - Emergency shutdown mechanism for Quick Tab system
 *
 * Monitors JS heap memory usage and triggers emergency shutdown
 * when memory thresholds are exceeded to prevent browser freeze.
 *
 * Created to fix catastrophic memory leak in broadcast history persistence.
 * See: docs/manual/v1.6.0/quick-tab-memory-leak-catastrophic-analysis.md
 */

export class MemoryGuard {
  /**
   * Create a new MemoryGuard instance
   * @param {Object} options - Configuration options
   * @param {Object} options.eventBus - Event bus for emitting events
   * @param {number} options.extensionThresholdMB - Extension memory threshold (default: 1000MB)
   * @param {number} options.browserThresholdMB - Browser memory threshold (default: 20000MB)
   * @param {number} options.checkIntervalMs - Memory check interval (default: 1000ms)
   */
  constructor(options = {}) {
    this.eventBus = options.eventBus || null;
    this.extensionThresholdMB = options.extensionThresholdMB || 1000;
    this.browserThresholdMB = options.browserThresholdMB || 20000;
    this.checkIntervalMs = options.checkIntervalMs || 1000;

    // Internal state
    this.monitoringInterval = null;
    this.isMonitoring = false;
    this.lastCheckTime = 0;
    this.peakMemoryMB = 0;
    this.checkCount = 0;
    this.warningCount = 0;
    this.shutdownTriggered = false;

    // Memory API availability
    this.hasPerformanceMemory =
      typeof performance !== 'undefined' && performance.memory !== undefined;

    // Callbacks for custom shutdown logic
    this.onEmergencyShutdown = null;
  }

  /**
   * Start memory monitoring
   * @returns {boolean} True if monitoring started successfully
   */
  startMonitoring() {
    if (this.isMonitoring) {
      console.log('[MemoryGuard] Already monitoring');
      return false;
    }

    if (!this.hasPerformanceMemory) {
      console.warn('[MemoryGuard] performance.memory not available, monitoring disabled');
      // Still set isMonitoring to true to prevent repeated start attempts
      this.isMonitoring = true;
      return false;
    }

    console.log('[MemoryGuard] Starting memory monitoring', {
      extensionThresholdMB: this.extensionThresholdMB,
      browserThresholdMB: this.browserThresholdMB,
      checkIntervalMs: this.checkIntervalMs
    });

    this.isMonitoring = true;
    this.shutdownTriggered = false;

    this.monitoringInterval = setInterval(() => {
      this.checkMemoryLimits();
    }, this.checkIntervalMs);

    return true;
  }

  /**
   * Stop memory monitoring
   */
  stopMonitoring() {
    if (!this.isMonitoring) {
      return;
    }

    console.log('[MemoryGuard] Stopping memory monitoring');

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    this.isMonitoring = false;
  }

  /**
   * Check current memory usage against thresholds
   * @returns {Object} Memory status with exceeded flag
   */
  checkMemoryLimits() {
    if (!this.hasPerformanceMemory) {
      return { exceeded: false, reason: 'Memory API not available' };
    }

    this.checkCount++;
    this.lastCheckTime = Date.now();

    try {
      const memory = performance.memory;
      const usedHeapMB = memory.usedJSHeapSize / (1024 * 1024);
      const totalHeapMB = memory.totalJSHeapSize / (1024 * 1024);
      const limitMB = memory.jsHeapSizeLimit / (1024 * 1024);

      // Track peak memory
      if (usedHeapMB > this.peakMemoryMB) {
        this.peakMemoryMB = usedHeapMB;
      }

      // Check extension threshold
      if (usedHeapMB > this.extensionThresholdMB) {
        this.warningCount++;
        console.warn('[MemoryGuard] Extension memory threshold exceeded!', {
          usedMB: usedHeapMB.toFixed(2),
          thresholdMB: this.extensionThresholdMB,
          warningCount: this.warningCount
        });

        this.triggerEmergencyShutdown('Extension memory threshold exceeded', usedHeapMB);
        return { exceeded: true, reason: 'extension_threshold', memoryMB: usedHeapMB };
      }

      // Check browser threshold (less common but possible)
      if (totalHeapMB > this.browserThresholdMB) {
        this.warningCount++;
        console.warn('[MemoryGuard] Browser memory threshold exceeded!', {
          totalMB: totalHeapMB.toFixed(2),
          thresholdMB: this.browserThresholdMB,
          warningCount: this.warningCount
        });

        this.triggerEmergencyShutdown('Browser memory threshold exceeded', totalHeapMB);
        return { exceeded: true, reason: 'browser_threshold', memoryMB: totalHeapMB };
      }

      // Log periodic status (every 60 checks / ~1 minute at default interval)
      if (this.checkCount % 60 === 0) {
        console.log('[MemoryGuard] Memory status', {
          usedMB: usedHeapMB.toFixed(2),
          totalMB: totalHeapMB.toFixed(2),
          limitMB: limitMB.toFixed(2),
          peakMB: this.peakMemoryMB.toFixed(2),
          checkCount: this.checkCount
        });
      }

      return { exceeded: false, memoryMB: usedHeapMB };
    } catch (error) {
      console.error('[MemoryGuard] Error checking memory:', error);
      return { exceeded: false, error: error.message };
    }
  }

  /**
   * Trigger emergency shutdown
   * @param {string} reason - Reason for shutdown
   * @param {number} memoryMB - Current memory usage in MB
   */
  triggerEmergencyShutdown(reason, memoryMB) {
    if (this.shutdownTriggered) {
      console.log('[MemoryGuard] Emergency shutdown already triggered, skipping');
      return;
    }

    this.shutdownTriggered = true;

    console.error('[MemoryGuard] ⚠️ EMERGENCY SHUTDOWN TRIGGERED ⚠️', {
      reason,
      memoryMB: memoryMB.toFixed(2),
      peakMB: this.peakMemoryMB.toFixed(2),
      checkCount: this.checkCount,
      warningCount: this.warningCount
    });

    // Emit event for other components to react
    if (this.eventBus) {
      this.eventBus.emit('memory:emergency-shutdown', {
        reason,
        memoryMB,
        peakMB: this.peakMemoryMB,
        timestamp: Date.now()
      });
    }

    // Call custom callback if set
    if (this.onEmergencyShutdown) {
      try {
        this.onEmergencyShutdown(reason, memoryMB);
      } catch (error) {
        console.error('[MemoryGuard] Error in emergency shutdown callback:', error);
      }
    }

    // Stop monitoring after shutdown
    this.stopMonitoring();
  }

  /**
   * Get current memory statistics
   * @returns {Object} Memory statistics
   */
  getStats() {
    return {
      isMonitoring: this.isMonitoring,
      hasPerformanceMemory: this.hasPerformanceMemory,
      checkCount: this.checkCount,
      warningCount: this.warningCount,
      peakMemoryMB: this.peakMemoryMB,
      shutdownTriggered: this.shutdownTriggered,
      lastCheckTime: this.lastCheckTime,
      extensionThresholdMB: this.extensionThresholdMB,
      browserThresholdMB: this.browserThresholdMB
    };
  }

  /**
   * Reset statistics (for testing)
   */
  resetStats() {
    this.checkCount = 0;
    this.warningCount = 0;
    this.peakMemoryMB = 0;
    this.shutdownTriggered = false;
    this.lastCheckTime = 0;
  }
}
