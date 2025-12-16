# Testing & Validation Guide

**Document Purpose:** Define test cases, validation scenarios, and success
criteria  
**Target Audience:** GitHub Copilot Agent + Developers  
**Status:** Critical - Use to verify implementation correctness  
**Last Updated:** December 15, 2025

---

## EXECUTIVE SUMMARY

This document provides:

- Test scenarios for each component
- Success criteria for each test
- Edge cases and failure modes
- Performance benchmarks
- Regression test checklist

---

## PRE-IMPLEMENTATION TEST

### Test 0.1: Code Linting

**Purpose:** Verify no syntax errors before running

**Steps:**

1. Run linter on all modified files
2. Check for undefined variables
3. Check for unused variables
4. Verify import/export consistency

**Success Criteria:**

- [ ] 0 linting errors
- [ ] 0 undefined references
- [ ] 0 syntax errors
- [ ] All imports resolved

---

## INITIALIZATION TESTS

### Test 1.1: DOMContentLoaded Fire

**Purpose:** Verify initialization starts when DOM ready

**Steps:**

1. Load sidebar in browser
2. Monitor console logs
3. Check if `DOM_CONTENT_LOADED` log appears
4. Verify barrier promise created

**Expected Logs:**

```
[Manager] DOM_CONTENT_LOADED
[Manager] STATE_REQUEST_SENT requestId=...
```

**Success Criteria:**

- [ ] Log appears within 100ms
- [ ] State request sent
- [ ] No errors in console

---

### Test 1.2: Initial State Load

**Purpose:** Verify initial state is fetched and processed

**Steps:**

1. Create 3 Quick Tabs before opening sidebar
2. Open sidebar
3. Monitor initialization phase
4. Verify state loads in <1000ms

**Expected Behavior:**

- Background returns 3 tabs
- State structure validated
- State rendered to DOM

**Expected Logs:**

```
[Manager] STATE_REQUEST_SENT requestId=...
[Manager] STATE_REQUEST_RECEIVED latency=... tabCount=3
[Manager] INITIALIZATION_BARRIER_RESOLVED
```

**Success Criteria:**

- [ ] All 3 tabs visible in sidebar
- [ ] Initialization completes <1000ms
- [ ] No errors logged
- [ ] No console warnings

---

### Test 1.3: Empty State Initialization

**Purpose:** Verify initialization with 0 Quick Tabs

**Steps:**

1. Delete all Quick Tabs
2. Open sidebar fresh
3. Monitor initialization
4. Verify empty state handles correctly

**Expected Behavior:**

- Empty tabs array accepted
- State structure validated
- Sidebar renders empty container

**Expected Logs:**

```
[Manager] STATE_REQUEST_RECEIVED latency=... tabCount=0
[Manager] RENDER_COMPLETE duration=... tabCount=0
```

**Success Criteria:**

- [ ] Sidebar shows empty state message
- [ ] No errors or warnings
- [ ] Ready to create Quick Tab

---

### Test 1.4: Initialization Timeout

**Purpose:** Verify timeout handling if state never arrives

**Steps:**

1. Mock background to not respond
2. Open sidebar
3. Wait >10 seconds
4. Monitor error handling

**Expected Behavior:**

- Timeout error after 10s
- Error logged
- Sidebar shows error state or retries

**Expected Logs:**

```
[Manager] INITIALIZATION_FAILED error=Initialization timeout
```

**Success Criteria:**

- [ ] Error logged after ~10s
- [ ] No infinite loops
- [ ] User can see error or retry

---

## STORAGE SYNCHRONIZATION TESTS

### Test 2.1: Single Tab Create Sync

**Purpose:** Verify storage event triggers sidebar update

**Steps:**

1. Open sidebar with 0 tabs
2. Create 1 Quick Tab from content script
3. Wait for storage event
4. Verify sidebar reflects new tab

**Expected Behavior:**

- Background creates tab
- Background persists to storage
- Storage event fires
- Sidebar receives event and renders

**Expected Logs:**

```
[Background] CREATE_QUICK_TAB id=qt-... url=...
[Background] PERSIST_COMPLETE ...
[Manager] STORAGE_EVENT_RECEIVED hasState=true
[Manager] STATE_SYNC tabCount=1
[Manager] RENDER_COMPLETE duration=... tabCount=1
```

**Latency Budget:**

- Storage.local.set: <50ms
- Storage event propagation: <100ms
- Sidebar render: <100ms
- Total: <250ms

**Success Criteria:**

- [ ] New tab appears in sidebar within 250ms
- [ ] Tab ID, title, URL all correct
- [ ] No duplicate tabs
- [ ] All logs show success

---

### Test 2.2: Multiple Rapid Updates

**Purpose:** Verify rapid changes are batched correctly

**Steps:**

