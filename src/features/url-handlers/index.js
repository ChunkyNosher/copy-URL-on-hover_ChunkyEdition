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
   * Log detection start
   */
  _logDetectionStart(element, domainType) {
    console.log('[URL Detection] [Start] Detecting URL for element', {
      elementTag: element?.tagName || '<none>',
      elementId: element?.id || '<none>',
      elementClasses: element?.className || '<none>',
      domainType: domainType,
      availableHandlers: this.isSupported(domainType) ? 'yes' : 'no',
      timestamp: Date.now()
    });
  }

  /**
   * Try to find URL in parent elements
   */
  _findInParents(element) {
    console.log('[URL Detection] [Hierarchy] Element not direct link, checking parent elements');

    let parent = element.parentElement;
    let levelsTraversed = 0;
    
    for (let i = 0; i < 20; i++) {
      if (!parent) {
        console.log('[URL Detection] [Hierarchy] No more parent elements to check', {
          levelsTraversed: levelsTraversed,
          timestamp: Date.now()
        });
        break;
      }
      
      levelsTraversed++;
      
      if (parent.tagName === 'A' && parent.href) {
        console.log('[URL Detection] [Success] Anchor link found in parent', {
          url: parent.href,
          method: 'parent-anchor',
          levelsUp: levelsTraversed,
          parentTag: parent.tagName,
          timestamp: Date.now()
        });
        return parent.href;
      }
      parent = parent.parentElement;
    }
    
    return null;
  }

  /**
   * Try site-specific handler
   */
  _trySiteHandler(element, domainType) {
    console.log('[URL Detection] [Handler] Trying site-specific handler', {
      domainType: domainType,
      hasHandler: this.isSupported(domainType),
      timestamp: Date.now()
    });

    if (!this.handlers[domainType]) {
      return null;
    }

    const handlerStart = performance.now();
    const url = this.handlers[domainType](element);
    const handlerDuration = performance.now() - handlerStart;
    
    if (url) {
      console.log('[URL Detection] [Success] Site-specific handler found URL', {
        url: url,
        domainType: domainType,
        method: 'site-specific-handler',
        handlerTime: `${handlerDuration.toFixed(2)}ms`,
        timestamp: Date.now()
      });
      return url;
    }
    
    console.log('[URL Detection] [Handler] Site-specific handler returned null', {
      domainType: domainType,
      handlerTime: `${handlerDuration.toFixed(2)}ms`,
      timestamp: Date.now()
    });
    
    return null;
  }

  /**
   * Try generic URL finder
   */
  _tryGenericFinder(element, domainType) {
    console.log('[URL Detection] [Fallback] Trying generic URL finder', {
      timestamp: Date.now()
    });

    const genericStart = performance.now();
    const genericUrl = findGenericUrl(element);
    const genericDuration = performance.now() - genericStart;
    
    if (genericUrl) {
      console.log('[URL Detection] [Success] Generic handler found URL', {
        url: genericUrl,
        method: 'generic-fallback',
        handlerTime: `${genericDuration.toFixed(2)}ms`,
        timestamp: Date.now()
      });
    } else {
      console.log('[URL Detection] [Failure] No URL found by any method', {
        domainType: domainType,
        elementTag: element?.tagName || '<none>',
        elementHTML: element?.outerHTML?.substring(0, 200) || '<none>',
        timestamp: Date.now()
      });
    }
    
    return genericUrl;
  }

  /**
   * Find URL for an element based on domain type
   * v1.6.0.7 - Enhanced logging for URL detection process
   * @param {Element} element - DOM element
   * @param {string} domainType - Domain type (e.g., 'twitter', 'github')
   * @returns {string|null} Found URL or null
   */
  findURL(element, domainType) {
    this._logDetectionStart(element, domainType);

    // Try direct link first
    if (element.tagName === 'A' && element.href) {
      console.log('[URL Detection] [Success] Direct anchor link found', {
        url: element.href,
        method: 'direct-anchor',
        timestamp: Date.now()
      });
      return element.href;
    }

    // Check parents for href
    const parentUrl = this._findInParents(element);
    if (parentUrl) return parentUrl;

    // Try site-specific handler
    const siteUrl = this._trySiteHandler(element, domainType);
    if (siteUrl) return siteUrl;

    // Final fallback - find ANY link
    return this._tryGenericFinder(element, domainType);
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
