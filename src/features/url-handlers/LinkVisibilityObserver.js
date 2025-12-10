/**
 * LinkVisibilityObserver - IntersectionObserver-based Lazy Link Processing
 * v1.6.4.14 - Phase 3A Optimization #6: Content Script Lazy Loading
 *
 * Purpose: Optimize CPU usage on link-heavy pages by only tracking visible links.
 * Links outside the viewport don't need hover handlers until they become visible.
 *
 * Features:
 * - Uses IntersectionObserver API for efficient visibility detection
 * - Only activates hover processing for links in viewport
 * - Skips hover handlers on off-screen elements
 * - Minimal memory footprint with WeakSet tracking
 * - Graceful fallback if IntersectionObserver unavailable
 *
 * Architecture:
 * - Observer watches all anchor elements on page
 * - When link enters viewport, it's marked as "active" for hover
 * - When link leaves viewport, it's marked as "inactive"
 * - Hover handler checks visibility state before processing
 *
 * @module LinkVisibilityObserver
 */

// Configuration constants
const ROOT_MARGIN = '50px'; // Preload links slightly before they enter viewport
const VISIBILITY_THRESHOLD = 0.1; // Consider visible when 10% intersects
const MUTATION_DEBOUNCE_MS = 100; // Debounce DOM mutation observations

// State
let _observer = null;
let _mutationObserver = null;
let _visibleLinks = new WeakSet();
let _isActive = false;
let _mutationDebounceTimer = null;
let _linkSelector = 'a[href]';
let _observerSupported = false;

// Metrics tracking
const _metrics = {
  linksObserved: 0,
  linksEnteredViewport: 0,
  linksLeftViewport: 0,
  hoverChecksSkipped: 0,
  hoverChecksProcessed: 0,
  startTime: 0
};

// Debug flag
const DEBUG_VISIBILITY = false;

/**
 * Log visibility operation if debug is enabled
 * @private
 * @param {string} operation - Operation name
 * @param {Object} details - Operation details
 */
function _logVisibilityOperation(operation, details = {}) {
  if (!DEBUG_VISIBILITY) return;
  console.log(`[LinkVisibilityObserver] ${operation}:`, {
    ...details,
    timestamp: Date.now()
  });
}

/**
 * Check if IntersectionObserver API is available
 * @returns {boolean} True if API is available
 */
function _isIntersectionObserverAvailable() {
  return (
    typeof IntersectionObserver !== 'undefined' &&
    typeof IntersectionObserverEntry !== 'undefined'
  );
}

/**
 * Handle intersection changes for observed links
 * @private
 * @param {IntersectionObserverEntry[]} entries - Intersection entries
 */
function _handleIntersection(entries) {
  for (const entry of entries) {
    const link = entry.target;

    if (entry.isIntersecting) {
      // Link entered viewport
      _visibleLinks.add(link);
      _metrics.linksEnteredViewport++;

      _logVisibilityOperation('LINK_ENTERED_VIEWPORT', {
        href: link.href?.substring(0, 50) || '<no href>',
        intersectionRatio: entry.intersectionRatio.toFixed(2)
      });
    } else {
      // Link left viewport
      _visibleLinks.delete(link);
      _metrics.linksLeftViewport++;

      _logVisibilityOperation('LINK_LEFT_VIEWPORT', {
        href: link.href?.substring(0, 50) || '<no href>'
      });
    }
  }
}

/**
 * Observe a single link element
 * @private
 * @param {Element} link - Link element to observe
 */
function _observeLink(link) {
  if (!_observer || !link) return;

  try {
    _observer.observe(link);
    _metrics.linksObserved++;
  } catch (err) {
    // Ignore errors for invalid elements
    _logVisibilityOperation('OBSERVE_ERROR', {
      error: err.message
    });
  }
}

/**
 * Observe all existing links on the page
 * @private
 */
function _observeExistingLinks() {
  const links = document.querySelectorAll(_linkSelector);

  _logVisibilityOperation('OBSERVING_EXISTING_LINKS', {
    count: links.length
  });

  links.forEach(link => _observeLink(link));
}

/**
 * Handle DOM mutations to observe newly added links
 * @private
 * @param {MutationRecord[]} mutations - DOM mutations
 */
function _handleMutations(mutations) {
  // Debounce mutation handling
  if (_mutationDebounceTimer) {
    clearTimeout(_mutationDebounceTimer);
  }

  _mutationDebounceTimer = setTimeout(() => {
    _processMutations(mutations);
    _mutationDebounceTimer = null;
  }, MUTATION_DEBOUNCE_MS);
}

/**
 * Process a single added node for link observation
 * @private
 * @param {Node} node - DOM node to check
 * @returns {number} Number of links found and observed
 */
function _processAddedNode(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return 0;

  let linksFound = 0;

  // Check if node is a link
  if (node.matches && node.matches(_linkSelector)) {
    _observeLink(node);
    linksFound++;
  }

  // Check children for links
  if (node.querySelectorAll) {
    const childLinks = node.querySelectorAll(_linkSelector);
    childLinks.forEach(link => {
      _observeLink(link);
      linksFound++;
    });
  }

  return linksFound;
}

/**
 * Process DOM mutations after debounce
 * @private
 * @param {MutationRecord[]} mutations - DOM mutations
 */
