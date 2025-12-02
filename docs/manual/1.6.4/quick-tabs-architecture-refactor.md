# Quick Tabs Architecture Refactor: Hybrid Mediator + State Machine

**Extension Version:** v1.6.4.12+  
**Date:** December 02, 2025  
**Scope:** Architectural enhancement to eliminate race conditions through coordinated state management and atomic operations

---

## Executive Summary

The current Quick Tabs architecture uses a distributed event bus pattern where multiple handlers listen to events and independently modify shared state (the `renderedTabs` Map and `minimizedTabs` snapshots). This creates race conditions when operations overlap. The proposed refactor introduces a **Hybrid Mediator + State Machine** pattern that centralizes coordination while maintaining the existing handler separation. This approach provides explicit state validation, atomic operations, idempotent event handling, and comprehensive audit trails without creating a monolithic "god object."

## Architectural Goals

**Primary Objectives:**
- Eliminate race conditions in minimize/restore operations
- Provide atomic Map operations with transaction rollback
- Add explicit state machine validation before operations
- Enable comprehensive operation tracing and audit logs
- Maintain testability and separation of concerns

**Non-Objectives:**
- Do NOT consolidate handlers into single monolithic function
- Do NOT remove event bus (preserve existing communication pattern)
- Do NOT rewrite storage layer (enhance with transactions only)
- Do NOT change external APIs or message handler interfaces

---

## Proposed Architecture Layers

### Layer 1: QuickTabStateMachine (New)

**Purpose:** Explicit lifecycle state tracking and transition validation

**Responsibilities:**
- Track each Quick Tab's current state (VISIBLE, MINIMIZING, MINIMIZED, RESTORING, DESTROYED)
- Validate state transitions before allowing operations
- Log every state change with timestamp and initiator
- Reject invalid operations (e.g., minimize already-minimized tab)
- Provide state history for debugging

**Integration Point:**  
New module at `src/features/quick-tabs/state-machine.js`

**Key Operations:**
- `getState(id)` - Returns current state for a Quick Tab
- `canTransition(id, fromState, toState)` - Validates if transition is allowed
- `transition(id, toState, metadata)` - Performs state change with logging
- `getHistory(id)` - Returns state change history for debugging

**State Transition Rules:**
```
VISIBLE → MINIMIZING (minimize button clicked)
MINIMIZING → MINIMIZED (DOM removed, snapshot saved)
MINIMIZED → RESTORING (restore initiated)
RESTORING → VISIBLE (DOM rendered, snapshot cleared)
VISIBLE → DESTROYED (close button clicked)
MINIMIZED → DESTROYED (close while minimized)
```

**Why This Helps:**
Research shows "State machines is a way to design your application so that a state change is VERY EXPLICIT... makes it easier to test... much easier to debug asynchronous issues" (Reddit r/reactjs). The 73-second logging gap becomes impossible because every state transition logs immediately. Duplicate operations are rejected at validation time before touching the Map.

---

### Layer 2: QuickTabMediator (New)

**Purpose:** Centralized coordinator for multi-step Quick Tab operations

**Responsibilities:**
- Single entry point for all minimize/restore/destroy operations
- Orchestrate handlers in correct sequence (VisibilityHandler → MinimizedManager → UICoordinator)
- Coordinate atomic Map operations across multiple handlers
- Provide transaction rollback if any step fails
- Maintain operation-in-progress locks to prevent duplicates

**Integration Point:**  
New module at `src/features/quick-tabs/mediator.js`

**Key Operations:**
- `minimize(id, source)` - Coordinate full minimize sequence
- `restore(id, source)` - Coordinate full restore sequence
- `destroy(id, source)` - Coordinate full destruction sequence
- `executeWithRollback(operation, rollbackFn)` - Wrap operations in transaction

