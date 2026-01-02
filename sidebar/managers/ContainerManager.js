/**
 * Container Manager Module
 * Extracted from quick-tabs-manager.js to reduce code complexity
 *
 * Handles:
 * - Container isolation and filtering for Quick Tabs
 * - Container name/icon resolution from contextualIdentities API
 * - Container filter dropdown population and handling
 * - Container badge creation for tab groups
 *
 * @version 1.6.4-v4
 *
 * v1.6.4-v4 - Extracted from quick-tabs-manager.js for code health improvement
 *   - FEATURE: Container-based filtering for Quick Tabs
 *   - Default view: All Quick Tabs (filter = 'all')
 *   - Container dropdown in Manager header for filter selection
 *   - Options: "All Containers" (default), "Current Container" (auto-detect), or specific container
 *   - Container names resolved from browser.contextualIdentities API
 *   - Dynamic update when user switches to a different container tab
 */

// ==================== CONSTANTS ====================

/**
 * Default container ID (Firefox's non-container context)
 * v1.6.4-v4 - Used throughout container filtering logic
 */
export const DEFAULT_CONTAINER_ID = 'firefox-default';

/**
 * Storage key for container filter preference
 * v1.6.4-v4 - FEATURE: Container isolation
 */
export const CONTAINER_FILTER_STORAGE_KEY = 'quickTabsContainerFilter';

/**
 * Migration flag to track if 'current' filter was reset to 'all'
 * v1.6.4-v4 - FIX BUG #1b: One-time migration helper
 */
export const CONTAINER_FILTER_MIGRATION_KEY = 'containerFilterMigrated_v1_6_4_v4';

// ==================== STATE ====================

/**
 * Track current container ID for filtering Quick Tabs by container
 * @private
 */
let _currentContainerId = DEFAULT_CONTAINER_ID;

/**
 * Selected container filter value
 * v1.6.4-v4 - FIX BUG #1: Default to 'all' so Quick Tabs are visible by default
 * Values: 'all', 'current', or a specific cookieStoreId
 * @private
 */
let _selectedContainerFilter = 'all';

/**
 * Container dropdown DOM element reference
 * @private
 */
let _containerFilterDropdown = null;

/**
 * External references set during initialization
 * @private
 */
let _containersData = {};
let _renderUI = null;
let _incrementStateVersion = null;
let _requestAllQuickTabsViaPort = null;
let _getCurrentBrowserTabId = null;

// ==================== INITIALIZATION ====================

/**
 * Initialize Container Manager with external dependencies
 * v1.6.4-v4 - FEATURE: Container isolation
 * @param {Object} deps - External dependencies
 * @param {Object} deps.containersData - Reference to containers data cache
 * @param {Function} deps.renderUI - Function to trigger UI re-render
 * @param {Function} deps.incrementStateVersion - Function to increment state version
 * @param {Function} deps.requestAllQuickTabsViaPort - Function to request fresh Quick Tab data
 * @param {Function} deps.getCurrentBrowserTabId - Function to get current browser tab ID
 */
export function initializeContainerManagerDeps(deps) {
  if (deps.containersData !== undefined) {
    _containersData = deps.containersData;
  }
  if (deps.renderUI) {
    _renderUI = deps.renderUI;
  }
  if (deps.incrementStateVersion) {
    _incrementStateVersion = deps.incrementStateVersion;
  }
  if (deps.requestAllQuickTabsViaPort) {
    _requestAllQuickTabsViaPort = deps.requestAllQuickTabsViaPort;
  }
  if (deps.getCurrentBrowserTabId) {
    _getCurrentBrowserTabId = deps.getCurrentBrowserTabId;
  }
}

/**
 * Update containers data reference (called when data is refreshed)
 * v1.6.4-v4 - FEATURE: Container isolation
 * @param {Object} newContainersData - Updated containers data
 */
export function updateContainersData(newContainersData) {
  _containersData = newContainersData;
}

// ==================== CONTAINER ICON MAPPING ====================

/**
 * Convert Firefox container icon identifier to emoji
 * v1.6.4-v4 - FEATURE: Container isolation
 * @param {string} icon - Firefox container icon name
 * @returns {string} Emoji representation
 */
export function getContainerIcon(icon) {
  const iconMap = {
    fingerprint: '🔒',
    briefcase: '💼',
    dollar: '💰',
    cart: '🛒',
    circle: '⭕',
    gift: '🎁',
    vacation: '🏖️',
    food: '🍴',
    fruit: '🍎',
    pet: '🐾',
    tree: '🌳',
    chill: '❄️',
    fence: '🚧'
  };

  return iconMap[icon] || '📁';
}

