# Firefox Extension: Copy URL on Hover

**Version 1.5.9.4** - A feature-rich Firefox/Zen Browser extension with
**Hybrid Modular/EventBus Architecture** for quick URL copying and advanced
Quick Tab management with Firefox Container support and Persistent Floating
Panel Manager.

This is a complete, customizable Firefox extension that allows you to copy URLs
or link text by pressing keyboard shortcuts while hovering over links, plus
powerful Quick Tabs for browsing links in floating, draggable iframe windows.
Now with full Firefox Container integration and a persistent Quick Tabs Manager
panel optimized for Zen Browser.

## 🎉 What's New in v1.5.9.4

**🐛 Critical Bug Fix: Data URL Export Encoding**

This release fixes the critical log export bug where the "Export Console Logs" 
button would fail with "Access denied for URL" error due to corrupted data URL 
encoding.

**Critical Fix:**

- ✅ **Data URL Encoding FIXED** - Log export now works reliably with all Unicode characters
  - Replaced deprecated `btoa(unescape(encodeURIComponent()))` pattern with modern `TextEncoder` API
  - Added `utf8ToBase64()` helper function with chunking support to prevent stack overflow
  - Fixed data URL corruption that caused missing semicolon in MIME type
  - Added comprehensive debug logging for encoding process
  - Export now handles large log files (100KB+) without errors

**Root Cause Analysis:**

The log export failed because the deprecated `btoa(unescape(encodeURIComponent()))` 
encoding pattern corrupted Unicode characters:

1. The `unescape()` function is deprecated since ES5 (2009)
2. This pattern fails with Unicode characters outside basic ASCII range
3. The corruption affected the data URL format string itself
4. Result: `data:text/plaincharset=utf-8` instead of `data:text/plain;charset=utf-8`
5. Firefox rejected the malformed URL with "Access denied" error

**Solution:**

- Modern `TextEncoder` API for proper UTF-8 encoding
- `Uint8Array` for binary data handling
- Chunking logic (32KB chunks) to prevent "Maximum call stack size exceeded"
- 100% reliable encoding with all Unicode characters preserved
- Future-proof implementation using modern web standards

**Technical Implementation:**

- `TextEncoder.encode()` converts UTF-8 strings to bytes correctly
- Chunked conversion prevents stack overflow on large files
- `btoa()` only receives valid Latin1 characters (0x00-0xFF)
- No character corruption - proper UTF-8 preservation
- Performance: ~8ms for 35KB logs (vs. ~5ms with broken method)

See [data-url-export-fix-v1594.md](docs/manual/1.5.9%20docs/data-url-export-fix-v1594.md) for
detailed analysis and implementation guide.

## 🎉 What's New in v1.5.9.3

**🐛 Critical Bug Fix: Log Export "No Logs Found" Issue**

This release fixes the critical log export bug where the "Export Console Logs" button
would report "No logs found" even when debug mode was enabled and logs were visible
in the browser console.

**Critical Fix:**

- ✅ **Log Export Issue FIXED** - Console log export now captures all logs
  - Created new `console-interceptor.js` module that overrides all console methods
  - Console interceptor captures ALL `console.log()`, `console.error()`, `console.warn()`, `console.info()`, and `console.debug()` calls
  - Imported console interceptor FIRST in content.js to ensure all logs are captured
  - Updated GET_CONTENT_LOGS handler to merge logs from both console interceptor and debug.js
  - Added buffer statistics logging for debugging
  - Improved error messages with actionable advice for users

**Root Cause Analysis:**

The log export system was not capturing `console.log()` calls from content scripts because:

1. Background.js had console overrides (working correctly)
2. Content.js used `console.log()` directly for all logging
3. debug.js only captured calls to `debug()`, `debugError()`, etc. - NOT regular `console.log()`
4. Content script had no console override, so regular console calls were not captured
5. Result: Export found 0 content logs and threw "No logs found" error

**Solution:**

- Created comprehensive console interceptor module that overrides all console methods
- Captures all console calls to a buffer (max 5000 entries)
- Merges logs from both console interceptor and debug.js
- Provides buffer statistics for debugging
- Better error messages guide users to navigate to regular webpages

**Technical Implementation:**

- Console override must be imported FIRST to capture all subsequent logs
- Uses original console methods to avoid infinite loops
- Detects execution context (content-script, background, popup)
- Automatic buffer size management with FIFO queue
- Returns log copies to prevent mutation

See [log-export-no-logs-fix.md](docs/manual/1.5.9%20docs/log-export-no-logs-fix.md) for
detailed analysis and implementation guide.

## 🎉 What's New in v1.5.8.16

**🐛 Critical Bug Fixes: Cross-Tab Close, Sync Optimization, and RAM Usage**

This release fixes critical Quick Tabs bugs including RAM spikes, flickering,
and cross-tab synchronization issues.

**Critical Fixes:**

- ✅ **Issue #5 FIXED** - Optimized position/size syncing to prevent performance
  issues
  - Removed real-time broadcasts during drag/resize operations
  - Position and size now only sync on drag/resize end
  - Reduces BroadcastChannel messages from ~10-50 per operation to just 1
  - Eliminates excessive storage writes and potential quota issues
  - Significantly improves performance and reduces RAM usage