1. Create 5 Quick Tabs in rapid succession
2. Monitor sidebar updates
3. Check render queue behavior
4. Verify final state is correct

**Expected Behavior:**

- Multiple storage events received
- Render queue debounces (100ms)
- Only final state rendered
- No intermediate states visible

**Expected Logs:**

```
[Manager] RENDER_SCHEDULED ... queueSize=1
[Manager] RENDER_SCHEDULED ... queueSize=2
[Manager] RENDER_SCHEDULED ... queueSize=3
[Manager] RENDER_DEQUEUE ...
[Manager] RENDER_COMPLETE ... tabCount=5
```

**Success Criteria:**

- [ ] Final state shows all 5 tabs
- [ ] Only 1-2 renders despite 5 updates
- [ ] No intermediate states visible
- [ ] No render queue overflow warnings

---

### Test 2.3: Stale Revision Rejection

**Purpose:** Verify old revisions are rejected

**Steps:**

1. Create tab (revision=1)
2. Modify storage to send revision=0
3. Observe sidebar response
4. Verify revision=0 is ignored

**Expected Behavior:**

- Revision check prevents old state
- Log indicates stale revision
- Current state unchanged

**Expected Logs:**

```
[Manager] STALE_REVISION received=0 lastProcessed=1
```

**Success Criteria:**

- [ ] Old revision ignored
- [ ] No state rollback
- [ ] Current state unchanged

---

### Test 2.4: Checksum Validation

**Purpose:** Verify corrupted state is rejected

**Steps:**

1. Create tab with correct state
2. Manually modify stored JSON to corrupt data
3. Trigger storage event
4. Observe checksum failure handling

**Expected Behavior:**

- Checksum mismatch detected
- Error logged
- State repair requested
- Sidebar not corrupted

**Expected Logs:**

```
[Manager] CHECKSUM_MISMATCH expected=v1:5:abc123 received=v1:5:def456 tabCount=5
```

**Success Criteria:**

- [ ] Corruption detected
- [ ] Sidebar state unchanged
- [ ] Repair requested
- [ ] No render of corrupted data

---

### Test 2.5: Storage Event Out of Order

**Purpose:** Verify events processed in correct order despite delivery delays

**Steps:**

1. Create tabs rapidly (A, B, C)
2. Simulate storage events arriving out of order
3. Verify final state correct regardless

**Expected Behavior:**

- Revision numbers ensure order
- Stale events rejected
- Latest state wins

**Success Criteria:**

- [ ] Final state always matches latest revision
- [ ] No out-of-order state visible
- [ ] Old revisions rejected

---

## MESSAGE HANDLING TESTS

### Test 3.1: Create Quick Tab Message

**Purpose:** Verify CREATE_QUICK_TAB operation succeeds

**Steps:**

1. Send CREATE_QUICK_TAB from content script
2. Specify URL, title, position
3. Monitor background handling
4. Verify storage persisted
5. Verify sidebar updated

**Expected Behavior:**

- Message received in background
- Tab created with unique ID
- State persisted to storage
- Storage event fires
- Sidebar renders new tab

**Expected Logs:**

```
[Background] CREATE_QUICK_TAB id=qt-... url=https://example.com
[Background] PERSIST_COMPLETE ...
[Manager] STATE_SYNC ... tabCount=1
[Manager] RENDER_COMPLETE ... tabCount=1
```

**Success Criteria:**

- [ ] Tab created with unique ID
- [ ] Title and URL correct
- [ ] Position saved
- [ ] Sidebar updated within 250ms

---

### Test 3.2: Update Quick Tab Message

**Purpose:** Verify UPDATE_QUICK_TAB operation succeeds

**Steps:**

1. Create a Quick Tab
2. Send UPDATE_QUICK_TAB with new position/size
3. Monitor update handling
4. Verify changes persisted
5. Verify sidebar updated

**Expected Behavior:**

- Update received in background
- State modified
- Checksum recomputed
- Storage persisted
- Sidebar reflects changes

**Expected Logs:**

```
[Background] UPDATE_QUICK_TAB id=qt-... updates=position,size
[Background] PERSIST_COMPLETE ...
[Manager] STATE_SYNC ... tabCount=1
```

**Success Criteria:**

- [ ] Position/size updated correctly
- [ ] Checksum changed (recomputed)
- [ ] Sidebar shows updated position
- [ ] Other tabs unchanged

---

### Test 3.3: Delete Quick Tab Message

**Purpose:** Verify DELETE_QUICK_TAB operation succeeds

**Steps:**

1. Create 3 Quick Tabs
2. Delete middle tab
3. Verify only that tab removed
4. Verify sidebar updated
5. Verify other tabs intact

**Expected Behavior:**

- Delete received
- Tab removed from array
- Index maintained for other tabs
- Storage persisted
- Sidebar updated