// ==================== CONTAINER NAME/ICON RESOLUTION ====================

/**
 * Format container ID as a readable name (fallback)
 * v1.6.4-v4 - FEATURE: Container isolation
 * @private
 * @param {string} cookieStoreId - Container ID
 * @returns {string} Formatted name
 */
function _formatContainerIdAsName(cookieStoreId) {
  // Early return for invalid input
  if (!cookieStoreId || typeof cookieStoreId !== 'string') {
    return 'Unnamed Container';
  }
  // e.g., 'firefox-container-1' -> 'Container 1'
  const match = cookieStoreId.match(/firefox-container-(\d+)/);
  if (match) {
    return `Container ${match[1]}`;
  }
  // Return the ID itself if it doesn't match expected pattern
  return cookieStoreId === '' ? 'Unnamed Container' : cookieStoreId;
}

/**
 * Try to fetch container info from contextualIdentities API
 * v1.6.4-v4 - FEATURE: Container isolation - extracted to reduce nesting depth
 * @private
 * @param {string} cookieStoreId - Container ID
 * @returns {Promise<Object|null>} Container object or null
 */
async function _tryFetchContainerFromAPI(cookieStoreId) {
  if (typeof browser.contextualIdentities === 'undefined') {
    return null;
  }

  try {
    const container = await browser.contextualIdentities.get(cookieStoreId);
    if (container) {
      // Cache the result
      _containersData[cookieStoreId] = {
        name: container.name,
        icon: getContainerIcon(container.icon),
        color: container.color,
        colorCode: container.colorCode,
        cookieStoreId: container.cookieStoreId
      };
      return container;
    }
  } catch (err) {
    console.log('[ContainerManager] CONTAINER_NAME_LOOKUP: API error for', cookieStoreId, err.message);
  }

  return null;
}

/**
 * Get container name by cookieStoreId (async)
 * Uses containersData cache when available, falls back to API
 * v1.6.4-v4 - FEATURE: Container isolation
 * @param {string} cookieStoreId - Container ID (e.g., 'firefox-container-1')
 * @returns {Promise<string>} Container name (e.g., 'Shopping')
 */
export async function getContainerNameByIdAsync(cookieStoreId) {
  // Check cache first
  if (_containersData[cookieStoreId]) {
    return _containersData[cookieStoreId].name;
  }

  // Handle default container
  if (!cookieStoreId || cookieStoreId === DEFAULT_CONTAINER_ID) {
    return 'Default';
  }

  // Try to fetch from API if not in cache
  const container = await _tryFetchContainerFromAPI(cookieStoreId);
  if (container) {
    return container.name;
  }

  // Fallback: format cookieStoreId as a readable name
  return _formatContainerIdAsName(cookieStoreId);
}

/**
 * Get container name synchronously from cache
 * v1.6.4-v4 - FEATURE: Container isolation
 * @param {string} cookieStoreId - Container ID
 * @returns {string} Container name or fallback
 */
export function getContainerNameSync(cookieStoreId) {
  if (_containersData[cookieStoreId]) {
    return _containersData[cookieStoreId].name;
  }
  if (!cookieStoreId || cookieStoreId === DEFAULT_CONTAINER_ID) {
    return 'Default';
  }
  return _formatContainerIdAsName(cookieStoreId);
}

/**
 * Get container icon by cookieStoreId
 * v1.6.4-v4 - FEATURE: Container isolation
 * @param {string} cookieStoreId - Container ID
 * @returns {string} Container icon emoji
 */
export function getContainerIconSync(cookieStoreId) {
  if (_containersData[cookieStoreId]) {
    return _containersData[cookieStoreId].icon;
  }
  return '📁';
}

// ==================== CONTAINER ID TRACKING ====================

/**
 * Get current container ID
 * v1.6.4-v4 - FEATURE: Container isolation
 * @returns {string} Current container ID
 */
export function getCurrentContainerId() {
  return _currentContainerId;
}

/**
 * Get selected container filter value
 * v1.6.4-v4 - FEATURE: Container isolation
 * @returns {string} Selected filter ('all', 'current', or cookieStoreId)
 */
export function getSelectedContainerFilter() {
  return _selectedContainerFilter;
}

/**
 * Update current container ID from active tab
 * v1.6.4-v4 - FEATURE: Container isolation
 * @param {number} tabId - Browser tab ID
 * @returns {Promise<boolean>} True if container changed
 */
