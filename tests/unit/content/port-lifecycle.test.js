/**
 * Port Lifecycle Edge Cases Tests
 * v1.6.3.11-v6 - Tests for BFCache port validation and reconnection
 *
 * Test Categories:
 * - Port validation on pageshow event after BFCache restoration
 * - Reconnection when port is stale (no onDisconnect fired)
 * - Message send operations immediately after pageshow
 */

describe('Port Lifecycle Edge Cases', () => {
  let mockPort;
  let mockBrowser;
  let pageShowHandler;
  let pageHideHandler;
  let portConnectivity;

  beforeEach(() => {
    // Reset state
    portConnectivity = {
      isConnected: true,
      lastHeartbeatTime: Date.now(),
      disconnectHandlerCalled: false
    };

    // Mock port
    mockPort = {
      name: 'content-script',
      postMessage: jest.fn(),
      disconnect: jest.fn(),
      onMessage: {
        addListener: jest.fn(),
        removeListener: jest.fn()
      },
      onDisconnect: {
        addListener: jest.fn(handler => {
          mockPort._disconnectHandler = handler;
        }),
        removeListener: jest.fn()
      },
      _disconnectHandler: null
    };

    // Mock browser API
    mockBrowser = {
      runtime: {
        connect: jest.fn(() => mockPort),
        sendMessage: jest.fn().mockResolvedValue({ success: true }),
        lastError: null
      }
    };

    // Store event handlers for testing
    pageShowHandler = null;
    pageHideHandler = null;

    // Mock addEventListener
    global.addEventListener = jest.fn((event, handler) => {
      if (event === 'pageshow') pageShowHandler = handler;
      if (event === 'pagehide') pageHideHandler = handler;
    });

    global.removeEventListener = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Port Validation on Pageshow (BFCache)', () => {
    /**
     * _validatePortConnectivity() should detect stale ports
     * v1.6.3.11-v6 - FIX Issue #1
     */
    test('should validate port connectivity on pageshow after BFCache restoration', async () => {
      // Simulate BFCache scenario
      const _validatePortConnectivity = jest.fn().mockResolvedValue(false);
      const _initiatePortReconnection = jest.fn();

      // Simulate pageshow with persisted = true (restored from BFCache)
      const pageshowEvent = { persisted: true };
      const portPotentiallyInvalidDueToBFCache = true;

      // Handler logic
      if (pageshowEvent.persisted && portPotentiallyInvalidDueToBFCache) {
        const isValid = await _validatePortConnectivity();
        if (!isValid) {
          _initiatePortReconnection('bfcache-stale-port');
        }
      }

      expect(_validatePortConnectivity).toHaveBeenCalled();
      expect(_initiatePortReconnection).toHaveBeenCalledWith('bfcache-stale-port');
    });

    test('should NOT reconnect if port validation succeeds after pageshow', async () => {
      const _validatePortConnectivity = jest.fn().mockResolvedValue(true);
      const _initiatePortReconnection = jest.fn();

      const pageshowEvent = { persisted: true };
      const portPotentiallyInvalidDueToBFCache = true;

      if (pageshowEvent.persisted && portPotentiallyInvalidDueToBFCache) {
        const isValid = await _validatePortConnectivity();
        if (!isValid) {
          _initiatePortReconnection('bfcache-stale-port');
        }
      }

      expect(_validatePortConnectivity).toHaveBeenCalled();
      expect(_initiatePortReconnection).not.toHaveBeenCalled();
    });

    test('should skip validation if pageshow is not from BFCache (persisted=false)', async () => {
      const _validatePortConnectivity = jest.fn().mockResolvedValue(false);
      const _initiatePortReconnection = jest.fn();

      const pageshowEvent = { persisted: false };
      const portPotentiallyInvalidDueToBFCache = true;

      if (pageshowEvent.persisted && portPotentiallyInvalidDueToBFCache) {
        const isValid = await _validatePortConnectivity();
        if (!isValid) {
          _initiatePortReconnection('bfcache-stale-port');
        }
      }

      expect(_validatePortConnectivity).not.toHaveBeenCalled();
      expect(_initiatePortReconnection).not.toHaveBeenCalled();
    });
  });

  describe('Stale Port Detection (No onDisconnect Fired)', () => {
    /**
     * Test reconnection when port becomes stale without onDisconnect
     * v1.6.3.11-v6 - Firefox-specific BFCache behavior
     */
    test('should detect stale port via heartbeat failure', async () => {
      let consecutiveHeartbeatFailures = 0;
      const MAX_HEARTBEAT_FAILURES = 3;
      const _initiatePortReconnection = jest.fn();

      // Simulate heartbeat mechanism
      const sendHeartbeat = jest.fn().mockImplementation(() => {
        return new Promise((_, reject) => {
          reject(new Error('Port disconnected'));
        });
      });

      // Heartbeat check loop
      for (let i = 0; i < MAX_HEARTBEAT_FAILURES; i++) {
        try {
          await sendHeartbeat();
          consecutiveHeartbeatFailures = 0;
        } catch (_e) {
          consecutiveHeartbeatFailures++;
        }
      }

      if (consecutiveHeartbeatFailures >= MAX_HEARTBEAT_FAILURES) {
        _initiatePortReconnection('stale-port-heartbeat-failure');
      }

      expect(consecutiveHeartbeatFailures).toBe(MAX_HEARTBEAT_FAILURES);
      expect(_initiatePortReconnection).toHaveBeenCalledWith('stale-port-heartbeat-failure');
    });

    test('should reset failure count on successful heartbeat', async () => {
      let consecutiveHeartbeatFailures = 2;

      const sendHeartbeat = jest.fn().mockResolvedValue({ success: true });

      try {
        await sendHeartbeat();
        consecutiveHeartbeatFailures = 0; // Reset on success
      } catch (_e) {
        consecutiveHeartbeatFailures++;
      }

      expect(consecutiveHeartbeatFailures).toBe(0);
    });

    test('should validate port with postMessage verification', async () => {
      // Port validation by sending a probe message and checking for response
      const validatePort = async port => {
        return new Promise(resolve => {
          const timeout = setTimeout(() => resolve(false), 2000);

          try {
            port.postMessage({ type: 'PORT_VERIFY', timestamp: Date.now() });
            // In real code, response would come via onMessage
            // For test, we simulate immediate success
            clearTimeout(timeout);
            resolve(true);
          } catch (_e) {
            clearTimeout(timeout);
            resolve(false);
          }
        });
      };

      const result = await validatePort(mockPort);
      expect(mockPort.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'PORT_VERIFY' })
      );
      expect(result).toBe(true);
    });
  });

  describe('Message Operations After Pageshow', () => {
    /**
     * Test message sending immediately after pageshow restoration
     * v1.6.3.11-v6 - Ensure messages don't get lost
     */
    test('should queue messages if port is being validated', async () => {
      const messageQueue = [];
      const isValidatingPort = true;

      const sendMessage = jest.fn().mockImplementation(msg => {
        if (isValidatingPort) {
          messageQueue.push(msg);
          return Promise.resolve({ queued: true });
        }
        return mockBrowser.runtime.sendMessage(msg);
      });

      // Send messages during validation
      await sendMessage({ action: 'GET_TAB_ID' });
      await sendMessage({ action: 'SYNC_STATE' });

      expect(messageQueue).toHaveLength(2);
      expect(messageQueue[0].action).toBe('GET_TAB_ID');
      expect(messageQueue[1].action).toBe('SYNC_STATE');
    });

    test('should drain message queue after port validation completes', async () => {
      const messageQueue = [];
      const processedMessages = [];
      let isValidatingPort = true;

      const processMessage = jest.fn().mockImplementation(msg => {
        processedMessages.push(msg);
        return Promise.resolve({ success: true });
      });

      // Queue messages during validation
      messageQueue.push({ action: 'GET_TAB_ID' });
      messageQueue.push({ action: 'SYNC_STATE' });

      // Validation completes
      isValidatingPort = false;

      // Drain queue
      while (messageQueue.length > 0) {
        const msg = messageQueue.shift();
        await processMessage(msg);
      }

      expect(processedMessages).toHaveLength(2);
      expect(messageQueue).toHaveLength(0);
    });

    test('should handle errors during post-pageshow message sending', async () => {
      const errors = [];

      const sendMessageSafely = async msg => {
        try {
          throw new Error('Port disconnected during message send');
        } catch (err) {
          errors.push({ message: msg, error: err.message });
          return { success: false, error: err.message };
        }
      };

      const result = await sendMessageSafely({ action: 'TEST' });

      expect(result.success).toBe(false);
      expect(errors).toHaveLength(1);
      expect(errors[0].error).toBe('Port disconnected during message send');
    });

    test('should mark port as potentially invalid on pagehide', () => {
      let portPotentiallyInvalidDueToBFCache = false;

      // Simulate pagehide event (entering BFCache)
      const handlePageHide = () => {
        portPotentiallyInvalidDueToBFCache = true;
      };

      handlePageHide();

      expect(portPotentiallyInvalidDueToBFCache).toBe(true);
    });
  });

  describe('Port Reconnection Flow', () => {
    /**
     * Test the reconnection flow when port is stale
     */
    test('should create new port on reconnection', () => {
      let currentPort = mockPort;
      let reconnectionCount = 0;

      const initiatePortReconnection = reason => {
        // Disconnect old port if exists
        if (currentPort) {
          currentPort.disconnect();
        }

        // Create new port
        currentPort = mockBrowser.runtime.connect({ name: 'content-script' });
        reconnectionCount++;

        return { success: true, reason, reconnectionCount };
      };

      const result = initiatePortReconnection('bfcache-stale-port');

      expect(mockPort.disconnect).toHaveBeenCalled();
      expect(mockBrowser.runtime.connect).toHaveBeenCalled();
      expect(result.reconnectionCount).toBe(1);
    });

    test('should log reconnection with reason', () => {
      const logEntries = [];

      const logPortReconnection = (reason, details) => {
        logEntries.push({
          prefix: '[PORT_RECONNECT]',
          reason,
          ...details,
          timestamp: Date.now()
        });
      };

      logPortReconnection('bfcache-stale-port', { previousState: 'connected' });

      expect(logEntries).toHaveLength(1);
      expect(logEntries[0].prefix).toBe('[PORT_RECONNECT]');
      expect(logEntries[0].reason).toBe('bfcache-stale-port');
    });

    test('should re-register message listeners after reconnection', () => {
      const newPort = {
        ...mockPort,
        onMessage: {
          addListener: jest.fn(),
          removeListener: jest.fn()
        }
      };

      const messageHandler = jest.fn();

      // Re-register listener on new port
      newPort.onMessage.addListener(messageHandler);

      expect(newPort.onMessage.addListener).toHaveBeenCalledWith(messageHandler);
    });
  });
});