**Minimize Flow Example:**
```
1. Check state machine: is tab in VISIBLE state?
2. If no, reject operation with error
3. Transition to MINIMIZING state
4. Call VisibilityHandler.handleMinimize()
5. Call MinimizedManager.add() with snapshot
6. Call UICoordinator.update() with source='Manager'
7. Transition to MINIMIZED state
8. On ANY failure: rollback to VISIBLE state, restore DOM
```

**Why This Helps:**
Research shows "The Mediator Pattern would likely be the best fit for your scenario if the components are part of a complex interaction" (Reddit r/softwarearchitecture). The mediator ensures all steps complete atomically or roll back together. No partial state where snapshot exists but Map entry is missing.

---

### Layer 3: MapTransactionManager (New)

**Purpose:** Atomic operations on `renderedTabs` Map with logging and rollback

**Responsibilities:**
- Wrap all Map delete/set sequences in transactions
- Capture Map state before modifications
- Log Map contents (not just size) at every operation
- Validate final state matches expected state
- Rollback on validation failure

**Integration Point:**  
New module at `src/features/quick-tabs/map-transaction-manager.js`

**Key Operations:**
- `beginTransaction()` - Capture current Map state as snapshot
- `deleteEntry(id, reason)` - Delete with logging, validation pending commit
- `setEntry(id, window, reason)` - Set with logging, validation pending commit
- `commitTransaction()` - Validate final state, make changes permanent
- `rollbackTransaction()` - Restore Map to snapshot state

**Transaction Pattern:**
```
1. beginTransaction() - Snapshot Map: { qt-123: window1, qt-456: window2 }
2. deleteEntry('qt-123', 'restore operation') - Staged: delete qt-123
3. Perform work (render, apply snapshot, etc.)
4. setEntry('qt-123', newWindow, 'restore complete') - Staged: add qt-123
5. commitTransaction() - Validate: Map has qt-123 and qt-456, commit changes
```

**Why This Helps:**
Research shows "A centralized transaction management system, where transactions are managed by a dedicated service or module, can help enforce this consistency" (Dispatcher Transaction Issue article). This eliminates the timing gap where Map is in inconsistent state. Other operations reading the Map during transaction see the pre-transaction state (snapshot), not intermediate state.

---

### Layer 4: StorageTransactionEnhancement (Modified)

**Purpose:** Add transaction sequencing logs and operation tracking to existing storage layer

**Responsibilities:**
- Log which operation initiated each storage write (minimize vs. restore)
- Log previous completed transaction ID for sequencing
- Log queue depth (how many writes pending)
- Log queue reset events when writes fail

**Integration Point:**  
Enhance existing `src/utils/storage-utils.js` module

**Key Enhancements:**
- Add `initiator` parameter to `persistStateToStorage()` (e.g., 'VisibilityHandler.minimize')
- Track `lastCompletedTransactionId` globally
- Log before/after queue depth in `queueStorageWrite()`
- Log "Queue RESET - X writes dropped" when queue resets after failure

**Why This Helps:**
Current logs show storage writes completing but not their ORDER or which operation triggered them. Enhanced logs show: "After [txn-122], starting [txn-123] for VisibilityHandler.minimize, queue depth: 3". This creates complete audit trail showing write sequencing.

---

## Implementation Strategy

### Phase 1: Add State Machine Layer (Week 1)

**Deliverables:**
- Create `QuickTabStateMachine` class with state tracking
- Define all valid state transitions
- Add state validation to UICoordinator before operations
- Add state transition logging to every operation

**Modified Files:**
- NEW: `src/features/quick-tabs/state-machine.js`
- MODIFY: `src/features/quick-tabs/coordinators/UICoordinator.js` (add state checks)
- MODIFY: `src/features/quick-tabs/handlers/VisibilityHandler.js` (add state transitions)

**Acceptance Criteria:**
- Every Quick Tab has tracked state in state machine
- Invalid operations rejected with clear error: "Cannot minimize tab in MINIMIZING state"
- State transition logs show: "qt-123: VISIBLE → MINIMIZING at T+0ms by VisibilityHandler"
- No operations execute without state validation