export async function updateCurrentContainerId(tabId) {
  const oldContainerId = _currentContainerId;

  try {
    const tab = await browser.tabs.get(tabId);
    _currentContainerId = tab?.cookieStoreId || DEFAULT_CONTAINER_ID;
  } catch (err) {
    console.log('[ContainerManager] CONTAINER_UPDATE: Tab lookup failed', tabId, err.message);
    _currentContainerId = DEFAULT_CONTAINER_ID;
  }

  const containerChanged = oldContainerId !== _currentContainerId;

  if (containerChanged) {
    console.log('[ContainerManager] 🔄 CONTAINER_CHANGED:', {
      previousContainerId: oldContainerId,
      previousContainerName: getContainerNameSync(oldContainerId),
      currentContainerId: _currentContainerId,
      currentContainerName: getContainerNameSync(_currentContainerId)
    });
  }

  return containerChanged;
}

// ==================== CONTAINER FILTER DROPDOWN ====================

/**
 * Populate container filter dropdown with available containers
 * v1.6.4-v4 - FEATURE: Container isolation
 */
export function populateContainerDropdown() {
  if (!_containerFilterDropdown) return;

  // Clear existing options
  _containerFilterDropdown.innerHTML = '';

  // Add "Current Container" option (default)
  // v1.6.4-v4 - FIX: Add "(auto-detect)" indicator to show context-awareness
  const currentName = getContainerNameSync(_currentContainerId);
  const currentIcon = getContainerIconSync(_currentContainerId);
  const currentOption = document.createElement('option');
  currentOption.value = 'current';
  currentOption.textContent = `${currentIcon} ${currentName} (auto-detect)`;
  currentOption.title = `Filter to Quick Tabs in current container (${currentName}) - auto-detects active container`;
  _containerFilterDropdown.appendChild(currentOption);

  // Add "All Containers" option
  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.textContent = '🌐 All Containers';
  allOption.title = 'Show Quick Tabs from all containers';
  _containerFilterDropdown.appendChild(allOption);

  // Add separator-like disabled option
  const separator = document.createElement('option');
  separator.disabled = true;
  separator.textContent = '──────────';
  _containerFilterDropdown.appendChild(separator);

  // Add each known container as an option
  // v1.6.4-v4 FIX: Skip DEFAULT_CONTAINER_ID since "All Containers" already shows all Quick Tabs
  // This eliminates the confusing duplicate view between "All Containers" and "Default"
  const containerIds = Object.keys(_containersData)
    .filter(id => id !== DEFAULT_CONTAINER_ID)
    .sort((a, b) => {
      // Sort alphabetically by name
      return getContainerNameSync(a).localeCompare(getContainerNameSync(b));
    });

  for (const containerId of containerIds) {
    const name = getContainerNameSync(containerId);
    const icon = getContainerIconSync(containerId);
    const option = document.createElement('option');
    option.value = containerId;
    option.textContent = `${icon} ${name}`;
    option.title = `Filter to Quick Tabs in ${name} container`;
    _containerFilterDropdown.appendChild(option);
  }

  // Set the selected value
  _containerFilterDropdown.value = _selectedContainerFilter;

  console.log('[ContainerManager] CONTAINER_DROPDOWN_POPULATED:', {
    containerCount: containerIds.length,
    selectedFilter: _selectedContainerFilter,
    currentContainerId: _currentContainerId
  });
}

/**
 * Handle container filter dropdown change
 * v1.6.4-v4 - FEATURE: Container isolation
 * @param {Event} event - Change event
 */
function _handleContainerFilterChange(event) {
  // Validate event target
  if (!event?.target?.value) {
    console.warn('[ContainerManager] CONTAINER_FILTER_CHANGE: Invalid event target');
    return;
  }
  const newValue = event.target.value;
  const oldValue = _selectedContainerFilter;

  if (newValue === oldValue) return;

  _selectedContainerFilter = newValue;

  console.log('[ContainerManager] 🔄 CONTAINER_FILTER_CHANGED:', {
    previousFilter: oldValue,
    newFilter: newValue,
    filterName:
      newValue === 'current'
        ? getContainerNameSync(_currentContainerId)
        : newValue === 'all'
          ? 'All Containers'
          : getContainerNameSync(newValue)
  });

  // Save preference to storage
  _saveContainerFilterPreference(newValue);

  // Re-render UI with new filter
  if (_incrementStateVersion) {
    _incrementStateVersion('container-filter-change');
  }
  if (_renderUI) {
    _renderUI();
  }
}

/**
 * Save container filter preference to storage
 * v1.6.4-v4 - FEATURE: Container isolation
 * @private
 * @param {string} filterValue - Filter value to save
 */
