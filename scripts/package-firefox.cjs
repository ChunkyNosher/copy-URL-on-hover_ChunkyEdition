const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('📦 Packaging for Firefox...');

const files = [
  'dist/',
  'icons/',
  'popup.html',
  'popup.js',
  'options_page.html',
  'options_page.js',
  'state-manager.js',
  'manifest.json'
];

// Create zip with all necessary files
const excludes = [
  '*.git*',
  'node_modules/*',
  'tests/*',
  'scripts/*',
  'src/*',
  '.github/*',
  'package*.json',
  '*.md',
  'coverage/*',
  'firefox-profile/*',
  '.env',
  '.nvmrc',
  'rollup.config.js',
  'jest.config.cjs',
  'jsconfig.json',
  'playwright.config*',
  '.playwright-mcp*',
  '.babelrc',
  '.codecov.yml',
  '.coderabbit.yaml',
  '.deepsource.toml',
  '.eslintignore',
  '.eslintrc.cjs',
  '.prettierrc.cjs',
  '.pr_agent.toml',
  'test-helpers/*',
  'background.js.backup',
  '.content-legacy.js'
].map(pattern => `--exclude=${pattern}`).join(' ');

try {
  execSync(
    `zip -r -FS firefox-extension.xpi ${files.join(' ')} ${excludes}`,
    { stdio: 'inherit' }
  );
  
  console.log('✅ Firefox package created: firefox-extension.xpi');
  console.log('📝 Install: about:addons → Install Add-on From File');
} catch (error) {
  console.error('❌ Failed to create Firefox package:', error.message);
  process.exit(1);
}
