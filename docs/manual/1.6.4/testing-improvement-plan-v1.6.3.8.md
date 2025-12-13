# Comprehensive Testing Improvement Plan v1.6.3.8-v6

## Executive Summary

This document outlines a comprehensive plan to improve test coverage across the copy-URL-on-hover_ChunkyEdition Firefox extension codebase. The goal is to meet or exceed the coverage thresholds defined in `jest.config.cjs`.

**Current State (as of v1.6.3.8-v6):**
- **1,646 tests passing** (2 skipped)
- **57 test suites**
- Overall coverage significantly below thresholds

## Coverage Analysis

### Current Coverage vs Thresholds

| Directory | Metric | Current | Threshold | Gap |
|-----------|--------|---------|-----------|-----|
| `src/domain/` | Statements | 97.32% | 100% | -2.68% |
| `src/domain/` | Branches | 92.30% | 100% | -7.70% |
| `src/domain/` | Lines | 97.21% | 100% | -2.79% |
| `src/domain/` | Functions | 96.72% | 100% | -3.28% |
| `src/storage/` | Statements | 85.29% | 90% | -4.71% |
| `src/storage/` | Branches | 80.26% | 85% | -4.74% |
| `src/storage/` | Lines | 85.36% | 90% | -4.64% |
| `src/features/` | Statements | 50.04% | 80% | -29.96% |
| `src/features/` | Branches | 45.31% | 75% | -29.69% |
| `src/features/` | Lines | 48.76% | 80% | -31.24% |
| `src/features/` | Functions | 50.61% | 80% | -29.39% |
| **Global** | Statements | 23.83% | 80% | -56.17% |
| **Global** | Branches | 24.47% | 80% | -55.53% |
| **Global** | Lines | 24.14% | 80% | -55.86% |
| **Global** | Functions | 27.81% | 80% | -52.19% |

### Priority Ranking

1. **HIGH PRIORITY:** `src/domain/` - Near 100%, need to close the gap
2. **HIGH PRIORITY:** `src/storage/` - Close to threshold, achievable
3. **MEDIUM PRIORITY:** `src/features/` - Significant gap, major effort needed
4. **LOW PRIORITY:** Global - Will improve as other areas improve

---

## Phase 1: Domain Layer (100% Target)

### Gap Analysis
The domain layer is nearly at 100% coverage. Missing coverage is likely in:
- Edge case branches
- Error handling paths
- Rarely executed conditional logic

### Files to Review
```
src/domain/QuickTab.js
src/domain/QuickTabList.js
src/domain/validators/
```

### Action Items

#### 1.1 Add Edge Case Tests for QuickTab Entity
```javascript
// tests/unit/domain/QuickTab-edge-cases.test.js
describe('QuickTab Edge Cases', () => {
  describe('Boundary Conditions', () => {
    it('should handle max safe integer for zIndex');
    it('should handle negative position values');
    it('should handle zero width/height');
    it('should handle empty string URL');
    it('should handle very long URLs (>2000 chars)');
  });
  
  describe('Validation Edge Cases', () => {
    it('should reject invalid URL protocols');
    it('should handle Unicode in titles');
    it('should handle special characters in IDs');
  });
});
```

#### 1.2 Add Missing Branch Tests for QuickTabList
```javascript
// tests/unit/domain/QuickTabList-branches.test.js
describe('QuickTabList Branch Coverage', () => {
  describe('Empty List Operations', () => {
    it('should handle getById on empty list');
    it('should handle remove on empty list');
    it('should handle update on empty list');
  });
  
  describe('Error Paths', () => {
    it('should throw on duplicate ID add');
    it('should return undefined for missing ID');
  });
});
```

#### 1.3 Validator Complete Coverage
```javascript
// tests/unit/domain/validators/complete.test.js
describe('Validators Complete Coverage', () => {
  describe('URL Validator', () => {
    it('should reject javascript: protocol');
    it('should reject data: protocol');
    it('should reject vbscript: protocol');
    it('should accept http, https, file protocols');
  });
  
  describe('ID Validator', () => {
    it('should handle UUID format');
    it('should handle custom ID format');
  });
});
```

