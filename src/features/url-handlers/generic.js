/**
 * Generic URL Handler
 * Fallback URL detection for any website
 */

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
 * @param {Element} element - DOM element
 * @returns {string|null} Found URL or null
 */
export function findGenericUrl(element) {
  // Look for direct href on clicked element
  if (element.href) return element.href;

  // Look for closest link
  const link = element.closest('a[href]');
  if (link?.href) return link.href;

  // Only search within element if it's a clear container
  if (isLinkContainer(element)) {
    const innerLink = element.querySelector('a[href]');
    if (innerLink?.href) return innerLink.href;
  }

  // Don't search siblings - that's too broad and causes false positives
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
