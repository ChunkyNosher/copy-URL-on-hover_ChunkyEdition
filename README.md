# Cross-Browser Extension: Copy URL on Hover

**Version 1.6.3.12-v3** - A feature-rich **Firefox/Chrome/Chromium** extension for
quick URL copying and advanced Quick Tab management with **Per-Tab Isolation**,
**Container Isolation**, and Session-Only Quick Tabs.

**🌐 Cross-Browser Support:** Now compatible with Firefox, Chrome, Edge, Brave,
Opera, and other Chromium-based browsers using Manifest v2 with
webextension-polyfill.

**🔧 v1.6.3.12-v3 Status:** Option 4 Architecture ✅ | Critical Bug Fixes ✅ |
Logging Gaps Fixed ✅ | Code Health 9.0+ ✅ | 1,971+ Tests Passing

This is a complete, customizable Firefox extension that allows you to copy URLs
or link text by pressing keyboard shortcuts while hovering over links, plus
powerful Quick Tabs for browsing links in floating, draggable iframe windows.

## 🎉 What's New in v1.6.3.12-v3

**🔧 Critical Bug Fixes + Logging Gaps ✅**

- ✅ **Container ID Resolution** - CreateHandler queries Identity system via
  `getWritingContainerId()` at creation time (fixes container mismatch)
- ✅ **storage.session API Fix** - Properly guards MV2 incompatible code
- ✅ **Context Detection Fix** - `setWritingTabId()` receives proper context
- ✅ **Manager Refresh Fix** - UICoordinator notifies sidebar via STATE_CHANGED
- ✅ **Logging Gaps #1-8** - Port lifecycle, correlation IDs, health monitoring,
  write queue state, debounce timing, end-to-end sync paths
- ✅ **Test Bridge API** - Container verification methods for E2E testing
- ✅ **Code Health 9.0+** - background.js, quick-tabs-manager.js, index.js

---

## 🎉 Previous Releases

**v1.6.3.12-v2:** Port diagnostics, QUICKTAB_MINIMIZED forwarding, port roundtrip
tracking  
**v1.6.3.12:** Option 4 Architecture, port messaging, memory-based state,
push notifications  
**v1.6.3.11-v12:** Solo/Mute removed, session-only Quick Tabs, version-based log
cleanup  
**v1.6.3.11-v11:** Container identity fix, message diagnostics, Code Health 10.0

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

- Quick Tabs are session-only and cleared on browser close (in-memory storage)
- Container isolation prevents cross-container state leaks
- Port messaging ensures reliable Quick Tabs sync across tabs
- Background script is single source of truth for all Quick Tabs data

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

**Version 1.6.3.12-v3** | [Changelog](docs/CHANGELOG.md) |
[GitHub](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition) |
[Issues](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition/issues)
