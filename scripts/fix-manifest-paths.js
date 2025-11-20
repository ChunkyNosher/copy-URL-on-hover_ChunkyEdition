#!/usr/bin/env node

/**
 * Fix Manifest Paths for Packaged Extension
 *
 * PROBLEM:
 * The root manifest.json contains paths like "dist/background.js" which are
 * correct when running the extension from the repository root for development.
 * However, when we package the extension from the dist/ directory, these paths
 * become incorrect because:
 * - manifest.json ends up at package root
 * - background.js ends up at package root (not in a dist/ subdirectory)
 *
 * SOLUTION:
 * This script reads dist/manifest.json and removes the "dist/" prefix from all
 * script paths, making them correct for the packaged extension.
 *
 * USAGE:
 * node scripts/fix-manifest-paths.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const manifestPath = path.join(projectRoot, 'dist', 'manifest.json');

console.log('🔧 Fixing manifest.json paths for packaged extension...');

try {
  // Read the manifest
  const manifestContent = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestContent);

  // Fix background script paths
  if (manifest.background && manifest.background.scripts) {
    manifest.background.scripts = manifest.background.scripts.map(script => {
      if (script.startsWith('dist/')) {
        const fixed = script.replace(/^dist\//, '');
        console.log(`  ✓ Fixed background script: "${script}" → "${fixed}"`);
        return fixed;
      }
      return script;
    });
  }

  // Fix content script paths
  if (manifest.content_scripts) {
    manifest.content_scripts.forEach((contentScript, index) => {
      if (contentScript.js) {
        contentScript.js = contentScript.js.map(script => {
          if (script.startsWith('dist/')) {
            const fixed = script.replace(/^dist\//, '');
            console.log(`  ✓ Fixed content script [${index}]: "${script}" → "${fixed}"`);
            return fixed;
          }
          return script;
        });
      }
    });
  }

  // Write the corrected manifest back
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('✅ Manifest paths fixed successfully!');
  console.log(`   Output: ${manifestPath}`);
} catch (error) {
  console.error('❌ Error fixing manifest paths:', error.message);
  process.exit(1);
}
