// Quick Tabs Initialization and Migration
// Handles migration from legacy storage format to v2 schema

import * as SchemaV2 from '../storage/schema-v2.js';
import { StorageManager, generateCorrelationId } from '../storage/storage-manager.js';

const OLD_STORAGE_KEYS_PATTERN = /^qt_positions_tab_\d+$/;
const MIGRATION_GRACE_PERIOD = 5; // Number of writes before deleting old keys

// Counter for unique ID generation within the same millisecond
let idCounter = 0;
let lastIdTimestamp = 0;

/**
 * Generate a unique ID for a Quick Tab
 *
 * @returns {string} Unique ID string
 */
function generateUniqueId() {
  const now = Date.now();
  if (now === lastIdTimestamp) {
    idCounter++;
  } else {
    lastIdTimestamp = now;
    idCounter = 0;
  }
  return `qt-${now}-${idCounter}-${Math.random().toString(36).slice(2, 11)}`;
}

const migrationState = {
  migrated: false,
  writesSinceMigration: 0,
  oldKeysDeleted: false
};

/**
 * Check if a key is a legacy storage key
 *
 * @param {string} key - Storage key to check
 * @returns {boolean} True if this is a legacy key
 */
function isLegacyKey(key) {
  return (
    OLD_STORAGE_KEYS_PATTERN.test(key) || key === 'qt_states' || key === 'quick_tabs_positions'
  );
}

/**
 * Initialize Quick Tabs storage - handles migration from old format
 *
 * @returns {Promise<Object>} Result with success status and migration flag
 */
