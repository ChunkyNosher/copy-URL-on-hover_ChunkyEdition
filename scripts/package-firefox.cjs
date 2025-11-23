const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('📦 Packaging for Firefox...');

const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');

// Verify dist directory exists and has required files
if (!fs.existsSync(distDir)) {
  console.error('❌ dist/ directory not found. Run npm run build:prod first.');
  process.exit(1);
}

const requiredFiles = ['manifest.json', 'background.js', 'content.js', 'browser-polyfill.min.js'];
for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(distDir, file))) {
    console.error(`❌ Required file not found: dist/${file}`);
    process.exit(1);
  }
}

// Get version from manifest for filename
const manifest = JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8'));
const version = manifest.version;
const outputFile = `firefox-extension-v${version}.xpi`;

try {
  // Package from dist/ directory
  // Using -1 for fastest compression since we want speed over size
  // -FS for synchronized file system to ensure proper file handling
  execSync(
    `cd dist && zip -r -1 -FS ../${outputFile} * -x '*.DS_Store' -x '*.map'`,
    { stdio: 'inherit' }
  );
  
  const stats = fs.statSync(outputFile);
  console.log(`✅ Firefox package created: ${outputFile}`);
  console.log(`   Size: ${(stats.size / 1024).toFixed(2)} KB`);
  console.log('📝 Install: about:addons → Install Add-on From File');
} catch (error) {
  console.error('❌ Failed to create Firefox package:', error.message);
  process.exit(1);
}
