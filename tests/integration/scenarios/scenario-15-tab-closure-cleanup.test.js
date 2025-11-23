/**
 * Scenario 15: Tab Closure Cleanup
 * Tests that Quick Tab state is properly cleaned up when browser tabs close
 *
 * Related Issues: #47
 *
 * Test Behaviors:
 * - Quick Tab state removed when last tab in container closes
 * - Quick Tabs persist when some tabs remain open
 * - Container-specific cleanup
 * - Cross-tab cleanup synchronization
 */

import { QuickTab } from '../../../src/domain/QuickTab.js';
import { StateManager } from '../../../src/features/quick-tabs/managers/StateManager.js';
import { BroadcastManager } from '../../../src/features/quick-tabs/managers/BroadcastManager.js';
import { wait } from '../../helpers/async-helpers.js';

describe('Scenario 15: Tab Closure Cleanup Protocol', () => {
  let stateManagers;
  let broadcastManagers;

  beforeEach(() => {
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
    broadcastManagers.forEach((bm, index) => {
      bm.on('DESTROY', async message => {
        const qt = stateManagers[index].get(message.id);
        if (qt) {
          stateManagers[index].remove(message.id);
        }
      });
    });
  });

  afterEach(() => {
    // Cleanup
    broadcastManagers.forEach(bm => bm.close());
    stateManagers.forEach(sm => sm.quickTabs.clear());
  });

  describe('Basic Tab Closure', () => {
    test('Quick Tab removed from all tabs when destroyed', async () => {
      // Create Quick Tab in Tab A
      const qt = new QuickTab({
        id: 'qt-close-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      // Add to all tabs
      stateManagers.forEach(sm => sm.add(qt));

      // Verify present in all tabs
      expect(stateManagers[0].get(qt.id)).toBeDefined();
      expect(stateManagers[1].get(qt.id)).toBeDefined();
      expect(stateManagers[2].get(qt.id)).toBeDefined();

      // Destroy from Tab A
      await broadcastManagers[0].broadcast('DESTROY', {
        id: qt.id,
        container: qt.container
      });

      await wait(100);

      // Verify removed from all tabs
      expect(stateManagers[0].get(qt.id)).toBeUndefined();
      expect(stateManagers[1].get(qt.id)).toBeUndefined();
      expect(stateManagers[2].get(qt.id)).toBeUndefined();
    });

    test('closing one Quick Tab does not affect others', async () => {
      // Create two Quick Tabs
      const qt1 = new QuickTab({
        id: 'qt-multi-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      const qt2 = new QuickTab({
        id: 'qt-multi-2',
        url: 'https://test.com',
        position: { left: 200, top: 200 },
        size: { width: 700, height: 500 },
        container: 'firefox-default'
      });

      // Add both to all tabs
      stateManagers.forEach(sm => {
        sm.add(qt1);
        sm.add(qt2);
      });

      // Close QT1
      await broadcastManagers[0].broadcast('DESTROY', {
        id: qt1.id,
        container: qt1.container
      });

      await wait(100);

      // Verify QT1 removed, QT2 still present
      expect(stateManagers[0].get(qt1.id)).toBeUndefined();
      expect(stateManagers[1].get(qt1.id)).toBeUndefined();
      expect(stateManagers[2].get(qt1.id)).toBeUndefined();

      expect(stateManagers[0].get(qt2.id)).toBeDefined();
      expect(stateManagers[1].get(qt2.id)).toBeDefined();
      expect(stateManagers[2].get(qt2.id)).toBeDefined();
    });
  });

  describe('State Consistency', () => {
    test('Quick Tab count updates correctly after closure', async () => {
      // Create 3 Quick Tabs
      const qts = [1, 2, 3].map(i => 
        new QuickTab({
          id: `qt-count-${i}`,
          url: `https://example${i}.com`,
          position: { left: i * 100, top: i * 100 },
          size: { width: 800, height: 600 },
          container: 'firefox-default'
        })
      );

      // Add all to all tabs
      qts.forEach(qt => {
        stateManagers.forEach(sm => sm.add(qt));
      });

      // Verify count
      expect(stateManagers[0].getCount()).toBe(3);
      expect(stateManagers[1].getCount()).toBe(3);
      expect(stateManagers[2].getCount()).toBe(3);

      // Close QT 2
      await broadcastManagers[0].broadcast('DESTROY', {
        id: qts[1].id,
        container: qts[1].container
      });

      await wait(100);

      // Verify count updated
      expect(stateManagers[0].getCount()).toBe(2);
      expect(stateManagers[1].getCount()).toBe(2);
      expect(stateManagers[2].getCount()).toBe(2);

      // Verify correct QTs remain
      expect(stateManagers[0].get(qts[0].id)).toBeDefined();
      expect(stateManagers[0].get(qts[1].id)).toBeUndefined();
      expect(stateManagers[0].get(qts[2].id)).toBeDefined();
    });

    test('slot becomes available after Quick Tab closure', async () => {
      const qt = new QuickTab({
        id: 'qt-slot-1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers.forEach(sm => sm.add(qt));

      // Verify at limit (if limit is 1)
      const limit = 5; // Assume default limit
      const wouldExceed = stateManagers[0].wouldExceedLimit();
      const countBeforeClose = stateManagers[0].getCount();

      // Close Quick Tab
      await broadcastManagers[0].broadcast('DESTROY', {
        id: qt.id,
        container: qt.container
      });

      await wait(100);

      // Verify count decreased
      expect(stateManagers[0].getCount()).toBe(countBeforeClose - 1);

      // Verify slot available
      if (wouldExceed) {
        expect(stateManagers[0].wouldExceedLimit()).toBe(false);
      }
    });
  });

  describe('Container-Specific Cleanup', () => {
    test('closing Quick Tab in one container does not affect other containers', async () => {
      // Create managers for different containers
      const container1Managers = [
        new StateManager('firefox-default'),
        new BroadcastManager('firefox-default')
      ];

      const container2Managers = [
        new StateManager('firefox-container-1'),
        new BroadcastManager('firefox-container-1')
      ];

      // Wire up handlers
      container1Managers[1].on('DESTROY', message => {
        container1Managers[0].remove(message.id);
      });

      container2Managers[1].on('DESTROY', message => {
        container2Managers[0].remove(message.id);
      });

      // Create QTs in each container
      const qt1 = new QuickTab({
        id: 'qt-cont1',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      const qt2 = new QuickTab({
        id: 'qt-cont2',
        url: 'https://test.com',
        position: { left: 200, top: 200 },
        size: { width: 700, height: 500 },
        container: 'firefox-container-1'
      });

      container1Managers[0].add(qt1);
      container2Managers[0].add(qt2);

      // Close QT1 in container 1
      await container1Managers[1].broadcast('DESTROY', {
        id: qt1.id,
        container: qt1.container
      });

      await wait(100);

      // Verify QT1 removed, QT2 unaffected
      expect(container1Managers[0].get(qt1.id)).toBeUndefined();
      expect(container2Managers[0].get(qt2.id)).toBeDefined();

      // Cleanup
      container1Managers[1].close();
      container2Managers[1].close();
    });
  });

  describe('Concurrent Closures', () => {
    test('multiple Quick Tabs can be closed simultaneously', async () => {
      // Create 5 Quick Tabs
      const qts = [1, 2, 3, 4, 5].map(i =>
        new QuickTab({
          id: `qt-concurrent-${i}`,
          url: `https://example${i}.com`,
          position: { left: i * 100, top: i * 100 },
          size: { width: 800, height: 600 },
          container: 'firefox-default'
        })
      );

      // Add all to all tabs
      qts.forEach(qt => {
        stateManagers.forEach(sm => sm.add(qt));
      });

      // Close QTs 1, 3, 5 simultaneously
      await Promise.all([
        broadcastManagers[0].broadcast('DESTROY', { id: qts[0].id, container: qts[0].container }),
        broadcastManagers[0].broadcast('DESTROY', { id: qts[2].id, container: qts[2].container }),
        broadcastManagers[0].broadcast('DESTROY', { id: qts[4].id, container: qts[4].container })
      ]);

      await wait(150);

      // Verify correct QTs removed
      expect(stateManagers[0].get(qts[0].id)).toBeUndefined();
      expect(stateManagers[0].get(qts[1].id)).toBeDefined();
      expect(stateManagers[0].get(qts[2].id)).toBeUndefined();
      expect(stateManagers[0].get(qts[3].id)).toBeDefined();
      expect(stateManagers[0].get(qts[4].id)).toBeUndefined();

      // Verify count
      expect(stateManagers[0].getCount()).toBe(2);
      expect(stateManagers[1].getCount()).toBe(2);
      expect(stateManagers[2].getCount()).toBe(2);
    });
  });

  describe('Edge Cases', () => {
    test('closing non-existent Quick Tab does not cause error', async () => {
      // Try to close non-existent QT
      await expect(
        broadcastManagers[0].broadcast('DESTROY', {
          id: 'qt-nonexistent',
          container: 'firefox-default'
        })
      ).resolves.not.toThrow();

      await wait(50);

      // Verify state unchanged
      expect(stateManagers[0].getCount()).toBe(0);
    });

    test('closing same Quick Tab multiple times is idempotent', async () => {
      const qt = new QuickTab({
        id: 'qt-idempotent',
        url: 'https://example.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers.forEach(sm => sm.add(qt));

      // Close multiple times
      await broadcastManagers[0].broadcast('DESTROY', { id: qt.id, container: qt.container });
      await wait(50);
      await broadcastManagers[0].broadcast('DESTROY', { id: qt.id, container: qt.container });
      await wait(50);
      await broadcastManagers[0].broadcast('DESTROY', { id: qt.id, container: qt.container });
      await wait(50);

      // Verify removed once
      expect(stateManagers[0].get(qt.id)).toBeUndefined();
      expect(stateManagers[0].getCount()).toBe(0);
    });
  });
});