export async function initializeQuickTabsStorage() {
  const storageManager = new StorageManager();

  try {
    const needsMigration = await checkNeedsMigration();

    if (needsMigration) {
      console.log('[QuickTabsInit] Migration needed from legacy format');
      await migrateToV2Schema(storageManager);
    } else {
      console.log('[QuickTabsInit] No migration needed, using v2 schema');
    }

    await ensureValidState(storageManager);
    return { success: true, migrated: needsMigration };
  } catch (error) {
    console.error('[QuickTabsInit] Initialization error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Ensure a valid state exists in storage
 *
 * @param {StorageManager} storageManager - Storage manager instance
 * @returns {Promise<void>}
 */
async function ensureValidState(storageManager) {
  const state = await storageManager.readState();
  if (!SchemaV2.isValidState(state)) {
    console.log('[QuickTabsInit] Creating initial empty state');
    await storageManager.writeStateWithValidation(
      SchemaV2.getEmptyState(),
      generateCorrelationId('init')
    );
  }
}

/**
 * Check if migration from legacy format is needed
 *
 * @returns {Promise<boolean>} True if migration is needed
 */
async function checkNeedsMigration() {
  try {
    const allStorage = await browser.storage.local.get(null);
    const keys = Object.keys(allStorage);
    const legacyKeys = keys.filter(isLegacyKey);
    const hasV2Key = keys.includes(SchemaV2.STORAGE_KEY);

    if (legacyKeys.length > 0 && !hasV2Key) {
      return true;
    }

    if (!hasV2Key) {
      return false;
    }

    const v2State = allStorage[SchemaV2.STORAGE_KEY];
    if (!SchemaV2.isValidState(v2State)) {
      return legacyKeys.length > 0;
    }

    return false;
  } catch (error) {
    console.error('[QuickTabsInit] Error checking migration status:', error);
    return false;
  }
}

/**
 * Extract position-based Quick Tabs from storage
 *
 * @param {Object} allStorage - All storage data
 * @returns {Array} Array of converted Quick Tabs
 */
function extractPositionBasedQuickTabs(allStorage) {
  const results = [];

  for (const [key, value] of Object.entries(allStorage)) {
    if (!OLD_STORAGE_KEYS_PATTERN.test(key)) continue;

    const tabIdMatch = key.match(/qt_positions_tab_(\d+)/);
    if (!tabIdMatch || !value) continue;

    const originTabId = parseInt(tabIdMatch[1], 10);
    const converted = convertLegacyValue(value, originTabId);
    results.push(...converted);
  }

  return results;
}

/**
 * Convert a legacy value (array or object) to Quick Tabs
 *
 * @param {Array|Object} value - Legacy value
 * @param {number} originTabId - Origin tab ID
 * @returns {Array} Array of converted Quick Tabs
 */
function convertLegacyValue(value, originTabId) {
  if (Array.isArray(value)) {
    return value.map(qt => convertLegacyQuickTab(qt, originTabId));
  }
  if (typeof value === 'object') {
    return [convertLegacyQuickTab(value, originTabId)];
  }
  return [];
}

/**
 * Extract Quick Tabs from qt_states array
 *
 * @param {Object} allStorage - All storage data
 * @param {Array} existingIds - Array of existing Quick Tab IDs to avoid duplicates
 * @returns {Array} Array of converted Quick Tabs
 */
function extractQtStatesQuickTabs(allStorage, existingIds) {
  const results = [];
  const qtStates = allStorage.qt_states;

  if (!qtStates || !Array.isArray(qtStates)) {
    return results;
  }

  for (const legacyQt of qtStates) {
    if (!legacyQt || existingIds.includes(legacyQt.id)) continue;
    results.push(convertLegacyQuickTab(legacyQt, legacyQt.tabId || 0));
  }

  return results;
}

/**
 * Convert intermediate format tab to Quick Tab
 *
 * @param {Object} tab - Tab data from intermediate format
 * @returns {Object} Converted Quick Tab object
 */
function convertIntermediateTab(tab) {
  return {
    id: tab.id,
    originTabId: tab.originTabId || tab.tabId || 0,
    url: tab.url,
    position: tab.position || { x: 100, y: 100 },
    size: tab.size || { w: 800, h: 600 },
    minimized: tab.minimized || false,
    createdAt: tab.createdAt || Date.now()
  };
}

/**
 * Extract Quick Tabs from intermediate v1 format
 *
 * @param {Object} allStorage - All storage data
 * @param {Array} existingIds - Array of existing Quick Tab IDs to avoid duplicates
 * @returns {Array} Array of converted Quick Tabs
 */
function extractIntermediateFormatQuickTabs(allStorage, existingIds) {
  const tabs = allStorage.quick_tabs_state_v2?.tabs;

  if (!tabs || !Array.isArray(tabs)) {
    return [];
  }

  return tabs.filter(tab => !existingIds.includes(tab.id)).map(convertIntermediateTab);
}

/**
 * Migrate from legacy storage format to v2 schema
 *
 * @param {StorageManager} storageManager - Storage manager instance
 * @returns {Promise<boolean>} True if migration succeeded
 */
async function migrateToV2Schema(storageManager) {
  console.log('[QuickTabsInit] Starting migration to v2 schema');

  const allStorage = await browser.storage.local.get(null);
  const legacyQuickTabs = collectAllLegacyQuickTabs(allStorage);

  let newState = SchemaV2.getEmptyState();
  for (const qt of legacyQuickTabs) {
    newState = SchemaV2.addQuickTab(newState, qt);
  }

  const result = await storageManager.writeStateWithValidation(
    newState,
    generateCorrelationId('migration')
  );

  if (!result.success) {
    throw new Error('Failed to write migrated state');
  }

  console.log('[QuickTabsInit] Migration complete:', {
    quickTabsCount: legacyQuickTabs.length
  });

  migrationState.migrated = true;
  migrationState.writesSinceMigration = 0;
  scheduleLegacyKeyCleanup();

  return true;
}

/**
 * Collect all legacy Quick Tabs from all formats
 *
 * @param {Object} allStorage - All storage data
 * @returns {Array} Combined array of all legacy Quick Tabs
 */
function collectAllLegacyQuickTabs(allStorage) {
  const legacyQuickTabs = extractPositionBasedQuickTabs(allStorage);
  const existingIds = legacyQuickTabs.map(qt => qt.id);

  const qtStates = extractQtStatesQuickTabs(allStorage, existingIds);
  legacyQuickTabs.push(...qtStates);

  const allIds = legacyQuickTabs.map(qt => qt.id);
  const intermediate = extractIntermediateFormatQuickTabs(allStorage, allIds);
  legacyQuickTabs.push(...intermediate);

  return legacyQuickTabs;
}

/**
 * Extract X position from legacy format
 *
 * @param {Object} legacy - Legacy Quick Tab data
 * @returns {number} X position
 */
function extractPositionX(legacy) {
  if (legacy.position?.x !== undefined) return legacy.position.x;
  if (legacy.x !== undefined) return legacy.x;
  return 100;
}

/**
 * Extract Y position from legacy format
 *
 * @param {Object} legacy - Legacy Quick Tab data
 * @returns {number} Y position
 */
function extractPositionY(legacy) {
  if (legacy.position?.y !== undefined) return legacy.position.y;
  if (legacy.y !== undefined) return legacy.y;
  return 100;
}

/**
 * Extract width from legacy format
 *
 * @param {Object} legacy - Legacy Quick Tab data
 * @returns {number} Width
 */
function extractSizeWidth(legacy) {
  if (legacy.size?.w !== undefined) return legacy.size.w;
  if (legacy.size?.width !== undefined) return legacy.size.width;
  if (legacy.width !== undefined) return legacy.width;
  return 800;
}

/**
 * Extract height from legacy format
 *
 * @param {Object} legacy - Legacy Quick Tab data
 * @returns {number} Height
 */
function extractSizeHeight(legacy) {
  if (legacy.size?.h !== undefined) return legacy.size.h;
  if (legacy.size?.height !== undefined) return legacy.size.height;
  if (legacy.height !== undefined) return legacy.height;
  return 600;
}

/**
 * Convert legacy Quick Tab format to v2 schema
 *
 * @param {Object} legacy - Legacy Quick Tab data
 * @param {number} originTabId - Origin tab ID
 * @returns {Object} Converted Quick Tab object
 */
function convertLegacyQuickTab(legacy, originTabId) {
  return {
    id: legacy.id || generateUniqueId(),
    originTabId: originTabId,
    url: legacy.url || legacy.src || '',
    position: {
      x: extractPositionX(legacy),
      y: extractPositionY(legacy)
    },
    size: {
      w: extractSizeWidth(legacy),
      h: extractSizeHeight(legacy)
    },
    minimized: legacy.minimized ?? legacy.isMinimized ?? false,
    createdAt: legacy.createdAt ?? legacy.created ?? Date.now()
  };
}

/**
 * Schedule cleanup of legacy storage keys
 */
function scheduleLegacyKeyCleanup() {
  console.log('[QuickTabsInit] Legacy key cleanup scheduled after grace period');
}

/**
 * Track writes to determine when to clean up legacy keys
 */
export function trackSuccessfulWrite() {
  if (!migrationState.migrated || migrationState.oldKeysDeleted) {
    return;
  }

  migrationState.writesSinceMigration++;

  if (migrationState.writesSinceMigration >= MIGRATION_GRACE_PERIOD) {
    cleanupLegacyKeys();
  }
}

/**
 * Clean up legacy storage keys
 *
 * @returns {Promise<void>}
 */
async function cleanupLegacyKeys() {
  if (migrationState.oldKeysDeleted) return;

  try {
    const allStorage = await browser.storage.local.get(null);
    const keysToRemove = Object.keys(allStorage).filter(isLegacyKey);

    if (keysToRemove.length > 0) {
      await browser.storage.local.remove(keysToRemove);
      console.log('[QuickTabsInit] Cleaned up legacy keys:', keysToRemove);
    }

    migrationState.oldKeysDeleted = true;
  } catch (error) {
    console.error('[QuickTabsInit] Failed to cleanup legacy keys:', error);
  }
}

/**
 * Get migration status
 *
 * @returns {Object} Copy of migration state
 */
export function getMigrationStatus() {
  return { ...migrationState };
}
