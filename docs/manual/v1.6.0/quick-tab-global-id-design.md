# Architecting Global ID Persistence for Quick Tabs

**Objective:** Make Quick Tabs system-wide objects with unique and persistent
IDs such that "Quick Tab 1" opened in Wikipedia Tab 1 is **always** labeled and
tracked as "Quick Tab 1" across all tabs, without per-tab duplication or
relabeling, even as the user switches pages or domains.

---

## The Problem: "Slot Drift" and Per-Tab Duplication

**Previous Behavior (Legacy):**

- Each browser tab can end up with its own separate instance of "Quick Tab 1."
  These instances attempt to sync by broadcasting state, but they're not truly
  the same object.
- If the user switches between tabs, the extension _creates local clones_ using
  available slot numbers, causing confusion—"Quick Tab 1" in Wikipedia might not
  actually be the same instance as "Quick Tab 1" in YouTube.
- Position/size sync logic relies on matching by slot number, but with duplicate
  objects, sync bugs and state mismatches are frequent.

**Current Behavior (v1.6.2.2 with unified storage):**

- The sync pipeline attempts to merge all tabs' Quick Tabs into a global state,
  but bugs in the extraction logic (see previous root cause) can still lead to
  ephemeral or missing Quick Tabs if not globally enforced.

---

## Principles for Global, Unique Quick Tab IDs

1. **Single Source of Truth:**
   - Quick Tabs must be global entities, with all tabs reading/writing a
     canonical data structure.
   - Slot number ("Quick Tab 1") must _always_ refer to the same unique object
     (by `id` property) in persistent storage.

2. **Global Creation and Naming:**
   - When creating a Quick Tab, assign it a stable, unique ID like `qt-UUID` and
     a slot/label (`Quick Tab 1`, `Quick Tab 2`, ...).
   - Slot assignment logic should _always_ lower-bound scan all existing Quick
     Tabs across global state before assigning a new slot number.
   - Never reuse slot numbers until the original Quick Tab is deleted.

3. **Rendering, Not Re-Creation:**
   - When switching or opening a new tab, Quick Tabs should be _rendered from
     the global state_, not re-instantiated with a new ID.
   - UI in each tab simply renders the full set of Quick Tabs marked as visible
     (either global or per-tab/solo/mute visibility), always by their
     system-level ID and slot.
   - If the slot label got out of sync (rare, if state is single-source), always
     recalc labels by slot index lookup on load.

4. **State Synchronization:**
   - All changes (move, resize, minimize, solo, mute, state toggles) must update
     the global state for that Quick Tab ID.
   - All tabs listen for `storage.onChanged` or similar events, and re-render
     with current state—never mutate local copies!

---

## Architectural Changes

### 1. **Unified Global Quick Tab Registry**

- Refactor storage schema to contain just one array:
  `quick_tabs_state_v2: { tabs: [ { id, slot, ... } ], ... }`
- All slot assignment, state update, and deletion logic operates on this central
  registry.

### 2. **Slot Assignment**

- On Quick Tab creation:
  - Scan all `tabs` in global registry for lowest available slot number.
  - Assign slot to the new Quick Tab, record with `id` (e.g.
    `qt-170000001-a8b01` + `slot: 1`)
  - Slot number _never duplicates_ while Quick Tab exists.
- "Slot 1" is always the global Quick Tab with `slot: 1`. If Quick Tab 1 is
  closed, that slot goes into the available pool for next create.

### 3. **Rendering by ID**

- On tab switch or new tab load:
  - Hydrate all Quick Tabs from the global registry.
  - For each visible Quick Tab, render based on consistent `id` and `slot`—no
    per-tab code should ever generate a new one with same slot.

### 4. **UI Coordination**

- Refresh slot assignment and labels every time Quick Tabs are rehydrated.
- When manipulating Quick Tabs, UI uses the stable system-level ID and slot for
  tracking (never positional index).

### 5. **Event Handling**

- State changes always emit to the whole registry and propagate via
  `storage.onChanged`.
- No direct cross-tab broadcast/messaging required beyond global storage sync.

---

## Implementation Sketch

**Global Slot Assignment (Pseudo-JS):**

```js
function assignGlobalSlot(tabs) {
  const occupied = new Set(tabs.map(tab => tab.slot));
  for (let i = 1; ; i++) {
    if (!occupied.has(i)) return i; // First free slot
  }
}

function createQuickTab({ url, ... }) {
  const tabs = loadTabsFromStorage();
  const slot = assignGlobalSlot(tabs);
  const id = `qt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  tabs.push({ id, slot, url, ... });
  saveTabsToStorage(tabs);
}
```

**Rendering:**

- On every page load/tab switch, reload all Quick Tabs from storage, render
  based on `slot` and `id`.
- UI always displays "Quick Tab 1" as the Quick Tab with `slot: 1`, even if
  being viewed from YT, WP, GH, etc.

**State Updates:**

```js
function updateQuickTab(id, data) {
  const tabs = loadTabsFromStorage();
  const qt = tabs.find(qt => qt.id === id);
  if (qt) Object.assign(qt, data);
  saveTabsToStorage(tabs);
}
```

---

## Migration Plan

1. Refactor creation and slot code to guarantee stable, global slot indexing.
2. On upgrade, migrate legacy per-tab Quick Tabs to global registry—deduplicate
   by URL, merge state as possible, and assign slots.
3. Ensure all reads/writes flow through the central registry (no local buffering
   beyond UI hydration).
4. Remove any per-tab slot assignment logic, slot-label reversal code, slot
   relabeling fixes, etc.
5. Add cross-tab tests: create Quick Tabs in one tab, reload/switch, manipulate
   from another tab, validate slot labeling is **global and ID-stable**.

---

## Testing

- **Create Quick Tab 1 in Tab 1, switch to Tab 2:** Should always see Quick Tab
  1
- **Create more Quick Tabs up to Quick Tab 3, close Quick Tab 2, create new:**
  Should see slot "2" reused only after Quick Tab 2 is gone everywhere
- **From any tab, Quick Tab slot index and ID never swap unless explicitly
  deleted and recreated**

---

## Benefits

- **Prevents duplication/orphaned Quick Tabs**
- **Ensures full state consistency and correct slot labeling regardless of
  tab/page/webpage**
- **Removes slot drift and sync bugs**
- **Makes multi-tab scripting/testing dramatically easier**
