# Cross-Browser Extension: Copy URL on Hover

**Version 1.6.3.11-v9** - A feature-rich **Firefox/Chrome/Chromium** extension
for quick URL copying and advanced Quick Tab management with **Solo/Mute
visibility control**, **Per-Tab Isolation**, **Container Isolation**, Session
Quick Tabs, and Persistent Floating Panel Manager.

**🌐 Cross-Browser Support:** Now compatible with Firefox, Chrome, Edge, Brave,
Opera, and other Chromium-based browsers using Manifest v2 with
webextension-polyfill.

**🔧 v1.6.3.11-v9 Status:** Diagnostic Report Fixes ✅ | Code Health 9.0+ | 1,971+ Tests Passing

This is a complete, customizable Firefox extension that allows you to copy URLs
or link text by pressing keyboard shortcuts while hovering over links, plus
powerful Quick Tabs for browsing links in floating, draggable iframe windows.

## 🎉 What's New in v1.6.3.11-v9

**🔧 Diagnostic Report Fixes + Code Health 9.0+ (December 2025) ✅**

**Bug Fixes:**

- ✅ **Issue A Fix** - Content script tab identity initialization before state changes
- ✅ **Issue C Fix** - Identity initialization comprehensive logging with timestamps
- ✅ **Issue D Fix** - Storage write queue enforces identity-ready precondition
- ✅ **Issue E Fix** - State validation pre/post comparison logging
- ✅ **Issue I Fix** - Debounce timer captures tab context at schedule time
- ✅ **Issue 3.2 Fix** - Z-index counter recycling threshold lowered (100000 → 10000)
- ✅ **Issue 5 Fix** - Container isolation validated in all visibility operations

**New Logging Infrastructure:**

- ✅ **Identity Init Logging** - `[IDENTITY_INIT]` phases (SCRIPT_LOAD, TAB_ID_REQUEST, TAB_ID_RESPONSE, IDENTITY_READY)
- ✅ **Write Phase Logging** - `[WRITE_PHASE]` phases (FETCH_PHASE, QUOTA_CHECK_PHASE, SERIALIZE_PHASE, WRITE_API_PHASE)
- ✅ **State Validation Delta** - `[STATE_VALIDATION] PRE_POST_COMPARISON` shows filtered tabs
- ✅ **Container Validation** - `_validateContainerIsolation()` helper added

**Code Health 9.0+ Achieved:**

- ✅ **src/utils/storage-utils.js** - Score 7.66 → 9.09
- ✅ **src/content.js** - Score 8.71 → 9.09
- ✅ **background.js** - Score 8.1 → 9.09
- ✅ **sidebar/quick-tabs-manager.js** - Score 8.26 → 9.09

---

## 🎉 What's New in v1.6.3.11-v8

**🔧 Transaction Tracking + Validation (December 2025) ✅**

**Bug Fixes:**

- ✅ **Transaction Tracking Wired** - `_trackTransaction()` now called during storage writes
- ✅ **Null originTabId Rejection** - Quick Tab creation rejects null originTabId
- ✅ **Unknown Identity Rejection** - IDs with "unknown" placeholder rejected
- ✅ **Hydration Boundary Logging** - GET_QUICK_TABS_STATE logs hydration state

**New Logging Infrastructure:**

- ✅ **Storage.onChanged Cascade** - `[Storage][Event]` timing and source logging
- ✅ **Identity State Transitions** - `[Identity]` INITIALIZING → READY logging
- ✅ **Storage Write Lifecycle** - `[StorageWrite] LIFECYCLE_*` phases
- ✅ **Handler Entry/Exit** - `[Handler][ENTRY/EXIT]` instrumentation

---

## 🎉 What's New in v1.6.3.11-v7

**🔧 Stability Restoration & Code Health Improvements (December 2025) ✅**

**Stability Restoration:**

- ✅ **Restored to v1.6.3.10-v10** - Working version before architectural changes
- ✅ **Fixed Orphan Quick Tabs** - Quick Tabs now properly store `originTabId` and `originContainerId`
- ✅ **Background Handler Fix** - Added `_resolveOriginTabId()`, `_validateTabId()`, `_extractTabIdFromPattern()` helpers

**Code Health Improvements:**

- ✅ **sidebar/quick-tabs-manager.js** - Score 7.32 → 8.26 (8 methods refactored)
- ✅ **src/utils/storage-utils.js** - Score 7.44 → 7.78 (5 methods refactored)
- ✅ **src/content.js** - Score 8.71 → 9.09 (exceeds 9.0 target)
- ✅ **background.js** - Score 8.02 → 8.40 (architecture-constrained)

**Test Coverage:** 1,971+ tests passing

---

## 🎉 What's New in v1.6.3.11-v5

**🔧 23 Issues Fixed (December 2025) ✅** - Global Operation Sequence, Port
Viability Checks, State Readiness Gating, Cache Dirty Flag, Logging
Infrastructure (L1-L7 prefixes), Error Telemetry with threshold alerting.

## 🎉 What's New in v1.6.3.11-v4

**🔧 22 Issues Fixed (December 2025) ✅** - Shadow DOM Detection, Event
Debouncing, Pointer Events API, Content Pipeline Logging, Storage Timing
Telemetry, Operation Acknowledgment, Error Recovery.

---

## 🎉 Previous Releases

**v1.6.3.11-v3:** 55+ Issues Fixed - HEARTBEAT, Re-entrance Queue, BFCache
Queue  
**v1.6.3.11-v2:** 40 Issues Fixed - BFCache, Tab ID, Hydration improvements  
**v1.6.3.11:** 40 Issues Fixed - GET_CURRENT_TAB_ID, listener registration  
**v1.6.3.10-v11:** Extended Tab ID, OPERATION_TYPE, LRU Map Guard

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
✓ **Firefox Critical Fixes** - BFCache, Adaptive Timeout, Load Shedding
(v1.6.3.11-v6)  
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

**Version 1.6.3.11-v9** | [Changelog](docs/CHANGELOG.md) |
[GitHub](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition) |
[Issues](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition/issues)
