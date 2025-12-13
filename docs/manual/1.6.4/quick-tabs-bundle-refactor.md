# Quick Tabs Bundle Size & Code Splitting Refactor – Updated Plan (Firefox WebExtension)

**Extension:** Quick Tabs / copy-URL-on-hover_ChunkyEdition  
**Branch Analyzed:** `copilot/fix-logging-and-architectural-issues` (commit
`582c7653...`)  
**Date:** 2025-12-11  
**Focus:** Large files that are actually packaged into the extension, and
whether/how to split them while staying within Firefox WebExtension (MV2/MV3)
constraints.

---

## 1. Scope & Goals

### 1.1. What this document covers

- Identifies **largest shipped files** in the extension bundle (as of
  `copilot/fix-logging-and-architectural-issues`).
- Focuses on files that are **actually packaged into the XPI** (not dev
  tooling).
- Evaluates **whether it’s beneficial and safe** to split them into smaller
  modules/chunks.
- Incorporates **current WebExtension + Firefox best practices** for bundling,
  module usage, and file-size limits.
- Produces a **refined refactor plan** for bundle-size and maintainability
  improvements without changing user-facing behavior.

### 1.2. Explicitly out of scope

- No explicit code changes, no step‑by‑step refactor instructions, and no large
  code snippets.  
  This doc is meant for GitHub Copilot Coding Agent and human reviewers to use
  as **context and constraints**, not as a patch.
- No changes to **feature behavior** or extension UX; this is strictly about
  **structure, size, and loading strategy**.
- No changes to **build tooling choice** (still Rollup-based), only how it is
  used/configured.

---

## 2. Current Large Files & Packaging Surface

### 2.1. Top‑level repository files (sizes from GitHub API)

At the repo root on `copilot/fix-logging-and-architectural-issues`:

- `background.js` – **~332 KB**
- `popup.html` – **~51 KB**
- `popup.js` – **~42 KB**
- `options_page.html` – ~6 KB
- `options_page.js` – ~8.5 KB
- `state-manager.js` – ~11 KB
- `package-lock.json` – ~482 KB (not shipped in extension)

In addition, there is a `sidebar/` directory that includes:

- `sidebar/quick-tabs-manager.js` – previously confirmed to be **~300+ KB** in
  earlier analysis (this file is not listed in the root API response but exists
  in the repo and is part of the shipped sidebar UI).

### 2.2. Files that are packaged into the extension

Based on `manifest.json` and standard WebExtension practices, the following are
**directly or indirectly packaged** and loaded by Firefox:

- **Background / main logic**
  - `background.js` (background script)
  - `state-manager.js` (shared logic loaded by background / sidebar / popup)

- **Sidebar (Quick Tabs Manager)**
  - `sidebar/quick-tabs-manager.js`
  - Sidebar HTML shell (likely in `sidebar/` as HTML or via
    `manifest.json sidebar_action`)

- **Popup and options UI**
  - `popup.html`, `popup.js`
  - `options_page.html`, `options_page.js`

- **Manifest and metadata**
  - `manifest.json`
  - `icons/` assets
  - `updates.json` (for self-update metadata)

- **NOT shipped** but present:
  - `package-lock.json`, `tests/`, `docs/`, `.github/`, etc. (excluded by build
    pipeline or `web-ext build` ignore rules).

### 2.3. Which files are “too big” in practice

1. `background.js` (~332 KB)
2. `sidebar/quick-tabs-manager.js` (~300+ KB)
3. `popup.html` (~51 KB) and `popup.js` (~42 KB) – not enormous, but relatively
   heavy for a popup.

Compared with Firefox ecosystem constraints:

- A Mozilla community thread on extension bundling notes:
  > "There is a limitation on the size of each JS file to not exceed **4 MB**,
  > and our background script is now 4.4MB."  
  > (Discourse thread: _"Firefox web extension background script – to bundle or
  > not to bundle?"_[source:1])

Your current files are **far below 4 MB**, so you are not in immediate danger of
rejection based on per-file size limit.  
However, 300–350KB JS files are **large enough** that:

- They are harder to maintain and reason about.
- They create **longer parse/compile time** at startup.
- They reduce the ability to **load only what is needed** in a given context
  (sidebar vs popup vs background).

So the rationale for splitting is **maintainability and performance**, not
compliance with a hard limit.

---

## 3. Firefox & WebExtension Best Practices Relevant to Code Splitting

### 3.1. General bundling / code splitting guidance (modern JS)

Recent bundling best-practices emphasize **code splitting and lazy loading**:

- A 2025 guide on code splitting notes:

  > "Best Practices for Code Splitting in 2025: ✓ Lazy load non-critical
  > components, ✓ Split routes at page level, ✓ Group rarely used admin/tools
  > into separate chunks"[source:2].

- Another article on bundling states:
  > "Code Splitting: This involves dividing a bundle into smaller chunks that
  > can be loaded on demand. This is particularly useful for large
  > applications."[source:3].

MDN’s JavaScript modules docs reinforce that bundlers are still useful for
partitioning code into **reasonably sized chunks**:

- MDN:
  > "Bundlers still do a good job at partitioning code into reasonably sized
  > chunks"[source:4].

### 3.2. Firefox-specific module and dynamic import constraints

Dynamic imports and ES modules in WebExtensions have **historically been
tricky** in Firefox:

- Bugzilla 1536094 (dynamic import in WebExtension content scripts) notes that
  **content scripts historically could not use ES module syntax directly** and
  had to resort to dynamic imports with moz-extension URLs[source:5].

- Bugzilla 1803950 shows that in MV3:
  > "Dynamic import is only possible when a script is declared in
  > `web_accessible_resources`" and that failing to do so leads to errors like:
  > `Module source URI is not allowed in this document` and
  > `TypeError: error loading dynamically imported module`[source:6].

Key implications for your extension:

- **Static imports** (`import` at top level) are safe in **module-based
  background/option/popup scripts**, but the extension must mark them as
  **module scripts** in the manifest.
- **Dynamic imports** (`import()` at runtime):
  - Are subject to **extra constraints** in Firefox, especially from content or
    sandboxed contexts.
  - Can require `web_accessible_resources` entries for the imported modules.
  - Still have edge cases in MV3 and require extra care.

Given the complexity and current bug history, this refactor should **prefer
static ES module splitting plus bundler-based chunks** rather than relying
heavily on runtime `import()` from constrained contexts.

### 3.3. Packaging & file-size guidance from Firefox docs

Mozilla’s Extension Workshop states:

- > "The maximum file size accepted is **200 MB**. If your add-on is larger than
  > 200 MB, it will fail validation."[source:7].

This is for the whole XPI. Your extension is **far below this**, so the concern
is not absolute size but **startup performance and code clarity**.

Extension Workshop also recommends using `web-ext build` which:

- > "automatically excludes files that are commonly unwanted in
  > packages"[source:8].

Your current project already has build tooling (`rollup.config.js`) which can be
leveraged to **produce multiple entrypoints and smaller scripts** while still
packaging a single cohesive extension.

### 3.4. Performance optimization guidelines for Firefox extensions

A 2025 WebExtension guide lists the following relevant points:

- > "Keep content scripts minimal"
- > "Use event-driven background scripts"
- > "Lazy-load libraries"
- > "Optimize storage queries"[source:9].

These align well with the idea of:

- **Not** putting all logic into a single monolithic background/manager file.
- Splitting out **rarely used or heavy logic** into separate modules loaded only
  when necessary.

---

## 4. Largest Files – Role & Risks

### 4.1. `background.js` (~332 KB)

**Role:**

- Central background logic, including:
  - Tab tracking, event listeners, and routing.
  - Messaging hub for popup/sidebar/quick-tabs Manager.
  - Diagnostics, logging, and state coordination.

**Risks of current size:**

- Hard to reason about global side effects and lifecycle.
- Every background restart must re-parse and re-execute a large, dense script.
- Difficult to enforce separation of concerns (e.g., logging vs routing vs Quick
  Tabs state machines).

### 4.2. `sidebar/quick-tabs-manager.js` (~300+ KB)

**Role:**

- Manages **Quick Tabs sidebar UI**, including:
  - Initialization, hydration, barrier logic.
  - Port communication to background, storage + fallback logic.
  - Tab list rendering, event handlers, dedup maps.
  - Logging, diagnostics, and health probes.

**Risks of current size:**

- High cognitive load: UI, state sync, diagnostics, and architecture concerns
  are interleaved.
- Hard to reason about initialization ordering (as previous diagnostics already
  demonstrated).
- Increases possibility of subtle side effects and race conditions.

### 4.3. `popup.html` (~51 KB) and `popup.js` (~42 KB)

**Role:**

- Popup UI for quick copy-on-hover features.
- Some Quick Tabs interactions and configuration.

**Risks of current size:**

- Popups are expected to be light and near-instant; 40–50KB is not huge, but
  further splitting can improve startup if there is heavy logic used only in
  advanced views.
- Potential for shared logic duplication between popup and sidebar/background.

---

## 5. Should These Large Files Be Split?

### 5.1. High-level guidance

Given the current sizes and roles, the answer is **yes for maintainability and
clarity**, but **no need for extreme micro-chunking**.

From general code-splitting guidance:

- > "Splitting the code into too many small chunks can lead to an excessive
  > number of network requests, potentially causing more harm than
  > good."[source:10].

For WebExtensions specifically:

- We don’t pay traditional network latency (everything is in the XPI), but
  **script loading and module graph complexity** still impose overhead.
- It is better to split into **a few logically coherent modules** (e.g.,
  background-core, background-logging, background-quick-tabs) than to split into
  dozens of micro-files.

### 5.2. Recommended splitting targets (summary)

1. **`sidebar/quick-tabs-manager.js`**
   - Split by responsibility: **UI rendering**, **state sync/barriers**,
     **logging & diagnostics**, **health metrics**.
2. **`background.js`**
   - Split by domain: **tab state + routing**, **copy-on-hover core**, **Quick
     Tabs sync helper**, **logging + error handling**.
3. **`popup.js` / `popup.html`**
   - Only split out **heavy, rarely used functionality** (e.g. advanced
     diagnostics toggles or detailed views) if they exist.

In all cases:

- Favor **ES modules** with static imports and let Rollup handle bundling.
- Use **one or few entrypoints per context** (background, sidebar, popup), not a
  large number of dynamic runtime imports.

---

## 6. Firefox‑Safe Code Splitting Strategy

### 6.1. Avoid heavy reliance on dynamic `import()` from constrained contexts

Bugzilla 1803950 shows that dynamic imports in MV3 require
**web_accessible_resources** and can fail in certain contexts, producing errors
like:

> `Module source URI is not allowed in this document` and
> `TypeError: error loading dynamically imported module`[source:6].

Given this:

- **Do not design a refactor that depends on dynamic `import()` from the sidebar
  or content scripts**.
- Instead:
  - Use **Rollup** to build a **small number of static-bundled entrypoints**.
  - If dynamic import is necessary, only do it from **background or popup** and
    ensure:
    - The imported modules are declared in `web_accessible_resources` in
      `manifest.json` where required.
    - The paths are `moz-extension://` safe and recognized by Firefox.

### 6.2. Use ES modules + Rollup entrypoints

MDN notes that bundlers remain useful for **partitioning code into reasonably
sized chunks**[source:4]. For this repo, Rollup is already present
(`rollup.config.js`). The safest pattern is:

- Keep **one main entry per context**:
  - `src/background/index.js` → builds `background.js` (but now assembled from
    smaller modules).
  - `src/sidebar/index.js` → builds `sidebar/quick-tabs-manager.js` from
    modules.
  - `src/popup/index.js` → builds `popup.js`.

- Internally split into **cohesive modules**:
  - e.g., `src/sidebar/state-barrier.js`, `src/sidebar/logging.js`,
    `src/sidebar/dom-renderer.js` etc.

Rollup can then produce **one output file per context** for Firefox, but the
codebase becomes modular and easier to maintain.

> This way, you gain the maintainability benefits of splitting without having to
> ship numerous separate JS files or rely on dynamic imports, which continue to
> have edge cases in Firefox.

### 6.3. Respect per-file and per-context constraints

- **Per-file size:** 4MB is a rough practical limit for single JS files
  encountered in community discussions[source:1]. You are far below this but
  should **avoid regressing toward megabyte-scale single files**.
- **Context separation:**
  - Background, sidebar, popup, and content scripts all run in different
    contexts and have **different module loader behavior**.
  - Don’t share module graphs across these contexts via tricky dynamic imports;
    instead, share logic in pure modules bundled separately for each context
    where needed.

---

## 7. Concrete Refactor Targets (High-Level, No Code)

> **Important:** The following are **structural recommendations** and naming
> ideas. Copilot Coding Agent should decide actual file names, import graphs,
> and implementation details, but must respect these boundaries.

### 7.1. `sidebar/quick-tabs-manager.js` refactor surface

**Current issues:**

- Contains UI rendering, state sync, port messaging, storage listeners,
  initialization barriers, diagnostics, health probes, dedup logic, and logging
  in one file.
- Difficult to reason about asynchronous ordering and interactions.

**Recommended module boundaries:**

1. **Sidebar Entry / Bootstrap**
   - Responsible only for **bootstrapping** the sidebar:
     - Wiring DOMContentLoaded.
     - Constructing a `SidebarApp` or similar orchestrator.
     - Attaching the root to DOM.

2. **Initialization & Barrier Coordinator**
   - Focused on:
     - Tracking **storage listener readiness**.
     - Tracking **port readiness**.
     - Ensuring **first render only after all barriers** satisfied.
   - This is where existing `initializationStarted`, `initializationComplete`,
     `storageListenerVerified`, etc. should conceptually live.

3. **Message & State Sync Layer**
   - Encapsulates:
     - `browser.runtime.connect` and port message handling.
     - Storage read/write, `storage.onChanged` handling.
     - Deduplication of messages and state.
   - Exposes a **clear event API** to the UI layer (e.g., `onStateChange`,
     `onError`).

4. **UI Rendering / Virtual View**
   - Contains all DOM manipulation, template building, and rendering logic.
   - Treats state as an input, not as something it mutates directly.

5. **Diagnostics & Logging**
   - A dedicated module for:
     - Log formatting.
     - Correlation IDs.
     - Structured logging for barriers, message paths, and errors.
   - Makes it trivial to disable or sample logs in the future.

6. **Health & Metrics**
   - Combines existing health probes (storage, port, dedup map size) into a
     cohesive module.
   - Ensures they do not cross-cut rendering logic.

Splitting along these lines would drastically improve reasoning about the Quick
Tabs Manager without changing the external behavior.

### 7.2. `background.js` refactor surface

**Current issues:**

- Single large file with mixed concerns:
  - Copy-on-hover core logic.
  - Quick Tabs state / messaging.
  - Logging and diagnostics.
  - Global event listeners and routing.

**Recommended module boundaries:**

1. **Background Entry / Bootstrap**
   - Wires `browser.runtime.onInstalled`, `onMessage`, `onConnect`, etc.
   - Delegates to more specialized modules.

2. **Tab & Session State**
   - Handles **tab tracking** (open/close/move), session metadata, bookmarking.
   - Provides stable interfaces to sidebar and popup.

3. **Quick Tabs Sync Helper**
   - Coordinates state with `state-manager.js` and the sidebar modules.
   - Owns the authoritative Quick Tabs state model and update broadcast logic.

4. **Copy-on-Hover Core**
   - Feature-specific logic around URL detection, copying, and overlay
     interactions.

5. **Logging & Diagnostics**
   - Shared with or parallel to the sidebar logging model, but tailored to
     background context.

### 7.3. `popup.js` / `popup.html`

**Current issues:**

- Popup is moderately large for a small UI.
- Some logic is likely shared or duplicative relative to sidebar/ background.

**Recommended module boundaries:**

1. **Popup Entry** – minimal code that wires DOM events and loads the rest.
2. **Popup View Logic** – UI-specific rendering of lists, buttons, toggles.
3. **Shared Logic Extraction** – any logic that is conceptually shared with
   sidebar/background should live in a shared module under `src/common/` or
   `src/shared/`, and be bundled into each context as needed.

---

## 8. Manifest & Build Integration Considerations

### 8.1. Maintain simple, stable outputs

Even though we’re splitting the source into multiple modules, for Firefox
stability:

- Keep **output file names** consistent with current `manifest.json` where
  possible:
  - `background.js` still referenced as the background script.
  - `sidebar/quick-tabs-manager.js` still referenced in the sidebar section.
  - `popup.js` still referenced in `browser_action` / `action` popup.

Rollup should be configured so that:

- Each context has **one built output file** with its dependencies bundled in.
- Code splitting can still result in multiple chunks internally, but this should
  be done **carefully**, observing dynamic import constraints as discussed.

### 8.2. Dynamic import constraints

If Copilot or a human developer chooses to use dynamic `import()`:

- Ensure imported modules are referenced in `web_accessible_resources` when
  required (especially for MV3 and content-like contexts)[source:6].
- Prefer using dynamic imports **only in background/popup contexts**, not from
  the sidebar in a way that depends on page/global module loader behavior.

---

## 9. How This Interacts with Earlier Refactors

The previous diagnostics report focused on **initialization ordering, state sync
bugs, and race conditions** inside the Quick Tabs Manager and related systems.

This document builds on that by:

- Highlighting that the **size and monolithic nature** of
  `sidebar/quick-tabs-manager.js` and `background.js` contribute to these race
  conditions and debugging difficulty.
- Encouraging a structural split that makes it easier to enforce proper
  initialization barriers, logging, and event routing.

**Important alignment:**

- Initialization barriers and state sync logic should end up **centralized in a
  small, cohesive module**, rather than being scattered across a 300+ KB file.
- Diagnostics and logging should be in a **shared or dedicated module**, not
  interleaved with every state update.

---

## 10. Recommended Implementation Order

1. **Introduce ES module structure and clear entrypoints**
   - Create internal module structure under `src/` for background, sidebar,
     popup, and shared code.
   - Wire these as Rollup entrypoints to keep external file names stable.

2. **Refactor `sidebar/quick-tabs-manager.js` first**
   - Move initialization, sync, rendering, logging, and health responsibilities
     into separate modules.
   - Maintain current behavior while improving internal structure.

3. **Refactor `background.js` into domain-specific modules**
   - Split out Quick Tabs state handling, copy-on-hover core, and logging.

4. **Light refactor of `popup.js` for shared logic extraction**
   - Only split where there is obvious shared or heavy logic.

5. **Re-evaluate bundle sizes and startup performance**
   - Confirm that the resulting built files remain under comfortable sizes and
     do not regress startup times.

---

## 11. Success Criteria (Non-Functional)

For this refactor to be considered successful (beyond functional correctness):

- **Maintainability**
  - Each major area (background, sidebar, popup) has a **clear entry module**
    and a small set of internal modules with obvious responsibilities.
  - Quick Tabs Manager logic is no longer contained in a single 300+ KB
    monolith.

- **Compatibility**
  - Extension continues to load and function correctly in Firefox (MV2 and/or
    MV3, depending on manifest version used in this branch).
  - No new dynamic import–related errors appear in the console.

- **Performance**
  - No increase in startup time or first-interaction latency.
  - Optionally, small reductions in parse/execute time for background and
    sidebar scripts.

- **Packaging**
  - Built XPI remains well under Firefox’s 200 MB upload limit[source:7] and
    comfortably under any practical per-file size concerns (4 MB per JS file as
    discussed in Mozilla community threads[source:1]).

---

## 12. Guidance for GitHub Copilot Coding Agent

When implementing this refactor, Copilot Coding Agent should:

- **Not** change feature behavior or user-facing flows.
- **Preserve external file names** referenced in `manifest.json` where feasible.
- Use **ES modules and Rollup** to split responsibilities into separate source
  files while still producing a stable, small set of built outputs.
- Avoid relying on dynamic `import()` from the sidebar or content scripts
  unless:
  - The modules are configured in `web_accessible_resources` where required.
  - The Firefox constraints from Bugzilla 1803950 and 1536094 are respected.
- Respect earlier diagnostics about initialization barriers and state sync:
  structural splitting should make it **easier** to enforce correct ordering,
  not harder.

This document is intended to be used along with the previous critical issues
report (`quick-tabs-sync-critical.md`): the issues document describes **what**
is broken; this one describes **how to structure the code** to keep it
maintainable, performant, and Firefox‑friendly as those issues are fixed.
