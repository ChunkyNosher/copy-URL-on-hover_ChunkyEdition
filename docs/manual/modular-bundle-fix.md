# How to Fully Fix Extension Feature-Breaking After Modular Refactor (v1.5.8.2)

**Date:** 2025-11-12
**Extension:** Copy URL on Hover v1.5.8.2
**Audience:** Developers/Repo Maintainer/GitHub Copilot Agent

---

## Executive Summary

After the modular refactor, none of the keyboard shortcuts or feature events (hover, copying, Quick Tabs) run.
**The root cause is that your content script (`content.js`) is not actually running**—because after the Rollup build or asset copy step, the wrong file is ending up in your distributable `dist/content.js`. Any ES6 imports in a content script will break all logic at runtime!

---

## Why This Happens In v1.5.8.2

- **src/content.js** uses `import ... from ...` for all main logic
- Browsers require extension content scripts to be classic scripts, _not_ ES6 modules
- If your build or copy process places the unbundled `src/content.js` or any file with import/export in `dist/content.js`, _the browser will skip executing it entirely_ (no errors appear in the user console — merely no events or handlers work)

### What you observe:

- No keyboard shortcuts work
- No extension hover or click events fire
- Debug mode/console prints nothing from the extension
- Yet, the extension appears listed and installed

---

## The FULL FIX: Checklist

### 1. **Fix the Build Process**

- Ensure Rollup is producing a bundled, import-free `dist/content.js` (a single concatenated/flattened file with no ES6 module syntax)! Any import/export in the distributable means you're loading a non-working script.

- **Your rollup.config.js should look like:**

  ```js
  import resolve from "@rollup/plugin-node-resolve";
  import commonjs from "@rollup/plugin-commonjs";

  export default {
    input: "src/content.js",
    output: {
      file: "dist/content.js",
      format: "iife", // must be 'iife' or 'umd' for content scripts
      sourcemap: true,
    },
    plugins: [resolve(), commonjs()],
  };
  ```

- **Do NOT copy** `src/content.js` into dist—only the output of Rollup as `dist/content.js` should live in the .xpi package.
  - Search your `package.json` and remove/correct lines in your asset copy script that would copy `src/content.js` into `dist/`.

### 2. **Rebuild the Extension**

- Run:
  ```bash
  npm run build
  # or with prod settings for minification:
  npm run build:prod
  ```
- Double-check: Open the new `dist/content.js`. There should be zero `import` or `export` lines and it should not look like the plain original src file. All logic must be present in this single bundled file.

### 3. **Check manifest.json and Copy It Directly**

- Your copy-assets (or equivalent) step should place your manifest.json in dist/, but _do not modify_ content.js or manually inject version fields.
- Always update your version correctly so it's clear that a new build is being tested.

### 4. **Rezip and Reinstall**

- Package the dist directory only:
  ```bash
  cd dist
  zip -r -1 ../copy-url-hover-v1.5.8.3.xpi *
  cd ..
  ```
- Install the .xpi again and test shortcut + feature events!

### 5. **(Optional) Add Automated Linting to Your Workflow**

- Add a `web-ext lint` step to your GitHub Actions workflow to catch manifest and bundle errors before release:
  ```yaml
  - name: Lint extension
    run: npx web-ext lint dist --verbose
  ```

---

## Single Point-of-Failure Symptom Table

| Problem                                 | Check/fix                                     |
| --------------------------------------- | --------------------------------------------- |
| No extension events fire                | Bundle output contains 'import'/'export'      |
| All shortcuts broken, no hover, nothing | Not classic JS: build/copy process is broken  |
| dist/content.js matches src/content.js  | Asset copy step is over-zealous               |
| Installing works but features broken    | Code skipped: not valid content script loaded |

---

## Example Working Workflow (summary)

1. Rollup bundles _all_ modules from src/ into one distributable classic JS at dist/content.js
2. No unbundled JS is copied to dist/ by package.json asset scripts
3. Manifest and all assets are copied straight to dist/
4. Only then is dist/ zipped and published as the .xpi file

---

## Closing Summary

This is the classic pitfall for modular extension refactoring: **if the bundler or copy step is misconfigured, the extension appears to install but does nothing.**

- _Never_ directly copy module-based source files as content scripts.
- The output content.js must always be a fully bundled, import/export-free, browser-legal classic JS file containing the entire logic tree.

This will restore all keyboard shortcuts, events, and main features in the next packaged release.

**Document v1.0 | 2025-11-12**
