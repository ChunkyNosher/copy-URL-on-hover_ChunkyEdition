/**
 * Drag and Drop Manager Module
 * Extracted from quick-tabs-manager.js to reduce code complexity
 *
 * Handles:
 * - Tab group drag-and-drop reordering
 * - Quick Tab drag-and-drop reordering within groups
 * - Cross-tab transfer via drag-and-drop
 * - Duplicate via modifier key + drag
 *
 * @version 1.6.4
 *
 * v1.6.4 - Extracted from quick-tabs-manager.js for code health improvement
 *   - FEATURE #2: Drag-and-drop reordering for tabs and Quick Tabs
 *   - FEATURE #3: Cross-tab transfer via drag-and-drop
 *   - FEATURE #5: Duplicate via modifier key (Shift by default)
 *   - FIX BUG #5: Changed default modifier from Alt to Shift
 */

// ==================== DRAG STATE ====================

/**
 * Cached modifier key for duplicate operations (avoid repeated storage reads)
 * v1.6.4 - FEATURE #5: Cache to improve drag operation responsiveness
 * v1.6.4 - FIX BUG #5: Changed default from 'alt' to 'shift'
 * @private
 */
let _cachedDuplicateModifierKey = 'shift';

/**
 * Current drag state for drag-and-drop operations
 * v1.6.4 - FEATURE #2/#3/#5: Track drag state for transfer/duplicate
 * @private
 */
const _dragState = {
  /** Element being dragged */
  draggedElement: null,
  /** Type of element: 'tab-group' or 'quick-tab' */
  dragType: null,
  /** Quick Tab ID if dragging a Quick Tab */
  quickTabId: null,
  /** Origin tab ID of the dragged Quick Tab */
  originTabId: null,
  /** Full Quick Tab data */
  quickTabData: null,
  /** Whether modifier key is held for duplicate */
  isDuplicate: false,
  /** Cached modifier key for this drag operation */
  modifierKey: 'shift'
};

// ==================== MODIFIER KEY HANDLING ====================

/**
 * Load and cache the duplicate modifier key from storage
 * v1.6.4 - FEATURE #5: Call once on startup and cache
 * v1.6.4 - FIX BUG #5: Changed default from 'alt' to 'shift'
 * @private
 */
async function _loadDuplicateModifierKey() {
  try {
    const result = await browser.storage.local.get('quickTabDuplicateModifier');
    _cachedDuplicateModifierKey = result.quickTabDuplicateModifier || 'shift';
    console.log('[Manager] DRAG_DROP: Modifier key loaded:', _cachedDuplicateModifierKey);
  } catch (err) {
    console.warn('[Manager] DRAG_DROP: Failed to read modifier key setting:', err.message);
    _cachedDuplicateModifierKey = 'shift'; // Default to Shift
  }
}

/**
 * Check if the modifier key for duplicate is pressed
 * v1.6.4 - FEATURE #5: Check configured modifier key
 * v1.6.4 - FIX BUG #5: Changed default from altKey to shiftKey
 * @private
 * @param {DragEvent} event - Drag event
 * @returns {boolean} True if modifier is pressed
 */
function _isModifierKeyPressed(event) {
  switch (_cachedDuplicateModifierKey) {
    case 'alt':
      return event.altKey;
    case 'ctrl':
      return event.ctrlKey;
    case 'shift':
      return event.shiftKey;
    case 'none':
      return false;
    default:
      return event.shiftKey; // Default to Shift
  }
}

/**
 * Get the current cached modifier key
 * @returns {string} Current modifier key
 */
function getCachedModifierKey() {
  return _cachedDuplicateModifierKey;
}

// ==================== EVENT LISTENERS ATTACHMENT ====================

/**
 * Attach drag-and-drop event listeners to tab groups and Quick Tab items
 * v1.6.4 - FEATURE #2/#3/#5: Drag-and-drop reordering and transfer
 * @param {HTMLElement} container - Container with tab groups
 * @param {Object} callbacks - Callback functions for operations
 * @param {Function} callbacks.getQuickTabData - Get Quick Tab data by ID
 * @param {Function} callbacks.saveGroupOrder - Save group order after reorder
 * @param {Function} callbacks.saveQuickTabOrder - Save Quick Tab order after reorder
 * @param {Function} callbacks.transferQuickTab - Transfer Quick Tab to another tab
 * @param {Function} callbacks.duplicateQuickTab - Duplicate Quick Tab to another tab
 */
