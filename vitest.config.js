import path from 'path';
import { fileURLToPath } from 'url';

import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@domain': path.resolve(__dirname, 'src/domain'),
      '@storage': path.resolve(__dirname, 'src/storage'),
      '@features': path.resolve(__dirname, 'src/features'),
      '@utils/storage-utils.js': path.resolve(__dirname, 'tests/__mocks__/storage-utils.js'),
      '@utils': path.resolve(__dirname, 'src/utils'),
      '@core': path.resolve(__dirname, 'src/core'),
      '@ui': path.resolve(__dirname, 'src/ui'),
      'webextension-polyfill': path.resolve(__dirname, 'tests/__mocks__/webextension-polyfill.js')
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['tests/setup-vitest.js'],
    include: ['**/__tests__/**/*.js', '**/?(*.)+(spec|test).js'],
    exclude: ['node_modules', 'tests/extension', 'tests/e2e', 'dist'],
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,
    testTimeout: 10000,
    coverage: {
      enabled: false,
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov', 'html'],
      reportsDirectory: 'coverage',
      include: [
        'src/domain/**/*.js',
        'src/storage/**/*.js',
        'src/features/**/*.js',
        'src/utils/**/*.js',
        'src/core/**/*.js',
        'src/ui/**/*.js'
      ],
      exclude: [
        'src/**/*.test.js',
        'src/**/*.spec.js',
        'src/**/__tests__/**',
        'src/**/__mocks__/**',
        '**/node_modules/**',
        '**/dist/**'
      ],
      thresholds: {
        'src/domain/': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100
        },
        'src/storage/': {
          branches: 85,
          functions: 90,
          lines: 90,
          statements: 90
        },
        'src/features/': {
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
      }
    }
  }
});
