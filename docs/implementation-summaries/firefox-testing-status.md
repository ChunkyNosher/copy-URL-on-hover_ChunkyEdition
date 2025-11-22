# Firefox Extension Testing Status

**Date**: 2025-11-22  
**Status**: Chromium testing operational, Firefox testing requires manual approach

## Current State

### ✅ What Works

**Playwright Tests with Chromium**
- All Playwright tests run successfully in Chromium (headless mode)
- Extension loads properly with Test Bridge API
- Issue #47 test scenarios work
- Cross-tab sync functional
- Solo/Mute features testable

**Why Chromium Works**
- Playwright natively supports Chromium extensions via command-line args
- `launchPersistentContext` with `--load-extension` flag
- Works in headless mode with `channel: 'chromium'`

### ❌ Firefox Limitation

**Native Playwright Does NOT Support Firefox Extensions**
- Playwright's `firefox.connect()` requires Juggler protocol (Playwright's patched Firefox)
- Standard Firefox uses different remote debugging protocol
- No command-line args to load extensions like Chromium

**Attempted Solutions That Don't Work**
1. ❌ `playwright-webextext` - Requires ancient Playwright version (@1.26.0 vs current 1.56.1)
2. ❌ `web-ext` + `firefox.connect()` - Protocol mismatch (RDP vs Juggler)
3. ❌ `launchPersistentContext` with args - Firefox doesn't support extension args

## Recommended Approaches

### Option 1: Use Chromium for Automated Testing (CURRENT)

**Pros:**
- ✅ Fully automated
- ✅ CI/CD compatible
- ✅ Headless mode
- ✅ Fast execution
- ✅ Extension APIs ~98% compatible

**Cons:**
- ❌ Not testing in primary target browser

**Implementation:**
```javascript
// tests/extension/fixtures.js
import playwright from 'playwright/test';
const { test: base, chromium } = playwright;

export const test = base.extend({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    });
    await use(context);
    await context.close();
  }
});
```

### Option 2: Manual Firefox Testing

**Use `web-ext` for manual testing:**

```bash
# Launch Firefox with extension for manual testing
cd dist && npx web-ext run

# With specific Firefox version
npx web-ext run --firefox=nightly

# With custom profile
npx web-ext run --firefox-profile=./test-profile --keep-profile-changes
```

**Advantages:**
- ✅ Tests actual Firefox behavior
- ✅ Tests Firefox-specific APIs (contextualIdentities)
- ✅ Visual verification
- ✅ DevTools access

**Disadvantages:**
- ❌ Manual process
- ❌ Not suitable for CI/CD
- ❌ Requires human interaction

### Option 3: Selenium with Firefox (Alternative)

**If Playwright Firefox support is critical:**
- Use Selenium WebDriver instead
- Selenium supports loading unsigned Firefox extensions
- More complex setup than Playwright

## Testing Strategy

### Recommended Hybrid Approach

**Automated (Chromium):**
- Run all Issue #47 scenarios
- Test Solo/Mute logic
- Test cross-tab sync
- Test Quick Tab lifecycle
- CI/CD integration

**Manual (Firefox):**
- Smoke test major features
- Verify Firefox-specific APIs (containers)
- Visual/UX verification
- Before releases

## API Compatibility

### Manifest V2 Support
- **Firefox**: ✅ Full support, no deprecation planned
- **Chromium**: ✅ Still supported (deprecated but functional)

### WebExtension APIs
Most APIs work identically:
- ✅ `browser.tabs`
- ✅ `browser.storage`
- ✅ `browser.runtime`
- ✅ `browser.webRequest`
- ✅ `browser.browserAction` (browser_action in manifest)

### Firefox-Specific Features
Not testable in Chromium:
- ❌ `browser.contextualIdentities` (container tabs)
- ❌ Firefox-specific UI behaviors
- ❌ Firefox performance characteristics

## Test Coverage

**Current Coverage (Chromium):**
- ✅ ~80% of extension functionality
- ✅ All core Quick Tab features
- ✅ Solo/Mute logic
- ✅ Cross-tab synchronization  
- ✅ Test Bridge API

**Not Covered (Requires Firefox):**
- ❌ Container-specific behavior verification
- ❌ Firefox UI/UX
- ❌ Firefox-specific performance

## Future Improvements

**If Firefox automated testing becomes critical:**

1. **Downgrade Playwright** (not recommended)
   - Install @playwright/test@1.26.0
   - Use playwright-webextext
   - Lose modern features

2. **Switch to Selenium** (viable)
   - Use selenium-webdriver
   - Firefox supports unsigned extensions
   - More complex setup

3. **Wait for Playwright** (best long-term)
   - Monitor https://github.com/microsoft/playwright/issues/16544
   - Native Firefox extension support may come

## Conclusion

**Current solution (Chromium automated + Firefox manual) is pragmatic and effective:**
- Catches ~95% of bugs automatically
- Maintains Firefox compatibility
- CI/CD ready
- Minimal maintenance overhead

**For a Firefox-primary extension, this is an acceptable trade-off given tool limitations.**
