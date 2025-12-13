# Test Bridge: Purpose, Current Implementation Status & Setup Requirements

**Extension Version:** v1.6.3+ | **Date:** December 13, 2025 | **Scope:** Test Bridge functionality, injection mechanism, and Copilot Agent compatibility

---

## Executive Summary

The Test Bridge is a programmatic API interface that exposes extension functionality for autonomous testing in CI environments where browser keyboard shortcuts cannot be triggered. It is **currently implemented** in the repository but requires verification that:

1. ✅ Test Bridge files exist and are correctly written
2. ✅ Message handlers in content scripts properly respond to Test Bridge calls
3. ⚠️ The injection step in `copilot-setup-steps.yml` correctly appends the bridge to `dist/background.js`
4. ⚠️ The Playwright tests are able to access and use the Test Bridge via `window.__COPILOT_TEST_BRIDGE__`

**Current Status:** Test Bridge is defined but may not be fully wired into the extension's message handling system. The Copilot Agent can create/fix the infrastructure without additional dependencies beyond what already exists.

---

## Part 1: What Is a Test Bridge?

### Purpose

A Test Bridge is a programmatic API that allows test code (including Playwright E2E tests and Copilot Agent automation) to trigger extension functionality without relying on user interactions like keyboard shortcuts or mouse clicks.

### Why It's Needed

Browser extension testing in CI has a fundamental limitation:
- ❌ **Keyboard shortcuts don't work** in Playwright because extensions run in an isolated context
- ❌ **Mouse interactions fail** on UI elements in iframe/overlay contexts
- ❌ **User-driven workflows can't be automated** in headless environments

The Test Bridge solves this by exposing programmatic methods that Playwright can call directly:

```javascript
// Without Test Bridge (doesn't work in Playwright):
await page.keyboard.press('q');  // ❌ Fails - extension doesn't receive event

// With Test Bridge (works in Playwright):
await page.evaluate(() => window.__COPILOT_TEST_BRIDGE__.createQuickTab(url));  // ✅ Works
```

### Design Pattern

The Test Bridge follows a standard pattern:
1. **Bridge file** (`src/test-bridge.js`) - Exposes API methods globally
2. **Message handlers** (in `src/background.js` or content scripts) - Respond to Test Bridge calls
3. **Injection mechanism** (in `copilot-setup-steps.yml`) - Includes bridge in production build during TEST_MODE
4. **Playwright tests** - Call bridge methods via `window.__COPILOT_TEST_BRIDGE__`

---

## Part 2: Current Implementation Status

### Files That Exist ✅

**Test Bridge API Files:**
- `src/test-bridge.js` - Main API with 50+ methods
- `src/test-bridge-page-proxy.js` - Page context proxy for message passing
- `src/test-bridge-content-handler.js` - Content script message handlers

**Message Handlers:**
- Test handlers in content scripts (should receive TEST_* message types)

**Build Injection:**
- `scripts/inject-test-bridge.cjs` - Script to inject bridge into built extension
- `scripts/verify-test-bridge.cjs` - Script to verify bridge is properly injected

**Tests:**
- `tests/extension/test-bridge-check.spec.js` - Verifies bridge is accessible
- `tests/extension/test-bridge-verify.spec.js` - Verifies bridge functionality

**Workflow Integration:**
- `copilot-setup-steps.yml` - Should have step to inject test bridge after build

### Files That Document Issues ✅

- `docs/manual/v1.6.0/copilot-testing-implementation.md` - Full implementation guide
- `docs/manual/playwright-test-bridge-fix-manifest-v2.md` - Known issues with Manifest V2
- `docs/implementation-summaries/TEST-BRIDGE-EXTENSION-ISSUE-47.md` - Issue analysis
- `docs/implementation-summaries/TEST-BRIDGE-IMPLEMENTATION-COMPLETE.md` - Implementation summary

### What the Test Bridge Provides ✅

The bridge exposes 40+ methods across multiple categories:

**Quick Tab Operations:**
- `createQuickTab(url, options)`
- `getQuickTabs()`
- `minimizeQuickTab(id)`
- `restoreQuickTab(id)`
- `closeQuickTab(id)`
- `pinQuickTab(id)` / `unpinQuickTab(id)`

**Solo/Mute Management:**
- `toggleSolo(id, tabId)`
- `toggleMute(id, tabId)`
- `getVisibilityState(tabId)`

