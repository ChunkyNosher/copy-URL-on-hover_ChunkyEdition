# Manifest Path Fix for Packaged Extension (v1.6.0)

## Problem Description

The extension was not loading properly when installed from a packaged `.xpi`
file. Investigation revealed that **nothing worked** - not even basic URL hover
detection or console logging.

## Root Cause Analysis

### The Issue

The `manifest.json` file in the repository root contains paths like:

```json
{
  "background": {
    "scripts": ["dist/background.js"]
  },
  "content_scripts": [
    {
      "js": ["dist/content.js"]
    }
  ]
}
```

These paths are **correct for development** (when running the extension from the
repository root) but **incorrect for production** (when the extension is
packaged from the `dist/` directory).

### Why This Breaks the Extension

When the extension is packaged:

1. `npm run build:prod` creates bundled files in `dist/`:
   - `dist/content.js` (bundled from `src/content.js`)
   - `dist/background.js` (bundled from `background.js`)
2. The `copy-assets` script copies `manifest.json` to `dist/manifest.json`
3. The `.xpi` package is created **from the contents of `dist/`**
4. When installed, Firefox looks for scripts relative to `manifest.json`

**The Problem:** In the packaged extension:

- `manifest.json` is at the package root (was `dist/manifest.json`)
- `background.js` is at the package root (was `dist/background.js`)
- `content.js` is at the package root (was `dist/content.js`)

But the manifest still references `"dist/background.js"` and
`"dist/content.js"`, which **don't exist** in the package. Firefox tries to
load:

- `dist/background.js` (doesn't exist, should be `background.js`)
- `dist/content.js` (doesn't exist, should be `content.js`)

Result: **No scripts load, extension is completely non-functional.**

## Solution Implemented

### 1. Created Post-Build Script

Created `scripts/fix-manifest-paths.js` that:

- Reads `dist/manifest.json` after it's been copied
- Removes the `"dist/"` prefix from all script paths
- Writes the corrected manifest back to `dist/manifest.json`

### 2. Updated Build Process

Modified `package.json` to include the fix script:

```json
{
  "scripts": {
    "build": "npm run clean && rollup -c && npm run copy-assets && npm run fix-manifest",
    "build:prod": "npm run clean && rollup -c --environment BUILD:production && npm run copy-assets && npm run fix-manifest",
    "fix-manifest": "node scripts/fix-manifest-paths.js"
  }
}
```

Now the build pipeline is:

1. `clean` - Remove old `dist/`
2. `rollup` - Bundle source files
3. `copy-assets` - Copy static assets and manifest
4. **`fix-manifest`** - Correct script paths in `dist/manifest.json`

### 3. Added Validation to CI/CD

Updated `.github/workflows/release.yml` to validate that manifest paths are
correct before packaging:

```bash
# Verify manifest paths are correct (no "dist/" prefix)
if grep -q '"dist/background.js"' dist/manifest.json; then
  echo "ERROR: manifest.json contains incorrect path!"
  exit 1
fi
```

### 4. Updated .gitignore

Added `dist/` to `.gitignore` since build artifacts shouldn't be committed to
version control.

## Verification

After the fix:

```bash
$ cat dist/manifest.json | jq '.background.scripts, .content_scripts[0].js'
[
  "background.js"
]
[
  "content.js"
]
```

✅ Paths are now correct for packaged extension.

## Testing

1. **Build Test:**

   ```bash
   npm run build:prod
   # Should see: "✓ Fixed background script: 'dist/background.js' → 'background.js'"
   ```

2. **Package Test:**

   ```bash
   cd dist
   zip -r ../test.xpi *
   unzip -p ../test.xpi manifest.json | jq '.background.scripts'
   # Should show: ["background.js"]
   ```

3. **Installation Test:**
   - Install the packaged `.xpi` in Firefox
   - Navigate to any website
   - Hover over a link
   - Should see URL copy tooltip appear
   - Console should show extension logs

## Impact

**Before Fix:**

- Extension completely non-functional when installed from `.xpi`
- No console output, no UI elements, no functionality

**After Fix:**

- Extension loads correctly from packaged `.xpi`
- All features work as expected
- Proper error reporting and logging

## Related Files

- `scripts/fix-manifest-paths.js` - Path correction script
- `package.json` - Updated build pipeline
- `.github/workflows/release.yml` - Added validation
- `.gitignore` - Excluded `dist/` from version control

## Lessons Learned

1. **Path Resolution Matters:** Paths in `manifest.json` are relative to the
   manifest's location
2. **Dev vs Prod Environments:** What works in development may not work in
   production
3. **Always Validate:** CI/CD should validate build outputs, not just that files
   exist
4. **Build Artifacts:** Should be excluded from version control

## Future Improvements

Consider maintaining two separate manifests:

- `manifest.json` - For development (with `dist/` paths)
- `manifest.prod.json` - For production (without `dist/` paths)

However, the current post-build fix approach is simpler and less error-prone.
