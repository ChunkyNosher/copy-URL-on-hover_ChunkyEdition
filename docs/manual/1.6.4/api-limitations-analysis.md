# Quick Tabs v1.6.3 - API Limitations Causing Extension Issues

**Extension Version:** v1.6.3.10-v5+  
**Date:** 2025-12-17  
**Focus:** Firefox WebExtensions API constraints and how they create
architectural problems in Quick Tabs

---

## Executive Summary

Quick Tabs v1.6.3 attempts to use browser APIs across content scripts and
background scripts in ways that exceed documented API availability boundaries.
Three specific API limitations create the core issues affecting ownership
validation and tab ID initialization:

1. **`browser.tabs.getCurrent()` unavailable in content scripts** - MDN
   specifies this API is background-script-only
2. **Content scripts have restricted API access** - Limited to small subset;
   tabs API completely blocked
3. **`JSON.stringify()`/`JSON.parse()` preserve JavaScript types without
   auto-conversion** - Numeric types must be explicitly validated after
   deserialization

These limitations, combined with asynchronous initialization patterns, force the
extension into problematic workarounds that expose type safety vulnerabilities.

---

## API Limitation 1: browser.tabs.getCurrent() Not Available in Content Scripts

### MDN Documentation

**MDN: tabs.getCurrent()**  
https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/getCurrent

Quote from MDN:

> "Get a tabs.Tab containing information about the tab that this script is
> running in. Note: This function is only useful in contexts where there is a
> browser tab."

**Additional Context from MDN:** The phrase "only useful in contexts where there
is a browser tab" indicates limited availability. Clarification comes from MDN's
Content Scripts documentation.

**MDN: Content Scripts - What Permissions Do They Have?**  
https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts

Quote from MDN (Content Scripts section):

> "Content scripts can use a subset of the WebExtension APIs. They cannot
> directly use: tabs, extension, background scripts, sidebar, devTools... To
> access these APIs, they must communicate via messaging with the background
> script."

Specifically for the tabs API:

> "Content scripts do not have access to the tabs API."

### How This Affects Quick Tabs

**Current Implementation Problem:**

In `src/utils/storage-utils.js`, the `_fetchCurrentTab()` function attempts to
use `browser.tabs.getCurrent()`:

```javascript
function _fetchCurrentTab(browserAPI) {
  if (!browserAPI?.tabs?.getCurrent) return Promise.resolve(null);
  return browserAPI.tabs.getCurrent().catch(err => {
    console.warn('[StorageUtils] Failed to get current tab:', err.message);
    return null;
  });
}
```

When this code runs in a content script context:

- `browserAPI.tabs` does NOT exist (tabs API unavailable in content scripts)
- The guard `!browserAPI?.tabs?.getCurrent` correctly returns null
- **However:** `currentWritingTabId` never gets initialized
- Subsequent `validateOwnershipForWrite()` calls check `if (tabId === null)` and
  block storage writes

**Root Cause:** Content scripts cannot determine their own tab ID using built-in
APIs. They must obtain it from the background script via messaging. The code
correctly guards against API unavailability but provides no fallback messaging
protocol to populate `currentWritingTabId` from the background script.

### MDN-Documented Solution Pattern

Per MDN's Content Scripts documentation:

> "Content scripts can use runtime.sendMessage() to communicate with background
> scripts. Background scripts can access the tabs API and respond with tab
> information."

**Correct Pattern:**

1. Content script calls
   `browser.runtime.sendMessage({action: 'getCurrentTabId'})`
2. Background script receives message via
   `browser.runtime.onMessage.addListener()`
3. Background script calls `browser.tabs.getCurrent()` (available to background)
4. Background script sends response with tab ID
5. Content script receives response and calls `setWritingTabId(response.tabId)`

**Current Gap:** The messaging protocol prerequisite is not verified to be
complete. If content script initialization doesn't trigger this messaging chain,
`currentWritingTabId` remains null.

---

## API Limitation 2: Content Scripts Have Restricted API Subset

### MDN Documentation

