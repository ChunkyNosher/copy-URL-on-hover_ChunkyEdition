# Cross-Browser Extension: Copy URL on Hover

**Version 2.0.0** — A feature-rich **Firefox / Chrome / Chromium** extension for
quick URL copying and advanced Quick Tab management with **tab-scoped isolation**,
**Firefox Container awareness**, and session-like Quick Tabs.

**Cross-browser:** Firefox, Chrome, Edge, Brave, Opera, and other Chromium
browsers via Manifest V2 + `webextension-polyfill`.

**v2.0.0 status:** Dead-code purge ✅ | API hygiene ✅ | Option 4 ports ✅ |
Tab-scoped Quick Tabs ✅ | Background `storage.session` (FF 115+) ✅

This extension lets you copy URLs or link text with keyboard shortcuts while
hovering over links, and open links in floating, draggable Quick Tab iframe
windows managed from the Firefox sidebar (Chrome uses the toolbar popup).

---

## What's New in v2.0.0

**Major cleanup and architecture hardening** (builds on the late 1.6.4 line and
the recent storage/messaging refactor).

### Product locks

- **Tab-scoped Quick Tabs** — a Quick Tab’s DOM lives only on its
  `originTabId`; the Manager may list all QTs grouped by origin tab. Global
  cross-tab mirror (Issues #46 / #51) remains out of scope.
- **Container-aware Manager** — Firefox Multi-Account Containers stay supported;
  Solo/Mute is not returning.

### Dead code & packaging

- Removed the unused `src/storage/` adapter layer (`SyncStorageAdapter`,
  `SessionStorageAdapter`, `FormatMigrator`) — live path is
  `src/utils/storage-utils.js` + background.
- Removed the divergent `options_page` (`storage.sync`); settings are **sidebar +
  popup → `storage.local` only**.
- Stripped Solo/Mute and floating-panel test leftovers, stale `@ui` / `@storage`
  aliases, and Chrome WAR pointing at deleted `state-manager.js`.
- Large prior cleanup (#451): panel/mediator/`src/ui`/Rollup/docs bloat.

### API hygiene

- Dropped unused permissions (`cookies`, `sessions`, `alarms`, `notifications`,
  `clipboardRead`).
- Declared `scripting` for the background recovery injection path.
- Kept `clipboardWrite` for reliable content-script clipboard writes.

### Messaging & storage

- **Option 4** remains canonical: background owns the in-memory QT session;
  content/sidebar use `quick-tabs-port`.
- Fixed MessageRouter hang risk (unhandled `route()` rejections no longer leave
  callers waiting forever — same class of bug as PR #414).
- Mid-session QT persistence prefers **`browser.storage.session`** in the
  background when available (Firefox 115+); falls back to `storage.local` +
  startup wipe on older browsers. Content scripts do not touch `storage.session`.

### Chrome MV3

Chrome Store MV3 (service worker + DNR + `sidePanel`) is **documented and
deferred**. See
[docs/architecture/chrome-mv3-deferred.md](docs/architecture/chrome-mv3-deferred.md).
Firefox stays on Manifest V2 for now.

---

## Previous 1.6.4 highlights (still in the product)

- Clean URL copying + optional copy-raw shortcut
- Dark-mode-first UI / glass Quick Tab chrome
- Container filter, Go to Tab (incl. cross-container), drag-and-drop Manager
- Port messaging, circuit breaker, session-like Quick Tabs

Full history: [docs/CHANGELOG.md](docs/CHANGELOG.md).

---

## Firefox Sidebar Integration

**Unified Settings Sidebar for Firefox** — settings and Quick Tabs Manager in
the sidebar.

- **Firefox:** Toolbar button or `Alt+Shift+S`
- **Chrome/Edge/Brave:** Toolbar popup
- **Quick Tabs Manager:** `Ctrl+Alt+Z` (Firefox) / `Alt+Shift+Z` (Chrome)

---

## Architecture (v2.0.0)

**Domain-Driven Design with Background-as-Coordinator (Option 4)**

- **QuickTab domain entity** — pure business logic
- **Persistence** — `storage-utils` + background; no `src/storage/` adapters
- **Realtime sync** — ports primary; `storage.onChanged` is not the realtime bus
- **Tab isolation** — hydrate / restore filtered by `originTabId`

Docs: [docs/architecture/](docs/architecture/)

---

## Key Features

- Quick URL / text copy with shortcuts (defaults: **Y**, **X**, **O**)
- Quick Tabs — floating, draggable, resizable iframes
- Container isolation + Manager container filter (Firefox)
- Session-like Quick Tabs (cleared on browser restart)
- Shadow DOM support for major sites
- Port messaging (`quick-tabs-port`)
- Sidebar Manager (Firefox) / popup settings (Chrome)
- 100+ site-specific URL handlers
- Dark mode UI
- Auto-updates via GitHub releases (Firefox `update_url`)

---

## Installation

### Firefox / Zen (recommended)

1. Open
   [Releases](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition/releases)
2. Download the latest `*.xpi`
3. Firefox → `about:addons` → gear → **Install Add-on From File…**

Auto-updates are enabled via `updates.json`.

### Chrome / Edge / Brave / Opera

1. Download the latest Chrome `*.zip` from Releases
2. Extract to a permanent folder
3. Extensions page → Developer mode → **Load unpacked**

---

## Browser Compatibility

| Feature             | Firefox/Zen       | Chrome/Edge/Brave/Opera     |
| ------------------- | ----------------- | --------------------------- |
| Copy URL (Y key)    | Yes               | Yes                         |
| Quick Tabs          | Yes               | Yes                         |
| Container Isolation | Yes               | Single default container    |
| Sidebar Settings    | Native sidebar    | Toolbar popup               |

---

## Usage

**Copy:** Hover a link → **Y** (cleaned URL), **X** (text), or **O** (open).

**Quick Tabs:** Hover → **Q** → drag/resize → **Esc** closes all on that page.

**Manager:** **Ctrl+Alt+Z** (Firefox) toggles the sidebar Manager.

---

## Security Notice

Uses Manifest V2 `webRequestBlocking` to strip framing headers for Quick Tab
iframes. **Only open Quick Tabs from sites you trust.**

---

## Development

```bash
npm install
npm run build          # or npm run build:prod
npm test
npm run lint
npm run ci:full
```

See [AGENTS.md](AGENTS.md) for architecture locks and tooling notes.

---

## Notes

- Quick Tabs are tab-scoped and session-like (native `storage.session` when
  available; otherwise local + startup cleanup).
- Background is the single source of truth for Quick Tab session state.
- Port circuit breaker caps reconnects; auto-resets after idle.
- Chrome MV3 Store packaging is deferred (see architecture docs).

---

## License

MIT — see [LICENSE](LICENSE).

---

**Version 2.0.0** | [Changelog](docs/CHANGELOG.md) |
[GitHub](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition) |
[Issues](https://github.com/ChunkyNosher/copy-URL-on-hover_ChunkyEdition/issues)