function attachDragDropEventListeners(container, callbacks) {
  const tabGroups = container.querySelectorAll('.tab-group');
  const quickTabItems = container.querySelectorAll('.quick-tab-item');

  // Store callbacks for use in handlers
  _callbacks = callbacks;

  // Make tab group headers draggable for group reordering
  tabGroups.forEach(group => {
    const header = group.querySelector('.tab-group-header');
    if (header) {
      header.setAttribute('draggable', 'true');
      header.addEventListener('dragstart', e => _handleTabGroupDragStart(e, group));
      header.addEventListener('dragend', _handleDragEnd);
    }

    // Make groups drop targets for cross-tab transfer
    group.addEventListener('dragover', _handleTabGroupDragOver);
    group.addEventListener('dragleave', _handleTabGroupDragLeave);
    group.addEventListener('drop', _handleTabGroupDrop);
  });

  // Make Quick Tab items draggable
  quickTabItems.forEach(item => {
    item.setAttribute('draggable', 'true');
    item.addEventListener('dragstart', e => _handleQuickTabDragStart(e, item));
    item.addEventListener('dragend', _handleDragEnd);
    item.addEventListener('dragover', _handleQuickTabDragOver);
    item.addEventListener('dragleave', _handleQuickTabDragLeave);
    item.addEventListener('drop', _handleQuickTabDrop);
  });

  console.log('[Manager] DRAG_DROP: Event listeners attached', {
    tabGroups: tabGroups.length,
    quickTabItems: quickTabItems.length,
    timestamp: Date.now()
  });
}

// Store callbacks for use in event handlers
let _callbacks = {
  getQuickTabData: null,
  saveGroupOrder: null,
  saveQuickTabOrder: null,
  transferQuickTab: null,
  duplicateQuickTab: null
};

// ==================== TAB GROUP DRAG HANDLERS ====================

/**
 * Handle drag start for tab group headers
 * v1.6.4 - FEATURE #2: Tab group reordering
 * @private
 * @param {DragEvent} event - Drag event
 * @param {HTMLElement} group - Tab group element
 */
function _handleTabGroupDragStart(event, group) {
  const originTabId = group.dataset.originTabId;

  console.log('[Manager] DRAG_START: Tab group', {
    originTabId,
    timestamp: Date.now()
  });

  _dragState.draggedElement = group;
  _dragState.dragType = 'tab-group';
  _dragState.originTabId = originTabId;
  _dragState.quickTabId = null;
  _dragState.quickTabData = null;

  group.classList.add('dragging');

  // Set drag data
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData(
    'text/plain',
    JSON.stringify({
      type: 'tab-group',
      originTabId
    })
  );
}

/**
 * Handle tab group reorder during drag over
 * v1.6.4 - Extracted to reduce nesting depth
 * @private
 * @param {DragEvent} event - Drag event
 * @returns {boolean} True if handled
 */
function _handleTabGroupReorderDragOver(event) {
  if (_dragState.dragType !== 'tab-group') return false;

  const targetGroup = event.currentTarget;
  if (targetGroup === _dragState.draggedElement) return true;

  event.dataTransfer.dropEffect = 'move';
  targetGroup.classList.add('drag-over');
  return true;
}

/**
 * Handle drag over for tab groups (for cross-tab transfer)
 * v1.6.4 - FEATURE #3: Cross-tab transfer visual feedback
 * @private
 * @param {DragEvent} event - Drag event
 */
function _handleTabGroupDragOver(event) {
  event.preventDefault();

  // Only allow Quick Tab drops on groups (not group-to-group)
  if (_dragState.dragType !== 'quick-tab') {
    _handleTabGroupReorderDragOver(event);
    return;
  }

  const targetGroup = event.currentTarget;
  const targetOriginTabId = targetGroup.dataset.originTabId;

  // Check if transferring to a different tab
  const isCrossTabTransfer = String(targetOriginTabId) !== String(_dragState.originTabId);

  // Check modifier for duplicate (use cached modifier key)
  const isDuplicate = _isModifierKeyPressed(event);
  _dragState.isDuplicate = isDuplicate;

  // Update visual classes
  targetGroup.classList.remove('drag-over', 'drag-transfer', 'drag-duplicate');

  if (isCrossTabTransfer) {
    if (isDuplicate) {
      targetGroup.classList.add('drag-duplicate');
      event.dataTransfer.dropEffect = 'copy';
    } else {
      targetGroup.classList.add('drag-transfer');
      event.dataTransfer.dropEffect = 'move';
    }
  } else {
    targetGroup.classList.add('drag-over');
    event.dataTransfer.dropEffect = 'move';
  }
}

