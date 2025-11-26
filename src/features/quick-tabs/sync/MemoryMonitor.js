/**
 * MemoryMonitor - Early Leak Detection (Layer 6)
 * Monitors memory usage and warns if thresholds exceeded
 *
 * v1.6.2.1 - NEW: Memory leak prevention layer
 *
 * Features:
 * - Monitors JS heap usage
 * - Warning threshold (default: 100MB)
 * - Critical threshold (default: 200MB)
 * - Emits 'memory-critical' event when exceeded
 *
 * Note: Only works in Chrome (performance.memory API)
 *
 * @version 1.6.2.1
 */

export class MemoryMonitor {
  /**
   * @param {Object} options - Configuration options
   * @param {number} options.warningThresholdMB - Warning threshold in MB (default: 100)
   * @param {number} options.criticalThresholdMB - Critical threshold in MB (default: 200)
   * @param {number} options.checkIntervalMs - Check interval in ms (default: 10000)
   */
  constructor(options = {}) {
    this.warningThresholdMB = options.warningThresholdMB || 100;
    this.criticalThresholdMB = options.criticalThresholdMB || 200;
    this.checkIntervalMs = options.checkIntervalMs || 10000; // 10 seconds

    // State
    this.baseline = null;
    this.lastCheck = 0;
    this.warningCount = 0;
    this.monitorInterval = null;
    this._stopped = false;

    // Event listeners for cleanup
    this._listeners = [];

    // Start monitoring
    this._startMonitoring();
  }

  /**
   * Start memory monitoring
   * @private
   */
  _startMonitoring() {
    // Check if performance.memory is available (Chrome only)
    if (typeof window === 'undefined' || !window.performance?.memory) {
      console.warn('[MemoryMonitor] performance.memory not available (Chrome only)');
      return;
    }

    // Set baseline on first check
    this.baseline = this._getMemoryUsageMB();

    // Periodic monitoring
    this.monitorInterval = setInterval(() => {
      if (!this._stopped) {
        this._checkMemory();
      }
    }, this.checkIntervalMs);

    console.log(`[MemoryMonitor] Started monitoring (baseline: ${this.baseline.toFixed(2)}MB)`);
  }

  /**
   * Get current memory usage in MB
   * @private
   * @returns {number} Memory usage in MB
   */
  _getMemoryUsageMB() {
    if (typeof window === 'undefined' || !window.performance?.memory) {
      return 0;
    }

    return window.performance.memory.usedJSHeapSize / (1024 * 1024);
  }

  /**
   * Check memory usage against thresholds
   * @private
   */
  _checkMemory() {
    if (this._stopped) return;

    const currentMB = this._getMemoryUsageMB();
    const growthMB = currentMB - this.baseline;

    if (growthMB > this.warningThresholdMB) {
      this._handleWarningThreshold(growthMB, currentMB);
    } else if (this.warningCount > 0) {
      this._handleNormalMemory(currentMB);
    }
  }

  /**
   * Handle memory above warning threshold
   * @private
   * @param {number} growthMB - Memory growth in MB
   * @param {number} currentMB - Current memory in MB
   */
  _handleWarningThreshold(growthMB, currentMB) {
    this.warningCount++;
    console.warn(`[MemoryMonitor] Memory growth: ${growthMB.toFixed(2)}MB above baseline`);

    // Layer 6B: Critical threshold
    if (growthMB > this.criticalThresholdMB) {
      this._handleCriticalThreshold(growthMB, currentMB);
    }
  }

  /**
   * Handle memory above critical threshold
   * @private
   * @param {number} growthMB - Memory growth in MB
   * @param {number} currentMB - Current memory in MB
   */
  _handleCriticalThreshold(growthMB, currentMB) {
    console.error(
      `[MemoryMonitor] CRITICAL: Memory growth ${growthMB.toFixed(2)}MB exceeds critical threshold`
    );

    // Emit event for emergency cleanup
    this._emitCriticalEvent(currentMB, growthMB);

    // Log detailed info
    this._logDetailedMemoryInfo();
  }

  /**
   * Emit memory-critical event
   * @private
   * @param {number} currentMB - Current memory in MB
   * @param {number} growthMB - Memory growth in MB
   */
  _emitCriticalEvent(currentMB, growthMB) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('memory-critical', {
          detail: { currentMB, growthMB, baseline: this.baseline }
        })
      );
    }
  }

  /**
   * Handle memory returned to normal
   * @private
   * @param {number} currentMB - Current memory in MB
   */
  _handleNormalMemory(currentMB) {
    console.log(`[MemoryMonitor] Memory returned to normal: ${currentMB.toFixed(2)}MB`);
    this.warningCount = 0;
  }

  /**
   * Log detailed memory information
   * @private
   */
  _logDetailedMemoryInfo() {
    if (typeof window === 'undefined' || !window.performance?.memory) return;

    const mem = window.performance.memory;
    console.log('[MemoryMonitor] Detailed memory info:', {
      usedMB: (mem.usedJSHeapSize / (1024 * 1024)).toFixed(2),
      totalMB: (mem.totalJSHeapSize / (1024 * 1024)).toFixed(2),
      limitMB: (mem.jsHeapSizeLimit / (1024 * 1024)).toFixed(2),
      baselineMB: this.baseline.toFixed(2),
      growthMB: (mem.usedJSHeapSize / (1024 * 1024) - this.baseline).toFixed(2)
    });
  }

  /**
   * Get current memory statistics
   * @returns {Object} Memory statistics
   */
  getStats() {
    const currentMB = this._getMemoryUsageMB();
    return {
      currentMB,
      baseline: this.baseline,
      growthMB: currentMB - (this.baseline || 0),
      warningThresholdMB: this.warningThresholdMB,
      criticalThresholdMB: this.criticalThresholdMB,
      warningCount: this.warningCount
    };
  }

  /**
   * Reset baseline to current memory usage
   */
  resetBaseline() {
    this.baseline = this._getMemoryUsageMB();
    this.warningCount = 0;
    console.log(`[MemoryMonitor] Baseline reset to ${this.baseline.toFixed(2)}MB`);
  }

  /**
   * Stop memory monitoring
   */
  stop() {
    this._stopped = true;

    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }

    console.log('[MemoryMonitor] Stopped monitoring');
  }

  /**
   * Check if monitoring is active
   * @returns {boolean}
   */
  isActive() {
    return !this._stopped && this.monitorInterval !== null;
  }
}
