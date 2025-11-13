/**
 * Core modules barrel file
 * Re-exports all core modules for easier imports
 * v1.5.8.10 - Added dom and browser-api to core
 */

export { ConfigManager, DEFAULT_CONFIG, CONSTANTS } from './config.js';
export { StateManager } from './state.js';
export { EventBus, Events } from './events.js';
export * from './dom.js';
export * from './browser-api.js';
