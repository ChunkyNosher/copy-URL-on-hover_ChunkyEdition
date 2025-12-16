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
 * @version 1.6.3.6-v11
 *
 * v1.6.3.6-v11 - FIX Issues #1-9 from comprehensive diagnostics:
 *   - Issue #1: Animations now properly invoked on toggle
 *   - Issue #2: Removed inline maxHeight initialization conflicts
 *   - Issue #3: Comprehensive animation lifecycle logging with phases
 *   - Issue #4: Favicon container uses CSS classes instead of inline styles
 *   - Issue #5: Consistent state terminology (STATE_OPEN/STATE_CLOSED)
 */

// Animation timing
const ANIMATION_DURATION_MS = 350;

// Favicon loading timeout
const FAVICON_LOAD_TIMEOUT_MS = 2000;

// Issue #5: Consistent state terminology constants
const STATE_OPEN = 'open';
const STATE_CLOSED = 'closed';

// Animation phases for logging (Issue #3)
const ANIMATION_PHASE = {
  START: 'START',
  CALC: 'CALC',
  TRANSITION: 'TRANSITION',
  COMPLETE: 'COMPLETE',
  ERROR: 'ERROR'
};

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
    hash = (hash << 5) - hash + str.charCodeAt(i);
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
 * Issue #4: Uses CSS classes instead of inline styles for consistent sizing
 * @param {HTMLElement} container - Container element to append to
 * @param {number|string} groupKey - Group key (originTabId or 'orphaned')
 * @param {Object} group - Group object with tabInfo
 */
export function createGroupFavicon(container, groupKey, group) {
  // Orphaned group uses warning folder icon
  if (groupKey === 'orphaned') {
    const folderIcon = document.createElement('span');
    folderIcon.className = 'tab-favicon-fallback visible'; // Issue #4: visible class for immediate display
    folderIcon.textContent = '⚠️';
    container.appendChild(folderIcon);
    return;
  }

  // Closed tabs get special icon
  if (!group.tabInfo) {
    const closedIcon = document.createElement('span');
    closedIcon.className = 'tab-favicon-fallback visible'; // Issue #4: visible class for immediate display
    closedIcon.textContent = '🚫';
    container.appendChild(closedIcon);
    return;
  }

  // Issue #4: Create container for favicon using CSS class only (no inline display style)
  const faviconContainer = document.createElement('span');
  faviconContainer.className = 'tab-favicon-container';
  // Issue #4: Removed inline display: 'inline-flex' - rely on CSS class

  if (group.tabInfo.favIconUrl) {
    _createFaviconWithTimeout(faviconContainer, group.tabInfo.favIconUrl, groupKey);
  } else {
    // No favicon URL - use fallback directly
    const fallback = document.createElement('span');
    fallback.className = 'tab-favicon-fallback visible'; // Issue #4: visible class for immediate display
    fallback.textContent = '🌐';
    faviconContainer.appendChild(fallback);
  }

  container.appendChild(faviconContainer);
}

/**
 * Create favicon image with timeout and fallback handling
 * Issue #4: Both image and fallback use identical CSS-based sizing (no inline styles)
 * @private
 */
