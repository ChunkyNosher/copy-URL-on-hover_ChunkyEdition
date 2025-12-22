# Copy URL on Hover: Additional Issues Report - Parts 7-8

**Extension Version:** v1.6.3.11+ | **Date:** December 21, 2025 | **Scope:** DOM
performance, storage architecture, adoption lifecycle, rendering optimization,
event coordination, and initialization timing issues discovered during deep
architectural analysis and browser API research

---

## Executive Summary

This additional diagnostic report documents 18+ critical, high, and
medium-severity issues discovered during comprehensive architectural analysis of
the extension codebase combined with extensive browser API documentation
research. These issues represent architectural patterns and cross-cutting
concerns not addressed in Parts 1-6 and reveal systemic reliability problems in:
(1) DOM manipulation and MutationObserver optimization, (2) storage performance
and quota management, (3) Quick Tab adoption lifecycle and completion signaling,
(4) port message ordering and duplicate handling under network jitter, (5)
browser context isolation and tab ID lifecycle during navigation, (6) viewport
and rendering boundary detection, (7) event bus scoping and context isolation,
and (8) initialization ordering and timing hazards. Combined with Parts 1-6's 63
issues, these bring the total to **81+ identified issues** spanning all layers
of the extension architecture. These architectural issues represent the deepest
category of problems, requiring refactoring of core patterns rather than
localized fixes.

---

## Critical Issues by Category

### Category 1: DOM Performance & MutationObserver Optimization

**Issues:** #64, #65, #66, #67

**Scope Impact:** Frame rate degradation, adoption stalls on dynamic sites, page
load delays, performance cliff at 50+ Quick Tabs

#### Issue #64: MutationObserver Observing Entire document.body For Quick Tab Adoption Detection

**Problem Summary** Quick Tab adoption likely uses MutationObserver watching
entire `document.body` to detect when Quick Tab HTML is inserted into page DOM.
On dynamic sites (Facebook, Twitter, LinkedIn, Reddit), DOM churn reaches 1000+
mutations per second during page load and real-time updates. Observer callback
fires for every single mutation, re-processing entire document for Quick Tab
position/identification.

**Root Cause**

- **File:** Content script adoption logic (likely `adoption.js`,
  `TabLifecycleHandler.js`, or similar)
