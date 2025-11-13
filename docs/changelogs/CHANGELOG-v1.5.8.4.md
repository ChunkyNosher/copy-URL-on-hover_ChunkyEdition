# Changelog - Version 1.5.8.4

**Release Date:** 2025-11-12  
**Status:** 🔴 CRITICAL BUG FIX - URL Detection Failure

---

## 🔧 Critical Bug Fixes

### Issue: URL Detection Failure Blocking All Keyboard Shortcuts

**Symptoms:**

- Only "Copy Text" keyboard shortcut was working
- "Copy URL", "Quick Tabs", and "Open in New Tab" shortcuts were completely broken
- Features appeared to fail silently with no error messages

**Root Causes Identified:**

1. **Overly Restrictive Shortcut Handler** (`src/content.js`)
   - Global `if (!hoveredLink) return;` check at the top of `setupKeyboardShortcuts()`
   - Exited entire handler before checking any shortcuts
   - "Copy Text" worked by accident when `hoveredElement` was set from a previous hover

2. **URL Detection Bug** (`src/features/url-handlers/index.js`)
   - Parent element traversal checked `parent.href` without verifying `parent.tagName === 'A'`
   - Returned invalid href values from non-anchor elements
   - Caused URL detection to fail on many legitimate links

3. **State Management Issue** (`src/content.js`)
   - `setupHoverDetection()` only set state when URL was found
   - `currentHoveredElement` was never set when URL detection failed
   - Created incomplete state that broke "Copy Text" functionality

---

## ✅ Fixes Applied

### Fix 1: Refactored setupKeyboardShortcuts() - Per-Shortcut URL Checks

**File:** `src/content.js`  
**Lines:** 164-195

**Before:**

```javascript
function setupKeyboardShortcuts() {
  document.addEventListener("keydown", async function (event) {
    const hoveredLink = stateManager.get("currentHoveredLink");
    const hoveredElement = stateManager.get("currentHoveredElement");

    if (!hoveredLink) return; // ← TOO RESTRICTIVE!

    // All shortcut checks below...
  });
}
```

**After:**

```javascript
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', async function(event) {
    const hoveredLink = stateManager.get('currentHoveredLink');
    const hoveredElement = stateManager.get('currentHoveredElement');

    // Don't exit early - some shortcuts don't need a URL!

    // Check for copy URL shortcut (needs URL)
    if (checkShortcut(event, CONFIG.copyUrlKey, ...)) {
      if (!hoveredLink) return; // Only check for this specific shortcut
      event.preventDefault();
      await handleCopyURL(hoveredLink);
    }

    // Check for copy text shortcut (doesn't need URL)
    else if (checkShortcut(event, CONFIG.copyTextKey, ...)) {
      if (!hoveredElement) return; // Only needs element
      event.preventDefault();
      await handleCopyText(hoveredElement);
    }

    // Similar per-shortcut checks for Quick Tab and Open in New Tab...
  });
}
```

**Impact:**

- ✅ Each shortcut now has its own requirement check
- ✅ "Copy Text" no longer requires URL detection to succeed
- ✅ URL-dependent shortcuts (Copy URL, Quick Tab, Open Tab) still validate URL exists
- ✅ No functionality loss, only bug elimination

---

### Fix 2: Improved URL Detection - Proper Anchor Tag Validation

**File:** `src/features/url-handlers/index.js`  
**Lines:** 47-69

**Before:**

```javascript
// Check parents for href (up to 20 levels)
let parent = element.parentElement;
for (let i = 0; i < 20; i++) {
  if (!parent) break;
  if (parent.href) return parent.href; // ← BUG: doesn't check tagName
  parent = parent.parentElement;
}
```

**After:**

```javascript
// Check parents for href (up to 20 levels)
let parent = element.parentElement;
for (let i = 0; i < 20; i++) {
  if (!parent) break;
  if (parent.tagName === "A" && parent.href) {
    // ← FIX: check tagName
    return parent.href;
  }
  parent = parent.parentElement;
}
```

**Impact:**

- ✅ Only returns href from valid `<a>` anchor tags
- ✅ Prevents returning invalid href attributes from other elements (e.g., `<use href="#icon">` in SVG)
- ✅ Significantly improves URL detection success rate
- ✅ Works correctly with nested elements like `<a><span>Click me</span></a>`

---

### Fix 3: Always Set Element State on Hover

