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
  plugins: ['import'], // Add import plugin for architecture boundaries
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
    quotes: ['warn', 'single', { avoidEscape: true }],

    // NEW: Complexity rules (align with CodeScene targets)
    complexity: ['error', 9], // cc ≤ 9
    'max-depth': ['error', 2], // nesting ≤ 2 levels
    'max-lines-per-function': ['warn', { max: 70, skipBlankLines: true, skipComments: true }],
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
      // Jest test files - relax complexity rules
      files: ['tests/**/*.js', '**/*.test.js', '**/*.spec.js'],
      env: {
        jest: true,
        node: true
      },
      rules: {
        // Relax complexity rules for tests
        'max-lines-per-function': 'off',
        complexity: 'off'
      }
    }
  ],
  ignorePatterns: ['node_modules/', 'dist/', '*.min.js', 'coverage/']
};
