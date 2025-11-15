module.exports = {
  // Test environment
  testEnvironment: 'jsdom',

  // Root directory
  roots: ['<rootDir>/src', '<rootDir>/tests'],

  // Test match patterns
  testMatch: ['**/__tests__/**/*.js', '**/?(*.)+(spec|test).js'],

  moduleNameMapper: {
    '^webextension-polyfill$': '<rootDir>/tests/__mocks__/webextension-polyfill.js'
  },

  transformIgnorePatterns: [
    'node_modules/(?!(webextension-polyfill|eventemitter3|webext-storage-cache|webext-options-sync|lodash-es)/)'
  ],

  // Coverage settings
  collectCoverage: false,
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!src/**/__tests__/**',
    '!**/node_modules/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],

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

  // Verbose output
  verbose: true
};
