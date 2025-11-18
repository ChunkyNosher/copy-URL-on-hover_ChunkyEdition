/**
 * URL Handler Registry
 * Main entry point for URL detection across all supported sites
 */

import { bloggingHandlers } from './blogging.js';
import { developerHandlers } from './developer.js';
import { ecommerceHandlers } from './ecommerce.js';
import { entertainmentHandlers } from './entertainment.js';
import { gamingHandlers } from './gaming.js';
import { findGenericUrl } from './generic.js';
import { image_designHandlers } from './image-design.js';
import { learningHandlers } from './learning.js';
import { news_discussionHandlers } from './news-discussion.js';
import { otherHandlers } from './other.js';
import { social_mediaHandlers } from './social-media.js';
import { videoHandlers } from './video.js';

/**
 * URL Handler Registry
 * Manages URL detection for all supported sites
 */
export class URLHandlerRegistry {
  constructor() {
    // Merge all handler categories
    this.handlers = {
      ...social_mediaHandlers,
      ...videoHandlers,
      ...developerHandlers,
      ...bloggingHandlers,
      ...ecommerceHandlers,
      ...image_designHandlers,
      ...news_discussionHandlers,
      ...entertainmentHandlers,
      ...gamingHandlers,
      ...learningHandlers,
      ...otherHandlers
    };
  }

  /**
   * Find URL for an element based on domain type
   * @param {Element} element - DOM element
   * @param {string} domainType - Domain type (e.g., 'twitter', 'github')
   * @returns {string|null} Found URL or null
   */
  findURL(element, domainType) {
    // Try direct link first
    if (element.tagName === 'A' && element.href) {
      return element.href;
    }

    // Check parents for href (up to 20 levels)
    let parent = element.parentElement;
    for (let i = 0; i < 20; i++) {
      if (!parent) break;
      if (parent.tagName === 'A' && parent.href) {
        return parent.href;
      }
      parent = parent.parentElement;
    }

    // Try site-specific handler
    if (this.handlers[domainType]) {
      const url = this.handlers[domainType](element);
      if (url) return url;
    }

    // Final fallback - find ANY link
    return findGenericUrl(element);
  }

  /**
   * Get all supported domain types
   * @returns {string[]} Array of supported domain types
   */
  getSupportedDomains() {
    return Object.keys(this.handlers);
  }

  /**
   * Check if a domain type is supported
   * @param {string} domainType - Domain type to check
   * @returns {boolean} True if supported
   */
  isSupported(domainType) {
    // Use 'in' operator instead of hasOwnProperty (ESLint compliant)
    return domainType in this.handlers;
  }
}