/**
 * Handle drag leave for tab groups
 * v1.6.4 - FEATURE #3: Remove visual feedback
 * @private
 * @param {DragEvent} event - Drag event
 */
function _handleTabGroupDragLeave(event) {
  const targetGroup = event.currentTarget;
  targetGroup.classList.remove('drag-over', 'drag-transfer', 'drag-duplicate');
}

/**
 * Handle drop on tab groups (for cross-tab transfer or group reordering)
 * v1.6.4 - FEATURE #2/#3/#5: Handle transfer/duplicate/reorder
 * @private
 * @param {DragEvent} event - Drop event
 */
function _handleTabGroupDrop(event) {
  event.preventDefault();

  const targetGroup = event.currentTarget;
  const targetOriginTabId = targetGroup.dataset.originTabId;

  targetGroup.classList.remove('drag-over', 'drag-transfer', 'drag-duplicate');

  // Handle tab group reordering
  if (_dragState.dragType === 'tab-group') {
    _handleTabGroupReorder(targetGroup);
    return;
  }

  // Handle Quick Tab drop
  if (_dragState.dragType !== 'quick-tab' || !_dragState.quickTabData) {
    return;
  }

  const isCrossTabTransfer = String(targetOriginTabId) !== String(_dragState.originTabId);

  if (!isCrossTabTransfer) {
    // v1.6.4 - FIX BUG #3: Same tab reorder - save Quick Tab order within group
    console.log('[Manager] DROP: Same tab reorder', {
      quickTabId: _dragState.quickTabId,
      originTabId: _dragState.originTabId,
      timestamp: Date.now()
    });
    // Save the Quick Tab order for this group after DOM reorder
    if (_callbacks.saveQuickTabOrder) {
      _callbacks.saveQuickTabOrder(targetOriginTabId, targetGroup);
    }
    return;
  }

  // Cross-tab transfer or duplicate (use cached modifier key)
  const isDuplicate = _isModifierKeyPressed(event);

  console.log('[Manager] DROP: Cross-tab operation', {
    quickTabId: _dragState.quickTabId,
    fromTabId: _dragState.originTabId,
    toTabId: targetOriginTabId,
    isDuplicate,
    timestamp: Date.now()
  });

  if (isDuplicate) {
    if (_callbacks.duplicateQuickTab) {
      _callbacks.duplicateQuickTab(_dragState.quickTabData, parseInt(targetOriginTabId, 10));
    }
  } else {
    if (_callbacks.transferQuickTab) {
      _callbacks.transferQuickTab(_dragState.quickTabId, parseInt(targetOriginTabId, 10));
    }
  }
}

/**
 * Handle tab group reordering (DOM only)
 * v1.6.4 - FEATURE #2: Tab group visual reorder
 * @private
 * @param {HTMLElement} targetGroup - Target group to drop before/after
 */
function _handleTabGroupReorder(targetGroup) {
  const draggedGroup = _dragState.draggedElement;
  if (!draggedGroup || draggedGroup === targetGroup) return;

  const container = draggedGroup.parentElement;
  const groups = Array.from(container.children);
  const draggedIndex = groups.indexOf(draggedGroup);
  const targetIndex = groups.indexOf(targetGroup);

  console.log('[Manager] REORDER: Tab groups', {
    fromIndex: draggedIndex,
    toIndex: targetIndex,
    fromTabId: draggedGroup.dataset.originTabId,
    toTabId: targetGroup.dataset.originTabId
  });

  // Move in DOM
  if (draggedIndex < targetIndex) {
    targetGroup.after(draggedGroup);
  } else {
    targetGroup.before(draggedGroup);
  }

  // v1.6.4 - FIX BUG #4: Save user's preferred group order
  if (_callbacks.saveGroupOrder) {
    _callbacks.saveGroupOrder(container);
  }
}

// ==================== QUICK TAB DRAG HANDLERS ====================

