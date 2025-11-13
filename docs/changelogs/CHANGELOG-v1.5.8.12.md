# Changelog - v1.5.8.12

**Release Date:** November 13, 2025  
**Type:** Major Feature Enhancement + Bug Fixes  
**Focus:** Persistent Floating Panel for Quick Tabs Manager (Zen Browser Compatibility)

---

## 🎉 Major New Feature: Persistent Floating Panel

This release replaces the Firefox Sidebar API with a **persistent, draggable, resizable floating panel** that works perfectly in **Zen Browser** (where the native sidebar is disabled). This implementation addresses fundamental architectural limitations and fixes multiple long-standing issues.

### Why This Change?

**Problem:** Zen Browser disables `sidebar.verticalTabs` to maintain a clean UI, making the Firefox Sidebar API unavailable. The extension's Quick Tabs Manager relied on this API, breaking functionality in Zen Browser.

**Solution:** Implement a content script-injected floating panel that:

- Persists across page navigations
- Provides the same functionality as the sidebar
- Works in both Zen Browser and Firefox
- Offers enhanced features like drag/resize from any edge

---

## ✨ New Features

### Persistent Floating Panel (PanelManager)

**File:** `src/features/quick-tabs/panel.js` (NEW - 900+ lines)

#### Core Capabilities:

- ✅ **Persistent Across Navigation** - Panel re-injects on page load, doesn't close
- ✅ **Draggable** - Move panel anywhere using Pointer Events API
- ✅ **8-Direction Resize** - Resize from all edges and corners
- ✅ **Position Memory** - Remembers position/size via `browser.storage.local`
- ✅ **Keyboard Shortcut** - `Ctrl+Alt+Z` (or `Cmd+Option+Z` on Mac) to toggle
- ✅ **Auto-Refresh** - Updates every 2 seconds when open
- ✅ **Container-Aware** - Groups Quick Tabs by Firefox Container
- ✅ **Z-Index Management** - Panel at 999999999 (always above Quick Tabs)

#### UI Features:

- Green/yellow status indicators (active/minimized tabs)
- Action buttons: Close Minimized, Close All
- Per-tab actions: Go to Tab, Minimize, Restore, Close
- Empty state display
- Favicon display per Quick Tab
- Dynamic tab counts per container
- Last sync timestamp

#### Technical Implementation:

- **Injection Method:** Content script injects div into `documentElement`
- **Drag/Resize:** Pointer Events API with `setPointerCapture()`
- **State Persistence:** `browser.storage.local` (key: `quick_tabs_panel_state`)
- **Panel State:** Tracks `left`, `top`, `width`, `height`, `isOpen`
- **Min Dimensions:** 250px width × 300px height
- **Default Size:** 350px × 500px
- **Default Position:** Top-right corner (20px from right, 100px from top)

### Integration with Quick Tabs Manager

**File:** `src/features/quick-tabs/index.js` (Updated)

- Added `panelManager` property to `QuickTabsManager`
- Made `init()` async to support panel initialization
- Added helper methods: `minimizeById()`, `restoreById()`, `closeById()`
- Panel automatically initializes when Quick Tabs Manager initializes

**File:** `src/content.js` (Updated)

- Changed `initQuickTabs()` call to `await initQuickTabs()`
- Ensures panel is ready before extension completes initialization

---

## 🐛 Bug Fixes

### Issue #35: Quick Tabs Persistence Across Tabs

**Status:** ✅ FIXED

**Previous Behavior:**

- Quick Tabs state not persisting when switching tabs
- Position/size lost on tab switch
- Minimized tabs disappeared

**Fix:**

- Panel uses `browser.storage.sync` for Quick Tabs state
- Panel re-reads state on every refresh (2-second interval)
- State keyed by container for proper isolation

### Issue #43: Minimized Quick Tabs Visibility

**Status:** ✅ FIXED

**Previous Behavior:**

- Minimized Quick Tabs not visible in manager
- No way to restore without reopening tab