**Estimated Effort:** 1-2 hours
**Expected Coverage Improvement:** +2.68% statements, +7.70% branches

---

## Phase 2: Storage Layer (90% Target)

### Gap Analysis
Storage layer needs ~5% improvement across all metrics. Missing coverage likely in:
- Error recovery paths
- Quota exhaustion handling
- Migration logic

### Files to Review
```
src/storage/SyncStorageAdapter.js
src/storage/LocalStorageAdapter.js
src/storage/migrations/
```

### Action Items

#### 2.1 Storage Error Handling Tests
```javascript
// tests/unit/storage/error-handling.test.js
describe('Storage Error Handling', () => {
  describe('Quota Exceeded', () => {
    it('should handle storage quota exceeded error');
    it('should trigger cleanup on quota exceeded');
    it('should retry after cleanup');
  });
  
  describe('Corruption Recovery', () => {
    it('should detect corrupted data structure');
    it('should recover from backup');
    it('should clear and reinitialize on total corruption');
  });
  
  describe('Concurrent Access', () => {
    it('should handle concurrent writes');
    it('should resolve write conflicts');
  });
});
```

#### 2.2 Migration Tests
```javascript
// tests/unit/storage/migrations.test.js
describe('Storage Migrations', () => {
  describe('Container to Unified Format', () => {
    it('should migrate v1 container format');
    it('should migrate v2 container format');
    it('should preserve all tab properties during migration');
  });
  
  describe('Session Storage Migration', () => {
    it('should migrate from storage.session to storage.local');
    it('should handle missing session data');
  });
});
```

#### 2.3 Adapter Branch Coverage
```javascript
// tests/unit/storage/adapters-branches.test.js
describe('Storage Adapter Branches', () => {
  describe('Save Edge Cases', () => {
    it('should handle save with empty tabs array');
    it('should handle save with null properties');
    it('should handle save during pending operation');
  });
  
  describe('Load Edge Cases', () => {
    it('should handle load with missing key');
    it('should handle load with malformed data');
    it('should handle load during pending write');
  });
});
```

**Estimated Effort:** 2-3 hours
**Expected Coverage Improvement:** +4.71% statements, +4.74% branches

---

## Phase 3: Features Layer (80% Target)

### Gap Analysis
Features layer has the largest gap (~30%). This is the most complex area with:
- UI interaction handlers
- State machine logic
- Event handling
- Window management

### Files to Review (Priority Order)
```
src/features/quick-tabs/index.js                    # Entry point
src/features/quick-tabs/handlers/CreateHandler.js
src/features/quick-tabs/handlers/UpdateHandler.js
src/features/quick-tabs/handlers/DestroyHandler.js
src/features/quick-tabs/handlers/VisibilityHandler.js
src/features/quick-tabs/state-machine.js
src/features/quick-tabs/window.js
src/features/quick-tabs/UICoordinator.js
src/features/quick-tabs/mediator.js
```

### Action Items

#### 3.1 QuickTabHandler (index.js) Tests
```javascript
// tests/unit/features/quick-tabs/QuickTabHandler.test.js
describe('QuickTabHandler', () => {
  describe('Initialization', () => {
    it('should initialize with correct defaults');
    it('should handle initialization timeout');
    it('should detect currentTabId correctly');
    it('should setup storage.onChanged listener');
  });
  
  describe('State Hydration', () => {
    it('should hydrate from storage.local');
    it('should validate checksums during hydration');
    it('should handle checksum mismatch');
    it('should filter tabs by originTabId');
  });
  
  describe('Port Communication', () => {
    it('should establish port connection');
    it('should handle port disconnection');
    it('should reconnect with exponential backoff');
    it('should respect circuit breaker');
  });
  
  describe('BFCache Handling', () => {
    it('should handle pageshow event');
    it('should handle pagehide event');
    it('should re-establish port on BFCache restoration');
  });
});
```

