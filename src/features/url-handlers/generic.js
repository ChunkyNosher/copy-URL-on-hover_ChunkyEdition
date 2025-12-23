/**
 * Generic URL Handler
 * Fallback URL detection for any website
 *
 * v1.6.3.11-v4 Changes:
 * - FIX Issue #1: Added Shadow DOM fallback for web components
 * - FIX Issue #3: Added [URL_EXTRACT] logging prefix
 */

import { findLinkInShadowDOM, findClosestAcrossShadow } from './shadow-dom.js';

/**
 * Check if element is a container that should be searched for links
 * @param {Element} element - DOM element
 * @returns {boolean} True if element is a link container
 */
function isLinkContainer(element) {
  return (
    element.tagName === 'ARTICLE' ||
    element.getAttribute('role') === 'article' ||
    element.getAttribute('role') === 'link' ||
    element.classList.contains('post') ||
    element.hasAttribute('data-testid') ||
    element.hasAttribute('data-id')
  );
}

/**
 * Find generic URL from any element
 * v1.6.3.11-v4 - FIX Issue #1: Added Shadow DOM fallback
 * @param {Element} element - DOM element
 * @returns {string|null} Found URL or null
 */
export function findGenericUrl(element) {
  // Look for direct href on clicked element
  if (element.href) {
    console.log('[URL_EXTRACT] GENERIC_DIRECT_HREF:', { href: element.href });
    return element.href;
  }

  // Look for closest link (regular DOM)
  const link = element.closest('a[href]');
  if (link?.href) {
    console.log('[URL_EXTRACT] GENERIC_CLOSEST_LINK:', { href: link.href });
    return link.href;
  }

  // v1.6.3.11-v4 - FIX Issue #1: Try Shadow DOM parent traversal
  // Only if element itself has no shadowRoot - avoid duplicate child search
  const shadowParentLink = findClosestAcrossShadow(element.parentElement, 'a[href]', 10);
  if (shadowParentLink?.href) {
    console.log('[URL_EXTRACT] GENERIC_SHADOW_DOM:', { href: shadowParentLink.href });
    return shadowParentLink.href;
  }

  // Only search within element if it's a clear container
  if (isLinkContainer(element)) {
    const containerResult = _searchContainerForLink(element);
    if (containerResult) return containerResult;
  }

  // Don't search siblings - that's too broad and causes false positives
  console.log('[URL_EXTRACT] GENERIC_NO_RESULT');
  return null;
}

/**
 * Search container element for links (including Shadow DOM)
 * v1.6.3.11-v4 - Extracted to reduce nesting
 * @private
 */
function _searchContainerForLink(element) {
  const innerLink = element.querySelector('a[href]');
  if (innerLink?.href) {
    console.log('[URL_EXTRACT] GENERIC_CONTAINER_INNER:', { href: innerLink.href });
    return innerLink.href;
  }

  // Search container's Shadow DOM only if it has one
  if (!element.shadowRoot) return null;

  const shadowInnerLink = findLinkInShadowDOM(element, 'a[href]', 0);
  if (shadowInnerLink?.href) {
    console.log('[URL_EXTRACT] GENERIC_CONTAINER_SHADOW:', { href: shadowInnerLink.href });
    return shadowInnerLink.href;
  }

  return null;
}

/**
 * Get link text from element
 * v1.6.0.1 - Improved handling of empty text and edge cases
 * @param {Element} element - DOM element
 * @returns {string} Link text
 */
export function getLinkText(element) {
  if (!element) {
    return '';
  }

  // Try direct text from link
  if (element.tagName === 'A') {
    const text = element.textContent.trim();
    if (text) return text;
  }

  // Try finding link within element
  const link = element.querySelector('a[href]');
  if (link) {
    const text = link.textContent.trim();
    if (text) return text;
  }

  // Fallback to element's text content
  const text = element.textContent.trim();
  return text ? text.substring(0, 100) : '';
}
