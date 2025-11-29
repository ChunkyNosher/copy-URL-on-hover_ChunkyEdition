/**
 * Utilities barrel file
 * Re-exports all utility modules for easier imports
 */

export { debug, enableDebug, disableDebug } from './debug.js';
export { copyToClipboard, getStorage, setStorage, sendMessageToBackground } from './browser-api.js';
export { createElement } from './dom.js';
export {
  logNormal,
  logError,
  logWarn,
  logInfo,
  logPerformance,
  refreshLiveConsoleSettings,
  refreshExportSettings,
  LOG_CATEGORIES,
  CATEGORY_GROUPS,
  getDefaultLiveConsoleSettings,
  getDefaultExportSettings
} from './logger.js';
export {
  STATE_KEY,
  generateSaveId,
  getBrowserStorageAPI,
  persistStateToStorage
} from './storage-utils.js';
