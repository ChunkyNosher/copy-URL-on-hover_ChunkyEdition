const fs = require('fs');
const path = require('path');

function normalizeChromeManifestPaths(manifest) {
  if (manifest.background && manifest.background.scripts) {
    manifest.background.scripts = manifest.background.scripts.map(script =>
      script.replace(/^dist\//, '')
    );
  }

  if (manifest.content_scripts) {
    manifest.content_scripts.forEach(contentScript => {
      if (contentScript.js) {
        contentScript.js = contentScript.js.map(script => script.replace(/^dist\//, ''));
      }
    });
  }

  return manifest;
}

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

  fs.cpSync(distDir, distChromeDir, { recursive: true });

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
