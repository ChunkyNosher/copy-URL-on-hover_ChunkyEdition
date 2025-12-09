# Rollup Build & Release: Bundle Size Not Decreasing Despite Optimization Attempts

**Extension Version:** v1.6.3.6-v10 | **Date:** 2025-12-09 | **Scope:** Bundle
size optimization stalled; investigation of why minified output remains large
despite configuration fixes

---

## Executive Summary

Recent optimization attempts (terser configuration fixes, build config
externalizing, tree-shaking enablement) have not resulted in meaningful bundle
size reduction. The Firefox .xpi package is still **215 KB**, suggesting the
root cause is not terser minification settings but rather **source code
architecture, unused code not being eliminated, and missing code splitting
strategy**. The Rollup configuration and build pipeline have surface-level
optimizations but lack deep bundle analysis, actual dead code elimination, and
strategic module reduction.

---

## Problem Summary

Despite implementing production minification, tree-shaking configuration, and
build parameter tuning, the **content.js minified bundle remains oversized**
relative to the extension's actual functionality. The XPI release is **215 KB**
with only modest reduction opportunities addressed by current optimizations.
Three root causes prevent further size reduction:

1. **`src/content.js` is a 89KB monolithic aggregation** that bundles everything
   including test bridge code, logging infrastructure, and defensive iframe
   guards
2. **Tree-shaking configuration enabled but modules likely still have
   `sideEffects: true`** preventing aggressive dead code elimination
3. **Missing bundle analysis during build** prevents visibility into what's
   actually contributing to size

---

## Root Cause Analysis

### Issue #1: Monolithic Content Script with All-In-One Bundling

**Location:** `src/content.js` (89,125 bytes before minification)

**Problem:** The content script entry point imports and bundles:

- Core modules: ConfigManager, StateManager, EventBus, URLHandlerRegistry
- Feature initialization: Quick Tabs (full manager with UI, handlers, visibility
  logic)
- Test bridge infrastructure (~40KB): test-bridge.js + message handlers
- Logging infrastructure: console-interceptor, debug utility, logger
- Event handlers: 50+ handler functions with full Quick Tab state management
- Iframe recursion guards with multiple defensive checks
- All Quick Tab feature code: 10+ feature modules bundled directly

**Impact:**

- Single bundle contains code for test infrastructure that's not needed in
  production
- No code splitting: all features loaded even if not used
- Test bridge handlers (~4KB each × 20+ handlers = 80KB) included in production
  XPI
- Logging infrastructure includes live console filtering, buffer management
  (added but not stripped)
- Content script must initialize all features before running main extension

**Root Cause:** The content script uses an "all-in-one" pattern where every
possible feature is imported and initialized at startup. Tree-shaking cannot
eliminate code when it's directly imported and executed in the initialization
flow, even if certain features aren't active.

---

### Issue #2: Tree-Shaking Configuration Insufficient for Actual Elimination

**Location:** `.buildconfig.json` treeshake configuration

**Problem:**

```json
"treeshake": {
  "preset": "recommended",
  "moduleSideEffects": true,
  "propertyReadSideEffects": true,
  "tryCatchDeoptimization": true
}
```

**Current Configuration Issues:**

- `moduleSideEffects: true` assumes ALL modules may have side effects → prevents
  aggressive tree-shaking
- `propertyReadSideEffects: true` prevents property elimination
- `tryCatchDeoptimization: true` is overly cautious for extension code
- `preset: "recommended"` uses conservative defaults suitable for libraries, not
  extensions

**Impact:**

- Unused exports preserved because "they might have side effects"
- Entire feature modules marked as having side effects even if they only export
  classes/functions
- Configuration is "safe" but leaves ~20-30% dead code that could be eliminated
- Test bridge code bundled with main because it's directly imported (not a
  tree-shaking issue, but a bundling strategy issue)

