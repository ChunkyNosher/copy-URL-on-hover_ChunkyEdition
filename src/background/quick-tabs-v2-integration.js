// Quick Tabs V2 Integration Module
// Integrates all v2 architecture components for the background script
// v1.6.3.8-v12: GAP-1, GAP-10 fix - Feature flag check before initialization

import { getBroadcastMetrics, resetBroadcastMetrics } from './broadcast-manager.js';
import { initializeMessageHandler, storageManager } from './message-handler.js';
import { initializeQuickTabsStorage, getMigrationStatus } from './quick-tabs-initialization.js';
import * as SchemaV2 from '../storage/schema-v2.js';

let isInitialized = false;
let initializationPromise = null;
// v1.6.3.8-v12 GAP-1: Track which architecture path was taken
let activeArchitecture = 'unknown';

/**
 * Initialize Quick Tabs v2 architecture
 * Call this from background.js on extension startup
 * v1.6.3.8-v12 GAP-1, GAP-10 fix: Check feature flag before initialization
 */
export function initializeQuickTabsV2() {
  // Prevent multiple initializations
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = _doInitialize();
  return initializationPromise;
}

/**
 * Bootstrap Quick Tabs architecture - checks feature flag first
 * v1.6.3.8-v12 GAP-1, GAP-10 fix: Entry point that checks isV2Enabled()
 * Call this from background.js on extension load
 */
export async function bootstrapQuickTabs() {
  const bootstrapStartTime = Date.now();
  console.log('[QuickTabsV2] BOOTSTRAP_START:', {
    timestamp: bootstrapStartTime
  });

  try {
    // GAP-1 Fix: Check feature flag before initialization
    const v2Enabled = await isV2Enabled();

    console.log('[QuickTabsV2] BOOTSTRAP_FLAG_CHECK:', {
      v2Enabled,
      timestamp: Date.now()
    });

    if (v2Enabled) {
      // Initialize v2 architecture
      activeArchitecture = 'v2';
      console.log('[QuickTabsV2] BOOTSTRAP_PATH: Initializing v2 architecture');
      const result = await initializeQuickTabsV2();

      console.log('[QuickTabsV2] BOOTSTRAP_COMPLETE:', {
        architecture: 'v2',
        success: result.success,
        duration: Date.now() - bootstrapStartTime
      });

      return {
        ...result,
        architecture: 'v2'
      };
    } else {
      // v1 fallback - maintain legacy systems
      activeArchitecture = 'v1';
      console.log('[QuickTabsV2] BOOTSTRAP_PATH: v2 disabled, maintaining v1 fallback');

      // Still initialize message handler for basic communication
      initializeMessageHandler();
      console.log('[QuickTabsV2] v1 fallback: Message handler initialized');

      console.log('[QuickTabsV2] BOOTSTRAP_COMPLETE:', {
        architecture: 'v1',
        success: true,
        duration: Date.now() - bootstrapStartTime
      });

      return {
        success: true,
        architecture: 'v1',
        duration: Date.now() - bootstrapStartTime
      };
    }
  } catch (error) {
    console.error('[QuickTabsV2] BOOTSTRAP_FAILED:', {
      error: error.message,
      duration: Date.now() - bootstrapStartTime
    });

    return {
      success: false,
      architecture: 'error',
      error: error.message
    };
  }
}

/**
 * Get active architecture ('v1', 'v2', or 'unknown')
 * v1.6.3.8-v12 GAP-1: Diagnostic helper
 */
export function getActiveArchitecture() {
  return activeArchitecture;
}

async function _doInitialize() {
  if (isInitialized) {
    console.log('[QuickTabsV2] Already initialized');
    return { success: true, alreadyInitialized: true };
  }

  console.log('[QuickTabsV2] Starting initialization...');
  const startTime = performance.now();

  try {
    // Step 1: Initialize storage (handles migration)
    const storageResult = await initializeQuickTabsStorage();
    console.log('[QuickTabsV2] Storage initialized:', storageResult);

    // Step 2: Initialize message handler
    initializeMessageHandler();
    console.log('[QuickTabsV2] Message handler initialized');

    // Step 3: Register tab close handler (cleanup Quick Tabs for closed tabs)
    browser.tabs.onRemoved.addListener(handleTabClosed);
    console.log('[QuickTabsV2] Tab close handler registered');

    // Step 4: Log initialization complete
    const duration = Math.round(performance.now() - startTime);
    console.log('[QuickTabsV2] Initialization complete:', {
      duration: `${duration}ms`,
      migrated: storageResult.migrated
    });

    isInitialized = true;

    return {
      success: true,
      duration,
      migrated: storageResult.migrated
    };
  } catch (error) {
    console.error('[QuickTabsV2] Initialization failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Handle tab close - remove Quick Tabs for the closed tab
 */
async function handleTabClosed(tabId, _removeInfo) {
  try {
    const state = await storageManager.readState();
    const tabQuickTabs = SchemaV2.getQuickTabsByOriginTabId(state, tabId);

    if (tabQuickTabs.length === 0) {
      return; // No Quick Tabs for this tab
    }

    console.log(
      '[QuickTabsV2] Tab closed, removing',
      tabQuickTabs.length,
      'Quick Tabs for tab:',
      tabId
    );

    const updated = SchemaV2.removeQuickTabsByOriginTabId(state, tabId);
    await storageManager.writeStateWithValidation(updated, `tab-closed-${tabId}-${Date.now()}`);
  } catch (error) {
    console.error('[QuickTabsV2] Error handling tab close:', error);
  }
}

/**
 * Get Quick Tabs v2 diagnostics
 */
export function getQuickTabsV2Diagnostics() {
  return {
    isInitialized,
    migrationStatus: getMigrationStatus(),
    broadcastMetrics: getBroadcastMetrics(),
    storageMetrics: storageManager.getMetrics()
  };
}

/**
 * Reset metrics
 */
export function resetQuickTabsV2Metrics() {
  resetBroadcastMetrics();
  storageManager.resetMetrics();
}

/**
 * Check if v2 is initialized
 */
export function isQuickTabsV2Initialized() {
  return isInitialized;
}

/**
 * Feature flag check - can be used to toggle between v1 and v2
 */
export async function isV2Enabled() {
  try {
    const result = await browser.storage.local.get('feature_flags');
    const flags = result.feature_flags || {};

    // Default to enabled
    return flags.USE_QUICK_TABS_V2 !== false;
  } catch (error) {
    console.warn('[QuickTabsV2] Could not read feature flags:', error);
    return true; // Default to enabled
  }
}

/**
 * Toggle v2 architecture on/off (for debugging/rollback)
 */
export async function setV2Enabled(enabled) {
  try {
    const result = await browser.storage.local.get('feature_flags');
    const flags = result.feature_flags || {};

    flags.USE_QUICK_TABS_V2 = enabled;

    await browser.storage.local.set({ feature_flags: flags });
    console.log('[QuickTabsV2] Feature flag set:', enabled);

    return { success: true };
  } catch (error) {
    console.error('[QuickTabsV2] Failed to set feature flag:', error);
    return { success: false, error: error.message };
  }
}

// Export storageManager for direct access if needed
export { storageManager };
