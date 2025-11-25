// Background script handles injecting content script into all tabs
// and manages Quick Tab state persistence across tabs
// Also handles sidebar panel communication
// Also handles webRequest to remove X-Frame-Options for Quick Tabs
// v1.5.8.13 - EAGER LOADING: All listeners and state are initialized immediately on load

// v1.6.0 - PHASE 3.1: Import message routing infrastructure
import { LogHandler } from './src/background/handlers/LogHandler.js';
import { QuickTabHandler } from './src/background/handlers/QuickTabHandler.js';
import { TabHandler } from './src/background/handlers/TabHandler.js';
import { MessageRouter } from './src/background/MessageRouter.js';
// v1.6.0 - PHASE 3.2: Import storage format detection and migration strategies
import { LegacyMigrator } from './src/background/strategies/formatMigrators/LegacyMigrator.js';
import { V1_5_8_14_Migrator } from './src/background/strategies/formatMigrators/V1_5_8_14_Migrator.js';
import { V1_5_8_15_Migrator } from './src/background/strategies/formatMigrators/V1_5_8_15_Migrator.js';
import { StorageFormatDetector } from './src/background/strategies/StorageFormatDetector.js';

const runtimeAPI =
  (typeof browser !== 'undefined' && browser.runtime) ||
  (typeof chrome !== 'undefined' && chrome.runtime) ||
  null;

const downloadsAPI =
  (typeof browser !== 'undefined' && browser.downloads) ||
  (typeof chrome !== 'undefined' && chrome.downloads) ||
  null;

const EXTENSION_ID = runtimeAPI?.id || null;