- ✅ **Issue #2 FIXED** - Quick Tab now closes across ALL browser tabs
  - Added missing `CLOSE_QUICK_TAB_FROM_BACKGROUND` message handler
  - Enhanced `handleDestroy` to send close message to background script
  - Background script properly broadcasts close to all tabs
  - Fixes cross-tab synchronization for close operations
- ✅ **Issue #1 FIXED** - Eliminated RAM spikes and flickering during Quick Tab
  operations
  - Added debouncing to BroadcastChannel message handler (50ms)
  - Prevents rapid event loops that cause memory spikes
  - Eliminates flicker during move/resize operations
  - Stops close/reopen loops that caused RAM to spike to 19GB
- ✅ **Issue #3 PARTIAL FIX** - Improved Quick Tab closure behavior
  - Enhanced close operation to properly update background state
  - Better transaction ID handling to prevent race conditions
  - Storage properly cleared on Quick Tab close

**Additional Improvements:**

- Added `CLEAR_ALL_QUICK_TABS` message handler for popup button
- Improved error handling in close operations
- Enhanced logging for debugging cross-tab sync issues

**Technical Details:**

- Broadcast debouncing: 50ms window to prevent duplicate message processing
- Automatic cleanup of debounce map to prevent memory leaks
- Position/size changes now only trigger one sync event per operation
- Transaction ID system prevents self-triggering storage events

See [v1.5.8.15-bug-analysis.md](docs/manual/v1.5.8.15-bug-analysis.md) for
detailed bug analysis and fix strategy.

## 🎉 What's New in v1.5.8.14

**🐛 Critical Bug Fixes: Transaction ID System and Emergency Save**

This release fixes the critical "Quick Tab immediately closes after opening" bug
and other Quick Tabs Manager issues identified in the
quick-tab-bug-fix-v1-5-8-13.md guide.

**Critical Fixes:**

- ✅ **Bug #1 FIXED** - Quick Tab no longer closes immediately after creation
  - Implemented transaction ID (saveId) system to prevent race conditions
  - Content script now ignores its own storage saves (prevents self-destruction)
  - Increased timeout from 100ms to 500ms for container-aware operations
  - Fixed background.js to not accidentally clear storage on format mismatches
- ✅ **Bug #3 FIXED** - "Close All" button now works correctly
  - Sets empty container-aware state instead of removing storage
  - Prevents accidental storage clearing that triggers race conditions
- ✅ **Bug #4 FIXED** - Minimize/Close buttons in Manager now work
  - Fixed closeMinimizedQuickTabs to properly handle container-aware format
  - Added saveId to all minimize operations
- ✅ **Emergency Save Handlers** - New safety net for state preservation
  - Saves Quick Tabs state when tab becomes hidden (visibilitychange event)
  - Saves state before page unload (beforeunload event)
  - Prevents loss of Quick Tabs when switching tabs or refreshing page

**Root Cause Analysis:**

The "Quick Tab immediately closes" bug was caused by a race condition:

1. Content script saves Quick Tab state to storage
2. Storage event fires in the SAME tab that made the change
3. Content script processes its own save as if from another tab
4. Content script thinks Quick Tab was deleted externally
5. Content script destroys the newly created Quick Tab

**Solution:** Transaction ID system where each save gets a unique saveId that
the content script tracks and ignores when processing storage events.

**Technical Details:**

- `generateSaveId()` creates unique transaction IDs for each storage operation
- `currentSaveId` tracked and released after 500ms (increased from 100ms)
- Storage listeners check saveId before processing changes
- Background script includes saveId when saving state
- Container-aware format properly handled in all operations

See [quick-tab-bug-fix-v1-5-8-13.md](docs/manual/quick-tab-bug-fix-v1-5-8-13.md)
for detailed diagnosis and implementation.

## 🎉 What's New in v1.5.8.13

**🚀 Critical Fix: Eager Loading and Real-Time Cross-Tab Sync**

This release fixes **Issue #35** (cross-tab persistence) and **Issue #51**
(position/size sync) by implementing eager loading and BroadcastChannel-based
real-time synchronization as specified in the QuickTabs-v1.5.8.13-Patch.md
guide.

**Key Improvements:**

- ✅ **Eager Loading** - All Quick Tabs listeners and state hydration run
  immediately on content script load
- ✅ **BroadcastChannel Sync** - Real-time cross-tab synchronization with <10ms
  latency (replaces polling)
- ✅ **Storage Event Listeners** - Quick Tabs listen for storage changes from
  background script
- ✅ **Immediate State Hydration** - Quick Tabs state restored from storage on
  page load (no user interaction needed)
- ✅ **Broadcast Operations** - All Quick Tab operations (create, move, resize,
  minimize, restore, pin, close) broadcast to other tabs
- ✅ **Container-Aware Sync** - Firefox Container isolation maintained in sync
  operations
