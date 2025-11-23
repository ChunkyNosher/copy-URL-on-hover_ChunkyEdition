const fs = require('fs');
const path = require('path');

// Source: polyfill from node_modules
const source = path.join(
  __dirname,
  '../node_modules/webextension-polyfill/dist/browser-polyfill.min.js'
);

// Destination: dist directory
const dest = path.join(__dirname, '../dist/browser-polyfill.min.js');

// Ensure dist directory exists
const distDir = path.dirname(dest);
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Copy file
try {
  fs.copyFileSync(source, dest);
  console.log('✅ Copied webextension-polyfill to dist/browser-polyfill.min.js');
} catch (error) {
  console.error('❌ Failed to copy polyfill:', error.message);
  process.exit(1);
}
