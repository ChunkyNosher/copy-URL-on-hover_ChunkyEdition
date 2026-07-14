# AGENTS.md

## Cursor Cloud specific instructions

This is a Firefox/Chrome browser extension (Manifest V2). No backend services,
databases, or external APIs are required.

### Quick reference

| Task                     | Command                          |
| ------------------------ | -------------------------------- |
| Install deps             | `npm install`                    |
| Lint                     | `npm run lint`                   |
| Format check             | `npm run format:check`           |
| Unit + integration tests | `npm test`                       |
| Build (production)       | `npm run build:prod`             |
| Build (dev)              | `npm run build`                  |
| E2E tests (Firefox)      | `npm run test:extension:firefox` |
| Full CI pipeline         | `npm run ci:full`                |
| Watch mode (dev)         | `npm run watch`                  |

### Important notes

- **Node.js 22+** is required (see `.nvmrc`).
- **tslib** must be installed for Playwright E2E tests (`playwright-webextext`
  requires it but doesn't declare it as a dependency).
- **Playwright Firefox** must be installed for E2E:
  `npx playwright install firefox --with-deps`
- The build uses standard `vite` (v8) with IIFE output format for
  content/background scripts.
- `web-ext lint` reports pre-existing warnings/errors (non-square icon,
  update_url, version format) that are known and not blocking.
- To run the extension interactively in Firefox, use Playwright's bundled
  Firefox:
  `npx web-ext run --source-dir=dist --firefox=$HOME/.cache/ms-playwright/firefox-*/firefox/firefox`
- The build output goes to `dist/` (Firefox) and `dist-chrome/` (Chrome via
  `npm run prepare:chrome-dist`).
- Tests use `jsdom` (via `jest-environment-jsdom`) for unit/integration and real
  Firefox via Playwright for E2E.
- E2E tests use `playwright.config.firefox.js` (primary) and
  `playwright.config.chrome.js` (Chrome-specific).

### Architecture locks (do not regress)

- **Quick Tabs are tab-scoped** (`originTabId`): DOM only on the origin browser
  tab; Manager may list all. Global cross-tab mirror (Issues #46/#51) is out of
  scope.
- **Option 4 messaging**: background owns the in-memory QT session; content and
  sidebar use `quick-tabs-port`. Prefer ports over treating `storage.onChanged`
  as a realtime bus.
- **Persistence**: `src/utils/storage-utils.js` + background →
  `storage.session` when available (Firefox 115+), else `storage.local` with
  startup wipe. There is no `src/storage/` adapter layer.
- **Settings**: sidebar + popup → `storage.local` only (no `options_page`).
- **Chrome MV3** (sidePanel + DNR + service worker) is deferred; Firefox stays
  on Manifest V2 for now.