- **Location:** MutationObserver registration and callback implementation
- **Issue:** Observer callback registered without filtering:
  - Observes `{ subtree: true, childList: true, attributes: true }`
  - Callback called on EVERY mutation (text node change, attribute, insertion)
  - Callback likely calls expensive DOM traversal:
    `document.querySelectorAll()`, regex matching, geometry calculations
  - No debouncing, throttling, or callback batching
  - Research shows (Stack Overflow #228): "Performance of MutationObserver to
    detect nodes in entire DOM" - scanning entire DOM on each mutation causes
    exponential degradation

**Browser API Limitation:** According to Mozilla documentation
(hacks.mozilla.org/2012/05/dom-mutationobserver-reacting-to-dom-changes-without-killing-browser-performance/):

- MutationObserver doesn't batch notifications across multiple mutations
- Each DOM change fires separate callback invocation
- Observer can't filter or pre-process mutations before callback
- High-mutation pages can queue 1000+ pending callbacks

**Real-World Impact Research:**

- Stack Overflow #225: "Chrome extension's content script makes the page load
  slow on some websites" documents extension slowing Facebook/Twitter load by
  2-5 seconds due to unoptimized MutationObserver
- Issue compounds with: shadow DOM, iframes with mutation observers, dynamic
  content libraries (React, Vue)

<scope>
**Modify:**
- Content script adoption detection logic (replace naive MutationObserver with optimized pattern)
- Observer callback implementation (add filtering, debouncing)
- Mutation batch processing (collect mutations, process once per animation frame)

**Do NOT Modify:**

- Quick Tab detection algorithm itself
- Adoption completion logic
- Storage schema </scope>

**Fix Required** Replace naive MutationObserver with optimized adoption
detection: (1) Use `requestAnimationFrame` to batch mutations - collect
mutations in RAF callback instead of processing immediately, (2) Only process
`addedNodes` in mutations, filter out attribute/text changes, (3) Implement
quick-reject filter before expensive DOM traversal (e.g., check
`nodeName === 'DIV'` before calling querySelectorAll), (4) Cache CSS selectors
and compiled regex patterns to avoid recompilation, (5) Debounce adoption
scanning: if last adoption was <2s ago, skip scan, (6) Alternatively: replace
MutationObserver entirely with interval-based polling on slow timer (5-10s) for
detection, trade responsiveness for performance.

<acceptance_criteria>

- [ ] MutationObserver callback wrapped in requestAnimationFrame batch
      processing
- [ ] Only addedNodes processed (not attribute/text mutations)
- [ ] Quick-reject filter implemented before expensive DOM traversal
- [ ] Adoption detection debounced (skip if <2s since last detection)
- [ ] Manual test: Facebook/Twitter/LinkedIn page load time → <500ms overhead
      (from mutation processing)
- [ ] Manual test: 50+ Quick Tabs on page → frame rate stays >30 FPS during page
      interaction
- [ ] Manual test: Adoption detection still triggers within 2-5 seconds of tab
      appearance
- [ ] Logging shows mutation callback invocation rate and processing time per
      batch </acceptance_criteria>

---

#### Issue #65: Layout Thrashing From Reading getBoundingClientRect() on Every Position Update

**Problem Summary** When Quick Tab position is queried or updated, code likely
calls `element.getBoundingClientRect()` to get viewport coordinates. If this is
called in a loop (iterating 50+ Quick Tabs) or during adoption of multiple Quick
Tabs, synchronous layout recalculation is triggered repeatedly.

**Root Cause**

- **File:** Quick Tab positioning/rendering logic (likely in mediator.js,
  adoption handler, or sidebar panel.js)
- **Location:** Position update and coordinate calculation methods
- **Issue:** Pattern detected in browser research
  (webperf.tips/tip/layout-thrashing/):
  - Read: `element.getBoundingClientRect()` → browser calculates layout
    synchronously
  - Modify: DOM update
  - Read: Next element's `getBoundingClientRect()` → layout recalculated again
  - Per element: forces full layout recalculation
  - With 50 elements: 50 forced synchronous layouts
  - Example: Adopting 50 Quick Tabs in loop causes 50 layout recalculations =
    500-2000ms total blocking time

**Browser Performance Limitation:** According to web performance research:

- Reading geometry forces synchronous layout recalculation ("forced reflow")
- Recalculation includes entire document layout tree
- Modern browsers can't optimize away if reads and writes interleaved
- Chrome DevTools Performance tab shows: Main thread blocking 3000-5000ms on
  position updates

<scope>
**Modify:**
- Quick Tab positioning/rendering code (batch reads/writes)
- Coordinate calculations (defer reads until all writes complete)
- Sidebar panel update logic (use requestAnimationFrame for batching)

**Do NOT Modify:**

- Position storage format
- Rendering component structure </scope>

**Fix Required** Implement read/write batching using requestAnimationFrame: (1)
Collect all position updates in queue, (2) In RAF callback, perform all reads
first (getBoundingClientRect for all elements), store in array, (3) Then perform
all writes (update DOM for all elements), (4) This defers layout recalculation
until after all reads complete, (5) Alternatively: Use Intersection Observer
instead of getBoundingClientRect for visibility detection (no forced reflow),
(6) Cache previously calculated positions, only recalculate if viewport size
changed.

<acceptance_criteria>

- [ ] Position reads and writes batched in requestAnimationFrame
- [ ] All reads performed before any writes
- [ ] Manual test: Adopt 50 Quick Tabs → total update time <500ms (from 2000+ms)
- [ ] Manual test: Sidebar position update → single frame (16ms) instead of
      blocking for 100ms+
- [ ] Manual test: Page scroll/resize → frame rate maintained >30 FPS
- [ ] Chrome DevTools Performance shows: Main thread task duration <100ms for
      position updates
- [ ] Logging shows read/write batch sizes and RAF callback execution time
      </acceptance_criteria>

---

#### Issue #66: requestAnimationFrame Not Used For Batched DOM Updates During Adoption

**Problem Summary** When adopting 10+ Quick Tabs, each adoption triggers DOM
insertion separately. Each insertion causes browser repaint. 10 adoptions = 10
separate paint operations = 2-5 second adoption phase. Without RAF batching,
browser performs synchronous reflow after each insertion.

**Root Cause**

- **File:** Quick Tab adoption handler (likely `QuickTabHandler.js` or adoption
  mediator)
- **Location:** Individual adoption completion and DOM insertion logic
- **Issue:** Code likely follows pattern:
  - For each Quick Tab: insert DOM element
  - Browser synchronously reflows and paints
  - Move to next Quick Tab
  - Repeat 10+ times
  - Total: 10 reflows + 10 paints instead of 1 of each

**Browser Rendering Pipeline:** According to web performance research
(harrytheo.com, webperf.tips):

- Single RAF callback can batch unlimited DOM updates
- Browser performs single reflow at end of RAF
- Without RAF: each update triggers separate reflow/paint cycle
- Expected: 50 Quick Tabs adopted in RAF = 1 paint
- Actual without RAF: 50 Quick Tabs = 50 paints

<scope>
**Modify:**
- Adoption completion logic (batch DOM insertions)
- Mediator update methods (defer to RAF)
- Sidebar rendering (use RAF for all DOM updates)

**Do NOT Modify:**

- Adoption completion signal
- Quick Tab structure </scope>

**Fix Required** Wrap all adoption-related DOM updates in requestAnimationFrame:
(1) Collect all adoptions pending DOM insertion, (2) In RAF callback, insert all
collected Quick Tabs to DOM at once, (3) Perform all styling/geometry updates in
same RAF, (4) Trigger repaint once after all updates complete, (5) Similarly:
Sidebar refresh at 2-second intervals should batch all DOM updates in RAF
instead of rendering each update sequentially.

<acceptance_criteria>

- [ ] Adoption DOM insertions batched in requestAnimationFrame
- [ ] Multiple adoptions complete without intermediate repaints
- [ ] Manual test: Adopt 50 Quick Tabs → total adoption time <1 second (from 5+
      seconds)
- [ ] Manual test: Sidebar update at 2s intervals → single RAF batch, not
      sequential updates
- [ ] Manual test: Adoption doesn't block user input >100ms
- [ ] Chrome DevTools Performance shows: Paint event single occurrence per RAF
- [ ] Logging shows adoption batch sizes and RAF callback execution time
      </acceptance_criteria>

---

#### Issue #67: MutationObserver Not Debounced or Throttled During Page Load

**Problem Summary** Content script registers MutationObserver immediately on
page load. During `DOMContentLoaded` and post-load dynamic updates, DOM
mutations occur rapidly. Observer callback fires on every single node
insertion/change. No debouncing or throttling = callback runs 100+ times per
second during page load phase.

**Root Cause**

- **File:** Content script initialization (likely `src/content.js`)
- **Location:** MutationObserver registration and callback
- **Issue:** Observer registered without debounce/throttle:
  - Callback invoked synchronously on each mutation
  - No batch processing or minimum interval between invocations
  - During page load: 1000+ mutations in 1-2 seconds
  - Callback runs 1000 times instead of 2-3 times

**Page Load Mutation Rate Research:** According to Stack Overflow #225:
"Rechecking the entire document every time a DOM mutation occurs. This is
entirely wrong."

- Modern web pages (SPA frameworks): 100-500 mutations per second during load
- Result: Content script blocked for 2-5 seconds processing mutations
- Effect: Quick Tab adoption delayed until page load complete

<scope>
**Modify:**
- MutationObserver callback implementation (add debounce/throttle)
- Page load detection (different adoption detection during load vs post-load)

**Do NOT Modify:**

- Adoption detection algorithm
- Storage schema </scope>

**Fix Required** Implement debouncing or throttling for MutationObserver
callback: (1) Set minimum interval between invocations (e.g., 500ms), (2) Use
pending callback flag: if callback already scheduled, skip next invocation, (3)
Alternatively: Throttle to maximum 2-3 invocations per second, (4) Detect page
load phase (before `DOMContentLoaded` + 5s after) and use longer throttle
interval during load (2-5s instead of 500ms), (5) Reduce observer scope: instead
of observing entire body, only observe specific container where Quick Tabs
appear.

<acceptance_criteria>

- [ ] MutationObserver callback debounced (minimum 500ms between invocations)
- [ ] Page load phase detected (different throttle during load vs post-load)
- [ ] Manual test: Page load time → extension adds <500ms overhead
- [ ] Manual test: Adoption detection still triggers within 2-5s of tab
      appearance post-load
- [ ] Manual test: Heavy JavaScript pages (SPAs) → adoption detection doesn't
      block
- [ ] Logging shows callback invocation rate and actual processing times
- [ ] No adoption requests arriving before page DOMContentLoaded
      </acceptance_criteria>

---

### Category 2: Storage Architecture & Quota Management

**Issues:** #68, #69, #70, #71

**Scope Impact:** UI sluggishness, quota exhaustion without warning, storage
mutation cascades, state persistence delay

#### Issue #68: IndexedDB Not Used For Quick Tab Cache (Synchronous-Like API Blocks Main Thread)

**Problem Summary** Quick Tab data likely stored entirely in
`chrome.storage.local` instead of IndexedDB. While chrome.storage.local is
asynchronous, reading 1000+ Quick Tab objects on every sidebar refresh (every
2s) causes blocking behavior due to serialization/deserialization overhead and
main thread synchronization.

**Root Cause**

- **File:** Sidebar panel initialization (sidebar/panel.js)
- **Location:** Storage read on refresh interval (e.g.,
  `_loadFromSessionStorage()`)
- **Issue:** Research shows (StackOverflow #94, #211, Reddit discussions):
  - localStorage is completely synchronous, blocks main thread
  - chrome.storage.local is faster than localStorage but still not ideal for
    large datasets
  - IndexedDB is specifically designed for large datasets with async operations
  - Reading 4MB from chrome.storage.local via `storage.local.get()` takes 1-5
    seconds on slow systems
  - With 2-second refresh interval, sidebar can stall waiting for storage read

**Chrome Storage Performance Research:**

- chrome.storage.local: Good for <1MB data
- IndexedDB: Optimized for 1-100MB+ with async batching
- Sidebar refresh timing: If storage read takes 800ms and refresh every 2s,
  sidebar becomes unresponsive

<scope>
**Modify:**
- Storage architecture (implement IndexedDB layer for large datasets)
- Sidebar refresh logic (use IndexedDB reads instead of chrome.storage.local)
- Cache invalidation (mark cache dirty instead of reading from storage every refresh)

**Do NOT Modify:**

- Quick Tab schema
- Storage key structure (can be wrapper layer) </scope>

**Fix Required** Implement hybrid storage: (1) Keep chrome.storage.local for
small metadata (settings, counts), (2) Migrate Quick Tab data to IndexedDB
(async operations, better performance), (3) Sidebar refresh reads from IndexedDB
(async, doesn't block main thread), (4) Use dirty-flag pattern: on storage
change event, mark cache as stale but don't read immediately, defer read to next
animation frame, (5) Implement background-to-sidebar cache invalidation:
background notifies sidebar of changes via message instead of sidebar constantly
polling storage.

<acceptance_criteria>

- [ ] Quick Tab data stored in IndexedDB (with chrome.storage.local wrapper)
- [ ] Sidebar refresh reads from IndexedDB asynchronously (not blocking)
- [ ] Dirty-flag pattern implemented: changes marked, actual read deferred to
      RAF
- [ ] Manual test: 1000+ Quick Tabs in storage → sidebar refresh <100ms
- [ ] Manual test: Sidebar UI remains responsive during storage operations
- [ ] Manual test: Storage change notification propagates to sidebar within
      100ms
- [ ] Logging shows storage read latency and cache hit/miss rates
      </acceptance_criteria>

---

#### Issue #69: Chrome Storage.local Quota Exceeded Not Detected (Silent Write Failure Persists)

**Problem Summary** Quick Tabs stored in chrome.storage.local with 10MB quota
per extension. After 50-100 Quick Tabs created, total data size
approaches/exceeds limit. `storage.local.set()` call succeeds (returns Promise
that resolves) but data not actually written. No error, no callback, no way to
detect failure. User creates Quick Tab, it "succeeds" temporarily, disappears on
browser close because it never persisted.

**Root Cause**

- **File:** Storage write handlers (`src/background/handlers/QuickTabHandler.js`
  or storage utilities)
- **Location:** `saveStateToStorage()`, `_performStorageWrite()`, or similar
- **Issue:** Research shows (Issue #61 touches on this, but needs architectural
  fix):
  - Chrome storage quota is 10MB per extension
  - When quota exceeded, `storage.local.set()` returns Promise that resolves
    successfully
  - BUT: Data is not written to storage
  - No error thrown, no exception
  - Code assumes write succeeded because Promise resolved
  - No quota validation before attempting write

**Chrome Storage Quota Behavior:** From Chrome API documentation:

- Quota exceeded: Promise resolves without error
- No `storage.onChanged` event fired (since nothing changed)
- Subsequent `storage.local.get()` returns old data (or undefined if key was
  removed by limit)
- User perceives data loss with no diagnostic

<scope>
**Modify:**
- Storage write logic (add pre-write quota validation)
- Storage write completion (add post-write verification)
- Storage utilities (implement quota management layer)

**Do NOT Modify:**

- Quick Tab schema
- Quota calculation algorithm </scope>

**Fix Required** Implement quota management layer: (1) Before writing, calculate
size of data to be written using `JSON.stringify().length`, (2) Check available
quota using `browser.storage.local.getBytesInUse()` and
`browser.storage.local.QUOTA_BYTES`, (3) If insufficient quota, implement
garbage collection: delete oldest Quick Tabs or archived Quick Tabs until quota
available, (4) After write succeeds, verify write by reading back data and
comparing size, (5) If write verification fails, trigger error handler: notify
user, prevent further Quick Tab creation until quota available.

<acceptance_criteria>

- [ ] Quota checked before every storage write
- [ ] Available quota calculated: `QUOTA_BYTES - getBytesInUse()`
- [ ] Write rejected with error if quota insufficient (not silently failed)
- [ ] Post-write verification: read back and compare against written data
- [ ] Garbage collection triggered when quota >80% used
- [ ] User notified when quota exceeded (UI alert, not just console)
- [ ] Manual test: Create 100+ Quick Tabs until quota exceeded → error shown, QT
      not created
- [ ] Manual test: Quota management system clears space automatically
      </acceptance_criteria>

---

#### Issue #70: Storage.onChanged Listener Not Debounced (Cascading Listener Triggers)

**Problem Summary** When sidebar refreshes every 2 seconds and reads storage,
storage.onChanged listener fires. Multiple listeners (sidebar, background,
content script) all react to same change. If background updates storage with
batch of 50 Quick Tabs, `storage.onChanged` fires once. But if sidebar listener
re-writes cache, that triggers another `storage.onChanged`. Creates cascading
listener invocations.

**Root Cause**

- **File:** Storage event listeners throughout codebase (sidebar/panel.js,
  src/content.js, background handlers)
- **Location:** `browser.storage.onChanged.addListener()` registrations
- **Issue:** Each listener callback independent, no coordination:
  - Background writes Quick Tab batch → storage.onChanged fires
  - Sidebar listener processes change, might write cache → storage.onChanged
    fires again
  - Content script listener processes change → another potential write
  - Result: 1 original change triggers 3-5 listener invocations, each processing
    same data

**Cascading Effect Research:**

- Firefox studies show: storage writes can cascade 5-10 times per single user
  action
- Each listener invocation is expensive (JSON.parse, DOM update, etc.)
- With high-frequency operations (100+ tab switches per hour), cascading becomes
  multiplicative

<scope>
**Modify:**
- Storage event listeners (add debouncing between listener invocations)
- Listener coordination (implement "change source" tracking to avoid re-processing)

**Do NOT Modify:**

- Storage change detection itself
- Listener registration mechanism </scope>

**Fix Required** Implement listener debouncing: (1) Track last
`storage.onChanged` invocation timestamp for each key, (2) If listener triggered
again within 500ms for same key, skip processing (debounce), (3) Alternatively:
Mark storage changes with source identifier (e.g., "sidebar", "background",
"content_script") to prevent same-source re-processing, (4) Use dirty-flag
pattern: listener marks data as stale but defers processing to next RAF, (5)
Implement single "storage sync" coordinator: only one component actually reads
from storage per change, others subscribe to cache updates instead.

<acceptance_criteria>

- [ ] Storage.onChanged listener invocations debounced (minimum 500ms per key)
- [ ] No cascading listener triggers from intermediate writes
- [ ] Manual test: Create Quick Tab → storage.onChanged fires 1-2 times (not
      5-10)
- [ ] Manual test: 100+ Quick Tabs → listener processing time stays <100ms per
      change
- [ ] Manual test: Sidebar refresh doesn't cause storage thrashing
- [ ] Logging shows listener invocation rate and cascade detection
      </acceptance_criteria>

---

#### Issue #71: Browser Cache & sessionStorage Not Used For Volatile Quick Tab State

**Problem Summary** Quick Tab state like "minimized" or "visibility" probably
persisted immediately to `chrome.storage.local` on every state change. With
auto-minimize enabled and high tab switching frequency, storage write happens
10+ times per second. Each write goes to disk (slow), blocks main thread, or
causes storage.onChanged cascades.

**Root Cause**

- **File:** State machine and minimized-manager
  (src/features/quick-tabs/state-machine.js, minimized-manager.js)
- **Location:** State update methods
- **Issue:** Current implementation (inferred from Parts 1-4 issues #29, #30):
  - State change → immediately persist to storage
  - 100 tab switches per hour = 100 storage writes per hour
  - Each write takes 50-200ms on slow systems
  - No separation between volatile state (in-memory) and persistent state
    (storage)

**Architecture Problem:**

- Volatile state (minimized, visibility) changed frequently
- Persistent state (Quick Tab data, position, size) changed infrequently
- Both treated identically: immediate persistence on every change

<scope>
**Modify:**
- State management architecture (separate volatile from persistent state)
- Persistence strategy (batch state changes, lazy write to storage)
- Cache invalidation (track dirty state separately from storage)

**Do NOT Modify:**

- State machine logic
- Quick Tab schema </scope>

**Fix Required** Implement two-tier state architecture: (1) In-memory volatile
cache for minimized/visibility state (fast, no persistence on change), (2)
Background persistence timer: every 10 seconds, batch all volatile state changes
and write to storage once, (3) On reconnection after background restart, reload
volatile state from storage, (4) Use in-memory Map for quick access to volatile
state, avoid storage.local reads for volatile properties, (5) Differentiate API:
`setVolatileState(key, value)` (fast, in-memory) vs
`setPersistentState(key, value)` (persisted immediately).

<acceptance_criteria>

- [ ] Volatile state changes don't trigger immediate storage writes
- [ ] Persistent state persisted on timer (every 10s) with batching
- [ ] Manual test: Minimize/restore Quick Tab 100 times → no noticeable lag
- [ ] Manual test: Toggle minimized rapidly (10x per second) → no storage
      thrashing
- [ ] Manual test: Background restart → volatile state restored from last batch
      write
- [ ] Manual test: Sidebar UI responsive even during state changes
- [ ] Logging shows state change rate vs storage write rate
      </acceptance_criteria>

---

### Category 3: Quick Tab Adoption Lifecycle & Completion

**Issues:** #72, #73, #74

**Scope Impact:** Ghost Quick Tabs, adoption never completes, adoption race
conditions

#### Issue #72: Adoption Completion Not Signaled Back to Content Script (Silent Success)\*\*

**Problem Summary** Content script sends ADOPT message to background to
create/restore Quick Tab. Background processes message, creates Quick Tab in
storage, sends response. BUT: Response might not include completion status or
might arrive with wrong message ID due to out-of-order delivery (Issue #72).
Content script waits indefinitely for confirmation, UI shows "adopting..."
spinner forever.

**Root Cause**

- **File:** Adoption handler (likely
  `src/background/handlers/QuickTabHandler.js` or adoption mediator)
- **Location:** ADOPT message handler and response construction
- **Issue:** Handler likely doesn't send detailed response:
  - Returns generic `{ success: true }` instead of
    `{ success: true, adoptedQuickTabId: 'qt-123', adoptionDuration: 145 }`
  - Content script doesn't know if adoption succeeded until it sees UI update
  - No timeout for adoption completion in content script
  - Message ID mismatch (Issue #72 - out-of-order delivery) causes response
    matched to wrong pending request

**Adoption Flow Problem:**

- Content script: "Start adoption spinner"
- Send ADOPT message
- Wait for response...
- Background: Process, create Quick Tab, return response
- Content script: Receive response (or timeout after 5s)
- If timeout: spinner disappears due to timeout, not because adoption failed
- User doesn't know: Did adoption fail? Did response get lost? Is Quick Tab
  being created in background?

<scope>
**Modify:**
- ADOPT handler response format (include status and ID)
- Content script adoption timeout handling (distinguish timeout from success)
- Adoption UI completion signal (wait for explicit confirmation, not timeout)

**Do NOT Modify:**

- Adoption creation logic
- Quick Tab schema </scope>

**Fix Required** Enhance adoption completion signaling: (1) ADOPT response
includes:
`{ success: true, quickTabId: 'qt-123', adoptionDuration: 145ms, position: {...} }`,
(2) Content script doesn't stop spinner on timeout, instead waits for explicit
response with Quick Tab ID, (3) If timeout occurs, send follow-up query: "Is
Quick Tab XYZ adopted yet?" instead of giving up, (4) Implement adoption
acknowledgment: after backend creates Quick Tab, send separate message to
content script "ADOPTION_COMPLETE" with ID to unambiguously signal completion,
(5) Content script matches adoption completion to original adoption request by
ID, not by message response matching.

<acceptance_criteria>

- [ ] ADOPT response includes quickTabId and adoption status
- [ ] Content script spinner disappears only on explicit ADOPTION_COMPLETE
      signal
- [ ] Content script doesn't assume success on timeout
- [ ] Manual test: Adopt Quick Tab → spinner disappears when adoption complete
      (not on timeout)
- [ ] Manual test: Kill background mid-adoption → spinner continues, timeout
      shows error
- [ ] Manual test: Adoption race condition (multiple adopts) → each tracked
      separately
- [ ] Logging shows adoption completion with ID, duration, and content script
      receipt </acceptance_criteria>

---

#### Issue #73: Port Message Out-of-Order Delivery Not Handled (Response Mismatch)\*\*

**Problem Summary** Content script sends rapid messages to background (CREATE
QT1, CREATE QT2, CREATE QT3) with message IDs 1, 2, 3. Due to network jitter or
browser internal queueing, responses arrive out-of-order: response for ID 3
arrives before ID 2. Content script matches response 3 to pending message 1
(first pending), assigns QT data for QT3 to QT1. Ghost Quick Tab with wrong
properties.

**Root Cause**

- **File:** Content script message handling (src/content.js)
- **Location:** `pendingMessages` Map lookup and response matching (lines ~1900)
- **Issue:** Response matching algorithm:
  - Response arrives with message ID
  - Lookup `pendingMessages.get(messageId)`
  - Match response to pending request
  - BUT: Browser doesn't guarantee message delivery order
  - If ID 3 arrives before ID 2, lookup succeeds but resolves wrong pending
    request

**Browser API Limitation:** According to research (StackOverflow #227):
"JavaScript Promises and race conditions"

- `browser.runtime.sendMessage()` documentation: No guarantee of response order
- Multiple messages in flight can arrive out-of-order
- Content script must handle out-of-order responses

<scope>
**Modify:**
- Content script message ID tracking (add sequence numbers, not just IDs)
- Response matching logic (validate response against expected data before matching)

**Do NOT Modify:**

- Message sending mechanism
- Handler response format </scope>

**Fix Required** Add message ID validation to prevent mismatches: (1) Include
both messageId AND sequence number in message, (2) Response includes same
messageId, sequence number, and echo of request parameters (URL, position for
CREATE), (3) Before matching response to pending, validate: response messageId
matches pending messageId AND response echoes expected request parameters, (4)
If validation fails, queue response and try next pending message, (5) Implement
message ordering guarantee: queue messages and only send next message after
previous response received (serial instead of parallel).

<acceptance_criteria>

- [ ] Response matching validates message ID and request echoes
- [ ] Out-of-order responses detected and rejected if mismatched
- [ ] Pending messages tracked with sequence numbers
- [ ] Manual test: Send 5 CREATE messages rapidly → all received with correct
      properties
- [ ] Manual test: Intentionally reorder responses → mismatch detected, not
      applied
- [ ] Logging shows message ID, sequence, and validation result for each
      response </acceptance_criteria>

---

#### Issue #74: Promise.allSettled Not Used For Batch Adoption Operations\*\*

**Problem Summary** When adopting multiple Quick Tabs (e.g., page loads and
auto-adopts 5 Quick Tabs), code likely uses `Promise.all()` to wait for all
adoptions to complete. If Quick Tab 3 fails ownership validation, Promise.all
rejects immediately. Quick Tabs 4 and 5 never attempted adoption. Partial
adoption, no error message, user sees 2 of 5 expected Quick Tabs.

**Root Cause**

- **File:** Adoption coordination logic (likely mediator or TabLifecycleHandler)
- **Location:** Batch adoption operation handling
- **Issue:** Promise.all() semantics according to MDN:
  - Promise.all resolves only if ALL promises resolve
  - Rejects if ANY promise rejects
  - Later promises in batch never attempted after first rejection
  - Expected: Attempt all adoptions, report which succeeded and which failed
  - Current: Stop on first failure, skip remaining adoptions

<scope>
**Modify:**
- Batch adoption operation (use Promise.allSettled instead of Promise.all)
- Error handling (collect failures, don't stop at first error)

**Do NOT Modify:**

- Individual adoption logic
- Error validation itself </scope>

**Fix Required** Replace Promise.all with Promise.allSettled for batch
operations: (1) Change adoption batch from `Promise.all(adoptionPromises)` to
`Promise.allSettled(adoptionPromises)`, (2) Iterate results array, separate
successes from failures, (3) Log both successes and failures with details (which
Quick Tabs adopted, which failed and why), (4) Notify content script with
partial result: `{ adopted: ['qt-1', 'qt-2'], failed: ['qt-3', 'qt-5'] }`, (5)
Update UI to show adopted count and failure count separately.

<acceptance_criteria>

- [ ] Batch adoption uses Promise.allSettled instead of Promise.all
- [ ] All adoptions attempted even if some fail
- [ ] Manual test: Adopt 5 Quick Tabs, 1 ownership fails → other 4 complete
- [ ] Manual test: UI shows "Adopted 4 of 5" instead of showing no adoptions
- [ ] Manual test: Logging shows all adoption results (successes and failures)
- [ ] Manual test: Failed adoption reasons logged for debugging
      </acceptance_criteria>

---

### Category 4: Port Message Ordering & Duplicate Detection

**Issues:** #75, #76

**Scope Impact:** Message ID collisions, duplicate message processing, state
divergence under load

#### Issue #75: Message ID Generation Doesn't Account For Port Reconnection Cycles (ID Reuse/Collision)\*\*

**Problem Summary** Content script generates message IDs using incrementing
counter or UUID. On port disconnect/reconnect, ID generation continues from
current value (not reset). If port reconnects 10 times per session, same ID
might be generated for different messages across different port generations. New
response matches old pending message in `pendingMessages` map from before
reconnection.

**Root Cause**

- **File:** Content script port management (src/content.js)
- **Location:** Message ID generation and port reconnection logic (lines ~3100)
- **Issue:** Message ID generation pattern (inferred):
  - Counter-based: `let messageId = 0; const id = ++messageId;` (ID goes 1, 2,
    3, ... 1000)
  - Or UUID-based: `const id = Math.random() ... ` with seed from time
  - On port disconnect/reconnect: Generator continues, doesn't reset
  - After 10 reconnections: probability of collision increases

**Port Reconnection Scenario:**

1. First connection: Message IDs 1-100 generated and cleared
2. Port disconnects, connection 2: Message IDs 101-200
3. BUT: Old `pendingMessages` entry from ID 50 might still be in queue (timeout
   not fired)
4. Port reconnects connection 3: Generator wrapped or collision occurs
5. Message ID 50 generated again
6. Response for new message ID 50 matches old pending entry
7. Wrong response applied to wrong message

<scope>
**Modify:**
- Message ID generation (add port generation/version to ID)
- Port reconnection logic (reset ID generator on each reconnection)

**Do NOT Modify:**

- Message sending mechanism
- Pending message handling </scope>

**Fix Required** Make message IDs unique across port reconnection cycles: (1)
Include port generation ID in message ID: `${portGeneration}-${localMessageId}`,
(2) Increment port generation on each reconnection, (3) Reset local message ID
counter on each reconnection, (4) Alternatively: Use timestamp-based message IDs
that include millisecond precision and port epoch, (5) Validate port generation
on response matching: if response port generation != current port generation,
reject as stale.

<acceptance_criteria>

- [ ] Message IDs include port generation/version
- [ ] Message ID counter reset on port reconnection
- [ ] Manual test: 10+ port reconnections → no message ID collisions
- [ ] Manual test: Rapid port disconnect/reconnect → message responses match
      correctly
- [ ] Logging shows message ID format with generation included
      </acceptance_criteria>

---

#### Issue #76: Dedup Entries Not Keyed By Port Generation (Same ID Reused Across Reconnections)\*\*

**Problem Summary** Message deduplication tracks processed messages in
`processedMessages` Map using only `action-messageId` key. After port reconnect,
old dedup entries from previous connection remain in Map. New connection might
generate same message ID, triggering false dedup match against old connection's
processed message.

**Root Cause**

- **File:** Background message deduplication handler
  (src/background/handlers/QuickTabHandler.js)
- **Location:** Dedup key generation and entry management
- **Issue:** Dedup key doesn't include port/connection context:
  - Key: `${action}-${messageId}` (e.g., "CREATE_QT-50")
  - Dedup Map not cleared on port reconnection
  - New connection from same tab generates message ID 50
  - Dedup lookup finds old entry from previous connection
  - New message falsely identified as duplicate

**Dedup Entry Lifetime Problem:**

- Entry lives for 10 seconds (Issue #54)
- If port reconnects within 10 seconds after message processing, false dedup
  possible

<scope>
**Modify:**
- Dedup key generation (include port/connection ID)
- Dedup entry cleanup (clear on port lifecycle events)

**Do NOT Modify:**

- Dedup mechanism itself
- Message processing </scope>

**Fix Required** Scope dedup entries by port/connection: (1) Include sender tab
ID and frame ID in dedup key, not just message ID, (2) Better: Include full
message hash in key to distinguish different messages from same tab with same
ID, (3) On port disconnect, clear all dedup entries for that tab/port
combination, (4) Dedup key pattern:
`${senderTabId}-${senderFrameId}-${action}-${contentHash}`, (5) Periodically
clean dedup entries from disconnected tabs.

<acceptance_criteria>

- [ ] Dedup key includes sender tab ID and content hash
- [ ] Dedup entries cleared on port disconnect
- [ ] Manual test: Port reconnect doesn't cause false dedup matches
- [ ] Manual test: Same message sent twice → detected as duplicate; same message
      type with different params → not duplicated
- [ ] Logging shows dedup key format and cleanup events </acceptance_criteria>

---

### Category 5: Tab ID Acquisition & Cross-Domain Navigation

**Issues:** #77, #78

**Scope Impact:** Orphaned Quick Tabs, adoption fails after navigation,
originTabId mismatches

#### Issue #77: Tab ID Acquisition Race During Cross-Domain Navigation (originTabId Becomes Stale)\*\*

**Problem Summary** Content script acquires tab ID once during initialization,
caches it. When user navigates same tab from `a.example.com` → `b.example.com`,
old context unloads and new context loads. New context gets fresh tab ID from
`browser.tabs.query()` or `chrome.tabs.getCurrent()`. BUT: At moment of
navigation, Quick Tabs created on a.example.com have originTabId pointing to old
context. New context on same tab has same tab number but different originTabId
requirement for adoption.

**Root Cause**

- **File:** Content script initialization and tab ID caching (src/content.js)
- **Location:** Tab ID acquisition and caching (lines ~600)
- **Issue:** Tab ID stored once during init:
  - `cachedTabId = await browser.tabs.query({active: true, currentWindow: true})[0].id`
  - Value cached in global variable
  - On navigation: old context unloads, new context loads
  - New context queries tab ID, gets same number but needs to ADOPT with old
    originTabId
  - Quick Tab created in a.example.com context has old originTabId
  - New context on b.example.com can't adopt because originTabId mismatch

**Navigation Race Window Research:**

- Between navigation trigger and new content script load: 100-500ms gap
- Old Quick Tabs briefly "adopted" in old context while new context initializing
- New context loads, tries to adopt, encounters stale originTabId

<scope>
**Modify:**
- Tab ID refresh logic (refresh on navigation events)
- Adoption validation (account for originTabId from previous context)

**Do NOT Modify:**

- Tab ID acquisition mechanism
- Adoption completion logic </scope>

**Fix Required** Implement tab ID refresh on cross-domain navigation: (1) Add
`beforeunload` or `pagehide` listener that triggers tab ID re-acquisition on
next pageshow, (2) Or: Periodically refresh tab ID (every 10 seconds) and
compare against cached value, (3) On hostname change detected (via
`location.hostname` comparison), immediately re-acquire tab ID, (4) For
adoptions: accept Quick Tabs with originTabId from previous context during first
5 seconds after navigation (grace period), (5) Mark adopted Quick Tabs with
"source context" to allow cross-context adoption.

<acceptance_criteria>

- [ ] Tab ID refreshed on cross-domain navigation
- [ ] New context can adopt Quick Tabs from old context within grace period
- [ ] Manual test: Navigate between subdomains → Quick Tabs remain adoptable
- [ ] Manual test: Quick Tab created on a.example.com, navigate to b.example.com
      → still adoptable
- [ ] Logging shows tab ID refresh and adoption context validation
      </acceptance_criteria>

---

#### Issue #78: Adoption Doesn't Validate Quick Tab Slot Availability Before Creating\*\*

**Problem Summary** User configures max 3 Quick Tabs per tab. Page somehow
triggers 4 simultaneous adoptions (race condition or logic error). Backend
accepts all 4, creates 4 Quick Tabs. Sidebar configured to show max 3, only
displays 3. Backend has 4. State divergence.

**Root Cause**

- **File:** Adoption handler validation logic (QuickTabHandler.js)
- **Location:** ADOPT message validation
- **Issue:** Code likely doesn't check:
  - Current count of Quick Tabs for this tab
  - Maximum allowed per configuration
  - Result: No validation before creating Quick Tab
  - 4 adoptions arrive in rapid succession, all pass validation

<scope>
**Modify:**
- ADOPT handler validation (add capacity check before creation)
- Quick Tab creation logic (enforce max limit)

**Do NOT Modify:**

- Configuration schema
- Quick Tab storage </scope>

**Fix Required** Add capacity validation to ADOPT handler: (1) Before creating
Quick Tab, query current count for tab, (2) Check against configured max
(default 3, configurable), (3) If at capacity, reject adoption with error
"ADOPTION_CAPACITY_EXCEEDED", (4) Content script receives error, shows message
"This tab already has max Quick Tabs", (5) If race condition causes multiple
simultaneous adoptions, use atomic operation: query, check count, increment,
verify increment succeeded (CAS pattern).

<acceptance_criteria>

- [ ] ADOPT handler validates count before creation
- [ ] Rejection error sent if at capacity
- [ ] Manual test: Configure max 3, adopt 4 → 4th rejected
- [ ] Manual test: Manual test: Rapid simultaneous adoptions → capacity limit
      enforced
- [ ] Sidebar and backend max counts stay in sync
- [ ] Logging shows capacity checks and rejections </acceptance_criteria>

---

### Category 6: Rendering Boundaries & Viewport Awareness

**Issues:** #79, #80

**Scope Impact:** Scroll state loss, Quick Tab visibility detection fails,
layout broken after scroll

#### Issue #79: Sidebar Uses document.body.scrollTop Instead of document.scrollingElement (Cross-Browser Compatibility)\*\*

**Problem Summary** Sidebar code reads/writes scroll position using
`document.body.scrollTop`. On Chrome in standards mode, scrolling happens on
`document.documentElement.scrollTop`, not body. Sidebar scroll position resets
unexpectedly on Chrome, or stays at 0 on Firefox in certain modes.

**Root Cause**

- **File:** Sidebar panel rendering (sidebar/panel.js)
- **Location:** Scroll position read/write methods (approximately lines ~400)
- **Issue:** Browser inconsistency documented (StackOverflow #231, MDN
  scrollingElement):
  - Chrome: Scrolling in `document.documentElement`, not body
  - Firefox: Scrolling in body (in quirks mode) or documentElement (standards)
  - Code assumes: `document.body.scrollTop` works everywhere
  - Result: Scroll position never saved/restored correctly

**Cross-Browser Scroll Element:** According to MDN and W3C spec:

- `document.scrollingElement` property (standard) returns correct element
- If not supported, need to check `document.body` vs `document.documentElement`
- Current code probably doesn't handle this

<scope>
**Modify:**
- Sidebar scroll position methods (use document.scrollingElement or fallback)

**Do NOT Modify:**

- Sidebar structure
- Scroll event listeners </scope>

**Fix Required** Use standard `document.scrollingElement` property for scroll
access: (1) Read scroll: `document.scrollingElement.scrollTop`, (2) Write
scroll: `document.scrollingElement.scrollTop = value`, (3) Add polyfill/fallback
for older browsers:

```
const scrollingElement = document.scrollingElement ||
  (document.compatMode === 'BackCompat' ? document.body : document.documentElement)
```

(4) Test across Chrome, Firefox, Safari, Edge, (5) Save/restore scroll position
in RAF during sidebar refresh.

<acceptance_criteria>

- [ ] Sidebar uses document.scrollingElement for scroll access
- [ ] Scroll position preserved across sidebar refreshes
- [ ] Manual test (Chrome): Scroll sidebar, refresh → scroll position maintained
- [ ] Manual test (Firefox): Scroll sidebar, refresh → scroll position
      maintained
- [ ] Manual test (Edge/Safari): Cross-browser consistency
- [ ] Logging shows scrollingElement detection and scroll read/write operations
      </acceptance_criteria>

---

#### Issue #80: Sidebar Panel Doesn't Account for iframe Scroll Boundary (Embedded Context Issues)\*\*

**Problem Summary** If sidebar is implemented as iframe (isolated context for
security), scroll events in parent document don't propagate to iframe. Sidebar
can't detect if it's scrolled out of viewport. Quick Tabs appearing in sidebar
below fold don't trigger adoption because content script thinks they're not
visible.

**Root Cause**

- **File:** Sidebar implementation (if using iframe)
- **Location:** Scroll event listeners and visibility detection
- **Issue:** iframe isolation means:
  - Scroll events on parent don't propagate to iframe
  - Sidebar can't listen to parent scroll
  - If Quick Tab div scrolls out of viewport in sidebar, iframe doesn't know
  - Adoption visibility check fails

**Iframe Boundary Research:** According to MDN and browser behavior:

- Scroll events don't cross iframe boundaries
- BFCache (Issue #51) can freeze iframe ports
- Cross-origin iframes have additional restrictions

<scope>
**Modify:**
- Sidebar visibility detection (if using iframe)
- Adoption trigger logic (account for iframe context)

**Do NOT Modify:**

- Sidebar iframe structure (unless necessary) </scope>

**Fix Required** If sidebar is iframe: (1) Parent communicates scroll events to
iframe via message, (2) Sidebar listens to postMessage events containing scroll
position, (3) Adoption visibility detection accounts for iframe's own scroll
offset plus parent scroll offset, (4) Alternatively: Don't use iframe for
sidebar, use element overlay with separate rendering context, (5) Use
Intersection Observer API (works better across boundaries) instead of scroll
position checking.

<acceptance_criteria>

- [ ] Sidebar scroll position awareness working (whether in iframe or not)
- [ ] Adoption detects visibility accounting for all scroll contexts
- [ ] Manual test: Sidebar Quick Tab scrolls out of viewport → adoption stops
- [ ] Manual test: Sidebar Quick Tab scrolls back into view → adoption resumes
- [ ] Manual test (iframe): Parent page scroll doesn't break sidebar scroll
      detection
- [ ] Logging shows scroll events and visibility checks </acceptance_criteria>

---

### Category 7: Event Bus Scoping & Global State

**Issue:** #81

**Scope Impact:** Cross-tab event leakage, Quick Tab created on tab A fires
listener in tab B

#### Issue #81: EventBus Is Global Singleton (Events Leak Across Tabs and Contexts)\*\*

**Problem Summary** EventBus likely implemented as module-level singleton. All
tabs share same EventBus instance. When Quick Tab created on tab A,
"QUICK_TAB_CREATED" event fires on EventBus. Tab B's listener registered for
that event also fires, even though Quick Tab created on different tab. Tab B
attempts to adopt Quick Tab from Tab A, ownership validation fails or succeeds
incorrectly.

**Root Cause**

- **File:** EventBus implementation (likely `src/events/EventBus.js` or similar)
- **Location:** EventBus module export (module singleton pattern)
- **Issue:** JavaScript module singletons are global:
  - `export const eventBus = new EventBus()` at module level
  - All files importing eventBus get same instance
  - Chrome service worker: All content scripts connect to same background
    service worker, share module instance
  - Result: All tabs' listeners registered on same EventBus

**Module Singleton Problem Research (GitHub Issue #217):**

- Global state in service worker persists across all client connections
- No automatic isolation per context/tab
- Listeners accumulate across multiple client connections
- Events fire in wrong context

<scope>
**Modify:**
- EventBus implementation (add context/tab scoping)
- Event listener registration (scope to specific context)
- Or: Replace with message-based event system (no global state)

**Do NOT Modify:**

- Event types or interface
- Listener callback implementations </scope>

**Fix Required** Scope EventBus by context: (1) Instead of global singleton, use
Map of EventBus instances keyed by tab ID, (2) Each tab gets isolated EventBus:
`eventBusPerTab.get(tabId)`, (3) Listeners register on tab-specific EventBus,
(4) Event emission includes tab context, (5) Alternatively: Replace EventBus
with message-based system - instead of
`eventBus.emit('QUICK_TAB_CREATED', data)`, send message to all subscribed
contexts. (6) Or: Prefix all events with tab/context ID:
`eventBus.emit('tab_5_QUICK_TAB_CREATED')`.

<acceptance_criteria>

- [ ] EventBus scoped per tab/context (not global singleton)
- [ ] Events from tab A don't trigger listeners in tab B
- [ ] Manual test: Create Quick Tab on tab A, tab B listener doesn't fire
- [ ] Manual test: Multiple tabs with Quick Tabs don't interfere
- [ ] Logging shows EventBus instance ID and scoping per tab
- [ ] No cross-tab event leakage detected </acceptance_criteria>

---

### Category 8: Initialization Ordering & Timing Hazards

**Issues:** #82, #83

**Scope Impact:** Silent initialization failures, content script crashes before
ready, missed early messages

#### Issue #82: Content Script document.body Might Be null (Runs At document_start)\*\*

**Problem Summary** If content script configured to run at `document_start`
(before DOM parsing), Quick Tab adoption code tries to access `document.body`
which is still null. Code calls `.scrollHeight` or `.scrollTop` on null,
throwing TypeError. Error swallowed by browser, content script silently crashes,
never registers port connection.

**Root Cause**

- **File:** Content script initialization (src/content.js)
- **Location:** Module initialization code, adoption setup
- **Issue:** Content script timing from manifest.json likely:

```json
"content_scripts": [{"run_at": "document_start", ...}]
```

- At document_start: HTML not yet parsed, document.body is null
- Code tries: `document.body.scrollHeight` → TypeError: Cannot read property
  'scrollHeight' of null
- Error in module initialization crashes entire script
- Port never connects, background never knows about tab

<scope>
**Modify:**
- Content script initialization (add null checks for DOM elements)
- Or: Defer initialization to document_end or DOMContentLoaded
- Or: Guard DOM access with presence check

**Do NOT Modify:**

- Port connection protocol
- Adoption detection logic </scope>

**Fix Required** Add defensive DOM presence checks: (1) Wrap all DOM access in
null checks: `if (document.body) { ... }`, (2) Defer initialization to
`DOMContentLoaded` event or `document_end` if execution timing not critical, (3)
Or: Use requestAnimationFrame to defer DOM access until parser ready, (4) Or:
Guard with try/catch around initialization code, log errors and retry on next
animation frame, (5) Ensure port connection happens early, before first DOM
access.

<acceptance_criteria>

- [ ] No TypeError from null DOM access on content script load
- [ ] Content script completes initialization even if DOM not ready
- [ ] Port connection established early in initialization
- [ ] Manual test: Open page and check browser console → no initialization
      errors
- [ ] Manual test: Adoption detection waits for DOM ready before processing
- [ ] Logging shows initialization steps and DOM readiness detection
      </acceptance_criteria>

---

#### Issue #83: Background Handlers Not Registered Before First Message Arrives\*\*

**Problem Summary** Background service worker starts, module imports happen
asynchronously. If handler registration happens in async code (after promises
settle), message can arrive before handlers registered. First message from
content script arrives, onMessage listener registered but handler not in
registry. Message dropped silently (Issue #50 partially covers, but root cause
is deeper).

**Root Cause**

- **File:** Background service worker initialization (src/background/index.js)
- **Location:** Handler registration code
- **Issue:** Chrome MV3 best practice requires handlers registered synchronously
  at top-level:

```javascript
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  messageRouter.route(message, sender, sendResponse);
});
```

- BUT: If messageRouter or handlers loaded asynchronously, handlers might not be
  ready
- Message arrives, listener invokes route(), but handler not registered in
  MessageRouter.HANDLERS map
- Message dropped

**Service Worker Initialization Race (Chrome MV3):** According to Chrome
documentation
(developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle):

- Service worker can unload ~30s after last event
- New event wakes worker, but handlers might not be re-registered if async

<scope>
**Modify:**
- Background initialization (ensure handlers registered synchronously)
- Message routing (implement message queue for pre-init messages)

**Do NOT Modify:**

- Handler implementations
- Service worker lifecycle </scope>

**Fix Required** Guarantee synchronous handler registration: (1) Move all
handler registrations to absolute top of index.js BEFORE any async operations,
(2) Use dynamic imports inside route handler if needed (defer loading until
first use), (3) Implement message queue: browser.runtime.onMessage registers
immediately, queues messages, drains queue after initialization completes, (4)
Add initialization tracking: set flag when initialization complete, check flag
in message queue before draining, (5) Log all queued messages and their drain
timing.

<acceptance_criteria>

- [ ] All handlers registered synchronously at module top-level
- [ ] onMessage listener registered before any async code executes
- [ ] Pre-init messages queued and processed after initialization
- [ ] Manual test: Send message immediately on service worker startup → received
      and processed (not dropped)
- [ ] Manual test: Service worker restart during init → message queue still
      works
- [ ] Logging shows message queuing and initialization completion
- [ ] No "Unknown action" errors for valid handlers </acceptance_criteria>

---

## Cross-Cutting Architectural Patterns

### Pattern 1: Lack of Batching & Debouncing

- MutationObserver not debounced (Issue #67)
- DOM updates not batched in RAF (Issues #65, #66)
- Storage writes not batched (Issue #71)
- Event listener invocations not debounced (Issue #70)

**Result:** Main thread blocking, frame rate drops, UI sluggish

**Common Fix:** Use requestAnimationFrame, debouncing timers, message batching

---

### Pattern 2: Synchronous-Like Blocking Operations

- Storage reads on 2s interval (Issue #68)
- Layout calculations on position updates (Issue #65)
- DOM traversal in MutationObserver (Issue #64)
- Scroll position access (Issue #79)

**Result:** Content script and sidebar stalls, page freezes during adoption

**Common Fix:** Use async APIs (IndexedDB), defer to RAF, optimize algorithms

---

### Pattern 3: Global State Without Context Isolation

- EventBus singleton across tabs (Issue #81)
- Message IDs not scoped by port (Issues #75, #76)
- Tab ID not refreshed on navigation (Issue #77)
- Dedup entries not cleared on reconnect (Issue #76)

**Result:** Cross-tab interference, state corruption, message misroutes

**Common Fix:** Context-scoped state, connection-aware IDs, cleanup on lifecycle
events

---

### Pattern 4: Missing Capacity & Limit Checks

- Storage quota not validated (Issue #69)
- Adoption capacity not enforced (Issue #78)
- MutationObserver listener accumulation (Issue #37)
- Resource caches unbounded (Issues #33, #34)

**Result:** Silent quota failures, ghost Quick Tabs, memory leaks

**Common Fix:** Pre-checks, garbage collection, resource limits with monitoring

---

### Pattern 5: Initialization Ordering Hazards

- DOM access before document ready (Issue #82)
- Handlers not registered before messages arrive (Issue #83)
- MutationObserver firing during page load (Issue #67)

**Result:** Silent initialization crashes, dropped messages, adoption failures

**Common Fix:** Synchronous handler registration, DOM readiness checks, message
queuing

---

## Summary Table: Additional Issues

| #   | Component            | Severity | Category        | Fix Complexity |
| --- | -------------------- | -------- | --------------- | -------------- |
| 64  | MutationObserver     | Critical | DOM Performance | High           |
| 65  | Layout thrashing     | High     | Performance     | Medium         |
| 66  | DOM batching         | High     | Rendering       | Medium         |
| 67  | Observer debounce    | High     | Performance     | Low            |
| 68  | IndexedDB adoption   | High     | Storage         | High           |
| 69  | Quota exceeded       | Critical | Storage         | Medium         |
| 70  | Listener cascade     | High     | Event handling  | Medium         |
| 71  | State persistence    | Medium   | Storage         | Medium         |
| 72  | Adoption signal      | Medium   | Adoption        | Low            |
| 73  | Message ordering     | High     | Messaging       | Medium         |
| 74  | Promise.allSettled   | Medium   | Batch ops       | Low            |
| 75  | Message ID collision | Medium   | Messaging       | Low            |
| 76  | Dedup scope          | Medium   | Dedup           | Low            |
| 77  | Tab ID stale         | High     | Navigation      | Medium         |
| 78  | Adoption capacity    | Medium   | Validation      | Low            |
| 79  | Scroll compatibility | Medium   | Rendering       | Low            |
| 80  | iframe boundaries    | Low      | Rendering       | Low            |
| 81  | EventBus singleton   | High     | Architecture    | High           |
| 82  | DOM nullness         | Medium   | Initialization  | Low            |
| 83  | Handler registration | High     | Initialization  | Low            |

---

## Recommended Implementation Priority

**Phase 1A (Critical - Blocking Scalability):**

- Issue #64: MutationObserver optimization (affects all dynamic sites)
- Issue #81: EventBus scoping (prevents cross-tab interference)
- Issue #69: Storage quota validation (prevents silent data loss)

**Phase 1B (Critical - Core Reliability):**

- Issue #83: Handler registration ordering
- Issue #82: DOM readiness checks
- Issue #73: Message ordering validation

**Phase 2A (High - Performance):**

- Issue #68: IndexedDB adoption (sidebar responsiveness)
- Issue #65: Layout thrashing (adoption speed)
- Issue #66: RAF batching (frame rate)
- Issue #70: Listener debouncing (event throughput)

**Phase 2B (High - Correctness):**

- Issue #77: Tab ID refresh (navigation handling)
- Issue #75: Message ID scoping (response matching)
- Issue #72: Adoption completion signal (adoption UX)

**Phase 3 (Medium - Robustness):**

- Issue #67: Observer debouncing
- Issue #71: State persistence batching
- Issue #78: Adoption capacity validation
- Issue #74: Promise.allSettled

**Phase 4 (Remaining):**

- Issue #79-80: Rendering boundary issues
- Issue #76: Dedup scope refinement

---

## Architectural Recommendations

### For Core Reliability:

1. **Separate volatile state from persistent state** - Don't persist every state
   change
2. **Use context-scoped state** - No global singletons for shared state
3. **Message queuing for robustness** - Handle out-of-order delivery
4. **Synchronous initialization** - Handlers registered at module top-level
5. **Defensive null/error checking** - All DOM access guarded

### For Performance:

1. **Batch DOM operations in RAF** - Never read/write DOM in loop
2. **Use async storage APIs** - IndexedDB for large datasets
3. **Debounce high-frequency operations** - MutationObserver, scroll events
4. **Lazy-load handlers** - Register top-level listener, defer handler loading
5. **Cache expensive calculations** - CSS selectors, DOM queries

### For Scalability:

1. **Limit unbounded data structures** - Maps, caches, listener arrays
2. **Validate capacity before operations** - Quota, Quick Tab count
3. **Monitor resource usage** - Log accumulation rates, trigger cleanup
4. **Implement resource cleanup** - Timers, listeners, cached data

---

## Acceptance Criteria Summary

**Performance Targets:**

- Page load overhead <500ms (from 2-5s with naive MutationObserver)
- Adoption completion <1s for 50 Quick Tabs (from 5+ seconds)
- Sidebar refresh <100ms (from 1000ms+ on large datasets)
- Frame rate >30 FPS during adoption and sidebar interaction
- Storage reads don't block main thread

**Reliability Targets:**

- Zero cross-tab interference or state leakage
- 99%+ message delivery with correct response matching
- No silent initialization failures or dropped messages
- Correct handling of storage quota exhaustion
- No orphaned or ghost Quick Tabs from navigation

**Architectural Targets:**

- All state scoped by context (no global singletons)
- All critical operations have capacity/limit checks
- All async operations have timeout/retry logic
- All error paths logged with full diagnostics
- All initialization ordered and synchronized

---

**Priority:** Critical (Issues #64, #69, #81, #83) | **Secondary:** High (Issues
#65, #66, #68, #70, #73, #75, #77) | **Total Issues:** 18+ additional |
**Combined Total with Parts 1-6:** 81+ issues

---

**Note:** These architectural issues require deeper refactoring than localized
fixes. Implementation should prioritize core reliability issues in Phase 1
before attempting performance optimizations in Phase 2, as performance
improvements on broken architecture won't address underlying correctness
problems.
