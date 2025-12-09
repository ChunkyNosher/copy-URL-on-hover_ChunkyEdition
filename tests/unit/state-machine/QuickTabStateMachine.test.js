/**
 * Unit tests for QuickTabStateMachine
 * v1.6.3.5 - New test file for state machine module
 */

import {
  QuickTabStateMachine,
  QuickTabState,
  getStateMachine,
  resetStateMachine
} from '../../../src/features/quick-tabs/state-machine.js';

describe('QuickTabStateMachine', () => {
  let stateMachine;

  beforeEach(() => {
    resetStateMachine();
    stateMachine = new QuickTabStateMachine();
  });

  describe('QuickTabState enum', () => {
    test('should define all expected states', () => {
      expect(QuickTabState.UNKNOWN).toBe('UNKNOWN');
      expect(QuickTabState.VISIBLE).toBe('VISIBLE');
      expect(QuickTabState.MINIMIZING).toBe('MINIMIZING');
      expect(QuickTabState.MINIMIZED).toBe('MINIMIZED');
      expect(QuickTabState.RESTORING).toBe('RESTORING');
      expect(QuickTabState.DESTROYED).toBe('DESTROYED');
    });
  });

  describe('getState()', () => {
    test('should return UNKNOWN for untracked tab', () => {
      expect(stateMachine.getState('unknown-id')).toBe(QuickTabState.UNKNOWN);
    });

    test('should return correct state after initialization', () => {
      stateMachine.initialize('tab-1', QuickTabState.VISIBLE, 'test');
      expect(stateMachine.getState('tab-1')).toBe(QuickTabState.VISIBLE);
    });
  });

  describe('canTransition()', () => {
    test('should allow UNKNOWN -> VISIBLE', () => {
      expect(stateMachine.canTransition('tab-1', QuickTabState.VISIBLE)).toBe(true);
    });

    test('should allow UNKNOWN -> MINIMIZED', () => {
      expect(stateMachine.canTransition('tab-1', QuickTabState.MINIMIZED)).toBe(true);
    });

    test('should allow VISIBLE -> MINIMIZING', () => {
      stateMachine.initialize('tab-1', QuickTabState.VISIBLE, 'test');
      expect(stateMachine.canTransition('tab-1', QuickTabState.MINIMIZING)).toBe(true);
    });

    test('should allow VISIBLE -> DESTROYED', () => {
      stateMachine.initialize('tab-1', QuickTabState.VISIBLE, 'test');
      expect(stateMachine.canTransition('tab-1', QuickTabState.DESTROYED)).toBe(true);
    });

    test('should not allow VISIBLE -> RESTORING', () => {
      stateMachine.initialize('tab-1', QuickTabState.VISIBLE, 'test');
      expect(stateMachine.canTransition('tab-1', QuickTabState.RESTORING)).toBe(false);
    });

    test('should allow MINIMIZED -> RESTORING', () => {
      stateMachine.initialize('tab-1', QuickTabState.MINIMIZED, 'test');
      expect(stateMachine.canTransition('tab-1', QuickTabState.RESTORING)).toBe(true);
    });

    test('should not allow DESTROYED -> any state', () => {
      stateMachine.initialize('tab-1', QuickTabState.VISIBLE, 'test');
      stateMachine.transition('tab-1', QuickTabState.DESTROYED, { source: 'test' });

      expect(stateMachine.canTransition('tab-1', QuickTabState.VISIBLE)).toBe(false);
      expect(stateMachine.canTransition('tab-1', QuickTabState.MINIMIZED)).toBe(false);
    });
  });

  describe('transition()', () => {
    test('should successfully transition valid states', () => {
      stateMachine.initialize('tab-1', QuickTabState.VISIBLE, 'test');
      const result = stateMachine.transition('tab-1', QuickTabState.MINIMIZING, { source: 'test' });

      expect(result.success).toBe(true);
      expect(result.fromState).toBe(QuickTabState.VISIBLE);
      expect(result.toState).toBe(QuickTabState.MINIMIZING);
      expect(stateMachine.getState('tab-1')).toBe(QuickTabState.MINIMIZING);
    });

    test('should reject invalid transitions when enforcing', () => {
      stateMachine.enforceTransitions = true;
      stateMachine.initialize('tab-1', QuickTabState.VISIBLE, 'test');

      const result = stateMachine.transition('tab-1', QuickTabState.RESTORING, { source: 'test' });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(stateMachine.getState('tab-1')).toBe(QuickTabState.VISIBLE);
    });

    test('should allow invalid transitions with warning when not enforcing', () => {
      stateMachine.enforceTransitions = false;
      stateMachine.initialize('tab-1', QuickTabState.VISIBLE, 'test');

      const result = stateMachine.transition('tab-1', QuickTabState.RESTORING, { source: 'test' });

      expect(result.success).toBe(true);
      expect(stateMachine.getState('tab-1')).toBe(QuickTabState.RESTORING);
    });
  });

  describe('getHistory()', () => {
    test('should return empty array for untracked tab', () => {
      expect(stateMachine.getHistory('unknown-id')).toEqual([]);
    });

    test('should track state transitions', () => {
      stateMachine.initialize('tab-1', QuickTabState.VISIBLE, 'init');
      stateMachine.transition('tab-1', QuickTabState.MINIMIZING, { source: 'minimize' });
      stateMachine.transition('tab-1', QuickTabState.MINIMIZED, { source: 'minimize-complete' });

      const history = stateMachine.getHistory('tab-1');
      expect(history.length).toBe(3);
      expect(history[0].toState).toBe(QuickTabState.VISIBLE);
      expect(history[1].toState).toBe(QuickTabState.MINIMIZING);
      expect(history[2].toState).toBe(QuickTabState.MINIMIZED);
    });
  });

  describe('initialize()', () => {
    test('should not reinitialize already tracked tab', () => {
      const result1 = stateMachine.initialize('tab-1', QuickTabState.VISIBLE, 'init');
      const result2 = stateMachine.initialize('tab-1', QuickTabState.MINIMIZED, 'init-again');

      expect(result1).toBe(true);
      expect(result2).toBe(false);
      expect(stateMachine.getState('tab-1')).toBe(QuickTabState.VISIBLE);
    });
  });

  describe('remove()', () => {
    test('should remove state and history', () => {
      stateMachine.initialize('tab-1', QuickTabState.VISIBLE, 'test');
      stateMachine.remove('tab-1');

      expect(stateMachine.getState('tab-1')).toBe(QuickTabState.UNKNOWN);
      expect(stateMachine.getHistory('tab-1')).toEqual([]);
    });
  });

  describe('getStats()', () => {
    test('should return correct statistics', () => {
      stateMachine.initialize('tab-1', QuickTabState.VISIBLE, 'test');
      stateMachine.initialize('tab-2', QuickTabState.MINIMIZED, 'test');

      const stats = stateMachine.getStats();
      expect(stats.trackedCount).toBe(2);
      expect(stats.stateCounts[QuickTabState.VISIBLE]).toBe(1);
      expect(stats.stateCounts[QuickTabState.MINIMIZED]).toBe(1);
    });
  });

  describe('clear()', () => {
    test('should clear all tracking', () => {
      stateMachine.initialize('tab-1', QuickTabState.VISIBLE, 'test');
      stateMachine.initialize('tab-2', QuickTabState.MINIMIZED, 'test');
      stateMachine.clear();

      expect(stateMachine.getStats().trackedCount).toBe(0);
    });
  });

  describe('singleton functions', () => {
    test('getStateMachine should return same instance', () => {
      const instance1 = getStateMachine();
      const instance2 = getStateMachine();
      expect(instance1).toBe(instance2);
    });

    test('resetStateMachine should create fresh instance', () => {
      const instance1 = getStateMachine();
      instance1.initialize('tab-1', QuickTabState.VISIBLE, 'test');

      resetStateMachine();
      const instance2 = getStateMachine();

      expect(instance2.getStats().trackedCount).toBe(0);
    });
  });
});
