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
| Type check               | `npm run check:types`            |

### Important notes

- **Node.js 22+** is required (see `.nvmrc`).
- **tslib** must be installed for Playwright E2E tests to work
  (`playwright-webextext` requires it but doesn't list it as a dependency). It's
  installed as a production dependency.
- **Playwright Firefox** must be installed for E2E:
  `npx playwright install firefox --with-deps`
- The `vp` command (used in scripts like `npm run lint`, `npm test`) comes from
  `@voidzero-dev/vite-plus-core` — it is installed via `node_modules/.bin/vp`.
- `web-ext lint` reports pre-existing warnings/errors (non-square icon,
  update_url, version format) that are known and not blocking.
- To run the extension interactively in Firefox, use Playwright's bundled
  Firefox:
  `npx web-ext run --source-dir=dist --firefox=$HOME/.cache/ms-playwright/firefox-1497/firefox/firefox`
- The build output goes to `dist/` (Firefox) and `dist-chrome/` (Chrome).
- Tests use `jsdom` for unit/integration and real Firefox via Playwright for
  E2E.
