# Test Coverage Improvement Plan

**Document Version:** 1.0  
**Date:** December 13, 2025  
**Extension Version:** v1.6.3.8-v7  
**Current Coverage:** 47.54% statements, 43.97% branches, 49.35% functions  
**Target Coverage:** 80% global (aligned with jest.config.cjs thresholds)

---

## Executive Summary

This document provides a comprehensive roadmap for increasing test coverage from
47.54% to 80%+ based on:

1. Current Jest coverage metrics analysis
2. Quick Tabs Behavior Scenarios (issue-47-revised.md - 21 scenarios)
3. Architectural gaps identified in jest-testing-infrastructure.md

---

## Current Coverage Analysis

### Coverage by Layer (from Jest output)

| Layer        | Statements | Branches | Functions | Lines  | Status                |
| ------------ | ---------- | -------- | --------- | ------ | --------------------- |
| **Domain**   | 99.23%     | 97.28%   | ~99%      | 99.2%  | ⚠️ Near target (100%) |
| **Storage**  | 97.05%     | 92.1%    | 94.44%    | 96.95% | ✅ Exceeds threshold  |
| **Features** | 49.93%     | 45.12%   | 50.35%    | 48.65% | ❌ Needs +30%         |
| **Utils**    | 20.71%     | 26.07%   | 22.7%     | 21%    | ❌ Critical gap       |
| **UI**       | 0%         | 0%       | 0%        | 0%     | ❌ Untested           |
| **Global**   | 47.54%     | 43.97%   | 49.35%    | 46.55% | ❌ Needs +33%         |

### Critical Coverage Gaps

| File                               | Current | Target | Gap       | Priority |
| ---------------------------------- | ------- | ------ | --------- | -------- |
| `src/utils/storage-utils.js`       | 9.7%    | 80%    | **70.3%** | CRITICAL |
| `src/utils/message-utils.js`       | 0%      | 80%    | **80%**   | CRITICAL |
| `src/utils/console-interceptor.js` | 0%      | 50%    | **50%**   | HIGH     |
| `src/utils/debug.js`               | 8.69%   | 60%    | **51.3%** | HIGH     |
| `src/utils/logger.js`              | 27.58%  | 70%    | **42.4%** | HIGH     |
| `src/utils/filter-settings.js`     | 34.48%  | 70%    | **35.5%** | MEDIUM   |
| `src/ui/components.js`             | 0%      | 60%    | **60%**   | MEDIUM   |

---

## Phase 1: Critical Infrastructure Tests (Week 1)

**Goal:** Test the core utilities that support all other features

### 1.1 Storage Utils Tests

**File:** `tests/unit/utils/storage-utils.test.js`  
**Coverage Target:** 9.7% → 80%  
**Estimated Tests:** 40-50

**Key Functions to Test:**

- `writeStateWithVerificationAndRetry()` - Storage write with validation
- `logStorageRead()` / `logStorageWrite()` - Storage logging
- `canCurrentTabModifyQuickTab()` - Ownership validation
- `validateOwnershipForWrite()` - Write permission check
- `computeChecksum()` - Checksum calculation (djb2-like hash)

**Test Categories:**

- Normal writes with successful verification
- Writes with quota exceeded scenarios
- Checksum validation success/failure
- originTabId filtering behavior
- Retry logic on write failures

### 1.2 Message Utils Tests

**File:** `tests/unit/utils/message-utils.test.js`  
**Coverage Target:** 0% → 80%  
**Estimated Tests:** 30-40

**Key Functions to Test:**

- `MessageBatcher.queue()` - Message queueing
- `MessageBatcher._flushBatch()` - Batch flushing
- ACK-based messaging patterns
- Queue depth monitoring
- TTL-based message pruning

**Test Categories:**

- Queue operations (enqueue, dequeue, flush)
- TTL enforcement (30s MAX_MESSAGE_AGE_MS)
- Queue overflow handling (100 message limit)
- correlationId propagation
- Error scenarios (flush failures)

