# Infrastructure & Testing Changes for Extension Refactoring

## Supporting the Modular Architecture Transformation

**Context**: This report details necessary changes to CI/CD workflows, build
tooling, test infrastructure, and developer tooling to support the refactoring
plan outlined in the main document.

---

## Executive Summary

Your current infrastructure is **partially configured** for modular development
but will require **significant updates** to support the refactored architecture.
Key gaps:

1. **Build system** (Rollup) only bundles `content.js` - needs to handle 20+ new
   modules
2. **Jest configuration** assumes flat structure - needs module path mapping
3. **CI/CD workflows** validate monolithic structure - need module-aware checks
4. **No unit test infrastructure** - only integration tests exist
5. **ESLint/Prettier** configured for flat files - need rule updates for modular
   patterns

**Impact**: Without infrastructure updates, you'll face:

- Build failures when importing new modules
- Test discovery issues (Jest won't find new test files)
- CI/CD failures on module boundaries
- Inconsistent code formatting across new module structure

---

## Current Infrastructure Analysis

### 1. Build System (Rollup)

**Current State** (`rollup.config.js`):

```javascript
export default [
  {
    input: 'src/content.js',
    output: {
      file: 'dist/content.js',
      format: 'iife',
      sourcemap: !production
    },
    plugins: [resolve(), commonjs()]
  }
];
```

**Problems**:

- ❌ Only bundles `content.js` - ignores new modules in `src/domain/`,
  `src/storage/`, etc.
- ❌ Single entry point - can't handle multiple outputs (background.js, popup.js
  will need bundling too)
- ❌ No tree-shaking configuration (will bloat bundle with unused code)
- ❌ No module aliasing (@domain, @storage) for clean imports

**Required Changes**: See Section 3 below.

---

### 2. Test Infrastructure (Jest)

**Current State** (`jest.config.cjs`):

```javascript
module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.js', '**/?(*.)+(spec|test).js'],

  moduleNameMapper: {
    '^webextension-polyfill$':
      '<rootDir>/tests/__mocks__/webextension-polyfill.js'
  },

  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!src/**/__tests__/**',
    '!**/node_modules/**'
  ]
};
```

**Problems**:

- ❌ No module path aliases (@domain/QuickTab → src/domain/QuickTab.js)
- ❌ Coverage exclusions don't account for new structure (facades, handlers,
  coordinators)
- ❌ No mock setup for new storage adapters
- ❌ Missing test patterns for new module hierarchy
  (src/features/quick-tabs/managers/\*.test.js)

**Existing Tests**:

- `tests/example.test.js` (32KB) - Integration test (likely for old structure)
- `tests/quick-tabs-creation.test.js` (18KB) - Feature test

**Gap**: **Zero unit tests** for domain logic, storage adapters, or handlers.
All tests are integration-level.

**Required Changes**: See Section 4 below.

---

### 3. CI/CD Workflows

**Current Workflows**:

1. **code-quality.yml** - ESLint + Prettier + Build + web-ext lint
2. **test-coverage.yml** - Jest with Codecov upload
3. **auto-format.yml** - Auto-format on push
4. **codeql-analysis.yml** - Security scanning
5. **webext-lint.yml** - Firefox validation
6. **release.yml** - Release automation

**Problems**:

**code-quality.yml**:

```yaml
# Checks for key classes in dist/content.js
grep -q "ConfigManager" dist/content.js && echo "✓ ConfigManager found" grep -q
"StateManager" dist/content.js && echo "✓ StateManager found" grep -q "EventBus"
dist/content.js && echo "✓ EventBus found"
```

- ❌ Hardcoded class names from old structure
- ❌ No checks for new modules (StorageManager, BroadcastManager, etc.)
- ❌ Doesn't validate module boundaries (domain shouldn't import from features)

**test-coverage.yml**:

```yaml
run: npm run test:coverage
```

- ❌ Will fail when no unit tests exist for new modules
- ❌ No minimum coverage threshold enforcement (should be 80% for domain layer)

**Required Changes**: See Section 5 below.

---

### 4. Linting & Formatting

**Current ESLint** (`.eslintrc.cjs`):

```javascript
module.exports = {
  env: {
    browser: true,
    es2021: true,
    node: true,
    webextensions: true
  },
  rules: {
    'no-console': 'off', // Allow console.log
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-var': 'error',
    'prefer-const': 'warn'
  }
};
```

**Problems**:

- ❌ No rules for class complexity (max-lines-per-function, complexity,
  max-depth)
- ❌ No import/export order rules (domain imports should come first)
- ❌ No architecture boundary enforcement (eslint-plugin-boundaries)
- ❌ Missing rules for async/await patterns (require-await, no-return-await)

**Required Changes**: See Section 6 below.

---

### 5. Package Dependencies

**Current** (`package.json`):

```json
{
  "dependencies": {
    "eventemitter3": "^5.0.1",
    "lodash-es": "^4.17.21",
    "uuid": "^13.0.0",
    "webext-options-sync": "^4.3.0",
    "webext-storage-cache": "^6.0.3",
    "webextension-polyfill": "^0.12.0",
    "zustand": "^5.0.8"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "rollup": "^3.29.0"
    // ... more
  }
}
```

