/**
 * Render Helpers Utility Module
 * Extracted from quick-tabs-manager.js to reduce code complexity
 * 
 * Handles:
 * - UI rendering utilities
 * - DOM element creation helpers
 * - Animation utilities
 * - Group rendering
 * 
 * @version 1.6.4.11
 */

// Animation timing
const ANIMATION_DURATION_MS = 350;

// Favicon loading timeout
const FAVICON_LOAD_TIMEOUT_MS = 2000;

/**
 * Compute hash of state for deduplication
 * @param {Object} state - State to hash
 * @returns {number} Hash value
 */
export function computeStateHash(state) {
  if (!state) return 0;
  const str = JSON.stringify(state);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return hash;
}

/**
 * Create section header element
 * @param {string} text - Header text
 * @returns {HTMLElement}
 */
export function createSectionHeader(text) {
  const header = document.createElement('div');
  header.className = 'section-header';
  header.textContent = text;
  return header;
}

/**
 * Create section divider element
 * @param {string} label - Divider label
 * @returns {HTMLElement}
 */
export function createSectionDivider(label) {
  const divider = document.createElement('div');
  divider.className = 'section-divider';
  divider.dataset.label = label;
  return divider;
}

/**
 * Create favicon element for Quick Tab
 * @param {string} url - Tab URL
 * @returns {HTMLImageElement} Favicon element
 */