function _createFaviconWithTimeout(container, faviconUrl, groupKey) {
  const favicon = document.createElement('img');
  favicon.className = 'tab-favicon';
  favicon.alt = '';

  // Pre-create fallback (avoid dynamic insertion)
  // Issue #4: Uses CSS class for sizing - no inline display style on init
  const fallback = document.createElement('span');
  fallback.className = 'tab-favicon-fallback';
  fallback.textContent = '🌐';
  // Issue #4: Initially hidden via CSS (display: none by default without .visible class)

  // Loading timeout
  let loaded = false;
  const timeoutId = setTimeout(() => {
    if (!loaded) {
      favicon.style.display = 'none';
      // Issue #4: Show fallback using CSS class only (no inline style)
      fallback.classList.add('visible');
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
    // Issue #4: Show fallback using CSS class only (no inline style)
    fallback.classList.add('visible');
  };

  favicon.src = faviconUrl;

  container.appendChild(favicon);
  container.appendChild(fallback);
}

/**
 * Animate collapse (closing) of a details element
 * Issue #1: This function is invoked by attachCollapseEventListeners
 * Issue #3: Comprehensive lifecycle logging with phases
 * @param {HTMLDetailsElement} details - Details element
 * @param {HTMLElement} content - Content element to animate
 * @returns {Promise<{success: boolean, originTabId: string, durationMs: number}>}
 */
export async function animateCollapse(details, content) {
  const startTime = Date.now();
  const originTabId = details.dataset.originTabId;

  // Issue #3: Phase START logging
  console.log(
    `[Manager] Animation [${originTabId}] [collapse] [${ANIMATION_PHASE.START}]: Beginning collapse animation`,
    {
      originTabId,
      timestamp: startTime
    }
  );

  try {
    // Issue #3: Phase CALC logging - height calculation
    const startHeight = content.scrollHeight;
    console.log(
      `[Manager] Animation [${originTabId}] [collapse] [${ANIMATION_PHASE.CALC}]: Height calculated`,
      {
        originTabId,
        startHeight,
        duration: Date.now() - startTime
      }
    );

    // Issue #2: Set explicit height to enable transition (calculated from scrollHeight)
    content.style.maxHeight = `${startHeight}px`;
    content.style.overflow = 'hidden';

    // Force reflow to ensure the browser registers the starting state
    content.offsetHeight;

    // Issue #3: Phase TRANSITION logging
    console.log(
      `[Manager] Animation [${originTabId}] [collapse] [${ANIMATION_PHASE.TRANSITION}]: Transitioning to collapsed`,
      {
        originTabId,
        fromHeight: startHeight,
        toHeight: 0,
        animationMs: ANIMATION_DURATION_MS
      }
    );

    // Animate to 0
    content.style.maxHeight = '0';
    content.style.opacity = '0';

    // Wait for animation to complete
    await new Promise(resolve => setTimeout(resolve, ANIMATION_DURATION_MS));

    // Actually close the details
    details.open = false;

    // Issue #2: Clean up inline styles after animation
    content.style.maxHeight = '';
    content.style.overflow = '';
    content.style.opacity = '';

    const durationMs = Date.now() - startTime;

    // Issue #3: Phase COMPLETE logging
    console.log(
      `[Manager] Animation [${originTabId}] [collapse] [${ANIMATION_PHASE.COMPLETE}]: ${startHeight}px → 0px`,
      {
        originTabId,
        finalState: STATE_CLOSED,
        measuredDurationMs: durationMs,
        expectedDurationMs: ANIMATION_DURATION_MS
      }
    );

    return { success: true, originTabId, durationMs };
  } catch (err) {
    const durationMs = Date.now() - startTime;

    // Issue #3: Phase ERROR logging
    console.error(
      `[Manager] Animation [${originTabId}] [collapse] [${ANIMATION_PHASE.ERROR}]: Animation failed`,
      {
        originTabId,
        error: err.message,
        durationMs
      }
    );

    // Fallback: just close without animation
    details.open = false;
    return { success: false, originTabId, durationMs, error: err.message };
  }
}

/**
 * Animate expand (opening) of a details element
 * Issue #1: This function is invoked by attachCollapseEventListeners
 * Issue #3: Comprehensive lifecycle logging with phases
 * @param {HTMLDetailsElement} details - Details element
 * @param {HTMLElement} content - Content element to animate
 * @returns {Promise<{success: boolean, originTabId: string, durationMs: number, targetHeight: number}>}
 */
export async function animateExpand(details, content) {
  const startTime = Date.now();
  const originTabId = details.dataset.originTabId;

  // Issue #3: Phase START logging
  console.log(
    `[Manager] Animation [${originTabId}] [expand] [${ANIMATION_PHASE.START}]: Beginning expand animation`,
    {
      originTabId,
      timestamp: startTime
    }
  );

  try {
    // Open the details first (to measure content height)
    details.open = true;

    // Issue #2: Set initial state for animation (start from 0)
    content.style.maxHeight = '0';
    content.style.opacity = '0';
    content.style.overflow = 'hidden';

    // Force reflow to ensure browser registers starting state
    content.offsetHeight;

    // Issue #3: Phase CALC logging - get target height after DOM is ready
    const targetHeight = content.scrollHeight;
    console.log(
      `[Manager] Animation [${originTabId}] [expand] [${ANIMATION_PHASE.CALC}]: Height calculated`,
      {
        originTabId,
        targetHeight,
        duration: Date.now() - startTime
      }
    );

    // Issue #3: Phase TRANSITION logging
    console.log(
      `[Manager] Animation [${originTabId}] [expand] [${ANIMATION_PHASE.TRANSITION}]: Transitioning to expanded`,
      {
        originTabId,
        fromHeight: 0,
        toHeight: targetHeight,
        animationMs: ANIMATION_DURATION_MS
      }
    );

    // Animate to full height
    content.style.maxHeight = `${targetHeight}px`;
    content.style.opacity = '1';

    // Wait for animation to complete
    await new Promise(resolve => setTimeout(resolve, ANIMATION_DURATION_MS));

    // Issue #2: Remove inline styles to allow natural sizing
    content.style.maxHeight = '';
    content.style.overflow = '';
    content.style.opacity = '';

    const durationMs = Date.now() - startTime;

    // Issue #3: Phase COMPLETE logging
    console.log(
      `[Manager] Animation [${originTabId}] [expand] [${ANIMATION_PHASE.COMPLETE}]: 0px → ${targetHeight}px`,
      {
        originTabId,
        finalState: STATE_OPEN,
        targetHeight,
        measuredDurationMs: durationMs,
        expectedDurationMs: ANIMATION_DURATION_MS
      }
    );

    return { success: true, originTabId, durationMs, targetHeight };
  } catch (err) {
    const durationMs = Date.now() - startTime;

    // Issue #3: Phase ERROR logging
    console.error(
      `[Manager] Animation [${originTabId}] [expand] [${ANIMATION_PHASE.ERROR}]: Animation failed`,
      {
        originTabId,
        error: err.message,
        durationMs
      }
    );

    // Fallback: just open without animation
    details.open = true;
    content.style.maxHeight = '';
    content.style.overflow = '';
    content.style.opacity = '';
    return { success: false, originTabId, durationMs, error: err.message };
  }
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

  const containerKeys = Object.keys(state).filter(key => key !== 'saveId' && key !== 'timestamp');

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
 * v1.6.3.7 - FIX Issue #1, #5: Validate originTabId is a valid positive integer
 * Only classify as orphaned if: (1) no originTabId field, (2) not a valid integer
 * Note: We cannot check for browser tab existence here (async), that's done in fetchBrowserTabInfo
 * 
 * Tab IDs in Firefox/Chrome are always positive integers (1, 2, 3, ...).
 * An ID of 0 or negative is invalid because:
 * - browser.tabs.get(0) throws an error
 * - Tab IDs are assigned by the browser starting from 1
 * 
 * @private
 * @param {*} originTabId - The originTabId value to validate
 * @returns {boolean} True if originTabId is a valid positive integer
 */
function _isValidOriginTabId(originTabId) {
  // Check for null, undefined, or missing
  if (originTabId === null || originTabId === undefined) {
    return false;
  }
  
  // Convert to number if string
  const numericId = Number(originTabId);
  
  // Must be a valid positive integer (Tab IDs are always >= 1 in Firefox/Chrome)
  if (isNaN(numericId) || !Number.isInteger(numericId) || numericId <= 0) {
    return false;
  }
  
  return true;
}

/**
 * Group Quick Tabs by their originTabId
 * v1.6.3.7 - FIX Issue #1, #5: Enhanced grouping with proper originTabId validation
 *   - Issue #1: Only classify as orphaned if originTabId is missing/invalid
 *   - Issue #5: Added comprehensive logging for debugging grouping decisions
 * @param {Array} quickTabs - Array of Quick Tab objects
 * @returns {Map} Map with originTabId keys and group objects
 */
export function groupQuickTabsByOriginTab(quickTabs) {
  const groups = new Map();

  if (!quickTabs || !Array.isArray(quickTabs)) {
    console.log('[Manager] GROUPING: No tabs to group (empty or invalid array)');
    return groups;
  }

  // v1.6.3.7 - FIX Issue #5: Log extraction start
  console.log('[Manager] GROUPING_START:', {
    totalTabsToGroup: quickTabs.length,
    tabIds: quickTabs.map(t => t.id)
  });

  for (const tab of quickTabs) {
    const originTabId = tab.originTabId;
    
    // v1.6.3.7 - FIX Issue #1: Use validator to determine if originTabId is valid
    const isValid = _isValidOriginTabId(originTabId);
    
    // v1.6.3.7 - FIX Issue #1, #5: Log each tab's originTabId extraction and grouping decision
    console.log('[Manager] GROUPING_TAB:', {
      quickTabId: tab.id,
      originTabId: originTabId,
      originTabIdType: typeof originTabId,
      isValidOriginTabId: isValid,
      assignedGroup: isValid ? originTabId : 'orphaned'
    });

    // Determine group key - use 'orphaned' only for invalid originTabId
    const groupKey = isValid ? originTabId : 'orphaned';

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        quickTabs: [],
        tabInfo: null // Will be populated by fetchBrowserTabInfo
      });
    }

    groups.get(groupKey).quickTabs.push(tab);
  }

  // v1.6.3.7 - FIX Issue #5: Log grouping results with tabs per group
  const groupSummary = {};
  for (const [key, group] of groups.entries()) {
    groupSummary[String(key)] = {
      tabCount: group.quickTabs.length,
      tabIds: group.quickTabs.map(t => t.id)
    };
  }

  console.log('[Manager] GROUPING_COMPLETE:', {
    totalTabs: quickTabs.length,
    groupCount: groups.size,
    groupKeys: [...groups.keys()],
    groupSummary
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

/**
 * Issue #5: Unified state transition logging utility
 * Creates consistent logs for state changes throughout the Manager
 * @param {string} groupId - Group ID (originTabId or 'orphaned')
 * @param {string} operation - Operation type (toggle, collapse, expand, etc.)
 * @param {string} fromState - Previous state (use STATE_OPEN or STATE_CLOSED)
 * @param {string} toState - New state (use STATE_OPEN or STATE_CLOSED)
 * @param {Object} metadata - Additional context
 */
export function logStateTransition(groupId, operation, fromState, toState, metadata = {}) {
  console.log(`[Manager] STATE_TRANSITION [${groupId}] [${operation}]: ${fromState} → ${toState}`, {
    groupId,
    operation,
    fromState,
    toState,
    timestamp: Date.now(),
    ...metadata
  });
}

export {
  ANIMATION_DURATION_MS,
  FAVICON_LOAD_TIMEOUT_MS,
  STATE_OPEN,
  STATE_CLOSED,
  ANIMATION_PHASE
};
