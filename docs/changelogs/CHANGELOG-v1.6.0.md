# Changelog - v1.6.0 Infrastructure

**Release Date:** 2025-11-18 (Infrastructure Phase)  
**Status:** Infrastructure Complete, Refactoring In Progress

---

## Overview

Version 1.6.0 represents the beginning of a comprehensive architectural
refactoring to reduce technical debt and improve maintainability. This release
completes **Phase 0: Infrastructure Setup**, establishing the foundation for the
modular architecture transformation.

---

## 🏗️ Infrastructure Changes

### Build System Enhancements

**Module Aliasing System**

- Added path aliases for clean imports: `@domain`, `@storage`, `@features`,
  `@utils`, `@core`, `@ui`
- Integrated `@rollup/plugin-alias` for module resolution
- Configured `@rollup/plugin-terser` for production optimizations
- Enabled tree-shaking for bundle size reduction
- Support for multiple entry points (prepared for future)

**Example:**

```javascript
// Before: Brittle relative paths
import { QuickTab } from '../../domain/QuickTab.js';

// After: Clean aliased imports
import { QuickTab } from '@domain/QuickTab.js';
```

### Test Infrastructure Upgrades

**Enhanced Jest Configuration**

- Module path mapping matches Rollup aliases
- Layer-specific coverage thresholds:
  - Domain: 100% required
  - Storage: 90% required
  - Features: 80% required
  - Global: 80% required
- Extended test timeout for async operations (10s)
- Reset mocks between tests

**New Test Structure**

```
tests/
├── unit/         # Unit tests (domain, storage, handlers, utils)
├── integration/  # Integration tests
├── e2e/         # End-to-end tests
├── helpers/     # Test utilities
└── __mocks__/   # Enhanced mocks
```

**Test Helpers Created**

- `test-builders.js` - Fluent builders for test fixtures
- `async-helpers.js` - Async test utilities (flushPromises, waitFor, etc.)
- `dom-helpers.js` - DOM manipulation helpers
- `browser-storage.js` - Mock browser.storage API
- `broadcast-channel.js` - Mock BroadcastChannel

### Code Quality Enforcement

**ESLint Architectural Rules**

- Complexity limits: `complexity ≤ 9`, `max-depth ≤ 2`,
  `max-lines-per-function ≤ 70`
- Async/await rules: `require-await`, `no-return-await`,
  `prefer-promise-reject-errors`
- Import ordering: domain → storage → features → internal → relative
- Architecture boundaries enforced:
  - Domain layer cannot import from features or storage
  - Storage layer cannot import from features

**Example:**

```javascript
// ❌ ERROR: Domain importing from features
import { QuickTabsManager } from '@features/quick-tabs';

// ✅ OK: Domain only uses internal dependencies
import { EventEmitter } from '@utils/EventEmitter';
```

### Validation Scripts

**Bundle Size Checker** (`scripts/check-bundle-size.js`)

- Enforces size limits:
  - content.js: <500KB
  - background.js: <300KB
  - popup.js: <100KB
- Runs automatically in CI
- Clear visual feedback

**Architecture Validator** (`scripts/validate-architecture.js`)

- Validates domain layer isolation
- Checks storage layer dependencies
- Validates facade locations
- Migration-aware (tolerates old structure)

### New npm Scripts

**Build Scripts**

- `build:content` - Build content script only
- `build:analyze` - Analyze bundle with visualizer
- `build:check-size` - Check bundle sizes

**Test Scripts**

- `test:unit` - Run unit tests only
- `test:integration` - Run integration tests only
- `test:domain` - Run domain tests with 100% coverage enforcement
- `test:storage` - Run storage tests
- `test:watch:unit` - Watch unit tests
- `test:watch:integration` - Watch integration tests
- `coverage:domain` - Domain layer coverage
- `coverage:storage` - Storage layer coverage
- `coverage:features` - Features layer coverage

**Validation Scripts**

- `validate:architecture` - Validate architecture boundaries
- `validate:imports` - Validate import restrictions

**CI Scripts**

- `ci:lint` - CI linting
- `ci:test` - CI testing
- `ci:build` - CI build with size checks
- `ci:full` - Full CI pipeline

---

## 📦 Dependencies

### Removed

- `zustand@^5.0.8` - Unused state management library (0 references found)

### Added DevDependencies

- `@rollup/plugin-alias@^5.1.0` - Module path aliasing
- `@rollup/plugin-terser@^0.4.4` - Bundle minification
- `eslint-plugin-import@^2.29.1` - Import validation and ordering
- `jest-extended@^4.0.2` - Extended Jest matchers
- `jest-mock-extended@^4.0.0` - Type-safe mocks
- `flush-promises@^1.0.2` - Async test helper

