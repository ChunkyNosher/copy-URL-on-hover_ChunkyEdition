# Test-to-Prod Implementation Master Plan

**Source:** docs/manual/v1.6.0/test-to-prod-implementation-guide.md  
**Objective:** Transfer robust error handling from test infrastructure to production code  
**Status:** Phase 1 - Gap 3 COMPLETE ✅

---

## Quick Status Overview

**✅ COMPLETED:**
- Gap 3: Malformed Message Validation (30 tests passing)

**🔄 IN PROGRESS:**
- None

**⚠️ BLOCKED:**
- 57 existing tests failing due to validation (need message format fixes)

**📋 TODO:**
- Gap 6: Container Boundary Validation
- Gap 5: Enhanced Debounce & Loop Prevention
- Gap 1: Storage-Based Fallback
- Gap 2: Error Recovery & Reconnection
- Gap 7: Structured Logging
- Gap 4: Delivery Confirmation (optional)

---

## Phase 1: Critical Safety (Week 1) ⚡

### ✅ Gap 3: Malformed Message Validation [COMPLETE]

**Files Modified:**
- `src/features/quick-tabs/managers/BroadcastManager.js` - Added validation
- `src/features/quick-tabs/schemas/BroadcastMessageSchema.js` - NEW (validation engine)
- `tests/unit/schemas/BroadcastMessageSchema.test.js` - NEW (30 tests)

**What Was Implemented:**
✅ Message structure validation (type + data fields)
✅ Field validation by message type (8 types)
✅ Type coercion (string → number)
✅ Range validation (width/height >= 0)
✅ Array truncation (max 1000 items)
✅ Detailed error reporting
✅ Invalid message event emission
✅ Sanitized data output

**Validation Rules:**
- CREATE: requires id, url, left, top, width, height
- UPDATE_POSITION: requires id, left, top
- UPDATE_SIZE: requires id, width, height
- MINIMIZE/RESTORE/CLOSE: requires id
- SOLO: requires id, soloedOnTabs (array)
- MUTE: requires id, mutedOnTabs (array)

**Known Issue:**
Existing tests use incomplete messages. Need to update test messages to include all required fields.

---

### 📋 Gap 6: Container Boundary Validation [TODO]

**Priority:** HIGH - Security and isolation enforcement

**Implementation Steps:**

1. **Add container ID to broadcast messages** (1 hour)
   - Modify `BroadcastManager.broadcast()` to include `cookieStoreId` in payload
   - Update message schema to support optional `cookieStoreId` field
   - All 8 message types affected

2. **Validate container match on receipt** (2 hours)
   - Update `handleBroadcastMessage()` to check container ID
   - Compare `message.cookieStoreId === this.cookieStoreId`
   - Drop messages from different containers
   - Log container boundary violations
   - Emit `broadcast:container-violation` event

3. **Storage key validation** (2 hours)
   - Add validation to `StorageManager.js`
   - Verify storage keys follow pattern: `quick-tabs-${containerI d}`
   - Reject keys without container ID
   - Add unit tests for storage key validation

4. **Container consistency checks** (1 hour)
   - Periodic verification of current container ID
   - Recreate channel if container changes detected
   - Clear stale data from previous container

5. **Audit mode** (1 hour)
   - Optional debug logging for all container validations
   - Track attempted boundary violations
   - Helps identify browser bugs or conflicts

**Files to Modify:**
- `src/features/quick-tabs/managers/BroadcastManager.js`
- `src/features/quick-tabs/managers/StorageManager.js`
- `src/features/quick-tabs/schemas/BroadcastMessageSchema.js` (add containerID field)

**Tests to Add:**
- Container ID included in all broadcasts
- Messages from other containers rejected
- Storage keys validated for container ID
- Container change triggers channel recreation

**Estimated Time:** 7 hours (1 day)

---

### 📋 Gap 5: Enhanced Debounce & Loop Prevention [TODO]

