const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareChromeDist } = require('./prepare-chrome-dist.cjs');

console.log('📦 Packaging for Chrome/Chromium...');

const projectRoot = path.resolve(__dirname, '..');
const { distChromeDir, manifest: chromeManifest } = prepareChromeDist(projectRoot);

console.log('✓ Chrome build prepared with Chrome-specific manifest');

// Get version from manifest for filename
const version = chromeManifest.version;
const outputFile = `chrome-extension-v${version}.zip`;

try {
  // Package from dist-chrome/ directory
  execSync(`cd dist-chrome && zip -r -1 -FS ../${outputFile} * -x '*.DS_Store' -x '*.map'`, {
    stdio: 'inherit'
  });

  const stats = fs.statSync(outputFile);
  console.log(`✅ Chrome package created: ${outputFile}`);
  console.log(`   Size: ${(stats.size / 1024).toFixed(2)} KB`);
  console.log('📝 Install: chrome://extensions/ → Developer Mode → Load unpacked');
  console.log('📝 Or upload to Chrome Web Store');
} catch (error) {
  console.error('❌ Failed to create Chrome package:', error.message);
  process.exit(1);
}
