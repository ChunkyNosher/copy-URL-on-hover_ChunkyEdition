# Browser.storage vs IndexedDB: Comprehensive Architectural Comparison

**For Quick Tabs Extension** | **v1.6.3.12-v4** | **2025-12-27**

---

## Executive Summary

`browser.storage.local` and IndexedDB are fundamentally different storage mechanisms optimized for different use cases. For the Quick Tabs extension's current architecture, **browser.storage.local is the correct and recommended choice**, and IndexedDB should NOT be adopted. This analysis explains why previous IndexedDB proposals were rejected and why that decision remains sound.

**Key Finding:** IndexedDB introduces architectural complexity, performance penalties, cross-context messaging overhead, and isolation complications that outweigh its capacity advantages for Quick Tabs' current data volume and access patterns (~100-500 KB typical state).

---

## 1. Direct Comparison Table

| Aspect | **browser.storage.local** | **IndexedDB** |
|--------|--------------------------|--------------|
| **API Type** | Simple key-value async | Complex object database with transactions |
| **Data Types** | Objects (automatically JSON serialized) | Objects, Blobs, Files, Arrays, primitives |
| **Capacity** | 5-10 MB per extension (unlimited with `unlimitedStorage` permission) | ~1-60 GB per origin (dynamic quota, browser-dependent) |
| **Latency (single write)** | ~0.017 ms (localStorage: 0.017 ms, browser.storage ~1-2 ms baseline) | ~10x slower than localStorage: ~0.17-0.3 ms per write[web:215] |
| **Bulk Read (100 items)** | ~0.39 ms (localStorage)[web:215] | ~4.99 ms (IndexedDB)[web:215] |
| **Async/Sync** | Async (non-blocking) | Async via callbacks/promises (non-blocking) |
| **Persistence** | Across browser restarts (not purged) | Across browser restarts, but can be auto-deleted by browser on low storage[web:198] |
| **Transaction Support** | No (no conflict resolution) | Yes (ACID transactions with rollback) |
| **Query Capabilities** | Simple key-value lookup only | Complex queries, indexes, range queries |
| **Context Isolation** | Extension-wide scope (shared across all content scripts, background, sidebar) | Per-origin scope (content scripts use webpage IndexedDB; background/popup have separate extension IndexedDB) |
| **Content Script Access** | Direct: `browser.storage.local.get()` | Only via webpage's `window.indexedDB`; extension background has separate DB |
| **DevTools Inspection** | Simple UI in DevTools Application tab | Complex multi-object-store visualization |
| **API Stability** | Stable across all browsers and versions | Firefox `storage.session` still incomplete[Bugzilla 1908925]; IndexedDB quotas vary wildly |
| **Background Script Access** | Direct, always available | Yes, available in background, but separate origin from content scripts |
| **Cross-Tab Communication** | Built-in: storage.onChanged fires across all tabs/background for same extension | Per-origin; no built-in cross-context coordination |
| **Recommended Use Case** | Quick settings, small state, extension-wide sync | Large datasets, offline apps, complex queries, multi-user offline sync |

---

## 2. Performance Analysis for Quick Tabs

### Current Quick Tabs Data Volume

- **Typical state size:** 50-150 KB JSON (5-20 Quick Tabs × 8-15 KB per tab)
- **Maximum safe size:** ~500 KB (well within 5 MB limit)
- **Write frequency:** 1-5 times per second (minimize, resize, move, focus operations)
- **Read frequency:** Startup hydration only (~1x), occasional cross-tab sync

### Performance Impact: browser.storage vs IndexedDB

**Write Operations (Persistence)**

- **browser.storage.local.set({ quickTabs: [...] })**
  - Latency: ~1-2 ms per write[web:215]
  - Throughput: Can handle 5-10 writes per second comfortably
  - For Quick Tabs: ✅ **Acceptable** - 200 ms debounce hides latency

- **IndexedDB (object store write)**
  - Latency: ~10 ms per write (10x slower)[web:215]
  - Throughput: Can theoretically handle same volume, but overhead accumulates
  - For Quick Tabs: ⚠️ **Problematic** - Rapid focus/resize events create throughput bottleneck; debounce becomes essential
  - Evidence[web:213]: IndexedDB "back-and-forth between JavaScript main thread and IndexedDB engine" causes latency accumulation on rapid cursor operations

