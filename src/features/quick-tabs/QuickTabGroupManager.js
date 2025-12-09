/**
 * QuickTabGroupManager - Manages Firefox tab grouping for Quick Tabs
 * v1.6.3.7-v3 - API #4: browser.tabs.group() (Firefox 138+)
 *
 * Firefox 138+ introduces the tabs.group() API for native tab grouping.
 * This manager provides methods to create, manage, and persist tab groups.
 *
 * Features:
 * - Check for tabs.group() API availability
 * - Create groups with custom names
 * - Add/remove Quick Tabs from groups
 * - Persist group metadata in storage.local
 * - Graceful fallback for older Firefox versions
 *
 * Storage Format:
 * { quickTabGroups: [{ groupId, name, tabIds, createdAt, updatedAt }] }
 */

const STORAGE_KEY_GROUPS = 'quickTabGroups';

/**
 * QuickTabGroupManager - Static class for managing Quick Tab groups
 * v1.6.3.7-v3 - API #4: Firefox 138+ tab grouping support
 */
class QuickTabGroupManager {
  /**
   * Check if tabs.group() API is available (Firefox 138+)
   * v1.6.3.7-v3 - API #4: Feature detection
   * @returns {boolean} True if tabs.group API is available
   */
  static isTabsGroupAvailable() {
    return typeof browser !== 'undefined' &&
           typeof browser.tabs !== 'undefined' &&
           typeof browser.tabs.group === 'function';
  }

