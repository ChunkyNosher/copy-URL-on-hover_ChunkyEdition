/**
 * Generic URL Handler
 * Fallback URL detection for any website
 */

import { debug } from '../../utils/debug.js';

/**
 * Find generic URL from any element
 * @param {Element} element - DOM element
 * @returns {string|null} Found URL or null
 */
export function findGenericUrl(element) {
  // Look for direct href on clicked element
  if (element.href) return element.href;

  // Look for closest link
  const link = element.closest('a[href]');
  if (link?.href) return link.href;

  // Only search within element if it's a clear container (article, div with specific roles, etc.)
  // Don't search for unrelated links
  if (
    element.tagName === 'ARTICLE' ||
    element.getAttribute('role') === 'article' ||
    element.getAttribute('role') === 'link' ||
    element.classList.contains('post') ||
    element.hasAttribute('data-testid') ||
    element.hasAttribute('data-id')
  ) {
    const innerLink = element.querySelector('a[href]');
    if (innerLink?.href) return innerLink.href;
  }

  // Don't search siblings - that's too broad and causes false positives
  return null;
}

/**
 * Get link text from element
 * @param {Element} element - DOM element
 * @returns {string} Link text
 */
export function getLinkText(element) {
  if (element.tagName === 'A') {
    return element.textContent.trim();
  }

  const link = element.querySelector('a[href]');
  if (link) {
    return link.textContent.trim();
  }

  return element.textContent.trim().substring(0, 100);
}
