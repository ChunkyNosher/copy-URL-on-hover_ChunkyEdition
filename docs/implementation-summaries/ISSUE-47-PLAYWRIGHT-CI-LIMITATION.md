# Issue #47 Playwright Testing - CI Limitation Analysis

**Date:** 2025-11-23  
**Issue:** Cannot run Playwright extension tests in GitHub Actions CI  
**Root Cause:** launchPersistentContext hangs indefinitely in Xvfb environment  

## Problem Statement

Playwright tests for Issue #47 scenarios cannot run in GitHub Actions CI environment due to Chromium browser launch timeout. The `chromium.launchPersistentContext()` call hangs indefinitely (>180 seconds) when attempting to load the extension in the CI environment.

## Environment Details

- **Platform:** GitHub Actions ubuntu-latest runner
- **Display:** Xvfb :99 (1920x1080x24)
- **Playwright Version:** @playwright/test 1.56.1
- **Extension Type:** Manifest V2 WebExtension
- **Browser:** Chromium (for Chrome testing), Firefox (not yet working)

## Technical Analysis

### What Works
✅ Extension validation passes - manifest.json and all files present  
✅ Extension built successfully with test bridge injected  
✅ DISPLAY environment variable set correctly (:99)  
✅ Xvfb running and accessible  
✅ Fixture setup code executes without errors  

### What Fails
❌ `chromium.launchPersistentContext()` hangs indefinitely  
❌ No error messages - process just stops responding  
❌ Timeout doesn't trigger - hangs before timeout check  
❌ Firefox extension loading requires manual intervention  

## Attempted Solutions

### 1. Increased Timeouts
- **Tried:** timeout: 60000ms → 180000ms
- **Result:** Still hangs, no improvement
- **Conclusion:** Not a timeout issue

### 2. Simplified Chrome Args
- **Tried:** Removed complex optimization flags
- **Result:** Still hangs
- **Conclusion:** Args not the issue

### 3. Session State Cleanup
- **Tried:** Delete sessionstore files before launch
- **Result:** Still hangs
- **Conclusion:** Not session state related

### 4. Extension Path Validation
- **Tried:** Added pre-flight validation
- **Result:** Validation passes, still hangs on launch
- **Conclusion:** Extension files are correct

## Research Findings

### Known Issues
1. **launchPersistentContext hangs in CI** (Playwright #28336, #15953)
   - Common issue in Docker/CI environments
   - Especially problematic with extensions + Xvfb
   - No reliable workaround for headless:false + extensions

2. **Firefox Extension Loading** (Research via Perplexity)
   - Requires manual installation or pre-configured profile
   - about:debugging file picker cannot be automated
   - XPI packaging + profile setup needed

3. **Xvfb + Extension Compatibility**
   - Extension loading requires headed mode (headless: false)
   - But headed mode with Xvfb is unreliable
   - Race condition between X server init and Chromium

## Why This Happens

The hang occurs because:
1. Extensions REQUIRE `launchPersistentContext` (not regular `launch()`)
2. Extensions REQUIRE `headless: false` mode
3. CI environment uses Xvfb for virtual display
4. Chromium + persistent context + Xvfb = known incompatibility

The Chromium process likely gets stuck waiting for X display initialization that never completes properly in the automated environment.

## Alternative Solutions

### Option 1: Local Manual Testing ✅ RECOMMENDED
Run tests locally where real display is available:
```bash
npm run build:test
npm run test:extension:chrome
npm run test:extension:firefox  # After manual profile setup
```

### Option 2: Unit Testing Without Browser
Test business logic separately without full browser automation:
- Test Quick Tab state management
- Test cross-tab sync messages
- Test storage operations
- Mock browser APIs

### Option 3: Manual Verification Checklist
Follow manual test procedure for scenarios 1-7 and 9 (see below)

### Option 4: Different CI Platform
- Use CircleCI with real VM (not Docker)
- Use BrowserStack/Sauce Labs cloud browsers
- Use self-hosted runner with real display

## Manual Test Procedure for Issue #47

Since automated tests cannot run in CI, manual verification required:

### Prerequisites
1. Build extension: `npm run build:test`
2. Load extension in browser
3. Open extension popup or options page

### Scenario 1: Basic Creation and Cross-Tab Sync
1. Open Wikipedia page (WP 1)
2. Press Q to create Quick Tab (WP QT 1)
3. Verify QT appears
4. Open YouTube in new tab (YT 1)
5. Verify QT appears in YT 1 at same position/size
6. **Expected:** QT syncs across tabs instantly

### Scenario 2: Multiple Quick Tabs
1. Create 3 Quick Tabs (Wikipedia, YouTube, GitHub)
2. Open new tab
3. Verify all 3 QTs appear
4. **Expected:** All QTs sync globally

### Scenario 3: Solo Mode
1. Create Quick Tab on Wikipedia page
2. Click Solo button (🎯)
3. Switch to different site
4. **Expected:** QT only visible on Wikipedia

### Scenario 4: Mute Mode
1. Create Quick Tab
2. On specific tab, click Mute button (🔇)
3. Switch tabs
4. **Expected:** QT hidden only on muted tab

### Scenario 5: Manager Panel
1. Create Quick Tab
2. Press Ctrl+Alt+Z to open Manager
3. Click minimize in Manager
4. Open new tab
5. **Expected:** QT remains minimized across tabs

### Scenario 6: Cross-Tab Manager Sync
1. Minimize QT via toolbar
2. Open new tab
3. Open Manager
4. **Expected:** Shows QT as minimized
5. Restore from Manager
6. Switch tabs
7. **Expected:** QT restored everywhere

### Scenario 7: Position/Size Persistence
1. Move QT to corner, resize
2. Switch tabs
3. **Expected:** Position/size persists
4. Reload page
5. **Expected:** Position/size still persists

### Scenario 9: Close All Quick Tabs
1. Create 3 Quick Tabs
2. Open Manager
3. Click "Close All"
4. **Expected:** All QTs close everywhere
5. Switch tabs
6. **Expected:** No QTs visible

## Recommendations

### For This Issue (Issue #47)
✅ **Accept manual testing** for scenarios 1-7 and 9  
✅ **Document expected behavior** (already done in issue-47-revised-scenarios.md)  
✅ **Create manual test checklist** (above)  
✅ **Test locally before merge**  

### For Future Work
- Consider migrating to Manifest V3 (may have better CI support)
- Investigate alternative testing frameworks (Puppeteer, Selenium)
- Set up local test environment documentation
- Create video demonstrations of expected behavior

## Conclusion

**Playwright extension tests cannot run in current GitHub Actions CI setup due to browser launch incompatibility with Xvfb.**

This is a known limitation, not a bug in our code. The extension functionality should be verified through:
1. Manual testing locally
2. Unit tests for business logic
3. User acceptance testing

## Files Created

- `scripts/package-extension-firefox-test.cjs` - Firefox XPI packaging (for future use)
- `scripts/setup-firefox-test-profile.cjs` - Firefox profile setup (requires manual steps)
- `tests/extension/helpers/firefox-extension-installer.js` - Firefox installer (incomplete)
- `tests/extension/test-bridge-verify.spec.js` - Minimal verification test (cannot run in CI)

## References

- Playwright Issue #28336: launchPersistentContext timeout in CI pipelines
- Playwright Issue #15953: Chromium instability on self-hosted GitHub Actions
- Playwright Issue #12632: launchPersistentContext timeout on second launch
- Research: Firefox extension loading requires manual intervention
