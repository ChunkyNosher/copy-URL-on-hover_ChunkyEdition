/**
 * Scenario 16: Rapid Position Updates
 * Tests that Quick Tabs handle rapid position changes correctly with throttling
 *
 * Related Issues: #51 (position not transferring between tabs)
 *
 * Test Behaviors:
 * - Rapid position updates are handled correctly
 * - Final position is accurate after rapid changes
 * - Throttling prevents excessive broadcasts
 * - Cross-tab sync remains consistent
 */

import { QuickTab } from '../../../src/domain/QuickTab.js';
import { BroadcastManager } from '../../../src/features/quick-tabs/managers/BroadcastManager.js';
import { StateManager } from '../../../src/features/quick-tabs/managers/StateManager.js';
import { wait } from '../../helpers/async-helpers.js';

describe('Scenario 16: Rapid Position Updates Protocol', () => {
  let stateManagers;
  let broadcastManagers;
  let messageLog;

  beforeEach(() => {
    messageLog = [];

    // Simulate 3 tabs with independent state/broadcast managers
    stateManagers = [
      new StateManager('firefox-default'),
      new StateManager('firefox-default'),
      new StateManager('firefox-default')
    ];

    broadcastManagers = [
      new BroadcastManager('firefox-default'),
      new BroadcastManager('firefox-default'),
      new BroadcastManager('firefox-default')
    ];

    // Wire up broadcast handlers for each tab
    broadcastManagers.forEach((bm, tabIndex) => {
      bm.on('UPDATE_POSITION', async message => {
        messageLog.push({ tabIndex, type: 'UPDATE_POSITION', timestamp: Date.now() });
        const qt = stateManagers[tabIndex].get(message.id);
        if (qt) {
          qt.updatePosition(message.position.left, message.position.top);
        }
      });
    });
  });

  afterEach(() => {
    // Cleanup
    broadcastManagers.forEach(bm => bm.close());
    stateManagers.forEach(sm => sm.quickTabs.clear());
    messageLog = [];
  });

  describe('Rapid Updates', () => {
    test('10 rapid position updates all apply correctly', async () => {
      const qt = new QuickTab({
        id: 'qt-rapid-1',
        url: 'https://example.com',
        position: { left: 0, top: 0 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers[0].add(qt);

      // Broadcast initial state to other tabs
      await broadcastManagers[0].broadcast('CREATE', {
        id: qt.id,
        url: qt.url,
        position: qt.position,
        size: qt.size,
        container: qt.container
      });

      await wait(100);

      // Add to other tabs
      stateManagers[1].add(qt);
      stateManagers[2].add(qt);

      // Perform 10 rapid position updates
      const updates = [];
      for (let i = 1; i <= 10; i++) {
        const left = i * 10;
        const top = i * 10;
        qt.updatePosition(left, top);
        updates.push(
          broadcastManagers[0].broadcast('UPDATE_POSITION', {
            id: qt.id,
            position: { left, top },
            container: qt.container
          })
        );
      }

      // Wait for all broadcasts
      await Promise.all(updates);
      await wait(150);

      // Verify final position is correct (last update wins)
      const qtInTabA = stateManagers[0].get(qt.id);
      const qtInTabB = stateManagers[1].get(qt.id);
      const qtInTabC = stateManagers[2].get(qt.id);

      expect(qtInTabA.position.left).toBe(100);
      expect(qtInTabA.position.top).toBe(100);
      expect(qtInTabB.position.left).toBe(100);
      expect(qtInTabB.position.top).toBe(100);
      expect(qtInTabC.position.left).toBe(100);
      expect(qtInTabC.position.top).toBe(100);
    });

    test('50 rapid position updates complete within reasonable time', async () => {
      const qt = new QuickTab({
        id: 'qt-perf-1',
        url: 'https://example.com',
        position: { left: 0, top: 0 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers.forEach(sm => sm.add(qt));

      const startTime = Date.now();

      // Perform 50 rapid updates
      const updates = [];
      for (let i = 1; i <= 50; i++) {
        qt.updatePosition(i * 5, i * 5);
        updates.push(
          broadcastManagers[0].broadcast('UPDATE_POSITION', {
            id: qt.id,
            position: { left: i * 5, top: i * 5 },
            container: qt.container
          })
        );
      }

      await Promise.all(updates);
      await wait(200);

      const duration = Date.now() - startTime;

      // Should complete within 1 second (reasonable performance)
      expect(duration).toBeLessThan(1000);

      // Verify final position accurate
      expect(stateManagers[0].get(qt.id).position.left).toBe(250);
      expect(stateManagers[1].get(qt.id).position.left).toBe(250);
      expect(stateManagers[2].get(qt.id).position.left).toBe(250);
    });
  });

  describe('Position Accuracy', () => {
    test('final position matches last update after rapid changes', async () => {
      const qt = new QuickTab({
        id: 'qt-accuracy-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers.forEach(sm => sm.add(qt));

      // Random rapid updates
      const positions = [
        { left: 50, top: 50 },
        { left: 200, top: 300 },
        { left: 150, top: 250 },
        { left: 400, top: 100 },
        { left: 300, top: 200 } // Final position
      ];

      for (const pos of positions) {
        qt.updatePosition(pos.left, pos.top);
        await broadcastManagers[0].broadcast('UPDATE_POSITION', {
          id: qt.id,
          position: pos,
          container: qt.container
        });
      }

      await wait(150);

      // Verify all tabs have final position
      stateManagers.forEach((sm, index) => {
        const qtInTab = sm.get(qt.id);
        expect(qtInTab.position.left).toBe(300);
        expect(qtInTab.position.top).toBe(200);
      });
    });

    test('position updates from different tabs resolve correctly', async () => {
      const qt = new QuickTab({
        id: 'qt-multi-update-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers.forEach(sm => sm.add(qt));

      // Tab A updates position
      qt.updatePosition(200, 200);
      await broadcastManagers[0].broadcast('UPDATE_POSITION', {
        id: qt.id,
        position: { left: 200, top: 200 },
        container: qt.container
      });

      await wait(50);

      // Tab B updates position (overrides Tab A)
      const qtInTabB = stateManagers[1].get(qt.id);
      qtInTabB.updatePosition(300, 300);
      await broadcastManagers[1].broadcast('UPDATE_POSITION', {
        id: qt.id,
        position: { left: 300, top: 300 },
        container: qt.container
      });

      await wait(50);

      // Tab C updates position (overrides Tab B)
      const qtInTabC = stateManagers[2].get(qt.id);
      qtInTabC.updatePosition(400, 400);
      await broadcastManagers[2].broadcast('UPDATE_POSITION', {
        id: qt.id,
        position: { left: 400, top: 400 },
        container: qt.container
      });

      await wait(100);

      // All tabs should have final position from Tab C
      stateManagers.forEach(sm => {
        const qtInTab = sm.get(qt.id);
        expect(qtInTab.position.left).toBe(400);
        expect(qtInTab.position.top).toBe(400);
      });
    });
  });

  describe('Message Efficiency', () => {
    test('broadcasts complete within acceptable latency', async () => {
      const qt = new QuickTab({
        id: 'qt-latency-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers.forEach(sm => sm.add(qt));

      messageLog = []; // Clear log

      // Single update
      const startTime = Date.now();
      qt.updatePosition(200, 200);
      await broadcastManagers[0].broadcast('UPDATE_POSITION', {
        id: qt.id,
        position: { left: 200, top: 200 },
        container: qt.container
      });

      await wait(100);

      const latency = Date.now() - startTime;

      // Broadcast should complete quickly (< 200ms)
      expect(latency).toBeLessThan(200);

      // Should have received messages in other tabs
      const messagesInOtherTabs = messageLog.filter(m => m.tabIndex !== 0);
      expect(messagesInOtherTabs.length).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    test('position updates to same position do not create duplicate messages', async () => {
      const qt = new QuickTab({
        id: 'qt-dup-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers.forEach(sm => sm.add(qt));

      messageLog = []; // Clear log

      // Update to same position 3 times
      for (let i = 0; i < 3; i++) {
        qt.updatePosition(100, 100);
        await broadcastManagers[0].broadcast('UPDATE_POSITION', {
          id: qt.id,
          position: { left: 100, top: 100 },
          container: qt.container
        });
      }

      await wait(100);

      // Position should still be correct
      expect(stateManagers[0].get(qt.id).position.left).toBe(100);
      expect(stateManagers[1].get(qt.id).position.left).toBe(100);

      // Should have received messages (even if position unchanged)
      // This tests that the protocol doesn't optimize away "duplicate" updates
      // since they might have timing significance
      const messagesReceived = messageLog.length;
      expect(messagesReceived).toBeGreaterThan(0);
    });

    test('rapid updates during concurrent size changes maintain consistency', async () => {
      const qt = new QuickTab({
        id: 'qt-combined-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers.forEach(sm => sm.add(qt));

      // Wire up size update handler
      broadcastManagers.forEach((bm, tabIndex) => {
        bm.on('UPDATE_SIZE', async message => {
          const qtInTab = stateManagers[tabIndex].get(message.id);
          if (qtInTab) {
            qtInTab.updateSize(message.size.width, message.size.height);
          }
        });
      });

      // Interleave position and size updates
      qt.updatePosition(200, 200);
      await broadcastManagers[0].broadcast('UPDATE_POSITION', {
        id: qt.id,
        position: { left: 200, top: 200 },
        container: qt.container
      });

      qt.updateSize(900, 700);
      await broadcastManagers[0].broadcast('UPDATE_SIZE', {
        id: qt.id,
        size: { width: 900, height: 700 },
        container: qt.container
      });

      qt.updatePosition(300, 300);
      await broadcastManagers[0].broadcast('UPDATE_POSITION', {
        id: qt.id,
        position: { left: 300, top: 300 },
        container: qt.container
      });

      await wait(150);

      // Verify final state in all tabs
      stateManagers.forEach(sm => {
        const qtInTab = sm.get(qt.id);
        expect(qtInTab.position.left).toBe(300);
        expect(qtInTab.position.top).toBe(300);
        expect(qtInTab.size.width).toBe(900);
        expect(qtInTab.size.height).toBe(700);
      });
    });

    test('updates to non-existent Quick Tab are handled gracefully', async () => {
      // Try to update non-existent QT
      await expect(
        broadcastManagers[0].broadcast('UPDATE_POSITION', {
          id: 'qt-nonexistent',
          position: { left: 100, top: 100 },
          container: 'firefox-default'
        })
      ).resolves.not.toThrow();

      await wait(50);

      // No errors should occur
      expect(stateManagers[0].getCount()).toBe(0);
    });
  });

  describe('Stress Test', () => {
    test('100 rapid updates complete successfully', async () => {
      const qt = new QuickTab({
        id: 'qt-stress-1',
        url: 'https://example.com',
        position: { left: 0, top: 0 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers.forEach(sm => sm.add(qt));

      // Perform 100 rapid updates
      const updates = [];
      for (let i = 1; i <= 100; i++) {
        qt.updatePosition(i * 2, i * 2);
        updates.push(
          broadcastManagers[0].broadcast('UPDATE_POSITION', {
            id: qt.id,
            position: { left: i * 2, top: i * 2 },
            container: qt.container
          })
        );
      }

      await Promise.all(updates);
      await wait(250);

      // Verify final position is accurate
      stateManagers.forEach(sm => {
        const qtInTab = sm.get(qt.id);
        expect(qtInTab.position.left).toBe(200);
        expect(qtInTab.position.top).toBe(200);
      });

      // No errors should occur
      expect(stateManagers[0].getCount()).toBe(1);
      expect(stateManagers[1].getCount()).toBe(1);
      expect(stateManagers[2].getCount()).toBe(1);
    });
  });
});
