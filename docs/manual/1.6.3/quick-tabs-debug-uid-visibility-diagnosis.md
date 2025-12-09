# Quick Tabs Debug UID Display - Visibility Investigation Report

**Extension Version:** v1.6.3.2+ | **Date:** 2025-11-29 | **Scope:** Debug why
UID display not visible in titlebar

---

## Problem Summary

The Debug UID Display feature was implemented in v1.6.3.2 to show Quick Tab
unique identifiers in the titlebar (top-right corner, left of control buttons).
However, testing reveals the UID element is **not visible** in rendered Quick
Tabs. The feature includes correct implementation in TitlebarBuilder.js and
window.js, with settings loading in CreateHandler.js, but the UI element does
not appear when the setting is enabled.

---

## Root Cause Analysis

After comprehensive code review and web research, **three potential root
causes** have been identified:

### Issue #1: Debug UID Element Insertion Order (MOST LIKELY)

**File:** `src/features/quick-tabs/window/TitlebarBuilder.js`  
**Location:** `_createRightSection()` method (lines ~429-502)  
**Issue:** UID element is appended to `controls` container, but CSS flexbox
layout may not position it correctly due to insertion order.

**Current Code Pattern:**

```javascript
_createRightSection() {
  const controls = createElement('div', {
    style: {
      display: 'flex',
      gap: '8px',
      alignItems: 'center'
    }
  });

  // UID element added FIRST
  this.debugIdElement = this._createDebugIdElement();
  if (this.debugIdElement) {
    controls.appendChild(this.debugIdElement);
  }

  // Then buttons added after
  controls.appendChild(openBtn);
  controls.appendChild(this.soloButton);
  controls.appendChild(this.muteButton);
  controls.appendChild(minimizeBtn);
  controls.appendChild(closeBtn);

  return controls;
}
```

**Why This May Fail:**

The UID element uses `marginRight: '8px'` for spacing but **does NOT use
`marginLeft: 'auto'`** as specified in the implementation guide. This means:

1. UID element is positioned as first child in flex container
2. Buttons are appended after, pushing UID to far left of controls section
3. Without `marginLeft: 'auto'`, UID doesn't push to right edge before buttons
4. UID may be hidden by title element overlap or positioned outside visible area

**Evidence from Code:**

```javascript
_createDebugIdElement() {
  // ...
  const debugId = createElement('span', {
    style: {
      fontSize: '10px',
      color: '#888',
      fontFamily: 'monospace',
      marginRight: '8px',  // ✅ Has right margin
      // ❌ MISSING: marginLeft: 'auto'
      userSelect: 'text',
      cursor: 'default',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      maxWidth: '100px'
    }
  }, displayId);

  return debugId;
}
```

**Fix Required:**

Add `marginLeft: 'auto'` to UID element's inline styles to push it to the right
edge immediately before buttons, as specified in original implementation guide.

---

### Issue #2: Settings Storage Key Mismatch

**File:** `src/features/quick-tabs/handlers/CreateHandler.js`  
**Location:** `_loadDebugIdSetting()` method (lines ~58-68)  
**Issue:** Setting loaded from `browser.storage.sync` using
`CONSTANTS.QUICK_TAB_SETTINGS_KEY`, but setting may be stored in different
location or under different key.

**Current Code:**

```javascript
async _loadDebugIdSetting() {
  try {
    const settingsKey = CONSTANTS.QUICK_TAB_SETTINGS_KEY;
    const result = await browser.storage.sync.get(settingsKey);
    const settings = result[settingsKey] || {};
    this.showDebugIdSetting = settings.quickTabShowDebugId ?? false;
    console.log('[CreateHandler] Loaded showDebugId setting:', this.showDebugIdSetting);
  } catch (err) {
    console.warn('[CreateHandler] Failed to load showDebugId setting:', err);
    this.showDebugIdSetting = false;
  }
}
```

**Why This May Fail:**

1. `CONSTANTS.QUICK_TAB_SETTINGS_KEY` may not match actual settings key used by
   settings page
2. Setting may be stored in `browser.storage.local` instead of
   `browser.storage.sync`
3. Setting key name may differ (`quickTabShowDebugId` vs `quickTabShowDebugIds`)
4. Settings page may not be saving setting at all

**Evidence from Web Research:**

From Mozilla documentation (web:6):

> "Sync storage is just a normal storage that's synced to other devices once in
> a while. So if you are offline or without Firefox Account, it will behave just
> like a normal storage.local."

However, sync storage has strict limits:

- 102,400 bytes total
- 8,192 bytes per item
- 512 items max

If Quick Tab settings exceed quota, writes may silently fail.

**Fix Required:**