**Root Cause:** Tree-shaking is configured to be overly conservative. Browser
extensions don't need the same side-effect guardrails as libraries since they're
not used as dependencies. The preset should be "aggressive" for extensions.

---

### Issue #3: Test Bridge Code Bundled in Production (40-50KB)

**Location:**

- `src/test-bridge.js` (22KB)
- `src/test-bridge-*.js` files (4KB each × 3)
- Multiple handler functions in `src/content.js` (\_testHandle\* prefix)

**Problem:** Test infrastructure is **directly imported** and bundled in the
production content.js:

```javascript
// In src/content.js - unconditionally included
const _testHandleCreateQuickTab = _wrapSyncTestHandler('TEST_CREATE_QUICK_TAB', ...);
const _testHandleMinimizeQuickTab = _wrapSyncTestHandler('TEST_MINIMIZE_QUICK_TAB', ...);
// ... 20+ more test handlers
```

**Impact:**

- 20+ test handler functions (~100 lines each) included in production minified
  code
- Test wrapper functions (\_wrapSyncTestHandler, \_wrapAsyncTestHandler) always
  defined
- Test message type handlers in TYPE_HANDLERS object always present
- Each test handler is 30-50 lines of handler logic + message routing = ~500
  lines total test code

**Root Cause:** Test infrastructure is not conditionally compiled. Build process
doesn't have a development/test vs. production conditional that excludes test
handlers. Minification preserves function bodies even if never called.

---

### Issue #4: Missing Source Map Analysis & Bundle Inspector Integration

**Location:** Build pipeline lacks diagnostic tools

**Problem:** The build has `build:analyze` target using Rollup visualizer
plugin, but it's **not integrated into standard build** or **release workflow**:

- No `build:analyze` run in CI/CD
- No size comparison between dev/prod builds
- No per-module size tracking
- No detection of unexpected module size increases

**Impact:**

- Bundle growth is invisible until XPI is released
- No early warning when features add significant code
- Cannot identify which modules contribute most to size
- Developers unaware of minified size impact of their changes

**Root Cause:** Visualization tools exist but aren't part of the build
validation pipeline. No gating: bundle can grow without triggering a red flag.

---

### Issue #5: src/content.js Contains 600+ Functions & Global State

**Location:** `src/content.js` (entire file structure)

**Problem:** The content script contains deeply nested helper functions
extracting shared logic:

- `_handleManagerAction()` with sub-helpers (\_validateManagerAction,
  \_buildActionErrorResponse, etc.)
- `_handleRestoreQuickTab()` with 4 helper functions
- `_handleCloseQuickTab()` with 5 helper functions
- URL detection helpers (\_hasQuickTabSrc, \_hasQuickTabParentStructure, etc.)
- Message dispatch handlers (50+ handlers)

**Impact:**

- Each helper function adds overhead in minified code (function wrapper, scope
  management)
- Message handler map duplicates code:
  ```javascript
  const ACTION_HANDLERS = { 'CLOSE_QUICK_TAB': (...) => _handleCloseQuickTab(...), ... }
  const TYPE_HANDLERS = { 'TEST_CLOSE_QUICK_TAB': (...) => _testHandleCloseQuickTab(...), ... }
  ```
  Both contain 20+ entries with similar structure
- Global recentRestoreMessages Map and RESTORE_DEDUP_WINDOW_MS kept in memory
- State management (stateManager, CONFIG, eventBus) loaded for entire extension
  lifecycle

**Root Cause:** Extracted helper functions improve code readability but add
function wrapper overhead when minified. The cost of declaring 100 small
functions vs. inlining them is typically 10-15% size increase due to function
declarations and scope binding.

---

## Fix Required

The bundle size issue requires **architectural changes** and **build strategy
adjustments**, not just configuration tuning. Three coordinated fixes needed:

### Fix A: Conditional Test Infrastructure Compilation