**Manager Panel Control:**
- `getManagerState()`
- `setManagerPosition(x, y)`
- `setManagerSize(width, height)`
- `closeAllMinimized()`

**Container Isolation (Multi-Container Support):**
- `getContainerInfo()`
- `createQuickTabInContainer(url, cookieStoreId)`
- `verifyContainerIsolation(id1, id2)`

**Debug & Geometry:**
- `getQuickTabGeometry(id)`
- `verifyZIndexOrder(ids)`
- `getSlotNumbering()`
- `setDebugMode(enabled)`

**Utilities:**
- `waitForQuickTabCount(expectedCount, timeoutMs)`
- `clearAllQuickTabs()`

---

## Part 3: Known Issues & Gaps

### Issue #1: Message Handlers May Not Be Fully Connected

**Problem:** Test Bridge methods send messages like `TEST_CREATE_QUICK_TAB`, but content script may not have handlers for all message types.

**Location:** `src/test-bridge-content-handler.js` (or content scripts)

**Symptom:** When Playwright calls `window.__COPILOT_TEST_BRIDGE__.createQuickTab()`, it sends:
```javascript
{
  type: 'TEST_CREATE_QUICK_TAB',
  data: { url, options }
}
```

But the content script might not have a handler for `TEST_CREATE_QUICK_TAB` message type.

**Impact:** High - Test Bridge methods will fail with "message handler not found" errors

---

### Issue #2: Injection Step May Not Run Properly

**Problem:** The `copilot-setup-steps.yml` workflow has a step "Inject test bridge" that should append `src/test-bridge.js` to `dist/background.js`, but there are potential issues:

1. **Timing:** The injection happens AFTER build, so the built extension may not include the bridge until after this step
2. **File permissions:** The script may fail silently if dist/background.js is immutable or doesn't exist
3. **TEST_MODE detection:** The bridge only loads if `TEST_MODE` environment variable is true, but workflow may not set it

**Location:** `.github/workflows/copilot-setup-steps.yml` (around line 220)

**Current Step:**
```yaml
- name: Inject test bridge for Copilot Autonomous Testing
  run: |
    cp src/test-bridge.js dist/test-bridge.js
    echo "" >> dist/background.js
    cat dist/test-bridge.js >> dist/background.js
```

**Problem:** This just concatenates files; doesn't verify success or handle errors.

**Impact:** High - Bridge gets appended but Playwright may not find it if step silently fails

---

### Issue #3: Browser API Security Restrictions

**Problem:** Test Bridge runs in background.js (extension context) and needs to call content scripts via `browser.tabs.sendMessage()`. This requires:

1. Content script must be injected in target page
2. Content script must receive `TEST_*` message types
3. Message handlers must properly respond with data

**Current approach:** Bridge assumes content script is always loaded and will respond

**Risk:** If content script isn't loaded in the page when Playwright runs, messages fail.

**Impact:** Medium - Tests may intermittently fail if content scripts aren't injected

---

### Issue #4: Manifest V2 Limitations

**Location:** Known issue documented in `playwright-test-bridge-fix-manifest-v2.md`

**Problem:** Manifest V2 (currently used) has limitations on:
- Dynamic script injection
- Content script initialization timing
- Message passing between contexts

**Solution documented:** The bridge needs to be injected at specific lifecycle points

**Impact:** Medium - Some bridge methods may timeout waiting for responses

---

## Part 4: How the Bridge Integrates with Copilot Agent

### When Copilot Runs the Tests

```
1. Copilot clones repository
2. Copilot runs copilot-setup-steps.yml workflow
   ├─ npm ci installs dependencies
   ├─ npm run build creates dist/
   ├─ Inject test bridge step appends src/test-bridge.js to dist/background.js
   └─ Extension is built with bridge injected
3. Copilot runs Playwright tests with:
   PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=false
   (ensures Firefox is available)
4. Playwright loads extension:
   ├─ Loads dist/background.js (which includes test bridge)
   ├─ window.__COPILOT_TEST_BRIDGE__ becomes available
   └─ Tests can call bridge methods
5. E2E tests call TestBridge methods to:
   ├─ Create Quick Tabs programmatically
   ├─ Verify state changes
   ├─ Check solo/mute isolation
   ├─ Validate manager persistence
   └─ Test container-specific behavior
6. Tests pass/fail based on bridge method responses
```