**Priority:** HIGH - Performance and message storm prevention

**Implementation Steps:**

1. **Add sender identification** (2 hours)
   - Generate unique sender ID per tab (use tab ID or UUID)
   - Include `senderId` in all broadcast messages
   - Track current tab's sender ID in BroadcastManager
   - Ignore messages from self

2. **Enhance debounce key** (1 hour)
   - Change from `${type}-${id}` to `${senderId}-${type}-${id}`
   - Allows simultaneous updates from different tabs
   - Prevents incorrectly debouncing legitimate updates

3. **Circular message detection** (3 hours)
   - Track message lineage (which messages caused which)
   - Detect A → B → A patterns
   - Break loops after 3+ cycles
   - Emit `broadcast:loop-detected` event

4. **Per-tab sequence numbers** (2 hours)
   - Each tab assigns incrementing sequence number
   - Detect out-of-order or duplicate sequences
   - Flag message replay or corruption

5. **Configurable debounce windows** (1 hour)
   - UPDATE_POSITION: 50ms (rapid updates)
   - CREATE/CLOSE: 200ms (infrequent)
   - SOLO/MUTE: 100ms (moderate)
   - Store in constants map

**Files to Modify:**
- `src/features/quick-tabs/managers/BroadcastManager.js`
- `src/features/quick-tabs/schemas/BroadcastMessageSchema.js` (add senderId, sequenceNum)

**Tests to Add:**
- Self-messages ignored
- Simultaneous updates from different tabs work
- Circular loops detected and broken
- Sequence number anomalies flagged

**Estimated Time:** 9 hours (1.5 days)

---

## Phase 2: Reliability (Week 2) 🛡️

### 📋 Gap 1: Storage-Based Fallback [TODO]

**Priority:** HIGH - Ensures sync works without BroadcastChannel

**Implementation Steps:**

1. **Add fallback flag** (1 hour)
   - Track `useBroadcastChannel` vs `useStorageFallback` boolean
   - Initialize based on BroadcastChannel availability
   - Switch to fallback on BC failures

2. **Implement storage.onChanged listener** (4 hours)
   - Listen for container-specific storage key changes
   - Parse storage events into broadcast message format
   - Emit equivalent `broadcast:received` events
   - Use same message validation

3. **Storage-based broadcast sending** (3 hours)
   - When fallback active, write to storage instead of BC
   - Key pattern: `quick-tabs-sync-${containerID}-${timestamp}`
   - Include message type, data, sender ID
   - Atomic write operation

4. **Periodic storage cleanup** (2 hours)
   - Remove sync messages older than 5 seconds
   - Run on every storage write + periodic timer
   - Prevent storage bloat
   - Handle storage quota errors

5. **Fallback activation tests** (2 hours)
   - Force BC unavailable in tests
   - Verify storage fallback activates
   - Confirm messages still propagate
   - Test fallback → BC recovery

**Files to Modify:**
- `src/features/quick-tabs/managers/BroadcastManager.js` (primary)
- `src/features/quick-tabs/managers/StorageManager.js` (helper methods)

**Tests to Add:**
- Fallback activates when BC unavailable
- Storage-based messages propagate correctly
- Cleanup prevents storage bloat
- BC restoration switches back from fallback

**Estimated Time:** 12 hours (2 days)

---

### 📋 Gap 2: Error Recovery & Reconnection [TODO]

**Priority:** HIGH - Self-healing behavior

**Implementation Steps:**

1. **Channel health tracking** (2 hours)
   - Track last successful send timestamp
   - Track consecutive failure count
   - Monitor channel healthy/unhealthy state
   - Expose health status via getter

2. **Automatic reconnection** (4 hours)
   - After 3 consecutive failures, attempt reconnection
   - Exponential backoff: 100ms, 500ms, 2s, 5s
   - Log reconnection attempts
   - Switch to storage fallback after 5 failed attempts
   - Emit `broadcast:reconnecting` event

