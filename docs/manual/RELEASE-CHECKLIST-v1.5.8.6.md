# Release Checklist for v1.5.8.6

## Summary

✓ **Bug Fixed:** Configuration loading mismatch causing keyboard shortcuts to fail  
✓ **Version:** 1.5.8.6  
✓ **Security:** 0 vulnerabilities  
✓ **Status:** READY FOR RELEASE

## What Was Fixed

**Problem:** 
- Keyboard shortcuts (copy URL, Quick Tabs, open new tab) didn't work
- Debug mode never showed console messages
- Only "Copy Text" key worked

**Root Cause:**
- Modular content.js looked for 'userConfig' key in storage
- popup.js saves settings as individual keys (copyUrlKey, debugMode, etc.)
- Result: Extension always used default settings, ignoring user preferences

**Solution:**
- Changed ConfigManager to read individual storage keys
- Now properly loads user settings from popup.js
- Keyboard shortcuts and debug mode work correctly

## Files Changed

1. `src/core/config.js` - Fixed storage API usage
2. `manifest.json` - Updated to v1.5.8.6
3. `package.json` - Updated version and build script

## Testing Completed

✓ Syntax validation (no JavaScript errors)  
✓ CodeQL security scan (0 vulnerabilities)  
✓ XPI packaging (no .map files included)  
✓ Configuration loading logic verified  
✓ Build process tested  

## How to Release

### Option 1: Automatic Release (Recommended)

1. **Merge this PR to main:**
   ```bash
   # On GitHub, merge the PR titled:
   # "Fix config loading mismatch causing keyboard shortcuts to fail (v1.5.8.6)"
   ```

2. **Create and push git tag:**
   ```bash
   git checkout main
   git pull origin main
   git tag v1.5.8.6
   git push origin v1.5.8.6
   ```

3. **GitHub Actions will automatically:**
   - Run `npm install`
   - Run `npm run build`
   - Package the extension as `copy-url-hover-v1.5.8.6.xpi`
   - Create a GitHub release
   - Attach the .xpi file

4. **Download and test the .xpi:**
   - Go to Releases page
   - Download `copy-url-hover-v1.5.8.6.xpi`
   - Install in Firefox/Zen Browser
   - Verify keyboard shortcuts work

### Option 2: Manual Release

If you prefer to build and release manually:

```bash
# 1. Build the extension
npm install
npm run build

# 2. Package the .xpi
cd dist
zip -r -1 -FS ../copy-url-hover-v1.5.8.6.xpi * -x '*.DS_Store' -x '*.map'
cd ..

# 3. Test the .xpi locally
# Install in Firefox/Zen Browser from about:addons

# 4. Create GitHub release manually
# Upload copy-url-hover-v1.5.8.6.xpi
```

## Installation for Users

### From GitHub Releases

1. Download `copy-url-hover-v1.5.8.6.xpi`
2. Open Firefox/Zen Browser
3. Go to `about:addons`
4. Click gear icon → "Install Add-on From File..."
5. Select the downloaded .xpi file

### Verification Steps

After installation, verify the fix:

1. **Test Keyboard Shortcuts:**
   - Open any webpage with links
   - Hover over a link
   - Press `Y` key (default for copy URL)
   - URL should be copied to clipboard
   - Try other shortcuts: `X` (copy text), `Q` (Quick Tab), `O` (open new tab)

2. **Test Debug Mode:**
   - Click extension icon → Settings
   - Go to Advanced tab
   - Enable "Debug Mode"
   - Save settings
   - Open web console (F12)
   - Hover over links
   - Should see `[DEBUG]` messages in console

3. **Test Custom Settings:**
   - Configure custom keyboard shortcuts
   - Save settings
   - Test that custom shortcuts work
   - Reload page, verify settings persist

## Expected Behavior After Fix

### Before (v1.5.8.5 - Broken)
- ✗ Keyboard shortcuts use default keys only
- ✗ Debug mode never enables
- ✗ Custom settings ignored
- ✓ Copy text works (because it uses default 'X')

### After (v1.5.8.6 - Fixed)
- ✓ Keyboard shortcuts use configured keys
- ✓ Debug mode enables when set
- ✓ All custom settings work
- ✓ Settings persist across browser restarts

## Documentation

- **Bug Fix Report:** `docs/manual/BUG-FIX-v1.5.8.6.md`
- **Security Summary:** `docs/security-summaries/SECURITY-SUMMARY-v1.5.8.6.md`

## Rollback Plan

If issues arise with v1.5.8.6:

1. Users can downgrade to v1.5.8.4 (last known working modular version before the storage changes)
2. Or use content-legacy.js (non-modular version) temporarily
3. Report issues on GitHub

## Support

If users report issues after release:

1. Ask them to enable debug mode
2. Check browser console for errors
3. Verify they installed v1.5.8.6 (check in about:addons)
4. Test in clean browser profile to rule out conflicts

## Notes

- **Manifest v2:** Still using Manifest v2 (required for webRequestBlocking)
- **Auto-updates:** Extension will auto-update if user has previous version installed
- **Compatibility:** Works on Firefox 115+ and Zen Browser
- **No data migration needed:** Fix is backward compatible with existing settings

## Conclusion

Version 1.5.8.6 is ready for release. The critical configuration loading bug has been fixed, and all keyboard shortcuts and debug mode functionality has been restored.

**Recommended Action:** Merge PR and create release tag to deploy automatically via GitHub Actions.
