// Quick Tabs V2 Integration Module
// Integrates all v2 architecture components for the background script

import {
  getBroadcastMetrics,
  resetBroadcastMetrics
} from './broadcast-manager.js';
import { initializeMessageHandler, storageManager } from './message-handler.js';
import {
  initializeQuickTabsStorage,
  getMigrationStatus
} from './quick-tabs-initialization.js';
import * as SchemaV2 from '../storage/schema-v2.js';

let isInitialized = false;
let initializationPromise = null;

/**
 * Initialize Quick Tabs v2 architecture
 * Call this from background.js on extension startup
 */
export async function initializeQuickTabsV2() {
  // Prevent multiple initializations
  if (initializationPromise) {
    return await initializationPromise;
  }

  initializationPromise = _doInitialize();
  return await initializationPromise;
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
    await storageManager.writeStateWithValidation(
      updated,
      `tab-closed-${tabId}-${Date.now()}`
    );
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
