# Changelog - Version 1.4.1

## Major Quick Tab Improvements & Bug Fixes

This release addresses critical bugs and adds highly requested features for Quick Tabs.

### ✅ Issues Resolved

1. **Fixed Quick Tab Drag/Resize Glitches** ⭐ CRITICAL FIX
   - Fixed mouse tracking bug where Quick Tabs would move/resize even when mouse button wasn't held down
   - Added window-level mouseup listeners to catch events outside browser window
   - Improved event listener cleanup to prevent state leakage
   - Increased resize handle sizes for better usability (8px edges, 20px corners)
   - Handles now have better hit zones and are easier to grab
   - Fixed lag-related movement glitches by properly managing event listeners

2. **Performance Optimizations** ⭐ NEW
   - Implemented proper event listener cleanup on Quick Tab close
   - Used passive event listeners where appropriate for better scroll performance
   - Reduced memory leaks by properly removing all event handlers
   - More efficient resize handle implementation

3. **Nested Quick Tabs Support** ⭐ NEW
   - Can now open Quick Tabs INSIDE Quick Tabs for same-origin iframes
   - Automatic script injection into accessible iframes
   - Message passing system between iframe and parent window
   - Graceful handling of cross-origin restrictions with debug logging
   - Works automatically when iframe domain matches parent domain

4. **Cross-Tab Quick Tab Persistence** ⭐ NEW
   - Added toggleable "Persist Quick Tabs across browser tabs" setting
   - Quick Tabs now remain visible when switching between browser tabs (when enabled)
   - State is automatically saved to browser.storage
   - Minimized tabs also persist across tab switches
   - Automatic restoration on tab visibility change
   - Falls back to local storage if session storage unavailable

5. **Settings Menu Overflow Fixed** ⭐ FIX
   - Reduced tab-content max-height from 450px to 400px
   - All settings now properly visible with scrolling
   - No more cut-off settings at the bottom of tabs

6. **Close Quick Tab on Open Feature** ⭐ NEW (User Request)
   - Added "Close Quick Tab when opening in new tab" setting
   - When enabled, clicking 🔗 button closes the Quick Tab and switches to new tab
   - Provides cleaner workflow when promoting Quick Tab to full tab
   - Always switches focus when opening from Quick Tab (ignores global focus setting)

### 🎨 Code Quality Improvements

- **Better Event Management**: All drag/resize listeners now properly cleaned up
- **Memory Leak Prevention**: Comprehensive cleanup functions for all Quick Tab instances
- **Passive Listeners**: Used passive: false only where preventDefault is needed
- **Capture Phase**: Proper use of capture phase for resize/drag to prevent conflicts
- **Larger Hit Zones**: Resize handles increased from 5px/15px to 8px/20px for better UX

### 📝 Documentation

- Updated README with new features
- Updated Known Limitations section to reflect what's now possible
- Added documentation for nested Quick Tab support
- Added cross-tab persistence documentation
- Clarified what's possible vs. impossible with browser security

### 🔧 Technical Details

**Files Changed:**

- `content.js`: +120 lines (persistence, nested tabs, bug fixes)
- `popup.html`: Updated settings UI (+2 new settings)
- `popup.js`: Added new setting handlers
- `manifest.json`: Version 1.4.0 → 1.4.1
- `updates.json`: Updated version
- `README.md`: Major documentation updates

**New Features:**

- Cross-tab persistence toggle
- Nested Quick Tab support for same-origin iframes
- Close-on-open toggle
- Window-level mouseup listeners
- Message passing for iframe communication
- Visibility change listeners
- Storage-based state management

**Bug Fixes:**

- Fixed drag state getting stuck
- Fixed resize state getting stuck
- Fixed mouse tracking when moving too fast
- Fixed event listener accumulation
- Fixed settings menu overflow

### ⚠️ Remaining Known Limitations

1. **Quick Tab Focus**: Clicking inside iframe still captures keyboard focus (browser security)
2. **Cross-Origin Nested Tabs**: Cannot inject into cross-origin iframes (browser security)
3. **Zen Browser Theme**: Cannot detect Zen workspace themes (requires Zen-specific APIs)

All three are fundamental browser security limitations that cannot be worked around.

### 🚀 Migration Notes

No breaking changes. All new features are opt-in via settings.

- Existing users: Cross-tab persistence defaults to OFF
- Existing users: Close-on-open defaults to OFF
- All existing settings preserved

### 📦 Installation

Install via .xpi file from GitHub releases or load manually in about:debugging.

---

**Full Changelog**: v1.4.0...v1.4.1