1. Verify `CONSTANTS.QUICK_TAB_SETTINGS_KEY` matches settings page storage key
2. Add fallback to `browser.storage.local` if sync storage fails
3. Log actual storage read result for debugging
4. Ensure settings page saves to same storage area (sync vs local)

---

### Issue #3: Element Hidden by CSS Properties

**File:** `src/features/quick-tabs/window/TitlebarBuilder.js`  
**Location:** `_createDebugIdElement()` method (lines ~390-418)  
**Issue:** CSS properties may cause element to be rendered but not visible.

**Problematic CSS Properties:**

```javascript
style: {
  overflow: 'hidden',           // May clip content if container too small
  textOverflow: 'ellipsis',     // May hide text if maxWidth exceeded
  maxWidth: '100px',            // Constraint may be too restrictive
  whiteSpace: 'nowrap'          // Prevents wrapping but may cause overflow
}
```

**Why This May Fail:**

1. `maxWidth: '100px'` combined with `overflow: 'hidden'` may hide entire
   element if flex layout compresses it
2. Parent container (`controls` div) may have `overflow: hidden` preventing UID
   from rendering
3. `color: '#888'` is very subtle gray - may blend into background on certain
   themes
4. `fontSize: '10px'` is small - may be nearly invisible on high-DPI displays

**Evidence from Web Research:**

From CSS-Tricks flexbox guide (web:4):

> "margin auto won't work for inline elements (span, a, img etc). Margin auto
> makes even margins on the 'inline' axis, which is usually left and right."

The UID element is a `<span>` (inline by default). Combined with flexbox parent,
auto margins should work, but without `marginLeft: 'auto'` specified, the
element won't push itself to the right.

From W3Schools CSS display property (web:8):

> "When using display: none; the element is completely hidden from the document
> flow and does not take up any space."

If the element's computed display is somehow `none`, it would be invisible.
However, code doesn't set `display: none`, so this is unlikely.

**Fix Required:**

