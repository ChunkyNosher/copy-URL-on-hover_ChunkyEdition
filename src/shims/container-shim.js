/**
 * Firefox Container API shim for browsers that don't support it
 * Provides a graceful fallback for Chrome/Edge/etc.
 * 
 * Firefox has contextualIdentities API for container isolation.
 * Chrome has no equivalent, so we provide a shim that returns a default container.
 */

export class ContainerShim {
  constructor() {
    this.supported = false;
    this.defaultContainer = {
      cookieStoreId: 'firefox-default',
      name: 'Default',
      icon: 'fingerprint',
      iconUrl: '',
      color: 'blue',
      colorCode: '#37adff'
    };
  }

  /**
   * Get container by ID
   * @param {string} _cookieStoreId - Unused in shim, accepts for API compatibility
   * @returns {Promise<object>}
   */
  get(_cookieStoreId) {
    // Always return default container for non-Firefox browsers
    return Promise.resolve(this.defaultContainer);
  }

  /**
   * Query all containers
   * @returns {Promise<Array>}
   */
  query() {
    // Chrome doesn't have containers, return single default
    return Promise.resolve([this.defaultContainer]);
  }

  /**
   * Check if containers are supported
   * @returns {boolean}
   */
  isSupported() {
    return false;
  }
}

/**
 * Get the appropriate container API
 * @returns {object} Native API or shim
 */
export function getContainerAPI() {
  // Check if we're on Firefox with container support
  if (typeof browser !== 'undefined' && browser.contextualIdentities) {
    return {
      ...browser.contextualIdentities,
      isSupported: () => true
    };
  }
  
  // Return shim for Chrome/Edge/etc.
  return new ContainerShim();
}