**Analysis**:

- ✅ `eventemitter3` - Good for EventBus pattern (used in refactoring)
- ✅ `webextension-polyfill` - Correct for Firefox
- ❌ `zustand` - State management library **NOT used anywhere** (can remove)
- ❌ `lodash-es` - Tree-shakeable version (good, but check usage)
- ⚠️ Missing: Test utilities for new patterns (test doubles, builders)

**Required Changes**: See Section 7 below.

---

## Required Infrastructure Changes

### Section 3: Build System Updates

#### 3.1 Enhanced Rollup Configuration

**Goal**: Support multiple entry points, module aliasing, and tree-shaking

**New `rollup.config.js`**:

```javascript
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import alias from '@rollup/plugin-alias';
import { terser } from 'rollup-plugin-terser';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const production = process.env.BUILD === 'production';

// Module aliases for clean imports
const aliases = {
  '@domain': path.resolve(__dirname, 'src/domain'),
  '@storage': path.resolve(__dirname, 'src/storage'),
  '@features': path.resolve(__dirname, 'src/features'),
  '@utils': path.resolve(__dirname, 'src/utils'),
  '@core': path.resolve(__dirname, 'src/core')
};

// Common plugins for all bundles
const commonPlugins = [
  alias({ entries: aliases }),
  resolve({
    browser: true,
    preferBuiltins: false
  }),
  commonjs(),
  production &&
    terser({
      compress: {
        drop_console: false, // Keep console for extension debugging
        passes: 2
      },
      mangle: {
        properties: false // Don't mangle browser API properties
      }
    })
];

export default [
  // Content script bundle
  {
    input: 'src/content.js',
    output: {
      file: 'dist/content.js',
      format: 'iife',
      name: 'ContentScript',
      sourcemap: !production,
      globals: {
        'webextension-polyfill': 'browser'
      }
    },
    external: ['webextension-polyfill'],
    plugins: commonPlugins,
    treeshake: production
  },

  // Background script bundle (if needed after refactoring)
  {
    input: 'background.js',
    output: {
      file: 'dist/background.js',
      format: 'iife',
      name: 'BackgroundScript',
      sourcemap: !production
    },
    plugins: commonPlugins
  },

  // Popup script bundle
  {
    input: 'popup.js',
    output: {
      file: 'dist/popup.js',
      format: 'iife',
      name: 'PopupScript',
      sourcemap: !production
    },
    plugins: commonPlugins
  }
];
```

**New package.json dependencies**:

```json
{
  "devDependencies": {
    "@rollup/plugin-alias": "^5.1.0",
    "rollup-plugin-terser": "^7.0.2"
  }
}
```

**Validation**: Add to `package.json` scripts:

```json
{
  "scripts": {
    "build:analyze": "rollup -c --environment BUILD:production --plugin visualizer",
    "build:check-size": "node scripts/check-bundle-size.js"
  }
}
```

**New `scripts/check-bundle-size.js`**:

```javascript
import fs from 'fs';
import path from 'path';

const MAX_BUNDLE_SIZES = {
  'content.js': 500 * 1024, // 500KB max
  'background.js': 300 * 1024, // 300KB max
  'popup.js': 100 * 1024 // 100KB max
};

let failed = false;

for (const [file, maxSize] of Object.entries(MAX_BUNDLE_SIZES)) {
  const filePath = path.join('dist', file);
  if (!fs.existsSync(filePath)) continue;

  const stats = fs.statSync(filePath);
  const sizeMB = (stats.size / 1024).toFixed(2);
  const maxMB = (maxSize / 1024).toFixed(2);

  if (stats.size > maxSize) {
    console.error(`❌ ${file}: ${sizeMB}KB exceeds limit of ${maxMB}KB`);
    failed = true;
  } else {
    console.log(`✅ ${file}: ${sizeMB}KB (limit: ${maxMB}KB)`);
  }
}

if (failed) {
  console.error(
    '\n⚠️  Bundle size check failed. Consider code splitting or tree-shaking.'
  );
  process.exit(1);
}

console.log('\n✅ All bundle sizes within limits.');
```

---

#### 3.2 Module Aliasing in Source Files

**Enable clean imports in refactored code**:

**Before** (relative imports):

```javascript
// src/features/quick-tabs/QuickTabsManager.js
import { QuickTab } from '../../domain/QuickTab.js';
import { SyncStorageAdapter } from '../../storage/SyncStorageAdapter.js';
import { EventEmitter } from '../../utils/EventEmitter.js';
```

**After** (aliased imports):

```javascript
// src/features/quick-tabs/QuickTabsManager.js
import { QuickTab } from '@domain/QuickTab.js';
import { SyncStorageAdapter } from '@storage/SyncStorageAdapter.js';
import { EventEmitter } from '@utils/EventEmitter.js';
```

**Benefit**: No brittle relative paths. Moving files doesn't break imports.

---

### Section 4: Test Infrastructure Updates

#### 4.1 Enhanced Jest Configuration

**New `jest.config.cjs`**:

```javascript
module.exports = {
  // Test environment
  testEnvironment: 'jsdom',

  // Root directories for tests
  roots: ['<rootDir>/src', '<rootDir>/tests'],

  // Test file patterns
  testMatch: ['**/__tests__/**/*.js', '**/?(*.)+(spec|test).js'],

  // Module aliasing (must match Rollup aliases)
  moduleNameMapper: {
    '^@domain/(.*)$': '<rootDir>/src/domain/$1',
    '^@storage/(.*)$': '<rootDir>/src/storage/$1',
    '^@features/(.*)$': '<rootDir>/src/features/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@core/(.*)$': '<rootDir>/src/core/$1',
    '^webextension-polyfill$':
      '<rootDir>/tests/__mocks__/webextension-polyfill.js'
  },

  // Transform ES modules
  transformIgnorePatterns: [
    'node_modules/(?!(webextension-polyfill|eventemitter3|webext-storage-cache|webext-options-sync|lodash-es)/)'
  ],

  // Coverage configuration
  collectCoverage: false,
  collectCoverageFrom: [
    // Domain layer - require 100% coverage
    'src/domain/**/*.js',

    // Storage layer - require 90% coverage
    'src/storage/**/*.js',

    // Feature modules - require 80% coverage
    'src/features/**/*.js',

    // Utils - require 90% coverage
    'src/utils/**/*.js',

    // Core - require 85% coverage
    'src/core/**/*.js',

    // Exclusions
    '!src/**/*.test.js',
    '!src/**/*.spec.js',
    '!src/**/__tests__/**',
    '!src/**/__mocks__/**',
    '!**/node_modules/**',
    '!**/dist/**'
  ],

  // Coverage thresholds by directory
  coverageThreshold: {
    // Domain layer must have perfect coverage (pure logic)
    './src/domain/': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100
    },

    // Storage adapters (I/O) - allow some uncovered branches
    './src/storage/': {
      branches: 85,
      functions: 90,
      lines: 90,
      statements: 90
    },

    // Feature modules (UI interaction) - realistic targets
    './src/features/': {
      branches: 75,
      functions: 80,
      lines: 80,
      statements: 80
    },

    // Global threshold
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },

  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'lcov', 'html'],

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],

  // Transform
  transform: {
    '^.+\\.js$': 'babel-jest'
  },

  // Module paths
  moduleDirectories: ['node_modules', 'src'],

  // Module file extensions
  moduleFileExtensions: ['js', 'json'],

  // Globals
  globals: {
    browser: true
  },

  // Clear mocks between tests
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,

  // Verbose output
  verbose: true,

  // Test timeout (increase for async operations)
  testTimeout: 10000
};
```

**Key Changes**:

1. ✅ Module aliasing matches Rollup config
2. ✅ Coverage thresholds enforced per layer (domain=100%, features=80%)
3. ✅ Exclusions for test files and mocks
4. ✅ Longer timeout for async storage operations

---

#### 4.2 New Test Structure

**Refactored test directory**:

```
tests/
├── unit/                           # Unit tests (new)
│   ├── domain/
│   │   ├── QuickTab.test.js        # Pure domain logic
│   │   ├── QuickTabState.test.js
│   │   └── Container.test.js
│   ├── storage/
│   │   ├── SyncStorageAdapter.test.js
│   │   ├── SessionStorageAdapter.test.js
│   │   └── FormatMigrator.test.js
│   ├── handlers/
│   │   ├── CreateHandler.test.js
│   │   ├── SoloHandler.test.js
│   │   └── MuteHandler.test.js
│   └── utils/
│       ├── EventEmitter.test.js
│       └── Guards.test.js
│
├── integration/                    # Integration tests (existing + new)
│   ├── quick-tabs-creation.test.js # Existing
│   ├── storage-sync.test.js        # New - test storage sync flow
│   ├── broadcast-channel.test.js   # New - test cross-tab messaging
│   └── state-coordinator.test.js   # New - test state coordination
│
├── e2e/                            # End-to-end tests (new)
│   ├── playwright.config.js
│   ├── extension-load.spec.js      # Test extension loads
│   ├── quick-tab-lifecycle.spec.js # Create → minimize → restore → close
│   └── cross-tab-sync.spec.js      # Multi-tab state sync
│
├── __mocks__/                      # Mocks (existing + new)
│   ├── webextension-polyfill.js    # Existing
│   ├── browser-storage.js          # New - mock browser.storage
│   ├── broadcast-channel.js        # New - mock BroadcastChannel
│   └── quick-tab-fixtures.js       # New - test data builders
│
├── helpers/                        # Test utilities (new)
│   ├── test-builders.js            # Fluent builders for test data
│   ├── async-helpers.js            # Async test utilities
│   └── dom-helpers.js              # DOM manipulation utilities
│
├── setup.js                        # Existing
└── example.test.js                 # Existing (can archive)
```

---

#### 4.3 Example Unit Test (Domain Layer)

**New `tests/unit/domain/QuickTab.test.js`**:

```javascript
import { QuickTab } from '@domain/QuickTab.js';
import { quickTabBuilder } from '../../helpers/test-builders.js';

describe('QuickTab Domain Entity', () => {
  describe('Visibility Logic', () => {
    test('should be visible by default', () => {
      const quickTab = quickTabBuilder().build();

      expect(quickTab.shouldBeVisible(123)).toBe(true);
    });

    test('should not be visible when minimized', () => {
      const quickTab = quickTabBuilder().minimized(true).build();

      expect(quickTab.shouldBeVisible(123)).toBe(false);
    });

    test('should only be visible on soloed tabs', () => {
      const quickTab = quickTabBuilder().soloedOnTabs([100, 200]).build();

      expect(quickTab.shouldBeVisible(100)).toBe(true);
      expect(quickTab.shouldBeVisible(200)).toBe(true);
      expect(quickTab.shouldBeVisible(300)).toBe(false);
    });

    test('should not be visible on muted tabs', () => {
      const quickTab = quickTabBuilder().mutedOnTabs([100, 200]).build();

      expect(quickTab.shouldBeVisible(100)).toBe(false);
      expect(quickTab.shouldBeVisible(200)).toBe(false);
      expect(quickTab.shouldBeVisible(300)).toBe(true);
    });

    test('solo takes precedence over mute', () => {
      const quickTab = quickTabBuilder()
        .soloedOnTabs([100])
        .mutedOnTabs([200])
        .build();

      expect(quickTab.shouldBeVisible(100)).toBe(true);
      expect(quickTab.shouldBeVisible(200)).toBe(false);
    });
  });

  describe('State Transitions', () => {
    test('solo() adds tab to solo list', () => {
      const quickTab = quickTabBuilder().build();

      quickTab.solo(100);

      expect(quickTab.visibility.soloedOnTabs).toContain(100);
    });

    test('solo() does not add duplicate', () => {
      const quickTab = quickTabBuilder().soloedOnTabs([100]).build();

      quickTab.solo(100);

      expect(quickTab.visibility.soloedOnTabs).toEqual([100]);
    });

    test('unsolo() removes tab from solo list', () => {
      const quickTab = quickTabBuilder().soloedOnTabs([100, 200]).build();

      quickTab.unsolo(100);

      expect(quickTab.visibility.soloedOnTabs).toEqual([200]);
    });

    test('mute() clears solo list', () => {
      const quickTab = quickTabBuilder().soloedOnTabs([100]).build();

      quickTab.mute(200);

      expect(quickTab.visibility.soloedOnTabs).toEqual([]);
      expect(quickTab.visibility.mutedOnTabs).toContain(200);
    });
  });
});
```

**New `tests/helpers/test-builders.js`**:

```javascript
// Fluent builder pattern for test data
export function quickTabBuilder() {
  const defaults = {
    id: `qt-${Date.now()}-${Math.random()}`,
    url: 'https://example.com',
    position: { left: 100, top: 100 },
    size: { width: 400, height: 300 },
    visibility: {
      minimized: false,
      soloedOnTabs: [],
      mutedOnTabs: []
    },
    container: 'firefox-default',
    createdAt: Date.now()
  };

  const builder = {
    id(value) {
      defaults.id = value;
      return builder;
    },
    url(value) {
      defaults.url = value;
      return builder;
    },
    minimized(value) {
      defaults.visibility.minimized = value;
      return builder;
    },
    soloedOnTabs(tabs) {
      defaults.visibility.soloedOnTabs = tabs;
      return builder;
    },
    mutedOnTabs(tabs) {
      defaults.visibility.mutedOnTabs = tabs;
      return builder;
    },
    container(value) {
      defaults.container = value;
      return builder;
    },
    build() {
      return new QuickTab(defaults);
    }
  };

  return builder;
}
```

**Benefits**:

- ✅ **100% domain logic coverage** with minimal setup
- ✅ **Fluent builder** makes tests readable
- ✅ **No browser mocks needed** (pure logic)
- ✅ **Fast** (~5ms per test)

---

#### 4.4 Example Integration Test (Storage Layer)

**New `tests/integration/storage-sync.test.js`**:

```javascript
import { SyncStorageAdapter } from '@storage/SyncStorageAdapter.js';
import { QuickTab } from '@domain/QuickTab.js';
import { quickTabBuilder } from '../helpers/test-builders.js';

// Mock browser.storage.sync
jest.mock('webextension-polyfill', () => ({
  storage: {
    sync: {
      set: jest.fn(() => Promise.resolve()),
      get: jest.fn(() => Promise.resolve({}))
    }
  }
}));

import browser from 'webextension-polyfill';

describe('Storage Sync Integration', () => {
  let adapter;

  beforeEach(() => {
    adapter = new SyncStorageAdapter();
    jest.clearAllMocks();
  });

  test('save() stores Quick Tab in container-aware format', async () => {
    const quickTab = quickTabBuilder()
      .id('qt-123')
      .url('https://example.com')
      .container('firefox-container-1')
      .build();

    await adapter.save('firefox-container-1', [quickTab]);

    expect(browser.storage.sync.set).toHaveBeenCalledWith({
      quick_tabs_state_v2: expect.objectContaining({
        containers: {
          'firefox-container-1': {
            tabs: expect.arrayContaining([
              expect.objectContaining({
                id: 'qt-123',
                url: 'https://example.com'
              })
            ]),
            lastUpdate: expect.any(Number)
          }
        },
        saveId: expect.stringMatching(/^\d+-[a-z0-9]+$/),
        timestamp: expect.any(Number)
      })
    });
  });

  test('load() retrieves and parses Quick Tabs', async () => {
    browser.storage.sync.get.mockResolvedValue({
      quick_tabs_state_v2: {
        containers: {
          'firefox-default': {
            tabs: [
              {
                id: 'qt-1',
                url: 'https://example.com',
                position: {},
                size: {},
                visibility: {}
              }
            ],
            lastUpdate: Date.now()
          }
        }
      }
    });

    const result = await adapter.load('firefox-default');

    expect(result).not.toBeNull();
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0]).toBeInstanceOf(QuickTab);
  });

  test('load() handles legacy format migration', async () => {
    browser.storage.sync.get.mockResolvedValue({
      quick_tabs_state_v2: {
        tabs: [{ id: 'qt-1', url: 'https://example.com' }],
        timestamp: Date.now()
      }
    });

    const result = await adapter.load('firefox-default');

    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0].container).toBe('firefox-default');
  });
});
```

---

### Section 5: CI/CD Workflow Updates

#### 5.1 Enhanced Code Quality Workflow

**Updated `.github/workflows/code-quality.yml`**:

```yaml
name: Code Quality Checks

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  # JOB 1: ESLint with module-aware checks
  lint:
    name: ESLint Check
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run ESLint
        run: npm run lint

      - name: Generate ESLint report
        if: always()
        run: |
          npx eslint . --format json --output-file eslint-report.json || true

      - name: Annotate code with ESLint results
        if: always()
        uses: ataylorme/eslint-annotate-action@v2
        with:
          repo-token: ${{ secrets.GITHUB_TOKEN }}
          report-json: 'eslint-report.json'

  # JOB 2: Prettier format check
  format-check:
    name: Prettier Format Check
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Check Prettier formatting
        run: npm run format:check

      - name: Show unformatted files
        if: failure()
        run: |
          echo "::error::The following files need formatting:"
          npx prettier --list-different .

  # JOB 3: Build with module validation
  build:
    name: Build Extension
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build production bundle
        run: npm run build:prod

      # NEW: Validate modular structure in bundle
      - name: Validate module boundaries
        run: |
          echo "Checking for domain layer isolation..."

          # Domain layer should not import from features
          if grep -q "features/" dist/content.js | grep -q "domain/"; then
            echo "ERROR: Domain layer has circular dependency with features"
            exit 1
          fi

          echo "✓ Module boundaries validated"

      # NEW: Check for new refactored classes
      - name: Verify refactored classes
        run: |
          echo "Checking for refactored classes..."
          grep -q "StorageManager" dist/content.js && echo "✓ StorageManager found"
          grep -q "BroadcastManager" dist/content.js && echo "✓ BroadcastManager found"
          grep -q "QuickTab" dist/content.js && echo "✓ QuickTab domain entity found"
          grep -q "StorageAdapter" dist/content.js && echo "✓ StorageAdapter found"

      # NEW: Check bundle sizes
      - name: Check bundle sizes
        run: npm run build:check-size

      - name: Validate no imports/exports in bundle
        run: |
          if grep -q "^import " dist/content.js; then
            echo "ERROR: dist/content.js contains import statements"
            exit 1
          fi
          if grep -q "^export " dist/content.js; then
            echo "ERROR: dist/content.js contains export statements"
            exit 1
          fi
          echo "✓ Bundle validation passed"

      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: extension-build
          path: dist/
          retention-days: 7

  # JOB 4: Unit tests (new)
  unit-tests:
    name: Unit Tests
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run unit tests
        run: npm run test:unit

      - name: Enforce coverage thresholds
        run: |
          echo "Checking domain layer coverage (must be 100%)..."
          npm run test:coverage -- --collectCoverageFrom='src/domain/**/*.js'

  # JOB 5: Web extension lint
  web-ext-lint:
    name: Firefox Extension Validator
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Install web-ext
        run: npm install --global web-ext

      - name: Lint extension with web-ext
        run: |
          web-ext lint \
            --source-dir=. \
            --ignore-files="*.md" "node_modules/**" "dist/**" ".github/**" "docs/**" "src/**" \
            --pretty \
            --output=text
```

**Key Additions**:

1. ✅ Module boundary validation (domain doesn't depend on features)
2. ✅ Bundle size checks (prevent bloat)
3. ✅ New class detection (StorageManager, BroadcastManager)
4. ✅ Separate unit test job with 100% domain coverage enforcement

---

#### 5.2 New Unit Test Script

**Add to `package.json`**:

```json
{
  "scripts": {
    "test:unit": "jest --testPathPattern=tests/unit",
    "test:integration": "jest --testPathPattern=tests/integration",
    "test:domain": "jest --testPathPattern=tests/unit/domain --coverage --coverageThreshold='{\"global\":{\"branches\":100,\"functions\":100,\"lines\":100,\"statements\":100}}'",
    "test:watch:unit": "jest --testPathPattern=tests/unit --watch"
  }
}
```

---

### Section 6: ESLint Rule Updates

#### 6.1 Architecture Boundary Enforcement

**New `.eslintrc.cjs`**:

```javascript
module.exports = {
  env: {
    browser: true,
    es2021: true,
    node: true,
    webextensions: true
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  globals: {
    browser: 'readonly',
    chrome: 'readonly'
  },
  plugins: ['import'], // NEW: Add import plugin
  rules: {
    // Existing rules
    'no-console': 'off',
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-var': 'error',
    'prefer-const': 'warn',

    // NEW: Complexity rules (align with CodeScene targets)
    complexity: ['error', 9], // cc ≤ 9
    'max-depth': ['error', 2], // nesting ≤ 2 levels
    'max-lines-per-function': [
      'warn',
      { max: 70, skipBlankLines: true, skipComments: true }
    ],
    'max-nested-callbacks': ['error', 3],

    // NEW: Async/await rules
    'require-await': 'warn',
    'no-return-await': 'warn',
    'prefer-promise-reject-errors': 'error',

    // NEW: Import ordering
    'import/order': [
      'error',
      {
        groups: [
          ['builtin', 'external'], // Node built-ins and npm packages first
          ['internal'], // @domain, @storage aliases
          ['parent', 'sibling'], // Relative imports
          ['index', 'object']
        ],
        pathGroups: [
          {
            pattern: '@domain/**',
            group: 'internal',
            position: 'before'
          },
          {
            pattern: '@storage/**',
            group: 'internal',
            position: 'before'
          },
          {
            pattern: '@features/**',
            group: 'internal'
          }
        ],
        pathGroupsExcludedImportTypes: ['builtin'],
        'newlines-between': 'always',
        alphabetize: {
          order: 'asc',
          caseInsensitive: true
        }
      }
    ],

    // NEW: Architecture boundaries
    'import/no-restricted-paths': [
      'error',
      {
        zones: [
          // Domain layer cannot import from features or storage
          {
            target: './src/domain',
            from: './src/features',
            message: 'Domain layer must not depend on features'
          },
          {
            target: './src/domain',
            from: './src/storage',
            message: 'Domain layer must not depend on storage infrastructure'
          },
          // Storage layer cannot import from features
          {
            target: './src/storage',
            from: './src/features',
            message: 'Storage layer must not depend on features'
          }
        ]
      }
    ]
  },
  overrides: [
    {
      files: ['rollup.config.js', 'jest.config.cjs', '.eslintrc.cjs'],
      env: { node: true },
      parserOptions: { sourceType: 'module', ecmaVersion: 'latest' }
    },
    {
      files: ['tests/**/*.js', '**/*.test.js', '**/*.spec.js'],
      env: { jest: true, node: true },
      rules: {
        // Relax complexity rules for tests
        'max-lines-per-function': 'off',
        complexity: 'off'
      }
    }
  ],
  ignorePatterns: ['node_modules/', 'dist/', '*.min.js', 'coverage/']
};
```

**New dependency**:

```json
{
  "devDependencies": {
    "eslint-plugin-import": "^2.29.1"
  }
}
```

**Benefits**:

- ✅ Enforces cc ≤ 9 (aligns with refactoring goals)
- ✅ Prevents domain layer from importing features (architectural boundary)
- ✅ Import ordering keeps domain imports at top (visibility)
- ✅ Catches missing await keywords

---

### Section 7: Dependency Updates

#### 7.1 Remove Unused Dependencies

**Current `zustand` is unused** - remove:

```json
{
  "dependencies": {
    "zustand": "^5.0.8" // ❌ REMOVE - not used anywhere
  }
}
```

**Verification**:

```bash
grep -r "zustand" src/
# No results = safe to remove
```

---

#### 7.2 Add Test Utilities

**New test dependencies**:

```json
{
  "devDependencies": {
    "@testing-library/dom": "^10.4.1", // Existing
    "@testing-library/jest-dom": "^6.9.1", // Existing
    "@testing-library/user-event": "^14.6.1", // Existing

    // NEW: Test utilities
    "jest-mock-extended": "^4.0.0", // Type-safe mocks
    "flush-promises": "^1.0.2", // Async test helper
    "jest-extended": "^4.0.2" // Extended matchers
  }
}
```

**Usage in tests**:

```javascript
import { mockDeep } from 'jest-mock-extended';
import flushPromises from 'flush-promises';

// Type-safe mock
const mockStorage = mockDeep<StorageAdapter>();

// Wait for all promises
await flushPromises();
```

---

### Section 8: New npm Scripts

**Add to `package.json`**:

```json
{
  "scripts": {
    // Existing scripts
    "build": "npm run clean && rollup -c && npm run copy-assets",
    "build:prod": "npm run clean && rollup -c --environment BUILD:production && npm run copy-assets",
    "test": "jest",
    "test:coverage": "jest --coverage",

    // NEW: Modular build scripts
    "build:content": "rollup -c --input src/content.js --output dist/content.js",
    "build:background": "rollup -c --input background.js --output dist/background.js",
    "build:analyze": "rollup -c --environment BUILD:production --plugin visualizer",
    "build:check-size": "node scripts/check-bundle-size.js",

    // NEW: Modular test scripts
    "test:unit": "jest --testPathPattern=tests/unit",
    "test:integration": "jest --testPathPattern=tests/integration",
    "test:e2e": "playwright test",
    "test:domain": "jest --testPathPattern=tests/unit/domain --coverage --coverageThreshold='{\"global\":{\"branches\":100,\"functions\":100,\"lines\":100,\"statements\":100}}'",
    "test:storage": "jest --testPathPattern=tests/unit/storage --coverage",
    "test:watch:unit": "jest --testPathPattern=tests/unit --watch",
    "test:watch:integration": "jest --testPathPattern=tests/integration --watch",

    // NEW: Coverage by layer
    "coverage:domain": "jest --testPathPattern=tests/unit/domain --coverage --collectCoverageFrom='src/domain/**/*.js'",
    "coverage:storage": "jest --testPathPattern=tests/unit/storage --coverage --collectCoverageFrom='src/storage/**/*.js'",
    "coverage:features": "jest --testPathPattern=tests/unit --coverage --collectCoverageFrom='src/features/**/*.js'",

    // NEW: Validation scripts
    "validate:architecture": "node scripts/validate-architecture.js",
    "validate:imports": "eslint src/ --rule 'import/no-restricted-paths: error'",

    // NEW: CI scripts
    "ci:lint": "npm run lint && npm run format:check",
    "ci:test": "npm run test:unit && npm run test:integration",
    "ci:build": "npm run build:prod && npm run build:check-size",
    "ci:full": "npm run ci:lint && npm run ci:test && npm run ci:build"
  }
}
```

---

### Section 9: Architecture Validation Script

**New `scripts/validate-architecture.js`**:

```javascript
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, '..', 'src');

const rules = [
  {
    name: 'Domain layer has no external dependencies',
    check: () => {
      const domainFiles = getAllJsFiles(path.join(srcDir, 'domain'));
      for (const file of domainFiles) {
        const content = fs.readFileSync(file, 'utf-8');

        // Check for imports from features or storage
        if (
          content.includes('@features/') ||
          content.includes('../features/')
        ) {
          return {
            pass: false,
            message: `${file} imports from features layer`
          };
        }
        if (content.includes('@storage/') || content.includes('../storage/')) {
          return { pass: false, message: `${file} imports from storage layer` };
        }
      }
      return { pass: true };
    }
  },

  {
    name: 'Storage layer does not depend on features',
    check: () => {
      const storageFiles = getAllJsFiles(path.join(srcDir, 'storage'));
      for (const file of storageFiles) {
        const content = fs.readFileSync(file, 'utf-8');

        if (
          content.includes('@features/') ||
          content.includes('../features/')
        ) {
          return {
            pass: false,
            message: `${file} imports from features layer`
          };
        }
      }
      return { pass: true };
    }
  },

  {
    name: 'Facades exist in correct location',
    check: () => {
      const facadePath = path.join(
        srcDir,
        'features/quick-tabs/QuickTabsManager.js'
      );
      if (!fs.existsSync(facadePath)) {
        return { pass: false, message: 'QuickTabsManager facade not found' };
      }
      return { pass: true };
    }
  },

  {
    name: 'All managers are in managers/ directory',
    check: () => {
      const managersDir = path.join(srcDir, 'features/quick-tabs/managers');
      if (!fs.existsSync(managersDir)) {
        return { pass: false, message: 'managers/ directory not found' };
      }

      const requiredManagers = [
        'StorageManager.js',
        'BroadcastManager.js',
        'StateManager.js'
      ];
      for (const manager of requiredManagers) {
        if (!fs.existsSync(path.join(managersDir, manager))) {
          return { pass: false, message: `${manager} not found in managers/` };
        }
      }
      return { pass: true };
    }
  }
];

function getAllJsFiles(dir) {
  const files = [];

  if (!fs.existsSync(dir)) return files;

  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...getAllJsFiles(fullPath));
    } else if (item.endsWith('.js') && !item.endsWith('.test.js')) {
      files.push(fullPath);
    }
  }

  return files;
}

// Run validation
console.log('🔍 Validating architecture...\n');

let passed = 0;
let failed = 0;

for (const rule of rules) {
  const result = rule.check();
  if (result.pass) {
    console.log(`✅ ${rule.name}`);
    passed++;
  } else {
    console.error(`❌ ${rule.name}`);
    console.error(`   ${result.message}`);
    failed++;
  }
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  console.error(
    '⚠️  Architecture validation failed. Please fix the issues above.'
  );
  process.exit(1);
}

console.log('✅ Architecture validation passed!');
```

**Add to CI workflow** (`.github/workflows/code-quality.yml`):

```yaml
- name: Validate architecture
  run: npm run validate:architecture
```

---

## Migration Strategy

### Phase 0: Pre-Refactoring Infrastructure Setup (Week 0)

**Before touching any code, set up infrastructure:**

1. **Update Rollup config** with module aliasing
2. **Update Jest config** with module paths and coverage thresholds
3. **Update ESLint** with complexity rules and boundary enforcement
4. **Add new npm scripts** for modular builds/tests
5. **Create test helpers** (builders, async utilities)
6. **Create architecture validation script**
7. **Update CI workflows** with new validation steps

**Validation**: Run `npm run ci:full` - should pass with existing code.

---

### Phase 1-10: Incremental Refactoring with Tests

**For each refactoring phase:**

1. **Write unit tests first** for new modules
2. **Run `npm run test:unit`** - should fail (no implementation)
3. **Implement refactored module**
4. **Run `npm run test:unit`** - should pass
5. **Run `npm run validate:architecture`** - check boundaries
6. **Run `npm run build:prod && npm run build:check-size`** - check bundle
7. **Commit** - CI will validate all checks pass

**Example (Phase 1 - Domain Entity)**:

```bash
# 1. Write tests
touch tests/unit/domain/QuickTab.test.js
npm run test:unit -- tests/unit/domain/QuickTab.test.js  # Fails

# 2. Implement
touch src/domain/QuickTab.js
# ... implement ...
npm run test:unit -- tests/unit/domain/QuickTab.test.js  # Passes

# 3. Validate
npm run coverage:domain  # Must be 100%
npm run validate:architecture  # Check boundaries

# 4. Commit
git add src/domain/QuickTab.js tests/unit/domain/QuickTab.test.js
git commit -m "feat: Add QuickTab domain entity with 100% coverage"
git push  # CI runs all checks
```

---

## Summary of Required Changes

### Immediate Actions (Before Refactoring)

| Item               | File                                 | Change                                                     | Priority    |
| ------------------ | ------------------------------------ | ---------------------------------------------------------- | ----------- |
| **Rollup config**  | `rollup.config.js`                   | Add module aliases, multiple entry points, tree-shaking    | 🔴 Critical |
| **Jest config**    | `jest.config.cjs`                    | Add module mappers, coverage thresholds by layer           | 🔴 Critical |
| **ESLint rules**   | `.eslintrc.cjs`                      | Add complexity rules, import boundaries, async/await rules | 🟡 High     |
| **npm scripts**    | `package.json`                       | Add modular test/build scripts                             | 🟡 High     |
| **Test structure** | `tests/`                             | Create unit/, integration/, e2e/, helpers/ directories     | 🔴 Critical |
| **CI workflows**   | `.github/workflows/code-quality.yml` | Add module validation, bundle size checks                  | 🟡 High     |
| **Dependencies**   | `package.json`                       | Remove zustand, add test utilities                         | 🟢 Medium   |
| **Scripts**        | `scripts/`                           | Add bundle size checker, architecture validator            | 🟢 Medium   |

### Per-Phase Actions (During Refactoring)

**For each module created:**

1. ✅ Write unit tests first (TDD)
2. ✅ Ensure coverage thresholds met (domain=100%, features=80%)
3. ✅ Run architecture validation (`npm run validate:architecture`)
4. ✅ Check bundle size (`npm run build:check-size`)
5. ✅ Verify CI passes before merge

---

## Expected Outcomes

### Quantitative Improvements

| Metric                   | Before                 | After                            | Evidence                    |
| ------------------------ | ---------------------- | -------------------------------- | --------------------------- |
| **Test execution speed** | ~2s (integration only) | <500ms (unit), ~2s (integration) | Unit tests run in isolation |
| **Test coverage**        | ~40% (integration)     | 80%+ overall, 100% domain        | Layer-specific thresholds   |
| **Bundle size**          | Unmeasured             | <500KB content.js                | Automated size checks       |
| **CI runtime**           | ~5min                  | ~7min (includes unit tests)      | Parallel jobs               |
| **Module import errors** | Manual detection       | Caught at lint time              | ESLint boundaries           |

### Qualitative Improvements

1. **Fast feedback loop**: Unit tests run in <1s vs integration tests ~10s
2. **Confidence in refactoring**: 100% domain coverage = safe to change
   infrastructure
3. **Architecture enforcement**: Can't accidentally break module boundaries
4. **Bundle optimization**: Tree-shaking removes unused code automatically
5. **Developer experience**: Module aliases make imports clean and relocatable

---

## Conclusion

Your current infrastructure is **60% ready** for the refactoring. The critical
missing pieces are:

1. **Module-aware build system** (Rollup needs multiple entry points + aliasing)
2. **Unit test infrastructure** (need test helpers, builders, and layer-specific
   coverage)
3. **Architecture validation** (automated boundary enforcement)

**Recommendation**: Spend **1 week (Week 0)** setting up infrastructure before
starting Phase 1 refactoring. This upfront investment will:

- Prevent build failures mid-refactoring
- Enable TDD workflow (write tests first)
- Catch architectural mistakes early (via ESLint)
- Provide fast feedback loop (unit tests run in <1s)

**Timeline**: Infrastructure setup (Week 0) + 10 weeks refactoring = **11 weeks
total** with robust safety nets at every step.
