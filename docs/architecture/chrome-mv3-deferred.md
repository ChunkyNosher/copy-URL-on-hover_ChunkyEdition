# Chrome Manifest V3 — Deferred (v2.0.0)

Chrome Web Store distribution requires Manifest V3. This repo stays on **Firefox
Manifest V2** as the primary target.

## Why deferred

- Firefox has no MV2 deprecation timeline and still supports blocking
  `webRequest` (used for Quick Tab iframe XFO/CSP stripping).
- Chrome `sidePanel` requires MV3; Firefox uses `sidebar_action` (already
  implemented).
- Chrome MV3 store extensions cannot use `webRequestBlocking` for header
  modification — need `declarativeNetRequest` `modifyHeaders` instead.
- Background model differs: Chrome = service worker; Firefox MV3 = event pages
  (not service workers).

## When to pick this up

Only if shipping to Chrome Web Store / Edge Add-ons is a product requirement.

## Sketch (do not implement yet)

1. Separate `manifest.chrome.json` as MV3 with `background.service_worker` +
   Firefox dual `scripts` if sharing a package.
2. Replace blocking `webRequest` iframe header strip with DNR session rules
   scoped to Quick Tab subframe loads.
3. Map sidebar UI to `sidePanel` + `sidePanel.open` / `setPanelBehavior`.
4. Make background session state event-page/SW safe (no forever-alive
   assumptions; prefer `storage.session` + alarms).

Until then, `npm run prepare:chrome-dist` remains an MV2 parallel artifact for
local Chromium testing only.
