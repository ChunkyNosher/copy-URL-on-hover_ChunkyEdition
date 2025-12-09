# In-Depth Debug & Fix Report: copy-URL-on-hover v1.5.8.6 (Modular Refactor)

**Date:** 2025-11-12 **Repo Version:** v1.5.8.6

---

## 🔎 Executive Summary

The extension is still broken after the modular refactor, even though the build
pipeline completes and the .xpi size appears correct. This report provides a
step-by-step technical plan to bring the extension to a debuggable, functioning
state, and highlights every possible source of failure, best debugging tactics,
and advanced tips for fast diagnosis with practical code snippets for Copilot
Agents.

---

## 1. All-Stage Debug Checklist

### 1.1. Validate Actual Installed Bundle

- **Install the released .xpi as you normally do.**
- **Open a web page, press F12 or Ctrl+Shift+J, and go to the Console tab.**
- **Type:**

  ```js
  window.CopyURLExtension;
  ```

  - If you get `undefined`, the content script is NOT running or failed fatally.

- **Look for logs starting with `[Copy-URL-on-Hover]`.**
  - If only the initial log appears but none after, init is failing early
    (likely on config). If nothing at all, script failed immediately (bad
    bundle, or loading error).

### 1.2. Check For ES6 Imports/Exports in Final Bundle

- Open `dist/content.js` in a text editor.
- **Search for:** `import` and `export`
- If any found, **the build is wrong** (not fully bundled, browser can't load
  modules in content scripts).
- **Should see:** File is fully "flattened" (i.e. no imports/exports, only
  IIFE-wrapped code).

### 1.3. Validate Manifest Points to Correct File

- In `manifest.json`, the content script block must have:
  ```json
    "content_scripts": [ { ... "js": ["content.js"] ... } ]
  ```
- **File path must be correct relative to dist/ when zipped!**

---

## 2. Advanced Console Debugging Approaches

### 2.1. Aggressive Top-Level Logging

- Add these to the very top of `src/content.js`:
  ```js
  console.log('[Copy-URL-on-Hover] Script loaded! @', new Date().toISOString());
  try {
    window.CUO_debug_marker = 'JS executed to line 5!';
  } catch (e) {
    console.error('window marker failed', e);
  }
  ```
- Add similar logging **at the start of** each imported module's IIFE (or right
  after their imports are resolved) to prove that modules are being inlined and
  executed.

### 2.2. Isolate Where It Breaks

- For every initialization step, add a log:
  ```js
  console.log('STEP: preparing configManager...');
  // then
  console.log('STEP: awaiting configManager.load()...');
  // then
  console.log('STEP: initializing event subscriptions');
  ```
- If you see logs up to some point and then not after, you know the exact
  failing step.

---

## 3. Improving ConfigManager for Robust Debug

### 3.1. Defensive Fallbacks

- In `src/core/config.js`:
  ```js
  export class ConfigManager {
    async load() {
      try {
        const data = await browser.storage.local.get('config');
        if (!data || !data.config) {
          console.warn('[ConfigManager] No config in storage, using defaults');
          return { ...DEFAULT_CONFIG };
        }
        return { ...DEFAULT_CONFIG, ...data.config };
      } catch (err) {
        console.error('[ConfigManager] Exception from browser.storage:', err);
        return { ...DEFAULT_CONFIG };
      }
    }
  }
  ```
- **Always log the value you return, and log all exceptions.**

### 3.2. Make DEFAULT_CONFIG Re-Export Proof

- In `src/core/config.js`, **make sure DEFAULT_CONFIG is exported and present in
  the final bundle** (search for `DEFAULT_CONFIG` in the built dist/content.js
  to confirm).

---

## 4. Bundle Integrity & Asset Verification

### 4.1. File Copy Order in Scripts

- After build (`npm run build`), BEFORE copying assets, check `dist/content.js`.
  - **It must be minified and large (>60KB) and contain no import/export.**
- Confirm the `copy-assets` step does **NOT overwrite dist/content.js with
  src/content.js!**

### 4.2. .xpi Structure Audit

- Unzip the final .xpi. Confirm that:
  - There is `content.js` at the root (not in a `src/` subfolder)
  - The hash and timestamp of dist/content.js match your build
  - All required files and only required files are present

---

## 5. Debug Build-Time Issues & Rollup

