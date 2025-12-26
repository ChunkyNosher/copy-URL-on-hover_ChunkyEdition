# Cross-Browser Extension: Copy URL on Hover

**Version 1.6.3.11-v12** - A feature-rich **Firefox/Chrome/Chromium** extension
for quick URL copying and advanced Quick Tab management with **Per-Tab
Isolation**, **Container Isolation**, and Session-Only Quick Tabs.

**🌐 Cross-Browser Support:** Now compatible with Firefox, Chrome, Edge, Brave,
Opera, and other Chromium-based browsers using Manifest v2 with
webextension-polyfill.

**🔧 v1.6.3.11-v12 Status:** Solo/Mute Removed ✅ | Session-Only Quick Tabs ✅ |
Code Health 10.0 | 1,971+ Tests Passing

This is a complete, customizable Firefox extension that allows you to copy URLs
or link text by pressing keyboard shortcuts while hovering over links, plus
powerful Quick Tabs for browsing links in floating, draggable iframe windows.

## 🎉 What's New in v1.6.3.11-v12

**🧹 Solo/Mute Feature Removal (December 2025) ✅**

The Solo (🎯) and Mute (🔇) visibility control features have been completely
removed from the Quick Tabs system. Quick Tabs are now always visible on all
tabs where they were created.

**🔄 Cross-Session Persistence Removed ✅**

Quick Tabs no longer persist across browser restarts. They are session-only and
start fresh each session for a cleaner experience.

**✨ New Features:**

- ✅ **Version-Based Log Cleanup** - Logs automatically cleared when extension
  version changes
- ✅ **Real-Time Manager Updates** - New message types for instant sync:
  - `QUICKTAB_MOVED` - Position changes
  - `QUICKTAB_RESIZED` - Size changes
  - `QUICKTAB_MINIMIZED` - Minimize state changes
  - `QUICKTAB_REMOVED` - Tab destroyed
- ✅ **Sidebar Polling Sync** - Manager polls every 3-5 seconds with staleness
  tracking
- ✅ **Scenario-Aware Logging** - Structured logging with source, container ID,
  and state changes

**Why Changes Made:**

- Simplified architecture and reduced complexity
- Solo/Mute features were not actively used by users
- Session-only tabs provide cleaner startup experience
- Improved code maintainability

---

## 🎉 Previous Releases

**v1.6.3.11-v11:** Container identity fix, message diagnostics, Code Health 10.0  
**v1.6.3.11-v9:** Diagnostic report fixes, Code Health 9.0+, logging
infrastructure  
**v1.6.3.11-v7:** Stability restoration, orphan Quick Tabs fix  
**v1.6.3.11-v5:** 23 issues fixed, error telemetry  
**v1.6.3.11-v4:** Shadow DOM detection, event debouncing  
**v1.6.3.11-v3:** 55+ issues fixed, HEARTBEAT, BFCache queue

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
✓ **Session-Only Quick Tabs** - Start fresh each browser session (v1.6.3.11-v12)  
✓ **Shadow DOM Support** - YouTube, Twitter, Instagram, TikTok (v1.6.3.11-v4)  
✓ **Firefox Critical Fixes** - BFCache, Adaptive Timeout, Load Shedding
(v1.6.3.11-v6)  
✓ **Tabs API Events** - Automatic cleanup on tab close, metadata sync  
✓ Floating Quick Tabs Manager - Persistent draggable panel (Ctrl+Alt+Z)  
✓ **Cross-Tab Sync via storage.onChanged** (Stateless, NO BroadcastChannel)  
✓ **Real-Time Manager Updates** - Position, size, minimize state sync
(v1.6.3.11-v12)  
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

- Quick Tabs are session-only and cleared on browser close (v1.6.3.11-v12)
- Container isolation prevents cross-container state leaks
- Real-time sync keeps Manager up-to-date with position/size changes

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

**Version 1.6.3.11-v12** | [Changelog](docs/CHANGELOG.md) |
[GitHub](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition) |
[Issues](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition/issues)