async function _saveContainerFilterPreference(filterValue) {
  try {
    await browser.storage.local.set({ [CONTAINER_FILTER_STORAGE_KEY]: filterValue });
    console.log('[ContainerManager] CONTAINER_FILTER_SAVED:', filterValue);
  } catch (err) {
    console.warn('[ContainerManager] CONTAINER_FILTER_SAVE_FAILED:', err.message);
  }
}

/**
 * Migrate container filter from 'current' to 'all'
 * v1.6.4-v4 - FIX BUG #1b: One-time migration helper
 * @private
 */
async function _migrateContainerFilterToAll() {
  console.log('[ContainerManager] CONTAINER_FILTER_MIGRATING: Resetting "current" to "all" for v1.6.4-v4');
  _selectedContainerFilter = 'all';
  await browser.storage.local.set({
    [CONTAINER_FILTER_STORAGE_KEY]: 'all',
    [CONTAINER_FILTER_MIGRATION_KEY]: true
  });
  console.log(
    '[ContainerManager] CONTAINER_FILTER_LOADED:',
    _selectedContainerFilter,
    '(migrated from current)'
  );
}

/**
 * Load container filter preference from storage
 * v1.6.4-v4 - FEATURE: Container isolation
 * v1.6.4-v4 - FIX BUG #1: Default to 'all' if no saved preference
 * v1.6.4-v4 - FIX BUG #1b: Migrate old 'current' preference to 'all' on version upgrade
 */
export async function loadContainerFilterPreference() {
  try {
    const result = await browser.storage.local.get([
      CONTAINER_FILTER_STORAGE_KEY,
      CONTAINER_FILTER_MIGRATION_KEY
    ]);
    const savedFilter = result[CONTAINER_FILTER_STORAGE_KEY];
    const alreadyMigrated = result[CONTAINER_FILTER_MIGRATION_KEY];

    // v1.6.4-v4 - FIX BUG #1b: One-time migration from 'current' to 'all'
    const needsMigration = !alreadyMigrated && savedFilter === 'current';

    if (needsMigration) {
      await _migrateContainerFilterToAll();
      return;
    }

    // v1.6.4-v4 - FIX BUG #1: Default to 'all' so Quick Tabs are visible by default
    _selectedContainerFilter = savedFilter || 'all';
    console.log('[ContainerManager] CONTAINER_FILTER_LOADED:', _selectedContainerFilter);

    // Mark migration check complete to prevent re-running on future loads
    if (!alreadyMigrated) {
      await browser.storage.local.set({ [CONTAINER_FILTER_MIGRATION_KEY]: true });
    }
  } catch (err) {
    console.warn('[ContainerManager] CONTAINER_FILTER_LOAD_FAILED:', err.message);
    _selectedContainerFilter = 'all';
  }
}

/**
 * Setup container filter dropdown event listener
 * v1.6.4-v4 - FEATURE: Container isolation
 */
export function setupContainerFilterDropdown() {
  _containerFilterDropdown = document.getElementById('containerFilter');
  if (!_containerFilterDropdown) {
    console.warn('[ContainerManager] CONTAINER_FILTER: Dropdown element not found');
    return;
  }

  _containerFilterDropdown.addEventListener('change', _handleContainerFilterChange);
  console.log('[ContainerManager] CONTAINER_FILTER: Dropdown event listener attached');
}

// ==================== CONTAINER FILTERING ====================

/**
 * Filter Quick Tabs by container based on current filter setting
 * v1.6.4-v4 - FEATURE: Container isolation
 * @param {Array} allTabs - All Quick Tabs
 * @returns {Array} Filtered Quick Tabs
 */
export function filterQuickTabsByContainer(allTabs) {
  if (!Array.isArray(allTabs) || allTabs.length === 0) {
    return allTabs;
  }

  // If filter is 'all', return all tabs
  if (_selectedContainerFilter === 'all') {
    return allTabs;
  }

  // Determine the target container ID
  const targetContainerId =
    _selectedContainerFilter === 'current' ? _currentContainerId : _selectedContainerFilter;

  // v1.6.4-v4 - DEBUG: Log each tab's originContainerId for debugging filter issues
  console.log('[ContainerManager] CONTAINER_FILTER_DEBUG:', {
    filter: _selectedContainerFilter,
    targetContainerId,
    tabsToCheck: allTabs.map(tab => ({
      id: tab.id,
      originContainerId: tab.originContainerId,
      hasOriginContainerId: 'originContainerId' in tab
    }))
  });

  // Filter tabs by originContainerId
  const filtered = allTabs.filter(tab => {
    // Get the tab's container ID (use DEFAULT_CONTAINER_ID if not set)
    const tabContainerId = tab.originContainerId || DEFAULT_CONTAINER_ID;
    return tabContainerId === targetContainerId;
  });

  console.log('[ContainerManager] CONTAINER_FILTER_APPLIED:', {
    filter: _selectedContainerFilter,
    targetContainerId,
    targetContainerName: getContainerNameSync(targetContainerId),
    totalTabs: allTabs.length,
    filteredTabs: filtered.length
  });

  return filtered;
}

