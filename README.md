# Cross-Browser Extension: Copy URL on Hover

**Version 1.6.4-v7** - A feature-rich **Firefox/Chrome/Chromium** extension for
quick URL copying and advanced Quick Tab management with **Per-Tab Isolation**,
**Container Isolation**, and Session-Only Quick Tabs.

**🌐 Cross-Browser Support:** Now compatible with Firefox, Chrome, Edge, Brave,
Opera, and other Chromium-based browsers using Manifest v2 with
webextension-polyfill.

**🔧 v1.6.4-v7 Status:** Clean URL Copying ✅ | Dark Mode UI ✅ | Performance
Optimization ✅

This is a complete, customizable Firefox extension that allows you to copy URLs
or link text by pressing keyboard shortcuts while hovering over links, plus
powerful Quick Tabs for browsing links in floating, draggable iframe windows.

## 🎉 What's New in v1.6.4-v7

**🧹 Clean URL Copying + 🌙 Dark Mode UI + ⚡ Performance ✅**

- ✅ **Clean URL Copying** - Automatically strips 90+ tracking parameters (UTM,
  Facebook, Google, Amazon, YouTube) when copying URLs
- ✅ **Copy Raw URL Shortcut** - New unbound shortcut to copy URLs with all
  parameters intact (configure in settings)
