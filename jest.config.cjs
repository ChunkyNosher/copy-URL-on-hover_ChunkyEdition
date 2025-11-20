module.exports = {
  // Test environment
  testEnvironment: 'jsdom',

  // Root directories for tests
  roots: ['<rootDir>/src', '<rootDir>/tests'],

  // Test file patterns
  testMatch: ['**/__tests__/**/*.js', '**/?(*.)+(spec|test).js'],

  // Exclude playwright tests (they need a different environment)
  testPathIgnorePatterns: ['/node_modules/', '/tests/extension/', '/tests/e2e/'],

  // Module aliasing (must match Rollup aliases)
  moduleNameMapper: {
    '^@domain/(.*)$': '<rootDir>/src/domain/$1',
    '^@storage/(.*)$': '<rootDir>/src/storage/$1',
    '^@features/(.*)$': '<rootDir>/src/features/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@core/(.*)$': '<rootDir>/src/core/$1',
    '^@ui/(.*)$': '<rootDir>/src/ui/$1',
    '^webextension-polyfill$': '<rootDir>/tests/__mocks__/webextension-polyfill.js'
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

    // UI - require 80% coverage
    'src/ui/**/*.js',

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