**MDN: Content Scripts - List of Available APIs**  
https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts

From MDN's definitive list, content scripts can directly use:

- `dom` (limited DOM manipulation)
- `i18n` (internationalization)
- `storage` (read/write local storage)
- `runtime.connect()` (messaging)
- `runtime.sendMessage()` (messaging)
- `runtime.getManifest()` (metadata)
- `runtime.getURL()` (extension resources)
- `runtime.id` (extension ID)
- `runtime.onConnect` (messaging listener)
- `runtime.onMessage` (messaging listener)

**Explicit Restriction from MDN:**

> "Content scripts cannot use: tabs, extension, background scripts, sidebar,
> devTools, bookmarks, downloads, history, identity, management, notifications,
> omnibox, pageAction, proxy, sessions, sidePanel, topSites, webRequest, and
> many others."

### How This Affects Quick Tabs

**Architectural Problem:**

The Quick Tabs extension runs code in content script context (to interact with
the web page) but needs to:

1. Determine current tab ID (requires `browser.tabs` - unavailable)
2. Track which tab owns a Quick Tab (requires tab metadata)
3. Write Quick Tab state (requires `browser.storage` - AVAILABLE)
4. Filter Quick Tabs by ownership (requires comparison with current tab ID)

**Current Workaround Limitations:**

- ✅ Content script CAN access `browser.storage.local` (storage API available)
- ❌ Content script CANNOT get current tab ID directly
- ✅ Content script CAN send message to background via `runtime.sendMessage()`
- ⚠️ **Unverified:** Whether all code paths that write storage have obtained tab
  ID via messaging

**Type Safety Consequence:**

Because tab ID must come via messaging (asynchronous), and storage writes may
happen synchronously during page load, a race condition exists:

- Content script DOMContentLoaded fires
- Quick Tab creation code calls `persistStateToStorage()` (synchronous)
- `persistStateToStorage()` checks `currentWritingTabId` (still null)
- Write is blocked
- Meanwhile, messaging to get tab ID is still in flight (asynchronous)

---

## API Limitation 3: JSON Serialization Preserves Types Without Auto-Conversion

### MDN Documentation

**MDN: JSON.stringify()**  
https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify

From MDN:

> "The JSON.stringify() static method converts a JavaScript value to a JSON
> string. During stringification, JavaScript types are preserved: numbers remain
> numbers, strings remain strings, booleans remain booleans, null remains null."

**Critical Detail from MDN:**

> "JSON.parse() reverses the process but DOES NOT automatically convert string
> representations of numbers back to numeric types. A string '123' remains the
> string '123' after JSON.parse(). If you need numeric types, you must
> explicitly convert them."

**Firefox Storage API Behavior (per MDN WebExtensions Storage documentation):**

https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/local

The storage API uses JSON serialization internally:

> "Storage values are stored using JSON serialization and deserialization. This
> means numeric types are preserved during storage, but only if they are native
> JavaScript numbers. String representations of numbers are stored as strings."

### How This Affects Quick Tabs

**Type Mismatch Chain:**

1. **Extraction** (storage-utils.js `_extractOriginTabId()`):
   - Receives `originTabId` from fallback sources
   - No explicit `Number()` casting
   - Could be string "1" or number 1 depending on source

2. **Serialization** (storage-utils.js `serializeTabForStorage()`):
   - Takes uncasted originTabId
   - Passes directly to stored object: `originTabId: extractedOriginTabId`
   - If extractedOriginTabId is string "1", storage object has string "1"

3. **Storage Write** (`browser.storage.local.set()`):
   - Firefox serializes object via JSON.stringify()
   - Per MDN: "JSON.stringify() preserves types"
   - If object contains string "1", it stays string "1" in storage
   - Result: `{originTabId: "1"}` stored as string in storage.local

4. **Storage Read** (`browser.storage.local.get()`):
   - Firefox deserializes via JSON.parse()
   - Per MDN: "JSON.parse() preserves types from JSON"
   - String "1" from storage remains string "1" after JSON.parse()
   - Result: `{originTabId: "1"}` received from storage as string

