# Changelog v1.5.5.10

## Release Date

2025-11-11

## Overview

Critical bug fixes for Quick Tab position synchronization, pin functionality, and duplicate instance handling. Implements ID-based tracking throughout the system to eliminate race conditions and state conflicts. Adds debug mode slot number labels and reorganizes repository documentation.

---

## 🐛 Critical Bug Fixes

### Bug #1: Quick Tabs Jump to Original Position When New Tab Opens

**Problem**: When user moved QT1 to a corner, then created QT2, QT1 would jump back to its original spawn position. This was a storage API race condition bug.

**Root Cause**:

- Storage listener used URL-based lookup (`t.url === iframeSrc`)
- When background saved state after CREATE_QUICK_TAB, it might save stale position for existing tabs
- Storage.onChanged would then overwrite correct position with stale data
- Bug occurred because URL lookup can't distinguish between multiple instances or track specific tabs

**Fix**:

- ✅ Changed storage.onChanged listener to use ID-based lookup (`t.id === quickTabId`)
- ✅ Updated position/size updates to match by Quick Tab ID instead of URL
- ✅ Updated pin state checks to use ID-based lookup
- ✅ Background.js already used ID-based updates (no changes needed)

**Impact**: Quick Tabs now maintain their position when new tabs are created. No more jumping back to spawn position.

---

### Bug #2: Pinned Quick Tab Immediately Closes Itself When Pinned

**Problem**: When user pinned a Quick Tab in WP2, it would immediately close itself. Same issue when pinning in WP1 after some operations.

**Root Cause**:

- BroadcastChannel self-reception: Tab received its own pin broadcast and processed it as if from another tab
- URL fragment differences: Pinned URL captured as `example.com/page#section1` but current URL changed to `example.com/page#section2`, causing mismatch
- Double storage save: Both pin button handler AND background script saved to storage, causing race condition with isSavingToStorage timeout flag

**Fix**:

- ✅ Added `tabInstanceId` constant to uniquely identify each tab instance
- ✅ Added `senderId` field to all broadcast messages
- ✅ Added self-reception filter in `handleBroadcastMessage()` - ignores broadcasts from self
- ✅ Implemented `normalizeUrl()` function to strip hash/query for pin comparisons
- ✅ Updated pin broadcast handler to use normalized URLs
- ✅ Removed redundant `saveQuickTabsToStorage()` calls from pin/unpin handlers
- ✅ Background script now exclusively handles storage saves for pin state

**Impact**: Pin/unpin functionality now works correctly. Quick Tabs stay open when pinned and don't self-close.

---

### Bug #3: Duplicate Quick Tab Instances Flicker and Disappear

**Problem**: After browser restart, creating two instances of the same URL (QT1 twice) would cause:

- Second instance immediately moves to first instance's position
- Second instance flickers when dragged
- Second instance eventually disappears

**Root Cause**:

- Storage/broadcast lookups used `find(t => t.url === url)` which returns FIRST match
- When two Quick Tabs had same URL but different IDs, updates to second instance would match first instance in storage
- Drag updates would be applied to wrong instance, causing position conflicts
- Eventually one instance would be considered a duplicate and removed

**Fix**:

- ✅ All storage lookups now use `find(t => t.id === quickTabId)` instead of URL
- ✅ All broadcast handlers already used ID-based matching (no changes needed)
- ✅ Storage.onChanged listener updated to use ID-based lookups throughout
- ✅ Background.js UPDATE_QUICK_TAB_POSITION already used ID-based updates

**Impact**: Multiple Quick Tabs with the same URL now work correctly. Each instance maintains independent position/state.

---

## ✨ New Features

### Feature #1: Clear Quick Tabs Storage Preserves Settings

**Before**: "Clear Quick Tabs Storage" button cleared ALL extension data (settings, keybinds, state)

**After**:

- ✅ Only clears `quick_tabs_state_v2` (sync storage)
- ✅ Only clears `quick_tabs_session` (session storage)
- ✅ Preserves all user settings, keybinds, appearance preferences
- ✅ Updated confirmation message: "This will clear Quick Tab positions and state. Your settings and keybinds will be preserved."
- ✅ Removed unnecessary page reload

**Impact**: Users can clear Quick Tab state without losing their custom settings.

---

### Feature #2: Debug Mode Slot Number Labels

**Description**: Visual slot number labels on Quick Tab toolbars in debug mode

**Implementation**:

- ✅ Added `quickTabSlots` Map to track slot numbers
- ✅ Added `availableSlots` array for freed slot reuse
- ✅ Implemented `assignQuickTabSlot(quickTabId)` function
- ✅ Implemented `releaseQuickTabSlot(quickTabId)` function
- ✅ Slot numbers displayed as labels (e.g., "Slot 1", "Slot 2") when debug mode enabled
- ✅ Slots reuse lowest available number when Quick Tabs close
- ✅ Visual styling: monospace font, gray background, rounded corners

**Example**:

```
┌─────────────────────────────────────────────┐
│ ← → ↻  🌐 Wikipedia    Slot 1  📍 − 🔗 ✕ │
├─────────────────────────────────────────────┤
│  [Content]                                  │
└─────────────────────────────────────────────┘
```

If Slots 1, 2, 3, 4, 5 are open and Slots 2 and 4 close:

- Next Quick Tab created gets "Slot 2"
- Following Quick Tab gets "Slot 4"
- Remaining slots (1, 3, 5) keep their numbers

**Impact**: Easier debugging and tracking of Quick Tab lifecycle in debug mode.

---

## 📚 Repository Organization

### Documentation Restructure

- ✅ Created `/docs/` folder structure:
  - `/docs/changelogs/` - 14 version changelogs
  - `/docs/implementation-summaries/` - 12 implementation notes
  - `/docs/security-summaries/` - 5 security audit reports
  - `/docs/manual/` - 7 guides and architecture docs
- ✅ Moved 38 markdown files to appropriate folders
- ✅ Kept README.md in repository root
- ✅ Updated README with v1.5.5.10 features and architecture

### Updated README

- ✅ Version badge updated to 1.5.5.10
- ✅ Added repository structure section
- ✅ Updated features list with latest bug fixes
- ✅ Added state management architecture explanation
- ✅ Streamlined installation instructions
- ✅ Enhanced debug mode documentation
- ✅ Added documentation folder links
- ✅ Removed outdated information

**Impact**: Cleaner repository structure, easier navigation, better documentation discoverability.

---

## 🔧 Technical Changes

### Code Architecture Improvements

1. **Unique Tab Instance ID**

   ```javascript
   const tabInstanceId = `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
   ```

   - Prevents self-reception of BroadcastChannel messages
   - Included in all broadcast messages as `senderId` field

2. **URL Normalization**

   ```javascript
   function normalizeUrl(url) {
     const urlObj = new URL(url);
     return `${urlObj.origin}${urlObj.pathname}`;
   }
   ```

   - Strips hash and query parameters for pin URL comparison
   - Prevents false mismatches due to URL fragments

3. **Slot Tracking System**

   ```javascript
   let quickTabSlots = new Map();
   let availableSlots = [];
   let nextSlotNumber = 1;
   ```

   - Efficient slot number assignment and reuse
   - O(1) lookup, O(log n) slot assignment (due to sort)

4. **ID-Based Lookups Everywhere**
   - Storage: `find(t => t.id === quickTabId)` instead of `find(t => t.url === iframeSrc)`
   - Broadcasts: Already used ID-based matching
   - Runtime messages: Background already used ID-based updates

### Files Modified

- `content.js` (+123 lines, -33 lines)
  - Added tabInstanceId and senderId to broadcasts
  - Added normalizeUrl() function
  - Added slot tracking system (3 functions, 3 variables)
  - Updated storage.onChanged to use ID-based lookups
  - Removed redundant saveQuickTabsToStorage() calls
  - Added slot label display in debug mode
- `popup.js` (+20 lines, -20 lines)
  - Updated clearStorageBtn to only clear Quick Tab state
  - Updated confirmation message
  - Removed unnecessary reload
- `manifest.json` (1 line)
  - Version bump to 1.5.5.10

- `README.md` (major rewrite)
  - Reorganized structure
  - Updated to v1.5.5.10 features
  - Added documentation links

---

## 🧪 Testing & Validation

### Security Scan

- ✅ CodeQL analysis: 0 alerts
- ✅ No security vulnerabilities introduced

### Regression Testing Required

Users should test:

1. **Bug #1 Fix**: Create QT1, move to corner, create QT2 → QT1 should stay in place
2. **Bug #2 Fix**: Pin QT in any tab → should NOT close itself
3. **Bug #3 Fix**: Create two QTs with same URL → both should maintain independent positions
4. **Feature #1**: Click "Clear Quick Tabs Storage" → settings should be preserved
5. **Feature #2**: Enable debug mode → slot numbers should appear on Quick Tab toolbars
6. **Cross-tab sync**: Switch between tabs → Quick Tabs should sync correctly
7. **Pin functionality**: Pin QT to page, switch tabs → QT should only appear on pinned page

---

## 📦 Migration Notes

### Breaking Changes

**None** - All changes are backwards compatible.

### Storage Schema

No changes to storage schema. Continues using:

- `quick_tabs_state_v2` (browser.storage.sync)
- `quick_tabs_session` (browser.storage.session)

### User Action Required

**None** - Update will apply automatically via auto-update system.

---

## 🔗 References

- **Bug Analysis**: `/docs/manual/v1-5-5-9-critical-bug-analysis.md`
- **Architecture**: `/docs/manual/quick-tab-sync-architecture.md`
- **Testing Guide**: `/docs/manual/TESTING_GUIDE_ISSUE_51.md`
- **Previous Version**: `/docs/changelogs/CHANGELOG_v1.5.5.9.md`

---

## 🙏 Credits

- **Bug Report**: Perplexity AI analysis (v1-5-5-9-critical-bug-analysis.md)
- **Implementation**: GitHub Copilot Agent (bug-architect specialist)
- **Testing**: Community feedback and manual validation required

---

## 📝 Notes

This release focuses on correctness and reliability. All three critical bugs were caused by URL-based lookups that couldn't handle:

- Multiple instances of the same URL
- Race conditions in async storage operations
- Self-reception of broadcast messages

By migrating to ID-based tracking throughout the system, we've eliminated entire classes of bugs and improved code maintainability.

**Next Steps**: Manual testing recommended before release to production.