**File:** `src/content.js`  
**Lines:** 133-159

**Before:**

```javascript
function setupHoverDetection() {
  document.addEventListener("mouseover", function (event) {
    const url = urlRegistry.findURL(element, domainType);

    if (url) {
      // ← ONLY sets state if URL found!
      stateManager.setState({
        currentHoveredLink: url,
        currentHoveredElement: element,
      });

      eventBus.emit(Events.HOVER_START, { url, element, domainType });
    }
  });
}
```

**After:**

```javascript
function setupHoverDetection() {
  document.addEventListener("mouseover", function (event) {
    const url = urlRegistry.findURL(element, domainType);

    // Always set element, URL can be null
    stateManager.setState({
      currentHoveredLink: url || null, // Set to null if not found
      currentHoveredElement: element,
    });

    if (url) {
      eventBus.emit(Events.HOVER_START, { url, element, domainType });
    }
  });
}
```

**Impact:**

- ✅ `currentHoveredElement` always set on mouseover, regardless of URL detection
- ✅ "Copy Text" now works reliably even when URL detection fails
- ✅ State is explicit: `null` instead of undefined
- ✅ Only emits `HOVER_START` event when URL is actually found

---

## 🧪 Testing Results

All keyboard shortcuts now work correctly:

### ✅ Test 1: Copy URL (Main Feature)

- Hover over a link → Press configured Copy URL key (default: `Y`)
- ✅ URL copied to clipboard
- ✅ Notification appears

### ✅ Test 2: Copy Text

- Hover over a link → Press configured Copy Text key (default: `T`)
- ✅ Link text copied to clipboard (works with or without URL detection)
- ✅ Notification appears

### ✅ Test 3: Quick Tab

- Hover over a link → Press configured Quick Tab key (default: `Q`)
- ✅ Quick Tab created successfully
- ✅ Notification appears

### ✅ Test 4: Open in New Tab

- Hover over a link → Press configured Open Tab key (default: `W`)
- ✅ Link opens in new tab
- ✅ Notification appears

### ✅ Test 5: Complex Link Types

- Direct `<a>` tags: ✅ Working
- Nested elements (`<a><span>text</span></a>`): ✅ Working
- Complex sites (Twitter, Reddit, GitHub): ✅ Working
- Generic sites: ✅ Working

---

## 📦 Version Changes

### Updated Files:

1. **src/content.js** - setupKeyboardShortcuts() and setupHoverDetection()
2. **src/features/url-handlers/index.js** - URLHandlerRegistry.findURL()
3. **manifest.json** - Version bumped to 1.5.8.4
4. **package.json** - Version bumped to 1.5.8.4, copy-assets script updated
5. **README.md** - Version updated to 1.5.8.4

### Build Output:

- ✅ `dist/content.js` - Successfully bundled (Rollup)
- ✅ `dist/manifest.json` - Version 1.5.8.4
- ✅ All assets copied correctly

---

## 🛡️ Security Impact

**No new security issues introduced.**

All changes are:

- Defensive programming improvements (null checks)
- Logic corrections (proper tagName validation)
- State management enhancements (explicit null handling)

No new permissions, no new external dependencies, no new attack surface.

---

## 🔮 Prevention Measures

To prevent similar bugs in the future:

1. **Added Per-Feature Guards:** Each keyboard shortcut now validates its own requirements
2. **Improved Type Safety:** Explicit null checks instead of relying on undefined
3. **Better URL Detection:** Proper HTML element validation (tagName checks)
4. **State Consistency:** Always set element state, even when URL is null

---

## 📚 Related Documentation

- **Bug Report:** `docs/manual/critical-url-detection-fix.md`
- **Previous Version:** CHANGELOG-v1.5.8.3.md
- **Implementation:** IMPLEMENTATION-SUMMARY-v1.5.8.4.md (to be created)

---

## 🚀 Upgrade Path

**From v1.5.8.3 → v1.5.8.4:**

- No configuration changes required
- No data migration needed
- No user action required
- Extension will auto-update via Firefox Add-ons or GitHub releases

**Recommended Action:**

- Immediate upgrade recommended (critical bug fix)
- All users affected by broken keyboard shortcuts should update ASAP

---

**Document Version:** 1.0  
**Last Updated:** 2025-11-12  
**Priority:** 🔴 CRITICAL - Restores all primary features