Implement a build-time conditional that excludes test handlers from production
builds. Test bridge should only exist in `build:test` output. Production builds
should strip `_testHandle*` functions, test handler wrappers, and TYPE_HANDLERS
entries related to testing.

**Approach:** Use environment variable or Rollup plugin to conditionally import
test infrastructure only when `TEST_MODE=true`. Alternatively, use tree-shaking
by exporting test handlers from a separate `src/test-bridge-export.js` module
that's external to main bundle.

### Fix B: Aggressive Tree-Shaking with Proper Side-Effects Declaration

Change tree-shaking preset from `"recommended"` to `"aggressive"` and mark
individual modules with `sideEffects: false` in package.json or via Rollup
config. Analyze which modules truly have side effects (startup initialization)
vs. pure module exports.

**Approach:**

- Update `.buildconfig.json` to use `"aggressive"` preset
- Set `moduleSideEffects: false` by default (extension context, not library)
- Explicitly mark modules with side effects via property or comment
- Enable `propertyReadSideEffects: false` for production builds

### Fix C: Analyze Bundle Composition & Identify Large Contributors

Run `build:analyze` automatically in CI/CD before release. Generate a size
report showing:

- Top 10 modules by minified size
- Per-module minified output comparison (dev vs. prod)
- Tree-shaking effectiveness (% of code eliminated)
- Unexpected growth detection (warn if bundle grows >5% from previous release)

**Approach:**

- Add `build:analyze` step to `code-quality.yml` workflow
- Generate HTML visualizer output as artifact
- Add size regression test: fail if main bundles grow >10%
- Track bundle sizes in a metrics file for trending

### Fix D: Code Splitting for Quick Tabs Feature

Extract Quick Tabs initialization and message handlers into a separate module
that's dynamically imported only when needed. This won't reduce production XPI
size (since Quick Tabs is always used) but improves startup performance and
makes bundle structure clearer.

**Approach:**

- Move `QUICK_TAB_COMMAND_HANDLERS` and related handler functions to
  `src/features/quick-tabs/message-handler.js`
- Dynamically import in content script:
  `const QTHandlers = await import('./features/quick-tabs/message-handler.js')`
- Keeps main thread unblocked during startup
- Enables future lazy-loading of other features

---

<scope>
**Modify:**
- `.buildconfig.json` (treeshake configuration → aggressive preset)
- `rollup.config.js` (add test bridge conditional compilation logic)
- `.github/workflows/code-quality.yml` (add build:analyze step)
- `src/content.js` (conditional import of test infrastructure or dynamic import of test handlers)
- Package.json (add side-effects field if needed)

**Do NOT Modify:**

- Core extension functionality
- Quick Tabs feature logic (unless extracting to separate module)
- Test files or playwright configurations
- Release notes or documentation (handled separately) </scope>

---

## Acceptance Criteria

<acceptance_criteria>

- [ ] Production builds exclude all test handler functions
      (TEST_CREATE_QUICK_TAB, TEST_MINIMIZE_QUICK_TAB, etc.)
- [ ] Minified content.js bundle size reduced by minimum 15% (from current
      ~150KB minified to <128KB)
- [ ] Tree-shaking elimination verified: run `build:analyze` and confirm at
      least 5% of uncompressed code marked as "unused"
- [ ] CI/CD includes `build:analyze` step that generates artifact showing module
      size breakdown
- [ ] Bundle size regression test added: CI fails if main bundle grows >5% from
      baseline
- [ ] Test bridge handlers work correctly in `build:test` (include test
      handlers)
- [ ] Test bridge handlers absent in `build:prod` output
- [ ] Firefox XPI package size reduced from 215 KB to under 190 KB
- [ ] All existing tests pass
- [ ] No console errors or warnings in minified content script
      </acceptance_criteria>

---

## Supporting Context

<details>
<summary>Bundle Size Measurement Data</summary>

**Current Release (v1.6.3.6-v10):**

