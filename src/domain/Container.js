/**
 * Container Domain Entity
 * v1.6.0 - Firefox Multi-Account Containers support
 *
 * Represents a Firefox container (contextual identity) for state isolation.
 * Extracted from background.js to separate domain logic from infrastructure.
 */

export class Container {
  /**
   * Create a new Container instance
   * @param {Object} params - Container parameters
   * @param {string} params.id - Container ID (cookieStoreId)
   * @param {string} [params.name] - Human-readable container name
   * @param {string} [params.color] - Container color
   * @param {string} [params.icon] - Container icon
   */
  constructor({ id, name, color, icon }) {
    // Validation
    if (!id || typeof id !== 'string') {
      throw new Error('Container requires a valid string id');
    }

    this.id = id;
    this.name = name || this.getDefaultName(id);
    this.color = color || 'grey';
    this.icon = icon || 'circle';
  }

  /**
   * Get default name for a container ID
   * @private
   * @param {string} id - Container ID (cookieStoreId)
   * @returns {string} - Default name
   */
  getDefaultName(id) {
    if (id === 'firefox-default') {
      return 'Default';
    }
    if (id.startsWith('firefox-container-')) {
      const num = id.split('-').pop();
      return `Container ${num}`;
    }
    if (id.startsWith('firefox-private')) {
      return 'Private';
    }
    return 'Unknown Container';
  }

  /**
   * Check if this is the default container
   * @returns {boolean} - True if this is the default container
   */
  isDefault() {
    return this.id === 'firefox-default';
  }

  /**
   * Check if this is a private container
   * @returns {boolean} - True if this is a private browsing container
   */
  isPrivate() {
    return this.id.startsWith('firefox-private');
  }

  /**
   * Check if this is a custom container
   * @returns {boolean} - True if this is a custom multi-account container
   */
  isCustom() {
    return this.id.startsWith('firefox-container-');
  }

  /**
   * Get container number (for custom containers)
   * @returns {number|null} - Container number or null if not a custom container
   */
  getContainerNumber() {
    if (!this.isCustom()) {
      return null;
    }
    const match = this.id.match(/firefox-container-(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Validate container ID format
   * @static
   * @param {string} id - Container ID to validate
   * @returns {boolean} - True if valid Firefox container ID
   */
  static isValidId(id) {
    if (!id || typeof id !== 'string') {
      return false;
    }

    return (
      id === 'firefox-default' ||
      id.startsWith('firefox-container-') ||
      id.startsWith('firefox-private')
    );
  }

  /**
   * Sanitize container ID
   * Ensures the ID is a valid Firefox container ID
   *
   * @static
   * @param {string} id - Container ID to sanitize
   * @returns {string} - Sanitized container ID (defaults to 'firefox-default' if invalid)
   */
  static sanitize(id) {
    if (!id || typeof id !== 'string') {
      return 'firefox-default';
    }

    if (Container.isValidId(id)) {
      return id;
    }

    return 'firefox-default';
  }

  /**
   * Extract container number from ID
   * @static
   * @param {string} id - Container ID
   * @returns {number|null} - Container number or null
   */
  static extractNumber(id) {
    if (!id || typeof id !== 'string') {
      return null;
    }

    const match = id.match(/firefox-container-(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Create Container from Firefox contextualIdentities API response
   * @static
   * @param {Object} identity - Firefox contextualIdentities.get() response
   * @returns {Container} - Container domain entity
   */
  static fromContextualIdentity(identity) {
    return new Container({
      id: identity.cookieStoreId,
      name: identity.name,
      color: identity.color,
      icon: identity.icon
    });
  }

  /**
   * Create default container
   * @static
   * @returns {Container} - Default container
   */
  static default() {
    return new Container({
      id: 'firefox-default',
      name: 'Default',
      color: 'grey',
      icon: 'circle'
    });
  }

  /**
   * Serialize to storage format
   * @returns {Object} - Plain object suitable for storage
   */
  serialize() {
    return {
      id: this.id,
      name: this.name,
      color: this.color,
      icon: this.icon
    };
  }

  /**
   * Create Container from storage format
   * @static
   * @param {Object} data - Plain object from storage
   * @returns {Container} - Container domain entity
   */
  static fromStorage(data) {
    return new Container({
      id: data.id,
      name: data.name,
      color: data.color,
      icon: data.icon
    });
  }
}
