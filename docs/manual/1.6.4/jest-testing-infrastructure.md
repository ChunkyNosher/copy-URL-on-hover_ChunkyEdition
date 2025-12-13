# Jest Testing Infrastructure: Comprehensive Fixes & Implementation Guide

**Document Version:** 1.0  
**Date:** December 13, 2025  
**Scope:** Jest unit and integration testing infrastructure for Quick Tabs
Extension v1.6.3.8  
**Target:** Proper test coverage organization, architecture-aware testing
patterns, and scalable infrastructure

---

## Table of Contents

1. [Current State Assessment](#current-state-assessment)
2. [Critical Infrastructure Gaps](#critical-infrastructure-gaps)
3. [Architecture-Aware Testing Patterns](#architecture-aware-testing-patterns)
4. [Mock Strategy & Infrastructure](#mock-strategy--infrastructure)
5. [Test Organization & Structure](#test-organization--structure)
6. [Coverage Configuration](#coverage-configuration)
7. [Test Helper Libraries](#test-helper-libraries)
8. [Integration Test Patterns](#integration-test-patterns)
9. [Implementation Roadmap](#implementation-roadmap)
10. [Reference Documentation](#reference-documentation)

---

## Current State Assessment

### Strengths

✅ **Solid Foundation:**

- Jest properly configured with JSDOM environment
- Module aliasing correctly set up for path resolution
- Coverage thresholds defined by layer (domain: 100%, storage: 90%, features:
  80%, global: 80%)
- Good baseline test setup with `requestAnimationFrame`, `PointerEvent`,
  `TextEncoder` polyfills
- Browser API mocking in place (`browser.storage`, `browser.runtime`,
  `browser.tabs`)
- Test infrastructure exists (`test-bridge.js`, handlers, page proxy)

✅ **Existing Test Coverage:**

- Domain layer well-tested (100% threshold enforced)
- QuickTab and ReactiveQuickTab domain models have comprehensive tests
- Basic test examples and fixtures available

✅ **DevDependencies Good:**

- Jest 29.7.0 (current, stable)
- Babel Jest for ES6 transpilation
- Testing Library utilities installed
- jest-extended for custom matchers
- jest-mock-extended for mock support
- sinon-chrome for browser API mocking

### Critical Gaps

❌ **Architecture Not Accounted For:**

- No tests for new managers (QuickTabGroupManager, MemoryMonitor,
  PerformanceMetrics)
- No tests for transaction manager (map-transaction-manager.js)
- No tests for minimized-manager.js (separate state management)
- No coordinator/channel pattern tests
- Handlers directory untested
- Guards directory untested
- Schemas directory untested

❌ **Test Infrastructure Missing:**

- No comprehensive mock factory for managers
- No cross-tab state simulator
- No port communication simulator
- No storage persistence helper
- No state machine test utilities
- No coordinator test helpers

❌ **Integration Test Infrastructure Absent:**

- No manager-to-manager interaction tests
- No cross-component message flow tests
- No event coordination tests
- No storage consistency tests

❌ **Coverage Gaps:**

- Background script (370KB) likely <10% covered
- Window.js (53KB) likely partially covered
- Sidebar components untested
- UI layer incomplete

---

## Critical Infrastructure Gaps

### Gap 1: No Manager Mock Factory

**Problem:** Managers (QuickTabGroupManager, MemoryMonitor, PerformanceMetrics,
map-transaction-manager) have complex initialization and state. Each test that
needs a manager must manually construct mocks.

**Impact:**

- Test code is repetitive and error-prone
- Managers have interdependencies not easily testable
- State consistency not validated across manager interactions

**Solution Needed:** Create a manager mock factory that:

- Provides pre-configured mock managers with sane defaults
- Maintains manager interdependencies
- Supports partial mocking (mock some methods, real others)
- Provides helper methods to verify manager state

**File to Create:** `tests/helpers/manager-factory.js`

**Implementation Pattern:**

```javascript
// Should export factory functions like:
// - createMockMemoryMonitor(overrides)
// - createMockPerformanceMetrics(overrides)
// - createMockQuickTabGroupManager(overrides)
// - createMockTransactionManager(overrides)
// - createMockMinimizedManager(overrides)
// Each returns a Jest mock with:
//   - All methods mocked by default
//   - Method call tracking setup
//   - State getter/setter helpers
```

---

### Gap 2: No Cross-Tab State Simulator

**Problem:** Quick Tabs operate across multiple tabs with shared storage. Unit
tests can't verify:

- Storage consistency across originTabId boundaries
- Hydration filtering (loading only relevant Quick Tabs per tab)
- Cross-tab message synchronization
- Tab closure cleanup

**Impact:**

- Scenario 11 (Hydration on Page Reload) can't be tested properly
- Scenario 12 (Tab Closure State Management) untestable in isolation
- Cross-tab sync behavior verification missing

**Solution Needed:** Create a cross-tab state simulator that:

- Simulates multiple browser tabs in a single test
- Manages separate storage per tab (by originTabId)
- Tracks message passing between tabs
- Verifies hydration filtering logic
- Validates storage consistency

**File to Create:** `tests/helpers/cross-tab-simulator.js`

**Implementation Pattern:**

```javascript
// Should export a class like:
class CrossTabSimulator {
  // Methods needed:
  // - createTab(tabId, domain)
  // - getTabStorage(tabId)
  // - getGlobalStorage()
  // - simulateTabClose(tabId)
  // - simulateNavigate(tabId, newDomain)
  // - getStorageByOriginTabId(originTabId)
  // - verifyHydration(tabId, expectedQTCount)
  // - simulatePortMessage(fromTab, toTab, message)
}
```

---

### Gap 3: No Port Communication Test Helper

**Problem:** Handlers communicate via Chrome `runtime.connect` ports. Tests need
to:

- Simulate port connections
- Mock port lifecycle (connect, disconnect)
- Track port messages
- Simulate connection failures and reconnects
- Test circuit breaker logic

**Impact:**

- Handler port communication untestable
- Reconnection/error recovery logic can't be validated
- Message formatting/parsing errors not caught in tests

**Solution Needed:** Create a port communication simulator that:

- Mocks Chrome port API
- Tracks all messages sent/received
- Allows simulating connection failures
- Validates message format compliance
- Supports reconnection scenarios

**File to Create:** `tests/helpers/port-simulator.js`

**Implementation Pattern:**

```javascript
// Should export a class/object like:
class PortSimulator {
  // Methods needed:
  // - createPort(name, handler)
  // - simulateConnect(portName)
  // - simulateDisconnect(portName)
  // - simulateMessage(portName, message)
  // - simulateError(portName, error)
  // - getPortHistory(portName)
  // - verifyMessageFormat(portName, expectedSchema)
  // - simulateConnectionTimeout(portName)
}
```

---

### Gap 4: No State Machine Test Utilities

**Problem:** `state-machine.js` (13KB) manages Quick Tab state transitions.
Tests need:

- Verify all valid transitions
- Catch invalid transitions
- Test guard conditions
- Validate action execution on transitions
- Track state change history

**Impact:**

- State transition logic bugs not caught
- Invalid state transitions allowed
- Guard conditions not verified
- Scenario 5 (minimize) and Scenario 19 (minimize/restore cycle) incomplete

**Solution Needed:** Create state machine test utilities that:

- Provide assertions for state transitions
- Track transition history
- Support transition guards verification
- Generate transition tables for documentation
- Validate state invariants

**File to Create:** `tests/helpers/state-machine-utils.js`

**Implementation Pattern:**

```javascript
// Should export utilities like:
// - assertValidTransition(machine, fromState, toState, action)
// - assertInvalidTransition(machine, fromState, toState, action)
// - getTransitionHistory(machine)
// - verifyGuardCondition(machine, state, condition)
// - generateTransitionTable(machine) // for documentation
// - createStateMachineRecorder(machine) // tracks all transitions
```

---

### Gap 5: No Storage Persistence Helper

**Problem:** Storage operations are async and must be tested for:

- Checksum validation
- Key format/versioning
- originTabId filtering
- Cleanup on tab closure
- Storage quota handling

**Impact:**

- Storage consistency bugs in production
- Scenario 11 (hydration filtering) incomplete
- Scenario 12 (tab closure cleanup) incomplete
- Migration bugs between storage versions

**Solution Needed:** Create storage test helper that:

- Mocks browser.storage with full tracking
- Validates storage key formats
- Checks originTabId filtering
- Verifies checksum validation
- Simulates quota constraints

**File to Create:** `tests/helpers/storage-test-helper.js`

**Implementation Pattern:**

```javascript
// Should export utilities/class like:
class StorageTestHelper {
  // Methods needed:
  // - getStorageSnapshot()
  // - verifyKeyFormat(key, expectedPattern)
  // - getByOriginTabId(originTabId)
  // - verifyChecksum(key, expectedChecksum)
  // - simulateQuotaExceeded()
  // - getPersistenceHistory()
  // - assertStorageConsistency()
  // - simulateVersionMigration(fromVersion, toVersion)
}
```

---

### Gap 6: No Coordinator Test Utilities

**Problem:** Coordinators orchestrate complex multi-step operations (create,
update, destroy). Tests need:

- Verify operation sequencing
- Check error handling/rollback
- Validate event emission
- Test lifecycle hooks

**Impact:**

- Coordinator orchestration bugs not caught
- Operation sequencing errors silent
- Rollback logic untested
- Event firing inconsistencies missed

**Solution Needed:** Create coordinator test utilities that:

- Mock subordinate components
- Track operation sequence
- Verify event emission
- Support operation recording/playback

**File to Create:** `tests/helpers/coordinator-utils.js`

**Implementation Pattern:**

```javascript
// Should export utilities like:
// - createCoordinatorTestBed(coordinator, dependencies)
// - recordCoordinatorOperation(coordinator, operation)
// - verifyOperationSequence(recorded, expected)
// - assertEventFired(coordinator, eventName, args)
// - simulateComponentError(coordinator, componentName, error)
```

---

### Gap 7: No Mock Setup Reset Pattern

**Problem:** Tests share mock setup but don't properly reset between tests.
Current `jest.config.cjs` has:

```javascript
clearMocks: true,
resetMocks: true,
restoreMocks: true,
```

But this doesn't handle:

- Storage state between tests
- Port simulator state
- Cross-tab simulator state
- Manager mock state
- Event listener registration

**Impact:**

- Test pollution and false failures
- Flaky tests depending on execution order
- State leakage between test suites

**Solution Needed:** Create a test setup/teardown pattern that:

- Resets all helpers before each test
- Clears all global mocks
- Restores original implementations
- Validates clean state at start of each test

**Implementation Pattern:**

```javascript
// In tests/setup.js, add:
// - Helper registration and tracking
// - beforeEach hook to reset all helpers
// - afterEach hook to validate clean state
// - Custom Jest reporter to detect pollution
```

---

## Architecture-Aware Testing Patterns

### Pattern 1: Manager Testing Pattern

**Current Problem:** No standard way to test managers

**New Pattern:**

Managers are state-holding components with methods that modify state. Tests
should:

1. **Separate Unit Tests (tests/unit/managers/)**
   - Test each manager in isolation
   - Mock dependencies
   - Verify internal state management
   - Focus on single manager responsibility

2. **Integration Tests (tests/integration/manager-interactions/)**
   - Test manager-to-manager communication
   - Verify event flow between managers
   - Check state consistency across managers
   - Test shared state access

**Example Test Structure:**

```javascript
// tests/unit/managers/MemoryMonitor.test.js
describe('MemoryMonitor', () => {
  let monitor;

  beforeEach(() => {
    monitor = new MemoryMonitor();
  });

  describe('Threshold Tracking', () => {
    it('should track memory usage');
    it('should emit warning below threshold');
    it('should emit critical above threshold');
  });

  describe('Cleanup Triggers', () => {
    it('should trigger cleanup on high memory');
  });
});

// tests/integration/manager-interactions/memory-group-sync.test.js
describe('MemoryMonitor + QuickTabGroupManager Interaction', () => {
  let memoryMonitor;
  let groupManager;

  beforeEach(() => {
    memoryMonitor = createMockMemoryMonitor();
    groupManager = createMockQuickTabGroupManager();
  });

  it('should coordinate cleanup on memory threshold');
});
```

---

### Pattern 2: Handler Testing Pattern

**Current Problem:** Handlers coordinate complex cross-tab operations

**New Pattern:**

Handlers test should cover:

1. **Message Reception & Parsing**
   - Validate message format
   - Test error handling for malformed messages
   - Verify message routing

2. **Operation Execution**
   - Mock underlying managers
   - Verify operation parameters
   - Check state changes
   - Test error recovery

3. **Response Sending**
   - Verify response format
   - Test acknowledgment handling
   - Check error responses

**Example Test Structure:**

```javascript
// tests/unit/handlers/CreateQuickTabHandler.test.js
describe('CreateQuickTabHandler', () => {
  let handler;
  let mockPort;
  let mockStorage;
  let mockManagers;

  beforeEach(() => {
    mockManagers = {
      quickTabGroupManager: createMockQuickTabGroupManager(),
      memoryMonitor: createMockMemoryMonitor()
    };
    handler = new CreateQuickTabHandler(mockManagers);
  });

  describe('Message Reception', () => {
    it('should parse create message');
    it('should reject invalid message format');
  });

  describe('Operation Execution', () => {
    it('should create Quick Tab with correct parameters');
    it('should check memory limits before creation');
    it('should update group manager on success');
  });

  describe('Error Handling', () => {
    it('should handle memory exceeded error');
    it('should handle storage error');
    it('should send error response');
  });
});
```

---

### Pattern 3: State Machine Testing Pattern

**Current Problem:** State transitions not systematically tested

**New Pattern:**

State machine tests should:

1. **Verify All Transitions**
   - Test each valid transition
   - Reject each invalid transition
   - Use transition table for documentation

2. **Guard Conditions**
   - Test guards prevent invalid transitions
   - Verify guard error messages
   - Test guard async operations

3. **Action Execution**
   - Verify actions run on transition
   - Test action error handling
   - Check rollback on action failure

**Example Test Structure:**

```javascript
// tests/unit/state-machine/QuickTabStateMachine.test.js
const VALID_TRANSITIONS = [
  { from: 'UNKNOWN', to: 'VISIBLE', action: 'create' },
  { from: 'VISIBLE', to: 'MINIMIZED', action: 'minimize' },
  { from: 'MINIMIZED', to: 'VISIBLE', action: 'restore' }
  // ... all valid transitions
];

const INVALID_TRANSITIONS = [
  { from: 'MINIMIZED', to: 'MINIMIZED', action: 'minimize' },
  { from: 'VISIBLE', to: 'UNKNOWN', action: 'unknown' }
  // ... all invalid transitions
];

describe('QuickTabStateMachine', () => {
  describe('Valid Transitions', () => {
    VALID_TRANSITIONS.forEach(({ from, to, action }) => {
      it(`should transition ${from} -> ${to} on ${action}`, () => {
        // test implementation
      });
    });
  });

  describe('Invalid Transitions', () => {
    INVALID_TRANSITIONS.forEach(({ from, to, action }) => {
      it(`should reject ${from} -> ${to} on ${action}`, () => {
        // test implementation
      });
    });
  });
});
```

---

### Pattern 4: Storage Layer Testing Pattern

**Current Problem:** Storage tests don't validate architecture constraints

**New Pattern:**

Storage tests should verify:

1. **Key Format & Versioning**
   - Keys follow naming convention
   - Version prefix present
   - Backward compatibility maintained

2. **OriginTabId Filtering**
   - Only relevant Quick Tabs loaded per tab
   - Cross-tab contamination prevented
   - Hydration filtering works correctly

3. **Consistency & Atomicity**
   - Multi-key operations atomic
   - Checksum validation
   - Recovery from partial failures

**Example Test Structure:**

```javascript
// tests/unit/storage/QuickTabStorage.test.js
describe('QuickTabStorage', () => {
  let storage;
  let storageHelper;

  beforeEach(() => {
    storage = new QuickTabStorage();
    storageHelper = new StorageTestHelper();
  });

  describe('Key Format', () => {
    it('should use correct key format with version');
    it('should include originTabId in key');
    it('should support key migration');
  });

  describe('OriginTabId Filtering', () => {
    it('should load only Quick Tabs for current tab');
    it('should filter out other tabs Quick Tabs');
    it('should handle container-scoped originTabIds');
  });

  describe('Checksum Validation', () => {
    it('should generate checksum on write');
    it('should validate checksum on read');
    it('should handle checksum mismatch');
  });
});
```

---

## Mock Strategy & Infrastructure

### Mock Hierarchy

Tests use mocks at different levels. Establish clear hierarchy:

1. **Level 1: Browser API Mocks** (tests/setup.js)
   - Already exists: `browser.storage`, `browser.runtime`, `browser.tabs`
   - Coverage: Basic Chrome extension APIs
   - Scope: Global, used by all tests
   - Status: ✅ Exists, needs enhancement

2. **Level 2: Feature-Specific Mocks** (tests/**mocks**/)
   - Purpose: Mock entire feature modules
   - Example: Mock webext-storage-cache behavior
   - Scope: Used when feature not under test
   - Status: ⚠️ Partial, needs completion

3. **Level 3: Helper-Created Mocks** (tests/helpers/)
   - Purpose: Factory functions for test-specific mocks
   - Example: `createMockMemoryMonitor()`
   - Scope: Test-local, created per test
   - Status: ❌ Missing, CRITICAL

**Required Mock Factories:**

| Mock Type           | Location                               | Priority | Status     |
| ------------------- | -------------------------------------- | -------- | ---------- |
| Manager Mocks       | `tests/helpers/manager-factory.js`     | CRITICAL | ❌ Missing |
| Port Simulator      | `tests/helpers/port-simulator.js`      | CRITICAL | ❌ Missing |
| Storage Helper      | `tests/helpers/storage-test-helper.js` | CRITICAL | ❌ Missing |
| Cross-Tab Simulator | `tests/helpers/cross-tab-simulator.js` | HIGH     | ❌ Missing |
| State Machine Utils | `tests/helpers/state-machine-utils.js` | HIGH     | ❌ Missing |
| Coordinator Utils   | `tests/helpers/coordinator-utils.js`   | HIGH     | ❌ Missing |
| Event Tracker       | `tests/helpers/event-tracker.js`       | MEDIUM   | ❌ Missing |
| Timer Mocks         | `tests/helpers/timer-mocks.js`         | MEDIUM   | ⚠️ Partial |

---

### Mock Anti-Patterns to Avoid

❌ **Anti-Pattern 1: Over-Mocking**

```javascript
// DON'T: Mock everything, even the code under test
jest.mock('./QuickTab.js');
const QuickTab = require('./QuickTab.js');
// This defeats the purpose of testing
```

✅ **CORRECT: Mock only dependencies**

```javascript
jest.mock('./storage.js');
const QuickTab = require('./QuickTab.js');
// Storage is mocked, QuickTab is tested
```

---

❌ **Anti-Pattern 2: Fragile Mocks**

```javascript
// DON'T: Tightly couple to implementation details
jest.mock('./internal-helper.js', () => ({
  __internalMethod: jest.fn()
}));
```

✅ **CORRECT: Mock public API**

```javascript
jest.mock('./API.js', () => ({
  publicMethod: jest.fn().mockResolvedValue({ success: true })
}));
```

---

❌ **Anti-Pattern 3: Mock State Leakage**

```javascript
// DON'T: Reuse mock state across tests
const mockStorage = jest.fn();

describe('Tests', () => {
  test('1', () => mockStorage.mockReturnValue(data));
  test('2', () => {
    /* uses same mock! */
  });
});
```

✅ **CORRECT: Fresh mocks per test**

```javascript
describe('Tests', () => {
  let mockStorage;

  beforeEach(() => {
    mockStorage = jest.fn();
  });

  test('1', () => mockStorage.mockReturnValue(data));
  test('2', () => {
    /* fresh mock */
  });
});
```

---

## Test Organization & Structure

### Directory Structure (Current vs. Needed)

```
tests/
├── __mocks__/                    # Global mocks (currently light)
│   ├── webextension-polyfill.js  # ✅ Exists
│   ├── storage-utils.js          # ✅ Exists
│   ├── broadcast-channel.js      # ⚠️ Partial
│   └── [MORE NEEDED]             # ❌ Missing
│
├── helpers/                      # Test utilities (NEEDS CREATION)
│   ├── manager-factory.js        # ❌ CRITICAL
│   ├── port-simulator.js         # ❌ CRITICAL
│   ├── storage-test-helper.js    # ❌ CRITICAL
│   ├── cross-tab-simulator.js    # ❌ HIGH
│   ├── state-machine-utils.js    # ❌ HIGH
│   ├── coordinator-utils.js      # ❌ HIGH
│   ├── event-tracker.js          # ❌ HIGH
│   ├── timer-mocks.js            # ✅ Partial
│   └── test-fixtures.js          # ⚠️ Partial
│
├── fixtures/                     # Test data (currently light)
│   ├── quick-tabs.fixture.js     # ⚠️ Needs expansion
│   ├── storage.fixture.js        # ❌ Missing
│   ├── messages.fixture.js       # ❌ Missing
│   └── managers.fixture.js       # ❌ Missing
│
├── unit/                         # Unit tests (INCOMPLETE)
│   ├── domain/                   # ✅ Good coverage (100%)
│   ├── storage/                  # ⚠️ Basic coverage
│   ├── handlers/                 # ❌ CRITICAL GAP
│   ├── managers/                 # ❌ CRITICAL GAP
│   ├── coordinators/             # ❌ CRITICAL GAP
│   ├── guards/                   # ❌ CRITICAL GAP
│   ├── schemas/                  # ❌ CRITICAL GAP
│   ├── state-machine/            # ⚠️ Basic coverage
│   ├── minimized/                # ⚠️ Basic coverage
│   ├── map-transaction/          # ❌ CRITICAL GAP
│   ├── window/                   # ⚠️ Incomplete
│   ├── sidebar/                  # ⚠️ Incomplete
│   ├── notifications/            # ⚠️ Incomplete
│   ├── url-handlers/             # ⚠️ Incomplete
│   └── utils/                    # ✅ Fair coverage
│
├── integration/                  # Integration tests (MISSING)
│   ├── manager-interactions/     # ❌ Missing entirely
│   ├── handler-storage/          # ❌ Missing entirely
│   ├── cross-tab-sync/           # ❌ Missing entirely
│   └── scenario-validation/      # ❌ Missing entirely
│
├── setup.js                      # ✅ Exists (good)
├── example.test.js               # ✅ Reference tests
└── quick-tabs-creation.test.js   # ✅ Reference tests
```

---

### Module-Specific Test Structure

Each major module should have:

```
tests/unit/[module-name]/
├── [Module].test.js              # Main functionality tests
├── [Module]-edge-cases.test.js    # Edge cases & boundaries
├── [Module]-errors.test.js        # Error handling & recovery
├── __mocks__/                     # Module-specific mocks
│   └── [Dependency].js
└── fixtures/                      # Test data for this module
    └── [module-name].fixture.js
```

---

## Coverage Configuration

### Current Coverage Configuration (jest.config.cjs)

**Current Thresholds:**

```javascript
coverageThreshold: {
  './src/domain/': { branches: 100, functions: 100, lines: 100, statements: 100 },
  './src/storage/': { branches: 85, functions: 90, lines: 90, statements: 90 },
  './src/features/': { branches: 75, functions: 80, lines: 80, statements: 80 },
  global: { branches: 80, functions: 80, lines: 80, statements: 80 }
}
```

### Enhanced Coverage Configuration (Recommended)

**Refinement 1: Granular Feature Thresholds**

Different features have different criticality:

```javascript
coverageThreshold: {
  // Tier 1: Perfect coverage (domain logic, state machines)
  './src/domain/': { branches: 100, functions: 100, lines: 100, statements: 100 },
  './src/features/quick-tabs/state-machine.js': { branches: 95, functions: 95, lines: 95, statements: 95 },
  './src/features/quick-tabs/map-transaction-manager.js': { branches: 90, functions: 90, lines: 90, statements: 90 },

  // Tier 2: High coverage (managers, handlers, coordinators)
  './src/features/quick-tabs/managers/': { branches: 85, functions: 85, lines: 85, statements: 85 },
  './src/features/quick-tabs/handlers/': { branches: 85, functions: 85, lines: 85, statements: 85 },
  './src/features/quick-tabs/coordinators/': { branches: 85, functions: 85, lines: 85, statements: 85 },
  './src/storage/': { branches: 85, functions: 90, lines: 90, statements: 90 },

  // Tier 3: Good coverage (UI, utilities)
  './src/features/quick-tabs/window/': { branches: 75, functions: 80, lines: 80, statements: 80 },
  './src/ui/': { branches: 75, functions: 80, lines: 80, statements: 80 },
  './src/utils/': { branches: 80, functions: 85, lines: 85, statements: 85 },

  // Tier 4: Baseline coverage (content, notifications)
  './src/features/notifications/': { branches: 70, functions: 75, lines: 75, statements: 75 },

  global: { branches: 78, functions: 80, lines: 80, statements: 80 }
}
```

**Refinement 2: Collect Coverage From Architecture Layers**

```javascript
collectCoverageFrom: [
  // Core domain and logic
  'src/domain/**/*.js',
  'src/core/**/*.js',

  // Storage layer
  'src/storage/**/*.js',

  // Feature implementations (critical)
  'src/features/quick-tabs/state-machine.js',
  'src/features/quick-tabs/map-transaction-manager.js',
  'src/features/quick-tabs/managers/**/*.js',
  'src/features/quick-tabs/handlers/**/*.js',
  'src/features/quick-tabs/coordinators/**/*.js',
  'src/features/quick-tabs/guards/**/*.js',
  'src/features/quick-tabs/schemas/**/*.js',
  'src/features/quick-tabs/minimized-manager.js',
  'src/features/quick-tabs/QuickTabGroupManager.js',
  'src/features/quick-tabs/MemoryMonitor.js',
  'src/features/quick-tabs/PerformanceMetrics.js',

  // Feature support
  'src/features/quick-tabs/storage/**/*.js',
  'src/features/quick-tabs/channels/**/*.js',
  'src/features/quick-tabs/window.js',
  'src/features/notifications/**/*.js',
  'src/features/url-handlers/**/*.js',

  // UI and utilities
  'src/ui/**/*.js',
  'src/utils/**/*.js',

  // Exclusions
  '!src/**/*.test.js',
  '!src/**/*.spec.js',
  '!src/**/__tests__/**',
  '!src/**/__mocks__/**',
  '!**/node_modules/**',
  '!**/dist/**'
];
```

**Refinement 3: Coverage Reporting**

```javascript
coverageReporters: [
  'text', // Console output
  'text-summary', // Summary in console
  'lcov', // For CI/CD tools
  'html', // Human-readable HTML
  'json', // Machine-readable
  'cobertura' // XML for CI tools
];
```

---

## Test Helper Libraries

### Helper 1: Manager Factory (CRITICAL)

**File:** `tests/helpers/manager-factory.js`

**Purpose:** Provide consistent mocks for all manager classes

**Exports:**

- `createMockMemoryMonitor(overrides)`
- `createMockPerformanceMetrics(overrides)`
- `createMockQuickTabGroupManager(overrides)`
- `createMockTransactionManager(overrides)`
- `createMockMinimizedManager(overrides)`

**Key Methods to Mock:**

- State getters (all public state accessors)
- Event emitters (on, off, emit)
- Operation methods (create, update, destroy)
- Query methods (get, find, filter)

**Validation Helpers:**

- `getManagerCallHistory(manager)` - Track all calls
- `assertManagerStateConsistent(manager)` - Verify internal consistency
- `resetManagerMock(manager)` - Clean state between tests

---

### Helper 2: Port Simulator

**File:** `tests/helpers/port-simulator.js`

**Purpose:** Simulate Chrome port API for handler testing

**Exports:**

- `createPortSimulator()`
- Returns object with methods:
  - `createPort(name, initialHandler)` - Create mock port
  - `connectPort(name)` - Simulate connection
  - `disconnectPort(name)` - Simulate disconnection
  - `sendMessage(portName, message)` - Simulate message
  - `simulateError(portName, error)` - Simulate port error
  - `getPortHistory(portName)` - Get all messages sent/received
  - `resetPort(portName)` - Clear port state

**Features:**

- Automatic message ID tracking
- Message format validation (by schema)
- Connection state tracking
- Error recovery simulation

---

### Helper 3: Storage Test Helper

**File:** `tests/helpers/storage-test-helper.js`

**Purpose:** Validate storage operations and consistency

**Exports:**

- `createStorageTestHelper()`
- Returns object with methods:
  - `getSnapshot()` - Current storage state
  - `getByOriginTabId(tabId)` - Quick Tabs for specific tab
  - `verifyKeyFormat(key)` - Validate key naming
  - `verifyChecksum(key, data)` - Validate checksum
  - `simulateQuotaExceeded()` - Trigger quota error
  - `assertConsistency()` - Validate all constraints
  - `getChangeHistory()` - Track all storage changes

**Key Validations:**

- Key format: `quick_tabs_state_v2:originTabId:quickTabId`
- Checksum validation
- OriginTabId filtering
- Storage cleanup on tab close

---

### Helper 4: Cross-Tab Simulator

**File:** `tests/helpers/cross-tab-simulator.js`

**Purpose:** Simulate multiple browser tabs in single test

**Exports:**

- `createCrossTabSimulator()`
- Returns object with methods:
  - `createTab(tabId, domain, container)` - Create simulated tab
  - `getTabStorage(tabId)` - Get storage for tab
  - `simulateNavigation(tabId, newDomain)` - Change tab domain
  - `closeTab(tabId)` - Simulate tab close
  - `sendPortMessage(fromTab, toTab, message)` - Cross-tab message
  - `getGlobalStorage()` - Access all storage
  - `verifyIsolation()` - Verify tab isolation

**Features:**

- Separate storage per originTabId
- Container-aware filtering
- Message routing between tabs
- Automatic cleanup on tab close

---

### Helper 5: State Machine Utils

**File:** `tests/helpers/state-machine-utils.js`

**Purpose:** Testing utilities for finite state machines

**Exports:**

- `assertValidTransition(machine, from, to, action)` - Verify transition
- `assertInvalidTransition(machine, from, to, action)` - Verify rejection
- `recordTransitions(machine)` - Track all transitions
- `getTransitionHistory(recorder)` - Access history
- `verifyGuardCondition(machine, state, guard)` - Test guards
- `generateTransitionTable(machine)` - Create documentation

---

### Helper 6: Coordinator Utils

**File:** `tests/helpers/coordinator-utils.js`

**Purpose:** Test coordination between components

**Exports:**

- `createCoordinatorTestBed(coordinator, dependencies)` - Set up test
- `recordOperation(testBed, operation)` - Execute operation
- `verifySequence(recorded, expected)` - Verify order
- `assertEventFired(testBed, event, args)` - Check events
- `simulateComponentError(testBed, component, error)` - Inject error
- `getOperationLog()` - Access all operations

---

## Integration Test Patterns

### Integration Test 1: Manager-to-Manager Interaction

**Location:** `tests/integration/manager-interactions/`

**Pattern:**

1. Create multiple real (not mocked) managers
2. Set up event listeners between them
3. Execute operation on one manager
4. Verify state changes in other managers
5. Validate no data loss or inconsistency

**Example Suite:**

```javascript
// Tests for:
// - Memory threshold triggers group cleanup
// - Group manager updates on Quick Tab creation
// - Transaction manager maintains consistency during concurrent operations
// - Minimized manager state syncs with group manager
```

---

### Integration Test 2: Handler-Storage-Manager Coordination

**Location:** `tests/integration/handler-storage/`

**Pattern:**

1. Create real handler with mocked port
2. Send message to handler
3. Verify storage updated correctly
4. Verify managers notified of change
5. Simulate error scenarios

**Example Suite:**

```javascript
// Tests for:
// - CreateHandler creates Quick Tab, updates storage, notifies managers
// - DestroyHandler cleans up storage, updates groups
// - UpdateHandler maintains storage consistency during concurrent updates
// - Error in storage doesn't leave manager state inconsistent
```

---

### Integration Test 3: Cross-Tab Synchronization

**Location:** `tests/integration/cross-tab-sync/`

**Pattern:**

1. Create multiple simulated tabs
2. Create Quick Tab in tab 1
3. Verify NOT visible in tab 2
4. Verify hydration filters correctly on reload
5. Close tab 1, verify cleanup

**Example Suite:**

```javascript
// Tests for Scenarios:
// - Scenario 1: Tab Isolation
// - Scenario 11: Hydration Filtering
// - Scenario 12: Tab Closure Cleanup
// - Scenario 13: Position/Size Per-Tab Persistence
// - Scenario 14: Container Isolation
```

---

## Implementation Roadmap

### Phase 1: Critical Infrastructure (Week 1)

**Priority: BLOCKING for proper testing to proceed**

Create essential helpers:

1. ✅ Manager mock factory (`tests/helpers/manager-factory.js`)
2. ✅ Port simulator (`tests/helpers/port-simulator.js`)
3. ✅ Storage test helper (`tests/helpers/storage-test-helper.js`)

Expected Effort: 8-12 hours

**Validation:**

- Each helper has 100% test coverage
- Factory creates valid mocks matching real interfaces
- Simulators pass validation tests

---

### Phase 2: Architecture Tests (Week 2)

**Priority: HIGH - Close major coverage gaps**

Create unit tests for architectural components:

1. ✅ Handlers (`tests/unit/handlers/`)
2. ✅ Managers (`tests/unit/managers/`)
3. ✅ Coordinators (`tests/unit/coordinators/`)
4. ✅ State Machine (`tests/unit/state-machine/`)
5. ✅ Storage (`tests/unit/storage/`)

Expected Effort: 20-30 hours

**Coverage Targets:**

- Handlers: 85% branches
- Managers: 85% branches
- Coordinators: 85% branches
- State Machine: 95% branches
- Storage: 85% branches

---

### Phase 3: Integration Tests (Week 3)

**Priority: MEDIUM - Validate component interactions**

Create integration tests:

1. ✅ Manager interactions (`tests/integration/manager-interactions/`)
2. ✅ Handler-storage coordination (`tests/integration/handler-storage/`)
3. ✅ Cross-tab sync (`tests/integration/cross-tab-sync/`)
4. ✅ Scenario validation (`tests/integration/scenario-validation/`)

Expected Effort: 25-35 hours

**Coverage:**

- Each scenario mapped to integration test
- Manager interactions validated
- Storage consistency verified

---

### Phase 4: UI/End-to-End (Week 4)

**Priority: MEDIUM - Coverage of presentation layer**

Complete UI test coverage:

1. ✅ Window tests (`tests/unit/window/`)
2. ✅ Sidebar tests (`tests/unit/sidebar/`)
3. ✅ Notification tests (`tests/unit/notifications/`)

Expected Effort: 20-30 hours

**Coverage Targets:**

- Window: 80% branches
- Sidebar: 80% branches
- Notifications: 75% branches

---

### Phase 5: Background Script Tests (Week 5)

**Priority: HIGH - 370KB monolith needs coverage**

Background script testing strategy:

1. ✅ Analyze current structure (`src/background/`)
2. ✅ Identify testable units
3. ✅ Create unit tests for each unit
4. ✅ Integration tests for background → content communication

Expected Effort: 30-40 hours

**Coverage Target:** 70% branches

---

### Phase 6: Coverage Enforcement (Week 6)

**Priority: MEDIUM - Make standards stick**

Setup automated coverage checking:

1. ✅ CI/CD integration
2. ✅ Pre-commit hooks
3. ✅ Coverage badges
4. ✅ Report generation

Expected Effort: 8-12 hours

---

## Reference Documentation

### Jest Configuration Best Practices

**1. Module Resolution**

```javascript
moduleNameMapper: {
  '^@domain/(.*)$': '<rootDir>/src/domain/$1',
  // Aliases must match Rollup aliases exactly
}
```

**2. Transform Configuration**

```javascript
transformIgnorePatterns: [
  'node_modules/(?!(lodash-es|uuid|eventemitter3)/)'
  // Only transform ES6 modules that need it
];
```

**3. Coverage Collection**

```javascript
collectCoverageFrom: [
  'src/**/*.js',
  '!src/**/*.test.js',
  '!src/**/__mocks__/**'
];
```

---

### Mock Best Practices

**1. Mock Only Dependencies**

```javascript
// Test the code under test, mock its dependencies
jest.mock('./dependency.js');
const codeUnderTest = require('./code-under-test.js');
```

**2. Use jest-mock-extended for Complex Mocks**

```javascript
import { createMock } from 'jest-mock-extended';

const mockManager =
  createMock <
  Manager >
  {
    method: jest.fn().mockResolvedValue(value)
  };
```

**3. Reset Mocks Between Tests**

```javascript
beforeEach(() => {
  jest.clearAllMocks();
});
```

---

### Test Structure Best Practices

**1. Arrange-Act-Assert Pattern**

```javascript
describe('Feature', () => {
  it('should do X', () => {
    // Arrange
    const input = setupTestData();

    // Act
    const result = functionUnderTest(input);

    // Assert
    expect(result).toBe(expectedValue);
  });
});
```

**2. Descriptive Test Names**

```javascript
// ❌ Bad
it('works', () => {});

// ✅ Good
it('should throw error if password is less than 8 characters', () => {});
```

**3. Single Responsibility Per Test**

```javascript
// ❌ Bad: Tests multiple behaviors
it('should handle create and update', () => {});

// ✅ Good: Single behavior per test
it('should create Quick Tab with default position', () => {});
it('should update Quick Tab position on drag', () => {});
```

---

### Coverage Analysis

**Understanding Coverage Metrics:**

- **Statements:** % of code statements executed
- **Branches:** % of conditional branches executed
- **Functions:** % of function definitions executed
- **Lines:** % of lines with code executed

**Strategy:**

- 100% statement coverage ≠ 100% bug coverage
- Focus on critical paths and error scenarios
- High branch coverage catches edge cases
- 80% is typically "good" for most projects

---

### Debugging Tests

**1. Run Single Test**

```bash
npm test -- --testNamePattern="test name"
npm test -- --testPathPattern="path/to/test"
```

**2. Watch Mode**

```bash
npm test -- --watch
```

**3. Debug in VS Code**

```json
{
  "type": "node",
  "request": "launch",
  "program": "${workspaceFolder}/node_modules/.bin/jest",
  "args": ["--runInBand"],
  "console": "integratedTerminal"
}
```

**4. Verbose Output**

```bash
npm test -- --verbose
```

---

### Coverage Reporting

**Generate HTML Report:**

```bash
npm run test:coverage
# Open coverage/lcov-report/index.html in browser
```

**Key Insights from Report:**

- Red lines: Not executed
- Yellow lines: Partially executed (branches)
- Green lines: Fully executed

---

## Conclusion

The extension's testing infrastructure requires significant development to match
the architectural sophistication of the codebase. The recommended implementation
roadmap addresses critical gaps systematically, prioritizing infrastructure that
unblocks testing the complex new architecture (managers, coordinators, handlers,
state machines).

Following this guide will result in:

✅ Proper mocking strategy matching architecture ✅ Systematic coverage of all
components ✅ Integration tests validating cross-component interaction ✅
Maintainable test infrastructure ✅ Sustainable coverage standards ✅ Fast test
execution (<5 seconds for unit tests)

**Total Estimated Effort:** 100-150 hours (3-4 weeks at full-time)

**Expected Coverage:** Domain 100%, Features 80%, Global 80%

**Result:** Production-ready test infrastructure supporting feature development
and refactoring with confidence.