/**
 * Handle drag start for Quick Tab items
 * v1.6.4 - FEATURE #2/#3/#5: Quick Tab drag with transfer/duplicate
 * @private
 * @param {DragEvent} event - Drag event
 * @param {HTMLElement} item - Quick Tab item element
 */
function _handleQuickTabDragStart(event, item) {
  const quickTabId = item.dataset.tabId;

  // Find the Quick Tab data using callback
  const quickTabData = _callbacks.getQuickTabData ? _callbacks.getQuickTabData(quickTabId) : null;

  if (!quickTabData) {
    console.warn('[Manager] DRAG_START: Quick Tab data not found', { quickTabId });
    event.preventDefault();
    return;
  }

  // Check modifier key for duplicate (use cached modifier key)
  const isDuplicate = _isModifierKeyPressed(event);

  console.log('[Manager] DRAG_START: Quick Tab', {
    quickTabId,
    originTabId: quickTabData.originTabId,
    isDuplicate,
    modifierKey: _cachedDuplicateModifierKey,
    timestamp: Date.now()
  });

  _dragState.draggedElement = item;
  _dragState.dragType = 'quick-tab';
  _dragState.quickTabId = quickTabId;
  _dragState.originTabId = quickTabData.originTabId;
  _dragState.quickTabData = quickTabData;
  _dragState.isDuplicate = isDuplicate;

  item.classList.add('dragging');

  // Set drag data
  event.dataTransfer.effectAllowed = isDuplicate ? 'copy' : 'move';
  event.dataTransfer.setData(
    'text/plain',
    JSON.stringify({
      type: 'quick-tab',
      quickTabId,
      originTabId: quickTabData.originTabId,
      isDuplicate
    })
  );
}

/**
 * Handle drag over for Quick Tab items (for reordering within group)
 * v1.6.4 - FEATURE #2: Reorder visual feedback
 * @private
 * @param {DragEvent} event - Drag event
 */
function _handleQuickTabDragOver(event) {
  event.preventDefault();

  if (_dragState.dragType !== 'quick-tab') return;

  const targetItem = event.currentTarget;
  if (targetItem === _dragState.draggedElement) return;

  // Remove existing classes
  targetItem.classList.remove('drag-over', 'drag-over-bottom');

  // Determine if dropping above or below based on mouse position
  const rect = targetItem.getBoundingClientRect();
  const midpoint = rect.top + rect.height / 2;

  if (event.clientY < midpoint) {
    targetItem.classList.add('drag-over');
  } else {
    targetItem.classList.add('drag-over-bottom');
  }

  event.dataTransfer.dropEffect = 'move';
}

/**
 * Handle drag leave for Quick Tab items
 * v1.6.4 - FEATURE #2: Remove reorder visual feedback
 * @private
 * @param {DragEvent} event - Drag event
 */
function _handleQuickTabDragLeave(event) {
  const targetItem = event.currentTarget;
  targetItem.classList.remove('drag-over', 'drag-over-bottom');
}

/**
 * Handle cross-group drop for Quick Tab transfer/duplicate
 * v1.6.4 - FIX Code Health: Extracted to reduce _handleQuickTabDrop complexity
 * @private
 * @param {DragEvent} event - Drop event
 * @param {HTMLElement} targetGroup - Target group element
 */
function _handleCrossGroupDrop(event, targetGroup) {
  const targetOriginTabId = targetGroup.dataset.originTabId;
  const isDuplicate = _isModifierKeyPressed(event);

  console.log('[Manager] DROP: Cross-tab operation (via Quick Tab item)', {
    quickTabId: _dragState.quickTabId,
    fromTabId: _dragState.originTabId,
    toTabId: targetOriginTabId,
    isDuplicate,
    timestamp: Date.now()
  });

  const targetTabIdNum = parseInt(targetOriginTabId, 10);

  if (isDuplicate && _callbacks.duplicateQuickTab) {
    _callbacks.duplicateQuickTab(_dragState.quickTabData, targetTabIdNum);
  } else if (!isDuplicate && _callbacks.transferQuickTab) {
    _callbacks.transferQuickTab(_dragState.quickTabId, targetTabIdNum);
  }
}

/**
 * Handle same-group reorder for Quick Tabs
 * v1.6.4 - FIX Code Health: Extracted to reduce _handleQuickTabDrop complexity
 * @private
 * @param {DragEvent} event - Drop event
 * @param {HTMLElement} targetItem - Target item element
 * @param {HTMLElement} draggedItem - Dragged item element
 * @param {HTMLElement} targetGroup - Target group element
 */