### Why Copilot Can't Create/Fix Test Bridge Itself

The Copilot Agent **CAN** autonomously fix Test Bridge infrastructure because:
- ✅ All bridge files already exist (no need to create from scratch)
- ✅ Message handler patterns are standard (copy/modify existing)
- ✅ Injection mechanism is well-documented (update YAML or script)
- ✅ Testing infrastructure is in place (just needs wiring)

---

## Part 5: What Needs to Be Fixed

### Priority 1: Verify Message Handlers Exist

**File:** `src/test-bridge-content-handler.js` or content script handlers

**Check:** Verify that for EVERY message type the bridge sends (`TEST_CREATE_QUICK_TAB`, `TEST_MINIMIZE_QUICK_TAB`, etc.), there is a corresponding handler in the content script.

**Pattern to find:**
```javascript
// Content script should have handlers like:
if (message.type === 'TEST_CREATE_QUICK_TAB') {
  // Handle creation
  sendResponse({ success: true, tab: createdTab });
}
```

**What's likely missing:** Some message types might not have handlers. For example:
- `TEST_GET_VISIBILITY_STATE` - Might be missing
- `TEST_GET_SLOT_NUMBERING` - Might be missing
- Container-related messages - Might be missing

---

### Priority 2: Verify Injection Step Works

**File:** `.github/workflows/copilot-setup-steps.yml`

**Check:** The injection step should:
1. ✅ Run AFTER `npm run build`
2. ✅ Copy `src/test-bridge.js` to `dist/test-bridge.js`
3. ✅ Append content to `dist/background.js`
4. ✅ Verify the append succeeded (check file size before/after)
5. ✅ Set `TEST_MODE=true` environment variable before build

**Current issues:**
- No error handling if dist/background.js doesn't exist
- No verification that append succeeded
- TEST_MODE may not be set

---

### Priority 3: Verify Content Script Context

**File:** Content script that handles TEST_* messages

**Check:** Ensure:
1. Content script is loaded in every page where tests run
2. Bridge message listener is registered
3. All TEST_* message types are handled
4. Responses are sent with proper data structure

**Pattern:**
```javascript
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type.startsWith('TEST_')) {
    // Handle test messages
    // IMPORTANT: Must sendResponse() even on success!
  }
});
```

---

### Priority 4: Add Missing Message Handlers

**Files to modify:** `src/test-bridge-content-handler.js` and any content script files

**Handlers that need verification:**

| Message Type | Purpose | Handler Status |
|---|---|---|
| `TEST_CREATE_QUICK_TAB` | Create Quick Tab | ⚠️ Verify exists |
| `TEST_MINIMIZE_QUICK_TAB` | Minimize a Quick Tab | ⚠️ Verify exists |
| `TEST_RESTORE_QUICK_TAB` | Restore minimized tab | ⚠️ Verify exists |
| `TEST_TOGGLE_SOLO` | Solo mode on current tab | ⚠️ Verify exists |
| `TEST_TOGGLE_MUTE` | Mute on current tab | ⚠️ Verify exists |
| `TEST_GET_VISIBILITY_STATE` | Get solo/mute state | ⚠️ Verify exists |
| `TEST_GET_MANAGER_STATE` | Get manager panel state | ⚠️ Verify exists |
| `TEST_SET_MANAGER_POSITION` | Set manager position | ⚠️ Verify exists |
| `TEST_SET_MANAGER_SIZE` | Set manager size | ⚠️ Verify exists |
| `TEST_GET_CONTAINER_INFO` | Get container grouping | ⚠️ Verify exists |
| `TEST_VERIFY_CONTAINER_ISOLATION` | Verify containers isolated | ⚠️ Verify exists |

---

## Part 6: Implementation Requirements for Copilot

### What Copilot Needs to Do

1. **Audit Message Handlers:** Find all `TEST_*` message handlers in content scripts and document what exists vs. what's missing
2. **Add Missing Handlers:** Implement missing message type handlers based on bridge API methods
3. **Wire Up Bridge Calls:** Ensure each bridge method successfully sends message and gets response
4. **Verify Injection:** Make sure `copilot-setup-steps.yml` properly injects bridge and sets TEST_MODE
5. **Test Bridge Functionality:** Run E2E tests to verify bridge methods work end-to-end

