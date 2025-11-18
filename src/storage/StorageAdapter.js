/**
 * StorageAdapter - Abstract base class for storage implementations
 * 
 * Defines the contract that all storage adapters must implement.
 * Ensures consistent async-first API across all storage backends.
 * 
 * @abstract
 */
export class StorageAdapter {
  /**
   * Save Quick Tabs for a specific container
   * 
   * @param {string} containerId - Firefox container ID (e.g., 'firefox-default', 'firefox-container-1')
   * @param {QuickTab[]} tabs - Array of QuickTab domain entities
   * @returns {Promise<string>} Save ID for tracking race conditions
   * @throws {Error} If not implemented by subclass
   */
  async save(containerId, tabs) {
    throw new Error('StorageAdapter.save() must be implemented by subclass');
  }

  /**
   * Load Quick Tabs for a specific container
   * 
   * @param {string} containerId - Firefox container ID
   * @returns {Promise<{tabs: QuickTab[], lastUpdate: number}|null>} Container data or null if not found
   * @throws {Error} If not implemented by subclass
   */
  async load(containerId) {
    throw new Error('StorageAdapter.load() must be implemented by subclass');
  }

  /**
   * Load all Quick Tabs across all containers
   * 
   * @returns {Promise<Object.<string, {tabs: QuickTab[], lastUpdate: number}>>} Map of container ID to container data
   * @throws {Error} If not implemented by subclass
   */
  async loadAll() {
    throw new Error('StorageAdapter.loadAll() must be implemented by subclass');
  }

  /**
   * Delete a specific Quick Tab from a container
   * 
   * @param {string} containerId - Firefox container ID
   * @param {string} quickTabId - Quick Tab ID to delete
   * @returns {Promise<void>}
   * @throws {Error} If not implemented by subclass
   */
  async delete(containerId, quickTabId) {
    throw new Error('StorageAdapter.delete() must be implemented by subclass');
  }

  /**
   * Delete all Quick Tabs for a specific container
   * 
   * @param {string} containerId - Firefox container ID
   * @returns {Promise<void>}
   * @throws {Error} If not implemented by subclass
   */
  async deleteContainer(containerId) {
    throw new Error('StorageAdapter.deleteContainer() must be implemented by subclass');
  }

  /**
   * Clear all Quick Tabs across all containers
   * 
   * @returns {Promise<void>}
   * @throws {Error} If not implemented by subclass
   */
  async clear() {
    throw new Error('StorageAdapter.clear() must be implemented by subclass');
  }
}
