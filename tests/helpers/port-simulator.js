/**
 * Port Communication Simulator
 * Provides utilities for simulating Chrome port API for handler testing
 *
 * v1.6.4 - New test helper for comprehensive Jest testing infrastructure
 *
 * Features:
 * - Mock Chrome port API
 * - Track all messages sent/received
 * - Simulate connection failures
 * - Validate message format compliance
 * - Support reconnection scenarios
 *
 * @module tests/helpers/port-simulator
 */

/**
 * Creates a port simulator for testing port-based communication
 * @returns {Object} Port simulator instance
 */
export function createPortSimulator() {
  const state = {
    ports: new Map(),
    messageHistory: new Map(),
    globalMessageCounter: 0
  };

  /**
   * Create a mock port with the given name
   * @param {string} name - Port name
   * @param {Function} handler - Message handler function
   * @returns {Object} Mock port instance
   */
  function createPort(name, handler = null) {
    const portState = {
      name,
      connected: false,
      handler,
      listeners: {
        message: [],
        disconnect: []
      },
      sentMessages: [],
      receivedMessages: [],
      error: null
    };

    const port = {
      name,
      sender: {
        tab: { id: Math.floor(Math.random() * 1000) },
        frameId: 0,
        url: 'mock://test'
      },

      /**
       * Post a message through the port
       * @param {Object} message - Message to send
       */
      postMessage: jest.fn(message => {
        if (!portState.connected) {
          throw new Error('Port is not connected');
        }
        if (portState.error) {
          throw portState.error;
        }

        const messageEntry = {
          id: ++state.globalMessageCounter,
          message,
          timestamp: Date.now(),
          direction: 'outgoing'
        };
        portState.sentMessages.push(messageEntry);

        // Add to global history
        if (!state.messageHistory.has(name)) {
          state.messageHistory.set(name, []);
        }
        state.messageHistory.get(name).push(messageEntry);
      }),

      /**
       * Register a message listener
       */
      onMessage: {
        addListener: jest.fn(listener => {
          portState.listeners.message.push(listener);
        }),
        removeListener: jest.fn(listener => {
          const index = portState.listeners.message.indexOf(listener);
          if (index !== -1) {
            portState.listeners.message.splice(index, 1);
          }
        }),
        hasListener: jest.fn(listener => portState.listeners.message.includes(listener))
      },

      /**
       * Register a disconnect listener
       */
      onDisconnect: {
        addListener: jest.fn(listener => {
          portState.listeners.disconnect.push(listener);
        }),
        removeListener: jest.fn(listener => {
          const index = portState.listeners.disconnect.indexOf(listener);
          if (index !== -1) {
            portState.listeners.disconnect.splice(index, 1);
          }
        }),
        hasListener: jest.fn(listener => portState.listeners.disconnect.includes(listener))
      },

      /**
       * Disconnect the port
       */
      disconnect: jest.fn(() => {
        if (portState.connected) {
          portState.connected = false;
          // Notify disconnect listeners
          portState.listeners.disconnect.forEach(listener => {
            try {
              listener(port);
            } catch {
              // Ignore errors in disconnect handlers
            }
          });
        }
      }),

      // Internal state for testing
      _state: portState
    };

    state.ports.set(name, { port, state: portState });
    return port;
  }

  /**
   * Simulate connecting a port
   * @param {string} name - Port name
   * @returns {boolean} True if connected successfully
   */
  function connectPort(name) {
    const portEntry = state.ports.get(name);
    if (!portEntry) {
      return false;
    }
    portEntry.state.connected = true;
    portEntry.state.error = null;
    return true;
  }

  /**
   * Simulate disconnecting a port
   * @param {string} name - Port name
   * @returns {boolean} True if disconnected successfully
   */
  function disconnectPort(name) {
    const portEntry = state.ports.get(name);
    if (!portEntry) {
      return false;
    }
    portEntry.port.disconnect();
    return true;
  }

  /**
   * Simulate an incoming message to a port
   * @param {string} portName - Port name
   * @param {Object} message - Message to receive
   * @returns {boolean} True if message was delivered
   */
  function sendMessage(portName, message) {
    const portEntry = state.ports.get(portName);
    if (!portEntry || !portEntry.state.connected) {
      return false;
    }

    const messageEntry = {
      id: ++state.globalMessageCounter,
      message,
      timestamp: Date.now(),
      direction: 'incoming'
    };
    portEntry.state.receivedMessages.push(messageEntry);

    // Add to global history
    if (!state.messageHistory.has(portName)) {
      state.messageHistory.set(portName, []);
    }
    state.messageHistory.get(portName).push(messageEntry);

    // Notify message listeners
    portEntry.state.listeners.message.forEach(listener => {
      try {
        listener(message, portEntry.port);
      } catch (err) {
        console.error('Error in message listener:', err);
      }
    });

    return true;
  }

  /**
   * Simulate a port error
   * @param {string} portName - Port name
   * @param {Error} error - Error to simulate
   * @returns {boolean} True if error was set
   */
  function simulateError(portName, error) {
    const portEntry = state.ports.get(portName);
    if (!portEntry) {
      return false;
    }
    portEntry.state.error = error;

    // Trigger disconnect with error
    if (portEntry.state.connected) {
      portEntry.state.connected = false;
      portEntry.state.listeners.disconnect.forEach(listener => {
        try {
          listener(portEntry.port);
        } catch {
          // Ignore errors
        }
      });
    }

    return true;
  }

  /**
   * Get message history for a port
   * @param {string} portName - Port name
   * @returns {Array} Array of message entries
   */
  function getPortHistory(portName) {
    return state.messageHistory.get(portName) || [];
  }

  /**
   * Get all sent messages for a port
   * @param {string} portName - Port name
   * @returns {Array} Array of sent messages
   */
  function getSentMessages(portName) {
    const portEntry = state.ports.get(portName);
    return portEntry ? portEntry.state.sentMessages : [];
  }

  /**
   * Get all received messages for a port
   * @param {string} portName - Port name
   * @returns {Array} Array of received messages
   */
  function getReceivedMessages(portName) {
    const portEntry = state.ports.get(portName);
    return portEntry ? portEntry.state.receivedMessages : [];
  }

  /**
   * Reset a specific port's state
   * @param {string} portName - Port name
   * @returns {boolean} True if reset successfully
   */
  function resetPort(portName) {
    const portEntry = state.ports.get(portName);
    if (!portEntry) {
      return false;
    }

    portEntry.state.connected = false;
    portEntry.state.error = null;
    portEntry.state.sentMessages = [];
    portEntry.state.receivedMessages = [];
    portEntry.state.listeners.message = [];
    portEntry.state.listeners.disconnect = [];

    // Clear history for this port
    state.messageHistory.delete(portName);

    // Reset mock call counts
    portEntry.port.postMessage.mockClear();
    portEntry.port.disconnect.mockClear();
    portEntry.port.onMessage.addListener.mockClear();
    portEntry.port.onMessage.removeListener.mockClear();
    portEntry.port.onDisconnect.addListener.mockClear();
    portEntry.port.onDisconnect.removeListener.mockClear();

    return true;
  }

  /**
   * Verify message format against expected schema
   * @param {string} portName - Port name
   * @param {Object} schema - Expected schema (object with property types)
   * @returns {{ valid: boolean, errors: string[] }}
   */
  function verifyMessageFormat(portName, schema) {
    const history = getPortHistory(portName);
    const errors = [];

    history.forEach((entry, index) => {
      const msg = entry.message;
      for (const [key, expectedType] of Object.entries(schema)) {
        if (msg[key] === undefined) {
          errors.push(`Message ${index}: Missing required field '${key}'`);
        } else if (typeof msg[key] !== expectedType && expectedType !== 'any') {
          errors.push(`Message ${index}: Field '${key}' expected ${expectedType}, got ${typeof msg[key]}`);
        }
      }
    });

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Simulate connection timeout
   * @param {string} portName - Port name
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {Promise} Resolves when timeout triggers disconnect
   */
  function simulateConnectionTimeout(portName, timeoutMs = 100) {
    return new Promise(resolve => {
      setTimeout(() => {
        simulateError(portName, new Error('Connection timeout'));
        resolve(true);
      }, timeoutMs);
    });
  }

  /**
   * Get a port by name
   * @param {string} portName - Port name
   * @returns {Object|null} Port instance or null
   */
  function getPort(portName) {
    const portEntry = state.ports.get(portName);
    return portEntry ? portEntry.port : null;
  }

  /**
   * Check if a port is connected
   * @param {string} portName - Port name
   * @returns {boolean} True if connected
   */
  function isConnected(portName) {
    const portEntry = state.ports.get(portName);
    return portEntry ? portEntry.state.connected : false;
  }

  /**
   * Get all port names
   * @returns {string[]} Array of port names
   */
  function getAllPortNames() {
    return Array.from(state.ports.keys());
  }

  /**
   * Reset all ports and state
   */
  function resetAll() {
    for (const name of state.ports.keys()) {
      resetPort(name);
    }
    state.ports.clear();
    state.messageHistory.clear();
    state.globalMessageCounter = 0;
  }

  /**
   * Get simulator statistics
   * @returns {Object} Statistics object
   */
  function getStats() {
    let totalMessages = 0;
    let connectedPorts = 0;

    for (const entry of state.ports.values()) {
      totalMessages += entry.state.sentMessages.length + entry.state.receivedMessages.length;
      if (entry.state.connected) connectedPorts++;
    }

    return {
      totalPorts: state.ports.size,
      connectedPorts,
      totalMessages,
      globalMessageCounter: state.globalMessageCounter
    };
  }

  return {
    createPort,
    connectPort,
    disconnectPort,
    sendMessage,
    simulateError,
    getPortHistory,
    getSentMessages,
    getReceivedMessages,
    resetPort,
    verifyMessageFormat,
    simulateConnectionTimeout,
    getPort,
    isConnected,
    getAllPortNames,
    resetAll,
    getStats,
    _state: state
  };
}

/**
 * Create a mock browser.runtime.connect function
 * @param {Object} simulator - Port simulator instance
 * @returns {Function} Mock connect function
 */
export function createMockRuntimeConnect(simulator) {
  return jest.fn(({ name }) => {
    const port = simulator.createPort(name);
    simulator.connectPort(name);
    return port;
  });
}

/**
 * Create a mock browser.runtime.onConnect listener manager
 * @param {Object} _simulator - Port simulator instance (reserved for future use)
 * @returns {Object} Mock onConnect object
 */
export function createMockRuntimeOnConnect(_simulator) {
  const listeners = [];

  return {
    addListener: jest.fn(listener => {
      listeners.push(listener);
    }),
    removeListener: jest.fn(listener => {
      const index = listeners.indexOf(listener);
      if (index !== -1) listeners.splice(index, 1);
    }),
    hasListener: jest.fn(listener => listeners.includes(listener)),
    // Helper to trigger connection with a port
    _triggerConnect: port => {
      listeners.forEach(listener => {
        try {
          listener(port);
        } catch (err) {
          console.error('Error in onConnect listener:', err);
        }
      });
    },
    _listeners: listeners
  };
}