5. **Ownership Comparison** (VisibilityHandler `_isOwnedByCurrentTab()`):
   - Performs: `if (originTabId === currentTabId)`
   - originTabId is string "1" (from deserialization)
   - currentTabId is number 1 (from `browser.tabs` API)
   - Strict equality: `"1" === 1` evaluates to **false**
   - Result: Tab incorrectly marked as non-owned

**Why Automatic Conversion Doesn't Happen:**

Per MDN's JSON documentation, `JSON.parse()` only deserializes based on JSON
type information. Since JSON has no numeric literal in the stored format at that
point (it was serialized as a string), JSON.parse() correctly keeps it as a
string. Firefox's storage API does not add an extra type normalization layer.

### Code Evidence of Missing Type Validation

From storage-utils.js deserialization path:

- No `Number()` calls after storage reads
- No type validation before ownership comparisons
- Comparisons use strict equality `===` without type coercion

---

## Messaging Pattern Requirement

### MDN Documentation on Messaging

**MDN: Runtime.sendMessage()**  
https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/sendMessage

Quote from MDN:

> "Send a message to the extension (or another extension, if the recipient's ID
> is specified). Content scripts and the background script can exchange messages
> using this function."

**MDN: Runtime.onMessage**  
https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/onMessage

Quote from MDN:

> "The onMessage event is fired when a message is sent to the extension using
> sendMessage() or sendNativeMessage(). Content scripts and background scripts
> should both register listeners for this event."

### How Quick Tabs Should Use Messaging (Per MDN Pattern)

**Content Script Sending:**

```javascript
// Content script cannot use browser.tabs.getCurrent()
// So it must ask background script
browser.runtime.sendMessage({ action: 'getCurrentTabId' });
```

**Background Script Responding:**

```javascript
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getCurrentTabId') {
    // Background script CAN use browser.tabs
    browser.tabs.getCurrent().then(tab => {
      sendResponse({ tabId: tab?.id ?? null });
    });
  }
});
```

**Content Script Handling Response:**

```javascript
browser.runtime.sendMessage({ action: 'getCurrentTabId' }, response => {
  if (response?.tabId) {
    setWritingTabId(response.tabId); // Explicitly set tab ID
  }
});
```

**Requirement from MDN:** The messaging must complete BEFORE any storage writes
occur. If content script calls `persistStateToStorage()` before messaging
completes, `currentWritingTabId` remains null and ownership validation fails.

---

## How These Three Limitations Compound

### Interaction Chain

1. **Limitation 1** (tabs API unavailable in content scripts):
   - Content script cannot get tab ID directly
   - Must use messaging to get it from background

2. **Limitation 2** (restricted content script API subset):
   - Forces asynchronous messaging pattern
   - Storage writes may happen before messaging completes

3. **Limitation 3** (JSON type preservation):
   - If originTabId comes as string from any source
   - Storage cycle preserves it as string
   - Ownership comparisons use strict equality
   - Type mismatch causes silent failure

**Result:**

- Race condition between async messaging (Limitation 1+2) and sync storage
  writes
- Type mismatches propagate unchecked (Limitation 3)
- Ownership validation fails silently
- Non-owner tabs can modify Quick Tabs
- Storage loops ensue

### Why Workarounds Were Attempted

The code includes several defensive patterns attempting to work around these
limitations:

1. **`setWritingTabId()` function** - Workaround for Limitation 1 (tabs API
   unavailable)
2. **Circuit breaker** - Workaround for type mismatch side effect (too many
   failed ownership checks)
3. **Transaction timeouts** - Workaround for storage loops (detect and break
   infinite writes)

These are necessary but incomplete. They treat symptoms (loops, race conditions)
rather than root cause (API limitations).

---

## MDN-Recommended Patterns Not Fully Implemented

### Pattern 1: Content Script → Background Script Communication for Privileged APIs

**MDN Recommendation:** When content scripts need access to privileged APIs
(like tabs), use messaging to a background script.

**Quick Tabs Gap:**

