/**
 * Shadow DOM Traversal Utilities
 * v1.6.3.11-v4 - FIX Issue #1: Shadow DOM link detection for web components
 *
 * Provides helpers for traversing Shadow DOM boundaries to find links
 * in platforms like YouTube, Twitter, Instagram that use web components.
 */

// ==================== SHADOW DOM TRAVERSAL CONSTANTS ====================
/**
 * Maximum depth for Shadow DOM traversal to prevent infinite recursion
 */
const SHADOW_DOM_MAX_DEPTH = 5;

// ==================== SHADOW DOM TRAVERSAL HELPERS ====================

/**
 * Log max depth reached
 * @private
 */
function _logMaxDepthReached(element) {
  console.log('[SHADOW_DOM_SEARCH] MAX_DEPTH_REACHED:', {
    maxDepth: SHADOW_DOM_MAX_DEPTH,
    element: element?.tagName || 'null'
  });
}

/**
 * Safely access shadow root (handles cross-origin errors)
 * @private
 * @param {Element} element - Element with shadowRoot
 * @returns {ShadowRoot|null} Shadow root or null if inaccessible
 */
function _getShadowRootSafe(element) {
  try {
    return element.shadowRoot;
  } catch (err) {
    console.log('[SHADOW_DOM_SEARCH] SECURITY_ERROR:', {
      error: err.message,
      element: element.tagName
    });
    return null;
  }
}

/**
 * Search children within a shadow root
 * @private
 * @param {ShadowRoot} shadowRoot - Shadow root to search
 * @param {string} selector - CSS selector
 * @param {number} depth - Current depth
 * @returns {Element|null} Found element or null
 */
function _searchShadowChildren(shadowRoot, selector, depth) {
  const shadowChildren = shadowRoot.querySelectorAll('*');
  for (const child of shadowChildren) {
    const found = findLinkInShadowDOM(child, selector, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Try to find link in shadow root of element
 * @private
 * @param {Element} element - Element with shadowRoot
 * @param {string} selector - CSS selector
 * @param {number} depth - Current depth
 * @returns {Element|null} Found element or null
 */
function _searchShadowRoot(element, selector, depth) {
  // Get shadow root with error handling
  const shadowRoot = _getShadowRootSafe(element);
  if (!shadowRoot) return null;

  // Direct search in shadow root
  const shadowLink = shadowRoot.querySelector(selector);
  if (shadowLink) {
    console.log('[SHADOW_DOM_SEARCH] SHADOW_MATCH_FOUND:', {
      tag: shadowLink.tagName,
      href: shadowLink.href || 'no-href',
      depth
    });
    return shadowLink;
  }

  // Recursive search in shadow children
  return _searchShadowChildren(shadowRoot, selector, depth);
}

/**
 * Get next parent element, crossing shadow boundaries if needed
 * @private
 * @param {Element} current - Current element
 * @param {number} level - Current level
 * @returns {Element|null} Parent element or null
 */
function _getNextParent(current, level) {
  if (current.parentElement) {
    return current.parentElement;
  }

  // Check if we can cross shadow boundary
  const rootNode = current.getRootNode?.();
  if (rootNode instanceof ShadowRoot) {
    console.log('[SHADOW_DOM_SEARCH] CROSSING_SHADOW_BOUNDARY:', {
      newHost: rootNode.host?.tagName || 'null',
      level
    });
    return rootNode.host;
  }

  return null;
}

// ==================== SHADOW DOM TRAVERSAL FUNCTIONS ====================

/**
 * Search for links within Shadow DOM boundaries
 * v1.6.3.11-v4 - FIX Issue #1: YouTube, Twitter, Instagram use Shadow DOM
 *
 * @param {Element} element - Starting element to search from
 * @param {string} selector - CSS selector to find (default: 'a[href]')
 * @param {number} depth - Current recursion depth
 * @returns {Element|null} Found link element or null
 */
export function findLinkInShadowDOM(element, selector = 'a[href]', depth = 0) {
  // Guard: null element or max depth
  if (!element) return null;
  if (depth > SHADOW_DOM_MAX_DEPTH) {
    _logMaxDepthReached(element);
    return null;
  }

  console.log('[SHADOW_DOM_SEARCH] Searching element:', {
    tag: element.tagName,
    depth,
    hasShadowRoot: !!element.shadowRoot
  });

  // Check if element itself matches
  if (element.matches?.(selector)) {
    console.log('[SHADOW_DOM_SEARCH] MATCH_FOUND: Element matches selector directly');
    return element;
  }

  // Check shadow root if present - ONLY search Shadow DOM, not regular children
  if (element.shadowRoot) {
    const shadowResult = _searchShadowRoot(element, selector, depth);
    if (shadowResult) return shadowResult;
  }

  // Note: We do NOT search regular children here to avoid behavioral change
  // Regular DOM children should be searched by the caller using querySelector

  return null;
}

/**
 * Traverse up the DOM tree including Shadow DOM boundaries
 * v1.6.3.11-v4 - FIX Issue #1: Find parent links across shadow boundaries
 *
 * @param {Element} element - Starting element
 * @param {string} selector - CSS selector for matching
 * @param {number} maxLevels - Maximum parent levels to traverse
 * @returns {Element|null} Found parent element or null
 */
export function findClosestAcrossShadow(element, selector = 'a[href]', maxLevels = 10) {
  if (!element) return null;

  let current = element;
  let level = 0;

  while (current && level < maxLevels) {
    // Check if current element matches
    if (current.matches?.(selector)) {
      console.log('[SHADOW_DOM_SEARCH] PARENT_MATCH:', {
        tag: current.tagName,
        level,
        href: current.href || 'no-href'
      });
      return current;
    }

    // Try shadow root search ONLY if element has a shadow root
    const shadowResult = _searchElementShadowRoot(current, selector);
    if (shadowResult) return shadowResult;

    // Move to parent (handle shadow boundary)
    current = _getNextParent(current, level);
    level++;
  }

  return null;
}

/**
 * Search element's shadow root if it exists
 * v1.6.3.11-v4 - Extracted to reduce nesting
 * @private
 */
function _searchElementShadowRoot(element, selector) {
  if (!element.shadowRoot) return null;
  return findLinkInShadowDOM(element, selector, 0);
}