**Expected Logs:**

```
[Background] DELETE_QUICK_TAB id=qt-...
[Background] PERSIST_COMPLETE ...
[Manager] STATE_SYNC ... tabCount=2
[Manager] RENDER_COMPLETE ... tabCount=2
```

**Success Criteria:**

- [ ] Correct tab deleted
- [ ] Other 2 tabs intact
- [ ] No index errors
- [ ] Sidebar shows 2 tabs

---

### Test 3.4: Message Timeout Handling

**Purpose:** Verify timeout recovery works

**Steps:**

1. Create quick tab that takes >3 seconds to respond
2. Wait for message timeout
3. Observe error handling
4. Verify sidebar continues working

**Expected Behavior:**

- 3 second timeout
- Error logged
- Sidebar not blocked
- Can perform other operations

**Expected Logs:**

```
[Manager] MESSAGE_ERROR action=... error=Timeout latency=3000ms
```

**Success Criteria:**

- [ ] Error logged at ~3s
- [ ] Sidebar responsive
- [ ] User can retry
- [ ] No console hanging

---

## RENDER QUEUE TESTS

### Test 4.1: Render Debounce

**Purpose:** Verify 100ms debounce batches updates

**Steps:**

1. Trigger 5 storage events in 50ms
2. Monitor render queue
3. Count actual DOM renders
4. Verify debounce works

**Expected Behavior:**

- Events queued
- Single render after 100ms debounce
- Not 5 renders

**Expected Logs:**

```
[Manager] RENDER_SCHEDULED ... queueSize=1
[Manager] RENDER_SCHEDULED ... queueSize=2
[Manager] RENDER_SCHEDULED ... queueSize=3
[Manager] RENDER_SCHEDULED ... queueSize=4
[Manager] RENDER_SCHEDULED ... queueSize=5
[Manager] RENDER_DEQUEUE ...
[Manager] RENDER_COMPLETE ... (only 1, not 5)
```

**Success Criteria:**

- [ ] Only 1 render despite 5 events
- [ ] Final state correct
- [ ] Performance improved

---

### Test 4.2: Render Deduplication

**Purpose:** Verify rendering same revision twice is skipped

**Steps:**

1. Render revision 1
2. Attempt to render revision 1 again
3. Verify second render skipped
4. Check logs

**Expected Behavior:**

- First render succeeds
- Second render dedupped

**Expected Logs:**

```
[Manager] RENDER_SCHEDULED ... revision=1 ...
[Manager] RENDER_COMPLETE ... revision=1 ...
[Manager] RENDER_DEDUP revision=1
```

**Success Criteria:**

- [ ] Duplicate render skipped
- [ ] No unnecessary DOM operations
- [ ] Performance optimized

---

### Test 4.3: Render Error Recovery

**Purpose:** Verify render error doesn't crash queue

**Steps:**

1. Inject error into render function
2. Trigger render
3. Verify error caught
4. Verify queue clears
5. Verify sidebar still responsive

**Expected Behavior:**

- Error thrown
- Error caught in try/catch
- Error logged
- Queue cleared
- Can render again

**Expected Logs:**

```
[Manager] RENDER_START ...
[Manager] RENDER_ERROR error=...
```

**Success Criteria:**

- [ ] Error logged
- [ ] No sidebar crash
- [ ] Queue recovered
- [ ] Next render works

---

### Test 4.4: Large State Render Performance

**Purpose:** Verify render with 100 tabs performs well

**Steps:**

1. Create 100 Quick Tabs
2. Trigger render
3. Measure render time
4. Verify <200ms

**Expected Behavior:**

- Render completes
- Time tracked
- DOM reconciliation efficient

**Expected Logs:**

```
[Manager] RENDER_COMPLETE duration=XXms tabCount=100
```

**Success Criteria:**

- [ ] Render time <200ms
- [ ] UI stays responsive
- [ ] No perceptible lag

---

## EDGE CASE TESTS

### Test 5.1: Empty String Values

**Purpose:** Verify empty strings handled safely

**Steps:**

1. Create tab with empty title
2. Create tab with empty URL (invalid, should fail)
3. Update tab to have empty description
4. Verify validation

**Expected Behavior:**

- Empty title allowed (show placeholder)
- Empty URL rejected (validation error)
- Empty description allowed

**Success Criteria:**

- [ ] Empty title shows "(No Title)"
- [ ] Empty URL rejected with error
- [ ] Empty description saved

---

### Test 5.2: Very Long Strings

**Purpose:** Verify truncation for oversized inputs

**Steps:**

1. Create tab with 500-char title
2. Create tab with 3000-char URL
3. Verify storage limits enforced
4. Check truncation

**Expected Behavior:**

- Title truncated to 255 chars
- URL truncated to 2048 chars
- State still valid

**Success Criteria:**

