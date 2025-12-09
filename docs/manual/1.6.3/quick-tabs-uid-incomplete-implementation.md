# Quick Tabs Debug UID Display: Complete Feature Implementation Failure

**Extension Version:** v1.6.3.2 | **Date:** 2025-11-30 | **Scope:** Feature 50%
implemented, completely inaccessible to users

---

## Problem Summary

The Quick Tabs Debug UID Display feature was partially implemented in v1.6.3.2
but is **completely non-functional and invisible to users**. Source code
inspection reveals the feature exists in backend Quick Tab code (CreateHandler,
QuickTabWindow, TitlebarBuilder) but the **entire frontend settings UI
integration is missing**. There is no checkbox to enable the feature, no
settings storage/loading logic, and a critical storage location mismatch that
would prevent the feature from working even if the UI existed. User testing
confirms: no setting toggle visible in Advanced tab, no UID label visible in any
Quick Tab window.

This is not a bug in existing functionality—this is an **incomplete feature
implementation** where backend code changes were committed without corresponding
frontend UI work.

---

## Root Cause Analysis

After comprehensive source code inspection of settings.html, settings.js,
config.js, CreateHandler.js, window.js, and TitlebarBuilder.js, **five critical
missing pieces** have been identified:

### Issue #1: Settings UI Completely Missing (CRITICAL - P0)

**File:** `sidebar/settings.html`  
**Location:** Advanced tab section (lines ~850-1100)  
**Issue:** No HTML checkbox element exists for Quick Tab UID display toggle. The
Advanced tab contains console log filters, debug mode toggle, and utility
buttons, but zero UI controls for the UID display feature.

**Evidence from Source Code:**

The Advanced tab (`<div id="advanced" class="tab-content">`) contains:

- Console Log Filters (Live and Export) with collapsible filter groups
- Extension Menu Size dropdown
- Show Copy Notifications checkbox
- **Enable debug mode (console logs)** checkbox ← NOT the UID display toggle
- Clear Quick Tab Storage button
- Export Console Logs button
- Clear Log History button

**No checkbox labeled** "Show Quick Tab UIDs", "Display Quick Tab IDs", "Enable
UID Display", or anything similar exists anywhere in the 1500+ line HTML file.

**Why This Is Critical:**

Users have zero way to enable the feature. Even if all backend code worked
perfectly, the feature is permanently disabled because no UI element exists to
flip the setting to `true`. This is the primary blocker preventing any user from
ever seeing the UID display.

**Pattern Comparison:**

Other Quick Tab settings (like `quickTabCloseOnOpen`, `quickTabEnableResize`)
have corresponding checkboxes in the Quick Tabs tab. The UID display setting
should follow the same pattern but is completely absent.

---

### Issue #2: Settings Storage Persistence Missing (CRITICAL - P0)

**File:** `sidebar/settings.js`  
**Location:** `DEFAULT_SETTINGS` object (lines ~250-310),
`gatherSettingsFromForm()` function (lines ~550-620), `loadSettings()` function
(lines ~350-480)  
**Issue:** No code exists to save, load, or store the `quickTabShowDebugId`
setting. The settings system is unaware this setting exists.

**Evidence from Source Code:**

**DEFAULT_SETTINGS object** defines 30+ settings including:

- All Copy URL key bindings
- All Quick Tab configuration (key, position, dimensions, close behavior)
- Notification and tooltip settings
- Debug mode, dark mode, menu size

**Missing:** Any reference to `quickTabShowDebugId`, `quickTabShowDebugIds`,
`showDebugId`, or any UID-related setting key.

**gatherSettingsFromForm() function** collects values from all form controls
including:

- Keyboard shortcut checkboxes and text inputs
- Quick Tab configuration dropdowns and number inputs
- Appearance settings, notification settings
- Debug mode checkbox

