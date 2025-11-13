# Build and Packaging Guide for Hybrid Modular Architecture (v1.5.8.10+)

## Overview

This document explains how the extension is built and packaged with the new hybrid modular/EventBus architecture implemented in v1.5.8.10.

## Architecture Changes

### Source Structure (src/)

```
src/
├── content.js                      # Entry point - orchestrates all modules
├── core/                           # Core utilities (moved from utils/)
│   ├── config.js                   # Configuration management
│   ├── state.js                    # State management
│   ├── events.js                   # EventBus implementation
│   ├── dom.js                      # DOM utilities (moved from utils/)
│   ├── browser-api.js              # Browser API wrappers (moved from utils/)
│   └── index.js                    # Barrel export
├── features/
│   ├── quick-tabs/
│   │   ├── index.js                # Quick Tabs manager
│   │   ├── window.js               # Quick Tab window (renamed from quick-tab-window.js)
│   │   └── minimized-manager.js    # Minimized tabs
│   ├── notifications/
│   │   ├── index.js                # Notification coordinator
│   │   ├── toast.js                # Toast notifications (NEW)
│   │   └── tooltip.js              # Tooltip notifications (NEW)
│   └── url-handlers/
│       └── [11 categorized modules with 104 handlers]
├── ui/
│   ├── components.js               # Reusable UI components
│   └── css/                        # Modular CSS (NEW)
│       ├── base.css                # Common styles
│       ├── notifications.css       # Notification styles
│       └── quick-tabs.css          # Quick Tab styles
└── utils/
    ├── debug.js                    # Debug utilities (only this remains)
    └── index.js                    # Barrel export
```

### Build Output (dist/)

```
dist/
├── content.js          # BUNDLED from all src/ modules via Rollup (~96KB)
├── background.js       # Copied from root
├── manifest.json       # Copied from root (v1.5.8.10)
├── popup.html/js       # Copied from root
├── options_page.html/js # Copied from root
├── state-manager.js    # Copied from root
├── icons/              # Copied from root
└── sidebar/            # Copied from root
```

**IMPORTANT:** The `src/` directory is NOT included in `dist/`. All modular source files are bundled into a single `content.js` file.

## Build Process

### 1. Development Build

```bash
npm run build
```

**Steps:**

1. `npm run clean` - Removes old `dist/` directory
2. `rollup -c` - Bundles `src/content.js` → `dist/content.js` (with source maps)
3. `npm run copy-assets` - Copies non-bundled files to `dist/`

### 2. Production Build

```bash
npm run build:prod
```

**Steps:**

1. `npm run clean` - Removes old `dist/` directory
2. `rollup -c --environment BUILD:production` - Bundles without source maps
3. `npm run copy-assets` - Copies non-bundled files to `dist/`

### 3. Watch Mode (Development)

```bash
npm run watch
```

Watches for changes in `src/` and rebuilds automatically.

## Rollup Bundling

### Configuration (`rollup.config.js`)

```javascript
{
  input: 'src/content.js',           // Entry point
  output: {
    file: 'dist/content.js',         // Bundled output
    format: 'iife',                  // Immediately Invoked Function Expression
    sourcemap: !production           // Source maps in dev only
  },
  plugins: [
    resolve(),                       // Resolves node_modules
    commonjs()                       // Converts CommonJS to ES6
  ]
}
```

### What Gets Bundled

Rollup follows all `import` statements starting from `src/content.js` and bundles:

- ✅ `core/config.js`, `core/state.js`, `core/events.js`
- ✅ `core/dom.js`, `core/browser-api.js` (moved from utils/)
- ✅ `utils/debug.js`
- ✅ `features/quick-tabs/index.js`, `features/quick-tabs/window.js`, `features/quick-tabs/minimized-manager.js`
- ✅ `features/notifications/index.js`, `features/notifications/toast.js`, `features/notifications/tooltip.js`
- ✅ `features/url-handlers/` - All 11 category files
- ✅ `ui/components.js`

### What Does NOT Get Bundled

- ❌ CSS files (inlined as strings in JavaScript)
- ❌ `background.js` (standalone script)
- ❌ `popup.js`, `options_page.js` (standalone scripts)
- ❌ `state-manager.js` (standalone script)
- ❌ HTML files
- ❌ Icon files
- ❌ Sidebar files