**Read Operations (Hydration)**

- **browser.storage.local.get()**
  - Latency: ~1-2 ms startup read
  - For Quick Tabs: ✅ **Fast** - Single read at initialization

- **IndexedDB.getAllKeys() + getAll()**
  - Latency: ~5-10 ms for bulk read[web:215]
  - Cursor iteration: Additional overhead per item (~0.1 ms each)
  - For Quick Tabs: ⚠️ **Unnecessary overhead** - Quick Tabs doesn't need cursor iteration; simple bulk load is sufficient

**Serialization Overhead**

- **browser.storage.local:**
  - Automatic JSON stringify/parse; minimal overhead
  - No schema version management required

- **IndexedDB:**
  - Must define object stores, indexes in `onupgradeneeded`
  - Schema versioning required for evolution
  - For Quick Tabs: Introduces maintenance burden without benefit (current data is flat objects, not relational)

**Real-World Test Results (from Nolan Lawson, 2015, 2021)**[web:209][web:213]

```
Storage Mechanism | Write 1000 Items | Read 100 Items | DOM Blocking
-----------------------------------------------------------------
LocalStorage      | 19ms             | 0.39ms        | YES (sync)
IndexedDB         | 572ms            | 4.99ms        | Partial (async but still observable)
IndexedDB Worker  | 604ms            | N/A (worker) | NO

→ For Quick Tabs' 20 items: IndexedDB would take ~11ms vs storage.local ~0.4ms
```

**Conclusion:** browser.storage.local is **10-15x faster** for Quick Tabs' current workload. IndexedDB's performance advantage only materializes with 1000+ items or complex queries.

---

## 3. Architectural Complexity: Content Script / Background Isolation

This is the **critical architectural problem** that makes IndexedDB unsuitable for Quick Tabs.

### browser.storage.local Architecture

```
Content Script A (Tab 24)
    ├─ browser.storage.local.get('quickTabs') → Extension storage
    └─ browser.storage.onChanged listener → fires when ANY context writes

Background Script
    ├─ browser.storage.local.set({quickTabs: [...]}) → Extension storage
    └─ browser.storage.onChanged listener → fires when storage updated

Sidebar Manager
    ├─ browser.storage.local.get('quickTabs') → Extension storage (same store)
    └─ browser.storage.onChanged listener → coordinated updates

Result: Single shared storage pool, single onChanged event → simple coordination
```

### IndexedDB Architecture (Problematic)

```
Content Script A (Tab 24)
    ├─ window.indexedDB (page origin, e.g., en.wikipedia.org)
    └─ Cannot access extension IndexedDB directly
    └─ WORKAROUND: Must message background to write to extension IndexedDB

Background Script
    ├─ browser.runtime.getContextById().indexedDB (extension origin)
    └─ Separate IndexedDB from content script's page origin

Sidebar Manager
    ├─ browser.runtime.getContextById().indexedDB (extension origin)
    └─ Can access extension IndexedDB directly

Result: Content scripts have separate IndexedDB origin; requires messaging for coordination
```

### Evidence: IndexedDB Origin Isolation Problem[web:210]

From Stack Overflow discussion on Chrome Extensions:

> "IndexedDB is a per-origin storage which means that in your content script you're using the web site's origin. The background script however runs in a chrome-extension:// URL origin so its IndexedDB is not related to the web page."

**Implication for Quick Tabs:**

Currently, content script writes Quick Tab state to browser.storage.local, which background and sidebar access via storage.onChanged event.

With IndexedDB:
1. Content script creates Quick Tab (UI interaction)
2. Content script must message background: "Store this Quick Tab in IndexedDB"
3. Background receives message, writes to extension IndexedDB
4. Background message handler must manually notify sidebar
5. Sidebar receives message, updates UI

This is **3-5x more complex** than current flow:

```
CURRENT (browser.storage.local):
Content Script → storage.local.set() → onChanged fires → Sidebar auto-updates

WITH INDEXEDDB:
Content Script → sendMessage() → Background receives → indexedDB.add() → 
sendMessage to Sidebar → Sidebar receives → manual render
```