export function createFavicon(url) {
  const favicon = document.createElement('img');
  favicon.className = 'favicon';
  try {
    const urlObj = new URL(url);
    favicon.src = `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
    favicon.onerror = () => {
      favicon.style.display = 'none';
    };
  } catch (e) {
    favicon.style.display = 'none';
  }
  return favicon;
}

/**
 * Create group favicon element with timeout and fallback
 * @param {HTMLElement} container - Container element to append to
 * @param {number|string} groupKey - Group key (originTabId or 'orphaned')
 * @param {Object} group - Group object with tabInfo
 */
export function createGroupFavicon(container, groupKey, group) {
  // Orphaned group uses warning folder icon
  if (groupKey === 'orphaned') {
    const folderIcon = document.createElement('span');
    folderIcon.className = 'tab-favicon-fallback';
    folderIcon.textContent = '⚠️';
    container.appendChild(folderIcon);
    return;
  }
  
  // Closed tabs get special icon
  if (!group.tabInfo) {
    const closedIcon = document.createElement('span');
    closedIcon.className = 'tab-favicon-fallback';
    closedIcon.textContent = '🚫';
    container.appendChild(closedIcon);
    return;
  }
  
  // Create container for favicon (to handle loading/fallback swap)
  const faviconContainer = document.createElement('span');
  faviconContainer.className = 'tab-favicon-container';
  faviconContainer.style.display = 'inline-flex';
  faviconContainer.style.alignItems = 'center';
  faviconContainer.style.width = '16px';
  faviconContainer.style.height = '16px';
  faviconContainer.style.marginRight = '4px';
  
  if (group.tabInfo.favIconUrl) {
    _createFaviconWithTimeout(faviconContainer, group.tabInfo.favIconUrl, groupKey);
  } else {
    // No favicon URL - use fallback directly
    const fallback = document.createElement('span');
    fallback.className = 'tab-favicon-fallback';
    fallback.textContent = '🌐';
    faviconContainer.appendChild(fallback);
  }
  
  container.appendChild(faviconContainer);
}

/**
 * Create favicon image with timeout and fallback handling
 * @private
 */
function _createFaviconWithTimeout(container, faviconUrl, groupKey) {
  const favicon = document.createElement('img');
  favicon.className = 'tab-favicon';
  favicon.alt = '';
  
  // Pre-create fallback (avoid dynamic insertion)
  const fallback = document.createElement('span');
  fallback.className = 'tab-favicon-fallback';
  fallback.textContent = '🌐';
  fallback.style.display = 'none';
  
  // Loading timeout
  let loaded = false;
  const timeoutId = setTimeout(() => {
    if (!loaded) {
      favicon.style.display = 'none';
      fallback.style.display = 'inline-flex';
      console.log(`[Manager] Favicon timeout for Tab [${groupKey}], loading fallback`, {
        tabId: groupKey,
        faviconUrl: faviconUrl?.substring(0, 50),
        timeoutMs: FAVICON_LOAD_TIMEOUT_MS,
        timestamp: Date.now()
      });
    }
  }, FAVICON_LOAD_TIMEOUT_MS);
  
  favicon.onload = () => {
    loaded = true;
    clearTimeout(timeoutId);
  };
  
  favicon.onerror = () => {
    loaded = true;
    clearTimeout(timeoutId);
    favicon.style.display = 'none';
    fallback.style.display = 'inline-flex';
  };
  
  favicon.src = faviconUrl;
  
  container.appendChild(favicon);
  container.appendChild(fallback);
}

/**
 * Animate collapse (closing) of a details element
 * @param {HTMLDetailsElement} details - Details element
 * @param {HTMLElement} content - Content element to animate
 */
export async function animateCollapse(details, content) {
  const originTabId = details.dataset.originTabId;
  
  console.log(`[Manager] Group [${originTabId}] collapse animation started`, {
    originTabId,
    startHeight: content.scrollHeight,
    timestamp: Date.now()
  });
  
  // Get current height
  const startHeight = content.scrollHeight;
  
  // Set explicit height to enable transition
  content.style.maxHeight = `${startHeight}px`;
  content.style.overflow = 'hidden';
  
  // Force reflow
  content.offsetHeight;
  
  // Animate to 0
  content.style.maxHeight = '0';
  content.style.opacity = '0';
  
  // Wait for animation to complete
  await new Promise(resolve => setTimeout(resolve, ANIMATION_DURATION_MS));
  
  // Actually close the details
  details.open = false;
  
  console.log(`[Manager] Group [${originTabId}] collapse animation completed`, {
    originTabId,
    finalState: 'closed',
    durationMs: ANIMATION_DURATION_MS
  });
}

/**
 * Animate expand (opening) of a details element
 * @param {HTMLDetailsElement} details - Details element
 * @param {HTMLElement} content - Content element to animate
 */
export async function animateExpand(details, content) {
  const originTabId = details.dataset.originTabId;
  
  console.log(`[Manager] Group [${originTabId}] expand animation started`, {
    originTabId,
    timestamp: Date.now()
  });
  
  // Open the details first (to measure content height)
  details.open = true;
  
  // Set initial state for animation
  content.style.maxHeight = '0';
  content.style.opacity = '0';
  content.style.overflow = 'hidden';
  
  // Force reflow
  content.offsetHeight;
  
  // Get target height
  const targetHeight = content.scrollHeight;
  
  // Animate to full height
  content.style.maxHeight = `${targetHeight}px`;
  content.style.opacity = '1';
  
  // Wait for animation to complete
  await new Promise(resolve => setTimeout(resolve, ANIMATION_DURATION_MS));
  
  // Remove inline styles to allow natural sizing
  content.style.maxHeight = 'none';
  content.style.overflow = '';
  
  console.log(`[Manager] Group [${originTabId}] expand animation completed`, {
    originTabId,
    finalState: 'open',
    targetHeight,
    durationMs: ANIMATION_DURATION_MS
  });
}

/**
 * Scroll details element into view if it's off-screen
 * @param {HTMLDetailsElement} details - Details element to scroll into view
 */
export function scrollIntoViewIfNeeded(details) {
  requestAnimationFrame(() => {
    const rect = details.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    
    // Check if the details element is partially out of view
    if (rect.bottom > viewportHeight || rect.top < 0) {
      details.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      });
    }
  });
}

/**
 * Animate removal of a group element with smooth fade-out
 * @param {HTMLElement} element - Element to remove with animation
 */
export function animateGroupRemoval(element) {
  const originTabId = element.dataset?.originTabId || 'unknown';
  
  console.log(`[Manager] Removing empty group [${originTabId}]`, {
    originTabId,
    timestamp: Date.now()
  });
  
  element.classList.add('removing');
  
  // Use transitionend event with fallback timeout
  const handleTransitionEnd = () => {
    element.removeEventListener('transitionend', handleTransitionEnd);
    element.remove();
    console.log(`[Manager] Group [${originTabId}] removal complete`);
  };
  
  element.addEventListener('transitionend', handleTransitionEnd);
  
  // Fallback timeout in case transitionend doesn't fire
  setTimeout(() => {
    if (element.parentNode) {
      element.removeEventListener('transitionend', handleTransitionEnd);
      element.remove();
      console.log(`[Manager] Group [${originTabId}] removal complete (fallback)`);
    }
  }, ANIMATION_DURATION_MS + 50);
}

/**
 * Check for and animate removal of groups that became empty
 * @param {HTMLElement} groupsContainer - Container with groups
 * @param {Map} currentGroups - Current groups from state
 */
export function checkAndRemoveEmptyGroups(groupsContainer, currentGroups) {
  const existingGroups = groupsContainer.querySelectorAll('.tab-group');
  const currentGroupKeys = new Set([...currentGroups.keys()].map(String));
  
  for (const groupEl of existingGroups) {
    const originTabId = groupEl.dataset.originTabId;
    const shouldRemove = _shouldRemoveGroup(originTabId, currentGroupKeys, currentGroups);
    
    if (shouldRemove) {
      console.log(`[Manager] Issue #7: Animating removal of empty group [${originTabId}]`);
      animateGroupRemoval(groupEl);
    }
  }
}