---

## Phase 2: Features Layer Tests (Weeks 2-3)

**Goal:** Cover Quick Tabs feature modules aligned with behavior scenarios

### 2.1 Quick Tab State Machine Tests

**File:** `tests/unit/features/quick-tabs/state-machine.test.js`  
**Related Scenarios:** 5 (Minimize), 19 (Minimize/Restore Cycle)

**Test Transitions:**

- UNKNOWN → VISIBLE (create)
- VISIBLE → MINIMIZED (minimize)
- MINIMIZED → VISIBLE (restore)
- VISIBLE → DESTROYED (close)
- MINIMIZED → DESTROYED (close minimized)

**Use Helper:** `tests/helpers/state-machine-utils.js`

### 2.2 Quick Tab Handler Tests

**File:** `tests/unit/features/quick-tabs/handlers/*.test.js`

**Handlers to Test:**

- `CreateHandler.js` - Tab creation (Scenarios 1, 2, 9)
- `DestroyHandler.js` - Tab destruction (Scenarios 6, 7, 8)
- `MinimizeHandler.js` - Minimize operation (Scenarios 5, 8)
- `RestoreHandler.js` - Restore operation (Scenarios 5, 19)
- `UpdateHandler.js` - Position/size updates (Scenarios 3, 13)

**Use Helper:** `tests/helpers/coordinator-utils.js`

### 2.3 Quick Tab Manager Tests

**File:** `tests/unit/features/quick-tabs/managers/*.test.js`

**Managers to Test:**

- `QuickTabGroupManager.js` - Group management (Scenario 4)
- `MemoryMonitor.js` - Memory tracking (Scenario 21)
- `PerformanceMetrics.js` - Performance tracking
- `MinimizedManager.js` - Minimized state (Scenarios 5, 8)

**Use Helper:** `tests/helpers/manager-factory.js`

---

## Phase 3: Cross-Tab Synchronization Tests (Week 4)

**Goal:** Validate tab isolation and cross-tab behavior from issue-47-revised.md

### 3.1 Tab Isolation Tests (Scenarios 1, 2)

**File:** `tests/integration/cross-tab/tab-isolation.test.js`

**Test Cases:**

- Quick Tab created in Tab A not visible in Tab B
- Multiple Quick Tabs in same tab stay isolated
- originTabId correctly assigned on creation
- Hydration filters correctly by originTabId

**Use Helper:** `tests/helpers/cross-tab-simulator.js`

### 3.2 Hydration Tests (Scenarios 11, 12)

**File:** `tests/integration/cross-tab/hydration.test.js`

**Test Cases:**

- Page reload restores Quick Tabs for current tab only
- Tab closure removes Quick Tabs from manager
- BFCache restoration re-reads storage.local
- Storage.onChanged updates other tabs

### 3.3 Position/Size Persistence Tests (Scenarios 3, 13)

**File:** `tests/integration/cross-tab/persistence.test.js`

**Test Cases:**

- Position persists within single tab across reload
- Position changes in Tab A don't affect Tab B
- Size changes persist correctly
- Emergency save on rapid tab switching (Scenario 17)

---

## Phase 4: Communication Layer Tests (Week 5)

**Goal:** Test the new v1.6.3.8-v7 communication features

### 4.1 Port Lifecycle Tests

**File:** `tests/unit/communication/port-lifecycle.test.js`

**Test Cases:**

- Port registration with portSequenceId
- Port cleanup on disconnect
- Circuit breaker state transitions (HEALTHY → DEGRADED → CRITICAL →
  DISCONNECTED)
- frameId tracking for iframe ports

**Use Helper:** `tests/helpers/port-simulator.js`

### 4.2 Circuit Breaker Tests

**File:** `tests/unit/communication/circuit-breaker.test.js`

**Test Cases:**