3. **Error event emission** (1 hour)
   - Emit `broadcast:error` on send failures
   - Include error details, message type, retry status
   - Application layer can respond

4. **Enhanced broadcast() error handling** (2 hours)
   - Wrap `postMessage()` in try-catch
   - Increment failure counter on error
   - Trigger reconnection check
   - Use storage fallback if available
   - Return boolean success/failure

5. **Manual channel test** (1 hour)
   - Method to explicitly test channel health
   - Send empty ping message
   - Update health status based on result
   - Useful for diagnostics

**Files to Modify:**
- `src/features/quick-tabs/managers/BroadcastManager.js`

**Tests to Add:**
- Reconnection triggered after failures
- Exponential backoff verified
- Fallback activated after max retries
- Health status accurately reflects channel state

**Estimated Time:** 10 hours (2 days)

---

## Phase 3: Observability & Refinement (Week 3) 📊

### 📋 Gap 7: Structured Logging [TODO]

**Priority:** MEDIUM - Better debugging and monitoring

**Implementation Steps:**

1. **Create Logger utility** (3 hours)
   - New file: `src/utils/Logger.js`
   - Support ERROR, WARN, INFO, DEBUG levels
   - Include timestamp, component name, context data
   - Configurable log level (env variable)

2. **Log level filtering** (1 hour)
   - Runtime configuration of log level
   - Default: WARN in production, DEBUG in dev
   - Respect user preferences if stored

3. **Performance timing logs** (2 hours)
   - Log broadcast send/receive times
   - Track handler execution duration
   - Flag operations >100ms as slow
   - Include in structured log context

4. **State snapshot logging** (1 hour)
   - Periodic summary of current state
   - Active channels, fallback status, error counts
   - Useful for debugging intermittent issues

5. **Migrate BroadcastManager** (2 hours)
   - Replace console.log with Logger
   - Add structured context to all logs
   - Ensure no log spam in production

**Files to Create:**
- `src/utils/Logger.js`

**Files to Modify:**
- `src/features/quick-tabs/managers/BroadcastManager.js`

**Tests to Add:**
- Log level filtering works
- Structured context included
- Performance metrics captured
- No log spam at WARN level

**Estimated Time:** 9 hours (1.5 days)

---

### 📋 Gap 4: Delivery Confirmation [OPTIONAL]

**Priority:** LOW - Nice-to-have enhancement

**Implementation Steps:**

1. **Optional message acknowledgment** (4 hours)
   - Critical messages (CREATE, CLOSE) include unique message ID
   - Receiving tabs send ACK response
   - Sending tab tracks ACKs received
   - After 200ms, log tabs that didn't respond

2. **Selective retry** (3 hours)
   - Retry critical messages once if ACK missing
   - Use storage as backup channel for retry
   - Log which tabs failed to acknowledge

3. **Message priority levels** (2 hours)
   - CRITICAL: CREATE, CLOSE (require ACK)
   - HIGH: UPDATE_POSITION, UPDATE_SIZE (retry once)
   - NORMAL: MINIMIZE, RESTORE (fire-and-forget)

4. **Track in-flight messages** (2 hours)
   - Map of message IDs awaiting ACK
   - Clean up after 5 seconds
   - Prevent memory leak

5. **Delivery metrics** (2 hours)
   - Count successful/failed deliveries
   - Track average delivery latency
   - Expose via debug interface

**Files to Modify:**
- `src/features/quick-tabs/managers/BroadcastManager.js`
- `src/features/quick-tabs/coordinators/SyncCoordinator.js`

**Tests to Add:**
- ACK sent and received for critical messages
- Retry logic triggers appropriately
- Metrics accurately tracked

**Estimated Time:** 13 hours (2 days)

---

## Critical Issues Requiring Immediate Attention ⚠️

### Issue 1: Existing Test Failures (57 tests)