## CSS Handling

CSS files in `src/ui/css/` are **NOT** imported as external files. Instead:

1. CSS content is inlined as JavaScript strings in the modules that use them
2. JavaScript dynamically injects the CSS via `<style>` elements
3. This ensures CSS is bundled into `content.js` and loaded at runtime

**Example:** In `features/notifications/index.js`:

```javascript
const notificationsCss = `
  /* CSS content here */
`;
// Later injected with:
const styleElement = document.createElement('style');
styleElement.textContent = notificationsCss;
document.head.appendChild(styleElement);
```

## Packaging for Release

### GitHub Actions Workflow (`.github/workflows/release.yml`)

The release workflow now includes validation steps:

1. ✅ **Install dependencies** - `npm install`
2. ✅ **Run tests** - `npm test` (ensures code works)
3. ✅ **Build for production** - `npm run build:prod`
4. ✅ **Validate build output:**
   - Checks `dist/content.js` exists and is reasonable size (>10KB)
   - Checks `dist/manifest.json` exists
   - Checks `dist/background.js` exists
   - Verifies no `src/` directory in `dist/`
5. ✅ **Extract version** - Reads version from `dist/manifest.json`
6. ✅ **Package .xpi** - Creates ZIP archive from `dist/` directory only
   ```bash
   cd dist/
   zip -r -1 -FS ../copy-url-hover-{version}.xpi * -x '*.DS_Store' -x '*.map'
   ```
7. ✅ **Verify .xpi package:**
   - Lists package contents
   - Checks package size (>50KB)
8. ✅ **Create GitHub release** - Uploads .xpi as release asset

### Manual Packaging (for testing)

```bash
# Build for production
npm run build:prod

# Navigate to dist and create package
cd dist
zip -r -1 -FS ../test-package.xpi * -x '*.DS_Store' -x '*.map'
cd ..

# Verify package contents
unzip -l test-package.xpi
```

## Validation Checklist

Before releasing, the workflow automatically validates:

- [ ] All tests pass
- [ ] Build completes without errors
- [ ] `dist/content.js` exists and is >10KB
- [ ] `dist/manifest.json` exists
- [ ] `dist/background.js` exists
- [ ] No `src/` directory in `dist/`
- [ ] .xpi package is >50KB
- [ ] .xpi contains all required files

## Common Issues and Solutions

### Issue: Build fails with "Cannot find module"

**Cause:** Import path is incorrect or module doesn't exist.

**Solution:**

1. Check import paths use correct relative paths
2. Verify file exists at expected location
3. Check for typos in filenames

### Issue: content.js is too small after bundling

**Cause:** Rollup didn't include all modules.

**Solution:**

1. Ensure all modules are imported (not just referenced)
2. Check for circular dependencies
3. Verify `rollup.config.js` settings

### Issue: Extension doesn't load after packaging

**Cause:** Missing files or incorrect manifest.

**Solution:**

1. Verify `dist/manifest.json` has correct version
2. Check all files listed in manifest exist in `dist/`
3. Run `web-ext lint --source-dir=dist/`

### Issue: CSS not working in packaged extension

**Cause:** CSS files not properly inlined.

**Solution:**

1. Ensure CSS is included as string constant in JS
2. Verify CSS injection code runs
3. Check browser console for errors

## File Size Comparison

| File                 | v1.5.9.0 (Before) | v1.5.8.10 (After) | Notes                                         |
| -------------------- | ----------------- | ----------------- | --------------------------------------------- |
| content.js (bundled) | ~98KB             | ~96KB             | Slightly smaller due to better modularization |
| Total .xpi size      | ~250KB            | ~250KB            | Similar (all essential files included)        |

## Architecture Benefits

1. **Cleaner separation** - Core, features, UI clearly separated
2. **Better maintainability** - Each module has single responsibility
3. **Easier testing** - Modules can be tested independently
4. **No corruption risk** - Rollup ensures all dependencies bundled correctly
5. **Production-ready** - Automated validation prevents packaging errors

## Related Documentation

- `/docs/manual/hybrid-architecture-implementation.md` - Architecture design
- `/.github/workflows/release.yml` - Release automation
- `/rollup.config.js` - Bundler configuration
- `/package.json` - Build scripts

---

**Last Updated:** 2025-11-13 (v1.5.8.10)
