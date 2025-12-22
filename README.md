# Cross-Browser Extension: Copy URL on Hover

**Version 1.6.3.11-v4** - A feature-rich **Firefox/Chrome/Chromium** extension
for quick URL copying and advanced Quick Tab management with **Solo/Mute
visibility control**, **Per-Tab Isolation**, **Container Isolation**, Session
Quick Tabs, and Persistent Floating Panel Manager.

**🌐 Cross-Browser Support:** Now compatible with Firefox, Chrome, Edge, Brave,
Opera, and other Chromium-based browsers using Manifest v2 with
webextension-polyfill.

**🔧 v1.6.3.11-v4 Status:** 22 Issues Fixed ✅

This is a complete, customizable Firefox extension that allows you to copy URLs
or link text by pressing keyboard shortcuts while hovering over links, plus
powerful Quick Tabs for browsing links in floating, draggable iframe windows.

## 🎉 What's New in v1.6.3.11-v4

**🔧 22 Issues Fixed - 4 Phases (December 2025) ✅**

**Phase 1: Keyboard Shortcut & Settings (5 Issues):**

- ✅ **browser.commands.onCommand** - Listener in background.js
- ✅ **Dynamic Shortcut Updates** - browser.commands.update() integration
- ✅ **Firefox Format Validation** - Keyboard shortcut state validation
- ✅ **Sidebar-to-Commands API** - Connected settings with UI feedback

**Phase 2: Hover Detection & Shadow DOM (5 Issues):**

- ✅ **Shadow DOM Detection** - YouTube, Twitter, Instagram, TikTok support
- ✅ **Event Debouncing** - 100ms debounce, CPU 40-60% → 5-10%
- ✅ **Pointer Events API** - Migration from mouse events with passive listeners
- ✅ **New Module** - src/utils/shadow-dom.js for Shadow DOM traversal

**Phase 3: Logging & Instrumentation (6 Issues):**

- ✅ **Content Pipeline Logging** - Event tracking throughout content script
- ✅ **Event Bus Visibility** - [LISTENER_REG], [LISTENER_INVOKE],
  [EVENT_COMPLETE]
- ✅ **Storage Timing Telemetry** - Warns if operations >100ms
- ✅ **Error Context Augmentation** - Handler name, operation, request context

**Phase 4: Cross-Component Integration (6 Issues):**

- ✅ **Content Storage Sync** - storage.onChanged with [STORAGE_SYNC] prefix
- ✅ **Operation Acknowledgment** - { success, operation, details } pattern
- ✅ **Error Recovery** - Exponential backoff in content scripts
- ✅ **Multi-Tab Reconciliation** - [CROSS_TAB_SYNC] prefix

---

## 🎉 What's New in v1.6.3.11-v3

**🔧 55+ Issues Fixed (December 2025) ✅**

- ✅ HEARTBEAT Handler, Re-entrance Queue, Message Structure Validation
- ✅ pendingMessages Cleared, State Machine Persistence, Memory Leak Fix
- ✅ sendMessageWithTimeout(), Adaptive Handshake, BFCache Message Queue
- ✅ Dedup Window 100ms, Content Hash Dedup Key, Enhanced Rejection Logging
- ✅ Storage Write Verification, Format Detection, Migration Validation

---

## 🎉 Previous Releases

**v1.6.3.11-v2:** 40 Issues Fixed - BFCache, Tab ID, Hydration improvements  
**v1.6.3.11:** 40 Issues Fixed - GET_CURRENT_TAB_ID, listener registration  
**v1.6.3.10-v11:** Extended Tab ID, OPERATION_TYPE, LRU Map Guard  
**v1.6.3.10-v10:** Tab ID backoff, checkpoint system, message timeout

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
✓ **Solo/Mute Visibility Control** - Tab-specific Quick Tab visibility  
✓ **Container Isolation** - Firefox Container support with originContainerId  
✓ **Session Quick Tabs** - Auto-clear on browser close (v1.6.3.7-v3)  
✓ **Shadow DOM Support** - YouTube, Twitter, Instagram, TikTok (v1.6.3.11-v4)  
✓ **Tabs API Events** - Automatic cleanup on tab close, metadata sync  
✓ Floating Quick Tabs Manager - Persistent draggable panel (Ctrl+Alt+Z)  
✓ **Cross-Tab Sync via storage.onChanged** (Stateless, NO BroadcastChannel)  
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
| Solo/Mute           | ✅                | ✅ (global only)            |
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

- Quick Tabs persist across browser tabs automatically
- Session Quick Tabs clear on browser close (`permanent: false`)
- Container isolation prevents cross-container state leaks
- Solo/Mute features replace old "Pin to Page" functionality

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

**Version 1.6.3.11-v4** | [Changelog](docs/CHANGELOG.md) |
[GitHub](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition) |
[Issues](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition/issues)