// ==================== CONTAINER CONTEXT CHANGE ====================

/**
 * Update container dropdown display when container changes
 * v1.6.4-v4 - FEATURE: Container isolation
 * Called when user switches to a different container tab
 */
export function onContainerContextChanged() {
  // Update dropdown to show new "current" container name
  populateContainerDropdown();

  // If filter is 'current', request fresh data and re-render to apply new container filter
  if (_selectedContainerFilter === 'current') {
    console.log('[ContainerManager] CONTAINER_CONTEXT_CHANGED: Requesting fresh data for new container');
    // v1.6.4-v4 - FIX: Request fresh Quick Tabs from background to get updated container context
    if (_requestAllQuickTabsViaPort) {
      _requestAllQuickTabsViaPort();
    }
    // Note: renderUI() will be called by GET_ALL_QUICK_TABS_RESPONSE handler
  }
}

// ==================== CONTAINER BADGE ====================

/**
 * Check if container badge should be shown
 * v1.6.4-v5 - PERF: Extracted from _createGroupHeader for code health
 * Only show when viewing all containers, group is not orphaned, and has Quick Tabs
 * @param {boolean} isOrphaned - Whether this is the orphaned group
 * @param {number} quickTabCount - Number of Quick Tabs in the group
 * @returns {boolean} True if container badge should be shown
 */
export function shouldShowContainerBadge(isOrphaned, quickTabCount) {
  return _selectedContainerFilter === 'all' && !isOrphaned && quickTabCount > 0;
}

/**
 * Create container indicator badge for "All Containers" view
 * v1.6.4-v4 - FEATURE Issue #1: Shows which Firefox Container the tab belongs to
 * v1.6.4-v5 - PERF: Removed per-badge logging to reduce log volume
 * Only shown when _selectedContainerFilter === 'all'
 * @param {Array} quickTabs - Quick Tabs in this group
 * @returns {HTMLElement|null} Container badge element or null
 */
export function createContainerBadge(quickTabs) {
  // Get the container ID from the first Quick Tab in the group
  // All Quick Tabs in a group should have the same originContainerId
  const firstTab = quickTabs[0];
  if (!firstTab) {
    return null;
  }

  const containerId = firstTab.originContainerId || DEFAULT_CONTAINER_ID;

  // Get container info
  const containerName = getContainerNameSync(containerId);
  const containerIcon = getContainerIconSync(containerId);

  // Create badge element
  const badge = document.createElement('span');
  badge.className = 'container-indicator-badge';

  // v1.6.4-v4 - Get container color from cache for styling
  const containerInfo = _containersData[containerId];
  if (containerInfo && containerInfo.color) {
    badge.dataset.containerColor = containerInfo.color;
  }

  badge.textContent = `${containerIcon} ${containerName}`;
  badge.title = `Container: ${containerName}`;

  // v1.6.4-v5 - PERF: Removed per-badge debug logging (was firing for every group)

  return badge;
}

// ==================== MAIN INITIALIZATION ====================

/**
 * Initialize container isolation feature
 * v1.6.4-v4 - FEATURE: Container isolation
 * Called during sidebar initialization
 * @param {number|null} currentBrowserTabId - Current browser tab ID
 */
export async function initializeContainerIsolation(currentBrowserTabId) {
  console.log('[ContainerManager] CONTAINER_ISOLATION: Initializing...');

  // Load saved filter preference
  await loadContainerFilterPreference();

  // Setup dropdown - validate it was found
  setupContainerFilterDropdown();
  if (!_containerFilterDropdown) {
    console.warn('[ContainerManager] CONTAINER_ISOLATION: Dropdown not found - feature disabled');
    return;
  }

  // Get current container from active tab
  if (currentBrowserTabId) {
    await updateCurrentContainerId(currentBrowserTabId);
  }

  // Populate dropdown (sync function)
  populateContainerDropdown();

  console.log('[ContainerManager] CONTAINER_ISOLATION: Initialization complete', {
    currentContainerId: _currentContainerId,
    currentContainerName: getContainerNameSync(_currentContainerId),
    selectedFilter: _selectedContainerFilter,
    dropdownReady: !!_containerFilterDropdown
  });
}