#### 3.2 Handler Tests (Create, Update, Destroy, Visibility)
```javascript
// tests/unit/features/quick-tabs/handlers/comprehensive.test.js
describe('Handler Comprehensive Tests', () => {
  describe('CreateHandler', () => {
    it('should create Quick Tab with all options');
    it('should emit window:created event');
    it('should handle creation failure');
    it('should respect tab limits');
    it('should handle duplicate ID gracefully');
  });
  
  describe('UpdateHandler', () => {
    it('should handle position updates');
    it('should handle size updates');
    it('should debounce rapid updates');
    it('should persist to storage after update');
    it('should handle orphaned DOM element');
  });
  
  describe('DestroyHandler', () => {
    it('should destroy Quick Tab completely');
    it('should cleanup event listeners');
    it('should remove from storage');
    it('should handle destroy on non-existent tab');
  });
  
  describe('VisibilityHandler', () => {
    it('should toggle solo mode');
    it('should toggle mute mode');
    it('should enforce solo/mute mutual exclusivity');
    it('should update storage on visibility change');
  });
});
```

#### 3.3 State Machine Tests
```javascript
// tests/unit/features/quick-tabs/state-machine-complete.test.js
describe('QuickTabStateMachine Complete', () => {
  describe('All State Transitions', () => {
    it('UNKNOWN -> VISIBLE');
    it('UNKNOWN -> MINIMIZED');
    it('VISIBLE -> MINIMIZING');
    it('VISIBLE -> DESTROYED');
    it('MINIMIZING -> MINIMIZED');
    it('MINIMIZED -> RESTORING');
    it('RESTORING -> VISIBLE');
    it('should reject invalid transitions');
  });
  
  describe('Concurrent Operations', () => {
    it('should handle rapid minimize/restore');
    it('should handle concurrent state changes');
  });
  
  describe('History Tracking', () => {
    it('should track all transitions');
    it('should limit history size');
  });
});
```

#### 3.4 Window Management Tests
```javascript
// tests/unit/features/quick-tabs/window-complete.test.js
describe('QuickTabWindow Complete', () => {
  describe('Rendering', () => {
    it('should create container element');
    it('should setup iframe with sandbox');
    it('should setup drag controller');
    it('should setup resize controller');
    it('should handle render failure');
  });
  
  describe('Positioning', () => {
    it('should set initial position');
    it('should update position on drag');
    it('should constrain to viewport');
    it('should handle negative positions');
  });
  
  describe('Sizing', () => {
    it('should set initial size');
    it('should update size on resize');
    it('should respect min/max constraints');
  });
  
  describe('Focus Management', () => {
    it('should bring to front on focus');
    it('should update zIndex');
    it('should handle blur');
  });
  
  describe('Lifecycle', () => {
    it('should minimize correctly');
    it('should restore correctly');
    it('should destroy completely');
    it('should handle multiple destroy calls');
  });
});
```

#### 3.5 UICoordinator Tests
```javascript
// tests/unit/features/quick-tabs/UICoordinator.test.js
describe('UICoordinator', () => {
  describe('Tab Registration', () => {
    it('should register rendered tabs');
    it('should track originTabId');
    it('should enforce tab limits');
  });
  
  describe('Rendering Decisions', () => {
    it('should render visible tabs');
    it('should skip minimized tabs');
    it('should handle solo mode visibility');
    it('should handle mute mode visibility');
  });
  
  describe('Event Handling', () => {
    it('should handle window:created event');
    it('should handle state:minimized event');
    it('should handle state:restored event');
    it('should handle state:deleted event');
  });
  
  describe('Cleanup', () => {
    it('should cleanup on tab close');
    it('should cleanup on extension unload');
  });
});
```