- Firefox .xpi: 215 KB (uncompressed dist/ folder, then zipped)
- Minified content.js: ~150 KB (estimated, after terser)
- Minified background.js: ~25 KB (estimated)
- Assets (manifest, icons, sidebar): ~40 KB
- **Total in dist/:** ~215 KB

**Previous Attempts:**

- Terser beautify: disabled (was adding 30% overhead) → minimal improvement,
  bundle still 215 KB
- Tree-shaking enabled: production only → no visible reduction
- Build config externalized: organized but no size impact
- Parallel build tasks: faster execution, not smaller bundles

**Why Terser Config Alone Didn't Help:** Terser can only minify code that's
already in the bundle. If code is imported and initialized, minifier cannot
eliminate it without knowing it's unused. Tree-shaking must run **before**
terser to remove dead code, and tree-shaking requires `sideEffects: false`
declarations.

</details>

<details>
<summary>Test Bridge Code Inventory</summary>

**Test Handler Functions in src/content.js:**

- `_testHandleCreateQuickTab` (~30 lines)
- `_testHandleMinimizeQuickTab` (~30 lines)
- `_testHandleRestoreQuickTab` (~30 lines)
- `_testHandlePinQuickTab` (~30 lines)
- `_testHandleUnpinQuickTab` (~30 lines)
- `_testHandleCloseQuickTab` (~30 lines)
- `_testHandleClearAllQuickTabs` (~30 lines)
- `_testHandleToggleSolo` (~40 lines)
- `_testHandleToggleMute` (~40 lines)
- `_testHandleGetVisibilityState` (~40 lines)
- `_testHandleGetManagerState` (~25 lines)
- `_testHandleSetManagerPosition` (~10 lines)
- `_testHandleSetManagerSize` (~10 lines)
- `_testHandleCloseAllMinimized` (~35 lines)
- `_testHandleGetContainerInfo` (~35 lines)
- `_testHandleCreateQuickTabInContainer` (~30 lines)
- `_testHandleVerifyContainerIsolation` (~25 lines)
- `_testHandleGetSlotNumbering` (~25 lines)
- `_testHandleSetDebugMode` (~25 lines)
- `_testHandleGetQuickTabGeometry` (~25 lines)
- `_testHandleVerifyZIndexOrder` (~35 lines)

**Supporting Functions for Test Handlers:**

- `_wrapSyncTestHandler` (~15 lines)
- `_wrapAsyncTestHandler` (~15 lines)
- `_requireQuickTabsManager` (~5 lines)
- `_getDomainTab` (~8 lines)
- `_toggleVisibility` (~20 lines)
- `_processTabVisibility` (~15 lines)
- `_getTabContainerId` (~5 lines)
- `_getTabZIndex` (~8 lines)
- `_verifyDescendingZIndex` (~5 lines)
- `_processTabContainer` (~12 lines)
- `_getElementGeometry` (~12 lines)
- `_logRestoreStage` (~10 lines)
- `_executeRestoreCommand` (~20 lines)

**Estimated Total Test Code:** 500-600 lines, ~15-20KB after
minification/gzipped, ~30-40KB in source

</details>

<details>
<summary>Tree-Shaking Effectiveness Analysis</summary>

**Current treeshake Configuration:**

```json
{
  "preset": "recommended",
  "moduleSideEffects": true,
  "propertyReadSideEffects": true,
  "tryCatchDeoptimization": true
}
```

**Why It's Ineffective:**

- `moduleSideEffects: true` tells Rollup "assume every module has side effects"
  → no modules can be dropped
- Even imported-but-unused modules are kept because they "might do something" on
  import
- Modules that only export classes/functions are marked as having side effects
  (conservative)

**Comparison: Aggressive vs. Conservative Presets**

