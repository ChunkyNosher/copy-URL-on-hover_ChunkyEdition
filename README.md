# Cross-Browser Extension: Copy URL on Hover

**Version 1.6.4-v3** - A feature-rich **Firefox/Chrome/Chromium** extension for
quick URL copying and advanced Quick Tab management with **Per-Tab Isolation**,
**Container Isolation**, and Session-Only Quick Tabs.

**🌐 Cross-Browser Support:** Now compatible with Firefox, Chrome, Edge, Brave,
Opera, and other Chromium-based browsers using Manifest v2 with
webextension-polyfill.

**🔧 v1.6.4-v3 Status:** Metrics on All Tabs ✅ | Transfer Sync ✅ | Footer
Fixed ✅

This is a complete, customizable Firefox extension that allows you to copy URLs
or link text by pressing keyboard shortcuts while hovering over links, plus
powerful Quick Tabs for browsing links in floating, draggable iframe windows.

## 🎉 What's New in v1.6.4-v3

**🔧 Log Action Metrics + Transfer Sync Fix + Footer Visibility ✅**

- ✅ **Live Log Action Metrics** - Quick Tab Manager shows Quick Tab count, log
  actions per second, and total log actions
- ✅ **Expandable Category Breakdown** - Click metrics to expand/collapse
  per-category log counts (User Actions, System Ops, Diagnostics)
- ✅ **Filter-Aware Log Counting** - Metrics only count logs for enabled filter
  categories in Live Console Output Filters
- ✅ **Configurable Metrics Interval** - Update frequency from 500ms to 30
  seconds
- ✅ **Metrics Toggle** - Enable/disable live metrics in settings
- ✅ **Metrics on All Tabs** - Metrics footer visible on both Manager and
  Settings tabs
- ✅ **Footer Visibility** - Save/Reset buttons hidden on Manager tab, shown
  only on Settings tabs
- ✅ **Cross-Tab Transfer Final Fix** - Immediate state refresh after
  transfer/duplicate ACK
- ✅ **Total Logs Reset Fix** - "Clear Log History" now resets total log count

## 🎉 What's New in v1.6.4-v2

**🔧 Title Updates + State Sync + Bug Fixes ✅**

- ✅ **Quick Tab Title Updates** - Titles now update from link text to actual
  page title after iframe loads
- ✅ **Move to Current Tab Fix** - Quick Tabs properly appear in Manager after
  transfer
- ✅ **Last Quick Tab Close Fix** - Manager properly reflects when all Quick
  Tabs are closed
- ✅ **Navigation Title Updates** - Manager updates when navigating within Quick
  Tab
- ✅ **Open in New Tab Fix** - Button now closes Quick Tab after opening URL
- ✅ **Cross-Tab Transfer Fix** - Fixed duplicate messages causing UI desyncs
- ✅ **UI Flicker Fix** - Optimistic UI for smooth close animations
- ✅ **Code Health Improvements** - window.js, VisibilityHandler.js, content.js
  all above 9.0
- ✅ **New StorageChangeAnalyzer Module** - Extracted from quick-tabs-manager.js

## 🎉 What's New in v1.6.4

**🔧 Drag-and-Drop Manager + Cross-Tab Transfer + Bug Fixes ✅**

- ✅ **Drag-and-Drop Reordering** - Reorder tabs and Quick Tabs in Manager via
  drag-and-drop
- ✅ **Cross-Tab Transfer** - Drag Quick Tab from one tab to another to transfer
  it
- ✅ **Duplicate via Shift+Drag** - Hold Shift while dragging to duplicate
  instead of move
- ✅ **Move to Current Tab Button** - Replaces "Go to Tab" for Quick Tab items
- ✅ **Tab Group Actions** - "Go to Tab" and "Close All in Tab" buttons per
  group
- ✅ **Open in New Tab Button** - Per Quick Tab (↗️) in Manager
- ✅ **Click-to-Front** - Quick Tabs come to front on click (not just drag)
- ✅ **Open in New Tab Fix** - Added `openTab` to MessageRouter allowlist
- ✅ **Manager Reordering Persistence** - Tab group order now persists
- ✅ **Smaller count indicator** - Bigger number in smaller container

**Settings Changes:**

- New "Duplicate Modifier Key" dropdown: Shift (default), Ctrl, None
- Alt option removed (doesn't work reliably)

---

## 🎉 Previous Releases

**v1.6.3.12-v13:** Resize/Move Sync Fix, UI Flicker Fix, Helper Extraction  
**v1.6.3.12-v12:** Button Operation Fix, Cross-Tab Display, Code Health 8.54  
**v1.6.3.12-v11:** Cross-Tab Display Fix, Options Page Async Guard  
**v1.6.3.12-v10:** Port Routing Fix, Manager Button Operations  
**v1.6.3.12-v9:** Comprehensive Logging, Optimistic UI, Orphan Recovery UI

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
✓ **Container Isolation** - Firefox Container support with originContainerId  
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
npm install && npm run build    # Build
npm test                        # Run tests
npm run lint                    # Lint
```

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

**Version 1.6.4** | [Changelog](docs/CHANGELOG.md) |
[GitHub](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition) |
[Issues](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition/issues)