**Risk Mitigation:**
- State machine is read-only initially (logs warnings but doesn't block operations)
- Enable enforcement incrementally per operation type
- Add kill switch to disable state machine if issues arise

---

### Phase 2: Add Mediator Layer (Week 2)

**Deliverables:**
- Create `QuickTabMediator` class as single coordinator
- Route minimize/restore through mediator instead of direct handler calls
- Add rollback capability for failed operations
- Maintain operation-in-progress locks

**Modified Files:**
- NEW: `src/features/quick-tabs/mediator.js`
- MODIFY: `src/features/quick-tabs/index.js` (wire mediator into initialization)
- MODIFY: `src/features/quick-tabs/handlers/VisibilityHandler.js` (accept mediator calls)

**Acceptance Criteria:**
- All minimize operations go through `mediator.minimize(id, source)`
- If minimize fails at any step, rollback restores previous state
- Operation locks prevent duplicate minimize within 500ms
- Mediator logs show: "minimize(qt-123) START → step1 OK → step2 OK → COMPLETE"

**Risk Mitigation:**
- Mediator wraps existing handlers, doesn't replace them
- Add feature flag to bypass mediator if needed
- Monitor for performance regression (mediator adds <5ms overhead)

---

### Phase 3: Add Map Transaction Manager (Week 3)

**Deliverables:**
- Create `MapTransactionManager` for atomic Map operations
- Replace all delete+set sequences with transaction blocks
- Add Map contents logging (array of IDs) at every operation
- Add validation that final Map state matches expected state

**Modified Files:**
- NEW: `src/features/quick-tabs/map-transaction-manager.js`
- MODIFY: `src/features/quick-tabs/coordinators/UICoordinator.js` (use transaction manager)

**Acceptance Criteria:**
- Every Map modification wrapped in transaction
- Logs show Map contents before/after: "Before: [qt-123, qt-456], After: [qt-456, qt-789]"
- If validation fails, transaction rolls back and logs error
- No "Map unexpectedly empty" errors occur

**Risk Mitigation:**
- Transaction manager uses shallow copy for snapshot (low memory overhead)
- Transactions timeout after 5 seconds to prevent locks
- Failed transactions log full diagnostic info for debugging

---

### Phase 4: Add Storage Transaction Sequencing (Week 4)

**Deliverables:**
- Enhance storage logs with transaction sequencing
- Add initiator tracking (which handler triggered write)
- Add queue depth visibility
- Add queue reset logging

**Modified Files:**
- MODIFY: `src/utils/storage-utils.js` (enhance logging)

**Acceptance Criteria:**
- Storage logs show: "After [txn-122], starting [txn-123] for VisibilityHandler.minimize"
- Queue depth visible: "Queue depth: 3 pending writes"
- Queue reset logged: "Queue RESET after [txn-124] failure - 2 writes dropped"

**Risk Mitigation:**
- Logging enhancements don't change storage behavior
- Excessive logging can be disabled via flag
- Log volume monitored (target <100 entries per operation)

---

## Integration with Existing Code

### Event Bus Pattern (Preserved)

**Current:** Handlers listen to `eventBus.on('state:updated', ...)` and react independently

**After Refactor:** Same pattern, but handlers delegate to mediator for coordination

**Example:**
```
// VisibilityHandler receives minimize request
handleMinimize(id, source) {
  // Delegate to mediator for coordination
  return this.mediator.minimize(id, source);
}

// Mediator coordinates the operation
async minimize(id, source) {
  // Check state machine
  if (!this.stateMachine.canTransition(id, 'VISIBLE', 'MINIMIZING')) {
    return { success: false, error: 'Invalid state for minimize' };
  }
  
  // Begin Map transaction
  await this.mapTxnManager.beginTransaction();
  
  // Execute operation steps
  this.stateMachine.transition(id, 'MINIMIZING', { source });
  await this.visibilityHandler._executeMinimize(id, source);
  this.minimizedManager.add(id, tabWindow);
  await this.uiCoordinator.update(quickTab, source);
  this.stateMachine.transition(id, 'MINIMIZED', { source });
  
  // Commit transaction
  await this.mapTxnManager.commitTransaction();
  
  return { success: true };
}
```

---

### Handler Responsibilities (Preserved)

**VisibilityHandler:** Still handles minimize/restore logic, but delegates coordination to mediator

**MinimizedManager:** Still manages snapshots, but clears atomically on first use

**UICoordinator:** Still renders windows, but uses MapTransactionManager for atomic Map ops

**UpdateHandler:** Still handles position/size changes, unchanged by refactor

**DestroyHandler:** Still handles close operations, routes through mediator for coordination

---

### Storage Layer (Enhanced, Not Replaced)

**Current:** `persistStateToStorage()` writes to browser.storage.local with queue

**After Refactor:** Same functionality, enhanced logs show transaction sequencing

**Unchanged:**
- FIFO queue ordering
- Debouncing and deduplication
- Validation and error handling

**Added:**
- Initiator tracking (who triggered write)
- Sequence logging (what write came before)
- Queue depth visibility

---

## Why Hybrid Pattern Over Pure Consolidation

### Consolidation Problems (Avoided)

**Single Giant Handler Issues:**
- "Centralized systems often become a bottleneck for data" (Centralized vs. Distributed Tech article)
- "If your central system goes down, it can affect your entire organization" (same source)
- Impossible to unit test (too many responsibilities)
- Difficult to debug (no isolation of concerns)

**Research Evidence:**  
"Many associations find that a hybrid approach — combining centralized and distributed technology management elements — is ideal because it offers the best of both worlds" (Centralized vs. Distributed article)

---

### Hybrid Pattern Benefits (Achieved)

**Preserved Separation:**
- Each handler maintains single responsibility
- Event bus preserved for loose coupling
- Handlers testable in isolation

**Added Coordination:**
- Mediator orchestrates multi-step operations
- State machine validates transitions
- Transaction manager provides atomicity

**Research Evidence:**  
"The Mediator Pattern reduces the complexity of communication between objects by centralizing it in the mediator" (Mediator vs. Observer article). Combined with state machine: "State change is VERY EXPLICIT... makes it easier to test... much easier to debug asynchronous issues" (Reddit r/reactjs).

---

## Rollback and Error Handling

### Transaction Rollback Pattern

**Scenario:** Minimize operation fails partway through

**Without Rollback (Current):**
1. Snapshot saved to MinimizedManager
2. DOM removed from page
3. Storage write fails (network error)
4. Result: Tab appears minimized but state not persisted, reload shows tab as visible with no DOM

**With Rollback (After Refactor):**
1. Begin transaction, capture Map state
2. Save snapshot, remove DOM
3. Storage write fails
4. Rollback: Restore Map state, delete snapshot, re-render DOM
5. Result: Tab remains in VISIBLE state, user sees error notification

---

### Error Recovery Strategy

**Principle:** "Design for Idempotency. In distributed systems, duplicate messages are inevitable... Make consumers idempotent, meaning they can handle the same event repeatedly without unintended side effects" (Event-Based Architectures article)

**Implementation:**
- State machine tracks operation ID for each transition
- If same operation ID seen twice, second is no-op
- Mediator checks operation ID before executing
- Handlers can safely be called multiple times with same params

---

## Testing Strategy

### State Machine Testing

**Unit Tests:**
- Test all valid state transitions
- Test all invalid transitions are rejected
- Test state history tracking
- Test concurrent state queries

**Integration Tests:**
- Test minimize → restore → minimize sequence
- Test rapid operations (10 minimizes in 100ms)
- Test error during transition (should stay in original state)

---

### Mediator Testing

**Unit Tests:**
- Mock all handlers, verify mediator calls them in sequence
- Test rollback on handler failure
- Test operation locks prevent duplicates
- Test timeout handling (operations taking >5s)

**Integration Tests:**
- Test minimize with real handlers
- Test restore with real handlers
- Test concurrent operations (2 minimizes simultaneously)

---

### Transaction Manager Testing

**Unit Tests:**
- Test begin → modify → commit sequence
- Test begin → modify → rollback sequence
- Test validation catches Map size mismatches
- Test nested transaction rejection

**Integration Tests:**
- Test delete+set sequence is atomic
- Test rollback restores original Map state
- Test concurrent transactions block correctly

---

## Performance Considerations

### Memory Overhead

**State Machine:**
- Stores state enum per Quick Tab (~4 bytes)
- Stores state history (last 10 transitions, ~1KB per tab)
- Total: <10KB for 100 Quick Tabs

**Transaction Manager:**
- Shallow copy of Map for snapshot (~100 bytes per tab)
- Single active transaction at a time
- Total: <10KB per operation

**Overall Impact:** <1MB additional memory for typical usage (10-20 Quick Tabs)

---

### CPU Overhead

**State Machine:**
- State lookup: O(1) hash table
- Transition validation: O(1) rule check
- Overhead: <1ms per operation

**Mediator:**
- Coordination logic: Sequential async/await calls
- No additional computation
- Overhead: <5ms per operation

**Transaction Manager:**
- Snapshot creation: O(n) where n = Map size
- For typical n=10: <1ms
- Overhead: <2ms per operation

**Overall Impact:** <10ms added latency per minimize/restore operation (imperceptible to users)

---

## Migration Path

### Backward Compatibility

**During Migration:**
- New layers coexist with old code
- Feature flags enable incremental rollout
- Old code paths remain functional

**After Migration:**
- All operations route through new layers
- Old direct handler calls deprecated but not removed
- External APIs unchanged (message handlers, keyboard shortcuts)

---

### Rollback Plan

**If Issues Arise:**
1. Disable state machine enforcement (validation becomes warnings)
2. Bypass mediator (handlers called directly)
3. Disable transaction manager (use original Map operations)
4. Revert storage logging enhancements

**Each layer independent:** Can disable one without affecting others

---

## Success Metrics

### Quantitative Metrics

**Before Refactor:**
- Map corruption events: 2-3 per week (from user reports)
- Duplicate window events: 1-2 per week
- Storage write failures: 5% of operations

**After Refactor (Target):**
- Map corruption events: 0 (prevented by transactions)
- Duplicate window events: 0 (prevented by state machine)
- Storage write failures: <1% (improved logging helps diagnose)

---

### Qualitative Metrics

**Before Refactor:**
- Debugging requires reading 73-second log gaps
- Unclear what caused Map corruption
- Cannot reproduce race conditions reliably

**After Refactor (Target):**
- Every operation has complete audit trail
- Map corruption impossible (transactions ensure atomicity)
- Race conditions reproducible in tests (state machine makes timing explicit)

---

<scope>
**Create New Files:**
- `src/features/quick-tabs/state-machine.js`
- `src/features/quick-tabs/mediator.js`
- `src/features/quick-tabs/map-transaction-manager.js`

**Modify Existing Files:**
- `src/features/quick-tabs/coordinators/UICoordinator.js` (use transaction manager)
- `src/features/quick-tabs/handlers/VisibilityHandler.js` (delegate to mediator)
- `src/features/quick-tabs/minimized-manager.js` (atomic snapshot clearing)
- `src/utils/storage-utils.js` (enhanced logging)
- `src/features/quick-tabs/index.js` (wire new layers into initialization)

**Do NOT Modify:**
- `src/background/` (out of scope)
- `src/content.js` (message handlers working correctly)
- `popup.js` / `options_page.js` (UI unchanged)
- `manifest.json` (no permission changes needed)
</scope>

---

**Priority:** High - Architectural foundation for eliminating race conditions  
**Target:** Phased implementation over 4 weeks  
**Estimated Complexity:** High - Requires careful coordination of new layers with existing code  
**Risk Level:** Medium - Incremental rollout with feature flags mitigates risk