1. Add `marginLeft: 'auto'` to push element right (addresses Issue #1)
2. Increase `fontSize` to `11px` or `12px` for better visibility
3. Test `color` value against both light/dark backgrounds
4. Consider removing `maxWidth` constraint or increasing to `150px`
5. Add visible border for debugging: `border: '1px solid #f00'` (temporary)

---

## Implementation Discrepancy

**Critical Finding:** The implementation guide specified `marginLeft: 'auto'` as
the key CSS property for positioning the UID element to the right edge of the
titlebar. This property is **missing** from the actual implementation.

**From Implementation Guide (quick-tabs-debug-uid-display-feature.md):**

```javascript
style: {
  fontFamily: 'monospace',
  fontSize: '10px',
  color: '#888',
  padding: '2px 6px',
  marginLeft: 'auto',  // ← KEY PROPERTY FOR RIGHT POSITIONING
  marginRight: '8px',
  whiteSpace: 'nowrap',
  userSelect: 'all',
  cursor: 'default'
}
```

**Actual Implementation (TitlebarBuilder.js):**

```javascript
style: {
  fontSize: '10px',
  color: '#888',
  fontFamily: 'monospace',
  marginRight: '8px',
  // ❌ MISSING: marginLeft: 'auto'
  userSelect: 'text',  // Also changed from 'all' to 'text'
  cursor: 'default',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '100px'
}
```

**Impact:** Without `marginLeft: 'auto'`, the UID element stays at the natural
flow position (immediately after title, before it's appended to controls
container), which may place it outside the visible area or overlapped by other
elements.

---

## Testing Evidence Required

To diagnose the actual root cause, the following debugging steps are needed:

### Step 1: Verify Setting is Enabled

1. Open extension settings page
2. Navigate to Quick Tabs tab
3. Enable "Show Quick Tab UIDs (Debug Mode)" checkbox
4. Save settings
5. Log browser console output from CreateHandler:
   `[CreateHandler] Loaded showDebugId setting: true`
6. If false, setting is not being saved or loaded correctly (Issue #2)

### Step 2: Verify Element is Created

1. Create Quick Tab with setting enabled
2. Open browser DevTools (F12)
3. Inspect Quick Tab titlebar DOM structure
4. Search for element with class `quick-tab-debug-id`
5. If element exists but not visible → CSS issue (Issue #1 or #3)
6. If element missing → CreateHandler not passing `showDebugId` or
   TitlebarBuilder not creating it

### Step 3: Verify Element Positioning

If element exists in DOM:

1. Use DevTools "Inspect Element" to view computed styles
2. Check `position`, `display`, `visibility`, `opacity` values
3. Check parent container's `overflow` property
4. Check if element's bounding box has width/height > 0
5. Temporarily add `border: '5px solid red'` to UID element styles for
   visibility test
6. Check if element is rendered outside visible viewport (use DevTools layers
   panel)

### Step 4: Verify Flexbox Layout

1. Inspect `controls` container (parent of UID element)
2. Verify `display: flex` is active
3. Check flex item order (UID should be first child if marginLeft: auto not
   used)
4. Check if title element or other elements overlap UID element
5. Test with `justify-content: flex-end` on controls container (temporary debug)

---

<scope>
**Modify:**
- `src/features/quick-tabs/window/TitlebarBuilder.js` (_createDebugIdElement method - add marginLeft: auto)
- Possibly `src/features/quick-tabs/handlers/CreateHandler.js` (verify storage key and add fallback)
- Possibly settings page HTML/JS (verify storage write)

**Do NOT Modify:**

- `src/features/quick-tabs/index.js` (QuickTabsManager core)
- `background.js` (no changes needed)
- `src/features/quick-tabs/window.js` (already passes showDebugId correctly)
  </scope>

---

## Recommended Fix Priority

### Priority 1 (CRITICAL - P0): Add marginLeft: auto to UID Element

**File:** `src/features/quick-tabs/window/TitlebarBuilder.js`  
**Method:** `_createDebugIdElement()`  
**Change:** Add `marginLeft: 'auto'` to inline styles object

This single CSS property is the most likely root cause based on implementation
guide discrepancy and flexbox layout behavior.

### Priority 2 (HIGH - P1): Verify Settings Storage

**File:** `src/features/quick-tabs/handlers/CreateHandler.js`  
**Method:** `_loadDebugIdSetting()`  
**Changes:**

1. Log full storage read result (not just final boolean)
2. Add fallback to `browser.storage.local` if sync fails
3. Verify `CONSTANTS.QUICK_TAB_SETTINGS_KEY` value
4. Cross-reference with settings page storage write code

### Priority 3 (MEDIUM - P2): Improve Visibility

**File:** `src/features/quick-tabs/window/TitlebarBuilder.js`  
**Method:** `_createDebugIdElement()`  
**Changes:**

1. Increase `fontSize` from `10px` to `11px` or `12px`
2. Test `color` value on both light/dark themes
3. Consider brighter color like `#aaa` or `#bbb` for dark mode
4. Optionally add subtle background for contrast:
   `background: 'rgba(0,0,0,0.1)'`

---

<acceptance_criteria> **After Fix Applied:**

- [ ] UID display element visible in titlebar when setting enabled
- [ ] Element positioned top-right corner, immediately LEFT of Open in Tab
      button
- [ ] Element shows truncated UID: `[qt-123-17...]` format
- [ ] Hover tooltip shows full UID string
- [ ] Text is selectable/copyable
- [ ] No console errors or warnings
- [ ] Setting persists across browser restarts
- [ ] Element not created when setting disabled (no hidden element)

**Manual Test:**

1. Enable setting → Save → Reload extension
2. Create Quick Tab → UID visible in titlebar
3. Verify positioning (right corner, left of buttons)
4. Hover over UID → Full UID in tooltip
5. Select/copy UID text → Verify copied correctly </acceptance_criteria>

---

## Additional Research Context

<details>
<summary>Flexbox marginLeft: auto Behavior</summary>

From CSS-Tricks and DEV Community articles (web:4, web:10):

> "Auto margins have precedence over justify-content. In other words, auto
> margins will 'eat up' any free space in the flex container's main axis."

In a horizontal flexbox:

- `marginLeft: 'auto'` pushes element to far right
- `marginRight: 'auto'` pushes element to far left
- Both set → centers element

Expected behavior with `marginLeft: 'auto'`:

```
[Title (flex: 1)]_______________[UID (marginLeft: auto)] [Button] [Button]
```

Without `marginLeft: 'auto'`:

```
[Title (flex: 1)] [UID] [Button] [Button]
```

Second layout may cause UID to be pushed outside visible area by title's
`flex: 1` expansion.

</details>

<details>
<summary>Browser Storage Sync vs Local</summary>

From Mozilla forums and Chrome documentation (web:6, web:25):

**Sync Storage:**

- Syncs across devices logged into same account
- Strict limits: 102KB total, 8KB per item, 512 items max
- Fallback to local behavior if offline/no account
- Quota exceeded → silent failure

**Local Storage:**

- Device-specific, not synced
- Much larger quota: 5MB+ (varies by browser)
- More reliable for large settings objects

**Recommendation:** Use `browser.storage.local` for Quick Tab settings to avoid
quota issues.

</details>

---

**Priority:** High (Feature Not Working) | **Dependencies:** None |
**Complexity:** Low (CSS fix) to Medium (if storage issue)

**Estimated Fix Time:** 15-30 minutes (Priority 1 only), 1-2 hours (all
priorities)