**Problem:**
Message validation now rejects incomplete messages. Many existing tests use simplified CREATE messages without required fields (left, top, width, height).

**Solution:**
Update all test messages to include required fields. Examples:

**Before:**
```javascript
{
  type: 'CREATE',
  data: { id: 'qt-123', url: 'https://example.com' }
}
```

**After:**
```javascript
{
  type: 'CREATE',
  data: {
    id: 'qt-123',
    url: 'https://example.com',
    left: 100,
    top: 200,
    width: 300,
    height: 400
  }
}
```

**Files Affected:**
- `tests/unit/managers/BroadcastManager.test.js`
- `tests/unit/managers/BroadcastManager.crossTab.test.js`
- `tests/integration/scenarios/scenario-16-rapid-position-updates.test.js`
- Multiple other integration tests

**Estimated Time:** 4-6 hours

**Recommendation:** Fix before proceeding to Phase 2.

---

## Implementation Priority Matrix

**Week 1 (Phase 1):**
```
Day 1-2: ✅ Gap 3 (Message Validation) - DONE
Day 3:   📋 Gap 6 (Container Validation)
Day 4-5: 📋 Gap 5 (Debounce/Loop Prevention)
Day 6:   ⚠️ Fix existing tests
```

**Week 2 (Phase 2):**
```
Day 7-8:   📋 Gap 1 (Storage Fallback)
Day 9-10:  📋 Gap 2 (Error Recovery)
```

**Week 3 (Phase 3):**
```
Day 11-12: 📋 Gap 7 (Structured Logging)
Day 13-15: 📋 Gap 4 (Delivery Confirmation) [Optional]
```

---

## Testing Strategy

**For Each Gap:**
1. Write unit tests FIRST (TDD approach)
2. Implement production code
3. Run unit tests (ensure pass)
4. Run integration tests (ensure no regression)
5. Run manual browser tests

**Manual Test Checklist:**
- [ ] Create Quick Tab in tab A → appears in tab B
- [ ] Update position in tab B → updates in tab A
- [ ] Close tab A → Quick Tab persists in tab B
- [ ] Disable BC (dev tools) → storage fallback works
- [ ] Create QT in container 1 → NOT visible in container 2
- [ ] Rapid updates (drag) → no loops or crashes
- [ ] Browser restart → Quick Tabs persist

---

## Success Metrics

**Phase 1 Complete When:**
- ✅ Zero crashes from malformed messages
- ✅ Container boundaries enforced and validated
- ✅ No message loops in rapid update scenarios
- ✅ All tests passing (including fixed existing tests)

**Phase 2 Complete When:**
- ✅ Storage fallback works without BC
- ✅ Channel auto-reconnects after failures
- ✅ Cross-tab sync maintained during errors
- ✅ All integration tests pass with injected failures

**Phase 3 Complete When:**
- ✅ Structured logs provide clear debugging info
- ✅ Delivery metrics tracked and accessible
- ✅ Production issues diagnosable from logs

---

## Next Steps for Future Copilot Runs

**Immediate Next Actions:**

1. **Fix Existing Tests** (Priority: CRITICAL)
   - Update test messages with required fields
   - Verify all 57 failing tests pass
   - Estimated: 4-6 hours

2. **Implement Gap 6** (Priority: HIGH)
   - Container boundary validation
   - Estimated: 1 day

3. **Implement Gap 5** (Priority: HIGH)
   - Enhanced debounce and loop prevention
   - Estimated: 1.5 days

4. **Implement Gap 1** (Priority: HIGH)
   - Storage-based fallback mechanism
   - Estimated: 2 days

5. **Continue with remaining gaps** in priority order

**Remember:**
- Run tests after EACH change
- Commit frequently with descriptive messages
- Update this plan as work progresses
- Store learnings in memories for future sessions

---

**Document Size:** ~14.5KB (within 15KB limit)  
**Last Updated:** 2025-11-24  
**Status:** Living document - update as implementation progresses