function _processMutations(mutations) {
  let newLinksFound = 0;

  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      newLinksFound += _processAddedNode(node);
    }
  }

  if (newLinksFound > 0) {
    _logVisibilityOperation('NEW_LINKS_OBSERVED', {
      count: newLinksFound
    });
  }
}

/**
 * Initialize the LinkVisibilityObserver
 * Sets up IntersectionObserver and MutationObserver
 *
 * @param {Object} options - Configuration options
 * @param {string} options.linkSelector - CSS selector for links (default: 'a[href]')
 * @param {string} options.rootMargin - Root margin for observer (default: '50px')
 * @returns {boolean} True if initialization succeeded
 */
export function initialize(options = {}) {
  if (_isActive) {
    console.warn('[LinkVisibilityObserver] Already initialized');
    return false;
  }

  // Check for API support
  if (!_isIntersectionObserverAvailable()) {
    console.warn('[LinkVisibilityObserver] IntersectionObserver not supported');
    _observerSupported = false;
    // Still mark as active so isLinkVisible returns true as fallback
    _isActive = true;
    return false;
  }

  _observerSupported = true;
  _linkSelector = options.linkSelector || _linkSelector;

  // Create IntersectionObserver
  _observer = new IntersectionObserver(_handleIntersection, {
    root: null, // Use viewport
    rootMargin: options.rootMargin || ROOT_MARGIN,
    threshold: VISIBILITY_THRESHOLD
  });

  // Create MutationObserver for dynamic content
  // Note: Observing document.body with subtree: true is necessary to catch
  // dynamically loaded links (e.g., infinite scroll, SPA navigation).
  // The performance impact is mitigated by debouncing (MUTATION_DEBOUNCE_MS)
  // and early-exiting for non-element nodes.
  _mutationObserver = new MutationObserver(_handleMutations);
  _mutationObserver.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Observe existing links
  _observeExistingLinks();

  _isActive = true;
  _metrics.startTime = Date.now();

  console.log('[LinkVisibilityObserver] Initialized:', {
    linksObserved: _metrics.linksObserved,
    observerSupported: _observerSupported
  });

  return true;
}

/**
 * Check if a link is currently visible in viewport
 * This should be called by hover handlers before processing
 *
 * @param {Element} element - Element to check (typically the hover target or its parent link)
 * @returns {boolean} True if link is visible (or if observer not supported)
 */
export function isLinkVisible(element) {
  // If observer not supported or not active, assume all visible (graceful fallback)
  if (!_observerSupported || !_isActive) {
    return true;
  }

  // Find the link element (if not already a link)
  let link = element;
  if (element.tagName !== 'A') {
    link = element.closest('a');
  }

  // If no link found, allow processing
  if (!link) {
    return true;
  }

  // Check if link is in visible set
  const isVisible = _visibleLinks.has(link);

  if (isVisible) {
    _metrics.hoverChecksProcessed++;
  } else {
    _metrics.hoverChecksSkipped++;
    _logVisibilityOperation('HOVER_CHECK_SKIPPED', {
      href: link.href?.substring(0, 50) || '<no href>'
    });
  }

  return isVisible;
}

/**
 * Force re-check of all links on the page
 * Useful after major DOM updates
 */
export function refresh() {
  if (!_observer) return;

  // Disconnect and reconnect
  _observer.disconnect();
  _visibleLinks = new WeakSet();
  _metrics.linksObserved = 0;

  // Re-observe all links
  _observeExistingLinks();

  _logVisibilityOperation('REFRESH_COMPLETED', {
    linksObserved: _metrics.linksObserved
  });
}

/**
 * Shut down the observer
 * Clean up all resources
 */
export function shutdown() {
  if (!_isActive) return;

  if (_observer) {
    _observer.disconnect();
    _observer = null;
  }

  if (_mutationObserver) {
    _mutationObserver.disconnect();
    _mutationObserver = null;
  }

  if (_mutationDebounceTimer) {
    clearTimeout(_mutationDebounceTimer);
    _mutationDebounceTimer = null;
  }

  _visibleLinks = new WeakSet();
  _isActive = false;

  console.log('[LinkVisibilityObserver] Shutdown complete');
}

/**
 * Get current metrics
 * @returns {Object} Current metrics
 */
export function getMetrics() {
  return {
    isActive: _isActive,
    observerSupported: _observerSupported,
    linksObserved: _metrics.linksObserved,
    linksEnteredViewport: _metrics.linksEnteredViewport,
    linksLeftViewport: _metrics.linksLeftViewport,
    hoverChecksSkipped: _metrics.hoverChecksSkipped,
    hoverChecksProcessed: _metrics.hoverChecksProcessed,
    skipRate:
      _metrics.hoverChecksSkipped + _metrics.hoverChecksProcessed > 0
        ? (
            (_metrics.hoverChecksSkipped /
              (_metrics.hoverChecksSkipped + _metrics.hoverChecksProcessed)) *
            100
          ).toFixed(1) + '%'
        : '0%',
    uptime: _metrics.startTime > 0 ? Date.now() - _metrics.startTime : 0
  };
}

/**
 * Check if observer is active
 * @returns {boolean} True if observer is active
 */
export function isActive() {
  return _isActive;
}

/**
 * Check if IntersectionObserver is supported
 * @returns {boolean} True if supported
 */
export function isSupported() {
  return _isIntersectionObserverAvailable();
}

// Export default object with all methods
export default {
  initialize,
  isLinkVisible,
  refresh,
  shutdown,
  getMetrics,
  isActive,
  isSupported
};