---

## ✅ Validation Results

### Build System

- ✅ Build completes successfully
- ✅ Bundle sizes within limits:
  - content.js: 231.05KB / 500KB (46.2%)
  - background.js: 57.55KB / 300KB (19.2%)
  - popup.js: 26.65KB / 100KB (26.7%)

### Test Suite

- ✅ All 76 existing tests pass
- ✅ Test infrastructure functional
- ✅ Module mappers working

### Architecture

- ✅ Architecture validation working
- ✅ Migration-tolerant
- ℹ️ Domain layer not yet created (Phase 1)
- ℹ️ Storage layer not yet created (Phase 1)

### Code Quality

- ✅ ESLint runs successfully
- ⚠️ 20 minor warnings (unused vars, prefer-const) - existing code
- ✅ New complexity rules active (will enforce on new code)

---

## 🔄 Breaking Changes

**None.** All changes are infrastructure-only and fully backward compatible.

---

## 🐛 Bug Fixes

None in this release (infrastructure focus).

---

## 📚 Documentation

### New Documentation

- `docs/implementation-summaries/IMPLEMENTATION-SUMMARY-v1.6.0-infrastructure.md` -
  Complete infrastructure summary
- `docs/changelogs/CHANGELOG-v1.6.0.md` - This changelog

### Updated Documentation

- `manifest.json` - Version 1.5.9.13 → 1.6.0
- `package.json` - Version 1.5.9.13 → 1.6.0

---

## 🚀 What's Next: Phase 1

**Phase 1: Extract Domain Models & Storage Abstraction (Estimated: 2 weeks)**

### Goals

- Create pure domain logic layer (QuickTab, QuickTabState, Container)
- Create async-first storage abstraction
- Achieve 100% domain layer test coverage
- Support all legacy storage formats (v1.5.8.13-15)

### Files to Create

```
src/
├── domain/
│   ├── QuickTab.js          # Domain entity with business logic
│   ├── QuickTabState.js     # State transitions
│   └── Container.js         # Firefox container entity
└── storage/
    ├── StorageAdapter.js    # Base adapter class
    ├── SyncStorageAdapter.js
    ├── SessionStorageAdapter.js
    └── FormatMigrator.js    # v1.5.8.13-15 format handling
```

### Success Criteria

- [ ] Domain layer: 100% test coverage
- [ ] Storage layer: 90% test coverage
- [ ] Zero dependencies from domain → storage/features
- [ ] All legacy storage formats supported
- [ ] 30% reduction in conditional logic in index.js

---

## 🎯 Full Refactoring Roadmap

### Timeline (11 weeks total)

- ✅ **Phase 0:** Infrastructure Setup (1 week) - **COMPLETE**
- 🔄 **Phase 1:** Domain & Storage (2 weeks) - **NEXT**
- 📋 **Phase 2.1:** Decompose QuickTabsManager (2 weeks)
- 📋 **Phase 2.2:** Consolidate Background State (2 weeks)
- 📋 **Phase 2.3:** Decompose Window.js (2 weeks)
- 📋 **Phase 3:** Replace Conditionals (2 weeks)
- 📋 **Phase 4:** Eliminate Duplication (1 week)
- 📋 **Phase 5:** Final Integration & Testing (1 week)

### Target Metrics

- index.js: 50KB → ~15KB (70% reduction)
- Mean cyclomatic complexity: 6.74 → ~3.0 (55% reduction)
- Max cyclomatic complexity: 25 → ~8 (68% reduction)
- Test coverage: 40% → 80%+ overall, 100% domain
- Large functions (>70 lines): 8 → 0
- Bumpy roads: 15 → 0
- Nesting depth: 4 → 2 levels

---

## 📖 References

- [Refactoring Plan v2 (Evidence-Based)](../manual/1.5.9%20docs/copy-url-on-hover-refactoring-plan-v2-evidence-based.md)
- [Infrastructure & Testing Changes](../manual/1.5.9%20docs/infrastructure-testing-changes-refactoring.md)
- [Implementation Summary v1.6.0](../implementation-summaries/IMPLEMENTATION-SUMMARY-v1.6.0-infrastructure.md)

---

## 💬 Notes

The infrastructure is now production-ready and can support the full refactoring.
All scaffolding is in place:

- ✅ Module aliasing system
- ✅ Test infrastructure with helpers and mocks
- ✅ Validation scripts (bundle size, architecture)
- ✅ Coverage enforcement by layer
- ✅ Architecture boundary enforcement

The foundation is solid. Phases 1-10 can proceed with confidence.
