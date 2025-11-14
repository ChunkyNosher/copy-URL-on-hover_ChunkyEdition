# Changelog - Version 1.4.0

## Quick Tabs Comprehensive Improvements

This release addresses all 10 requested improvements for Quick Tabs
functionality.

### ✅ Issues Resolved

1. **Fixed Quick Tab Resize Glitch**
   - Consolidated event listeners to prevent stuck mousedown state
   - Added proper cleanup on window close
   - Prevents mouse from getting stuck at Quick Tab edges

2. **Focus Limitation Documented**
   - Added clear documentation of browser security limitation
   - Provided workaround: click in main page to restore shortcuts
   - Limitation: iframe keyboard focus is a browser security feature

3. **Nested Quick Tabs Limitation Documented**
   - Documented cross-origin iframe script injection restriction
   - Provided workaround: use "Open in New Tab" button (🔗)
   - Limitation: browser security prevents cross-origin script access

4. **Persistent Quick Tabs Alternative**
   - Implemented minimize/restore functionality as alternative
   - Created floating minimized tabs manager
   - Limitation: cross-tab DOM persistence blocked by browser security
   - Workaround: use minimize feature for tab persistence

5. **Navigation Buttons Added** ⭐ NEW
   - Back button (←)
   - Forward button (→)
   - Reload button (↻)
   - All buttons styled and positioned in title bar

6. **Favicon and Dynamic Title** ⭐ NEW
   - Displays page favicon from Google's favicon service
   - Title updates dynamically when page loads
   - Fallback to hostname if title unavailable

7. **Minimize/Restore System** ⭐ NEW
   - Minimize button (−) in Quick Tab title bar
   - Floating minimized tabs manager window
   - Restore button (↑) for each minimized tab
   - Delete button (✕) for each minimized tab
   - Manager auto-hides when empty
   - Manager is draggable

8. **Settings UI Reorganization** ⭐ NEW
   - Reorganized into 4 horizontal tabs:
     - Copy URL Tab (URL, Text, New Tab shortcuts)
     - Quick Tabs Tab (all Quick Tab settings)
     - Appearance Tab (notifications, dark mode)
     - Advanced Tab (debug mode, tips)
   - Much cleaner and more organized interface
   - Better discoverability of features

9. **Notification Enhancements** ⭐ NEW
   - Border color customization (default: black)
   - Border width customization (0-10px)
   - Animation options:
     - Slide (directional based on position)
     - Pop (scale up animation)
     - Fade (simple opacity fade)
   - All existing options maintained

10. **Zen Browser Theme Limitation Documented**
    - Documented requirement for Zen-specific APIs
    - Limitation: content scripts don't have access to browser theme APIs
    - Would require native Zen Browser integration

### 🎨 Code Quality Improvements

- **DRY Principle**: Extracted Google Favicon URL to constant
- **Separation of Concerns**: Moved inline JS to external popup.js
- **Robust Validation**: Added safeParseInt helper for number inputs
- **Memory Management**: Verified event listener cleanup
- **No Security Issues**: CodeQL analysis found 0 vulnerabilities

### 📝 Documentation

- Comprehensive README updates
- Known limitations section added
- Workarounds provided for each limitation
- Step-by-step Quick Tabs usage guide
- Updated features list with new capabilities

### 🔧 Technical Details

**Files Changed:**

- `content.js`: +387 lines (Quick Tab features, minimize system)
- `popup.html`: Complete restructure with tabs
- `popup.js`: +24 lines (tab switching, validation)
- `manifest.json`: Version 1.3.0 → 1.4.0
- `README.md`: Major documentation update

**New Features Count:**

- 3 new navigation buttons
- 1 minimize button
- 1 floating manager window
- 4 settings tabs
- 3 notification border/animation options
- Dynamic title and favicon display

### 🐛 Bug Fixes

- Fixed resize handle memory leak
- Fixed drag triggering on button clicks
- Fixed event listener accumulation

### ⚠️ Known Limitations

All browser security limitations are documented with workarounds:

1. Iframe keyboard focus capture
2. Cross-origin script injection blocking
3. Cross-tab DOM isolation
4. Zen Browser API access restrictions

### 🚀 Migration Notes

No breaking changes. All existing settings and features preserved. New settings
have sensible defaults.

### 📦 Installation

Install via .xpi file from GitHub releases or load manually in about:debugging.

---

**Full Changelog**: v1.3.0...v1.4.0
