const fs = require('fs');
const path = require('path');
const { normalizeChromeManifestPaths } = require('./manifest-path-utils.js');
function prepareChromeDist(projectRoot = path.resolve(__dirname, '..')) {
  const distDir = path.join(projectRoot, 'dist');
  const distChromeDir = path.join(projectRoot, 'dist-chrome');
  const chromeManifestSrc = path.join(projectRoot, 'manifest.chrome.json');
  const chromeManifestDest = path.join(distChromeDir, 'manifest.json');

  if (!fs.existsSync(distDir)) {
    throw new Error('dist/ directory not found. Run npm run build:prod first.');
  }

  if (!fs.existsSync(chromeManifestSrc)) {
    throw new Error('manifest.chrome.json not found in project root.');
  }

  if (fs.existsSync(distChromeDir)) {
    fs.rmSync(distChromeDir, { recursive: true, force: true });
  }

  try {
    fs.cpSync(distDir, distChromeDir, { recursive: true });
  } catch (error) {
    throw new Error(`Failed to copy dist/ to dist-chrome/: ${error.message}`);
  }

  const chromeManifest = normalizeChromeManifestPaths(
    JSON.parse(fs.readFileSync(chromeManifestSrc, 'utf8'))
  );

  fs.writeFileSync(chromeManifestDest, JSON.stringify(chromeManifest, null, 2) + '\n');

  return {
    distChromeDir,
    manifest: chromeManifest
  };
}

if (require.main === module) {
  try {
    const { distChromeDir } = prepareChromeDist();
    console.log(`✓ Chrome build prepared in ${path.basename(distChromeDir)}/`);
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  normalizeChromeManifestPaths,
  prepareChromeDist
};
