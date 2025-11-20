# Firefox Extension: Copy URL on Hover

**Version 1.6.0.3** - A feature-rich Firefox/Zen Browser extension for quick URL copying and advanced Quick Tab management with **Solo/Mute visibility control**, **complete Firefox Container isolation**, and Persistent Floating Panel Manager.

**🔧 v1.6.0 Status:** Architecture refactoring Phase 1 COMPLETE ✅ (Domain + Storage layers with 96% coverage)

This is a complete, customizable Firefox extension that allows you to copy URLs or link text by pressing keyboard shortcuts while hovering over links, plus powerful Quick Tabs for browsing links in floating, draggable iframe windows.

## 🎉 What's New in v1.6.0.3

**🐛 Critical Bug Fixes (November 20, 2025) - ALL FIXED ✅**

- ✅ **Quick Tabs Not Rendering** - Fixed PanelManager initialization race condition
  - Panel element now created BEFORE state manager callbacks
  - Quick Tabs render immediately when created
- ✅ **Quick Tab Manager Panel Not Opening** - Keyboard shortcut (Ctrl+Alt+Z) now works
- ✅ **Copy Text Keyboard Shortcut Failing** - Enhanced error logging with DOMException handling

**Root Cause:** PanelManager callbacks invoked before panel DOM element existed. Fixed in ~40 lines across 5 files, fully backward compatible.

**Documentation:** [Bug Diagnosis Report](docs/manual/v1.6.0.3-bug-diagnosis-and-fix-report.md) | [Release Summary](docs/misc/v1.6.0.3-RELEASE-SUMMARY.md)

---

**🏗️ v1.6.0 Architecture Refactoring - Domain-Driven Design**

v1.6.0 represents a comprehensive architectural transformation to reduce technical debt and improve maintainability following evidence-based patterns from Mozilla, Chrome, and industry best practices.

**Phase 1: Domain Layer + Storage Abstraction (100% COMPLETE ✅)**

- ✅ **QuickTab Domain Entity** - Pure business logic (100% test coverage, 49 tests)
  - Solo/Mute visibility rules
  - Position/size/z-index management
  - Dead tab cleanup
  - Container isolation
- ✅ **Container Domain Entity** - Firefox container support (100% coverage, 34 tests)
- ✅ **Storage Abstraction Layer** - Async-first adapters (92% coverage, 76 tests)
  - SyncStorageAdapter with quota management
  - SessionStorageAdapter for temporary storage
  - Automatic fallback to local storage
  - FormatMigrator for legacy format support

**Technical Improvements:**

- Zero technical debt - Phase 1 complete with 96% average coverage
- Fast test execution - 249 tests run in <2s
- Architecture boundaries enforced by ESLint
- Bundle size monitoring (content.js <500KB, background.js <300KB)

**Status:** Phase 1 COMPLETE. Next: Phase 2.1 (QuickTabsManager decomposition). See [Phase 1 Complete Report](docs/misc/v1.6.0-REFACTORING-PHASE1-COMPLETE.md)

---

## ✨ Key Features

**Core Features:**

✓ Quick URL Copying with keyboard shortcuts  
✓ Quick Tabs - Floating, draggable, resizable iframe windows  
✓ **Solo/Mute Visibility Control** - Tab-specific Quick Tab visibility (v1.5.9.13)  
✓ **Firefox Container Isolation** - Complete container boundary respect (v1.5.9.12)  
✓ Floating Quick Tabs Manager - Persistent draggable panel (Ctrl+Alt+Z)  
✓ Cross-Tab Sync via BroadcastChannel + browser.storage  
✓ Z-Index Management - Smart layering based on interaction  
✓ Auto-Updates via GitHub releases  
✓ 100+ Site-Specific Handlers  
✓ Debug Mode with slot number tracking  
✓ Dark Mode support

**Solo/Mute Features (v1.5.9.13):**

- **Solo Mode (🎯)** - Show Quick Tab ONLY on specific browser tabs
- **Mute Mode (🔇)** - Hide Quick Tab ONLY on specific browser tabs
- Mutual exclusivity - Solo and Mute cannot be active simultaneously
- Real-time cross-tab sync (<10ms latency)
- Automatic cleanup when tabs close
- Container-aware isolation

**Quick Tabs Features:**

✓ Complete UI with favicon, dynamic title, all controls  
✓ 8-Direction resize from edges/corners  
✓ Pointer Events API for drag/resize (no escape)  
✓ Navigation controls (back, forward, reload)  
✓ Minimize to manager panel  
✓ Position/size persistence across tabs  
✓ Emergency state save on tab switches  
✓ Smart Z-Index management

## 🚀 Installation

### Easy Installation (Recommended)

1. Go to [Releases](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition/releases)
2. Download latest `copy-url-hover-extension.xpi`
3. Open Firefox/Zen Browser → `about:addons`
4. Click gear icon (⚙️) → "Install Add-on From File..."
5. Select the `.xpi` file and confirm