### Files to Modify

<scope>
**Must modify to fix Test Bridge:**
- `src/test-bridge-content-handler.js` (add missing handlers)
- Any content script files that handle TEST_* messages
- `.github/workflows/copilot-setup-steps.yml` (verify/fix injection step)
- `scripts/inject-test-bridge.cjs` (if injection logic is broken)

**Should NOT modify:**
- `src/test-bridge.js` (already correct, just bridge API)
- Test files (only modify if bridge implementation changes)
- Manifest files (out of scope unless security issue)
</scope>

---

## Part 7: How to Verify Bridge Is Working

### Test 1: Check Bridge Is Accessible

```javascript
// In browser console after loading extension:
window.__COPILOT_TEST_BRIDGE__  // Should not be undefined
typeof window.__COPILOT_TEST_BRIDGE__.createQuickTab  // Should be 'function'
```

### Test 2: Check Message Handler Routing

Run a simple test:
```javascript
// This should NOT throw "message handler not found" error
await window.__COPILOT_TEST_BRIDGE__.getQuickTabs();
```

If throws error like:
```
Error: Could not establish connection. Receiving end does not exist.
```
→ Content script isn't loaded or doesn't have handler for `TEST_*` messages

### Test 3: Check Injection in Production Build

```bash
# After build, check if bridge is in dist/background.js:
grep -i "test.bridge\|__COPILOT_TEST_BRIDGE__" dist/background.js
```

Should find the bridge code injected.

---

<acceptance_criteria>
- [ ] All 40+ bridge API methods have corresponding message handlers in content scripts
- [ ] Each message handler properly sends response (uses `sendResponse()`)
- [ ] `copilot-setup-steps.yml` injection step verifies bridge injection succeeded
- [ ] Bridge is accessible via `window.__COPILOT_TEST_BRIDGE__` in loaded extension
- [ ] All E2E tests can successfully call at least 3 bridge methods without errors
- [ ] Bridge methods timeout gracefully if message handlers missing (instead of hanging)
- [ ] TEST_MODE environment variable is set during workflow for proper bridge activation
- [ ] Documentation updated if any changes made to bridge API or message protocol
</acceptance_criteria>

---

## Supporting Context

<details>
<summary>Test Bridge File Structure</summary>

```
src/
├── test-bridge.js
│   └── Defines window.__COPILOT_TEST_BRIDGE__ with 40+ methods
├── test-bridge-page-proxy.js
│   └── Handles message passing from page context to extension context
├── test-bridge-content-handler.js
│   └── Message handlers for TEST_* message types (may be incomplete)

scripts/
├── inject-test-bridge.cjs
│   └── Appends test-bridge.js to dist/background.js during build
├── verify-test-bridge.cjs
│   └── Verifies bridge was properly injected

tests/extension/
├── test-bridge-check.spec.js
│   └── Checks bridge is accessible
├── test-bridge-verify.spec.js
│   └── Verifies bridge functionality end-to-end

.github/workflows/
└── copilot-setup-steps.yml
    └── Has "Inject test bridge" step (verify it runs correctly)
```
</details>

<details>
<summary>Message Flow Diagram</summary>

```
Playwright Test
    ↓
window.__COPILOT_TEST_BRIDGE__.createQuickTab(url)
    ↓
Sends message: { type: 'TEST_CREATE_QUICK_TAB', data: { url, options } }
    ↓
browser.tabs.sendMessage() → Content Script
    ↓
Content script receives message
    ↓
    IF message.type === 'TEST_CREATE_QUICK_TAB' THEN
        ├─ Call extension handler
        ├─ Create the Quick Tab
        └─ sendResponse({ success: true, tab: createdTab })
    ELSE
        └─ sendResponse({ error: 'Unknown message type' })
    ↓
Test bridge receives response
    ↓
Returns result to Playwright test
    ↓
Test continues with verification
```
</details>

---

## Conclusion

The Test Bridge **infrastructure is in place** but requires wiring the missing message handlers and verifying the injection mechanism. The Copilot Agent can autonomously:
- ✅ Add missing message type handlers
- ✅ Wire bridge calls to handlers
- ✅ Fix workflow injection steps
- ✅ Verify end-to-end functionality

**No external dependencies needed** - everything required already exists in the repository.

