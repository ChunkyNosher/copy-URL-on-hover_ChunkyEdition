module.exports = {
  // Test environment
  testEnvironment: 'jsdom',

  // Root directories for tests
  roots: ['<rootDir>/src', '<rootDir>/tests'],

  // Test file patterns
  testMatch: ['**/__tests__/**/*.js', '**/?(*.)+(spec|test).js'],

  // Exclude playwright tests (they need a different environment)
  testPathIgnorePatterns: ['/node_modules/', '/tests/extension/', '/tests/e2e/'],

  // Module aliasing (must match Vite aliases)
  moduleNameMapper: {
    '^@domain/(.*)$': '<rootDir>/src/domain/$1',
    '^@features/(.*)$': '<rootDir>/src/features/$1',
    // Mock storage-utils.js to prevent actual storage operations in tests
    '^@utils/storage-utils.js$': '<rootDir>/tests/__mocks__/storage-utils.js',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@core/(.*)$': '<rootDir>/src/core/$1',
    '^webextension-polyfill$': '<rootDir>/tests/__mocks__/webextension-polyfill.js',
    // BroadcastManager removed from production; mock kept for legacy integration scenarios
    '.*/managers/BroadcastManager.js$': '<rootDir>/tests/mocks/BroadcastManagerMock.js'
  },

  // Transform ES modules
  transformIgnorePatterns: [
    'node_modules/(?!(webextension-polyfill|eventemitter3|webext-storage-cache|webext-options-sync|lodash-es|uuid)/)'
  ],

  // Coverage configuration
  collectCoverage: false,
  collectCoverageFrom: [
    'src/domain/**/*.js',
    'src/features/**/*.js',
    'src/utils/**/*.js',
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
    './src/domain/': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100
    },

    './src/features/': {
      branches: 75,
      functions: 80,
      lines: 80,
      statements: 80
    },

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