function _handleSameGroupReorder(event, targetItem, draggedItem, targetGroup) {
  const rect = targetItem.getBoundingClientRect();
  const midpoint = rect.top + rect.height / 2;

  console.log('[Manager] REORDER: Quick Tab items', {
    draggedId: _dragState.quickTabId,
    targetId: targetItem.dataset.tabId,
    dropPosition: event.clientY < midpoint ? 'before' : 'after'
  });

  if (event.clientY < midpoint) {
    targetItem.before(draggedItem);
  } else {
    targetItem.after(draggedItem);
  }

  // v1.6.4 - FIX BUG #3: Save Quick Tab order after reorder within same group
  const originTabId = targetGroup.dataset.originTabId;
  if (_callbacks.saveQuickTabOrder) {
    _callbacks.saveQuickTabOrder(originTabId, targetGroup);
  }
}

/**
 * Handle drop on Quick Tab items (for reordering within group OR cross-tab transfer)
 * v1.6.4 - FEATURE #2/#3: Reorder Quick Tabs within group or transfer across tabs
 * v1.6.4 - FIX BUG #3b: Handle cross-tab transfer here since stopPropagation prevents tab group handler
 * v1.6.4 - FIX BUG #3: Save Quick Tab order after same-group reorder
 * v1.6.4 - FIX Code Health: Extracted helpers to reduce complexity (cc=11 -> cc=5)
 * @private
 * @param {DragEvent} event - Drop event
 */
function _handleQuickTabDrop(event) {
  event.preventDefault();
  event.stopPropagation(); // Prevent bubbling to tab group

  if (_dragState.dragType !== 'quick-tab') return;

  const targetItem = event.currentTarget;
  const draggedItem = _dragState.draggedElement;

  if (!draggedItem || targetItem === draggedItem) return;

  targetItem.classList.remove('drag-over', 'drag-over-bottom');

  // Check if same parent group (reorder) or different group (transfer)
  const draggedGroup = draggedItem.closest('.tab-group');
  const targetGroup = targetItem.closest('.tab-group');

  if (draggedGroup !== targetGroup) {
    _handleCrossGroupDrop(event, targetGroup);
    return;
  }

  _handleSameGroupReorder(event, targetItem, draggedItem, targetGroup);
}

// ==================== DRAG END / CLEANUP ====================

/**
 * Handle drag end - cleanup drag state
 * v1.6.4 - FEATURE #2/#3/#5: Cleanup after drag
 * @private
 */
function _handleDragEnd() {
  console.log('[Manager] DRAG_END:', {
    dragType: _dragState.dragType,
    timestamp: Date.now()
  });

  // Remove all drag classes
  document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  document
    .querySelectorAll('.drag-over-bottom')
    .forEach(el => el.classList.remove('drag-over-bottom'));
  document.querySelectorAll('.drag-transfer').forEach(el => el.classList.remove('drag-transfer'));
  document.querySelectorAll('.drag-duplicate').forEach(el => el.classList.remove('drag-duplicate'));
  document.querySelectorAll('.drag-invalid').forEach(el => el.classList.remove('drag-invalid'));

  // Reset drag state
  _dragState.draggedElement = null;
  _dragState.dragType = null;
  _dragState.quickTabId = null;
  _dragState.originTabId = null;
  _dragState.quickTabData = null;
  _dragState.isDuplicate = false;
}

/**
 * Get current drag state (for external inspection/testing)
 * @returns {Object} Current drag state (read-only copy)
 */
function getDragState() {
  return { ..._dragState };
}

/**
 * Reset drag state (for cleanup/testing)
 */
function resetDragState() {
  _handleDragEnd();
}

// ==================== INITIALIZATION ====================

/**
 * Initialize the DragDropManager
 * Loads settings and prepares for drag operations
 */
async function initialize() {
  await _loadDuplicateModifierKey();
}

// ==================== EXPORTS ====================

export {
  // Initialization
  initialize,
  _loadDuplicateModifierKey,

  // Event listener attachment
  attachDragDropEventListeners,

  // State access
  getDragState,
  resetDragState,
  getCachedModifierKey,

  // For testing
  _isModifierKeyPressed,
  _dragState
};