### 5.1. Test Rollup Explicitly

- Run:
  ```bash
  rollup -c --sourcemap
  ```
- Open `dist/content.js.map` and step through which modules are included.
- Pull a browser debug profile: **in Firefox, source tab**, see if module
  structure is preserved (bad) or correctly code-gen'd (good).

### 5.2. Confirm All Module Functions Are Present

- Inspect `dist/content.js` for key function names:
  - `ConfigManager`, `getLinkText`, `checkShortcut`, etc.
- If class/function is missing, build config misses a file – check entry
  points/imports.

---

## 6. Prevention: Add CI/CD Sanity Checks

### 6.1. Add to CI Workflow

- In the GitHub Actions YAML, after build but before packaging, add:
  ```bash
  grep "import " dist/content.js && (echo "ERROR: build contains imports" && exit 1)
  grep "export " dist/content.js && (echo "ERROR: build contains exports" && exit 1)
  ```
  This fails build if output is not bundled!
- Add a step that prints the bundle size and major classes found:
  ```bash
  ls -lh dist/content.js
  grep "ConfigManager" dist/content.js
  ```

---

## 7. Additional Robustness Improvements

### 7.1. Universal Error Handler

- At top-level in content.js add:
  ```js
  window.onerror = function (msg, url, line, col, err) {
    console.error(
      'Global ERROR:',
      msg,
      line,
      col,
      err && err.stack ? err.stack : err
    );
    // Optionally: show user notification here
  };
  ```
- Catches all fatal script errors unhandled by try/catch.

### 7.2. Self-Test Mode

- Temporarily add (or keep for prod):
  ```js
  if (window && !window.CUO_SANITY) {
    window.CUO_SANITY = true;
    alert('Extension script ran to startup!');
  }
  ```
- If this alert doesn't ever show, script doesn't load at all; look for manifest
  or XPI structure issue.

---

## 8. Ultimate Recovery Option: Minimal Sanity Content Script

- Replace all code in `src/content.js` with:
  ```js
  alert('Copy-URL-on-Hover minimal test script ran!');
  window.addEventListener('keydown', function (evt) {
    if (evt.key === 'x') {
      alert('X press detected!');
    }
  });
  ```
- Build, load, and test. If alert pops up and key works, issue is in main
  extension/init logic.
- If even this fails: **XPI structure or manifest is incorrect.**

---

## 9. Reporting Debug Output Effectively

- After each change/rebuild/install, copy **all browser console output**
  (errors, warnings, logs) for review.
- Note the **exact line at which logs stop or error appears**. The NEXT
  statement is the failing one.

---

## 10. Extra: Streamline Modular Imports with Barrel Files

- Add `index.js` to each submodule directory that re-exports all public
  interfaces.
- Refactor content.js imports to import from barrel:
  `import { ConfigManager, ... } from './core'`.
- Eases rollup consumption and makes dependencies easier to resolve.

---

## 11. Recap: Copilot/CI Agent Implementation Steps

1. **Add/verify all logging points.**
2. **Defensively guard config import and loading.**
3. **Explicitly fail CI on import/export in bundle.**
4. **Audit XPI structure and manifest.**
5. **Test with minimal/test content script.**
6. **Add global error handlers.**
7. **Add barrel/index.js to simplify imports for tree-shaking and bundling.**
8. **Document all pre-release steps and build checks in BUILD.md.**

---

## 12. Appendix: Troubleshooting Table

| Symptom                                 | Potential Root              | Check/Fix                   |
| --------------------------------------- | --------------------------- | --------------------------- |
| No logs at all                          | Not loaded/fatal fail       | bundle/manifest/XPI mistake |
| Logs stop at config                     | Config load fail            | Defensive ConfigManager/    |
| DEFAULT_CONFIG                          |
| Only 'Copy Text' works                  | Listeners unregistered      | init fails after startup    |
| 'import' or 'export' in dist/content.js | Bad Rollup config/copy step | Fix build or script         |

---

**Final Note:** Even a correctly built modular extension can break if a single
step (missing DEFAULT_CONFIG export, Rollup misconfig, asset copy race) is
wrong. Be fanatical about verifying bundle flattening and ultra-defensive during
config init. If needed, revert to a working monolith and build up modularity one
file at a time!

_Last updated: 2025-11-12, v1.5.8.6 diagnosis complete._
