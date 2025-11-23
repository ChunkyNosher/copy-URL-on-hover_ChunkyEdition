const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('📦 Packaging for Chrome/Chromium...');

const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const distChromeDir = path.join(projectRoot, 'dist-chrome');

// Verify dist directory exists and has required files
if (!fs.existsSync(distDir)) {
  console.error('❌ dist/ directory not found. Run npm run build:prod first.');
  process.exit(1);
}

// Create dist-chrome directory with Chrome-specific manifest
console.log('🔧 Creating Chrome-specific build...');

// Clean dist-chrome directory if it exists
if (fs.existsSync(distChromeDir)) {
  fs.rmSync(distChromeDir, { recursive: true, force: true });
}
fs.mkdirSync(distChromeDir, { recursive: true });

// Copy dist contents to dist-chrome
execSync(`cp -r ${distDir}/* ${distChromeDir}/`, { stdio: 'inherit' });

// Copy Chrome-specific manifest
const chromeManifestSrc = path.join(projectRoot, 'manifest.chrome.json');
const chromeManifestDest = path.join(distChromeDir, 'manifest.json');

if (!fs.existsSync(chromeManifestSrc)) {
  console.error('❌ manifest.chrome.json not found in project root.');
  process.exit(1);
}

// Read Chrome manifest and fix paths
const chromeManifest = JSON.parse(fs.readFileSync(chromeManifestSrc, 'utf8'));

// Fix background script paths
if (chromeManifest.background && chromeManifest.background.scripts) {
  chromeManifest.background.scripts = chromeManifest.background.scripts.map(script => 
    script.replace(/^dist\//, '')
  );
}

// Fix content script paths
if (chromeManifest.content_scripts) {
  chromeManifest.content_scripts.forEach(contentScript => {
    if (contentScript.js) {
      contentScript.js = contentScript.js.map(script => script.replace(/^dist\//, ''));
    }
  });
}

fs.writeFileSync(chromeManifestDest, JSON.stringify(chromeManifest, null, 2) + '\n');
console.log('✓ Chrome manifest copied and paths fixed');

// Get version from manifest for filename
const version = chromeManifest.version;
const outputFile = `chrome-extension-v${version}.zip`;

try {
  // Package from dist-chrome/ directory
  execSync(
    `cd dist-chrome && zip -r -1 -FS ../${outputFile} * -x '*.DS_Store' -x '*.map'`,
    { stdio: 'inherit' }
  );
  
  const stats = fs.statSync(outputFile);
  console.log(`✅ Chrome package created: ${outputFile}`);
  console.log(`   Size: ${(stats.size / 1024).toFixed(2)} KB`);
  console.log('📝 Install: chrome://extensions/ → Developer Mode → Load unpacked');
  console.log('📝 Or upload to Chrome Web Store');
} catch (error) {
  console.error('❌ Failed to create Chrome package:', error.message);
  process.exit(1);
}