- ✅ **Position/Size Sync** - Quick Tab position and size changes sync instantly
  across all tabs (Issue #51)
- ✅ **Cross-Tab Persistence** - Quick Tabs persist and sync across all browser
  tabs (Issue #35)

**Technical Details:**

- BroadcastChannel API for same-origin messaging
- Storage listeners attached at QuickTabsManager initialization
- State hydration from browser.storage.session (fast) or browser.storage.sync
  (fallback)
- All handlers broadcast via `broadcast(type, data)` method
- New methods: `setPosition()`, `setSize()` for receiving sync updates
- Background script initialization remains eager (already implemented)

**Fixes:**

- Issue #35: Quick Tabs now persist and sync across all tabs in real-time
- Issue #51: Position and size changes sync instantly between tabs
- Quick Tabs Manager now shows accurate state across all browser contexts

See [QuickTabs-v1.5.8.13-Patch.md](docs/manual/QuickTabs-v1.5.8.13-Patch.md) for
implementation details.

## 🎉 What's New in v1.5.8.12

**🚀 Major Enhancement: Persistent Floating Panel for Quick Tabs Manager**

This release replaces the Firefox Sidebar API with a persistent, draggable,
resizable floating panel that works perfectly in Zen Browser (where the native
sidebar is disabled). This fixes Issues #35, #43, and #51.

**Key Improvements:**

- ✅ **Persistent Floating Panel** - New `PanelManager` class with full
  drag/resize capabilities
- ✅ **Zen Browser Compatibility** - No dependency on Firefox Sidebar API (which
  is disabled in Zen)
- ✅ **Ctrl+Alt+Z Toggle** - Keyboard shortcut now toggles the floating panel
  instead of sidebar
- ✅ **Position Memory** - Panel remembers position and size across browser
  sessions
- ✅ **Pointer Events API** - Smooth drag/resize from all 8 edges/corners with
  pointer capture
- ✅ **Auto-Updates** - Panel content refreshes every 2 seconds when open
- ✅ **Container-Aware Display** - Quick Tabs grouped by Firefox Container with
  visual indicators
- ✅ **Enhanced Actions** - Close Minimized, Close All, Go to Tab,
  Minimize/Restore per-tab

**Technical Details:**

- Panel injected into page DOM (not sidebar)
- Z-index: 999999999 (always above Quick Tabs)
- State persisted to `browser.storage.local`
- Survives page navigation via re-injection
- ~900 lines of new code in `src/features/quick-tabs/panel.js`

**Fixes:**

- Issue #35: Quick Tabs now persist correctly across tab switches
- Issue #43: Minimized Quick Tabs properly visible in panel manager
- Issue #51: Quick Tabs UI fully restored and functional

See
[persistent-panel-implementation.md](docs/manual/persistent-panel-implementation.md)
for complete architecture details.

## 📁 Repository Structure (v1.5.8.13 - Hybrid Architecture)

**Source Files (Hybrid Modular/EventBus Structure)**:

- **`src/`** - Modular source code (bundled via Rollup)
  - **`src/core/`** - Core utilities (config, state, events, dom, browser-api)
    - `config.js` - Configuration management with schema validation
    - `state.js` - Global state manager singleton
    - `events.js` - EventBus implementation (on, off, emit, once)
    - `dom.js` - DOM manipulation helpers (**moved from utils/**)
    - `browser-api.js` - Browser API wrappers (**moved from utils/**)
    - `index.js` - Barrel export for core modules
  - **`src/features/`** - Feature modules (EventBus-driven)
    - **`src/features/quick-tabs/`** - Quick Tabs feature
      - `index.js` - QuickTabsManager with EventBus listeners
      - `window.js` - QuickTabWindow class (**renamed from
        quick-tab-window.js**)
      - `minimized-manager.js` - Minimized tabs manager
      - `panel.js` - **PanelManager for persistent floating panel (NEW
        v1.5.8.12)**
    - **`src/features/notifications/`** - Notifications feature (**fully
      modularized**)
      - `index.js` - NotificationManager coordinator
      - `toast.js` - Toast notifications (**NEW**)
      - `tooltip.js` - Tooltip notifications (**NEW**)
    - **`src/features/url-handlers/`** - 11 categorized URL handler modules (104
      handlers total)
  - **`src/ui/`** - UI components and styles
    - `components.js` - Reusable UI widget helpers
    - **`css/`** - Modular CSS files (**NEW**)
      - `base.css` - Common styles and CSS reset
      - `notifications.css` - Notification animations and styles
      - `quick-tabs.css` - Quick Tab window styles
  - **`src/utils/`** - Utility modules
    - `debug.js` - Debug utilities and logging
    - `index.js` - Barrel export
  - **`src/content.js`** - Main entry point (orchestrates all features via
    EventBus)
- **`dist/`** - Built/bundled files (generated by `npm run build`)
  - `content.js` - **BUNDLED** from all src/ modules (~116KB)
  - All other files copied from root
- **Root Files**: `manifest.json`, `background.js`, `popup.html`, `popup.js`,
  `state-manager.js`
- **Sidebar**: `sidebar/quick-tabs-manager.html`,
  `sidebar/quick-tabs-manager.js`, `sidebar/quick-tabs-manager.css` (**Legacy -
  Panel used instead**)
- **Build System**: `package.json`, `rollup.config.js`
- **Documentation**: `/docs/` folder organized by type:
  - `/docs/changelogs/` - Version changelogs
  - `/docs/implementation-summaries/` - Feature implementation notes
  - `/docs/security-summaries/` - Security audit reports
  - `/docs/manual/` - Guides and architecture documentation
    - `hybrid-architecture-implementation.md` - **Architecture #10 design**
    - `build-and-packaging-guide.md` - **Build and packaging process**
    - `persistent-panel-implementation.md` - **Floating panel architecture
      (v1.5.8.12)**

## ✨ Key Features

### Core Features

✓ **Quick URL Copying** - Press keyboard shortcuts while hovering over links  
✓ **Quick Tabs** - Floating, draggable, resizable iframe windows with full
navigation  
✓ **Firefox Container Support (v1.5.7)** - Quick Tabs isolated by Firefox
Container  
✓ **Floating Quick Tabs Manager (NEW v1.5.8.1)** - Persistent, draggable panel
for managing all Quick Tabs  
✓ **Cross-Tab Sync** - Quick Tabs persist across all browser tabs
(BroadcastChannel + browser.storage)  
✓ **Z-Index Management (v1.5.7)** - Multiple Quick Tabs layer correctly based on
interaction  
✓ **Pin to Page** - Pin Quick Tabs to specific pages  
✓ **Auto-Updates** - Automatic extension updates via GitHub releases  
✓ **100+ Site Handlers** - Optimized for popular websites  
✓ **Debug Mode** - Slot number tracking and enhanced logging  
✓ **Dark Mode** - Full dark theme support

### Quick Tabs Manager Persistent Floating Panel (v1.5.8.12)

✓ **Persistent Floating Panel** - Works in Zen Browser where native sidebar is
disabled  
✓ **Draggable & Resizable** - Move and resize from any edge or corner using
Pointer Events API  
✓ **Position Memory** - Panel remembers position and size across sessions
(browser.storage.local)  
✓ **No Sidebar Dependency** - Injected into page DOM, not reliant on Firefox
Sidebar API  
✓ **Container Categorization** - Quick Tabs grouped by Firefox Container  
✓ **Action Buttons** - "Close Minimized" and "Close All" buttons  
✓ **Go to Tab** - Jump to the browser tab containing a Quick Tab  
✓ **Keyboard Shortcut** - Press `Ctrl+Alt+Z` (or `Cmd+Option+Z` on Mac) to
toggle panel  
✓ **Real-time Updates** - Panel auto-refreshes every 2 seconds when open  
✓ **Visual Indicators** - Green (active) and Yellow (minimized) status dots  
✓ **Persistent State** - Survives page navigation and browser restarts  
✓ **Z-Index Management** - Panel at 999999999, always above Quick Tabs

### Quick Tabs Features

✓ **Complete UI Restoration (v1.5.8.11)** - Full Quick Tab interface with all
controls  
✓ **Favicon Display** - Website icons shown in Quick Tab titlebar  
✓ **Dynamic Title Updates** - Shows actual webpage titles or hostnames  
✓ **Open in New Tab** - 🔗 button to open Quick Tab content in browser tab  
✓ **Pin to Page** - 📍📌 Pin Quick Tabs to specific pages  
✓ **8-Direction Resize** - Resize from all edges and corners (v1.5.8.11)  
✓ **Position/Size Persistence** - State syncs across tabs (fixes #35 & #51)  
✓ **Pointer Events API** - Drag/resize with setPointerCapture (no escape)  
✓ **Emergency State Save** - pointercancel handling for tab switches  
✓ **Firefox Container Integration** - Quick Tabs respect container boundaries  
✓ **Smart Z-Index Management** - Most recently interacted tab always on top  
✓ Navigation controls (back, forward, reload)  
✓ Minimize to sidebar manager  
✓ Multiple instances with unique ID tracking  
✓ Slot numbers in debug mode (persistent across tabs)

### Modern API Framework (v1.5.8.10)

- **Hybrid Modular/EventBus Architecture** - Clean separation between core,
  features, and UI
- **EventBus-Driven Features** - All inter-feature communication via EventBus
  (on, off, emit, once)
- **Modular CSS** - Separate CSS files for base, notifications, and Quick Tabs
- **Core Utilities** - dom.js and browser-api.js centralized in core/
- **Floating Panel Injection** - Content script injects persistent panel into
  page DOM
- **Pointer Events API** - Reliable drag/resize with setPointerCapture
- **Firefox Container API** - Container-aware state management with
  `contextualIdentities`
- **browser.storage.sync** - Container-keyed persistent storage
- **browser.storage.local** - Panel position and size persistence
- **browser.storage.session** - Fast ephemeral state (Firefox 115+)
- **BroadcastChannel** - Real-time same-origin sync with container filtering
- **Runtime Messaging** - Cross-origin sync via background script
- **ID-based Tracking** - Prevents duplicate instance conflicts
- **Commands API** - Keyboard shortcuts for panel toggle (Ctrl+Alt+Z)

### What's New in v1.5.8.11? 🎉

✅ **Quick Tabs Full UI Restoration**

- **Complete Titlebar** - Favicon, dynamic title, and all control buttons
  restored
- **Favicon Rendering** - Shows website icons using Google Favicon API
- **Dynamic Title Updates** - Automatically updates with webpage title or
  hostname
- **Open in New Tab Button** - 🔗 button to open Quick Tab content in browser
  tab
- **Pin Button** - 📍/📌 toggle to pin Quick Tabs to specific pages
- **Visual Feedback** - Pin button changes color and icon when pinned

✅ **8-Direction Resize (Fix #3)**

- **All Edges and Corners** - Resize from any of 8 handles (N, S, E, W, NE, NW,
  SE, SW)
- **Pointer Events API** - setPointerCapture ensures smooth resizing without
  escape
- **Min/Max Constraints** - 400x300 minimum size enforced
- **Emergency Saves** - pointercancel handling preserves state on interruptions

✅ **Position/Size Persistence (Fixes #35 & #51)**

- **Cross-Tab Sync** - Position and size persist across all browser tabs
- **Throttled Updates** - 100ms throttling during drag/resize for performance
- **Final Save** - Emergency save on pointercancel (tab switch during drag)
- **Background Coordination** - Runtime messaging for cross-tab state sync
- **Pin State Sync** - Pin/unpin broadcasts to all tabs via background script

✅ **UX Improvements**

- **Removed Confusing Toggle** - "Persist Quick Tabs Across Tabs" always enabled
- **Simplified Settings** - Cleaner Quick Tabs configuration panel
- **Better Performance** - Optimized state management with throttling

### What's New in v1.5.8.10? 🎉

✅ **Hybrid Modular/EventBus Architecture (Architecture #10)**

- **Implemented Architecture #10** - Following
  hybrid-architecture-implementation.md design
- **Core Utilities Reorganization** - Moved dom.js and browser-api.js from
  utils/ to core/
- **Modular CSS System** - Created ui/css/ directory with base.css,
  notifications.css, quick-tabs.css
- **Notification Modularization** - Split into separate toast.js and tooltip.js
  modules
- **Quick Tabs Renaming** - Renamed quick-tab-window.js to window.js for
  consistency
- **EventBus Integration** - All features now properly register with EventBus
- **Enhanced Build Process** - Added comprehensive validation to release
  workflow
- **Packaging Safety** - Automated checks prevent source files leaking into .xpi
  packages

✅ **Build and Packaging Improvements**

- **Production Build Validation** - Checks file existence, sizes, and source
  leaks
- **XPI Package Verification** - Validates package contents and size before
  release
- **Comprehensive Documentation** - Created build-and-packaging-guide.md
- **Test-Before-Build** - Release workflow runs tests before packaging
- **Architecture Documentation** - Updated release notes with architecture
  details

✅ **Code Quality and Maintainability**

- **Cleaner Separation of Concerns** - Features, UI, and core clearly delineated
- **Better Testability** - Modular structure enables easier unit testing
- **Improved Scalability** - EventBus enables features to scale independently
- **Reduced Technical Debt** - Removed duplicated DOM logic and utilities

### What's New in v1.5.8.9?

✅ **Critical Bug Fixes**

- **Fixed "Open in New Tab" feature** - Corrected action name mismatch between
  content script and background script
- **Implemented Quick Tab creation** - Added actual Quick Tab creation logic
  (was previously just a stub)
- **Fixed notification animations** - Added CSS keyframe animations for slide,
  fade, and bounce effects
- **Fixed notification border width** - Ensured border width is parsed as a
  number to prevent rendering issues
- **Enhanced notification display** - Animations now properly apply to both
  tooltip and toast notifications

✅ **Improved CI/CD and Tool Integration**

- **CodeRabbit bot PR review** - Updated configuration to enable code reviews
  for bot-created PRs
- **Enhanced Codecov integration** - Improved test coverage workflow with better
  error handling
- **Base branch configuration** - Added support for DeepSource and Copilot
  branch patterns
- **Cleaner PR reviews** - Disabled review skip status messages for better PR
  readability

✅ **Developer Experience Improvements**

- Comprehensive bug fix documentation (v1588-complete-fix-plan.md,
  fix-pr78-issues.md)
- Updated GitHub Copilot agent instructions with v1.5.8.9 information
- All features now fully functional (Copy URL, Copy Text, Open in New Tab, Quick
  Tab creation)

### What's New in v1.5.8.7?

✅ **Enhanced Code Quality Infrastructure**

- Added comprehensive GitHub Actions workflows for code quality checks
- Integrated DeepSource for advanced static analysis and security scanning
- Added ESLint, Prettier, and Jest configurations for better code consistency
- CodeQL security analysis for vulnerability detection
- Automated test coverage tracking with Codecov
- Web extension validation with Mozilla's web-ext tool
- All workflows optimized to work with GitHub Copilot for enhanced code reviews

✅ **Improved Debugging Capabilities**

- Added aggressive logging throughout initialization process
- Enhanced error handling with detailed error messages
- Global error handlers for unhandled exceptions and promise rejections
- Defensive fallbacks in ConfigManager for robust configuration loading
- Debug markers to verify script execution at critical points
- Comprehensive debugging guide added to README
- Build validation checks to prevent ES6 import/export issues

✅ **Better Development Experience**

- Created barrel files (index.js) for cleaner module imports
- Enhanced build process with bundle integrity validation
- Improved CI/CD pipeline with sanity checks
- Better error messages for troubleshooting
- Development-focused documentation updates

### What's New in v1.5.8.2?

✅ **Modular Architecture Refactoring**

- Complete refactoring of content.js from monolithic 180KB file to modular
  structure
- URL handlers extracted into 11 categorized modules (social-media, video,
  developer, blogging, ecommerce, image-design, news-discussion, entertainment,
  gaming, learning, other)
- Core functionality separated into reusable modules (config, state, events,
  utilities)
- Build system using Rollup for optimized bundling
- Reduced bundled content.js to 63KB (65% size reduction!)
- Improved maintainability and code organization
- Easier for developers to contribute and extend functionality
- All 104 URL handler functions preserved and working
- Foundation for future feature additions without bloating core code

### What's New in v1.5.8.1?

✅ **Floating Quick Tabs Manager Panel**

- Replaced Firefox sidebar with persistent floating panel
- Works in Zen Browser where sidebar API is disabled
- Draggable panel with Pointer Events API (no slipping!)
- Resizable from all edges and corners with min/max constraints
- Position and size persist across sessions via browser.storage.local
- Container-aware categorization with visual indicators
- Action buttons: "Close Minimized" and "Close All"
- "Go to Tab" button to switch to the tab containing a Quick Tab
- Press `Ctrl+Alt+Z` (or `Cmd+Option+Z` on Mac) to toggle panel
- Panel survives page navigation (re-injected on each page load)
- Auto-refresh every 2 seconds to stay in sync with Quick Tabs

✅ **Zen Browser Compatibility**

- Extension now works fully in Zen Browser
- No dependency on Firefox Sidebar API
- Panel injected via content script for universal compatibility

## 🚀 Installation

### Easy Installation (Recommended)

1. Go to the
   [Releases page](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition/releases)
2. Download the latest `copy-url-hover-extension.xpi`
3. Open Firefox/Zen Browser → `about:addons`
4. Click gear icon (⚙️) → "Install Add-on From File..."
5. Select the `.xpi` file and confirm

**Auto-updates enabled** - You'll be notified when new versions are available.

### Manual Installation (Development)

1. Navigate to `about:debugging` in Firefox
2. Click "This Firefox" → "Load Temporary Add-on"
3. Select `manifest.json` from the extension folder
4. Extension loaded! (Removed on browser restart)

## 📖 Usage

### Basic Copy Functions

1. Hover over any link
2. Press:
   - **Y** - Copy URL
   - **X** - Copy link text
   - **O** - Open in new tab
3. Notification confirms the action

### Quick Tabs

1. Hover over a link
2. Press **Q** to open Quick Tab
3. Use controls:
   - **🔗** Open in new tab (opens Quick Tab content in browser tab)
   - **📍/📌** Pin to current page (pin/unpin toggle)
   - **−** Minimize to sidebar
   - **✕** Close
4. **Drag** title bar to move (uses Pointer Events - no slipping!)
5. **Resize** from any edge or corner (8 handles total)
6. **Pin** to keep Quick Tab only on specific pages (pinned tabs won't show on
   other pages)
7. **Press Esc** to close all Quick Tabs (slot numbers reset)

### Quick Tabs Manager Floating Panel (NEW v1.5.8.1)

1. **Press `Ctrl+Alt+Z`** (or `Cmd+Option+Z` on Mac) to open/close panel
2. Panel shows:
   - All Quick Tabs organized by Firefox Container
   - Green indicator (🟢) for active Quick Tabs
   - Yellow indicator (🟡) for minimized Quick Tabs
   - Tab metadata (position, size, slot number)
3. **Drag** the panel header to move it anywhere on screen
4. **Resize** the panel by dragging edges or corners (min 250×300)
5. **Click** on any Quick Tab to:
   - **🔗 Go to Tab** - Switch to the browser tab containing this Quick Tab
   - **➖ Minimize** - Minimize an active Quick Tab
   - **↑ Restore** - Restore a minimized Quick Tab to original position
   - **✕ Close** - Close the Quick Tab
6. **Action Buttons**:
   - **Close Minimized** - Close all minimized Quick Tabs
   - **Close All** - Close ALL Quick Tabs (active + minimized)
7. Panel updates in real-time as Quick Tabs change
8. Position and size persist across page navigation and browser restarts
9. **Press Esc** to close all Quick Tabs (slot numbers reset)

### Debug Mode

Enable in settings to see:

- **Slot numbers** on Quick Tab toolbars (e.g., "Slot 1", "Slot 2")
- Slot numbers reset when all Quick Tabs are closed (Esc or Clear Storage)
- Slot numbers stay consistent across tab switches
- Enhanced console logging with [POINTER] tags for drag/resize events

## ⚙️ Settings

Access settings by clicking the extension icon. Organized into 4 tabs:

### Copy URL Tab

- Keyboard shortcuts for copy URL, copy text, open in new tab
- Modifier keys (Ctrl, Alt, Shift)

### Quick Tabs Tab

- Quick Tab keyboard shortcut (default: Q)
- Close all shortcut (default: Escape)
- Max windows (1-10)
- Default size and position
- Close on open toggle (close Quick Tab when opening in new tab)
- **Note:** Quick Tabs always persist across browser tabs (no toggle needed)

### Appearance Tab

- Notification style (tooltip or notification)
- Colors, borders, animations
- Position and size
- Dark mode toggle
- Debug mode toggle

### Advanced Tab

- Clear Quick Tab Storage (also resets slot numbers!)
- Reset settings to defaults

## 🔒 Security Notice

**Manifest v2 Required**: This extension uses Manifest v2 to access the full
`webRequest` API with `webRequestBlocking` permission. This allows the extension
to modify X-Frame-Options and CSP headers for Quick Tabs to display any website
in iframes.

**X-Frame-Options Bypass**: The extension removes X-Frame-Options and CSP
frame-ancestors headers to allow Quick Tabs to display any website in iframes.
This is necessary for universal compatibility but removes clickjacking
protection for iframed content.

**Firefox Container Isolation (v1.5.7+)**: Quick Tabs now respect Firefox
Container boundaries, providing an additional layer of isolation for sensitive
browsing contexts (e.g., Banking, Work containers).

**Use at your own discretion.** Only open Quick Tabs from trusted websites or
disable the extension when browsing untrusted sites.

## 🐛 Known Limitations

1. **Quick Tab Focus**: Clicking inside a Quick Tab iframe captures keyboard
   focus. Click the main page to restore shortcuts.

2. **Nested Quick Tabs**: Only works for same-origin iframes. Use "Open in New
   Tab" button for cross-origin links.

3. **Zen Browser Themes**: Cannot detect Zen workspace themes (requires native
   API access). Use built-in dark mode instead.

4. **Manifest v2**: Extension must remain on Manifest v2 for full webRequest API
   functionality. Manifest v3 does not support `webRequestBlocking` which is
   required for header modification.

## 📚 Documentation

- **Changelogs**: See `/docs/changelogs/` for version history
- **Architecture**: See `/docs/manual/quick-tab-sync-architecture.md`
- **Pointer Events Guide**: See
  `/docs/manual/Pointer-Events-Integration-Guide.md`
- **Testing Guide**: See `/docs/manual/TESTING_GUIDE_ISSUE_51.md`

## 🔧 Debugging the Extension

If the extension is not working or appears to be in a non-functional state,
follow these steps to diagnose and fix the issue.

### Quick Debug Checklist

1. **Check if the content script is loading**:
   - Open any web page
   - Press **F12** or **Ctrl+Shift+J** to open the browser console
   - Look for logs starting with `[Copy-URL-on-Hover]`
   - You should see:
     ```
     [Copy-URL-on-Hover] Script loaded! @ 2025-11-13T04:05:38.690Z
     [Copy-URL-on-Hover] All module imports completed successfully
     [Copy-URL-on-Hover] ✓✓✓ EXTENSION FULLY INITIALIZED ✓✓✓
     ```

2. **Test the debug marker**:
   - In the console, type: `window.CUO_debug_marker`
   - Should return: `"JS executed to top of file!"`
   - If `undefined`, the script failed to load or crashed early

3. **Check initialization status**:
   - In the console, type: `window.CUO_initialized`
   - Should return: `true`
   - If `false` or `undefined`, initialization failed

### Debugging v1.5.8.6+ (Modular Architecture)

The modular architecture (v1.5.8.6+) introduced a new build system. If the
extension is not working:

#### 1. Verify Bundle Integrity

**Check for ES6 imports/exports in the built file** (these break browser
loading):

```bash
# In the extension directory
grep "^import " dist/content.js
grep "^export " dist/content.js
```

- **If you see output**: The bundle is broken! ES6 modules cannot be used
  directly in content scripts.
- **If no output**: Bundle is correctly flattened ✓

#### 2. Validate Build Output

```bash
# Check bundle size (should be ~60-80KB)
ls -lh dist/content.js

# Verify key classes are present
grep "ConfigManager" dist/content.js
grep "StateManager" dist/content.js
grep "EventBus" dist/content.js
```

All `grep` commands should return matches. If not, the build is incomplete.

#### 3. Rebuild from Scratch

```bash
# Clean and rebuild
npm run clean
npm ci  # Fresh install of dependencies
npm run build:prod

# Verify the build
ls -lh dist/
```

#### 4. Check Browser Console for Errors

Open the console and look for:

- **Syntax errors**: Usually means the bundle has ES6 imports/exports
- **Module not found**: Build didn't include all dependencies
- **Undefined variables**: Missing exports or incorrect bundling

### Common Issues and Solutions

#### Issue: Extension loads but keyboard shortcuts don't work

**Symptoms**:

- Console shows successful initialization
- No errors in console
- Pressing Y/X/Q does nothing

**Solutions**:

1. **Check if page has focus**:
   - Click on the main page (not inside a Quick Tab or address bar)
   - Quick Tabs capture keyboard focus when clicked

2. **Verify shortcuts in settings**:
   - Click extension icon → Check keyboard shortcuts
   - Make sure shortcuts aren't conflicting with page shortcuts

3. **Enable Debug Mode**:
   - Extension icon → Advanced tab → Enable Debug Mode
   - Check console for keyboard event logs

#### Issue: Quick Tabs not opening

**Symptoms**:

- Pressing Q does nothing
- No error messages

**Solutions**:

1. **Check Quick Tab settings**:
   - Extension icon → Quick Tabs tab
   - Ensure "Cross-tab persistence" is enabled
   - Try adjusting max windows setting

2. **Clear Quick Tab storage**:
   - Extension icon → Advanced tab → Clear Quick Tab Storage
   - Try opening a Quick Tab again

3. **Check for iframe restrictions**:
   - Some sites block iframes (e.g., banks, government sites)
   - Try on a different site (e.g., Wikipedia, GitHub)

#### Issue: Extension completely broken after update

**Symptoms**:

- No console logs at all
- `window.CUO_debug_marker` is undefined
- Extension icon might be grayed out

**Solutions**:

1. **Verify installation**:
   - Go to `about:addons`
   - Check if extension is enabled
   - Check for error messages

2. **Check manifest.json**:

   ```bash
   # Verify manifest in dist/
   cat dist/manifest.json
   ```

   - Should show version 1.5.8.7 or higher
   - Should have `"manifest_version": 2`
   - Should have content_scripts pointing to `"content.js"`

3. **Reinstall the extension**:
   - Download latest .xpi from
     [Releases](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition/releases)
   - Uninstall old version from `about:addons`
   - Install new .xpi file

4. **Check Firefox version**:
   - Extension requires Firefox 115+ for all features
   - Some features use `browser.storage.session` (Firefox 115+)

#### Issue: Extension works but no notifications appear

**Symptoms**:

- Keyboard shortcuts work (URL is copied)
- No visual feedback

**Solutions**:

1. **Check notification settings**:
   - Extension icon → Appearance tab
   - Ensure "Show notification" is enabled
   - Try different notification styles (tooltip vs notification)

2. **Check site CSP**:
   - Some sites block injected content via Content Security Policy
   - Try on a different site

### Advanced Debugging

#### Enable Maximum Logging

1. **Enable Debug Mode**:
   - Extension icon → Advanced tab → Enable Debug Mode
2. **Check all log categories**:

   ```javascript
   // In browser console
   // Shows all extension state
   window.CUO_debug_marker;
   window.CUO_initialized;

   // Force enable debug (temporary)
   localStorage.setItem('debugMode', 'true');
   ```

3. **Monitor initialization steps**:
   - Look for logs with `STEP:` prefix
   - Shows exactly where initialization stops if it fails

#### Check Storage State

```javascript
// In browser console
// Check configuration
browser.storage.local.get().then(console.log);

// Check Quick Tab state
browser.storage.sync.get('quick_tabs_state_v2').then(console.log);

// Check session state (Firefox 115+)
browser.storage.session.get().then(console.log);
```

#### Test with Minimal Content Script

If all else fails, create a minimal test:

1. **Create test file** `test-content.js`:

   ```javascript
   alert('Extension content script is running!');
   console.log('Extension test script loaded');
   ```

2. **Temporarily modify manifest.json**:

   ```json
   "content_scripts": [{
     "matches": ["<all_urls>"],
     "js": ["test-content.js"],
     "run_at": "document_idle"
   }]
   ```

3. **Reload extension** and visit any page
   - If alert appears: Extension loading works, issue is in main code
   - If no alert: Extension installation or manifest is broken

### Error Messages Reference

| Error Message                            | Meaning                    | Solution                                            |
| ---------------------------------------- | -------------------------- | --------------------------------------------------- |
| `browser.storage.local is not available` | Browser API not accessible | Check Firefox version, reload extension             |
| `import` or `export` in bundle           | Build is broken            | Rebuild: `npm run clean && npm run build:prod`      |
| `ConfigManager is not defined`           | Bundle missing classes     | Rebuild with all dependencies                       |
| `CRITICAL INITIALIZATION ERROR`          | Init failed                | Check console for specific error, rebuild if needed |
| No logs at all                           | Script not loading         | Check manifest.json, verify file paths              |

### Getting Help

If none of these steps work:

1. **Collect diagnostic info**:
   - Firefox version
   - Extension version
   - Full browser console output (copy all logs)
   - Steps to reproduce

2. **Open an issue** on GitHub with:
   - Diagnostic info from step 1
   - What you've already tried
   - Screenshots of console errors

## 🛠️ Development

### Releasing a New Version

1. Update `version` in `manifest.json`
2. Commit changes
3. Create and push git tag:
   ```bash
   git tag v1.x.x
   git push origin v1.x.x
   ```
4. GitHub Actions builds `.xpi` and creates release
5. Users receive auto-update notifications

### Testing

See `/docs/manual/TESTING_GUIDE_ISSUE_51.md` for comprehensive testing
procedures.

### API Framework

**v1.5.8.1** uses modern browser APIs for optimal performance:

- **Content Script Injection** - Persistent floating panel injected into page
  DOM
- **Pointer Events API** (setPointerCapture) - Drag/resize without slipping
- **Firefox Container API** (contextualIdentities) - Container-aware state
  management
- **BroadcastChannel API** - Real-time same-origin synchronization
- **browser.runtime messaging** - Cross-origin coordination
- **browser.storage.sync** - Persistent state across devices
- **browser.storage.local** - Panel position and size persistence
- **browser.storage.session** - Fast ephemeral state (Firefox 115+)
- **Commands API** - Keyboard shortcuts (e.g., Ctrl+Alt+Z for panel toggle)

## 🌐 Supported Websites (100+)

Optimized handlers for:

- Social Media (Twitter/X, Reddit, LinkedIn, Instagram, Facebook, etc.)
- Video Platforms (YouTube, Vimeo, Twitch, etc.)
- Developer Platforms (GitHub, GitLab, Stack Overflow, etc.)
- E-commerce (Amazon, eBay, Etsy, etc.)
- News & Blogs (Medium, Dev.to, Hashnode, etc.)
- And many more!

**Plus generic fallback handler for any website.**

## 📝 Notes

- This extension was coded by AI as a personal project
- Not affiliated with Mozilla or Firefox
- Respects Content Security Policies (won't work on restricted Mozilla pages)
- **Requires Manifest v2** for full webRequest API access

## 📄 License

See repository for license information.

---

**Current Version**: 1.5.9.4  
**Last Updated**: 2025-11-15  
**Repository**: [ChunkyNosher/copy-URL-on-hover_ChunkyEdition](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition)