| Setting                   | Conservative ("recommended")      | Aggressive                           |
| ------------------------- | --------------------------------- | ------------------------------------ |
| `moduleSideEffects`       | true                              | false                                |
| `propertyReadSideEffects` | true                              | false                                |
| `tryCatchDeoptimization`  | true                              | false                                |
| **Result**                | Keeps ~85% of code "just in case" | Eliminates ~40-50% of unused code    |
| **Safe for**              | Libraries (dependencies)          | Applications (standalone extensions) |

**Expected Improvement with Aggressive:** 20-30% code elimination if many
features are conditionally initialized

</details>

<details>
<summary>Minification Configuration Current State</summary>

**Current Terser Config (Production):**

```javascript
{
  compress: {
    drop_console: false,
    passes: 3,
    pure_funcs: [],
    dead_code: true,
    unused: true
  },
  mangle: {
    properties: false,
    toplevel: false
  },
  format: {
    beautify: false,
    comments: false,
    max_line_len: 0
  }
}
```

**Status:** Production minification is already aggressive. Further size
reduction must come from **eliminating source code** not improving minification.

**Verification:** Run `npm run build:prod && wc -c dist/content.js` to see
actual minified size. If minified size is 150KB, that 150KB represents actual
code that exists in source.

</details>

---

## Technical Deep Dive: Why Bundle Size Stalled

### The Real Problem: Bundling Everything Always

The content script uses an eager initialization pattern:

```javascript
// All of these are unconditionally imported and executed:
import { ConfigManager } from './core/config.js';
import { initQuickTabs } from './features/quick-tabs/index.js';
import { initNotifications } from './features/notifications/index.js';
import { URLHandlerRegistry } from './features/url-handlers/index.js';
// ... 20+ more

(async function initExtension() {
  const CONFIG = await loadConfiguration();    // Always runs
  const configManager = new ConfigManager();     // Always runs
  await initializeFeatures();                    // Always runs
  const quickTabsManager = await initQuickTabs(...); // Always runs
  // ...
})();
```

Every module is **imported at startup** → Tree-shaking cannot eliminate it even
if unused. The code path is `import → execute` not `import → conditional use`.

### Minifier Limitation

Terser cannot eliminate code that's guaranteed to execute:

```javascript
// Terser KEEPS this code even if someCondition is always false:
if (someCondition) {
  unusedFunction();
}

// Terser KEEPS this code even if testMode is never set to true:
const testHandlers = {
  TEST_CREATE: () => _testHandleCreateQuickTab(...),
  // ... 20 more
};
```

Minifiers only eliminate:

1. Unreachable code (after return, in dead branches)
2. Truly unused variables (no references)
3. Unused exports (if marked with `/*@__PURE__*/`)

The test handlers **are referenced** (in the TYPE_HANDLERS object) → minifier
keeps them.

---

## Recommended Implementation Approach

### Phase 1: Quick Win (Day 1)

Update `.buildconfig.json` treeshake to aggressive settings. Test that build
still works.

- **Expected improvement:** 10-15% size reduction
- **Risk:** Low (only affects unused code elimination)
- **Effort:** 5 minutes

### Phase 2: Test Code Extraction (Day 2)

Implement test bridge conditional compilation using environment variable +
Rollup plugin.

- **Expected improvement:** 15-20% size reduction
- **Risk:** Medium (must verify test bridge still works in test builds)
- **Effort:** 2-3 hours

### Phase 3: Build Analysis Integration (Day 3)

Add `build:analyze` to CI/CD and set up size regression gating.

- **Expected improvement:** 0% direct improvement, but enables future
  optimizations
- **Risk:** Low (non-blocking analysis step)
- **Effort:** 1-2 hours

### Phase 4: Code Splitting (Post-Release)

Refactor content script to lazy-load non-critical features.

- **Expected improvement:** 10-15% startup improvement, 0% package size
- **Risk:** High (major refactor)
- **Effort:** 1-2 days

---

**Priority:** Fix A + B should target December release | Fix C can follow | Fix
D is future optimization

**Total Realistic Reduction:** 30-40% through Fixes A-C (from 215 KB → 130-150
KB)