- [ ] Title max 255 chars
- [ ] URL max 2048 chars
- [ ] Storage doesn't exceed limits

---

### Test 5.3: Special Characters

**Purpose:** Verify special characters handled safely

**Steps:**

1. Create tab with title: `<script>alert("xss")</script>`
2. Create tab with URL containing `%`, `&`, `?`
3. Verify no XSS or encoding issues
4. Verify sidebar renders safely

**Expected Behavior:**

- Special chars escaped in DOM
- No code execution
- URL params preserved
- Rendered safely

**Success Criteria:**

- [ ] No XSS vulnerabilities
- [ ] Special chars preserved
- [ ] URL functionality intact
- [ ] DOM safe

---

### Test 5.4: State Recovery from Backup

**Purpose:** Verify sync storage backup can restore state

**Steps:**

1. Create 5 tabs (stored in sync and local)
2. Corrupt local storage
3. Detect corruption
4. Attempt recovery from sync backup
5. Verify state restored

**Expected Behavior:**

- Corruption detected
- Sync backup checked
- State recovered
- Sidebar updated

**Success Criteria:**

- [ ] Corruption detected
- [ ] Backup has valid state
- [ ] State recovered
- [ ] All 5 tabs restored

---

### Test 5.5: Concurrent Operations

**Purpose:** Verify multiple simultaneous operations handled

**Steps:**

1. Create tab (operation A)
2. While A persisting, create another (operation B)
3. While B persisting, delete first (operation C)
4. Monitor final state
5. Verify consistency

**Expected Behavior:**

- Operations queued or serialized
- Final state consistent
- No lost updates
- No data corruption

**Success Criteria:**

- [ ] Final state valid
- [ ] All operations complete
- [ ] No partial updates
- [ ] Checksum valid

---

## PERFORMANCE BENCHMARKS

### Operation Latencies

| Operation           | Target    | Acceptable | Critical |
| ------------------- | --------- | ---------- | -------- |
| Initialization      | <100ms    | <500ms     | <1000ms  |
| Create Quick Tab    | 100-200ms | <300ms     | <500ms   |
| Update Quick Tab    | 50-150ms  | <300ms     | <500ms   |
| Delete Quick Tab    | 50-150ms  | <300ms     | <500ms   |
| State Sync (render) | 10-100ms  | <150ms     | <300ms   |
| Message round-trip  | 50-150ms  | <300ms     | <500ms   |

### Memory Benchmarks

| Metric             | Target    | Limit     |
| ------------------ | --------- | --------- |
| Storage (50 tabs)  | <50KB     | <100KB    |
| Storage (100 tabs) | <100KB    | <150KB    |
| Render queue size  | 1-3 items | <10 items |
| Message queue size | 0 items   | <5 items  |

---

## REGRESSION TEST CHECKLIST

Run this checklist after any code changes:

- [ ] Linter: 0 errors
- [ ] Test 1.1: DOMContentLoaded fires
- [ ] Test 1.2: Initial state loads
- [ ] Test 1.3: Empty state handled
- [ ] Test 2.1: Single tab create syncs
- [ ] Test 2.2: Multiple rapid updates batch correctly
- [ ] Test 2.3: Stale revisions rejected
- [ ] Test 2.4: Checksum validates
- [ ] Test 3.1: Create message works
- [ ] Test 3.2: Update message works
- [ ] Test 3.3: Delete message works
- [ ] Test 4.1: Render debounce works
- [ ] Test 4.2: Render dedup works
- [ ] Test 4.3: Render error recovery works
- [ ] Test 4.4: Large state performance good
- [ ] Test 5.1: Empty strings handled
- [ ] Test 5.2: Long strings truncated
- [ ] Test 5.3: Special chars safe
- [ ] Test 5.4: Backup recovery works
- [ ] Test 5.5: Concurrent ops consistent
- [ ] All logs appear with correct format
- [ ] No console errors or warnings
- [ ] Performance within benchmarks

---

## QUICK TEST SCRIPT

```javascript
// Run in browser console to quick-test basic functionality

console.log('=== Quick Test Suite ===');

// Test 1: State exists
const testState = await browser.storage.local.get('quick_tabs_state_v2');
console.log('Test 1 - State exists:', !!testState['quick_tabs_state_v2']);

// Test 2: Sidebar manager accessible
const managerTest = document.querySelector('.quick-tabs-container') !== null;
console.log('Test 2 - Sidebar DOM ready:', managerTest);

// Test 3: Create message works
const testMsg = await browser.runtime.sendMessage({
  action: 'GET_QUICK_TABS_STATE'
});
console.log('Test 3 - Message works:', !!testMsg.tabs);

console.log('=== Quick Test Complete ===');
```

---

## VERSION HISTORY

- **v1.0** (Dec 15, 2025) - Initial testing and validation guide