/**
 * Helper to determine if a group should be removed
 * @private
 */
function _shouldRemoveGroup(originTabId, currentGroupKeys, currentGroups) {
  if (currentGroupKeys.has(originTabId)) return false;
  
  const groupKey = originTabId === 'orphaned' ? originTabId : Number(originTabId);
  const group = currentGroups.get(groupKey);
  return !group || !group.quickTabs || group.quickTabs.length === 0;
}

/**
 * Extract tabs from unified state format (v1.6.2.2+)
 * @param {Object} state - Quick Tabs state in unified format
 * @returns {{ allTabs: Array, latestTimestamp: number }}
 */
export function extractFromUnifiedFormat(state) {
  const tabs = Array.isArray(state.tabs) ? state.tabs : [];
  return {
    allTabs: tabs,
    latestTimestamp: state.timestamp || 0
  };
}

/**
 * Extract tabs from legacy container format (pre-v1.6.2.2)
 * @param {Object} state - Quick Tabs state in legacy format
 * @returns {{ allTabs: Array, latestTimestamp: number }}
 */
export function extractFromLegacyFormat(state) {
  const allTabs = [];
  let latestTimestamp = 0;

  const containerKeys = Object.keys(state).filter(
    key => key !== 'saveId' && key !== 'timestamp'
  );

  for (const cookieStoreId of containerKeys) {
    const containerState = state[cookieStoreId];
    const hasTabs = containerState?.tabs && Array.isArray(containerState.tabs);
    
    if (hasTabs) {
      allTabs.push(...containerState.tabs);
      latestTimestamp = Math.max(latestTimestamp, containerState.timestamp || 0);
    }
  }

  return { allTabs, latestTimestamp };
}

/**
 * Check if state is in unified format (v1.6.2.2+)
 * @param {Object} state - Quick Tabs state
 * @returns {boolean}
 */
export function isUnifiedFormat(state) {
  return state?.tabs && Array.isArray(state.tabs);
}

/**
 * Extract tabs from state (handles both unified and legacy formats)
 * @param {Object} state - Quick Tabs state
 * @returns {{ allTabs: Array, latestTimestamp: number }}
 */
export function extractTabsFromState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { allTabs: [], latestTimestamp: 0 };
  }

  if (isUnifiedFormat(state)) {
    return extractFromUnifiedFormat(state);
  }

  return extractFromLegacyFormat(state);
}

/**
 * Check if a tab is minimized using consistent logic
 * @param {Object} tab - Quick Tab data
 * @returns {boolean}
 */
export function isTabMinimized(tab) {
  return tab.minimized ?? tab.visibility?.minimized ?? false;
}

/**
 * Group Quick Tabs by their originTabId
 * @param {Array} quickTabs - Array of Quick Tab objects
 * @returns {Map} Map with originTabId keys and group objects
 */
export function groupQuickTabsByOriginTab(quickTabs) {
  const groups = new Map();
  
  if (!quickTabs || !Array.isArray(quickTabs)) {
    return groups;
  }
  
  for (const tab of quickTabs) {
    const originTabId = tab.originTabId;
    
    // Determine group key - use 'orphaned' for null/undefined originTabId
    const groupKey = (originTabId != null) ? originTabId : 'orphaned';
    
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        quickTabs: [],
        tabInfo: null // Will be populated by fetchBrowserTabInfo
      });
    }
    
    groups.get(groupKey).quickTabs.push(tab);
  }
  
  console.log('[Manager] Grouped Quick Tabs by origin:', {
    totalTabs: quickTabs.length,
    groupCount: groups.size,
    groupKeys: [...groups.keys()]
  });
  
  return groups;
}

/**
 * Sort group keys with active tabs first, closed tabs later, orphaned last
 * @param {Array} groupKeys - Array of group keys
 * @param {Map} groups - Groups map
 * @returns {Array} Sorted group keys
 */
export function sortGroupKeys(groupKeys, groups) {
  return [...groupKeys].sort((a, b) => {
    // Orphaned always last
    if (a === 'orphaned') return 1;
    if (b === 'orphaned') return -1;
    
    // Check if tabs are closed (no tabInfo)
    const aGroup = groups.get(a);
    const bGroup = groups.get(b);
    const aClosed = !aGroup?.tabInfo;
    const bClosed = !bGroup?.tabInfo;
    
    // Closed tabs go to bottom (before orphaned)
    if (aClosed && !bClosed) return 1;
    if (!aClosed && bClosed) return -1;
    
    // Otherwise sort by ID
    return Number(a) - Number(b);
  });
}

export { ANIMATION_DURATION_MS, FAVICON_LOAD_TIMEOUT_MS };
