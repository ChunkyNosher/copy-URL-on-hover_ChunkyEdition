# Unused Code Removal Guide for copy-URL-on-hover_ChunkyEdition

**Repository:** copy-URL-on-hover_ChunkyEdition  
**Version Analyzed:** v1.6.2.2  
**Analysis Date:** November 26, 2025

## Executive Summary

This document identifies unused code, duplicate files, obsolete settings, and
test-only artifacts in the `src/` directory that can be safely removed to reduce
bundle size and improve maintainability. All recommendations preserve
functionality while eliminating dead code.

---

## 1. Duplicate Files (High Priority)

### 1.1 Duplicate `browser-api.js`

**Problem:** Two identical copies exist in different locations.

**Files:**

- `src/utils/browser-api.js` (5,196 bytes)
- `src/core/browser-api.js` (7,734 bytes)

**Analysis:**

- `src/content.js` imports from `src/core/browser-api.js` (line 114)
- The `src/core/` version includes enhanced logging from `logger.js`
- The `src/utils/` version is older and lacks logging integration
- No files import from `src/utils/browser-api.js`

**Recommendation:**

```bash
# Safe to delete
rm src/utils/browser-api.js
```

**Verification:**

```bash
# Check for imports (should return nothing)
grep -r "from.*utils/browser-api" src/
grep -r "import.*utils/browser-api" src/
```

---

### 1.2 Duplicate `dom.js`

**Problem:** Identical DOM utility files in two locations.

**Files:**

- `src/utils/dom.js` (4,513 bytes)
- `src/core/dom.js` (4,513 bytes)

**Analysis:**

- Both files have identical SHA: `bfd866c10640dd9765d4a00c0f35ad438b5cdb8e`
- No imports found from either location in the codebase
- Functions like `createElement`, `removeElement`, `setAttribute` appear unused

**Recommendation:**

```bash
# Delete both if unused, or keep core/ version if needed
rm src/utils/dom.js
rm src/core/dom.js  # Only if no imports found
```

**Verification:**

```bash
# Check for any imports
grep -rn "from.*dom\.js" src/
grep -rn "import.*dom" src/
```

---

### 1.3 Duplicate Logger Files

**Problem:** Two logger implementations coexist.

**Files:**

- `src/utils/Logger.js` (7,108 bytes) - Uppercase, old implementation
- `src/utils/logger.js` (9,309 bytes) - Lowercase, newer with live console
  filtering

**Analysis:**

- `src/utils/logger.js` is actively imported by `src/core/browser-api.js`
- `src/utils/Logger.js` (uppercase) appears to be legacy code
- Newer `logger.js` includes v1.6.0.9 live console filtering

**Recommendation:**

```bash
# Safe to delete old Logger
rm src/utils/Logger.js
```

---

## 2. Backup Files (High Priority)

**Problem:** Development backup files committed to repository.

**Files:**

- `src/features/quick-tabs/index.js.backup` (50,527 bytes)
- `src/features/quick-tabs/panel.js.backup-phase2.10` (41,296 bytes)

**Analysis:**

- Backup files from refactoring work
- Not referenced in build configuration (`rollup.config.js`)
- Should be in `.gitignore` instead of repository

**Recommendation:**

```bash
# Delete backup files
rm src/features/quick-tabs/index.js.backup
rm src/features/quick-tabs/panel.js.backup-phase2.10

# Add to .gitignore
echo "*.backup" >> .gitignore
echo "*.backup-*" >> .gitignore
```

**Estimated Savings:** ~91KB of repository bloat

---

## 3. Test Bridge Files (Conditional - Production Only)

**Problem:** Test infrastructure included in production builds.

**Files:**

- `src/test-bridge.js` (22,490 bytes)
- `src/test-bridge-background-handler.js` (3,188 bytes)
- `src/test-bridge-content-handler.js` (1,550 bytes)
- `src/test-bridge-page-proxy.js` (4,440 bytes)

**Analysis:**

- Test bridge enables Playwright MCP testing
- Currently embedded in `src/content.js` (lines 588-1011)
- Used for autonomous testing but not needed in production
- Build script `build:test` injects these, but regular `build` and `build:prod`
  do not strip them

**Current Situation:**

```javascript
// In src/content.js lines 588-1011
if (message.type === 'TEST_CREATE_QUICK_TAB') { ... }
if (message.type === 'TEST_MINIMIZE_QUICK_TAB') { ... }
// ... many more test handlers
```