- State transitions on failures
- Time-based escalation (5s window)
- Port eviction after max duration (10s)
- Queue draining for dead ports
- Message TTL enforcement (60s)

### 4.3 Correlation ID Tests

**File:** `tests/unit/communication/correlation-id.test.js`

**Test Cases:**

- correlationId generation format
- correlationId propagation through message chain
- correlationId in storage writes
- End-to-end tracing validation

---

## Phase 5: Storage Quota & Recovery Tests (Week 6)

**Goal:** Test storage monitoring and recovery mechanisms

### 5.1 Quota Monitoring Tests

**File:** `tests/unit/storage/quota-monitoring.test.js`

**Test Cases:**

- Adaptive monitoring (5-min vs 1-min intervals)
- Aggregated quota calculation (local + sync + session)
- Warning thresholds (50%, 75%, 90%)
- Quota recovery cleanup triggers

### 5.2 Event Age & Deduplication Tests

**File:** `tests/unit/storage/deduplication.test.js`

**Test Cases:**

- Maximum event age enforcement (5-min)
- Stale event rejection with logging
- Dedup tier counting
- saveId-based deduplication

---

## Phase 6: UI Component Tests (Week 7)

**Goal:** Test UI components with Testing Library

### 6.1 Quick Tab Window Tests

**File:** `tests/unit/ui/quick-tab-window.test.js`  
**Related Scenarios:** 15 (Dragging & Layering)

**Test Cases:**

- Window rendering with correct position/size
- Toolbar controls (minimize, close, navigation)
- z-index layering on click
- Drag and resize operations

### 6.2 Quick Tabs Manager Panel Tests

**File:** `tests/unit/ui/manager-panel.test.js`  
**Related Scenarios:** 4 (Manager Display), 7 (Close All), 8 (Close Minimized)

**Test Cases:**

- Tab grouping by originTabId
- Status indicators (green active, yellow minimized)
- Close All button behavior
- Close Minimized button behavior
- Manager position persistence (Scenario 16)

---

## Phase 7: E2E Scenario Tests (Week 8)

**Goal:** Complete all 21 scenarios from issue-47-revised.md using Playwright

### E2E Test Files to Create

| File                                                  | Scenarios | Priority |
| ----------------------------------------------------- | --------- | -------- |
| `tests/e2e/scenarios/01-tab-isolation.spec.js`        | 1         | ✅ Done  |
| `tests/e2e/scenarios/02-multiple-tabs.spec.js`        | 2         | HIGH     |
| `tests/e2e/scenarios/03-position-persistence.spec.js` | 3         | HIGH     |
| `tests/e2e/scenarios/04-manager-grouping.spec.js`     | 4         | HIGH     |
| `tests/e2e/scenarios/05-minimize-restore.spec.js`     | 5, 19     | HIGH     |
| `tests/e2e/scenarios/06-close-operations.spec.js`     | 6, 7, 8   | HIGH     |
| `tests/e2e/scenarios/09-limit-enforcement.spec.js`    | 9         | MEDIUM   |
| `tests/e2e/scenarios/10-persistence-restart.spec.js`  | 10        | MEDIUM   |
| `tests/e2e/scenarios/11-hydration.spec.js`            | 11, 12    | HIGH     |
| `tests/e2e/scenarios/13-position-isolation.spec.js`   | 13        | MEDIUM   |
| `tests/e2e/scenarios/14-container-isolation.spec.js`  | 14, 18    | LOW      |
| `tests/e2e/scenarios/15-dragging-layering.spec.js`    | 15        | LOW      |
| `tests/e2e/scenarios/16-manager-position.spec.js`     | 16        | LOW      |
| `tests/e2e/scenarios/17-rapid-switching.spec.js`      | 17        | MEDIUM   |
| `tests/e2e/scenarios/20-cross-domain.spec.js`         | 20        | LOW      |
| `tests/e2e/scenarios/21-memory-storage.spec.js`       | 21        | LOW      |

---