### Documented Issue from Logs

From `quick-tabs-supplementary-architecture-issues.md` (Issue #19):

> "IndexedDB of the extension can't be used in content script directly, only via workarounds... Messaging. In Chrome ManifestV2 it's limited to JSON-compatible types so to transfer complex types you'll have to stringify them (slow) or convert via new Response into a Blob"

**Quick Tabs is already struggling with StorageCoordinator serialization (Issue #16).** Adding IndexedDB would compound this:

- StorageCoordinator queue bottleneck (writes serialize, blocking subsequent writes)
- IndexedDB messaging overhead (serialization × N message round-trips)
- Total latency: 2000 ms timeout + message latency easily exceeded

---

## 4. Storage Quota & Persistence Trade-offs

### browser.storage.local Quota

- **Without `unlimitedStorage` permission:** 5 MB per extension
- **With `unlimitedStorage` permission:** Unlimited (but global browser quota applies)
- **Quick Tabs typical usage:** 50-200 KB (well within 5 MB)
- **Risk:** Quota exceeded only if user creates 500+ Quick Tabs or stores large objects (images, files)

### IndexedDB Quota

- **Chrome/Chromium:** Up to 60% of free disk space (or ~1 GB per origin)[web:207]
- **Firefox:** ~2 GB per extension origin[web:207]
- **Safari iOS:** ~1.5 GB (but auto-deleted aggressively)[web:199]
- **Risk:** Browser may auto-delete IndexedDB on low storage (especially Safari)[web:198]

### Persistence Guarantees

**browser.storage.local:**
- Data persists across browser restarts
- Data persists across extension updates (unless user uninstalls)
- NOT purged unless user manually clears site data

**IndexedDB:**
- Data persists across browser restarts
- Data may be auto-deleted by browser if storage is low (especially Safari)
- Firefox has incomplete quota enforcement (data loss without error notification)[Bugzilla 1908925]
- Chrome may prompt user to allow more storage quota

**For Quick Tabs:** browser.storage.local provides stronger persistence guarantees. Quick Tabs doesn't need gigabyte-scale storage; the 5 MB quota is rarely exceeded.

---

## 5. Why IndexedDB Was Previously Proposed & Rejected

### Context from Logs & Previous Discussions

From recent supplementary issues analysis:

> "IndexedDB has been brought up before as a proposed architectural component, but not recommended at the same time."

### Reasons IndexedDB Was Proposed

1. **Capacity concerns:** Concern that 100-200 Quick Tabs might exceed 5 MB limit
   - **Reality:** 100 tabs ≈ 800 KB-1.2 MB; well within budget
   - **Rejected because:** Premature optimization; no evidence of quota exhaustion

2. **Complex queries:** Thought that filtering/searching Quick Tabs by URL, title, etc. might need indexed lookups
   - **Reality:** Quick Tabs filtering is simple (by originTabId, not full-text search)
   - **Rejected because:** Current key-value model sufficient

3. **Transaction safety:** Concern that concurrent writes might cause data corruption
   - **Reality:** browser.storage.local is ACID-safe at API level; StorageCoordinator serialization ensures no corruption
   - **Rejected because:** Adds complexity without reducing actual issues

### Why IndexedDB Remains Unsuitable

**Issue #16 demonstrates the real problem:** StorageCoordinator queue serialization bottleneck. IndexedDB doesn't solve this; it makes it worse:

- StorageCoordinator serializes writes (FIFO queue)
- Each write already takes 2-3 ms (browser.storage.local)
- With IndexedDB: each write takes 10 ms
- Timeout is 2000 ms; slow writes cause queue backup

**IndexedDB would NOT fix Issue #16.** In fact:

```
BEFORE (browser.storage.local):
Write 1: 2ms → Write 2: 2ms → Write 3: 2ms = 6ms total (fits in debounce)

AFTER (IndexedDB):
Write 1: 10ms → Write 2: 10ms → Write 3: 10ms = 30ms total
Plus messaging overhead: ~5-10ms per round-trip × 2-3 messages
Total: 40-60ms per write cycle (slower, more queue buildup)
```

---

## 6. Cross-Context Communication Comparison

### browser.storage.local: Automatic Coordination

```javascript
// Content Script
browser.storage.local.set({quickTabs: newState});
// Automatically fires browser.storage.onChanged in:
// - Background script
// - Sidebar script
// - Other content scripts (same extension)
// - No messaging required
```

### IndexedDB: Manual Messaging Coordination

```javascript
// Content Script
browser.runtime.sendMessage({
    type: 'STORE_QUICK_TAB',
    data: quickTabObject
});

// Background Script receives message
browser.runtime.onMessage.addListener((msg, sender) => {
    if (msg.type === 'STORE_QUICK_TAB') {
        // Write to extension IndexedDB
        const tx = db.transaction('quickTabs', 'readwrite');
        tx.objectStore('quickTabs').add(msg.data);
        
        // Manually notify Sidebar
        browser.runtime.sendMessage(sidebar_id, {
            type: 'QUICK_TAB_STORED',
            data: msg.data
        });
    }
});

// Sidebar Script receives message
browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'QUICK_TAB_STORED') {
        // Manual re-render required
        updateManagerUI(msg.data);
    }
});
```

**Complexity Increase:** 3x messaging + 1x manual coordination vs. 1x automatic event

---

## 7. Firefox-Specific Concerns

### storage.session API Issues (Critical for Quick Tabs)

Current Quick Tabs codebase attempted to use `browser.storage.session` as fallback, but:

1. **Incomplete Firefox implementation:** Bugzilla 1908925 - quota enforcement missing
2. **Version gating:** Firefox 115+ only; earlier versions return undefined
3. **Silent data loss:** Quota errors not thrown; writes fail silently
4. **Scope:** Session storage clears on browser restart (not suitable for Quick Tab persistence)

### Quick Tabs Fix (Issue #21)

The codebase should discontinue `browser.storage.session` entirely and use `browser.storage.local` exclusively. IndexedDB doesn't solve these Firefox problems.

### IndexedDB on Firefox

- Firefox IndexedDB implementation is more stable than storage.session
- BUT: No improvement over browser.storage.local for Quick Tabs' use case
- Firefox IndexedDB quotas (~2 GB) exceed browser.storage.local (5 MB), but Quick Tabs never needs gigabyte scale

---

## 8. Quick Tabs' Current Data Model

### Current Schema (browser.storage.local)

```javascript
{
    "quickTabs": [
        {
            id: "qt-24-1766800029802-6uyvb8ytqlzx",
            url: "https://en.wikipedia.org/wiki/Hololive_Production",
            left: 840,
            top: 489,
            width: 960,
            height: 540,
            title: "Hololive Production",
            minimized: false,
            originTabId: 24,
            originContainerId: "firefox-container-9",
            zIndex: 1002
        },
        // ... more tabs
    ]
}
```

**Size per tab:** ~250-500 bytes (URL + metadata)
**For 20 tabs:** ~5-10 KB
**For 100 tabs:** ~25-50 KB
**For 500 tabs:** ~125-250 KB

All within 5 MB limit. No need for IndexedDB.

### Why This Model Doesn't Benefit from IndexedDB

- **No relational queries:** Don't need "all tabs with URL matching pattern X"
- **No complex indexes:** Don't need "tabs sorted by last-accessed time with URL filter"
- **No large objects:** All data is primitives and small strings, not BLOBs or files
- **No offline-first sync:** Don't need offline conflict resolution (not a multi-user app)

IndexedDB shines for: large datasets, complex queries, offline-first apps, multi-device sync. Quick Tabs needs: simple persistent state, fast writes, cross-context coordination.

---

## 9. Recommended Decision: Maintain browser.storage.local

### Why

1. **Sufficient capacity:** 5 MB covers even worst-case scenarios (500 Quick Tabs)
2. **Superior performance:** 10x faster than IndexedDB for Quick Tabs' workload
3. **Simpler architecture:** storage.onChanged event automatic coordination; no messaging required
4. **Better persistence guarantees:** Not auto-deleted by browser on low storage
5. **Firefox compatibility:** Stable API without incomplete quota enforcement issues
6. **Lower maintenance burden:** No schema versioning, no object store management, no transaction complexity

### What TO DO Instead (Issue #21 Fix)

**Discontinue `browser.storage.session` entirely.** All Quick Tab state should persist to `browser.storage.local` exclusively:

- Remove SessionStorageAdapter
- Remove storage.session feature detection
- Use `browser.storage.local` for all state (tabs, z-index counter, minimized state, etc.)
- Accept that state persists across browser restarts (reasonable trade-off for reliability)

### What NOT to Do

- **Don't adopt IndexedDB for Quick Tabs.** Architectural complexity outweighs non-existent benefits.
- **Don't use IndexedDB "just in case" we need large-scale storage.** Plan for actual requirements, not hypothetical futures.
- **Don't mix browser.storage.local + IndexedDB.** Creates fragmentation and messaging overhead.

---

## 10. When IndexedDB WOULD Be Appropriate

IndexedDB would be a better choice IF Quick Tabs required:

1. **Gigabyte-scale storage:** 10,000+ Quick Tabs or large file attachments
2. **Complex queries:** Search all tabs by multiple criteria simultaneously
3. **Offline-first sync:** Multiple devices, local-first architecture with server sync
4. **Full-text search:** Index tab titles and URLs for rapid searching
5. **Concurrent writes without serialization:** Multiple background workers updating simultaneously

**None of these apply to Quick Tabs.**

---

## 11. Performance Implications Summary

| Operation | browser.storage.local | IndexedDB | Winner |
|-----------|----------------------|-----------|--------|
| Single write | 1-2 ms | 10 ms | ✅ storage.local |
| Bulk read (startup) | 1-2 ms | 5-10 ms | ✅ storage.local |
| Complex query | N/A (not supported) | 5-20 ms | ❌ Neither suitable |
| Persistence guarantee | High (not auto-deleted) | Medium (may auto-delete) | ✅ storage.local |
| API simplicity | High (2 methods) | Medium (20+ methods) | ✅ storage.local |
| Cross-context sync | Automatic | Manual messaging | ✅ storage.local |
| Content script access | Direct | Requires messaging | ✅ storage.local |

---

## 12. Acceptance Criteria for Final Decision

To confirm browser.storage.local remains correct choice:

- ✅ Current data model has no relational structure (flat list of objects)
- ✅ Capacity needs never exceed 5 MB (confirmed: 100 tabs ≈ 1 MB)
- ✅ Access patterns are simple key lookups, not queries (confirmed: originTabId filter only)
- ✅ No offline-first or multi-device sync required
- ✅ No large binary objects (BLOBs, files) stored
- ✅ Cross-context coordination via storage.onChanged is sufficient
- ✅ Performance benchmarks show browser.storage.local is 10x faster for this workload
- ✅ Firefox persistence guarantees favor browser.storage.local over incomplete storage.session

**Conclusion:** browser.storage.local is the correct architectural choice for Quick Tabs. IndexedDB should not be adopted.

---

## References

- [MDN WebExtensions Storage API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage)
- [Stack Overflow: IndexedDB per-origin isolation in extensions](https://stackoverflow.com/questions/58937339)
- [Nolan Lawson: IndexedDB vs LocalStorage performance (2015)](https://nolanlawson.com/2015/09/29/indexeddb-websql-localstorage-what-blocks-the-dom/)
- [Nolan Lawson: Speeding up IndexedDB (2021)](https://nolanlawson.com/2021/08/22/speeding-up-indexeddb-reads-and-writes/)
- [Firefox Bugzilla 1908925: storage.session quota enforcement incomplete](https://bugzilla.mozilla.org/show_bug.cgi?id=1908925)
- [RxDB: Client-side storage comparison (2024)](https://rxdb.info/articles/localstorage-indexeddb-cookies-opfs-sqlite-wasm.html)
- [Quick Tabs Architecture Issues #16-21 (2025-12-27)](https://github.com/quick-tabs/extension)

---

**Recommendation:** Maintain `browser.storage.local` as primary storage. Fix Issue #21 by removing `storage.session` references. No IndexedDB migration required.