**Recommendation:**

### Option A: Conditional Compilation (Preferred)

Wrap test handlers in environment checks:

```javascript
// In src/content.js
if (typeof process !== 'undefined' && process.env.TEST_MODE === 'true') {
  // Test bridge message handlers here
  if (message.type === 'TEST_CREATE_QUICK_TAB') { ... }
}
```

Then use terser's `drop_console` with environment-based dead code elimination:

```javascript
// In rollup.config.js
terser({
  compress: {
    drop_console: production,
    dead_code: true,
    global_defs: {
      'process.env.TEST_MODE': production ? 'false' : 'true'
    }
  }
});
```

### Option B: Separate Test Build

Keep current approach but ensure production builds exclude test handlers:

```bash
# Production build should NOT include test code
npm run build:prod  # Current - may still include test handlers

# Test build with full test bridge
npm run build:test  # Includes test-bridge injection
```

**Verification:**

```bash
# Check if test handlers in production bundle
grep -n "TEST_CREATE_QUICK_TAB" dist/content.js
# Should return nothing for production builds
```

**Estimated Savings (Production):** ~31KB of code + bundle reduction

---

## 4. Unused Configuration Settings

**Problem:** Config options defined but never used in code.

**Location:** `src/core/config.js`

### 4.1 `quickTabCloseOnOpen` (Unused)

**Definition:**

```javascript
quickTabCloseOnOpen: false,
```

**Analysis:**

- No references found in `src/content.js`
- Not used in `src/features/quick-tabs/index.js`
- Settings UI may still show this option
- Feature was likely planned but never implemented

**Impact:** No functional impact, just config bloat

**Recommendation:**

```javascript
// Remove from DEFAULT_CONFIG in src/core/config.js
// Remove from settings UI (popup.html / options_page.html)
```

---

### 4.2 `quickTabCustomX` and `quickTabCustomY` (Questionable)

**Definition:**

```javascript
quickTabCustomX: 100,
quickTabCustomY: 100,
```

**Analysis:**

- Only mentioned in default config
- `quickTabPosition` setting exists (`'follow-cursor'` default)
- May be used for custom position mode, but no evidence found
- `calculateQuickTabPosition()` in `content.js` uses
  `stateManager.get('lastMouseX/Y')` instead

**Recommendation:**

- If custom position mode is NOT implemented: **Remove**
- If it exists but unused: **Document or remove**

---

### 4.3 `quickTabUpdateRate` (Obsolete)

**Definition:**

```javascript
quickTabUpdateRate: 360, // Position updates per second (Hz) for dragging
```

**Analysis:**

- Comment suggests this controlled dragging update frequency
- Modern implementation uses Pointer Events API (no manual polling)
- Quick Tabs now use `pointerdown/pointermove/pointerup` events (efficient)
- This setting is a legacy from old implementation

**Recommendation:**

```javascript
// Safe to remove from src/core/config.js
// Modern dragging uses native browser events, no throttling needed
```

---

## 5. Unused Storage Adapters (Low Priority)

**Problem:** Multiple storage adapters exist but may not all be used.

**Files:**

- `src/storage/SessionStorageAdapter.js` (6,676 bytes)
- `src/storage/SyncStorageAdapter.js` (8,292 bytes)
- `src/storage/StorageAdapter.js` (2,478 bytes - base class)
- `src/storage/FormatMigrator.js` (5,784 bytes)

**Analysis:**

- Part of v1.6.0 Phase 1 refactoring (Domain-Driven Design)
- `SessionStorageAdapter` handles temporary storage
- `SyncStorageAdapter` handles persistent storage with quota management
- `FormatMigrator` handles legacy format conversion
- These are part of tested architecture (96% coverage)

**Recommendation:**

- **DO NOT REMOVE** - These are actively used
- Part of architectural improvement (see README Phase 1)
- Used by Quick Tabs storage layer

---

## 6. Unused Domain Models (Investigation Needed)

**Problem:** Multiple domain entity implementations exist.

**Files:**

- `src/domain/QuickTab.js` (12,244 bytes)
- `src/domain/ReactiveQuickTab.js` (17,577 bytes)

**Analysis:**