- ✅ **Dark Mode First UI** - Complete UI overhaul with modern dark-mode-first
  design (#121212 backgrounds, #6c5ce7 purple-blue accent)
- ✅ **Glass-Morphism Quick Tabs** - In-page Quick Tab windows with sleek dark
  styling and backdrop-filter effects
- ✅ **Performance: Debug-Gated Logging** - Console output reduced by ~29% via
  debug mode checks (no more log spam in production)
- ✅ **Performance: State Broadcast Dedup** - Hash-based change detection
  eliminates redundant STATE_CHANGED messages
- ✅ **Performance: Render Debouncing** - 16ms debounce batches rapid render
  requests for smoother sidebar updates
- ✅ **ESLint Clean** - All 25 ESLint warnings/errors resolved (0 remaining)
- ✅ **Code Cleanup** - Removed unused variables and functions across codebase

## 🎉 What's New in v1.6.4-v5

**🔧 Go to Tab Cross-Container Fix + Toggle Sidebar + Minimized Transfer ✅**

- ✅ **Go to Tab Same-Container Fix** - Sidebar stays open when switching to
  tabs in the same Firefox Container
- ✅ **Go to Tab Cross-Container Reopen** - For "All Containers" view, sidebar
  closes, switches tab, then reopens after 300ms for continued management
- ✅ **Toggle Quick Tabs Manager Context Menu** - Right-click to toggle sidebar
  via `browser.sidebarAction.toggle()` API
- ✅ **Minimized Quick Tab Transfer Restore** - Minimized Quick Tabs can now be
  restored after cross-tab transfer (previously required
  restore-minimize-restore)
- ✅ **Minimized Transfer Restore Fix** - Fixed `result?.tabWindow` to `result`
  since `createQuickTab()` returns `tabWindow` directly
- ✅ **Minimized Transfer Tab ID Fix** - `storeTransferredSnapshot()` accepts
  destination tab ID; fixes restore reverting to old tab
- ✅ **Go to Tab Error Handling** - Added `.catch()` error handler; uses
  container-aware `_handleGoToTabGroup()` for consistency
- ✅ **Clear Log History Confirmation** - Added `confirm()` dialog before
  clearing logs with detailed warning message
- ✅ **Clear Log History Counts** - Shows "X background logs" and "logs from Y
  tabs" or "No cached logs were present"
- ✅ **Log Metrics Footer Persistence** - Total log count persists to
  `storage.local` with 2000ms debounce (survives sidebar close/reopen)
- ✅ **Minimized Transfer Display Fix** - UICoordinator orphan recovery updates
  `display: flex`, `visibility: visible`, `opacity: 1` after restore
- ✅ **Metrics Flush on Sidebar Close** - `beforeunload` handler flushes pending
  debounced saves immediately before sidebar closes
- ✅ **Zen Browser Compatibility** - Improved focus handling for Firefox-based
  browsers with custom "spaces" features

## 🎉 What's New in v1.6.4-v4

**🔧 Container Filter for Quick Tabs Manager ✅**

- ✅ **Container Filter Dropdown** - Filter Quick Tabs by Firefox Container in
  Manager header
- ✅ **Container-Based Filtering** - Quick Tabs filtered by current tab's
  container by default
- ✅ **Container Name Resolution** - Shows actual container names (Shopping,
  Research, Work) instead of "Firefox Container 1, 2, 3"
- ✅ **Dynamic Container Indicator** - Updates when switching to tabs in
  different containers
- ✅ **"All Containers" Option** - View Quick Tabs across all containers via
  dropdown
- ✅ **Filter Preference Persistence** - Container filter selection saved to
  storage

## 🎉 What's New in v1.6.4-v3

**🔧 Log Metrics + Transfer Fix ✅** - Live metrics footer, cross-tab transfer
sync, single metrics display, reduced logging

## 🎉 What's New in v1.6.4-v2

**🔧 Title Updates + State Sync ✅** - Quick Tab titles update from page,
transfer/close fixes, UI flicker fix, Code Health 9.0+

## 🎉 What's New in v1.6.4

**🔧 Drag-and-Drop Manager + Cross-Tab Transfer ✅**

- ✅ **Drag-and-Drop Reordering** - Reorder tabs and Quick Tabs via
  drag-and-drop
- ✅ **Cross-Tab Transfer** - Drag Quick Tab from one tab to another
- ✅ **Duplicate via Shift+Drag** - Hold Shift while dragging to duplicate
- ✅ **Move to Current Tab Button** - Replaces "Go to Tab" for Quick Tab items
- ✅ **Tab Group Actions** - "Go to Tab" and "Close All in Tab" per group
- ✅ **Click-to-Front** - Quick Tabs come to front on click

---

## 🎉 Previous Releases

See [docs/CHANGELOG.md](docs/CHANGELOG.md) for complete version history.

---

## 🎯 Firefox Sidebar Integration

**Unified Settings Sidebar for Firefox** - All settings and Quick Tabs Manager
in the sidebar!

- **Firefox:** Click toolbar button OR press `Alt+Shift+S` to open sidebar
- **Chrome/Edge/Brave:** Traditional popup (toolbar button) + Extension Options
- **Quick Tabs Manager:** `Alt+Shift+Z` or `Ctrl+Alt+Z` to toggle

---

## 🏗️ Architecture (v1.6.0+)

**Domain-Driven Design with Background-as-Coordinator**

- **QuickTab Domain Entity** - Pure business logic (100% test coverage)
- **Storage Abstraction Layer** - Async-first adapters (92% coverage)
- **Phase 1 COMPLETE** - 96% average coverage, 249 tests

---

## ✨ Key Features

✓ Quick URL Copying with keyboard shortcuts (Y, X, O)  
✓ Quick Tabs - Floating, draggable, resizable iframe windows  
✓ **Container Isolation** - Firefox Container support with originContainerId +
Container Filter dropdown  
✓ **Session-Only Quick Tabs** - Start fresh each browser session (v1.6.3.12)  
✓ **Shadow DOM Support** - YouTube, Twitter, Instagram, TikTok  
✓ **Port Messaging** - `'quick-tabs-port'` for reliable Quick Tabs sync
(v1.6.3.12)  
✓ **Tabs API Events** - Automatic cleanup on tab close, metadata sync  
✓ Floating Quick Tabs Manager - Persistent draggable panel (Ctrl+Alt+Z)  
✓ 100+ Site-Specific Handlers  
✓ Dark Mode support  
✓ Auto-Updates via GitHub releases

## 🚀 Installation

### Firefox/Zen Browser (Recommended)

1. Go to
   [Releases](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition/releases)
2. Download latest `firefox-extension-vX.X.X.xpi` file
3. Open Firefox/Zen Browser → `about:addons`
4. Click gear icon (⚙️) → "Install Add-on From File..."
5. Select the `.xpi` file and confirm

**Auto-updates enabled** - Extension will notify you of new versions
automatically.

### Chrome/Edge/Brave/Opera

1. Go to
   [Releases](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition/releases)
2. Download latest `chrome-extension-vX.X.X.zip` file
3. Extract the ZIP file to a permanent folder
4. Open browser extensions page (`chrome://extensions/` etc.)
5. Enable "Developer mode" and click "Load unpacked"

## 🌐 Browser Compatibility

| Feature             | Firefox/Zen       | Chrome/Edge/Brave/Opera     |
| ------------------- | ----------------- | --------------------------- |
| Copy URL (Y key)    | ✅                | ✅                          |
| Quick Tabs          | ✅                | ✅                          |
| Container Isolation | ✅                | ⚠️ Single default container |
| Sidebar Settings    | ✅ Native sidebar | ⚠️ Traditional popup        |

## 📖 Usage

**Basic Copy Functions:** Hover over link → Press **Y** (URL), **X** (text), or
**O** (open)

**Quick Tabs:** Hover → **Q** to open → Drag/resize → **Esc** to close all

**Quick Tabs Manager:** **Ctrl+Alt+Z** to toggle panel

## 🔒 Security Notice

Uses Manifest v2 for `webRequestBlocking` to modify X-Frame-Options/CSP headers.
**Only open Quick Tabs from trusted websites.**

## 🛠️ Development

```bash
npm install && npm run build    # Build (Vite)
npm test                        # Run tests
npm run lint                    # Lint
```

The Vite build pipeline bundles `background.js` and `src/content.js` as IIFEs,
then statically copies manifest, icons, popup/options pages, and sidebar assets
into `dist/`.

## 📝 Notes

- Quick Tabs are session-only and cleared on browser restart (`storage.local` +
  startup cleanup)
- Container isolation prevents cross-container state leaks
- Port messaging ensures reliable Quick Tabs sync across tabs
- Background script is single source of truth for all Quick Tabs data
- Port circuit breaker limits reconnection attempts to max 10 with backoff
- Circuit breaker auto-resets after 60 seconds of inactivity
- Sequence tracking ensures FIFO ordering resilience for messages

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

**Version 1.6.4-v5** | [Changelog](docs/CHANGELOG.md) |
[GitHub](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition) |
[Issues](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition/issues)