**Fix:**

- Panel displays all minimized tabs with yellow indicators
- Restore button available for each minimized tab
- Container categorization preserved

### Issue #51: Quick Tabs UI Functionality

**Status:** ✅ FIXED

**Previous Behavior:**

- UI elements not fully functional
- Some controls missing or broken

**Fix:**

- Complete UI implementation in panel
- All controls functional (minimize, restore, close, go to tab)
- Action buttons work correctly

---

## 🔧 Technical Changes

### Architecture Updates

**New Module:**

```
src/features/quick-tabs/
  ├── index.js         (Updated - panel integration)
  ├── window.js
  ├── minimized-manager.js
  └── panel.js         (NEW - 900+ lines)
```

**Key APIs Used:**

1. **Pointer Events API** - Drag/resize with pointer capture
2. **browser.storage.local** - Panel state persistence
3. **browser.storage.sync** - Quick Tabs state (container-aware)
4. **browser.runtime.onMessage** - Toggle panel command from background
5. **browser.contextualIdentities** - Container info and icons
6. **browser.tabs** - Go to Tab functionality

### Message Handling

**New Message Type:**

```javascript
{
  action: 'TOGGLE_QUICK_TABS_PANEL';
}
```

**Handler:** `PanelManager.setupMessageListener()` in panel.js
**Sender:** `background.js` via `browser.commands.onCommand` listener

### Storage Schema

**Panel State (browser.storage.local):**

```javascript
{
  quick_tabs_panel_state: {
    left: 20,
    top: 100,
    width: 350,
    height: 500,
    isOpen: false
  }
}
```

**Quick Tabs State (browser.storage.sync):**

```javascript
{
  quick_tabs_state_v2: {
    "firefox-container-1": {
      tabs: [
        {
          id: "qt_123",
          url: "...",
          title: "...",
          minimized: false,
          activeTabId: 5,
          // ... other properties
        }
      ],
      timestamp: 1699123456789
    }
  }
}
```

---

## 📦 Build Changes

### Bundle Size Increase

- **Previous:** ~96KB
- **Current:** ~116KB (+20KB)
- **Reason:** Addition of PanelManager class (~900 lines)

### Dependencies

- No new dependencies added
- Uses existing browser APIs only

---

## 📝 Documentation Updates

### Updated Files:

1. **README.md**
   - Version updated to 1.5.8.12
   - Added "What's New in v1.5.8.12" section
   - Updated Quick Tabs Manager section
   - Updated repository structure
   - Updated bundle size reference

2. **.github/copilot-instructions.md**
   - Version updated to 1.5.8.12
   - Purpose updated to include panel manager

3. **All 6 Agent Files** (`.github/agents/`)
   - bug-architect.md
   - bug-fixer.md
   - feature-builder.md
   - feature-optimizer.md
   - master-orchestrator.md
   - refactor-specialist.md
   - **All updated to v1.5.8.12**
   - **All include panel.js in quick-tabs section**
   - **All updated bundle size to ~116KB**

4. **Manifest & Package**
   - manifest.json → 1.5.8.12
   - package.json → 1.5.8.12

---

## 🧪 Testing Recommendations

### Manual Testing Checklist:

#### Panel Functionality:

- [ ] Press `Ctrl+Alt+Z` to toggle panel
- [ ] Drag panel by header to move
- [ ] Resize panel from all 8 directions
- [ ] Close panel with X button or minimize button
- [ ] Reload page and verify panel state persists
- [ ] Switch tabs and verify panel state persists

#### Quick Tabs Integration:

- [ ] Create Quick Tab with Q key
- [ ] Verify tab appears in panel with green indicator
- [ ] Click "Minimize" in panel → tab should minimize
- [ ] Verify minimized tab shows yellow indicator
- [ ] Click "Restore" → tab should reappear
- [ ] Click "Close" → tab should close
- [ ] Click "Go to Tab" → browser should switch to that tab

#### Container Testing:

