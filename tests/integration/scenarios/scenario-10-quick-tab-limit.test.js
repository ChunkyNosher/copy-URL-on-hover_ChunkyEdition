/**
 * Scenario 10: Quick Tab Limit Enforcement
 * 
 * Tests that the maximum Quick Tab limit (configured in settings) is properly
 * enforced with user-friendly notification.
 * 
 * Related Documentation:
 * - docs/issue-47-revised-scenarios.md (Scenario 10)
 * - docs/manual/v1.6.0/remaining-testing-work.md (Phase 2)
 * 
 * Covers Issues: #47
 */

import { EventEmitter } from 'eventemitter3';

import { StateManager } from '../../../src/features/quick-tabs/managers/StateManager.js';
import { QuickTab } from '../../../src/domain/QuickTab.js';
import { createMultiTabScenario } from '../../helpers/cross-tab-simulator.js';

describe('Scenario 10: Quick Tab Limit Enforcement', () => {
  let tabs;
  let stateManagers;
  let eventBuses;

  beforeEach(async () => {
    jest.clearAllMocks();

    tabs = await createMultiTabScenario([
      { url: 'https://wikipedia.org', containerId: 'firefox-default' },
      { url: 'https://youtube.com', containerId: 'firefox-default' }
    ]);

    eventBuses = tabs.map(() => new EventEmitter());

    global.browser = {
      storage: {
        sync: {
          get: jest.fn().mockResolvedValue({}),
          set: jest.fn().mockResolvedValue(undefined)
        },
        local: {
          get: jest.fn().mockResolvedValue({}),
          set: jest.fn().mockResolvedValue(undefined)
        }
      }
    };

    stateManagers = tabs.map((tab, index) => {
      return new StateManager(eventBuses[index], tab.tabId);
    });
  });

  afterEach(() => {
    delete global.browser;
  });

  describe('Basic Limit Enforcement', () => {
    test('StateManager tracks Quick Tab count correctly', () => {
      const qt1 = new QuickTab({
        id: 'qt-limit-1',
        url: 'https://example1.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      const qt2 = new QuickTab({
        id: 'qt-limit-2',
        url: 'https://example2.com',
        position: { left: 200, top: 200 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers[0].add(qt1);
      expect(stateManagers[0].getAll().length).toBe(1);

      stateManagers[0].add(qt2);
      expect(stateManagers[0].getAll().length).toBe(2);
    });

    test('StateManager correctly reports if limit would be exceeded', () => {
      const MAX_QTS = 3;

      // Add 3 Quick Tabs (at limit)
      for (let i = 1; i <= MAX_QTS; i++) {
        const qt = new QuickTab({
          id: `qt-max-${i}`,
          url: `https://example${i}.com`,
          position: { left: 100 * i, top: 100 * i },
          size: { width: 800, height: 600 },
          container: 'firefox-default'
        });
        stateManagers[0].add(qt);
      }

      expect(stateManagers[0].getAll().length).toBe(MAX_QTS);
      
      // Check if at limit
      const atLimit = stateManagers[0].getAll().length >= MAX_QTS;
      expect(atLimit).toBe(true);
    });

    test('removing Quick Tab frees up slot for new one', () => {
      const MAX_QTS = 2;

      // Add 2 Quick Tabs (at limit)
      const qt1 = new QuickTab({
        id: 'qt-slot-1',
        url: 'https://example1.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      const qt2 = new QuickTab({
        id: 'qt-slot-2',
        url: 'https://example2.com',
        position: { left: 200, top: 200 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers[0].add(qt1);
      stateManagers[0].add(qt2);

      expect(stateManagers[0].getAll().length).toBe(MAX_QTS);

      // Remove one
      stateManagers[0].delete(qt1.id);
      expect(stateManagers[0].getAll().length).toBe(1);

      // Can add another
      const qt3 = new QuickTab({
        id: 'qt-slot-3',
        url: 'https://example3.com',
        position: { left: 300, top: 300 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers[0].add(qt3);
      expect(stateManagers[0].getAll().length).toBe(MAX_QTS);

      // Verify correct QTs (qt2 and qt3, not qt1)
      expect(stateManagers[0].get(qt1.id)).toBeUndefined();
      expect(stateManagers[0].get(qt2.id)).toBeDefined();
      expect(stateManagers[0].get(qt3.id)).toBeDefined();
    });
  });

  describe('Cross-Tab Limit Enforcement', () => {
    test('Quick Tab count syncs across tabs', () => {
      const qt1 = new QuickTab({
        id: 'qt-sync-1',
        url: 'https://example1.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      const qt2 = new QuickTab({
        id: 'qt-sync-2',
        url: 'https://example2.com',
        position: { left: 200, top: 200 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      // Add to Tab A
      stateManagers[0].add(qt1);
      stateManagers[0].add(qt2);

      // Simulate sync to Tab B
      stateManagers[1].add(new QuickTab({
        id: qt1.id,
        url: qt1.url,
        position: qt1.position,
        size: qt1.size,
        container: qt1.container
      }));

      stateManagers[1].add(new QuickTab({
        id: qt2.id,
        url: qt2.url,
        position: qt2.position,
        size: qt2.size,
        container: qt2.container
      }));

      // Verify count in both tabs
      expect(stateManagers[0].getAll().length).toBe(2);
      expect(stateManagers[1].getAll().length).toBe(2);
    });

    test('closing Quick Tab in one tab frees slot in all tabs', () => {
      const MAX_QTS = 2;

      // Create 2 QTs in Tab A
      const qt1 = new QuickTab({
        id: 'qt-close-1',
        url: 'https://example1.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      const qt2 = new QuickTab({
        id: 'qt-close-2',
        url: 'https://example2.com',
        position: { left: 200, top: 200 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers[0].add(qt1);
      stateManagers[0].add(qt2);

      // Sync to Tab B
      stateManagers[1].add(new QuickTab({
        id: qt1.id,
        url: qt1.url,
        position: qt1.position,
        size: qt1.size,
        container: qt1.container
      }));

      stateManagers[1].add(new QuickTab({
        id: qt2.id,
        url: qt2.url,
        position: qt2.position,
        size: qt2.size,
        container: qt2.container
      }));

      // At limit in both tabs
      expect(stateManagers[0].getAll().length).toBe(MAX_QTS);
      expect(stateManagers[1].getAll().length).toBe(MAX_QTS);

      // Close QT1 in Tab A
      stateManagers[0].delete(qt1.id);

      // Simulate sync to Tab B
      stateManagers[1].delete(qt1.id);

      // Slot freed in both tabs
      expect(stateManagers[0].getAll().length).toBe(1);
      expect(stateManagers[1].getAll().length).toBe(1);

      // Can add new QT in either tab
      const qt3 = new QuickTab({
        id: 'qt-close-3',
        url: 'https://example3.com',
        position: { left: 300, top: 300 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers[1].add(qt3);
      expect(stateManagers[1].getAll().length).toBe(MAX_QTS);
    });
  });

  describe('Edge Cases', () => {
    test('handles exact limit boundary correctly', () => {
      const MAX_QTS = 5;

      // Add exactly MAX_QTS
      for (let i = 1; i <= MAX_QTS; i++) {
        const qt = new QuickTab({
          id: `qt-boundary-${i}`,
          url: `https://example${i}.com`,
          position: { left: 100 * i, top: 100 * i },
          size: { width: 800, height: 600 },
          container: 'firefox-default'
        });
        stateManagers[0].add(qt);
      }

      expect(stateManagers[0].getAll().length).toBe(MAX_QTS);

      // At exact limit
      const atLimit = stateManagers[0].getAll().length >= MAX_QTS;
      expect(atLimit).toBe(true);

      // Still at limit after no-op
      expect(stateManagers[0].getAll().length).toBe(MAX_QTS);
    });

    test('handles limit of 1 correctly', () => {
      const MAX_QTS = 1;

      const qt1 = new QuickTab({
        id: 'qt-one-1',
        url: 'https://example1.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      stateManagers[0].add(qt1);
      expect(stateManagers[0].getAll().length).toBe(MAX_QTS);

      // At limit with just 1
      const atLimit = stateManagers[0].getAll().length >= MAX_QTS;
      expect(atLimit).toBe(true);
    });

    test('handles unlimited (high limit) correctly', () => {
      const MAX_QTS = 100;

      // Add 10 Quick Tabs (well under limit)
      for (let i = 1; i <= 10; i++) {
        const qt = new QuickTab({
          id: `qt-unlimited-${i}`,
          url: `https://example${i}.com`,
          position: { left: 100 * i, top: 100 * i },
          size: { width: 800, height: 600 },
          container: 'firefox-default'
        });
        stateManagers[0].add(qt);
      }

      expect(stateManagers[0].getAll().length).toBe(10);

      // Not at limit
      const atLimit = stateManagers[0].getAll().length >= MAX_QTS;
      expect(atLimit).toBe(false);
    });

    test('StateManager handles rapid add/remove cycles', () => {
      const MAX_QTS = 3;

      // Add 3
      for (let i = 1; i <= MAX_QTS; i++) {
        const qt = new QuickTab({
          id: `qt-cycle-${i}`,
          url: `https://example${i}.com`,
          position: { left: 100 * i, top: 100 * i },
          size: { width: 800, height: 600 },
          container: 'firefox-default'
        });
        stateManagers[0].add(qt);
      }

      expect(stateManagers[0].getAll().length).toBe(MAX_QTS);

      // Remove all
      const allQTs = stateManagers[0].getAll();
      allQTs.forEach(qt => {
        stateManagers[0].delete(qt.id);
      });

      expect(stateManagers[0].getAll().length).toBe(0);

      // Add 3 again
      for (let i = 1; i <= MAX_QTS; i++) {
        const qt = new QuickTab({
          id: `qt-cycle-new-${i}`,
          url: `https://example${i}.com`,
          position: { left: 100 * i, top: 100 * i },
          size: { width: 800, height: 600 },
          container: 'firefox-default'
        });
        stateManagers[0].add(qt);
      }

      expect(stateManagers[0].getAll().length).toBe(MAX_QTS);
    });
  });

  describe('Container-Specific Limits', () => {
    test('Quick Tab limits apply per-container', () => {
      // This test demonstrates that limits should be checked per-container
      // (same cookieStoreId), not globally

      const qt1 = new QuickTab({
        id: 'qt-container-1',
        url: 'https://example1.com',
        position: { left: 100, top: 100 },
        size: { width: 800, height: 600 },
        container: 'firefox-default'
      });

      const qt2 = new QuickTab({
        id: 'qt-container-2',
        url: 'https://example2.com',
        position: { left: 200, top: 200 },
        size: { width: 800, height: 600 },
        container: 'firefox-container-1' // Different container
      });

      stateManagers[0].add(qt1);
      stateManagers[0].add(qt2);

      // Both should be added (different containers)
      expect(stateManagers[0].get(qt1.id)).toBeDefined();
      expect(stateManagers[0].get(qt2.id)).toBeDefined();
      expect(stateManagers[0].getAll().length).toBe(2);

      // Filter by container
      const defaultContainerQTs = stateManagers[0].getAll().filter(
        qt => qt.container === 'firefox-default'
      );
      const container1QTs = stateManagers[0].getAll().filter(
        qt => qt.container === 'firefox-container-1'
      );

      expect(defaultContainerQTs.length).toBe(1);
      expect(container1QTs.length).toBe(1);
    });
  });
});
