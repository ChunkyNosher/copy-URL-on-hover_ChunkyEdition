module.exports = {
  // Line width
  printWidth: 100,

  // Indentation
  tabWidth: 2,
  useTabs: false,

  // Semicolons
  semi: true,

  // Quotes
  singleQuote: true,
  quoteProps: 'as-needed',

  // Trailing commas
  trailingComma: 'none',

  // Spacing
  bracketSpacing: true,
  bracketSameLine: false,

  // Arrow functions
  arrowParens: 'avoid',

  // Line endings
  endOfLine: 'lf',

  // HTML/Markdown
  htmlWhitespaceSensitivity: 'css',
  proseWrap: 'preserve',

  // File overrides
  overrides: [
    {
      files: '*.json',
      options: {
        printWidth: 80
      }
    },
    {
      files: '*.md',
      options: {
        printWidth: 80,
        proseWrap: 'always'
      }
    }
  ]
};
