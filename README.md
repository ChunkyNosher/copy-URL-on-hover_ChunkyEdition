# Cross-Browser Extension: Copy URL on Hover

**Version 1.6.3.9-v4** - A feature-rich **Firefox/Chrome/Chromium** extension
for quick URL copying and advanced Quick Tab management with **Solo/Mute
visibility control**, **Per-Tab Isolation**, **Container Isolation**, Session
Quick Tabs, and Persistent Floating Panel Manager.

**🌐 Cross-Browser Support:** Now compatible with Firefox, Chrome, Edge, Brave,
Opera, and other Chromium-based browsers using Manifest v2 with
webextension-polyfill.

**🔧 v1.6.3.9-v4 Status:** Architecture Simplification - ~761 lines removed ✅

This is a complete, customizable Firefox extension that allows you to copy URLs
or link text by pressing keyboard shortcuts while hovering over links, plus
powerful Quick Tabs for browsing links in floating, draggable iframe windows.

## 🎉 What's New in v1.6.3.9-v4

**🔧 Architecture Simplification (December 2025) ✅**

- ✅ **~761 Lines Removed** - Port stubs, BroadcastChannel stubs, complex init
- ✅ **Centralized Constants** - `src/constants.js` expanded (+225 lines)
- ✅ **Single Barrier Init** - Replaces multi-phase initialization
- ✅ **Render Queue Debounce** - 100ms debounce with revision deduplication
- ✅ **Storage Health Check** - Fallback polling every 5s
- ✅ **State Checksum** - `_computeStateChecksum()` for data integrity
- ✅ **Simplified Persistence** - `_persistToStorage()` with validation
- ✅ **Orphan Removal** - Cleanup now removes orphans instead of marking

---

## 🎉 What's New in v1.6.3.9-v3

**🔧 Issue #47 Comprehensive Fixes (December 2025) ✅**

- ✅ **Dual Architecture Documentation** - MessageRouter (ACTION) vs
  message-handler (TYPE)
- ✅ **Diagnostic Logging** - STORAGE*LISTENER*\*, STATE_SYNC_MECHANISM

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

See [docs/CHANGELOG.md](docs/CHANGELOG.md) for architecture details.

---

## ✨ Key Features

✓ Quick URL Copying with keyboard shortcuts (Y, X, O)  
✓ Quick Tabs - Floating, draggable, resizable iframe windows  
✓ **Solo/Mute Visibility Control** - Tab-specific Quick Tab visibility  
✓ **Container Isolation** - Firefox Container support with originContainerId  
✓ **Session Quick Tabs** - Auto-clear on browser close (v1.6.3.7-v3)  
✓ **Tab Grouping** - tabs.group() API support, Firefox 138+ (v1.6.3.7-v3)  
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
3. Extract the ZIP file to a permanent folder (don't delete after installation!)
4. Open browser extensions page:
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
   - Brave: `brave://extensions/`
   - Opera: `opera://extensions/`
5. Enable "Developer mode" (toggle in top-right corner)
6. Click "Load unpacked" and select the extracted folder

**Note:** Chrome/Chromium-based browsers don't support auto-updates for manually
installed extensions. Check the
[Releases](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition/releases)
page for updates.

### Manual Installation (Development)

**Firefox:**

1. Navigate to `about:debugging` in Firefox
2. Click "This Firefox" → "Load Temporary Add-on"
3. Select `manifest.json` from the extension folder
4. Extension loaded (removed on browser restart)

**Chrome/Chromium:**

1. Navigate to `chrome://extensions/`
2. Enable "Developer mode" (top-right toggle)
3. Click "Load unpacked"
4. Select the extension's `dist/` directory

## 🌐 Browser Compatibility

### Fully Supported

✅ **Firefox** - All features including Firefox Container isolation  
✅ **Zen Browser** - Full Firefox-based feature set  
✅ **Chrome/Chromium** - Core features (containers degrade to single default
container)  
✅ **Edge** - Chrome-compatible, all core features work  
✅ **Brave** - Chrome-compatible, all core features work  
✅ **Opera** - Chrome-compatible, all core features work

### Feature Matrix

| Feature                 | Firefox/Zen       | Chrome/Edge/Brave/Opera     |
| ----------------------- | ----------------- | --------------------------- |
| Copy URL (Y key)        | ✅                | ✅                          |
| Copy Text (X key)       | ✅                | ✅                          |
| Quick Tabs              | ✅                | ✅                          |
| Solo/Mute               | ✅                | ✅ (global only)            |
| Container Isolation     | ✅                | ⚠️ Single default container |
| Quick Tabs Manager      | ✅                | ✅                          |
| Settings Persistence    | ✅                | ✅                          |
| **Sidebar Settings UI** | ✅ Native sidebar | ⚠️ Traditional popup        |
| **Keyboard Shortcut**   | ✅ Ctrl+Shift+S   | ⚠️ Via extensions menu      |

**Note:** Firefox Containers are a Firefox-exclusive feature. On Chrome/Chromium
browsers, all tabs are treated as a single "default" container, and Solo/Mute
works globally rather than per-container.

## 📖 Usage

**Basic Copy Functions:** Hover over link → Press **Y** (URL), **X** (text), or
**O** (open)

**Quick Tabs:** Hover → **Q** to open → Drag/resize → **Esc** to close all

**Quick Tabs Manager:** **Ctrl+Alt+Z** to toggle panel

## ⚙️ Settings

Access via extension icon or sidebar (Firefox). Tabs: Copy URL, Quick Tabs,
Appearance, Advanced.

## 🔒 Security Notice

Uses Manifest v2 for `webRequestBlocking` to modify X-Frame-Options/CSP headers.
**Only open Quick Tabs from trusted websites.**

## 🐛 Known Limitations

- Quick Tab Focus: Click main page to restore shortcuts after iframe interaction
- Nested Quick Tabs: Same-origin only; use "Open in New Tab" for cross-origin
- Manifest v2: Required for `webRequestBlocking` support

## 📚 Documentation

See [docs/CHANGELOG.md](docs/CHANGELOG.md) for version history and
[docs/manual/](docs/manual/) for architecture.

## 🛠️ Development

```bash
npm install && npm run build    # Build
npm test                        # Run tests
npm run lint                    # Lint
```

## 🌐 Supported Websites (100+)

See [docs/manual/supported-sites.md](docs/manual/supported-sites.md) for the
complete list of optimized websites including:

- Social media (Twitter, LinkedIn, Facebook, Instagram)
- Code repositories (GitHub, GitLab, Bitbucket)
- Shopping (Amazon, eBay, Walmart)
- News and media sites
- And many more...

## 📝 Notes

- Quick Tabs persist across browser tabs automatically
- Session Quick Tabs clear on browser close (`permanent: false`)
- Container isolation prevents cross-container state leaks
- Solo/Mute features replace old "Pin to Page" functionality
- All settings stored in browser.storage.sync with automatic cloud sync

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file
for details.

---

**Version 1.6.3.9-v4** | [Changelog](docs/CHANGELOG.md) |
[GitHub](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition) |
[Issues](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition/issues)