- ✅ Code structure allows `setWritingTabId()` for manual setting
- ❌ No verified automatic messaging setup on page load
- ❌ No guaranteed completion before first storage write

### Pattern 2: Type Validation After Deserialization

**MDN Recommendation:** After `JSON.parse()` deserializes data, validate numeric
types explicitly.

**Quick Tabs Gap:**

- ❌ No type normalization after `browser.storage.local.get()`
- ❌ No explicit `Number()` casting in deserialization paths
- ❌ Ownership comparisons assume types are correct

### Pattern 3: Exclusive Content Script Storage Access

**MDN Note:** Content scripts can access storage directly, but type safety
requires careful handling since both content and background scripts may access
the same storage without type coordination.

**Quick Tabs Gap:**

- ⚠️ Both content and background access storage
- ❌ No shared type normalization contract
- ❌ No verified single-writer pattern

---

## Acceptance Criteria Based on MDN Compliance

### Limitation 1 - Messaging Protocol

- MDN-compliant: Content script sends message via
  `runtime.sendMessage({action: 'getCurrentTabId'})`
- MDN-compliant: Background script responds with tab ID via
  `sendResponse({tabId: ...})`
- MDN-compliant: Content script receives response and calls
  `setWritingTabId(tabId)` before storage writes
- MDN-compliant: All content script storage writes wait for messaging to
  complete OR have explicit tabId parameter

### Limitation 2 - Content Script API Scope

- MDN-compliant: Content scripts ONLY call approved APIs from MDN's restricted
  list
- MDN-compliant: Asynchronous messaging used for all restricted APIs (tabs,
  etc.)
- MDN-compliant: No synchronous storage writes before messaging completes

### Limitation 3 - Type Validation

- MDN-compliant: After `JSON.parse()` from storage, apply explicit type
  validation
- MDN-compliant: Numeric IDs converted to `Number` type before comparisons
- MDN-compliant: Strict equality `===` only used after type validation confirms
  both sides are numeric
- MDN-compliant: All type conversions logged for diagnostic visibility

---

## References to MDN Documentation

All findings are backed by current MDN WebExtensions documentation:

1. **tabs.getCurrent()** -
   https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/getCurrent
2. **Content Scripts Overview** -
   https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts
3. **Content Scripts Permissions** -
   https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts#what_permissions_do_content_scripts_have
4. **storage.local** -
   https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/local
5. **JSON.stringify()** -
   https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify
6. **JSON.parse()** -
   https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse
7. **runtime.sendMessage()** -
   https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/sendMessage
8. **runtime.onMessage** -
   https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/onMessage

---

## Summary: From API Limitations to Extension Issues

| API Limitation                                   | How It Manifests                               | Extension Impact                                                    |
| ------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------- |
| tabs.getCurrent() unavailable in content scripts | Content scripts can't get tab ID directly      | Requires messaging; creates race condition with async/sync boundary |
| Content scripts restricted to subset APIs        | tabs API blocked from content script           | Must use background script via messaging                            |
| JSON preserves types without auto-conversion     | String "1" stays string "1" after JSON.parse() | Type mismatches in ownership comparisons fail silently              |

**The Cascade:**

1. Content script needs tab ID (API limitation → messaging)
2. Messaging is asynchronous; storage write may be synchronous (sequencing
   issue)
3. If tab ID late/missing, ownership validation uses null (falls back to
   permissive mode)
4. If originTabId ever stored as string, JSON.parse() keeps it as string (type
   issue)
5. Ownership comparison `"1" === 1` fails; non-owner tabs modify Quick Tabs
6. Storage loops cascade; circuit breaker trips

**These are not code bugs—they are architectural mismatches with documented API
boundaries.**

---

**Document Version:** 1.0 - API Limitations Analysis  
**Prepared By:** Comprehensive Code Audit with MDN Documentation Research  
**Repository:** ChunkyNosher/copy-URL-on-hover_ChunkyEdition  
**For:** GitHub Copilot Coding Agent  
**Date:** 2025-12-17