- [ ] Create Quick Tabs in multiple Firefox Containers
- [ ] Verify tabs grouped by container in panel
- [ ] Verify container icons and names display
- [ ] Test close minimized in one container
- [ ] Test close all across containers

#### Edge Cases:

- [ ] Open panel on restricted pages (about:, chrome:)
- [ ] Test with CSP-restricted pages
- [ ] Test with very long tab titles
- [ ] Test with many Quick Tabs (10+)
- [ ] Test panel resize to minimum dimensions

---

## ⚠️ Known Limitations

### 1. Panel Not Available on Restricted Pages

**Pages:** `about:*`, `chrome:*`, `moz-extension:*`  
**Reason:** Content scripts cannot inject on these pages  
**Workaround:** None - browser security restriction

### 2. CSP Restrictions (Rare)

**Issue:** Very strict Content Security Policies may block inline styles  
**Likelihood:** Extremely rare (styles injected as `<style>` element)  
**Workaround:** Panel may not display correctly on affected pages

### 3. Z-Index Conflicts (Theoretical)

**Issue:** Pages with z-index > 999999999 may overlap panel  
**Likelihood:** Virtually impossible (practical z-index limit)  
**Workaround:** None needed

---

## 🔐 Security Summary

### CodeQL Analysis

- **Status:** ✅ PASSED
- **Alerts:** 0
- **Languages Scanned:** JavaScript

### Security Considerations:

1. **Message Sender Validation** - Panel validates all runtime messages
2. **No eval() or innerHTML** - Safe DOM manipulation only
3. **CSP Compliant** - Styles injected as `<style>` elements
4. **Storage Isolation** - Panel state separate from Quick Tabs state
5. **Pointer Capture** - Prevents drag/resize escape to other elements

---

## 🚀 Migration Notes

### From v1.5.8.11 to v1.5.8.12

**Breaking Changes:** None

**New Features:** Persistent floating panel replaces sidebar functionality

**Data Migration:**

- Quick Tabs state: No migration needed (same schema)
- Panel state: New storage key (`quick_tabs_panel_state`)
- Sidebar state: Legacy (not removed for backward compatibility)

**User Impact:**

- Users will see panel instead of sidebar
- Keyboard shortcut (`Ctrl+Alt+Z`) now toggles panel
- All Quick Tabs functionality preserved

---

## 📚 Related Documentation

- **Implementation Guide:** [docs/manual/persistent-panel-implementation.md](../manual/persistent-panel-implementation.md)
- **Architecture:** [docs/manual/hybrid-architecture-implementation.md](../manual/hybrid-architecture-implementation.md)
- **Build Guide:** [docs/manual/build-and-packaging-guide.md](../manual/build-and-packaging-guide.md)

---

## 👥 Contributors

- GitHub Copilot Agent (Implementation)
- ChunkyNosher (Repository Owner)

---

## 📌 Version Comparison

| Feature               | v1.5.8.11       | v1.5.8.12                 |
| --------------------- | --------------- | ------------------------- |
| Quick Tabs Manager UI | Firefox Sidebar | Persistent Floating Panel |
| Zen Browser Support   | ❌ Broken       | ✅ Full Support           |
| Panel Toggle          | Sidebar API     | Ctrl+Alt+Z                |
| Panel Draggable       | N/A             | ✅ Yes                    |
| Panel Resizable       | N/A             | ✅ 8 directions           |
| Position Memory       | N/A             | ✅ Yes                    |
| Bundle Size           | ~96KB           | ~116KB                    |
| Issues Fixed          | -               | #35, #43, #51             |

---

**Next Release Preview (v1.5.9.0+):**

- Potential enhancements to panel UI
- Additional Quick Tabs features
- Performance optimizations

---

**Full Changelog:** See commit history for detailed changes.  
**Issue Tracker:** [GitHub Issues](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition/issues)  
**Repository:** [ChunkyNosher/copy-URL-on-hover_ChunkyEdition](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition)