**Auto-updates enabled** - Notifications for new versions.

### Manual Installation (Development)

1. Navigate to `about:debugging` in Firefox
2. Click "This Firefox" → "Load Temporary Add-on"
3. Select `manifest.json` from the extension folder
4. Extension loaded (removed on browser restart)

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
   - **🔗** Open in new tab
   - **🎯/⭕** Solo mode toggle (show ONLY on this tab)
   - **🔇/🔊** Mute toggle (hide ONLY on this tab)
   - **−** Minimize to manager
   - **✕** Close
4. **Drag** title bar to move
5. **Resize** from any edge or corner
6. **Press Esc** to close all Quick Tabs

### Quick Tabs Manager Panel

1. **Press `Ctrl+Alt+Z`** to open/close panel
2. Panel shows:
   - All Quick Tabs by Firefox Container
   - 🟢 Active / 🟡 Minimized indicators
   - Tab metadata (position, size, slot)
3. **Drag** header to move
4. **Resize** by dragging edges/corners
5. **Click** Quick Tab for actions:
   - 🔗 Go to Tab
   - ➖ Minimize / ↑ Restore
   - ✕ Close
6. **Action Buttons:**
   - Close Minimized
   - Close All
7. Panel updates in real-time
8. Position/size persist across sessions

## ⚙️ Settings

Access settings by clicking the extension icon.

**Copy URL Tab:**
- Keyboard shortcuts (Y, X, O defaults)
- Modifier keys (Ctrl, Alt, Shift)

**Quick Tabs Tab:**
- Quick Tab shortcut (Q default)
- Close all shortcut (Esc default)
- Max windows (1-10)
- Default size and position
- Close on open toggle

**Appearance Tab:**
- Notification style (tooltip/notification)
- Colors, borders, animations
- Position and size
- Dark mode toggle
- Debug mode toggle

**Advanced Tab:**
- Clear Quick Tab Storage
- Export Console Logs
- Clear Log History
- Reset settings to defaults

## 🔒 Security Notice

**Manifest v2 Required:** Uses `webRequestBlocking` permission to modify X-Frame-Options and CSP headers for Quick Tabs iframe display.

**X-Frame-Options Bypass:** Removes headers to allow any website in iframes. Removes clickjacking protection for iframed content.

**Firefox Container Isolation (v1.5.9.12+):** Quick Tabs respect Firefox Container boundaries for additional isolation.

**Use at your own discretion.** Only open Quick Tabs from trusted websites.

## 🐛 Known Limitations

1. **Quick Tab Focus:** Clicking inside iframe captures keyboard focus. Click main page to restore shortcuts.
2. **Nested Quick Tabs:** Only works for same-origin iframes. Use "Open in New Tab" for cross-origin.
3. **Zen Browser Themes:** Cannot detect Zen workspace themes. Use built-in dark mode.
4. **Manifest v2:** Must remain on v2 for `webRequestBlocking` support.

## 📚 Documentation

- **Changelog:** See [docs/CHANGELOG.md](docs/CHANGELOG.md) for complete version history
- **Architecture:** See `/docs/manual/` for architecture documentation
- **Refactoring Plan:** [copy-url-on-hover-refactoring-plan-v2-evidence-based.md](docs/manual/1.5.9%20docs/copy-url-on-hover-refactoring-plan-v2-evidence-based.md)
- **Phase 1 Complete:** [v1.6.0-REFACTORING-PHASE1-COMPLETE.md](docs/misc/v1.6.0-REFACTORING-PHASE1-COMPLETE.md)

## 🛠️ Development

### Build the Extension

```bash
npm install
npm run build
```

### Run Tests

```bash
npm test                # All tests
npm run test:unit       # Unit tests only
npm run test:domain     # Domain layer (100% coverage required)
npm run test:storage    # Storage layer (90% coverage required)
npm run test:watch      # Watch mode
```

### Validation

```bash
npm run lint                    # ESLint
npm run format                  # Prettier
npm run validate:architecture   # Architecture boundaries
npm run build:check-size        # Bundle size limits
```

### CI Pipeline

```bash
npm run ci:full   # Complete CI (lint, test, build, validate)
```

## 🌐 Supported Websites (100+)

See [docs/manual/supported-sites.md](docs/manual/supported-sites.md) for the complete list of optimized websites including:

- Social media (Twitter, LinkedIn, Facebook, Instagram)
- Code repositories (GitHub, GitLab, Bitbucket)
- Shopping (Amazon, eBay, Walmart)
- News and media sites
- And many more...

## 📝 Notes

- Quick Tabs persist across browser tabs automatically
- Container isolation prevents cross-container state leaks
- Solo/Mute features replace old "Pin to Page" functionality
- All settings stored in browser.storage.sync with automatic cloud sync

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**Version 1.6.0.3** | [Changelog](docs/CHANGELOG.md) | [GitHub](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition) | [Issues](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition/issues)