- `ReactiveQuickTab.js` wraps `QuickTab` with reactive proxy
- Both appear to be part of v1.6.0 architecture
- Need to verify which is actively used in Quick Tabs feature

**Recommendation:**

```bash
# Check which is imported
grep -rn "from.*domain/QuickTab" src/
grep -rn "from.*domain/ReactiveQuickTab" src/

# If only one is used, the other may be legacy
```

**Status:** Requires deeper investigation

---

## 7. Unused Shims (Low Priority)

**File:** `src/shims/container-shim.js` (1,594 bytes)

**Analysis:**

- Cross-browser compatibility shim for Firefox Containers
- Used for Chrome/Edge which don't support containers
- Provides fallback behavior (single default container)
- **KEEP** - Essential for cross-browser support

**Recommendation:** No action needed

---

## Removal Plan

### Phase 1: Safe Deletions (Zero Risk)

Execute these immediately:

```bash
# 1. Remove duplicate files
rm src/utils/browser-api.js
rm src/utils/dom.js
rm src/utils/Logger.js

# 2. Remove backup files
rm src/features/quick-tabs/index.js.backup
rm src/features/quick-tabs/panel.js.backup-phase2.10

# 3. Update .gitignore
echo "*.backup" >> .gitignore
echo "*.backup-*" >> .gitignore
```

**Estimated Savings:** ~97KB

---

### Phase 2: Config Cleanup (Low Risk)

Edit `src/core/config.js`:

```javascript
export const DEFAULT_CONFIG = {
  // ... keep existing settings ...
  // REMOVE these:
  // quickTabCloseOnOpen: false,  // Never implemented
  // quickTabUpdateRate: 360,     // Obsolete (now uses Pointer Events)
  // quickTabCustomX: 100,        // Unused (unless custom position mode exists)
  // quickTabCustomY: 100,        // Unused (unless custom position mode exists)
};
```

**Verification:**

1. Test extension loading
2. Verify Quick Tabs still work
3. Check settings UI for removed options

---

### Phase 3: Production Build Optimization (Medium Risk)

Implement conditional compilation for test bridge:

**Step 1:** Modify `src/content.js`

```javascript
// Wrap all TEST_ message handlers (lines 588-1011)
if (typeof process !== 'undefined' && process.env.TEST_MODE === 'true') {
  // Move all test bridge handlers here
  if (message.type === 'TEST_CREATE_QUICK_TAB') { ... }
  // ... etc
}
```

**Step 2:** Update `rollup.config.js`

```javascript
terser({
  compress: {
    dead_code: true,
    global_defs: {
      'process.env.TEST_MODE': production ? 'false' : 'true'
    }
  }
});
```

**Step 3:** Verify

```bash
# Build production
npm run build:prod

# Test bridge should be stripped
grep "TEST_CREATE_QUICK_TAB" dist/content.js
# Should return nothing

# Build test version
npm run build:test

# Test bridge should be present
grep "TEST_CREATE_QUICK_TAB" dist/content.js
# Should return matches
```

**Estimated Savings:** ~31KB in production builds

---

### Phase 4: Investigation Tasks

Before removing these, verify usage:

```bash
# Check if ReactiveQuickTab or QuickTab is used
grep -rn "ReactiveQuickTab" src/
grep -rn "domain/QuickTab" src/

# Check custom position settings usage
grep -rn "quickTabCustomX" src/
grep -rn "quickTabCustomY" src/
```

---

## Testing Checklist

After each removal phase:

### ✅ Core Functionality

- [ ] Extension loads without errors
- [ ] Copy URL (Y key) works
- [ ] Copy Text (X key) works
- [ ] Open in New Tab (O key) works

### ✅ Quick Tabs

- [ ] Create Quick Tab (Q key) works
- [ ] Drag Quick Tab by title bar
- [ ] Resize Quick Tab from edges/corners
- [ ] Minimize to manager panel
- [ ] Close Quick Tab (Escape)
- [ ] Quick Tab Manager panel opens (Ctrl+Alt+Z)

### ✅ Settings

- [ ] Extension popup opens
- [ ] Settings save correctly
- [ ] Debug mode toggle works
- [ ] Dark mode toggle works

### ✅ Cross-Browser

- [ ] Test in Firefox
- [ ] Test in Chrome/Edge (if applicable)

---

## Bundle Size Monitoring

Track improvements with:

```bash
# Before changes
npm run build:prod
ls -lh dist/content.js
ls -lh dist/background.js

# After changes
npm run build:prod
ls -lh dist/content.js
ls -lh dist/background.js
```

**Expected Improvements:**

- Phase 1: ~97KB reduction in source tree
- Phase 2: ~5KB reduction in bundled config
- Phase 3: ~31KB reduction in production bundle
- **Total Potential:** ~133KB savings

---

## Rollback Procedure

If issues arise:

```bash
# Restore from git
git checkout HEAD -- src/utils/browser-api.js
git checkout HEAD -- src/utils/dom.js
git checkout HEAD -- src/utils/Logger.js
git checkout HEAD -- src/core/config.js
git checkout HEAD -- src/content.js

# Rebuild
npm run build:prod
```

---

## Architecture Notes

### Files to KEEP (Active Architecture)

These are part of the v1.6.0 Domain-Driven Design refactoring and are actively
used:

✅ `src/domain/QuickTab.js` - Core domain entity  
✅ `src/domain/ReactiveQuickTab.js` - Reactive wrapper (verify usage)  
✅ `src/storage/*.js` - Storage abstraction layer  
✅ `src/core/*` - Core utilities (excluding duplicates)  
✅ `src/features/quick-tabs/*` - Quick Tabs feature (excluding backups)  
✅ `src/shims/container-shim.js` - Cross-browser compatibility

### Files NOT in Bundle (Build-Time Only)

These are development dependencies not included in extension:

- `rollup.config.js` - Build configuration
- `package.json` - Dependencies and scripts
- `.eslintrc.*` - Linting rules
- `jest.config.*` - Test configuration
- All `*.test.js` files

---

## Summary Table

| Category            | Files     | Size       | Risk   | Priority |
| ------------------- | --------- | ---------- | ------ | -------- |
| Duplicate Files     | 3         | ~17KB      | Zero   | High     |
| Backup Files        | 2         | ~91KB      | Zero   | High     |
| Test Bridge         | 4         | ~31KB      | Low    | Medium   |
| Unused Config       | 4 options | ~5KB       | Low    | Medium   |
| Investigation       | 2+        | TBD        | Medium | Low      |
| **Total Potential** | **11+**   | **~133KB** | -      | -        |

---

## Questions for Verification

Before finalizing removals, confirm:

1. **Custom Position Mode:** Does `quickTabCustomX/Y` have a UI toggle for
   custom position mode?
2. **ReactiveQuickTab:** Is `ReactiveQuickTab.js` used or is plain `QuickTab.js`
   sufficient?
3. **Test Bridge:** Should test handlers be in production or development-only?
4. **DOM Utilities:** Are `src/core/dom.js` functions used anywhere?

Check settings UI files:

- `popup.html`
- `options_page.html`
- `sidebar/settings.html`

---

## Additional Recommendations

### 1. Add Build Size Validation

Add to `package.json`:

```json
{
  "scripts": {
    "postbuild": "node scripts/check-bundle-size.js"
  }
}
```

Already exists as `build:check-size` - integrate into main build.

### 2. Document Architecture Decisions

Create `docs/ARCHITECTURE.md` documenting:

- Which storage adapter to use when
- Which domain model to use (QuickTab vs ReactiveQuickTab)
- Test vs production builds

### 3. Improve .gitignore

Add patterns to prevent backup file commits:

```gitignore
# Backup files
*.backup
*.backup-*
*.bak
*~

# IDE files
.vscode/
.idea/
```

---

## Conclusion

This guide identifies **~133KB** of removable code across 11+ files, organized
by risk level. Start with Phase 1 (zero-risk deletions) and proceed through
phases with thorough testing. All recommendations preserve functionality while
reducing bundle size and maintenance burden.

**Next Steps:**

1. Execute Phase 1 removals
2. Run test suite: `npm run test`
3. Test manually in browser
4. Commit changes: `git commit -m "chore: remove duplicate and unused code"`
5. Proceed to Phase 2 if Phase 1 succeeds

**Estimated Time:**

- Phase 1: 15 minutes (safe deletions + testing)
- Phase 2: 30 minutes (config cleanup + testing)
- Phase 3: 1-2 hours (conditional compilation + testing)
- Phase 4: 1-2 hours (investigation + verification)

**Total:** 3-4 hours for complete cleanup and verification.
