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
  rules: {
    // Possible Errors
    'no-console': 'off', // Allow console.log for extension debugging
    'no-unused-vars': [
      'warn',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }
    ],

    // Best Practices
    'no-var': 'error',
    'prefer-const': 'warn',
    'prefer-arrow-callback': 'warn',
    'no-eval': 'error',
    'no-implied-eval': 'error',

    // Security
    'no-new-func': 'error',
    'no-script-url': 'error',

    // Browser Extension Specific
    'no-restricted-globals': ['error', 'window.eval'],

    // Style (handled by Prettier mostly)
    semi: ['warn', 'always'],
    quotes: ['warn', 'single', { avoidEscape: true }]
  },
  overrides: [
    {
      // Relax rules for build config files
      files: ['rollup.config.js', 'jest.config.cjs', '.eslintrc.cjs', '.prettierrc.cjs'],
      env: {
        node: true
      },
      parserOptions: {
        sourceType: 'module', // Allow ES modules in rollup.config.js
        ecmaVersion: 'latest'
      }
    },
    {
      // Jest test files
      files: ['tests/**/*.js', '**/*.test.js', '**/*.spec.js'],
      env: {
        jest: true,
        node: true
      }
    }
  ],
  ignorePatterns: ['node_modules/', 'dist/', '*.min.js', 'coverage/']
};