## Test Helper Usage Summary

| Helper                   | Use Cases                             |
| ------------------------ | ------------------------------------- |
| `manager-factory.js`     | Manager unit tests, mock dependencies |
| `port-simulator.js`      | Port lifecycle, circuit breaker tests |
| `storage-test-helper.js` | Storage validation, quota tests       |
| `cross-tab-simulator.js` | Tab isolation, hydration tests        |
| `state-machine-utils.js` | State machine transition tests        |
| `coordinator-utils.js`   | Handler/coordinator operation tests   |
| `multi-tab-fixture.js`   | E2E multi-tab scenarios               |
| `assertion-helpers.js`   | E2E Quick Tab assertions              |
| `event-tracking.js`      | E2E event verification                |

---

## Expected Coverage After Implementation

| Layer      | Current    | Target  | After Phase | Final    |
| ---------- | ---------- | ------- | ----------- | -------- |
| Domain     | 99.23%     | 100%    | Phase 1     | 100%     |
| Storage    | 97.05%     | 90%     | Phase 5     | 97%+     |
| Features   | 49.93%     | 80%     | Phase 2-3   | 80%+     |
| Utils      | 20.71%     | 80%     | Phase 1     | 80%+     |
| UI         | 0%         | 60%     | Phase 6     | 60%+     |
| **Global** | **47.54%** | **80%** | All Phases  | **80%+** |

---

## Implementation Priority Order

### Week 1 (Blocking)

1. ✅ Storage utils tests (70% coverage gap - highest impact)
2. ✅ Message utils tests (80% coverage gap - CRITICAL)

### Week 2-3 (High)

3. Quick Tab handlers tests (Scenarios 1-9)
4. Manager tests (QuickTabGroupManager, MinimizedManager)
5. State machine tests (Scenario 5, 19)

### Week 4 (High)

6. Cross-tab synchronization tests (Scenarios 11-13)
7. Port lifecycle tests

### Week 5 (Medium)

8. Circuit breaker tests
9. Quota monitoring tests
10. Event age/deduplication tests

### Week 6-7 (Medium)

11. UI component tests
12. Manager panel tests

### Week 8 (E2E)

13. Complete remaining E2E scenarios

---

## Success Metrics

- [ ] Global coverage ≥ 80%
- [ ] Features coverage ≥ 80%
- [ ] Utils coverage ≥ 80%
- [ ] All 21 scenarios have passing E2E tests
- [ ] Domain coverage = 100%
- [ ] No coverage regression in future PRs

---

## Dependencies & Prerequisites

1. **Test Helpers Created** ✅
   - manager-factory.js
   - port-simulator.js
   - storage-test-helper.js
   - cross-tab-simulator.js
   - state-machine-utils.js
   - coordinator-utils.js

2. **E2E Infrastructure Created** ✅
   - multi-tab-fixture.js
   - assertion-helpers.js
   - event-tracking.js

3. **Coverage Tools Installed** ✅
   - Jest with coverage reporting
   - Playwright for E2E tests

---

## Estimated Effort

| Phase     | Tests       | Hours      | Priority   |
| --------- | ----------- | ---------- | ---------- |
| Phase 1   | 80-90       | 16-20      | CRITICAL   |
| Phase 2   | 60-80       | 16-24      | HIGH       |
| Phase 3   | 30-40       | 8-12       | HIGH       |
| Phase 4   | 40-50       | 12-16      | MEDIUM     |
| Phase 5   | 30-40       | 8-12       | MEDIUM     |
| Phase 6   | 40-50       | 12-16      | MEDIUM     |
| Phase 7   | 60-80       | 24-32      | HIGH (E2E) |
| **Total** | **340-430** | **96-132** | -          |

**Timeline:** 6-8 weeks at 16-20 hours/week

---

**Document Maintainer:** GitHub Copilot Coding Agent  
**Repository:** https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition  
**Last
Review Date:** December 13, 2025