**Missing:** Any code to read a UID display checkbox value (because the checkbox
doesn't exist in HTML).

**loadSettings() function** populates form controls with stored values
including:

- Setting checkbox checked states based on storage
- Setting input values based on storage
- Setting dropdown selections based on storage

**Missing:** Any code to set a UID display checkbox state from storage (because
the checkbox doesn't exist).

**Why This Is Critical:**

Even if Issue #1 were fixed by adding a checkbox to HTML, that checkbox would be
non-functional. When user clicks "Save Settings", the `gatherSettingsFromForm()`
function would not collect the checkbox value. When settings load, the checkbox
would not be populated with the stored value. The setting would never persist
across browser sessions.

**Storage Write Verification:**

The `saveSettings()` function writes the result of `gatherSettingsFromForm()` to
`browser.storage.local`. Since `gatherSettingsFromForm()` doesn't include UID
display setting, it is never written to storage.

---

### Issue #3: Storage Location and Key Mismatch (HIGH - P1)

**Files:** `sidebar/settings.js` vs
`src/features/quick-tabs/handlers/CreateHandler.js` and `src/core/config.js`  
**Location:** Settings UI uses `browser.storage.local` with individual keys;
CreateHandler reads from `browser.storage.sync` under nested object key  
**Issue:** Fundamental mismatch in storage API and key structure between
settings write location and CreateHandler read location means even if settings
were saved, they would never be found.

**Evidence from Source Code:**

**Settings UI Pattern (settings.js):**

```
// Write to browser.storage.local with individual keys
await browserAPI.storage.local.set({
  quickTabKey: 'q',
  quickTabMaxWindows: 3,
  quickTabCloseOnOpen: false,
  // ... all settings as individual keys
});
```

**CreateHandler Read Pattern (CreateHandler.js):**

```
// Read from browser.storage.sync under nested object
const settingsKey = CONSTANTS.QUICK_TAB_SETTINGS_KEY; // = 'quick_tab_settings'
const result = await browser.storage.sync.get(settingsKey);
const settings = result[settingsKey] || {}; // Expects nested object
this.showDebugIdSetting = settings.quickTabShowDebugId ?? false;
```

**Mismatch Details:**

1. **Storage API:** Settings UI writes to `storage.local`, CreateHandler reads
   from `storage.sync`
2. **Key Structure:** Settings UI uses flat keys (`quickTabCloseOnOpen: true`),
   CreateHandler expects nested object
   (`quick_tab_settings: { quickTabShowDebugId: true }`)
3. **Key Name:** Settings UI would need to write `quickTabShowDebugId` as
   individual key, CreateHandler looks for it nested inside `quick_tab_settings`

**Why This Is Critical:**

Even if Issues #1 and #2 were fixed perfectly, the setting value would be
written to the wrong location in storage. CreateHandler would always read
`undefined` from `storage.sync['quick_tab_settings'].quickTabShowDebugId`, while
the actual value sits in `storage.local.quickTabShowDebugId`. Result: feature
permanently disabled.

**Mozilla Storage API Behavior:**

Per MDN WebExtensions documentation:

> "`storage.local` stores data locally only. `storage.sync` stores data that is
> synced using Firefox Sync."

These are **separate storage areas**. Data written to one is not accessible from
the other. The CreateHandler storage read would need to:

- Use `browser.storage.local` instead of `browser.storage.sync`, AND
- Read individual key `quickTabShowDebugId` instead of nested
  `quick_tab_settings.quickTabShowDebugId`

---

### Issue #4: CSS Positioning Property Missing (MEDIUM - P2)

**File:** `src/features/quick-tabs/window/TitlebarBuilder.js`  
**Location:** `_createDebugIdElement()` method inline styles object (lines
~405-417)  
**Issue:** Critical `marginLeft: 'auto'` CSS property required for flexbox
right-alignment is missing from inline styles, preventing correct positioning
even if element is created.

**Evidence from Source Code:**

**Current inline styles object:**

```
style: {
  fontSize: '10px',
  color: '#888',
  fontFamily: 'monospace',
  marginRight: '8px',        // ✅ Present
  // ❌ MISSING: marginLeft: 'auto'
  userSelect: 'text',
  cursor: 'default',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '100px'
}
```

**Required property from original implementation guide:**

```
marginLeft: 'auto'  // Push element to right edge before buttons
```

**Why This Is Critical:**

The titlebar is a flex container with structure:

```
[Drag Handle] [Favicon] [Title (flex: 1)] [Controls Container]
                                               ↳ [UID Element] [Buttons...]
```

Without `marginLeft: 'auto'`, the UID element sits at its natural flow position.
Since the title uses `flex: 1` to expand, it pushes the controls container
(including UID element) off the right edge or compresses it to zero width. The
`marginLeft: 'auto'` property consumes free space and forces right-edge
alignment.

**Mozilla Flexbox Documentation:**

Per MDN CSS Flexible Box Layout guide:

> "Auto margins on flex items can be used to push items apart. If you give a
> flex item `margin-left: auto`, it will push all following items to the right."

This is the standard flexbox pattern for right-aligning items. Without it, the
UID element will be positioned incorrectly or completely clipped.

---

### Issue #5: No Settings Change Propagation (MEDIUM - P2)

**Files:** `sidebar/settings.js` and
`src/features/quick-tabs/handlers/CreateHandler.js`  
**Location:** Overall settings update flow and Quick Tab window refresh
mechanism  
**Issue:** No mechanism exists to propagate setting changes to already-created
Quick Tab windows or to refresh CreateHandler's cached setting value when user
toggles the checkbox.

**Evidence from Source Code:**

**Settings Save Flow (settings.js):**

```
async function saveSettings() {
  const settings = gatherSettingsFromForm();
  await browserAPI.storage.local.set(settings);
  // ... refresh live console filters in all tabs
  showStatus('✓ Settings saved! Reload tabs to apply changes.');
}
```

The settings system:

- Saves to storage
- Refreshes console log filters via message passing
- Shows success message telling user to **reload tabs**

**CreateHandler Initialization (CreateHandler.js):**

```
async init() {
  await this._loadDebugIdSetting();
}
```

CreateHandler loads setting once during `init()`, caches it in
`this.showDebugIdSetting`, and never re-reads it. If user changes the setting
while Quick Tabs exist, those windows never update.

**Missing Mechanisms:**

1. No `storage.onChanged` listener in CreateHandler to detect setting changes
2. No message passing system to notify CreateHandler of setting updates
3. No dynamic titlebar refresh in QuickTabWindow to add/remove UID element after
   creation
4. No coordination between settings UI and CreateHandler lifecycle

**Why This Is Important:**

Even if all other issues are fixed, user experience would be poor:

- Enable setting → Save → No effect on existing Quick Tabs
- Must close and recreate all Quick Tabs to see UIDs
- Disable setting → Save → UIDs remain visible until Quick Tabs recreated

**Best Practice Pattern:**

Other extension features (like console log filters) use `storage.onChanged`
listeners and message passing to apply setting changes immediately without
requiring page reloads. The UID display should follow this pattern.

---

## Implementation Discrepancies vs. Original Specification

The implementation guide specified a complete feature with UI, storage, and
rendering. Actual code only implements backend rendering:

### Discrepancy #1: Settings UI

**Spec Required:**

> "Location: Extension settings page → Quick Tabs tab → 'Debug Options' section
> (create if not exists)"  
> "Label: 'Show Quick Tab UIDs (Debug Mode)'"  
> "Default: OFF (unchecked)"

**Actual Implementation:**

- NO HTML checkbox element exists
- NO Debug Options section exists
- NO UI control of any kind for this feature

### Discrepancy #2: Storage Persistence

**Spec Required:**

> "Storage: `browser.storage.local` key: `quickTabShowDebugIds` (boolean)"

**Actual Implementation:**

- NO storage write code in settings.js
- CreateHandler reads from `browser.storage.sync` (wrong API)
- CreateHandler reads from nested object key
  `quick_tab_settings.quickTabShowDebugId` (wrong structure)
- Key name mismatch: spec says `quickTabShowDebugIds` (plural), code looks for
  `quickTabShowDebugId` (singular)

### Discrepancy #3: CSS Positioning

**Spec Required:**

```
marginLeft: 'auto'  // Push to right side
marginRight: '8px'  // Space before buttons
```

**Actual Implementation:**

- `marginRight: '8px'` ✅ Present
- `marginLeft: 'auto'` ❌ Missing

### Discrepancy #4: Feature Lifecycle

**Spec Required:**

> "If user toggles setting, existing Quick Tabs won't update until they're
> recreated or page reloads (acceptable for debug feature)."

**Actual Implementation:**

- No dynamic updates ✅ Matches spec
- But: No way to toggle setting in first place ❌ Makes spec point moot

---

## Why Feature Is Completely Non-Functional

The five issues create an **impossible execution path**:

1. **User opens settings** → Looks for UID display toggle → **Nothing visible
   (Issue #1)**
2. **User manually edits storage** → Writes `quickTabShowDebugId: true` to
   `storage.local` → CreateHandler reads from `storage.sync` → **Never found
   (Issue #3)**
3. **Developer patches CreateHandler** → Reads from correct location → Gets
   `true` → Passes to QuickTabWindow → TitlebarBuilder creates element →
   **Element positioned wrong or clipped (Issue #4)**
4. **Developer fixes CSS** → Element visible → **But only in dev build with
   manual storage edits, never accessible to users (Issue #1 + #2)**
5. **Developer adds UI checkbox** → User can toggle → Doesn't save to storage →
   **No persistence (Issue #2)**

**Every possible path to enable the feature is blocked by at least one critical
issue.**

Result: Feature is 50% implemented (backend code exists) but 0% functional (no
user-facing access).

---

<scope>
**Modify:**
- `sidebar/settings.html` (add UID display checkbox to Advanced tab)
- `sidebar/settings.js` (add setting to DEFAULT_SETTINGS, gatherSettingsFromForm, loadSettings)
- `src/features/quick-tabs/handlers/CreateHandler.js` (fix storage API and key structure)
- `src/features/quick-tabs/window/TitlebarBuilder.js` (add marginLeft: auto to UID element styles)
- Optionally: Add storage.onChanged listener for dynamic updates

**Do NOT Modify:**

- `src/features/quick-tabs/index.js` (QuickTabsManager core unchanged)
- `background.js` (no background changes needed)
- `src/core/config.js` (CONSTANTS.QUICK_TAB_SETTINGS_KEY can stay but is not
  used correctly) </scope>

---

## Fix Required (Comprehensive Solution Strategy)

The UID display feature requires **coordinated implementation across all five
missing pieces**:

### Fix for Issue #1: Add Settings UI Checkbox

Add checkbox to Advanced tab in settings.html:

- Insert new checkbox after "Enable debug mode" checkbox
- Use same HTML structure as existing checkboxes for consistency
- Label: "Show Quick Tab UIDs (Debug Mode)" with helper text
- ID: `quickTabShowDebugId` to match backend code expectations

**Where to Insert:**

In Advanced tab section, after the "Enable debug mode" checkbox group and before
the "Clear Quick Tab Storage" button section. Follow existing checkbox pattern
from other tabs.

**Helper Text Suggestion:**

"Display unique identifier in Quick Tab titlebar for debugging. Developer
feature."

### Fix for Issue #2: Add Settings Storage Logic

Add setting to all three settings.js locations:

**In DEFAULT_SETTINGS object:** Add field `quickTabShowDebugId: false` with
other Quick Tab settings

**In gatherSettingsFromForm() function:** Add line to read checkbox state:
`quickTabShowDebugId: document.getElementById('quickTabShowDebugId').checked`

**In loadSettings() function:** Add line to set checkbox from storage:
`document.getElementById('quickTabShowDebugId').checked = items.quickTabShowDebugId`

**Why This Works:**

Follows exact same pattern as all other checkbox settings. No special handling
needed. The `saveSettings()` function already handles writing
`gatherSettingsFromForm()` result to storage.

### Fix for Issue #3: Unify Storage Location and Key

Change CreateHandler to match settings UI storage pattern:

**Current (broken) approach:**

- Reads from `browser.storage.sync`
- Looks for nested object `quick_tab_settings.quickTabShowDebugId`

**Fixed approach:**

- Read from `browser.storage.local` (same as settings UI)
- Read individual key `quickTabShowDebugId` directly
- Use same pattern as other Quick Tab settings

**Implementation Strategy:**

Change `_loadDebugIdSetting()` method to use `browser.storage.local.get()` with
individual key lookup instead of nested object access. Follow pattern used by
ConfigManager.load() for other settings.

**Alternative (More Complex):**

Migrate ALL Quick Tab settings to use nested object under
`CONSTANTS.QUICK_TAB_SETTINGS_KEY` in `storage.sync`. This would require
refactoring settings.js to write settings as nested object and changing all
settings reads throughout codebase. **Not recommended** due to scope creep.

### Fix for Issue #4: Add Missing CSS Property

Add `marginLeft: 'auto'` to TitlebarBuilder.\_createDebugIdElement() inline
styles:

**Property must appear in styles object** alongside existing properties:

- Before or after `marginRight` (order doesn't matter functionally)
- Same format as other properties: `marginLeft: 'auto'`

**Verify element insertion order:** Ensure UID element is appended to controls
container **before** control buttons, so auto margin can push it to right edge
while buttons follow immediately after.

**Why This Works:**

Flexbox auto margins consume available free space. With `marginLeft: 'auto'`,
the UID element is pushed to the right edge of its container, immediately before
buttons. This is standard flexbox right-alignment pattern per MDN documentation.

### Fix for Issue #5: Add Dynamic Setting Updates (Optional Enhancement)

Implement `storage.onChanged` listener in CreateHandler or QuickTabsManager:

**Strategy:**

- Listen for `quickTabShowDebugId` changes in storage
- When changed, iterate all existing QuickTabWindow instances
- Call new method `updateDebugIdDisplay(showDebugId)` on each window
- Method adds or removes UID element from titlebar dynamically

**Why This Is Optional:**

Feature will work without this for newly created Quick Tabs. User can close and
recreate Quick Tabs to see setting changes. Dynamic updates are polish, not core
functionality.

**If Implemented:**

Follow same pattern as console log filter live updates in settings.js
(`refreshLiveConsoleFiltersInAllTabs()` function). This demonstrates the correct
message passing and update broadcast approach.

---

<acceptance_criteria> **Issue #1 Fixed:**

- [ ] Checkbox visible in Advanced tab of settings UI
- [ ] Checkbox labeled clearly as UID display toggle
- [ ] Checkbox follows same visual style as other checkboxes

**Issue #2 Fixed:**

- [ ] Setting appears in DEFAULT_SETTINGS object
- [ ] gatherSettingsFromForm() collects checkbox value
- [ ] loadSettings() populates checkbox from storage
- [ ] Toggling checkbox + Save → value persists to storage
- [ ] Reloading settings UI → checkbox shows saved state

**Issue #3 Fixed:**

- [ ] CreateHandler reads from browser.storage.local (not sync)
- [ ] CreateHandler reads individual key (not nested object)
- [ ] Setting written by UI is successfully read by CreateHandler
- [ ] Console logs show correct setting value loaded

**Issue #4 Fixed:**

- [ ] UID element has `marginLeft: 'auto'` in inline styles
- [ ] Element positioned in titlebar right corner, left of buttons
- [ ] Element visible when setting enabled and element created

**Issue #5 Fixed (if implemented):**

- [ ] Toggling setting → existing Quick Tabs update immediately
- [ ] No Quick Tab recreation required to see changes
- [ ] storage.onChanged listener handles updates

**Integration Test (End-to-End):**

1. Fresh browser start → Open settings → Advanced tab → See UID checkbox
2. Enable checkbox → Save Settings → Success message
3. Create Quick Tab → UID displays in titlebar at top-right, left of buttons
4. Hover over UID → Full UID string in tooltip
5. UID text is selectable/copyable
6. Disable checkbox → Save → Create new Quick Tab → No UID displayed
7. Reload browser → Settings show checkbox still disabled → Quick Tabs still
   have no UID

**Edge Cases:**

- [ ] Setting persists across browser restarts
- [ ] Multiple Quick Tabs all show/hide UIDs based on setting
- [ ] Changing setting while Quick Tabs open (if Issue #5 fixed) updates all
      windows
- [ ] Setting value correct after "Reset to Defaults" clicked
      </acceptance_criteria>

---

## Supporting Context

<details>
<summary>Storage API Location Mismatch Technical Details</summary>

**MDN Documentation on Storage Areas:**

Firefox WebExtensions provide two separate storage areas:

**storage.local:**

> "Similar to window.localStorage, but asynchronous. Stores data locally only,
> not synced across devices. Recommended for most extensions."

**storage.sync:**

> "Stores data that is synced using Firefox Sync. Subject to strict quotas:
> 102KB total, 8KB per item, 512 items max. Writes exceeding quota may fail
> silently."

**Key Point:** These are **completely separate storage namespaces**. Data
written to `storage.local` is not accessible via `storage.sync` and vice versa.

**Settings UI Pattern:** All 30+ existing settings are written to
`storage.local` as individual keys:

```
{
  quickTabKey: 'q',
  quickTabMaxWindows: 3,
  debugMode: false,
  // etc.
}
```

**CreateHandler Pattern:** Attempts to read from `storage.sync` under nested
object:

```
// Looking for:
{
  quick_tab_settings: {
    quickTabShowDebugId: true
  }
}
```

**Why They Never Connect:**

Even if settings UI wrote to
`storage.local.quick_tab_settings.quickTabShowDebugId`, CreateHandler reads from
`storage.sync.quick_tab_settings.quickTabShowDebugId`. Different storage area =
no data found.

**Correct Fix:**

CreateHandler must read from `storage.local` with individual key lookup to match
settings UI pattern.

</details>

<details>
<summary>Flexbox Auto Margin Positioning Behavior</summary>

**MDN CSS Flexbox Documentation:**

> "Auto margins can be used to align items in a flex container. Any positive
> free space is distributed to auto margins. If you give a flex item
> `margin-left: auto`, it will push all following items to the right."

**Visual Layout Explanation:**

Titlebar structure:

```
<div style="display: flex;">
  <div>Drag Handle</div>
  <img>Favicon</img>
  <div style="flex: 1;">Title Text</div>  ← Expands to fill space
  <div>  ← Controls Container
    <span style="marginLeft: auto;">UID</span>  ← Pushed to right edge
    <button>Open</button>
    <button>Close</button>
  </div>
</div>
```

**How marginLeft: auto Works:**

1. Title element uses `flex: 1` to take all available horizontal space
2. Controls container sits at natural flow position after title
3. Inside controls container, UID element with `marginLeft: auto` consumes free
   space on its left
4. This pushes UID to the right edge of its container
5. Buttons follow immediately after UID
6. Result: `[Title......................................] [UID][Button][Button]`

**Without marginLeft: auto:**

UID sits at natural flow (left edge of controls container):

```
[Title......................................] [UID][Button][Button]
                                               ↑ May be pushed outside visible area
                                                 or clipped by title overlap
```

**Current Code Has:**

- `marginRight: '8px'` ← Spacing after UID, before buttons ✅
- Missing `marginLeft: 'auto'` ← Positioning to right edge ❌
</details>

<details>
<summary>Feature Implementation Checklist Comparison</summary>

**Required Components for Functional Feature:**

| Component                       | Specified in Guide | Exists in v1.6.3.2 | Status               |
| ------------------------------- | ------------------ | ------------------ | -------------------- |
| Settings UI checkbox            | ✅ Yes             | ❌ No              | **Missing**          |
| Settings storage write          | ✅ Yes             | ❌ No              | **Missing**          |
| Settings storage read           | ✅ Yes             | ⚠️ Partial         | **Wrong location**   |
| Setting passed to window        | ✅ Yes             | ✅ Yes             | **Implemented**      |
| TitlebarBuilder creates element | ✅ Yes             | ✅ Yes             | **Implemented**      |
| Element CSS positioning         | ✅ Yes             | ⚠️ Partial         | **Missing property** |
| Element DOM insertion           | ✅ Yes             | ✅ Yes             | **Implemented**      |
| Dynamic updates                 | ⚠️ Optional        | ❌ No              | **Not implemented**  |

**Completion Percentage:** 37.5% (3 of 8 components fully working)

**User-Facing Percentage:** 0% (no UI access, feature completely disabled)

</details>

<details>
<summary>Settings.js DEFAULT_SETTINGS Object Structure</summary>

The DEFAULT_SETTINGS object defines 30+ settings across categories:

**Copy URL Settings (6 keys):**

- copyUrlKey, copyUrlCtrl, copyUrlAlt, copyUrlShift
- copyTextKey, copyTextCtrl, copyTextAlt, copyTextShift
- openNewTabKey, etc.

**Quick Tab Settings (11 keys):**

- quickTabKey, quickTabCtrl, quickTabAlt, quickTabShift
- quickTabCloseKey, quickTabMaxWindows
- quickTabDefaultWidth, quickTabDefaultHeight
- quickTabPosition, quickTabCustomX, quickTabCustomY
- quickTabCloseOnOpen, quickTabEnableResize

**Appearance Settings (13 keys):**

- showNotification, notifDisplayMode
- tooltipColor, tooltipDuration, tooltipAnimation
- notifColor, notifDuration, notifPosition, notifSize
- notifBorderColor, notifBorderWidth, notifAnimation
- darkMode, debugMode, menuSize

**Missing:**

- quickTabShowDebugId ❌

**Where It Should Be Added:**

In Quick Tab Settings section, after `quickTabEnableResize` and before
appearance settings. Default value: `false` (feature disabled by default per
spec).

</details>

---

**Priority:** Critical (Feature Completely Non-Functional) | **Dependencies:**
Settings UI system, CreateHandler initialization, TitlebarBuilder rendering |
**Complexity:** Medium (requires multi-file coordination but each piece is
straightforward)

**Estimated Fix Time:** 2-3 hours (Issues #1-4), +1 hour for Issue #5 if
implemented

**Recommended Fix Order:**

1. Issue #1 (add checkbox) + Issue #2 (add storage logic) → Single cohesive
   settings UI change
2. Issue #3 (fix storage location) → Enable backend to read frontend writes
3. Issue #4 (CSS property) → Make element visible when created
4. Issue #5 (dynamic updates) → Optional polish for better UX

**Testing Strategy:**

After each fix, verify the specific issue is resolved before moving to next:

- After #1+#2: Checkbox visible, setting persists, can toggle and save
- After #3: CreateHandler console logs show correct value loaded from storage
- After #4: Create Quick Tab with setting enabled → UID visible in titlebar
- After #5: Toggle setting → existing Quick Tabs update without recreation