  /**
   * Create a new tab group with the given Quick Tab IDs
   * v1.6.3.7-v3 - API #4: Create group using tabs.group()
   * @param {string} groupName - Name for the group
   * @param {Array<number>} tabIds - Array of browser tab IDs to group
   * @returns {Promise<Object|null>} Group metadata or null if unavailable
   */
  static async createGroup(groupName, tabIds) {
    // Check API availability
    if (!this.isTabsGroupAvailable()) {
      console.warn('[QuickTabGroupManager] tabs.group API not available (requires Firefox 138+)');
      return null;
    }

    // Validate inputs
    if (!tabIds || !Array.isArray(tabIds) || tabIds.length === 0) {
      console.warn('[QuickTabGroupManager] createGroup: No tab IDs provided');
      return null;
    }

    try {
      console.log('[QuickTabGroupManager] Creating group:', {
        name: groupName,
        tabCount: tabIds.length,
        tabIds
      });

      // Create the group using Firefox tabs.group API
      const groupId = await browser.tabs.group({
        tabIds: tabIds,
        createProperties: {
          windowId: browser.windows.WINDOW_ID_CURRENT
        }
      });

      // Create metadata for persistence
      const metadata = {
        groupId,
        name: groupName || `Group ${groupId}`,
        tabIds: [...tabIds],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      // Persist to storage
      await this._saveGroupMetadata(metadata);

      console.log('[QuickTabGroupManager] Group created successfully:', metadata);
      return metadata;
    } catch (err) {
      console.error('[QuickTabGroupManager] Failed to create group:', err.message);
      return null;
    }
  }

  /**
   * Add a Quick Tab to an existing group
   * v1.6.3.7-v3 - API #4: Add tab to group
   * @param {number} groupId - Group ID to add to
   * @param {number} tabId - Browser tab ID to add
   * @returns {Promise<boolean>} True if successful
   */
  static async addToGroup(groupId, tabId) {
    if (!this.isTabsGroupAvailable()) {
      console.warn('[QuickTabGroupManager] tabs.group API not available (requires Firefox 138+)');
      return false;
    }

    try {
      console.log('[QuickTabGroupManager] Adding tab to group:', { groupId, tabId });

      // Add tab to existing group
      await browser.tabs.group({
        tabIds: [tabId],
        groupId: groupId
      });

      // Update metadata
      const groups = await this._loadGroupMetadata();
      const group = groups.find(g => g.groupId === groupId);
      if (group && !group.tabIds.includes(tabId)) {
        group.tabIds.push(tabId);
        group.updatedAt = Date.now();
        await this._persistGroups(groups);
      }

      console.log('[QuickTabGroupManager] Tab added to group successfully');
      return true;
    } catch (err) {
      console.error('[QuickTabGroupManager] Failed to add tab to group:', err.message);
      return false;
    }
  }

  /**
   * Remove a Quick Tab from its group
   * v1.6.3.7-v3 - API #4: Remove tab from group using ungroup
   * @param {number} tabId - Browser tab ID to remove
   * @returns {Promise<boolean>} True if successful
   */
  static async removeFromGroup(tabId) {
    if (!this.isTabsGroupAvailable()) {
      console.warn('[QuickTabGroupManager] tabs.group API not available (requires Firefox 138+)');
      return false;
    }

    // Check for tabs.ungroup API
    if (typeof browser.tabs.ungroup !== 'function') {
      console.warn('[QuickTabGroupManager] tabs.ungroup API not available');
      return false;
    }

    try {
      console.log('[QuickTabGroupManager] Removing tab from group:', { tabId });

      // Ungroup the tab
      await browser.tabs.ungroup([tabId]);

      // Update metadata - remove from all groups
      const updateResult = await this._removeTabFromAllGroups(tabId);

      console.log('[QuickTabGroupManager] Tab removed from group successfully');
      return updateResult;
    } catch (err) {
      console.error('[QuickTabGroupManager] Failed to remove tab from group:', err.message);
      return false;
    }
  }

  /**
   * Remove tab ID from all group metadata
   * v1.6.3.7-v3 - Extracted to reduce nesting depth
   * @private
   * @param {number} tabId - Tab ID to remove
   * @returns {Promise<boolean>} True if any group was updated
   */
  static async _removeTabFromAllGroups(tabId) {
    const groups = await this._loadGroupMetadata();
    let changed = false;

    for (const group of groups) {
      const index = group.tabIds.indexOf(tabId);
      if (index !== -1) {
        group.tabIds.splice(index, 1);
        group.updatedAt = Date.now();
        changed = true;
      }
    }

    if (changed) {
      await this._persistGroups(groups);
    }

    return true;
  }

  /**
   * Get all tab IDs in a group
   * v1.6.3.7-v3 - API #4: Query group members
   * @param {number} groupId - Group ID to query
   * @returns {Promise<Array<number>>} Array of tab IDs in the group
   */
  static async getGroupMembers(groupId) {
    if (!this.isTabsGroupAvailable()) {
      console.warn('[QuickTabGroupManager] tabs.group API not available (requires Firefox 138+)');
      return [];
    }

    try {
      // Query tabs with this groupId
      const tabs = await browser.tabs.query({ groupId });
      return tabs.map(tab => tab.id);
    } catch (err) {
      console.error('[QuickTabGroupManager] Failed to get group members:', err.message);
      return [];
    }
  }

  /**
   * Get all saved group metadata
   * v1.6.3.7-v3 - API #4: List all groups
   * @returns {Promise<Array<Object>>} Array of group metadata objects
   */
  static async getAllGroups() {
    return this._loadGroupMetadata();
  }

  /**
   * Delete a group (removes metadata, does not affect tabs)
   * v1.6.3.7-v3 - API #4: Delete group metadata
   * @param {number} groupId - Group ID to delete
   * @returns {Promise<boolean>} True if deleted
   */
  static async deleteGroup(groupId) {
    try {
      const groups = await this._loadGroupMetadata();
      const filteredGroups = groups.filter(g => g.groupId !== groupId);

      if (filteredGroups.length === groups.length) {
        console.warn('[QuickTabGroupManager] Group not found:', groupId);
        return false;
      }

      await this._persistGroups(filteredGroups);
      console.log('[QuickTabGroupManager] Group deleted:', groupId);
      return true;
    } catch (err) {
      console.error('[QuickTabGroupManager] Failed to delete group:', err.message);
      return false;
    }
  }

  // ==================== PRIVATE METHODS ====================

  /**
   * Load group metadata from storage
   * @private
   * @returns {Promise<Array<Object>>} Array of group metadata
   */
  static async _loadGroupMetadata() {
    try {
      const result = await browser.storage.local.get(STORAGE_KEY_GROUPS);
      return result[STORAGE_KEY_GROUPS] || [];
    } catch (err) {
      console.error('[QuickTabGroupManager] Failed to load groups:', err.message);
      return [];
    }
  }

  /**
   * Save new group metadata to storage
   * @private
   * @param {Object} metadata - Group metadata to save
   */
  static async _saveGroupMetadata(metadata) {
    try {
      const groups = await this._loadGroupMetadata();
      groups.push(metadata);
      await this._persistGroups(groups);
    } catch (err) {
      console.error('[QuickTabGroupManager] Failed to save group metadata:', err.message);
    }
  }

  /**
   * Persist groups array to storage
   * @private
   * @param {Array<Object>} groups - Groups array to persist
   */
  static async _persistGroups(groups) {
    try {
      await browser.storage.local.set({ [STORAGE_KEY_GROUPS]: groups });
      console.log('[QuickTabGroupManager] Groups persisted:', groups.length, 'groups');
    } catch (err) {
      console.error('[QuickTabGroupManager] Failed to persist groups:', err.message);
    }
  }
}

export { QuickTabGroupManager };