#### 3.6 Mediator Tests
```javascript
// tests/unit/features/quick-tabs/mediator.test.js
describe('QuickTabMediator', () => {
  describe('Operations', () => {
    it('should coordinate minimize operation');
    it('should coordinate restore operation');
    it('should coordinate destroy operation');
    it('should coordinate update operation');
  });
  
  describe('Error Handling', () => {
    it('should handle operation timeout');
    it('should handle partial failure');
    it('should rollback on error');
  });
  
  describe('State Consistency', () => {
    it('should maintain state consistency');
    it('should handle concurrent operations');
  });
});
```

**Estimated Effort:** 8-12 hours
**Expected Coverage Improvement:** +29.96% statements, +29.69% branches

---

## Phase 4: Global Coverage Improvements

### Gap Analysis
Global coverage is at ~24%, far below the 80% threshold. This includes:
- `background.js` (large file, complex logic)
- `sidebar/quick-tabs-manager.js` (sidebar manager)
- `options_page.js` and `popup.js` (UI pages)
- `state-manager.js` (global state)

### Files to Review
```
background.js                           # ~5000 lines
sidebar/quick-tabs-manager.js           # ~6000 lines
state-manager.js
options_page.js
popup.js
src/content.js
```

### Action Items

#### 4.1 Background Script Tests
```javascript
// tests/unit/background/background.test.js
describe('Background Script', () => {
  describe('Port Management', () => {
    it('should register new ports');
    it('should handle port disconnection');
    it('should cleanup stale ports');
    it('should broadcast to all ports');
  });
  
  describe('Storage Operations', () => {
    it('should write with validation');
    it('should handle quota exceeded');
    it('should monitor storage usage');
    it('should maintain checksum');
  });
  
  describe('Message Handlers', () => {
    it('should handle RESTORE message');
    it('should handle MINIMIZE message');
    it('should handle DELETE message');
    it('should handle SYNC_STATE message');
  });
  
  describe('Keepalive', () => {
    it('should maintain background activity');
    it('should handle keepalive failure');
    it('should recover from suspension');
  });
  
  describe('Deduplication', () => {
    it('should deduplicate by saveId');
    it('should deduplicate by sequenceId');
    it('should deduplicate by revision');
    it('should track dedup statistics');
  });
});
```

#### 4.2 Sidebar Manager Tests
```javascript
// tests/unit/sidebar/quick-tabs-manager.test.js
describe('Quick Tabs Manager', () => {
  describe('Initialization', () => {
    it('should initialize connection state');
    it('should setup port connection');
    it('should hydrate from background');
    it('should handle initialization timeout');
  });
  
  describe('Tab Rendering', () => {
    it('should render tab list');
    it('should handle empty list');
    it('should update on state change');
    it('should handle rapid updates');
  });
  
  describe('Actions', () => {
    it('should handle minimize action');
    it('should handle restore action');
    it('should handle delete action');
    it('should handle close all action');
    it('should handle close minimized action');
  });
  
  describe('Cross-Tab Sync', () => {
    it('should receive storage updates');
    it('should validate update ordering');
    it('should handle out-of-order updates');
  });
});
```

#### 4.3 State Manager Tests
```javascript
// tests/unit/state-manager.test.js
describe('StateManager', () => {
  describe('Tab Count Tracking', () => {
    it('should track Quick Tab count');
    it('should check limit exceeded');
    it('should handle add/remove operations');
  });
  
  describe('Global State', () => {
    it('should maintain global state');
    it('should sync across contexts');
  });
});
```

#### 4.4 Content Script Tests
```javascript
// tests/unit/content.test.js
describe('Content Script', () => {
  describe('Initialization', () => {
    it('should detect Quick Tab triggers');
    it('should setup event listeners');
    it('should establish background connection');
  });
  
  describe('Port Communication', () => {
    it('should send messages via port');
    it('should handle port failure');
    it('should fallback to storage');
  });
  
  describe('Storage Fallback', () => {
    it('should listen to storage.onChanged');
    it('should validate ordering');
    it('should handle stale data');
  });
  
  describe('BFCache Handling', () => {
    it('should detect BFCache restoration');
    it('should re-establish port');
    it('should refresh state');
  });
});
```

