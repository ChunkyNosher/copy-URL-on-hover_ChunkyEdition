/**
 * Mock implementation of BroadcastChannel for testing
 */

class MockBroadcastChannel {
  static channels = new Map();

  constructor(name) {
    this.name = name;
    this.listeners = [];
    this.closed = false;

    // Store in global channel registry
    if (!MockBroadcastChannel.channels.has(name)) {
      MockBroadcastChannel.channels.set(name, []);
    }
    MockBroadcastChannel.channels.get(name).push(this);
  }

  postMessage(message) {
    if (this.closed) {
      throw new Error('Channel is closed');
    }

    // Broadcast to all other channels with same name
    const channels = MockBroadcastChannel.channels.get(this.name) || [];

    for (const channel of channels) {
      if (channel !== this && !channel.closed) {
        // Simulate async message delivery
        setTimeout(() => {
          const event = {
            data: message,
            origin: 'http://localhost',
            source: this
          };

          channel.listeners.forEach((listener) => {
            listener(event);
          });

          if (channel.onmessage) {
            channel.onmessage(event);
          }
        }, 0);
      }
    }
  }

  addEventListener(type, listener) {
    if (type === 'message') {
      this.listeners.push(listener);
    }
  }

  removeEventListener(type, listener) {
    if (type === 'message') {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    }
  }

  close() {
    this.closed = true;

    // Remove from global registry
    const channels = MockBroadcastChannel.channels.get(this.name) || [];
    const index = channels.indexOf(this);
    if (index > -1) {
      channels.splice(index, 1);
    }

    if (channels.length === 0) {
      MockBroadcastChannel.channels.delete(this.name);
    }
  }

  // Test helper methods
  static _reset() {
    MockBroadcastChannel.channels.clear();
  }

  static _getActiveChannels(name) {
    return MockBroadcastChannel.channels.get(name) || [];
  }
}

export default MockBroadcastChannel;