**Estimated Effort:** 15-20 hours
**Expected Coverage Improvement:** +56% statements, +55% branches

---

## Implementation Strategy

### Sprint Planning

#### Sprint 1: Foundation (Week 1)
- [ ] Phase 1: Domain Layer Tests (1-2 hours)
- [ ] Phase 2: Storage Layer Tests (2-3 hours)
- [ ] Review and merge

#### Sprint 2: Features (Week 2-3)
- [ ] Phase 3.1: QuickTabHandler tests (2 hours)
- [ ] Phase 3.2: Handler tests (2 hours)
- [ ] Phase 3.3-3.4: State Machine & Window tests (2 hours)
- [ ] Phase 3.5-3.6: UICoordinator & Mediator tests (2 hours)
- [ ] Review and merge

#### Sprint 3: Global Coverage (Week 4-5)
- [ ] Phase 4.1: Background script tests (5 hours)
- [ ] Phase 4.2: Sidebar manager tests (5 hours)
- [ ] Phase 4.3-4.4: State manager & content script (4 hours)
- [ ] Review and merge

### Test Infrastructure Improvements

#### 1. Mock Improvements
- Enhance `tests/__mocks__/browser.js` with more complete API coverage
- Add storage.onChanged event simulation
- Add tabs API mocking

#### 2. Test Utilities
- Create `tests/helpers/storage-simulator.js` for storage event simulation
- Create `tests/helpers/port-simulator.js` for port communication testing
- Enhance `tests/helpers/cross-tab-simulator.js` with new sync patterns

#### 3. CI/CD Integration
- Add coverage reporting to CI pipeline
- Block PRs that decrease coverage
- Generate coverage badges

---

## Success Criteria

### Phase Completion Metrics

| Phase | Target Coverage | Success Criteria |
|-------|-----------------|------------------|
| Phase 1 | 100% domain | All domain tests at 100% |
| Phase 2 | 90% storage | Storage at 90%+ |
| Phase 3 | 80% features | Features at 80%+ |
| Phase 4 | 80% global | Global at 80%+ |

### Quality Gates
- All tests must pass
- No decrease in existing coverage
- All new code must have tests
- Integration tests must cover cross-tab scenarios

---

## Appendix: Test File Structure

```
tests/
├── unit/
│   ├── domain/
│   │   ├── QuickTab.test.js
│   │   ├── QuickTab-edge-cases.test.js (NEW)
│   │   ├── QuickTabList.test.js
│   │   ├── QuickTabList-branches.test.js (NEW)
│   │   └── validators/
│   │       └── complete.test.js (NEW)
│   ├── storage/
│   │   ├── StorageAdapter.test.js
│   │   ├── SyncStorageAdapter.test.js
│   │   ├── error-handling.test.js (NEW)
│   │   ├── migrations.test.js (NEW)
│   │   └── adapters-branches.test.js (NEW)
│   ├── features/
│   │   └── quick-tabs/
│   │       ├── QuickTabHandler.test.js (NEW)
│   │       ├── state-machine-complete.test.js (NEW)
│   │       ├── window-complete.test.js (NEW)
│   │       ├── UICoordinator.test.js (NEW)
│   │       ├── mediator.test.js (NEW)
│   │       └── handlers/
│   │           ├── CreateHandler.test.js
│   │           ├── UpdateHandler.test.js
│   │           └── comprehensive.test.js (NEW)
│   ├── background/
│   │   └── background.test.js (NEW)
│   ├── sidebar/
│   │   └── quick-tabs-manager.test.js (NEW)
│   ├── state-manager.test.js (NEW)
│   └── content.test.js (NEW)
├── integration/
│   └── scenarios/
│       └── (existing 17 scenario files)
└── helpers/
    ├── cross-tab-simulator.js
    ├── storage-simulator.js (NEW)
    └── port-simulator.js (NEW)
```

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-13 | Initial testing improvement plan for v1.6.3.8-v6 |
